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
        if (!apiKey) {
            throw new ApiError('INVALID_API_KEY', 'Bạn chưa nhập Gemini API Key Free. Hãy bấm "Cài API Key" để dán key miễn phí.');
        }
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
        viral: 'Phong cách TRIỆU VIEW BẮT TREND: Hook cực gắt dưới 15 từ đánh thẳng vào sai lầm/bí mật/tình huống thực tế; văn nói đời thường gãy gọn ("Khoan đã...", "Nghe vô lý nhưng..."); có bước ngoặt bất ngờ ở cảnh cuối; CTA đặt câu hỏi kích thích bình luận.',
        funny: 'Phong cách HÀI XÉO XẮT / GEN Z: Tự trào, lầy lội, duyên dáng nhưng văn minh; câu ngắn tung hứng với bạn thân; CTA rủ bạn bè vào điểm danh.',
        drama: 'Phong cách CẢNH BÁO / KỊCH TÍNH: Mở đầu khẩn cấp gây chú ý ("Dừng lại 3 giây nếu bạn đang..."); chỉ rõ rủi ro mất tiền/sức khỏe có căn cứ thực tế; giải pháp an toàn; CTA nhắc người thân lưu ý.',
        healing: 'Phong cách TÂM SỰ / CHỮA LÀNH: Thủ thỉ gần gũi, chạm đúng nỗi lòng người đi làm/người trẻ; hình ảnh đời thường ấm áp; CTA tạo cảm giác được lắng nghe.'
    };

    const CREATOR_ETHICS_AND_POLICY_RULE = `NGUYÊN TẮC CREATOR CHUYÊN NGHIỆP (BẮT BUỘC TUÂN THỦ):
- CHỐNG TIN GIẢ & SAI SỰ THẬT: Tuyệt đối KHÔNG tự bịa số liệu thống kê, tỷ lệ phần trăm giả ("98,7% chuyên gia...", "Đại học X vừa công bố...") hay trích dẫn nghiên cứu không có thật; nếu chia sẻ mẹo/kinh nghiệm, diễn đạt trung thực ("nhiều người thường gặp", "một thói quen hữu ích", "theo kinh nghiệm thực tế").
- TUÂN THỦ CHÍNH SÁCH FACEBOOK REELS / TIKTOK / YOUTUBE SHORTS: Tuyệt đối KHÔNG cam kết chữa bệnh 100%, KHÔNG hứa làm giàu phi thực tế ("lãi 100%, không rủi ro"), KHÔNG kích động thù ghét/bạo lực, KHÔNG dụ tương tác spam ("tag 5 người nhận quà", "không follow sẽ xui").`;

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
${CREATOR_ETHICS_AND_POLICY_RULE}
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
${CREATOR_ETHICS_AND_POLICY_RULE}

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

    async function generateCartoonVisualPrompts({ title, beatTexts, storyboard, signal }) {
        const cleanTexts = (beatTexts || []).map((t) => String(t || '').trim()).filter(Boolean);
        if (cleanTexts.length === 0) return [];
        const cacheKey = `cartoon-prompts-v1:${hashString(title + '|' + cleanTexts.join('|'))}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        const fallback = () =>
            cleanTexts.map(
                (t, i) =>
                    `Flat 2D cel-shaded vector cartoon illustration, crisp #1e293b ink outlines, warm modern pastel & indigo palette, vertical 9:16 composition depicting literally: "${t}", expressive character pose and props, NO text, NO letters, NO speech bubbles`
            );

        return dedupedCall(cacheKey, async () => {
            try {
                const specs = cleanTexts
                    .map((s, idx) => {
                        const sb = Array.isArray(storyboard) ? storyboard[idx] : null;
                        const hint = sb?.visualSubject ? ` (Scene focus: ${sb.visualSubject}, angle: ${sb.layout || 'medium shot'})` : '';
                        return `${idx + 1}. "${s}"${hint}`;
                    })
                    .join('\n');

                const prompt = `You are a 2D Cel-Shaded Animation Art Director creating prompts for Imagen / Nano Banana 2D cartoon frames (9:16 vertical Reels).
Video title: "${title}"
Maintain consistent lead character styling across all frames (friendly modern young Vietnamese creator/office character, crisp clean #1e293b ink linework, flat cel-shading with soft highlights, cozy/modern palette matching clean 2D animated explainer videos).
Write ${cleanTexts.length} English image prompts (1 per spoken line) following these strict rules:
- EVERY frame MUST visually illustrate the EXACT object, action, posture, and emotion mentioned in that specific Vietnamese spoken line (vary camera framing: wide team room, over-the-shoulder dual monitors, medium close-up, POV hands holding object, split comparison).
- Pure 2D flat cel-shaded cartoon illustration style — clean lines, vibrant readable silhouettes.
- STRICTLY ZERO text, ZERO words, ZERO subtitles, ZERO speech bubble letters, ZERO watermarks inside the image.
Spoken lines:
${specs}`;

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
                console.warn('Cartoon visual prompt fallback used:', err.message);
            }
            return fallback();
        });
    }

    async function dumpContentTo2DScenes({ rawContent, titleHint = '', mode = 'preserve', visualStyle = 'motion', layouts, backdrops, props, actions, effects, casts, sfxList, screenTypes, signal } = {}) {
        const cleanRaw = String(rawContent || '').trim();
        if (!cleanRaw) {
            throw new ApiError('EMPTY_CONTENT', 'Vui lòng dán nội dung có sẵn trước khi tách cảnh.');
        }

        const offlineFallback = () => {
            const lines = cleanRaw
                .split(/\n+/)
                .map((l) => l.trim())
                .filter(Boolean);
            const beats = [];
            lines.forEach((line) => {
                const sub = typeof App.utils?.splitTextIntoVisualBeats === 'function'
                    ? App.utils.splitTextIntoVisualBeats(line, 3)
                    : [line];
                sub.forEach((s) => {
                    if (s && beats.length < 16) beats.push(s);
                });
            });
            const finalBeats = beats.length >= 2 ? beats : [cleanRaw, 'Áp dụng ngay hôm nay để thấy sự khác biệt nhé!'];
            return {
                title: titleHint || (finalBeats[0] || '').slice(0, 48),
                scenes: finalBeats.slice(0, 16),
                storyboard: null
            };
        };

        if (!getApiKey()) {
            return offlineFallback();
        }

        const layoutList = Array.isArray(layouts) && layouts.length > 0
            ? layouts
            : ['wide-team', 'desk-closeup', 'two-shot-dialogue', 'back-monitors', 'hand-viewfinder', 'hand-pov', 'screen-pointer', 'laptop-popup', 'character-action', 'character-left', 'split-compare', 'multi-trio', 'thought-bubble', 'document-card', 'action-flow', 'center-hero', 'ui-window', 'ui-checklist', 'ui-flow', 'ui-grid-hero'];
        const backdropList = Array.isArray(backdrops) && backdrops.length > 0
            ? backdrops
            : ['studio-focus', 'office-shelf', 'office-desk', 'work-late', 'gym-fresh', 'bank-vault', 'home-living', 'street-rain', 'warning-stage', 'bedroom-night', 'kitchen-cozy', 'cafe-chill', 'server-tech', 'cream-room', 'hills-nature', 'city-skyline', 'sunset-warm', 'mint-fresh', 'night-calm', 'alert-tint', 'grid-light', 'blueprint-dark'];
        const propList = Array.isArray(props) && props.length > 0
            ? props
            : ['ergo_chair', 'spine_back', 'empty_wallet', 'stretching_pose', 'price_tag', 'shopping_bag', 'house', 'envelope', 'jar', 'phone', 'lightbulb', 'clock', 'water_glass', 'plug_socket', 'laptop', 'card_doc', 'chart_bars', 'cash_stack'];
        const actionList = Array.isArray(actions) && actions.length > 0
            ? actions
            : ['pointing', 'typing', 'hunched-pain', 'stretching', 'empty-wallet', 'back-ache', 'calling', 'phone-scroll', 'shocked-phone', 'cooking', 'counting-money', 'sleeping', 'running', 'drinking', 'celebrating'];
        const effectList = Array.isArray(effects) && effects.length > 0
            ? effects
            : ['sparkles', 'sparks', 'sweat', 'steam', 'hearts', 'confetti', 'money', 'notes'];
        const castList = Array.isArray(casts) && casts.length > 0
            ? casts
            : ['narrator', 'girl-purple', 'boy-spiky', 'girl-bun', 'manager-red'];
        const sfxOptions = Array.isArray(sfxList) && sfxList.length > 0
            ? sfxList
            : ['pop', 'click', 'whoosh', 'ding', 'none'];
        const screenList = Array.isArray(screenTypes) && screenTypes.length > 0
            ? screenTypes
            : ['chat_msg', 'excel_err', 'revenue_up', 'revenue_down', 'checklist_done', 'calendar_due', 'notification_bell', 'wallet_cash', 'code_bug', 'contract_sign', 'tea_break', 'night_scroll'];
        const phase2List = ['none', 'wallet_empty', 'back_pain', 'stretch_up', 'cross_mistake', 'check_win', 'shock_alert', 'money_fly'];
        const transitionList = ['cut', 'diagonal-wipe'];

        const modeRule = mode === 'preserve'
            ? 'CHẾ ĐỘ GIỮ NGUYÊN CÂU CHỮ: Tuyệt đối giữ nguyên văn từng từ/ý trong bài gốc của người dùng (chỉ ngắt thành từng đoạn ngắn 6-14 từ ở các dấu phẩy/chấm/mạch ý để mỗi cảnh khớp đúng ~2-3 giây giọng nói, KHÔNG bịa thêm ý ngoài).'
            : 'CHẾ ĐỘ CHUỐT MƯỢT REELS: Giữ nguyên 100% thông tin cốt lõi nhưng biên tập lại thành 8-14 câu văn nói ngắn 6-14 từ thật tự nhiên để đọc truyền cảm và khớp chuyển cảnh 2D mượt mà.';

        const prompt = `Bạn là Tổng Đạo Diễn Phim Hoạt Hình 2D Reels chuyên chuyển đổi nội dung viết sẵn thành chuỗi phân cảnh hoạt hình khớp chặt từng câu nói.
Tiêu đề gợi ý: "${titleHint}"
Nội dung gốc của người dùng:
"""
${cleanRaw}
"""

NHIỆM VỤ:
${modeRule}
Trả về 1 đối tượng JSON gồm:
- "title": Tiêu đề ngắn gọn cực hút (tối đa 10 từ).
- "scenes": Mảng 6 đến 15 phân cảnh, mỗi phần tử đại diện ĐÚNG 1 nhịp hình-tiếng (6-14 từ) kèm đầy đủ chỉ đạo diễn xuất 2D khớp chính xác từng câu chữ nói:
  + text: Câu lời thoại cho cảnh này.
  + visualSubject: Mô tả ngắn vật thể/hành động chính (6-14 từ).
  + roleTag: Nhãn vai RẤT NGẮN 1-2 từ nếu là lời nhân vật, không cần để "".
  + focusTag: Nhãn từ khóa RẤT NGẮN 1-3 từ nhấn mạnh (tuyệt đối KHÔNG viết câu dài), không cần để "".
  + layout, backdrop, transition, cast, action, stage2Action (động tác chuyển biến ở nửa sau câu), characterMood, stage2Mood, screenType, phase2Effect, effect, sfx, props (1-2 đạo cụ: props[0] đầu câu -> props[1] cuối câu), crossOut.`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        title: { type: 'STRING' },
                        scenes: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    text: { type: 'STRING' },
                                    visualSubject: { type: 'STRING' },
                                    roleTag: { type: 'STRING' },
                                    focusTag: { type: 'STRING' },
                                    layout: { type: 'STRING', enum: layoutList },
                                    backdrop: { type: 'STRING', enum: backdropList },
                                    transition: { type: 'STRING', enum: transitionList },
                                    cast: { type: 'STRING', enum: castList },
                                    action: { type: 'STRING', enum: actionList },
                                    stage2Action: { type: 'STRING', enum: actionList },
                                    characterMood: { type: 'STRING', enum: ['happy', 'shocked', 'thinking', 'sleepy'] },
                                    stage2Mood: { type: 'STRING', enum: ['happy', 'shocked', 'thinking', 'sleepy'] },
                                    screenType: { type: 'STRING', enum: screenList },
                                    phase2Effect: { type: 'STRING', enum: phase2List },
                                    effect: { type: 'STRING', enum: effectList },
                                    sfx: { type: 'STRING', enum: sfxOptions },
                                    props: { type: 'ARRAY', items: { type: 'STRING', enum: propList } },
                                    crossOut: { type: 'BOOLEAN' }
                                },
                                required: ['text', 'visualSubject', 'roleTag', 'focusTag', 'layout', 'backdrop', 'transition', 'cast', 'action', 'stage2Action', 'characterMood', 'stage2Mood', 'screenType', 'phase2Effect', 'effect', 'sfx', 'props', 'crossOut']
                            }
                        }
                    },
                    required: ['title', 'scenes']
                }
            }
        };

        try {
            const res = await fetchTextWithFallback(payload, { signal });
            const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length >= 2) {
                const sliced = parsed.scenes.slice(0, 16);
                const beatTexts = sliced.map((s) => String(s.text || '').trim()).filter(Boolean);
                const resolvedTitle = String(parsed.title || titleHint || beatTexts[0] || '').trim();
                const normalizedBoard = sliced.map((item, idx) => ({
                    visualSubject: String(item.visualSubject || beatTexts[idx] || '').trim(),
                    roleTag: String(item.roleTag || '').trim().slice(0, 22),
                    focusTag: String(item.focusTag || '').trim().slice(0, 20),
                    layout: layoutList.includes(item.layout) ? item.layout : '',
                    backdrop: backdropList.includes(item.backdrop) ? item.backdrop : '',
                    transition: transitionList.includes(item.transition) ? item.transition : 'cut',
                    cast: castList.includes(item.cast) ? item.cast : '',
                    action: actionList.includes(item.action) ? item.action : '',
                    stage2Action: actionList.includes(item.stage2Action) ? item.stage2Action : '',
                    screenType: screenList.includes(item.screenType) ? item.screenType : '',
                    phase2Effect: phase2List.includes(item.phase2Effect) ? item.phase2Effect : 'none',
                    effect: effectList.includes(item.effect) ? item.effect : 'sparkles',
                    sfx: sfxOptions.includes(item.sfx) ? item.sfx : 'none',
                    props: Array.isArray(item.props) ? item.props.filter((p) => propList.includes(p)).slice(0, 3) : [],
                    characterMood: ['happy', 'shocked', 'thinking', 'sleepy'].includes(item.characterMood) ? item.characterMood : 'happy',
                    stage2Mood: ['happy', 'shocked', 'thinking', 'sleepy'].includes(item.stage2Mood) ? item.stage2Mood : '',
                    crossOut: Boolean(item.crossOut)
                }));
                const cacheKey = `storyboard-v9:${hashString(resolvedTitle + '|' + visualStyle + '|' + beatTexts.join('|'))}`;
                caches.prompts.set(cacheKey, normalizedBoard);
                return { title: resolvedTitle, scenes: beatTexts, storyboard: normalizedBoard };
            }
        } catch (err) {
            if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
            console.warn('dumpContentTo2DScenes fallback:', err.message);
        }
        return offlineFallback();
    }

    function sanitizeAndWrapSvg(rawSvg, defaultViewBox = '0 0 540 960', defaultW = 540, defaultH = 960) {
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

        // Enforce explicit pixel dimensions on root <svg> (Safari/WebKit skips relative % SVGs in canvas.drawImage)
        s = s.replace(/^(<svg\b[^>]*>)/i, (openTag) => {
            let tag = openTag
                .replace(/\s+(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
            if (!/\bxmlns=/.test(tag)) {
                tag = tag.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
            }
            if (!/\bviewBox=/.test(tag)) {
                tag = tag.replace(/^<svg\b/i, `<svg viewBox="${defaultViewBox}"`);
            }
            return tag.replace(/^<svg\b/i, `<svg width="${defaultW}" height="${defaultH}"`);
        });

        // Reject malformed XML before turning into data:image/svg+xml
        if (typeof global.DOMParser !== 'undefined') {
            try {
                const doc = new global.DOMParser().parseFromString(s, 'image/svg+xml');
                if (doc.querySelector('parsererror')) return '';
            } catch (_) {
                return '';
            }
        }
        return s;
    }

    async function generateCustomPropSvgs({ title, beats, storyboard, signal } = {}) {
        const cleanBeats = (beats || []).map((b) => String(b?.text || b || '').trim()).filter(Boolean);
        if (cleanBeats.length === 0) return [];

        const subjects = cleanBeats.map((text, idx) => {
            const sb = Array.isArray(storyboard) ? storyboard[idx] : null;
            return sb && sb.visualSubject ? `${text} (Trọng tâm hình ảnh: ${sb.visualSubject})` : text;
        });

        const results = new Array(cleanBeats.length).fill('');
        const missingIndices = [];
        cleanBeats.forEach((sc, idx) => {
            const key = `prop-svg-v3:${hashString(title + '|' + idx + '|' + sc + '|' + subjects[idx])}`;
            if (caches.images.has(key)) {
                results[idx] = caches.images.get(key);
            } else {
                missingIndices.push(idx);
            }
        });

        if (missingIndices.length === 0) return results;

        const buildScenePrompt = (indices) => {
            const itemLines = indices
                .map((idx) => `- Cảnh ${idx + 1}: GIỌNG ĐỌC NÓI CHÍNH XÁC: "${cleanBeats[idx]}"\n  -> ĐỐI TƯỢNG VẼ: ${subjects[idx]}`)
                .join('\n');
            return `Bạn là Họa sĩ Vector 2D Flat Cel-Shaded Cartoon chuyên vẽ ĐỐI TƯỢNG & NHÂN VẬT HÀNH ĐỘNG TRONG SUỐT (KHÔNG NỀN) để ghép trực tiếp vào cảnh phim 2D!
Tiêu đề video: "${title}".

NHIỆM VỤ BẮT BUỘC: Giọng đọc nói gì, vẽ CHÍNH XÁC ĐỐI TƯỢNG / HÀNH ĐỘNG ĐÓ thành vector trong suốt rõ ràng (KHÔNG vẽ chung chung!).
${itemLines}

YÊU CẦU KỸ THUẬT SVG NGHIÊM NGẶT:
1. Trả về mảng JSON đúng ${indices.length} chuỗi SVG theo đúng thứ tự, mỗi chuỗi là <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300">...</svg> hợp lệ XML.
2. NỀN TRONG SUỐT 100%: TUYỆT ĐỐI KHÔNG vẽ hình chữ nhật/khung nền phủ toàn bộ 300x300! Chỉ vẽ nhân vật/đồ vật nổi bật nằm gọn ở giữa vùng an toàn (x từ 25..275, y từ 25..275).
3. VẼ RÕ NÉT HÀNH ĐỘNG (12-26 khối path sắc nét, màu tươi sáng hiện đại, viền đậm stroke="#1e293b" stroke-width="4" stroke-linejoin="round"): VD ghế công thái học lưới đen kèm thẻ giá, cột sống đỏ cong đau, ví da rỗng tiền bay, ngăn đá tủ lạnh có chai hành lá, đồng hồ báo thức 5 phút...
4. TUYỆT ĐỐI KHÔNG dùng thẻ <text> hay chữ viết trong SVG; mọi ký tự "&" viết là "&amp;".`;
        };

        const fetchSvgChunk = async (indices) => {
            const payload = {
                contents: [{ parts: [{ text: buildScenePrompt(indices) }] }],
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
                indices.forEach((sceneIdx, pos) => {
                    const clean = sanitizeAndWrapSvg(svgList[pos], '0 0 300 300', 300, 300);
                    if (clean) {
                        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
                        results[sceneIdx] = dataUrl;
                        const key = `prop-svg-v3:${hashString(title + '|' + sceneIdx + '|' + cleanBeats[sceneIdx] + '|' + subjects[sceneIdx])}`;
                        caches.images.set(key, dataUrl);
                    }
                });
            }
        };

        const BATCH_SIZE = 2;
        for (let b = 0; b < missingIndices.length; b += BATCH_SIZE) {
            if (signal && signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            const chunkIndices = missingIndices.slice(b, b + BATCH_SIZE);
            try {
                await fetchSvgChunk(chunkIndices);
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                console.warn('Custom scene SVG batch retry needed:', err.message);
            }
        }

        // Single-beat retry pass for any scene whose batch failed or emitted invalid XML
        const stillMissing = missingIndices.filter((idx) => !results[idx]);
        for (const idx of stillMissing) {
            if (signal && signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            try {
                await fetchSvgChunk([idx]);
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                console.warn(`Scene SVG single retry skipped (${idx + 1}):`, err.message);
            }
        }

        return results;
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
2. Vẽ CHI TIẾT & SÁT NGỮ CẢNH: Vẽ đúng bối cảnh (phòng ngủ tối có điện thoại, màn hình code sập server, tô cơm nhà, chai nhựa đựng hành trong ngăn đá, tin nhắn sếp, ví tiền, quầy cafe, biểu đồ sụt giảm...), có chiều sâu (nền gradient, ánh sáng, đổ bóng mềm, nhân vật đang thực hiện đúng hành động & biểu cảm rõ nét).
3. TUYỆT ĐỐI KHÔNG VIẾT CHỮ (<text>) HAY NHÃN TIẾNG VIỆT LÊN TRANH: Kể chuyện 100% bằng hình ảnh, hành động nhân vật và biểu tượng trực quan; KHÔNG vẽ chữ cái, bảng chữ hay phụ đề vào trong SVG.
4. MỖI CẢNH PHẢI ĐỔI GÓC MÁY & Ý TƯỞNG: Ví dụ cảnh 1 cận cảnh nhân vật gõ laptop, cảnh 2 toàn cảnh căn phòng, cảnh 3 so sánh trước/sau, cảnh 4 nhân vật ăn mừng... TUYỆT ĐỐI KHÔNG lặp 1 kiểu bố cục!
5. TUYỆT ĐỐI KHÔNG dùng <image>, <foreignObject>, <script>, URL ngoài hay CSS phức tạp; mọi ký tự "&" phải viết là "&amp;".`;

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

    async function generateMultiBeatStoryboard({ title, beatTexts, layouts, backdrops, props, actions, effects, casts, sfxList, screenTypes, visualStyle = 'motion', signal }) {
        const cleanBeats = (beatTexts || []).map((b) => String(b || '').trim()).filter(Boolean);
        if (cleanBeats.length === 0) return null;

        const cacheKey = `storyboard-v9:${hashString(title + '|' + visualStyle + '|' + cleanBeats.join('|'))}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        const layoutList = Array.isArray(layouts) && layouts.length > 0
            ? layouts
            : ['wide-team', 'desk-closeup', 'two-shot-dialogue', 'back-monitors', 'hand-viewfinder', 'hand-pov', 'screen-pointer', 'laptop-popup', 'character-action', 'character-left', 'split-compare', 'multi-trio', 'thought-bubble', 'document-card', 'action-flow', 'center-hero', 'ui-window', 'ui-checklist', 'ui-flow', 'ui-grid-hero'];
        const backdropList = Array.isArray(backdrops) && backdrops.length > 0
            ? backdrops
            : ['studio-focus', 'office-shelf', 'office-desk', 'work-late', 'gym-fresh', 'bank-vault', 'home-living', 'street-rain', 'warning-stage', 'bedroom-night', 'kitchen-cozy', 'cafe-chill', 'server-tech', 'cream-room', 'hills-nature', 'city-skyline', 'sunset-warm', 'mint-fresh', 'night-calm', 'alert-tint', 'grid-light', 'blueprint-dark'];
        const propList = Array.isArray(props) && props.length > 0
            ? props
            : ['ergo_chair', 'spine_back', 'empty_wallet', 'stretching_pose', 'price_tag', 'shopping_bag', 'house', 'envelope', 'jar', 'phone', 'lightbulb', 'clock', 'water_glass', 'plug_socket', 'laptop', 'card_doc', 'chart_bars', 'cash_stack'];
        const actionList = Array.isArray(actions) && actions.length > 0
            ? actions
            : ['pointing', 'typing', 'hunched-pain', 'stretching', 'empty-wallet', 'back-ache', 'calling', 'phone-scroll', 'shocked-phone', 'cooking', 'counting-money', 'sleeping', 'running', 'drinking', 'celebrating'];
        const effectList = Array.isArray(effects) && effects.length > 0
            ? effects
            : ['sparkles', 'sparks', 'sweat', 'steam', 'hearts', 'confetti', 'money', 'notes'];
        const castList = Array.isArray(casts) && casts.length > 0
            ? casts
            : ['narrator', 'girl-purple', 'boy-spiky', 'girl-bun', 'manager-red'];
        const sfxOptions = Array.isArray(sfxList) && sfxList.length > 0
            ? sfxList
            : ['pop', 'click', 'whoosh', 'ding', 'none'];
        const screenList = Array.isArray(screenTypes) && screenTypes.length > 0
            ? screenTypes
            : ['chat_msg', 'excel_err', 'revenue_up', 'revenue_down', 'checklist_done', 'calendar_due', 'notification_bell', 'wallet_cash', 'code_bug', 'contract_sign', 'tea_break', 'night_scroll'];
        const phase2List = ['none', 'wallet_empty', 'back_pain', 'stretch_up', 'cross_mistake', 'check_win', 'shock_alert', 'money_fly'];
        const transitionList = ['cut', 'diagonal-wipe'];

        return dedupedCall(cacheKey, async () => {
            try {
                const numberedBeats = cleanBeats.map((b, i) => `${i + 1}. "${b}"`).join('\n');
                const isUiMode = visualStyle === 'ui-motion';
                const styleDirective = isUiMode
                    ? `PHONG CÁCH HIỆN ĐẠI DOT-GRID UI MOTION:
- Ưu tiên các bố cục [back-monitors, ui-window, ui-checklist, ui-flow, ui-grid-hero] và xen kẽ 1-2 cảnh action-flow hoặc split-compare. KHÔNG lặp cùng layout 2 cảnh liền nhau.
- backdrop: Chọn từ [grid-light, blueprint-dark, studio-focus, mint-fresh].
- Dùng transition="diagonal-wipe" ở các bước chuyển ý lớn để tạo hiệu ứng gạt chéo chuyên nghiệp.`
                    : `PHONG CÁCH HOẠT HÌNH 2D KỂ CHUYỆN THEO ĐÚNG CHỦ ĐỀ (ĐA GÓC MÁY ĐIỆN ẢNH):
- PHÂN BIỆT RÕ TỪNG THẾ GIỚI CHỦ ĐỀ:
  + Chủ đề Nấu ăn / Gia đình / Mẹo vặt nhà cửa: dùng [kitchen-cozy, home-living, cream-room] & góc máy [character-action, character-left, hand-viewfinder, split-compare, multi-trio, center-hero] (TUYỆT ĐỐI KHÔNG dùng office-shelf, wide-team, two-shot-dialogue hay desk-closeup!).
  + Chủ đề Tài chính / Tiết kiệm / Thu chi: dùng [bank-vault, mint-fresh, sunset-warm] & [back-monitors, character-action, split-compare, action-flow, center-hero].
  + Chủ đề Cảnh báo / Lừa đảo / An toàn: dùng [warning-stage, alert-tint, work-late] & [hand-viewfinder, hand-pov, split-compare, character-action].
  + Chủ đề Nhạc / Mood / Mini Vlog / Du lịch / Quê hương: dùng [cafe-chill, hills-nature, street-rain, city-skyline, night-calm].
  + Chủ đề Sức khỏe / Giãn cơ / Nhắc nhở: dùng [gym-fresh, mint-fresh, home-living, bedroom-night (chỉ khi nói về giấc ngủ)].
  + Chủ đề Công sở / IT / MKT / Sale: dùng đa góc máy [wide-team, desk-closeup, two-shot-dialogue, back-monitors, screen-pointer, hand-viewfinder].
- Đổi góc máy (layout) và bối cảnh (backdrop) linh hoạt giữa các cảnh trong cùng chủ đề để không bị lặp lại.`;

                const prompt = `Bạn là Đạo diễn Hoạt Hình 2D chuyên dựng phim ngắn hành động khớp chặt từng câu chữ lời thoại (KHÔNG viết câu phụ đề lên video).
Tiêu đề tổng thể: "${title}"
Danh sách ${cleanBeats.length} nhịp lời thoại theo thứ tự:
${numberedBeats}

${styleDirective}

Hãy phân cảnh ĐÚNG ${cleanBeats.length} cảnh (mỗi câu nói 1 phân cảnh riêng) khớp 100% ý nghĩa câu nói:
- visualSubject: Mô tả ngắn 6-14 từ vật thể/tình huống trung tâm cần vẽ minh họa (VD: "Ghế công thái học lưới đen kèm thẻ giá 5 triệu", "Ví da xẹp lép mở toang bay hết tiền", "Cột sống cong màu đỏ bên cạnh laptop").
- roleTag: Nhãn vai nhân vật RẤT NGẮN 1-2 từ nếu đang đối thoại/giải thích (VD: "Sếp", "Kế toán", "Nhân vật"), nếu không rõ để rỗng "".
- focusTag: Nhãn từ khóa RẤT NGẮN 1-3 từ trên màn hình/bảng soi nếu cần nhấn mạnh (VD: "5 TRIỆU", "ĐAU LƯNG", "BƯỚC 1"), TUYỆT ĐỐI KHÔNG ghi câu dài, nếu không cần để rỗng "".
- layout: Chọn từ [${layoutList.join(', ')}].
- backdrop: Chọn từ [${backdropList.join(', ')}].
- transition: Chọn [${transitionList.join(', ')}].
- cast: Chọn nhân vật từ [${castList.join(', ')}].
- action: Chọn động tác đầu câu từ [${actionList.join(', ')}].
- stage2Action: Động tác chuyển biến nửa sau câu từ [${actionList.join(', ')}].
- stage2Mood: Biểu cảm nửa sau câu ("happy", "shocked", "thinking", hoặc "sleepy").
- screenType: Chọn nội dung màn hình từ [${screenList.join(', ')}].
- phase2Effect: Hiệu ứng chuyển biến ở vế sau của câu nói từ [${phase2List.join(', ')}].
- characterMood: "happy", "shocked", "thinking", hoặc "sleepy".
- effect: Hiệu ứng từ [${effectList.join(', ')}].
- sfx: Âm thanh từ [${sfxOptions.join(', ')}].
- props: Mảng 1-2 đạo cụ gần nhất từ [${propList.join(', ')}].
- crossOut: true chỉ khi câu nói mang ý sai lầm / gạch bỏ / cảnh báo cấm.`;

                const payload = {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    visualSubject: { type: 'STRING' },
                                    roleTag: { type: 'STRING' },
                                    focusTag: { type: 'STRING' },
                                    layout: { type: 'STRING', enum: layoutList },
                                    backdrop: { type: 'STRING', enum: backdropList },
                                    transition: { type: 'STRING', enum: transitionList },
                                    cast: { type: 'STRING', enum: castList },
                                    action: { type: 'STRING', enum: actionList },
                                    stage2Action: { type: 'STRING', enum: actionList },
                                    screenType: { type: 'STRING', enum: screenList },
                                    phase2Effect: { type: 'STRING', enum: phase2List },
                                    effect: { type: 'STRING', enum: effectList },
                                    sfx: { type: 'STRING', enum: sfxOptions },
                                    props: { type: 'ARRAY', items: { type: 'STRING', enum: propList } },
                                    characterMood: { type: 'STRING', enum: ['happy', 'shocked', 'thinking', 'sleepy'] },
                                    stage2Mood: { type: 'STRING', enum: ['happy', 'shocked', 'thinking', 'sleepy'] },
                                    crossOut: { type: 'BOOLEAN' }
                                },
                                required: ['visualSubject', 'roleTag', 'focusTag', 'layout', 'backdrop', 'transition', 'cast', 'action', 'stage2Action', 'screenType', 'phase2Effect', 'effect', 'sfx', 'props', 'characterMood', 'stage2Mood', 'crossOut']
                            }
                        }
                    }
                };

                const result = await fetchTextWithFallback(payload, { signal });
                const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text;
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length >= cleanBeats.length) {
                    const normalized = parsed.slice(0, cleanBeats.length).map((item, idx) => ({
                        visualSubject: String(item.visualSubject || cleanBeats[idx] || '').trim(),
                        roleTag: String(item.roleTag || '').trim().slice(0, 22),
                        focusTag: String(item.focusTag || '').trim().slice(0, 20),
                        layout: layoutList.includes(item.layout) ? item.layout : '',
                        backdrop: backdropList.includes(item.backdrop) ? item.backdrop : '',
                        transition: transitionList.includes(item.transition) ? item.transition : 'cut',
                        cast: castList.includes(item.cast) ? item.cast : '',
                        action: actionList.includes(item.action) ? item.action : '',
                        stage2Action: actionList.includes(item.stage2Action) ? item.stage2Action : '',
                        screenType: screenList.includes(item.screenType) ? item.screenType : '',
                        phase2Effect: phase2List.includes(item.phase2Effect) ? item.phase2Effect : 'none',
                        effect: effectList.includes(item.effect) ? item.effect : 'sparkles',
                        sfx: sfxOptions.includes(item.sfx) ? item.sfx : 'none',
                        props: Array.isArray(item.props) ? item.props.filter((p) => propList.includes(p)).slice(0, 3) : [],
                        characterMood: ['happy', 'shocked', 'thinking', 'sleepy'].includes(item.characterMood) ? item.characterMood : 'happy',
                        stage2Mood: ['happy', 'shocked', 'thinking', 'sleepy'].includes(item.stage2Mood) ? item.stage2Mood : '',
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

    async function fetchLiveSessionChunk({ texts, voiceName, model, onChunkDone, signal }) {
        const apiKey = getApiKey();
        if (!apiKey) {
            throw new ApiError('INVALID_API_KEY', 'Bạn chưa nhập Gemini API Key Free để tạo giọng đọc Live.');
        }
        const wsUrl = `${GEMINI_LIVE_WS_URL}?key=${encodeURIComponent(apiKey)}`;
        const count = texts.length;
        const buffers = new Array(count).fill(null);
        const mimeTypes = new Array(count).fill('audio/pcm;rate=24000');

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
            let turnMimeType = 'audio/pcm;rate=24000';
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
                resolve({ buffers, mimeTypes, errorReason: '' });
            };

            const onAbort = () => {
                finishWithError(new DOMException('Aborted', 'AbortError'));
            };
            if (signal) signal.addEventListener('abort', onAbort, { once: true });

            const sendNextScene = () => {
                if (settled) return;
                if (queuePos >= count) {
                    finishSuccess();
                    return;
                }

                const idx = queuePos;
                turnChunks = [];
                turnMimeType = 'audio/pcm;rate=24000';
                awaitingTurn = true;

                if (turnTimer) clearTimeout(turnTimer);
                turnTimer = setTimeout(() => {
                    awaitingTurn = false;
                    if (buffers.some(Boolean)) {
                        settled = true;
                        cleanup();
                        resolve({ buffers, mimeTypes, errorReason: `Cảnh ${idx + 1} quá thời gian chờ.` });
                        return;
                    }
                    finishWithError(new ApiError('TIMEOUT', `Gemini Live phản hồi quá lâu ở cảnh ${idx + 1}.`));
                }, 25000);

                ws.send(
                    JSON.stringify({
                        clientContent: {
                            turns: [
                                {
                                    role: 'user',
                                    parts: [
                                        {
                                            text: `Đọc to nguyên văn đúng 1 lần, giữ tốc độ 1.0x đều đặn:\n${texts[idx]}`
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
                            model: `models/${model}`,
                            generationConfig: {
                                responseModalities: ['AUDIO'],
                                speechConfig: {
                                    voiceConfig: {
                                        prebuiltVoiceConfig: {
                                            voiceName
                                        }
                                    }
                                }
                            },
                            systemInstruction: {
                                parts: [
                                    {
                                        text: `Bạn là MỘT phát thanh viên tiếng Việt chuyên nghiệp (mã giọng: ${voiceName}). BẮT BUỘC giữ CÙNG MỘT NHỊP ĐỘ ĐỀU ĐẶN (1.0x), CAO ĐỘ VÀ ÂM LƯỢNG ỔN ĐỊNH qua từng câu — TUYỆT ĐỐI KHÔNG đọc lúc nhanh lúc chậm, không nuốt chữ, không đổi giọng, không thêm lời bình luận. Nhận câu nào chỉ đọc chính xác nguyên văn đúng 1 lần.`
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
                            if (part.inlineData.mimeType) {
                                turnMimeType = part.inlineData.mimeType;
                            }
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
                    const idx = queuePos;
                    if (turnChunks.length > 0) {
                        const combined = concatUint8Arrays(turnChunks);
                        turnChunks = [];
                        if (combined.byteLength >= 2400) {
                            buffers[idx] = combined;
                            mimeTypes[idx] = turnMimeType;
                            if (onChunkDone) onChunkDone(idx, combined, turnMimeType);
                        }
                    }
                    queuePos++;
                    sendNextScene();
                }
            };

            ws.onerror = () => {
                clearTimeout(setupTimer);
                if (buffers.some(Boolean)) {
                    if (!settled) {
                        settled = true;
                        cleanup();
                        resolve({ buffers, mimeTypes, errorReason: `Kết nối Live API bị gián đoạn (${model}).` });
                    }
                    return;
                }
                finishWithError(new ApiError('WS_ERROR', `Lỗi kết nối Live API (${model}).`));
            };

            ws.onclose = (ev) => {
                clearTimeout(setupTimer);
                if (!settled) {
                    if (buffers.some(Boolean) && queuePos < count) {
                        settled = true;
                        cleanup();
                        resolve({ buffers, mimeTypes, errorReason: ev.reason || 'Kết nối Live API bị ngắt giữa chừng.' });
                    } else if (!setupDone) {
                        const reason = ev.reason || `WebSocket đóng (mã ${ev.code}) — có thể do thiếu API Key hoặc model không hỗ trợ.`;
                        finishWithError(new ApiError('WS_CLOSED', reason));
                    } else if (queuePos < count) {
                        finishWithError(new ApiError('WS_CLOSED', ev.reason || 'Kết nối Live API bị ngắt giữa chừng.'));
                    } else {
                        finishSuccess();
                    }
                }
            };
        });
    }

    async function fetchBatchLiveTtsPcm({ texts, voiceName, model, onSceneDone, signal }) {
        const cleanTexts = (texts || []).map((t) => String(t || '').trim() || 'Khoảnh khắc đời sống hằng ngày.');
        const voice = voiceName || 'Aoede';
        const liveModel = model || MODELS.LIVE_38;

        const results = new Array(cleanTexts.length).fill(null);
        const resultMimeTypes = new Array(cleanTexts.length).fill('audio/pcm;rate=24000');
        const missingIndices = [];

        cleanTexts.forEach((text, i) => {
            const cacheKey = `live-v2:${liveModel}:${voice}:${hashString(text)}`;
            if (caches.ttsPcm.has(cacheKey)) {
                const cached = caches.ttsPcm.get(cacheKey);
                results[i] = cached?.buffer || cached;
                resultMimeTypes[i] = cached?.mimeType || 'audio/pcm;rate=24000';
                if (onSceneDone) onSceneDone(i, results[i], true);
            } else {
                missingIndices.push(i);
            }
        });

        if (missingIndices.length === 0) {
            return { buffers: results, mimeTypes: resultMimeTypes, errorReason: '' };
        }

        // Keep WebSocket sessions short (max 3 scenes each) to prevent conversational speed/pitch drift
        const MAX_TURNS_PER_SESSION = 3;
        let lastError = '';
        for (let offset = 0; offset < missingIndices.length; offset += MAX_TURNS_PER_SESSION) {
            if (signal && signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            const chunkIdxList = missingIndices.slice(offset, offset + MAX_TURNS_PER_SESSION);
            const chunkTexts = chunkIdxList.map((idx) => cleanTexts[idx]);
            const sessionRes = await fetchLiveSessionChunk({
                texts: chunkTexts,
                voiceName: voice,
                model: liveModel,
                signal,
                onChunkDone: (localIdx, buf, mimeType) => {
                    const globalIdx = chunkIdxList[localIdx];
                    results[globalIdx] = buf;
                    resultMimeTypes[globalIdx] = mimeType || 'audio/pcm;rate=24000';
                    const cacheKey = `live-v2:${liveModel}:${voice}:${hashString(cleanTexts[globalIdx])}`;
                    caches.ttsPcm.set(cacheKey, { buffer: buf, mimeType: resultMimeTypes[globalIdx] });
                    if (onSceneDone) onSceneDone(globalIdx, buf, false);
                }
            });
            if (sessionRes.errorReason) {
                lastError = sessionRes.errorReason;
            }
        }

        return { buffers: results, mimeTypes: resultMimeTypes, errorReason: lastError };
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

    function safeExtractJsonFromText(rawText) {
        const raw = String(rawText || '').trim();
        if (!raw) return null;
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        try {
            return JSON.parse(cleaned);
        } catch (_) {
            const arrMatch = cleaned.match(/\[[\s\S]*\]/);
            if (arrMatch) {
                try {
                    return JSON.parse(arrMatch[0]);
                } catch (__) {}
            }
            const objMatch = cleaned.match(/\{[\s\S]*\}/);
            if (objMatch) {
                try {
                    return JSON.parse(objMatch[0]);
                } catch (__) {}
            }
        }
        return null;
    }

    function quickLocalPolicyScan(rawText) {
        const text = String(rawText || '').trim();
        if (!text) return { status: 'safe', flags: [] };

        const rules = [
            {
                rx: /chữa (?:khỏi|dứt điểm|tận gốc|bách bệnh)|thần dược|cam kết khỏi 100%|bác sĩ giấu/i,
                msg: 'Khẳng định công dụng y tế tuyệt đối ("chữa dứt điểm / 100%") dễ bị quét hạn chế quảng cáo & sai sự thật y khoa.'
            },
            {
                rx: /cam kết lãi|x\d+ tài khoản|làm giàu sau 1 đêm|thu nhập thụ động 100%|không (?:có )?rủi ro|lãi suất \d{2,}%/i,
                msg: 'Nội dung hứa hẹn lợi nhuận / tài chính phi thực tế dễ vi phạm chính sách lừa đảo tài chính.'
            },
            {
                rx: /tag (?:ngay )?\d+ người|không (?:follow|chia sẻ|share) sẽ|nhấn (?:vào )?link nhận tiền|chuyển khoản nhận quà/i,
                msg: 'Dụ tương tác (engagement bait) hoặc điều hướng link quà tặng dễ bị bóp reach / hạn chế phân phối.'
            },
            {
                rx: /chấn động cả nước|100% sự thật bị che|9\d[.,]\d+% (?:người|chuyên gia|bác sĩ)|tuyệt mật chưa ai biết/i,
                msg: 'Giật tít hoặc trích dẫn số liệu % quá chính xác không nguồn dễ bị gắn cờ tin sai lệch.'
            }
        ];

        const flags = [];
        rules.forEach((r) => {
            const m = text.match(r.rx);
            if (m) flags.push(`${r.msg} ("${m[0]}")`);
        });
        return {
            status: flags.length >= 2 ? 'risk' : flags.length === 1 ? 'caution' : 'safe',
            flags
        };
    }

    async function fetchDailyTrendsAndNews({ niche = 'all', forceRefresh = false, signal } = {}) {
        const now = new Date();
        const todayIso = now.toISOString().slice(0, 10);
        const todayDisplay = now.toLocaleDateString('vi-VN', {
            weekday: 'long',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });

        const nicheMap = {
            all: 'tin tức nổi bật, xu hướng đời sống, công nghệ và mạng xã hội tại Việt Nam',
            tech: 'tin tức công nghệ mới, AI, bảo mật mạng và tiện ích số nổi bật tại Việt Nam và thế giới',
            finance: 'tin tức kinh tế, tiêu dùng thông minh, tài chính cá nhân và cảnh báo lừa đảo tại Việt Nam',
            health: 'xu hướng sức khỏe đời sống, dinh dưỡng, thói quen tốt và lời khuyên y tế chính thống',
            social: 'trend sáng tạo nội dung, văn hóa công sở, nghề nghiệp và kỹ năng sống giới trẻ Việt Nam'
        };
        const topicLabel = nicheMap[niche] || nicheMap.all;
        const cacheKey = `daily-trends:${todayIso}:${niche}`;
        if (!forceRefresh && caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        const prompt = `Hôm nay là ${todayDisplay} (ngày ${todayIso}).
Hãy sử dụng Google Search để tìm ĐÚNG 4 tin tức hoặc xu hướng CÓ THẬT, MỚI NHẤT trong tuần/ngày hôm nay liên quan tới: ${topicLabel}.
TUYỆT ĐỐI KHÔNG bịa đặt sự kiện hay số liệu; chỉ đưa tin đã được báo chí / nguồn uy tín công bố và an toàn với Chính sách Cộng đồng Facebook Reels / TikTok / YouTube Shorts (tránh tin giật gân sai lệch, tránh nội dung nhạy cảm/cấm).

Trả về DUY NHẤT 1 mảng JSON hợp lệ (không giải thích thêm) gồm 4 phần tử, mỗi phần tử có đúng các trường:
- "title": Tiêu đề kịch bản Reels ngắn gọn, thu hút nhưng trung thực sự thật.
- "category": Chọn đúng 1 trong ["office", "career", "finance", "humor", "lifehack", "warning", "reminder", "music", "vlog", "bts"].
- "factSummary": Tóm tắt ngắn 1-2 câu sự thật cốt lõi đã kiểm chứng (có ngày/bối cảnh thật).
- "sourceNote": Tên nguồn báo chí / tổ chức phát hành tin nếu thấy từ kết quả tìm kiếm.
- "hook": Câu mở đầu Reels 3 giây tự nhiên, KHÔNG bịa số liệu giả.
- "scenes": Mảng 6 câu lời thoại ngắn (8–16 từ/câu) sẵn sàng dựng hoạt hình 2D.
- "hashtags": 4-5 hashtag tiếng Việt không dấu.`;

        const trySearchPayload = {
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ googleSearch: {} }]
        };

        return dedupedCall(cacheKey, async () => {
            const candidates = [MODELS.TEXT, ...(MODELS.TEXT_FALLBACKS || [])].filter(Boolean);
            let lastErr = null;
            for (const modelName of candidates) {
                try {
                    const res = await fetchGeminiWithRetry(modelName, trySearchPayload, { signal });
                    const cand = res?.candidates?.[0];
                    const rawText = cand?.content?.parts?.map((p) => p.text || '').join('\n') || '';
                    const parsed = safeExtractJsonFromText(rawText);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const chunks = cand?.groundingMetadata?.groundingChunks || [];
                        const webSources = [];
                        const seenUrls = new Set();
                        chunks.forEach((ch) => {
                            const uri = ch?.web?.uri;
                            const st = ch?.web?.title;
                            if (uri && !seenUrls.has(uri)) {
                                seenUrls.add(uri);
                                webSources.push({ title: String(st || uri).slice(0, 65), url: uri });
                            }
                        });

                        const normalized = parsed.slice(0, 5).map((item, idx) => ({
                            id: `trend-${todayIso}-${niche}-${idx}`,
                            dateDisplay: todayDisplay,
                            title: String(item.title || '').trim(),
                            category: String(item.category || 'lifehack').trim(),
                            factSummary: String(item.factSummary || '').trim(),
                            sourceNote: String(item.sourceNote || 'Tổng hợp báo chí chính thống').trim(),
                            hook: String(item.hook || '').trim(),
                            scenes: Array.isArray(item.scenes) ? item.scenes.map((s) => String(s || '').trim()).filter(Boolean) : [],
                            hashtags: String(item.hashtags || '#tinnong #reelsvn #xuhuong').trim(),
                            sources: webSources.slice(0, 4),
                            grounded: webSources.length > 0
                        })).filter((x) => x.title && x.scenes.length >= 2);

                        if (normalized.length > 0) {
                            const out = { dateDisplay: todayDisplay, items: normalized, grounded: webSources.length > 0 };
                            caches.prompts.set(cacheKey, out);
                            return out;
                        }
                    }
                } catch (err) {
                    if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                    lastErr = err;
                    console.warn(`Daily trends grounding on ${modelName} fallback:`, err.message);
                }
            }
            throw lastErr || new ApiError('SERVER_ERROR', 'Không thể tải tin tức/trend mới lúc này.');
        });
    }

    async function auditScriptPolicyAndFacts({ title = '', scenes = [], signal } = {}) {
        const cleanScenes = (scenes || []).map((s) => String(s || '').trim()).filter(Boolean);
        const combined = [title, ...cleanScenes].filter(Boolean).join('\n');
        const localScan = quickLocalPolicyScan(combined);

        if (!getApiKey()) {
            return {
                status: localScan.status,
                score: localScan.status === 'safe' ? 92 : localScan.status === 'caution' ? 72 : 48,
                summary:
                    localScan.flags.length === 0
                        ? 'Kiểm tra nhanh ngoại tuyến: Chưa phát hiện từ khóa rủi ro vi phạm chính sách. Hãy nhập API Key để kiểm duyệt sâu ngữ cảnh & chống tin giả.'
                        : 'Phát hiện câu từ có nguy cơ vi phạm chính sách hoặc phóng đại quá mức.',
                flags: localScan.flags,
                factCheckNotes: ['Khi trích dẫn số liệu y tế, tài chính hoặc tin nóng, nên dẫn rõ nguồn hoặc nói ở mức kinh nghiệm chia sẻ.'],
                improvedScenes: cleanScenes
            };
        }

        const prompt = `Bạn là Chuyên gia Kiểm Duyệt Chính Sách Nền Tảng (Facebook Reels / TikTok / YouTube Shorts Trust & Safety) và Kiểm Chứng Sự Thật (Fact-Checker).
Hãy rà soát kịch bản video ngắn sau:
Tiêu đề: "${title}"
Các cảnh lời thoại:
${cleanScenes.map((s, i) => `${i + 1}. "${s}"`).join('\n')}

TIÊU CHÍ ĐÁNH GIÁ NGHIÊM NGẶT:
1. Thông tin sai sự thật / Tin giả: Có bịa đặt con số %, nghiên cứu khoa học không nguồn, cam kết y tế ("chữa khỏi 100%") hay hứa hẹn tài chính ảo không?
2. Vi phạm Chính sách Cộng đồng & Kiếm tiền: Có dụ tương tác spam (engagement bait), ngôn từ công kích/xúc phạm, thông tin gây hoang mang không căn cứ hay từ khóa nhạy cảm bị bóp reach không?
3. Đề xuất bản sửa: Viết lại nhẹ nhàng các câu có rủi ro thành văn phong trung thực, khách quan, an toàn kiếm tiền 100% mà vẫn giữ nguyên thông điệp & sức hút cho creator.

Trả về JSON object có đúng các trường:
- status: "safe" (90-100 điểm), "caution" (65-89 điểm), hoặc "risk" (<65 điểm).
- score: số nguyên 0..100.
- summary: Nhận xét tổng quan 1 câu ngắn gọn.
- flags: Mảng cảnh báo cụ thể (nếu an toàn trả mảng rỗng []).
- factCheckNotes: Mảng 1-3 lưu ý kiểm chứng / dẫn nguồn (hoặc gợi ý cách diễn đạt trung thực).
- improvedScenes: Mảng ĐÚNG ${cleanScenes.length} câu lời thoại ĐÃ ĐƯỢC CHỈNH AN TOÀN CHÍNH SÁCH (nếu câu nào đã an toàn thì giữ nguyên).`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        status: { type: 'STRING', enum: ['safe', 'caution', 'risk'] },
                        score: { type: 'INTEGER' },
                        summary: { type: 'STRING' },
                        flags: { type: 'ARRAY', items: { type: 'STRING' } },
                        factCheckNotes: { type: 'ARRAY', items: { type: 'STRING' } },
                        improvedScenes: { type: 'ARRAY', items: { type: 'STRING' } }
                    },
                    required: ['status', 'score', 'summary', 'flags', 'factCheckNotes', 'improvedScenes']
                }
            }
        };

        const res = await fetchTextWithFallback(payload, { signal });
        const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = safeExtractJsonFromText(raw);
        if (!parsed) {
            return {
                status: localScan.status,
                score: 85,
                summary: 'Hoàn tất kiểm tra nhanh tiêu chuẩn an toàn nội dung.',
                flags: localScan.flags,
                factCheckNotes: [],
                improvedScenes: cleanScenes
            };
        }
        return {
            status: ['safe', 'caution', 'risk'].includes(parsed.status) ? parsed.status : 'safe',
            score: Math.max(0, Math.min(100, Number(parsed.score) || 90)),
            summary: String(parsed.summary || '').trim(),
            flags: Array.isArray(parsed.flags) ? parsed.flags.filter(Boolean) : localScan.flags,
            factCheckNotes: Array.isArray(parsed.factCheckNotes) ? parsed.factCheckNotes.filter(Boolean) : [],
            improvedScenes:
                Array.isArray(parsed.improvedScenes) && parsed.improvedScenes.length === cleanScenes.length
                    ? parsed.improvedScenes.map((s) => String(s || '').trim() || '')
                    : cleanScenes
        };
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
        generateCartoonVisualPrompts,
        dumpContentTo2DScenes,
        fetchDailyTrendsAndNews,
        quickLocalPolicyScan,
        auditScriptPolicyAndFacts,
        generateCustomSceneSvgs,
        generateCustomPropSvgs,
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
