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
    const { GEMINI_BASE_URL, MODELS, API_POLICY } = App.CONFIG;
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

    async function testApiKey(candidateKey) {
        const clean = String(candidateKey || '').trim();
        if (!clean) throw new ApiError('MISSING_API_KEY', 'Vui lòng nhập API Key');

        const payload = {
            contents: [{ parts: [{ text: 'Reply with OK' }] }],
            generationConfig: { maxOutputTokens: 8 }
        };
        await fetchGeminiWithRetry(MODELS.TEXT, payload, { apiKeyOverride: clean });
        return true;
    }

    const CREATIVE_ANGLES = [
        'mẹo quản lý tài chính cá nhân, chi tiêu thông minh và tiết kiệm cuối tháng',
        'mẹo vặt nhà bếp, bảo quản thực phẩm và nấu ăn nhanh 15 phút',
        'thói quen buổi sáng/tối giúp nâng cao sức khỏe và ngủ ngon hơn',
        'tình huống hài hước chốn công sở, sinh viên và gia đình Việt Nam',
        'công nghệ đời thường: mẹo điện thoại, bảo mật, tối ưu pin và làm việc từ xa',
        'dọn dẹp nhà cửa tối giản, decor góc làm việc và chăm sóc đồ dùng',
        'hậu trường sáng tạo nội dung, quay dựng bằng điện thoại và chụp ảnh đẹp',
        'kỹ năng giao tiếp, xử lý tình huống khó đỡ ngoài xã hội một cách tinh tế'
    ];

    async function dumpFreshScripts({ existingTitles, category, categoryLabel, signal }) {
        return dedupedCall('dumpScripts', async () => {
            checkCooldown('dumpScripts', API_POLICY.DUMP_COOLDOWN_MS);

            const pickedAngles = [...CREATIVE_ANGLES]
                .sort(() => Math.random() - 0.5)
                .slice(0, 3)
                .join('; ');

            const categoryContext =
                category !== 'all'
                    ? `Tập trung chủ yếu vào ngách "${categoryLabel || category}".`
                    : `Hãy khai thác 3 góc nhìn/chủ đề hoàn toàn mới mẻ sau đây để đa dạng nội dung: (${pickedAngles}).`;

            const prompt = `Hãy sáng tạo 3 kịch bản video ngắn Facebook Reels chủ đề cuộc sống hằng ngày tại Việt Nam thật mới lạ, bắt trend năm 2026, gần gũi, dễ quay hoặc dựng bằng AI và có khả năng lên xu hướng cao. ${categoryContext}
QUY TẮC BẮT BUỘC: Tuyệt đối KHÔNG trùng ý tưởng hoặc lặp lại nội dung với danh sách các tiêu đề đã có sau đây: [${existingTitles.slice(0, 45).join('; ')}].
Mỗi kịch bản cần có:
- title: Tiêu đề ngắn gọn, thu hút.
- category: Chỉ chọn 1 trong 4 giá trị chính xác: "humor", "lifehack", "vlog", "bts".
- duration: Thời lượng đề xuất (ví dụ "25s", "28s").
- viralScore: Điểm dự đoán xu hướng từ "93%" đến "99%".
- hook: Câu mở đầu 3 giây đầu gây tò mò hoặc đánh trúng tâm lý.
- body: Đúng 4 ý diễn biến câu chuyện cuốn hút, tự nhiên (dùng ký tự "• " đầu mỗi dòng, không ghi mốc giây khô khan).
- cta: Câu kêu gọi bình luận/lưu/follow tự nhiên.
- hashtags: 4-5 hashtag tiếng Việt không dấu phù hợp.`;

            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 1.05,
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

            const result = await fetchGeminiWithRetry(MODELS.TEXT, payload, { signal });
            const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawText) throw new ApiError('EMPTY_RESPONSE', 'Không nhận được phản hồi kịch bản từ AI');
            const parsed = JSON.parse(rawText);
            if (!Array.isArray(parsed)) throw new ApiError('INVALID_JSON', 'Dữ liệu AI trả về không đúng định dạng mảng');
            return parsed;
        });
    }

    async function enhanceStorytelling({ title, draftLines, signal }) {
        checkCooldown('rewriteStory', API_POLICY.REWRITE_COOLDOWN_MS);

        const prompt = `Bạn là biên kịch triệu view chuyên viết lời bình (voice-over) cho Facebook Reels đời sống tại Việt Nam.
Hãy viết lại kịch bản sau thành đúng 5 đoạn lời thoại tiếng Việt thật tự nhiên, cuốn hút, giàu cảm xúc, có nhịp điệu, không dùng từ ngữ chỉ đạo quay phim khô khan (tuyệt đối KHÔNG viết "Quay cận cảnh...", "Hiển thị hình ảnh...").
Tiêu đề: "${title}"
Ý tưởng gốc:
${draftLines.join('\n')}

Yêu cầu từng phần (mỗi phần dài khoảng 20-32 từ để đọc truyền cảm, đủ ý, không bị cụt):
- Phần 1 (Hook 3s đầu): Câu mở đầu đánh thẳng vào tò mò, nỗi đau chung hoặc sự thật bất ngờ khiến người xem phải dừng lướt ngay.
- Phần 2 (Bối cảnh / Cao trào): Kể tình huống thực tế ai cũng từng gặp, tạo sự đồng cảm sâu sắc.
- Phần 3 (Giải pháp / Bước ngoặt 1): Bật mí cách làm hoặc diễn biến thú vị đầu tiên với giọng điệu hào hứng, gần gũi.
- Phần 4 (Chi tiết đắt giá 2): Chia sẻ bí quyết cốt lõi hoặc chi tiết bất ngờ tạo giá trị thực tế cho người xem.
- Phần 5 (Kết quả & Kêu gọi Follow): Chốt lại cảm xúc trọn vẹn và kêu gọi bình luận/Follow thật tự nhiên.`;

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

        return dedupedCall(`rewrite:${hashString(title + draftLines.join('|'))}`, async () => {
            const result = await fetchGeminiWithRetry(MODELS.TEXT, payload, { signal });
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

                const result = await fetchGeminiWithRetry(MODELS.TEXT, payload, { signal });
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

    async function fetchSceneTtsPcm({ text, voiceName, signal }) {
        const cleanText = String(text || '').trim();
        const voice = voiceName || 'Aoede';
        const cacheKey = `tts:${voice}:${hashString(cleanText)}`;

        if (caches.ttsPcm.has(cacheKey)) {
            return { buffer: caches.ttsPcm.get(cacheKey), fromCache: true, rateLimited: false };
        }

        return dedupedCall(cacheKey, async () => {
            try {
                const payload = {
                    contents: [
                        {
                            parts: [
                                {
                                    text: `Hãy đọc bằng giọng tiếng Việt nhịp độ nhanh, năng lượng cao, nhấn nhá cuốn hút và dứt khoát như một vlogger/reviewer triệu view đang chia sẻ bí quyết hay (không đọc chậm rãi buồn ngủ): ${cleanText}`
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
        fetchSceneTtsPcm,
        fetchCombinedTtsPcm,
        fetchSceneImageDataUrl,
        clearMediaCaches
    };
})(window);
