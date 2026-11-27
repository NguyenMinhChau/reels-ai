/* ==========================================================================
   Gemini API Service
   - Zero-spam concurrency queue & request spacing
   - In-flight deduplication & bounded LRU cache
   - Smart retry (never retries 4xx auth/bad-request errors)
   - Full AbortSignal cancellation support
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { GEMINI_BASE_URL, GEMINI_LIVE_WS_URL, MODELS, API_POLICY } = App.CONFIG;
    const { hashString, base64ToArrayBuffer, sleep } = App.utils;

    class ApiError extends Error {
        constructor(code, message, status = 0) {
            super(message);
            this.name = 'ApiError';
            this.code = code;
            this.status = status;
        }
    }

    // Bounded LRU Cache
    class LRUCache {
        constructor(limit = 40) {
            this.limit = limit;
            this.map = new Map();
        }
        get(key) {
            if (!this.map.has(key)) return undefined;
            const val = this.map.get(key);
            this.map.delete(key);
            this.map.set(key, val);
            return val;
        }
        set(key, val) {
            if (this.map.has(key)) this.map.delete(key);
            this.map.set(key, val);
            if (this.map.size > this.limit) {
                const firstKey = this.map.keys().next().value;
                this.map.delete(firstKey);
            }
        }
        has(key) {
            return this.map.has(key);
        }
        clear() {
            this.map.clear();
        }
    }

    const caches = {
        prompts: new LRUCache(API_POLICY.MAX_CACHE_ENTRIES),
        ttsPcm: new LRUCache(API_POLICY.MAX_CACHE_ENTRIES),
        images: new LRUCache(API_POLICY.MAX_CACHE_ENTRIES)
    };

    const inFlight = new Map();
    const cooldowns = new Map();

    // Concurrency Queue to avoid blasting 10+ simultaneous API calls
    let activeCount = 0;
    let lastDispatchAt = 0;
    const waitQueue = [];

    function scheduleTask(taskFn, signal) {
        return new Promise((resolve, reject) => {
            if (signal && signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            waitQueue.push({ taskFn, signal, resolve, reject });
            drainQueue();
        });
    }

    function drainQueue() {
        if (activeCount >= API_POLICY.MAX_CONCURRENT_REQUESTS || waitQueue.length === 0) return;

        const next = waitQueue.shift();
        if (next.signal && next.signal.aborted) {
            next.reject(new DOMException('Aborted', 'AbortError'));
            drainQueue();
            return;
        }

        const now = Date.now();
        const waitMs = Math.max(0, API_POLICY.REQUEST_GAP_MS - (now - lastDispatchAt));
        activeCount++;

        setTimeout(async () => {
            lastDispatchAt = Date.now();
            try {
                const result = await next.taskFn();
                next.resolve(result);
            } catch (err) {
                next.reject(err);
            } finally {
                activeCount--;
                drainQueue();
            }
        }, waitMs);
    }

    function getApiKey() {
        return (App.store.getState().apiKey || '').trim();
    }

    async function fetchGeminiWithRetry(model, payload, { signal, apiKeyOverride } = {}) {
        const apiKey = apiKeyOverride !== undefined ? String(apiKeyOverride).trim() : getApiKey();
        const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

        return scheduleTask(async () => {
            for (let attempt = 0; attempt <= API_POLICY.MAX_RETRIES; attempt++) {
                if (signal && signal.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }

                let response;
                try {
                    response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal
                    });
                } catch (networkErr) {
                    if (networkErr.name === 'AbortError') throw networkErr;
                    if (attempt === API_POLICY.MAX_RETRIES) {
                        throw new ApiError('NETWORK_ERROR', 'Không thể kết nối tới Gemini API. Kiểm tra lại mạng.');
                    }
                    await sleep(900 * Math.pow(2, attempt), signal);
                    continue;
                }

                if (response.ok) {
                    return await response.json();
                }

                const status = response.status;
                let errDetail = '';
                try {
                    const errJson = await response.json();
                    errDetail = errJson?.error?.message || '';
                } catch (_) {
                    // ignore non-json error body
                }

                // NEVER retry client auth / invalid request errors (400, 401, 403, 404)
                if (status === 400 || status === 401 || status === 403 || status === 404) {
                    const isKeyErr = status === 401 || status === 403 || /api.?key/i.test(errDetail);
                    const code = isKeyErr ? 'INVALID_API_KEY' : 'BAD_REQUEST';
                    const friendly = isKeyErr
                        ? 'API Key chưa được cấu hình hoặc không hợp lệ.'
                        : errDetail || `Yêu cầu không hợp lệ (HTTP ${status}).`;
                    throw new ApiError(code, friendly, status);
                }

                // Do NOT retry 429 when it is a Daily Quota (PerDay) or Free-Tier limit: 0
                if (status === 429 && /limit:\s*0|PerDay|daily|billing/i.test(errDetail)) {
                    const reason = /limit:\s*0/i.test(errDetail)
                        ? `Model ${model} có limit=0 (chưa bật Billing hoặc không có quota miễn phí).`
                        : `Model ${model} đã hết hạn mức ngày (RPD). Đợi 5-6 phút sẽ không reset mà phải chờ qua ngày mới hoặc đổi Key.`;
                    throw new ApiError('QUOTA_EXHAUSTED', `${reason} (${errDetail.slice(0, 120)})`, 429);
                }

                const isRetryable = API_POLICY.RETRYABLE_STATUSES.includes(status);
                const maxTries = status === 429 ? Math.min(1, API_POLICY.MAX_RETRIES) : API_POLICY.MAX_RETRIES;
                if (!isRetryable || attempt >= maxTries) {
                    if (status === 429) {
                        const shortErr = errDetail ? ` — ${errDetail.slice(0, 120)}` : '';
                        throw new ApiError('RATE_LIMITED', `Model ${model} chạm giới hạn 429${shortErr}`, 429);
                    }
                    throw new ApiError('SERVER_ERROR', errDetail || `Lỗi máy chủ Gemini (HTTP ${status}).`, status);
                }

                const retryAfterSec = parseInt(response.headers.get('Retry-After') || '0', 10);
                if (status === 429 && retryAfterSec > 10) {
                    throw new ApiError('RATE_LIMITED', `Model ${model} yêu cầu đợi ${retryAfterSec}s (429).`, 429);
                }
                const backoffMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 2000 * Math.pow(2, attempt);
                await sleep(Math.min(backoffMs, 5000), signal);
            }
        }, signal);
    }

    function dedupedCall(dedupKey, fn) {
        if (inFlight.has(dedupKey)) {
            return inFlight.get(dedupKey);
        }
        const promise = Promise.resolve()
            .then(fn)
            .finally(() => inFlight.delete(dedupKey));
        inFlight.set(dedupKey, promise);
        return promise;
    }

    function checkCooldown(actionName, cooldownMs) {
        const now = Date.now();
        const until = cooldowns.get(actionName) || 0;
        if (now < until) {
            const remainSec = Math.ceil((until - now) / 1000);
            throw new ApiError('COOLDOWN', `Vui lòng đợi ${remainSec}s trước khi gọi lại để tránh spam API.`);
        }
        cooldowns.set(actionName, now + cooldownMs);
    }

    async function fetchTextWithFallback(payload, { signal, apiKeyOverride } = {}) {
        const candidates = [MODELS.TEXT, ...(MODELS.TEXT_FALLBACKS || [])].filter(Boolean);
        let lastErr = null;

        for (let i = 0; i < candidates.length; i++) {
            const modelName = candidates[i];
            try {
                return await fetchGeminiWithRetry(modelName, payload, { signal, apiKeyOverride });
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                lastErr = err;
                const shouldFallback =
                    err.status === 429 ||
                    err.status === 404 ||
                    err.status === 500 ||
                    err.status === 502 ||
                    err.status === 503 ||
                    err.status === 504 ||
                    err.code === 'QUOTA_EXHAUSTED' ||
                    err.code === 'RATE_LIMITED' ||
                    err.code === 'SERVER_ERROR';

                if (!shouldFallback || i === candidates.length - 1) {
                    throw err;
                }
                console.warn(`Text model ${modelName} unavailable (${err.status || err.code}), switching to ${candidates[i + 1]}`);
            }
        }
        throw lastErr || new ApiError('SERVER_ERROR', 'Không có model văn bản khả dụng.');
    }

    async function testApiKey(candidateKey) {
        const clean = String(candidateKey || '').trim();
        if (!clean) throw new ApiError('MISSING_API_KEY', 'Vui lòng nhập API Key');

        const payload = {
            contents: [{ parts: [{ text: 'Reply with OK' }] }],
            generationConfig: { maxOutputTokens: 8 }
        };
        await fetchTextWithFallback(payload, { apiKeyOverride: clean });
        return true;
    }

    const CREATIVE_ANGLES = [
        'cảnh báo an toàn đời sống, lừa đảo online/tin nhắn giả mạo, an toàn điện nước hoặc thực phẩm',
        'nhắc nhở nhẹ nhàng thói quen tốt hằng ngày: uống nước, giãn cơ, gọi về cho gia đình, nghỉ ngơi',
        'chủ đề nhạc chill, tạo mood thư giãn làm việc, âm thanh chữa lành dễ ngủ và chọn nhạc nền Reels',
        'mẹo quản lý tài chính cá nhân, chi tiêu thông minh và tiết kiệm cuối tháng',
        'mẹo vặt nhà bếp, bảo quản thực phẩm và nấu ăn nhanh 15 phút',
        'tình huống hài hước chốn công sở, sinh viên và gia đình Việt Nam',
        'công nghệ đời thường: mẹo điện thoại, bảo mật, tối ưu pin và làm việc từ xa',
        'dọn dẹp nhà cửa tối giản, decor góc làm việc và hậu trường sáng tạo nội dung'
    ];

    const TONE_GUIDES = {
        viral: 'Phong cách TRIỆU VIEW BẮT TREND: Hook cực gắt dưới 15 từ đánh thẳng vào sai lầm/bí mật/con số sốc; văn nói đời thường gãy gọn ("Khoan đã...", "Nghe vô lý nhưng...", "90% người làm sai..."); có bước ngoặt bất ngờ ở cảnh 4; CTA đặt câu hỏi kích thích bình luận tranh luận nhẹ.',
        funny: 'Phong cách HÀI XÉO XẮT / GEN Z: Tự trào, lầy lội, hơi phũ nhưng đúng tim đen; câu ngắn tung hứng duyên dáng kiểu nói chuyện với bạn thân; CTA rủ bạn bè vào điểm danh hoặc tag nhau.',
        drama: 'Phong cách CẢNH BÁO / KỊCH TÍNH: Mở đầu khẩn cấp gây chú ý ngay ("Dừng lại 3 giây nếu bạn đang..."); chỉ rõ rủi ro mất tiền/hại sức khỏe; giải pháp dứt khoát; CTA nhắc gửi ngay cho người thân.',
        healing: 'Phong cách TÂM SỰ / CHỮA LÀNH: Thủ thỉ gần gũi, chạm đúng nỗi lòng người trẻ/người đi làm; hình ảnh đời thường ấm áp; CTA tạo cảm giác được lắng nghe và muốn lưu lại.'
    };

    async function dumpFreshScripts({ existingTitles, category, categoryLabel, tone = 'viral', signal }) {
        return dedupedCall('dumpScripts', async () => {
            checkCooldown('dumpScripts', API_POLICY.DUMP_COOLDOWN_MS);

            const pickedAngles = [...CREATIVE_ANGLES]
                .sort(() => Math.random() - 0.5)
                .slice(0, 3)
                .join('; ');

            const toneRule = TONE_GUIDES[tone] || TONE_GUIDES.viral;
            const categoryContext =
                category !== 'all'
                    ? `Tập trung chủ yếu vào ngách "${categoryLabel || category}".`
                    : `Hãy khai thác 3 góc nhìn/chủ đề hoàn toàn mới mẻ sau đây để đa dạng nội dung: (${pickedAngles}).`;

            const prompt = `Bạn là Creative Director chuyên viết kịch bản Facebook Reels triệu view tại Việt Nam.
Hãy sáng tạo 3 kịch bản Reels đời sống CỰC CUỐN, ĐỌC LÊN NGHE NHƯ NGƯỜI THẬT NÓI CHUYỆN (tuyệt đối CẤM văn phong sách giáo khoa, báo chí hay dạy đời sáo rỗng).
${toneRule}
${categoryContext}
QUY TẮC BẮT BUỘC:
- Tuyệt đối KHÔNG trùng ý tưởng với các tiêu đề đã có: [${existingTitles.slice(0, 45).join('; ')}].
- Hook (3 giây đầu): Tối đa 16 từ, đánh thẳng vào tò mò, sai lầm phổ biến, mất tiền/tiết kiệm hoặc POV ai cũng dính.
- Body: Đúng 4 ý ngắn (mỗi ý 12–22 từ, dùng ký tự "• " đầu dòng), nhịp nhanh, có cao trào hoặc chi tiết bất ngờ ở ý thứ 3–4.
- CTA: Không xin follow kiểu công nghiệp; hãy hỏi một câu khiến người xem muốn comment ngay hoặc nhắc tag người thân.
- category: Chỉ chọn 1 trong 7 giá trị: "humor", "lifehack", "warning", "reminder", "music", "vlog", "bts".
- duration: Ví dụ "22s", "25s".
- viralScore: Từ "94%" đến "99%".
- hashtags: 4-5 hashtag tiếng Việt không dấu.`;

            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                title: { type: 'STRING' },
                                category: { type: 'STRING' },
                                duration: { type: 'STRING' },
                                viralScore: { type: 'STRING' },
                                hook: { type: 'STRING' },
                                body: { type: 'STRING' },
                                cta: { type: 'STRING' },
                                hashtags: { type: 'STRING' }
                            },
                            required: ['title', 'category', 'duration', 'viralScore', 'hook', 'body', 'cta', 'hashtags']
                        }
                    }
                }
            };

            const result = await fetchTextWithFallback(payload, { signal });
            const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawText) throw new ApiError('EMPTY_RESPONSE', 'Không nhận được phản hồi kịch bản từ AI');
            const parsed = JSON.parse(rawText);
            if (!Array.isArray(parsed)) throw new ApiError('INVALID_JSON', 'Dữ liệu AI trả về không đúng định dạng mảng');
            return parsed;
        });
    }

    async function enhanceStorytelling({ title, draftLines, tone = 'viral', signal }) {
        checkCooldown('rewriteStory', API_POLICY.REWRITE_COOLDOWN_MS);

        const toneRule = TONE_GUIDES[tone] || TONE_GUIDES.viral;
        const prompt = `Bạn là biên kịch triệu view chuyên viết lời bình (voice-over) cho Facebook Reels tại Việt Nam.
Hãy viết lại kịch bản sau thành đúng 5 đoạn lời thoại VĂN NÓI ĐỜI THƯỜNG thật cuốn, nhịp nhanh, có hồn, nghe như một người thật đang kể chuyện hoặc bật mí bí mật cho bạn thân (TUYỆT ĐỐI CẤM giọng văn sách giáo khoa, quảng cáo sáo rỗng, hoặc chỉ đạo quay phim kiểu "Quay cận cảnh...").
${toneRule}

Tiêu đề: "${title}"
Ý tưởng gốc:
${draftLines.join('\n')}

Yêu cầu nghiêm ngặt cho đúng 5 phần (mỗi phần 15–26 từ, ngắn gọn dứt khoát để đọc tốc độ cao cực dính):
- Phần 1 (Hook 3 giây đầu): Câu mở đầu đánh thẳng vào tâm lý ("Khoan đã...", "90% mọi người...", "Đừng làm điều này nữa nếu...") khiến người lướt phải khựng lại ngay.
- Phần 2 (Nỗi đau / Thực tế phũ): Mô tả tình huống ai cũng từng dính phải bằng ngôn ngữ đời thường gần gũi.
- Phần 3 (Bước ngoặt / Cách làm 1): Bật mí mẹo hoặc diễn biến bất ngờ đầu tiên với giọng điệu hào hứng, tự nhiên.
- Phần 4 (Chi tiết đắt giá / Twist 2): Đưa ra điểm chốt ăn tiền hoặc bí quyết ít người để ý tạo cảm giác "À hóa ra là vậy!".
- Phần 5 (Chốt & Kích bình luận): Câu kết gây đồng cảm hoặc đặt câu hỏi mở khiến người xem muốn comment trả lời ngay lập tức (hạn chế sáo rỗng kiểu "Follow để biết thêm").`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'ARRAY',
                    items: { type: 'STRING' }
                }
            }
        };

        return dedupedCall(`rewrite:${tone}:${hashString(title + draftLines.join('|'))}`, async () => {
            const result = await fetchTextWithFallback(payload, { signal });
            const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || parsed.length < 5) {
                throw new ApiError('INVALID_JSON', 'AI chưa trả về đủ 5 phân cảnh lời thoại');
            }
            return parsed.slice(0, 5).map((s) => String(s || '').trim());
        });
    }

    async function generateRealisticVisualPrompts({ title, sceneTexts, signal }) {
        const cacheKey = `prompts:${hashString(title + '|' + sceneTexts.join('|'))}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        const fallback = () =>
            sceneTexts.map(
                (t, i) =>
                    `Raw candid iPhone photo in an ordinary Vietnamese home kitchen or living room, natural window daylight, authentic daily life scene depicting: ${title} step ${i + 1}, realistic textures, unedited smartphone photography, vertical 9:16, no text`
            );

        return dedupedCall(cacheKey, async () => {
            try {
                const prompt = `You are a candid lifestyle smartphone photographer in Vietnam. Given a vertical 9:16 Facebook Reels video titled "${title}" and its 5 Vietnamese narration segments, write 5 ultra-realistic English photo prompts that look like raw unedited photos shot on an iPhone 15 Pro in an ordinary Vietnamese apartment, home kitchen, bedroom, or local street.
CRITICAL REALISM RULES:
- Must look 100% like real candid smartphone photography, NOT AI art, NOT 3D render, NOT studio lighting.
- Include authentic Vietnamese daily life details: tiled kitchen counter, stainless steel utensils, plastic food containers, warm natural daylight coming through a window, slight natural imperfections, candid first-person POV hands doing the action.
- Vertical 9:16 framing, natural depth of field, realistic skin tones and textures.
- NEVER include any text, letters, watermarks, captions, or UI overlays in the image.
Narration segments:
1. ${sceneTexts[0]}
2. ${sceneTexts[1]}
3. ${sceneTexts[2]}
4. ${sceneTexts[3]}
5. ${sceneTexts[4]}`;

                const payload = {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'ARRAY',
                            items: { type: 'STRING' }
                        }
                    }
                };

                const result = await fetchTextWithFallback(payload, { signal });
                const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text;
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length >= 5) {
                    const sliced = parsed.slice(0, 5);
                    caches.prompts.set(cacheKey, sliced);
                    return sliced;
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                console.warn('Fallback visual prompts used:', err.message);
            }
            return fallback();
        });
    }

    async function generateMultiBeatStoryboard({ title, beatTexts, templates, themes, signal }) {
        const cleanBeats = (beatTexts || []).map((b) => String(b || '').trim()).filter(Boolean);
        if (cleanBeats.length === 0) return null;

        const cacheKey = `storyboard:${hashString(title + '|' + cleanBeats.join('|'))}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        const tplList = Array.isArray(templates) && templates.length > 0 ? templates : ['character', 'lightbulb', 'alert', 'checklist', 'clock'];
        const themeList = Array.isArray(themes) && themes.length > 0 ? themes : ['cream', 'mint', 'sky', 'rose', 'lavender', 'amber', 'teal'];

        return dedupedCall(cacheKey, async () => {
            try {
                const numberedBeats = cleanBeats.map((b, i) => `${i + 1}. "${b}"`).join('\n');
                const prompt = `Bạn là Art Director dựng video Reels 2D Motion Infographic chuyển cảnh nhanh theo từng nhịp giọng đọc (1.5–2.5 giây/cảnh).
Tiêu đề video: "${title}"
Danh sách ${cleanBeats.length} nhịp lời thoại theo đúng thứ tự âm thanh:
${numberedBeats}

Hãy thiết kế storyboard đúng ${cleanBeats.length} phần tử khớp 1-1 với từng nhịp lời thoại trên:
- template: Chọn từ [${tplList.join(', ')}] sao cho hình vẽ minh họa sát nhất với ý đang nói ở nhịp đó. TUYỆT ĐỐI KHÔNG chọn trùng template ở 2 nhịp liền kề nhau! Hãy thay đổi đa dạng hết mức có thể để video sống động.
- theme: Chọn từ [${themeList.join(', ')}] sao cho KHÔNG trùng màu nền giữa 2 nhịp liền kề.
- topBadge: Nhãn ngắn 2–3 từ VIẾT HOA nổi bật góc trên (VD: "⚠️ CẢNH BÁO", "💡 BÍ QUYẾT", "📱 MẸO SỐ", "BƯỚC 1").
- cardLabel: Cụm 2–4 từ VIẾT HOA súc tích tóm tắt đúng nội dung nhịp thoại đó.
- highlightBadge: Con số hoặc từ khóa điểm nhấn 1–3 từ VIẾT HOA (VD: "90% SAI", "5 PHÚT", "TIẾT KIỆM").`;

                const payload = {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    template: { type: 'STRING', enum: tplList },
                                    theme: { type: 'STRING', enum: themeList },
                                    topBadge: { type: 'STRING' },
                                    cardLabel: { type: 'STRING' },
                                    highlightBadge: { type: 'STRING' }
                                },
                                required: ['template', 'theme', 'topBadge', 'cardLabel', 'highlightBadge']
                            }
                        }
                    }
                };

                const result = await fetchTextWithFallback(payload, { signal });
                const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text;
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length >= cleanBeats.length) {
                    const normalized = parsed.slice(0, cleanBeats.length).map((item) => ({
                        template: tplList.includes(item.template) ? item.template : '',
                        theme: themeList.includes(item.theme) ? item.theme : '',
                        topBadge: String(item.topBadge || '').trim().slice(0, 22),
                        cardLabel: String(item.cardLabel || '').trim().slice(0, 26),
                        highlightBadge: String(item.highlightBadge || '').trim().slice(0, 20)
                    }));
                    caches.prompts.set(cacheKey, normalized);
                    return normalized;
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                console.warn('Storyboard fallback to local analyzer:', err.message);
            }
            return null;
        });
    }

    async function fetchSceneTtsPcm({ text, voiceName, ttsModel, signal }) {
        const cleanText = String(text || '').trim();
        const voice = voiceName || 'Aoede';
        const targetModel = ttsModel || MODELS.TTS;
        const cacheKey = `tts:${targetModel}:${voice}:${hashString(cleanText)}`;

        if (caches.ttsPcm.has(cacheKey)) {
            return { buffer: caches.ttsPcm.get(cacheKey), fromCache: true, rateLimited: false };
        }

        return dedupedCall(cacheKey, async () => {
            try {
                // Gemini 3.8 TTS treats text strictly as verbatim transcript (no instruction prefix)
                const payload = {
                    contents: [
                        {
                            parts: [
                                {
                                    text: cleanText
                                }
                            ]
                        }
                    ],
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName: voice }
                            }
                        }
                    }
                };

                const result = await fetchGeminiWithRetry(targetModel, payload, { signal });
                const part = result?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
                if (part?.inlineData?.data) {
                    const pcmBuffer = base64ToArrayBuffer(part.inlineData.data);
                    caches.ttsPcm.set(cacheKey, pcmBuffer);
                    return { buffer: pcmBuffer, mimeType: part.inlineData.mimeType || 'audio/wav', fromCache: false, rateLimited: false };
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                const isRateLimited = err.code === 'RATE_LIMITED' || err.code === 'QUOTA_EXHAUSTED' || err.status === 429;
                console.warn('TTS fallback used:', err.message);
                return { buffer: null, fromCache: false, rateLimited: isRateLimited, errorReason: err.message };
            }
            return { buffer: null, fromCache: false, rateLimited: false };
        });
    }

    // Generate all 5 scenes in 1 single TTS API call to avoid Free Tier 3 RPM 429 limit
    async function fetchCombinedTtsPcm({ texts, voiceName, signal }) {
        const cleanTexts = (texts || []).map((t) => String(t || '').trim() || 'Khoảnh khắc đời sống hằng ngày.');
        const voice = voiceName || 'Aoede';
        const cacheKey = `tts-batch:${voice}:${hashString(cleanTexts.join('|'))}`;

        if (caches.ttsPcm.has(cacheKey)) {
            return { buffer: caches.ttsPcm.get(cacheKey), fromCache: true, rateLimited: false };
        }

        return dedupedCall(cacheKey, async () => {
            try {
                const formattedBody = cleanTexts
                    .map((t) => t.replace(/[.\s]+$/, '') + '.')
                    .join('\n\n');

                const payload = {
                    contents: [
                        {
                            parts: [
                                {
                                    text: `Hãy đọc to toàn bộ đoạn văn tiếng Việt sau với giọng vlogger truyền cảm, nhịp độ nhanh, năng lượng cao và cuốn hút. Ngắt nghỉ rõ khoảng nửa giây ở mỗi chỗ xuống dòng, tuyệt đối không đọc thêm từ nào ngoài văn bản:\n\n${formattedBody}`
                                }
                            ]
                        }
                    ],
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName: voice }
                            }
                        }
                    }
                };

                const result = await fetchGeminiWithRetry(MODELS.TTS, payload, { signal });
                const part = result?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
                if (part?.inlineData?.data) {
                    const pcmBuffer = base64ToArrayBuffer(part.inlineData.data);
                    caches.ttsPcm.set(cacheKey, pcmBuffer);
                    return { buffer: pcmBuffer, mimeType: part.inlineData.mimeType || 'audio/L16', fromCache: false, rateLimited: false };
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                const isRateLimited = err.code === 'RATE_LIMITED' || err.code === 'QUOTA_ZERO' || err.status === 429;
                console.warn('Combined TTS failed:', err.message);
                return { buffer: null, fromCache: false, rateLimited: isRateLimited };
            }
            return { buffer: null, fromCache: false, rateLimited: false };
        });
    }

    async function fetchSceneImageDataUrl({ promptText, signal }) {
        const cacheKey = `img:${hashString(promptText)}`;
        if (caches.images.has(cacheKey)) {
            return { dataUrl: caches.images.get(cacheKey), fromCache: true, rateLimited: false };
        }

        return dedupedCall(cacheKey, async () => {
            const modelsToTry = [MODELS.IMAGE_PRIMARY, MODELS.IMAGE_FALLBACK];
            let hitRateLimit = false;

            for (const modelName of modelsToTry) {
                if (signal && signal.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }
                try {
                    const payload = {
                        contents: [{ role: 'user', parts: [{ text: promptText }] }],
                        generationConfig: {
                            responseModalities: ['IMAGE'],
                            ...(modelName === MODELS.IMAGE_PRIMARY ? { imageConfig: { aspectRatio: '9:16' } } : {})
                        }
                    };

                    const result = await fetchGeminiWithRetry(modelName, payload, { signal });
                    const part = result?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
                    const base64Data = part?.inlineData?.data;
                    const mimeType = part?.inlineData?.mimeType || 'image/png';
                    if (base64Data) {
                        const dataUrl = `data:${mimeType};base64,${base64Data}`;
                        caches.images.set(cacheKey, dataUrl);
                        return { dataUrl, fromCache: false, rateLimited: false };
                    }
                } catch (err) {
                    if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                    if (err.code === 'RATE_LIMITED' || err.code === 'QUOTA_EXHAUSTED' || err.status === 429) {
                        hitRateLimit = true;
                        console.warn(`Image model ${modelName} rate-limited:`, err.message);
                        break;
                    } else {
                        console.warn(`Image model ${modelName} skipped:`, err.message);
                    }
                }
            }
            return { dataUrl: null, fromCache: false, rateLimited: hitRateLimit };
        });
    }

    // Live API WebSocket Voice Synthesis (Unlimited RPD on Gemini 3.8 Live / 2.5 Native Audio)
    function concatUint8Arrays(arrays) {
        let total = 0;
        for (const a of arrays) total += a.byteLength;
        const out = new Uint8Array(total);
        let offset = 0;
        for (const a of arrays) {
            out.set(a, offset);
            offset += a.byteLength;
        }
        return out.buffer;
    }

    async function fetchBatchLiveTtsPcm({ texts, voiceName, model, onSceneDone, signal }) {
        const cleanTexts = (texts || []).map((t) => String(t || '').trim() || 'Khoảnh khắc đời sống hằng ngày.');
        const voice = voiceName || 'Aoede';
        const liveModel = model || MODELS.LIVE_38;

        const results = new Array(cleanTexts.length).fill(null);
        const missingIndices = [];

        cleanTexts.forEach((text, i) => {
            const cacheKey = `live:${liveModel}:${voice}:${hashString(text)}`;
            if (caches.ttsPcm.has(cacheKey)) {
                results[i] = caches.ttsPcm.get(cacheKey);
                if (onSceneDone) onSceneDone(i, results[i], true);
            } else {
                missingIndices.push(i);
            }
        });

        if (missingIndices.length === 0) {
            return { buffers: results, errorReason: '' };
        }

        const apiKey = getApiKey();
        const wsUrl = `${GEMINI_LIVE_WS_URL}?key=${encodeURIComponent(apiKey)}`;

        return new Promise((resolve, reject) => {
            if (signal && signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }

            let ws = null;
            let settled = false;
            let setupDone = false;
            let queuePos = 0;
            let turnChunks = [];
            let turnTimer = null;

            const cleanup = () => {
                if (turnTimer) {
                    clearTimeout(turnTimer);
                    turnTimer = null;
                }
                if (signal) signal.removeEventListener('abort', onAbort);
                if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                    try {
                        ws.close(1000, 'Done');
                    } catch (_) {}
                }
            };

            const finishWithError = (err) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };

            const finishSuccess = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve({ buffers: results, errorReason: '' });
            };

            const onAbort = () => {
                finishWithError(new DOMException('Aborted', 'AbortError'));
            };
            if (signal) signal.addEventListener('abort', onAbort, { once: true });

            const sendNextScene = () => {
                if (settled) return;
                if (queuePos >= missingIndices.length) {
                    finishSuccess();
                    return;
                }

                const sceneIdx = missingIndices[queuePos];
                turnChunks = [];

                if (turnTimer) clearTimeout(turnTimer);
                turnTimer = setTimeout(() => {
                    finishWithError(new ApiError('TIMEOUT', `Gemini Live phản hồi quá lâu ở cảnh ${sceneIdx + 1}.`));
                }, 25000);

                ws.send(
                    JSON.stringify({
                        clientContent: {
                            turns: [
                                {
                                    role: 'user',
                                    parts: [
                                        {
                                            text: `Đọc thành tiếng chính xác nguyên văn câu tiếng Việt sau (không chào hỏi, không trả lời câu hỏi, không thêm bớt bất kỳ từ nào):\n"${cleanTexts[sceneIdx]}"`
                                        }
                                    ]
                                }
                            ],
                            turnComplete: true
                        }
                    })
                );
            };

            try {
                ws = new WebSocket(wsUrl);
            } catch (e) {
                finishWithError(new ApiError('WS_ERROR', 'Không thể mở kết nối WebSocket tới Gemini Live API.'));
                return;
            }

            const setupTimer = setTimeout(() => {
                if (!setupDone) {
                    finishWithError(new ApiError('TIMEOUT', 'Kết nối Gemini Live WebSocket quá thời gian chờ.'));
                }
            }, 10000);

            ws.onopen = () => {
                ws.send(
                    JSON.stringify({
                        setup: {
                            model: `models/${liveModel}`,
                            generationConfig: {
                                responseModalities: ['AUDIO'],
                                speechConfig: {
                                    voiceConfig: {
                                        prebuiltVoiceConfig: {
                                            voiceName: voice
                                        }
                                    }
                                }
                            },
                            systemInstruction: {
                                parts: [
                                    {
                                        text: 'Bạn là diễn viên lồng tiếng Việt chuyên nghiệp cho Facebook Reels. Khi nhận được bất kỳ câu văn bản nào từ người dùng, bạn PHẢI đọc nguyên văn đúng từng chữ câu đó bằng tiếng Việt với giọng tự nhiên, năng lượng cao, truyền cảm, nhịp độ nhanh. TUYỆT ĐỐI KHÔNG chào hỏi, KHÔNG giải thích, KHÔNG bình luận, KHÔNG nói thêm bất kỳ từ nào ngoài văn bản được gửi.'
                                    }
                                ]
                            }
                        }
                    })
                );
            };

            ws.onmessage = async (event) => {
                if (settled) return;
                let rawText = '';
                try {
                    rawText = typeof event.data === 'string' ? event.data : await event.data.text();
                } catch (_) {
                    return;
                }

                let msg;
                try {
                    msg = JSON.parse(rawText);
                } catch (_) {
                    return;
                }

                if (msg.error) {
                    clearTimeout(setupTimer);
                    finishWithError(new ApiError('LIVE_ERROR', msg.error.message || 'Lỗi từ Gemini Live API.'));
                    return;
                }

                if (msg.setupComplete !== undefined && !setupDone) {
                    setupDone = true;
                    clearTimeout(setupTimer);
                    sendNextScene();
                    return;
                }

                const sc = msg.serverContent;
                if (sc?.modelTurn?.parts) {
                    for (const part of sc.modelTurn.parts) {
                        if (part.inlineData?.data) {
                            const buf = base64ToArrayBuffer(part.inlineData.data);
                            turnChunks.push(new Uint8Array(buf));
                        }
                    }
                }

                if (sc?.turnComplete || msg.interactionStatus === 'IDLE') {
                    if (turnTimer) {
                        clearTimeout(turnTimer);
                        turnTimer = null;
                    }
                    const sceneIdx = missingIndices[queuePos];
                    if (turnChunks.length > 0) {
                        const combined = concatUint8Arrays(turnChunks);
                        const cacheKey = `live:${liveModel}:${voice}:${hashString(cleanTexts[sceneIdx])}`;
                        caches.ttsPcm.set(cacheKey, combined);
                        results[sceneIdx] = combined;
                        if (onSceneDone) onSceneDone(sceneIdx, combined, false);
                    }
                    queuePos++;
                    sendNextScene();
                }
            };

            ws.onerror = () => {
                clearTimeout(setupTimer);
                finishWithError(new ApiError('WS_ERROR', `Lỗi kết nối Live API (${liveModel}).`));
            };

            ws.onclose = (ev) => {
                clearTimeout(setupTimer);
                if (!settled) {
                    if (!setupDone) {
                        const reason = ev.reason || `WebSocket đóng (mã ${ev.code}) — có thể do thiếu API Key hoặc model không hỗ trợ.`;
                        finishWithError(new ApiError('WS_CLOSED', reason));
                    } else if (queuePos < missingIndices.length) {
                        finishWithError(new ApiError('WS_CLOSED', ev.reason || 'Kết nối Live API bị ngắt giữa chừng.'));
                    } else {
                        finishSuccess();
                    }
                }
            };
        });
    }

    function clearMediaCaches() {
        caches.prompts.clear();
        caches.ttsPcm.clear();
        caches.images.clear();
    }

    App.geminiApi = {
        ApiError,
        testApiKey,
        dumpFreshScripts,
        enhanceStorytelling,
        generateRealisticVisualPrompts,
        generateMultiBeatStoryboard,
        fetchSceneTtsPcm,
        fetchCombinedTtsPcm,
        fetchBatchLiveTtsPcm,
        fetchSceneImageDataUrl,
        clearMediaCaches
    };
})(window);
