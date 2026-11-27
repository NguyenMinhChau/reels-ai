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

    const CREATIVE_DOMAINS = [
        'Drama công sở: sếp giao việc sát giờ tan tầm, đồng nghiệp thảo mai, tin nhắn lúc 10h đêm, họp dài không hồi kết, xin tăng lương',
        'Ngành IT & Lập trình: bug production tối thứ 6, PM đổi requirement phút chót, "chỉ sửa 1 dòng code thôi mà", OT fix server',
        'Ngành Marketing & Content: chạy Ads đốt tiền không ra đơn, khách chê đắt đòi KPI X10, sếp bắt trend muộn 3 tuần, viết 10 bản sửa chọn bản 1',
        'Ngành Sale & Kinh doanh: khách hẹn mai chốt rồi mất tích, nghệ thuật xử lý từ chối trong 5 giây, chạy số cuối tháng, giữ chân khách cũ',
        'Tài chính cá nhân & Tiền bạc: lương 15tr vẫn hết tiền cuối tháng, cái bẫy trả góp 0%, quỹ dự phòng 3 tháng, lạm phát ngầm khi đi siêu thị',
        'Kinh doanh tự do, Freelancer & Chủ shop: khách bom hàng, làm việc quán cafe 4 tiếng thực hư ra sao, cân bằng dòng tiền khi mới mở quán',
        'Nhân sự, Kế toán & Văn phòng: câu chuyện phỏng vấn xin việc, KPI đánh giá cuối năm, hóa đơn chứng từ sát deadline, văn hóa giữ người',
        'Tâm lý học hành vi & Giao tiếp: hiệu ứng tâm lý khi nói chuyện, cách từ chối khéo không mất lòng, đọc vị người đối diện, vượt qua trì hoãn',
        'Cảnh báo an toàn đời sống & Công nghệ: chiêu lừa đảo OTP/link lạ mới, an toàn ổ điện cháy nổ, bảo mật tài khoản ngân hàng & Facebook',
        'Nhắc nhở thói quen tốt, Sức khỏe & Giấc ngủ: uống nước, giãn cơ văn phòng, ngủ sâu giấc ban đêm, cai nghiện lướt điện thoại sáng sớm',
        'Chủ đề Nhạc Chill, Lo-Fi & Chữa lành: playlist làm việc tập trung, âm thanh giảm stress sau giờ làm, tâm sự tuổi 25–30',
        'Mẹo vặt đời thường, Nhà bếp, Dọn nhà & Tiết kiệm chi phí hằng ngày'
    ];

    const CREATIVE_ANGLES = [
        'Sự thật phũ phàng ít ai dám nói thẳng (POV người trong cuộc)',
        'Sai lầm 90% người mới vào nghề hoặc người đi làm hay mắc phải',
        'Kịch bản tình huống đối đáp cực gắt / xử lý thông minh trong 1 câu nói',
        'So sánh giữa kỳ vọng màu hồng vs thực tế phũ phàng (gây đồng cảm mạnh)',
        'Bóc tách con số tiền bạc / thời gian mất đi mà không ai nhận ra',
        'Danh sách Top 3 dấu hiệu cảnh báo sớm ai nghe xong cũng phải giật mình'
    ];

    const TONE_GUIDES = {
        viral: 'Phong cách TRIỆU VIEW BẮT TREND: Hook cực gắt dưới 15 từ đánh thẳng vào sai lầm/bí mật/con số sốc; văn nói đời thường gãy gọn ("Khoan đã...", "Nghe vô lý nhưng...", "90% người làm sai..."); có bước ngoặt bất ngờ ở cảnh cuối; CTA đặt câu hỏi kích thích bình luận tranh luận nhẹ.',
        funny: 'Phong cách HÀI XÉO XẮT / GEN Z: Tự trào, lầy lội, hơi phũ nhưng đúng tim đen; câu ngắn tung hứng duyên dáng kiểu nói chuyện với bạn thân; CTA rủ bạn bè vào điểm danh hoặc tag nhau.',
        drama: 'Phong cách CẢNH BÁO / KỊCH TÍNH: Mở đầu khẩn cấp gây chú ý ngay ("Dừng lại 3 giây nếu bạn đang..."); chỉ rõ rủi ro mất tiền/hại sự nghiệp/hại sức khỏe; giải pháp dứt khoát; CTA nhắc gửi ngay cho đồng nghiệp hoặc người thân.',
        healing: 'Phong cách TÂM SỰ / CHỮA LÀNH: Thủ thỉ gần gũi, chạm đúng nỗi lòng người đi làm/người trẻ; hình ảnh đời thường ấm áp; CTA tạo cảm giác được lắng nghe và muốn lưu lại.'
    };

    async function dumpFreshScripts({ existingTitles, category, categoryLabel, customTopic = '', tone = 'viral', count = 5, signal }) {
        return dedupedCall(`dumpScripts:${category}:${hashString(customTopic)}`, async () => {
            checkCooldown('dumpScripts', API_POLICY.DUMP_COOLDOWN_MS);

            const targetCount = Math.max(3, Math.min(6, parseInt(count, 10) || 5));
            const pickedDomains = [...CREATIVE_DOMAINS]
                .sort(() => Math.random() - 0.5)
                .slice(0, 4)
                .join(' | ');
            const pickedAngles = [...CREATIVE_ANGLES]
                .sort(() => Math.random() - 0.5)
                .slice(0, 3)
                .join('; ');

            const toneRule = TONE_GUIDES[tone] || TONE_GUIDES.viral;
            const cleanCustom = String(customTopic || '').trim();

            const categoryContext = cleanCustom
                ? `CHỦ ĐỀ TRỌNG TÂM DO NGƯỜI DÙNG YÊU CẦU: "${cleanCustom}". Hãy khai thác ${targetCount} góc nhìn hoàn toàn khác nhau xoay quanh chủ đề này (${pickedAngles}).`
                : category !== 'all'
                    ? `Tập trung khai thác sâu và mới lạ trong ngách "${categoryLabel || category}", kết hợp các góc tiếp cận: (${pickedAngles}).`
                    : `Hãy chọn ngẫu nhiên các ngách đa dạng từ những lĩnh vực đời sống & nghề nghiệp sau để KHÔNG BAO GIỜ bị lặp: [${pickedDomains}], kết hợp góc khai thác: (${pickedAngles}).`;

            const prompt = `Bạn là Creative Director chuyên viết kịch bản Facebook Reels / TikTok triệu view tại Việt Nam với nguồn ý tưởng vô tận.
Hãy sáng tạo ĐÚNG ${targetCount} kịch bản Reels hoàn toàn MỚI LẠ, ĐỜI THỰC, ĐỌC LÊN NGHE NHƯ NGƯỜI THẬT KỂ CHUYỆN (tuyệt đối CẤM văn phong sách giáo khoa hay sáo rỗng).
${toneRule}
${categoryContext}
QUY TẮC BẮT BUỘC:
- Tuyệt đối KHÔNG trùng ý tưởng hoặc mô-típ với các tiêu đề đã có: [${existingTitles.slice(0, 80).join('; ')}].
- Hook (3 giây đầu): Tối đa 16 từ, đánh thẳng vào tình huống đời thật, drama nghề nghiệp, sai lầm mất tiền hoặc POV ai cũng từng dính.
- Body: Đúng 5–6 ý ngắn (mỗi ý 12–20 từ, dùng ký tự "• " đầu dòng), nhịp cuốn, có cao trào hoặc bước ngoặt bất ngờ ở cuối.
- CTA: Đặt câu hỏi mở kích thích đồng nghiệp/người cùng ngành/người xem vào bình luận hoặc tag nhau.
- category: Chọn đúng 1 trong 10 giá trị: "office", "career", "finance", "humor", "lifehack", "warning", "reminder", "music", "vlog", "bts".
- duration: Ví dụ "28s", "32s".
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

    async function enhanceStorytelling({ title, draftLines, tone = 'viral', targetCount = 5, signal }) {
        checkCooldown('rewriteStory', API_POLICY.REWRITE_COOLDOWN_MS);

        const count = Math.max(5, Math.min(12, parseInt(targetCount, 10) || 5));
        const toneRule = TONE_GUIDES[tone] || TONE_GUIDES.viral;
        const prompt = `Bạn là biên kịch triệu view chuyên viết lời bình (voice-over) nhiều phân cảnh cho Facebook Reels / TikTok tại Việt Nam.
Hãy viết lại & mở rộng kịch bản sau thành đúng ${count} đoạn lời thoại (từng cảnh ngắn nối tiếp nhau) VĂN NÓI ĐỜI THƯỜNG thật cuốn, có cao trào, nghe như người thật đang kể chuyện cho bạn thân (TUYỆT ĐỐI CẤM giọng văn sách giáo khoa, báo chí hay chỉ đạo quay phim).
${toneRule}

Tiêu đề: "${title}"
Ý tưởng gốc:
${draftLines.join('\n')}

Yêu cầu nghiêm ngặt cho ĐÚNG ${count} cảnh (mỗi cảnh 12–22 từ, ngắn gọn 1–2 câu rõ ràng để đọc và đổi cảnh mượt mà):
- Cảnh 1 (Hook 3 giây đầu): Mở đầu gây tò mò cực mạnh đánh thẳng tâm lý khiến người lướt phải khựng lại.
- Các cảnh giữa (Cảnh 2 đến Cảnh ${count - 1}): Chia nhỏ diễn biến thành từng bước / từng tình huống chi tiết tăng dần cảm xúc, có cú ngoặt bất ngờ ở đoạn 2/3 cuối.
- Cảnh ${count} (Chốt & CTA): Kết luận đắt giá hoặc đặt câu hỏi mở kích thích comment / theo dõi tiếp.`;

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

        return dedupedCall(`rewrite:${tone}:${count}:${hashString(title + draftLines.join('|'))}`, async () => {
            const result = await fetchTextWithFallback(payload, { signal });
            const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || parsed.length < Math.min(count, 4)) {
                throw new ApiError('INVALID_JSON', `AI chưa trả về đủ ${count} phân cảnh lời thoại`);
            }
            return parsed.slice(0, count).map((s) => String(s || '').trim()).filter(Boolean);
        });
    }

    async function generateConnectedSeries({ topic, episodeCount = 5, scenesPerEp = 8, tone = 'viral', signal }) {
        checkCooldown('generateSeries', API_POLICY.DUMP_COOLDOWN_MS);

        const epCount = Math.max(2, Math.min(8, parseInt(episodeCount, 10) || 5));
        const scCount = Math.max(5, Math.min(12, parseInt(scenesPerEp, 10) || 8));
        const toneRule = TONE_GUIDES[tone] || TONE_GUIDES.viral;

        const prompt = `Bạn là Giám đốc Nội dung chuyên xây dựng CHUỖI SERI REELS/TIKTOK NHIỀU TẬP LIÊN HOÀN để khán giả theo dõi ngày này qua ngày khác.
Chủ đề seri: "${topic}"
Số tập cần tạo: ${epCount} tập liên tiếp (Tập 1 → Tập ${epCount}).
Số cảnh lời thoại mỗi tập: đúng ${scCount} cảnh (12–20 từ/cảnh, văn nói tự nhiên cực cuốn).
${toneRule}

QUY TẮC TIẾP NỐI CỐT TRUYỆN BẮT BUỘC:
1. Tập 1 mở màn hấp dẫn và kết thúc bằng 1 câu MÓC CÂU (cliffhanger) dẫn sang Tập 2.
2. Từ Tập 2 trở đi, Cảnh 1 (hook) PHẢI nhắc khéo lại diễn biến tập trước ("Tiếp nối tập trước...", "Sau chuyện hôm qua...", "Đoán xem điều gì xảy ra tiếp...") rồi đi sâu vào diễn biến mới, KHÔNG kể lại nội dung đã nói ở tập trước.
3. Mỗi tập có "scenes" gồm đúng ${scCount} câu lời thoại chi tiết từng bước rõ ràng.
4. "cliffhanger": Tóm tắt ngắn 1 câu điều còn bỏ ngỏ để làm cầu nối viết tiếp tập sau nữa.
5. "hashtags": 4–5 hashtag tiếng Việt không dấu phù hợp seri.`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        seriesTitle: { type: 'STRING' },
                        episodes: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    episodeNumber: { type: 'INTEGER' },
                                    title: { type: 'STRING' },
                                    hook: { type: 'STRING' },
                                    scenes: { type: 'ARRAY', items: { type: 'STRING' } },
                                    cta: { type: 'STRING' },
                                    cliffhanger: { type: 'STRING' },
                                    hashtags: { type: 'STRING' }
                                },
                                required: ['episodeNumber', 'title', 'hook', 'scenes', 'cta', 'cliffhanger', 'hashtags']
                            }
                        }
                    },
                    required: ['seriesTitle', 'episodes']
                }
            }
        };

        return dedupedCall(`series:${tone}:${epCount}:${scCount}:${hashString(topic)}`, async () => {
            const result = await fetchTextWithFallback(payload, { signal });
            const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.episodes) || parsed.episodes.length === 0) {
                throw new ApiError('INVALID_JSON', 'AI chưa trả về đúng cấu trúc chuỗi Seri');
            }
            return {
                seriesTitle: String(parsed.seriesTitle || topic).trim(),
                episodes: parsed.episodes.slice(0, epCount).map((ep, idx) => ({
                    episodeNumber: Number(ep.episodeNumber) || idx + 1,
                    title: String(ep.title || `Tập ${idx + 1}: ${topic}`).trim(),
                    hook: String(ep.hook || '').trim(),
                    scenes: Array.isArray(ep.scenes) ? ep.scenes.map((s) => String(s || '').trim()).filter(Boolean) : [],
                    cta: String(ep.cta || '').trim(),
                    cliffhanger: String(ep.cliffhanger || '').trim(),
                    hashtags: String(ep.hashtags || '#seri #reelsvn').trim()
                }))
            };
        });
    }

    async function generateNextSeriesEpisode({ seriesTitle, previousEpisodes, scenesPerEp = 8, tone = 'viral', signal }) {
        checkCooldown('nextEpisode', API_POLICY.REWRITE_COOLDOWN_MS);

        const nextEpNum = previousEpisodes.length + 1;
        const scCount = Math.max(5, Math.min(12, parseInt(scenesPerEp, 10) || 8));
        const toneRule = TONE_GUIDES[tone] || TONE_GUIDES.viral;
        const historySummary = previousEpisodes
            .map((ep, i) => `Tập ${ep.episodeNumber || i + 1} (${ep.title}): Hook="${ep.hook}" | Móc câu="${ep.cliffhanger || ep.cta}"`)
            .join('\n');

        const prompt = `Bạn đang viết tiếp TẬP ${nextEpNum} cho chuỗi Seri "${seriesTitle}".
Tóm tắt các tập đã có trước đó:
${historySummary}

Hãy sáng tạo Tập ${nextEpNum} nối tiếp liền mạch với các tập trên (không lặp lại ý cũ, phải giải quyết móc câu tập ${nextEpNum - 1} và mở ra móc câu mới cho Tập ${nextEpNum + 1}).
${toneRule}
Trả về đúng 1 JSON object có:
- episodeNumber: ${nextEpNum}
- title: Tiêu đề Tập ${nextEpNum} hấp dẫn
- hook: Câu mở đầu 3s nối tiếp trực tiếp từ tập trước
- scenes: Mảng đúng ${scCount} câu lời thoại chi tiết (12–20 từ/cảnh)
- cta: Lời kết + hẹn xem Tập ${nextEpNum + 1}
- cliffhanger: Tóm tắt ngắn điểm mở cho tập tiếp theo nữa
- hashtags: 4–5 hashtag tiếng Việt.`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        episodeNumber: { type: 'INTEGER' },
                        title: { type: 'STRING' },
                        hook: { type: 'STRING' },
                        scenes: { type: 'ARRAY', items: { type: 'STRING' } },
                        cta: { type: 'STRING' },
                        cliffhanger: { type: 'STRING' },
                        hashtags: { type: 'STRING' }
                    },
                    required: ['episodeNumber', 'title', 'hook', 'scenes', 'cta', 'cliffhanger', 'hashtags']
                }
            }
        };

        return dedupedCall(`next-ep:${nextEpNum}:${hashString(seriesTitle + historySummary)}`, async () => {
            const result = await fetchTextWithFallback(payload, { signal });
            const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            const ep = JSON.parse(raw);
            if (!ep || !ep.title) throw new ApiError('INVALID_JSON', 'Không nhận được tập tiếp theo từ AI');
            return {
                episodeNumber: Number(ep.episodeNumber) || nextEpNum,
                title: String(ep.title || `Tập ${nextEpNum}: ${seriesTitle}`).trim(),
                hook: String(ep.hook || '').trim(),
                scenes: Array.isArray(ep.scenes) ? ep.scenes.map((s) => String(s || '').trim()).filter(Boolean) : [],
                cta: String(ep.cta || '').trim(),
                cliffhanger: String(ep.cliffhanger || '').trim(),
                hashtags: String(ep.hashtags || '#seri #reelsvn').trim()
            };
        });
    }

    async function generateRealisticVisualPrompts({ title, sceneTexts, signal }) {
        const cleanTexts = (sceneTexts || []).map((t) => String(t || '').trim()).filter(Boolean);
        const cacheKey = `prompts-v2:${hashString(title + '|' + cleanTexts.join('|'))}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        const fallback = () =>
            cleanTexts.map(
                (t, i) =>
                    `Realistic candid editorial scene in Vietnam depicting specifically: "${t}", natural authentic lighting, vertical 9:16 framing, rich detail, no watermark`
            );

        return dedupedCall(cacheKey, async () => {
            try {
                const prompt = `You are a Viral Reels Visual Director in Vietnam. Given a vertical 9:16 video titled "${title}" and ${cleanTexts.length} Vietnamese narration segments, write ${cleanTexts.length} distinct English image prompts (1 per segment).
CRITICAL RULES:
- Every prompt MUST visually depict the EXACT specific situation, objects, setting, emotion, and action described in its corresponding narration segment!
- Vary camera angles (extreme close-up POV hands, over-the-shoulder desk view, wide atmospheric room, moody night lighting, sunlit cafe, bustling office) so NO two consecutive scenes look repetitive!
- Include authentic Vietnamese daily life / office / street details. Vertical 9:16 framing, crisp clarity, NO random text/watermarks.
Narration segments:
${cleanTexts.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}`;

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
                if (Array.isArray(parsed) && parsed.length >= cleanTexts.length) {
                    const sliced = parsed.slice(0, cleanTexts.length);
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

    function sanitizeAndWrapSvg(rawSvg) {
        let s = String(rawSvg || '')
            .replace(/^```(?:svg|xml)?\s*/i, '')
            .replace(/```$/i, '')
            .trim();
        const match = s.match(/<svg[\s\S]*<\/svg>/i);
        if (!match) return '';
        s = match[0];

        // Strip anything that can execute JS or taint HTML5 <canvas>
        s = s
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
            .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
            .replace(/<image\b[^>]*\/?>/gi, '')
            .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|javascript:)[^"']*["']/gi, '')
            .replace(/url\(\s*["']?\s*(?:https?:|javascript:)[^)]*\)/gi, 'none');

        // Escape bare ampersands so SVG XML never fails to parse
        s = s.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

        if (!/\bxmlns=/.test(s)) {
            s = s.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        if (!/\bviewBox=/.test(s)) {
            s = s.replace(/^<svg\b/i, '<svg viewBox="0 0 540 960"');
        }
        if (!/\bwidth=/.test(s)) {
            s = s.replace(/^<svg\b/i, '<svg width="540" height="960"');
        }
        return s;
    }

    async function generateCustomSceneSvgs({ title, scenes, tone = 'viral', onProgress = null, signal } = {}) {
        const cleanScenes = (scenes || []).map((t) => String(t || '').trim()).filter(Boolean);
        if (cleanScenes.length === 0) return [];

        const results = new Array(cleanScenes.length).fill('');
        const missingIndices = [];
        cleanScenes.forEach((sc, idx) => {
            const key = `svg:${tone}:${hashString(title + '|' + idx + '|' + sc)}`;
            if (caches.images.has(key)) {
                results[idx] = caches.images.get(key);
            } else {
                missingIndices.push(idx);
            }
        });

        if (missingIndices.length === 0) {
            if (onProgress) onProgress(cleanScenes.length, cleanScenes.length);
            return results;
        }

        const BATCH_SIZE = 2;
        let doneCount = cleanScenes.length - missingIndices.length;
        if (onProgress) onProgress(doneCount, cleanScenes.length);

        const palettes = [
            'Warm Cream & Emerald (#fef3c7, #10b981, #1e293b)',
            'Midnight Indigo & Neon Amber (#0f172a, #312e81, #fbbf24)',
            'Soft Sage Mint & Terracotta (#dcfce7, #ea580c, #0f172a)',
            'Sky Blue & Coral Red (#e0f2fe, #e11d48, #1e293b)',
            'Warm Sunset Peach & Deep Purple (#ffedd5, #7c3aed, #1e293b)',
            'Crisp Editorial Slate & Gold (#f1f5f9, #eab308, #0f172a)'
        ];

        for (let b = 0; b < missingIndices.length; b += BATCH_SIZE) {
            if (signal && signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            const chunkIndices = missingIndices.slice(b, b + BATCH_SIZE);
            const sceneSpecs = chunkIndices
                .map((idx) => {
                    const prevHint = idx > 0 ? `(Cảnh trước: "${cleanScenes[idx - 1].slice(0, 60)}")` : '';
                    return `- Cảnh ${idx + 1}/${cleanScenes.length} [Bảng màu gợi ý: ${palettes[idx % palettes.length]}]: "${cleanScenes[idx]}" ${prevHint}`;
                })
                .join('\n');

            const prompt = `Bạn là họa sĩ minh họa Vector 2D chuyên nghiệp (phong cách Editorial Flat Illustration hiện đại, sinh động như video giải thích triệu view).
Tiêu đề video: "${title}" (Phong cách: ${tone}).
Hãy vẽ ${chunkIndices.length} bức tranh SVG ĐỘC BẢN, KHÁC BIỆT HOÀN TOÀN VỀ BỐ CỤC, GÓC MÁY VÀ MÀU SẮC, minh họa CHÍNH XÁC từng chi tiết câu nói dưới đây:
${sceneSpecs}

YÊU CẦU KỸ THUẬT SVG NGHIÊM NGẶT:
1. Mỗi phần tử trả về là 1 chuỗi <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 960" width="540" height="960">...</svg> hợp lệ XML.
2. Vẽ CHI TIẾT & SÁT NGỮ CẢNH: Vẽ đúng bối cảnh (phòng ngủ tối có điện thoại, màn hình code sập server, tô cơm nhà, chai nhựa đựng hành trong ngăn đá, tin nhắn sếp, ví tiền, quầy cafe, biểu đồ sụt giảm...), có chiều sâu (nền gradient, ánh sáng, đổ bóng mềm, nhân vật biểu cảm rõ nét, chữ chú thích ngắn tiếng Việt đặt trong thẻ SVG để làm rõ ý!).
3. MỖI CẢNH PHẢI ĐỔI GÓC MÁY & Ý TƯỞNG: Ví dụ cảnh 1 cận cảnh màn hình điện thoại POV, cảnh 2 toàn cảnh căn phòng, cảnh 3 bảng phân tích so sánh, cảnh 4 nhân vật phản ứng... TUYỆT ĐỐI KHÔNG lặp 1 kiểu hình hộp chung chung!
4. Vùng y từ 690 đến 940 hãy giữ nền gọn/êm mắt để dành chỗ cho phụ đề video hiển thị phía dưới.
5. TUYỆT ĐỐI KHÔNG dùng <image>, <foreignObject>, <script>, URL ngoài hay CSS phức tạp; mọi ký tự "&" trong chữ phải viết là "&amp;".`;

            try {
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
                const res = await fetchTextWithFallback(payload, { signal });
                const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
                const parsed = JSON.parse(raw);
                const svgList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.svgs) ? parsed.svgs : null;
                if (Array.isArray(svgList)) {
                    chunkIndices.forEach((sceneIdx, pos) => {
                        const clean = sanitizeAndWrapSvg(svgList[pos]);
                        if (clean) {
                            const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
                            results[sceneIdx] = dataUrl;
                            const key = `svg:${tone}:${hashString(title + '|' + sceneIdx + '|' + cleanScenes[sceneIdx])}`;
                            caches.images.set(key, dataUrl);
                        }
                    });
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                console.warn('Batch SVG generation fallback:', err.message);
            }

            doneCount += chunkIndices.length;
            if (onProgress) onProgress(doneCount, cleanScenes.length);
        }

        return results;
    }

    async function generateMultiBeatStoryboard({ title, beatTexts, layouts, backdrops, props, signal }) {
        const cleanBeats = (beatTexts || []).map((b) => String(b || '').trim()).filter(Boolean);
        if (cleanBeats.length === 0) return null;

        const cacheKey = `storyboard-v2:${hashString(title + '|' + cleanBeats.join('|'))}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        const layoutList = Array.isArray(layouts) && layouts.length > 0 ? layouts : ['center-hero', 'character-left', 'split-compare', 'multi-trio', 'thought-bubble', 'document-card', 'action-flow'];
        const backdropList = Array.isArray(backdrops) && backdrops.length > 0 ? backdrops : ['cream-room', 'hills-nature', 'city-skyline', 'sunset-warm', 'mint-fresh', 'night-calm', 'alert-tint'];
        const propList = Array.isArray(props) && props.length > 0 ? props : ['house', 'envelope', 'jar', 'phone', 'lightbulb', 'clock', 'water_glass', 'plug_socket'];

        return dedupedCall(cacheKey, async () => {
            try {
                const numberedBeats = cleanBeats.map((b, i) => `${i + 1}. "${b}"`).join('\n');
                const prompt = `Bạn là Đạo diễn Đồ họa Chuyển động 2D (Motion Infographic) cho Reels/TikTok giống phong cách minh họa phẳng từng ý rất cuốn hút.
Tiêu đề: "${title}"
Danh sách ${cleanBeats.length} nhịp lời thoại theo thứ tự:
${numberedBeats}

Thiết kế ĐÚNG ${cleanBeats.length} cảnh (mỗi nhịp 1 cảnh) sao cho BỐ CỤC, MÀU SẮC NỀN và ĐẠO CỤ minh họa khớp chính xác từng câu chữ đang nói và TUYỆT ĐỐI KHÔNG lặp lại:
- layout: Chọn từ [${layoutList.join(', ')}]:
  * center-hero: 1 vật thể chính to giữa màn hình
  * character-left: nhân vật nói chuyện bên trái + vật thể lớn bên phải
  * split-compare: so sánh 2 vế trái/phải (trước-sau, đúng-sai, rẻ-đắt)
  * multi-trio: 3 vật thể nhỏ xếp hàng ngang có thẻ giá/nhãn chỉ xuống
  * thought-bubble: nhân vật suy nghĩ nhìn lên bóng mây ý tưởng
  * document-card: tờ bảng/hóa đơn/danh sách tick từng dòng
  * action-flow: mũi tên biến đổi từ trái sang phải
  (BẮT BUỘC thay đổi layout liên tục giữa các cảnh liền kề!)
- backdrop: Chọn bối cảnh màu từ [${backdropList.join(', ')}] phù hợp hoàn cảnh (hills-nature cho quê/thiên nhiên, city-skyline cho thành phố/công ty, night-calm cho đêm/ngủ/chill, alert-tint cho cảnh báo/nguy hiểm, mint-fresh cho sức khỏe/tiền bạc, sunset-warm/cream-room cho đời thường). KHÔNG trùng backdrop ở 2 cảnh liền kề!
- props: Mảng gồm 1 đến 3 đạo cụ chọn từ [${propList.join(', ')}] ghép đúng với từng ý câu nói (không lặp prop chính ở cảnh kế).
- characterMood: "happy", "shocked", "thinking", hoặc "none".
- topBadge: Nhãn ngắn 1–3 từ VIẾT HOA góc trên (hoặc rỗng "").
- items: Mảng gồm 1–3 nhãn ngắn (2–4 từ VIẾT HOA) gắn trực tiếp lên từng vật thể/dòng liệt kê (VD: ["NHÀ", "CƠM", "XE"] hoặc ["PHÒNG: 3,5 TR", "ĐIỆN NƯỚC: 600K", "ĂN: 4 TR"]).
- accentBadge: Con số hoặc điểm nhấn nổi bật ("X2", "+7 TRIỆU", "NGUY HIỂM", "CHÚ Ý!" hoặc "").
- crossOut: true nếu câu nói mang ý gạch bỏ / sai lầm / cấm làm, ngược lại false.`;

                const payload = {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    layout: { type: 'STRING', enum: layoutList },
                                    backdrop: { type: 'STRING', enum: backdropList },
                                    props: { type: 'ARRAY', items: { type: 'STRING', enum: propList } },
                                    characterMood: { type: 'STRING', enum: ['happy', 'shocked', 'thinking', 'none'] },
                                    topBadge: { type: 'STRING' },
                                    items: { type: 'ARRAY', items: { type: 'STRING' } },
                                    accentBadge: { type: 'STRING' },
                                    crossOut: { type: 'BOOLEAN' }
                                },
                                required: ['layout', 'backdrop', 'props', 'characterMood', 'topBadge', 'items', 'accentBadge', 'crossOut']
                            }
                        }
                    }
                };

                const result = await fetchTextWithFallback(payload, { signal });
                const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text;
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length >= cleanBeats.length) {
                    const normalized = parsed.slice(0, cleanBeats.length).map((item) => ({
                        layout: layoutList.includes(item.layout) ? item.layout : '',
                        backdrop: backdropList.includes(item.backdrop) ? item.backdrop : '',
                        props: Array.isArray(item.props) ? item.props.filter((p) => propList.includes(p)).slice(0, 3) : [],
                        characterMood: ['happy', 'shocked', 'thinking', 'none'].includes(item.characterMood) ? item.characterMood : 'happy',
                        topBadge: String(item.topBadge || '').trim().slice(0, 22),
                        items: Array.isArray(item.items) ? item.items.map((x) => String(x || '').trim().slice(0, 24)).filter(Boolean).slice(0, 3) : [],
                        accentBadge: String(item.accentBadge || '').trim().slice(0, 20),
                        crossOut: Boolean(item.crossOut)
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
            let awaitingTurn = false;
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
                awaitingTurn = true;

                if (turnTimer) clearTimeout(turnTimer);
                turnTimer = setTimeout(() => {
                    awaitingTurn = false;
                    if (results.some(Boolean)) {
                        settled = true;
                        cleanup();
                        resolve({ buffers: results, errorReason: `Cảnh ${sceneIdx + 1} quá thời gian chờ.` });
                        return;
                    }
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
                                            text: `[Cảnh ${sceneIdx + 1}] Chỉ đọc nguyên văn đúng 1 lần câu sau:\n${cleanTexts[sceneIdx]}`
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
            }, 15000);

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
                                        text: `Bạn là MỘT diễn viên lồng tiếng Việt duy nhất xuyên suốt toàn bộ video (mã giọng: ${voice}). BẮT BUỘC giữ NGUYÊN MỘT CHẤT GIỌNG, CAO ĐỘ VÀ ÂM LƯỢNG ĐỒNG NHẤT từ cảnh đầu đến cảnh cuối — TUYỆT ĐỐI KHÔNG đổi giọng sang người khác hay thêm lời thoại thừa. Khi nhận được câu nào, chỉ đọc chính xác nguyên văn đúng 1 lần, không lặp lại câu cũ, không chào hỏi, không bình luận.`
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

                if (!awaitingTurn) return;

                const sc = msg.serverContent;
                if (sc?.modelTurn?.parts) {
                    for (const part of sc.modelTurn.parts) {
                        if (part.inlineData?.data) {
                            const buf = base64ToArrayBuffer(part.inlineData.data);
                            turnChunks.push(new Uint8Array(buf));
                        }
                    }
                }

                const turnDone = Boolean(sc?.turnComplete) || (msg.interactionStatus === 'IDLE' && turnChunks.length > 0);
                if (turnDone) {
                    awaitingTurn = false;
                    if (turnTimer) {
                        clearTimeout(turnTimer);
                        turnTimer = null;
                    }
                    const sceneIdx = missingIndices[queuePos];
                    if (turnChunks.length > 0) {
                        const combined = concatUint8Arrays(turnChunks);
                        turnChunks = [];
                        if (combined.byteLength >= 2400) {
                            const cacheKey = `live:${liveModel}:${voice}:${hashString(cleanTexts[sceneIdx])}`;
                            caches.ttsPcm.set(cacheKey, combined);
                            results[sceneIdx] = combined;
                            if (onSceneDone) onSceneDone(sceneIdx, combined, false);
                        }
                    }
                    queuePos++;
                    sendNextScene();
                }
            };

            ws.onerror = () => {
                clearTimeout(setupTimer);
                if (results.some(Boolean)) {
                    if (!settled) {
                        settled = true;
                        cleanup();
                        resolve({ buffers: results, errorReason: `Kết nối Live API bị gián đoạn (${liveModel}).` });
                    }
                    return;
                }
                finishWithError(new ApiError('WS_ERROR', `Lỗi kết nối Live API (${liveModel}).`));
            };

            ws.onclose = (ev) => {
                clearTimeout(setupTimer);
                if (!settled) {
                    if (results.some(Boolean) && queuePos < missingIndices.length) {
                        settled = true;
                        cleanup();
                        resolve({ buffers: results, errorReason: ev.reason || 'Kết nối Live API bị ngắt giữa chừng.' });
                    } else if (!setupDone) {
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

    function buildLocalSocialCaption({ title = '', scenes = [], existingHashtags = '' } = {}) {
        const cleanTitle = String(title || '').trim();
        const cleanScenes = (Array.isArray(scenes) ? scenes : [])
            .map((s) => String(s || '').trim())
            .filter(Boolean);
        const firstLine = cleanScenes[0] || cleanTitle || 'Góc nhìn thực tế ít ai nói tới!';
        const lastLine =
            cleanScenes.length > 1
                ? cleanScenes[cleanScenes.length - 1]
                : 'Bạn nghĩ sao về điều này? Chia sẻ góc nhìn bên dưới nhé!';

        let tags = String(existingHashtags || '').trim();
        if (!tags) {
            const hay = `${cleanTitle} ${cleanScenes.join(' ')}`.toLowerCase();
            const picked = new Set(['#reelsvn', '#xuhuong', '#chiase']);
            if (/công sở|sếp|deadline|đồng nghiệp|tan tầm|văn phòng|lương/.test(hay)) {
                picked.add('#congsovietnam');
                picked.add('#dramacongso');
                picked.add('#dilam');
            }
            if (/code|bug|server|it|dev|lập trình|pm/.test(hay)) {
                picked.add('#devvietnam');
                picked.add('#danit');
                picked.add('#congnghe');
            }
            if (/marketing|ads|content|chạy quảng cáo|trend|kpi/.test(hay)) {
                picked.add('#marketingvietnam');
                picked.add('#contentcreator');
            }
            if (/sale|khách|chốt đơn|bán hàng|từ chối/.test(hay)) {
                picked.add('#kynangbanhang');
                picked.add('#kinhdoanh');
            }
            if (/tiền|tài chính|lương|tiết kiệm|chi tiêu|trả góp|nợ/.test(hay)) {
                picked.add('#taichinhcanhan');
                picked.add('#tietkiem');
            }
            if (/bếp|nấu|hành|tủ lạnh|nhà|mẹo/.test(hay)) {
                picked.add('#meohaydoisong');
                picked.add('#meovat');
            }
            tags = Array.from(picked).slice(0, 7).join(' ');
        }

        const caption = [
            cleanTitle ? `🎬 ${cleanTitle}` : '',
            firstLine,
            `💬 ${lastLine}`
        ]
            .filter(Boolean)
            .join('\n\n');

        return {
            caption,
            hashtags: tags,
            fullPost: `${caption}\n\n${tags}`.trim()
        };
    }

    async function generateSocialCaption({
        title = '',
        scenes = [],
        tone = 'viral',
        existingHashtags = '',
        forceRefresh = false,
        signal
    } = {}) {
        const cleanTitle = String(title || '').trim();
        const cleanScenes = (Array.isArray(scenes) ? scenes : [])
            .map((s) => String(s || '').trim())
            .filter(Boolean);
        const fallback = buildLocalSocialCaption({ title: cleanTitle, scenes: cleanScenes, existingHashtags });
        if (!getApiKey()) return fallback;

        const cacheKey = `social-cap:${tone}:${hashString(cleanTitle + '|' + cleanScenes.join('|'))}`;
        if (!forceRefresh && caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        const toneRule = TONE_GUIDES[tone] || TONE_GUIDES.viral;
        const prompt = `Bạn là chuyên gia Social Media Manager chuyên tối ưu Caption & Hashtag cho Facebook Reels, TikTok và YouTube Shorts tại Việt Nam.
Dựa vào video dưới đây, hãy viết 1 bài đăng hoàn chỉnh để người dùng copy dán đăng ngay:
- Tiêu đề video: "${cleanTitle || 'Chia sẻ thực tế'}"
- Tóm tắt lời thoại các cảnh:
${cleanScenes.map((s, i) => `${i + 1}. ${s}`).join('\n')}
- Phong cách: ${toneRule}

YÊU CẦU ĐẦU RA:
1. "caption": Đúng 2–4 đoạn ngắn dễ đọc trên điện thoại:
   - Dòng 1: Câu mở cực hút / đánh đúng tim đen + 1-2 emoji phù hợp.
   - Dòng 2: Điểm nhấn giá trị hoặc câu chuyện trong video (ngắn gọn, KHÔNG tiết lộ hết đoạn kết để người xem xem hết video).
   - Dòng 3: Câu hỏi CTA ngắn kích thích người xem bình luận, tag bạn bè hoặc lưu video.
2. "hashtags": 6–8 hashtag tiếng Việt KHÔNG DẤU gắn sát đúng ngành/chủ đề video + hashtag khám phá (ví dụ: #reelsvn #xuhuong ...), cách nhau bằng dấu cách.`;

        try {
            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            caption: { type: 'STRING' },
                            hashtags: { type: 'STRING' }
                        },
                        required: ['caption', 'hashtags']
                    }
                }
            };
            const res = await fetchTextWithFallback(payload, { signal });
            const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = JSON.parse(raw);
            if (parsed?.caption && parsed?.hashtags) {
                const normalizedTags = String(parsed.hashtags)
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((t) => (t.startsWith('#') ? t : `#${t}`))
                    .join(' ');
                const caption = String(parsed.caption).trim();
                const result = {
                    caption,
                    hashtags: normalizedTags,
                    fullPost: `${caption}\n\n${normalizedTags}`.trim()
                };
                caches.prompts.set(cacheKey, result);
                return result;
            }
        } catch (err) {
            if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
            console.warn('Social caption fallback:', err.message);
        }
        return fallback;
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
        generateConnectedSeries,
        generateNextSeriesEpisode,
        generateRealisticVisualPrompts,
        generateCustomSceneSvgs,
        generateMultiBeatStoryboard,
        buildLocalSocialCaption,
        generateSocialCaption,
        fetchSceneTtsPcm,
        fetchCombinedTtsPcm,
        fetchBatchLiveTtsPcm,
        fetchSceneImageDataUrl,
        clearMediaCaches
    };
})(window);
