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
        images: new LRUCache(API_POLICY.MAX_CACHE_ENTRIES),
        modelsByKey: new Map()
    };

    const inFlight = new Map();
    const cooldowns = new Map();
    let lastActiveTextModel = '';

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

    async function fetchWithTimeout(url, options = {}, timeoutMs = API_POLICY.REQUEST_TIMEOUT_MS || 22000, parentSignal = null) {
        const ctrl = new AbortController();
        let timedOut = false;
        const onParentAbort = () => ctrl.abort();
        if (parentSignal) {
            if (parentSignal.aborted) throw new DOMException('Aborted', 'AbortError');
            parentSignal.addEventListener('abort', onParentAbort, { once: true });
        }
        const timer = setTimeout(() => {
            timedOut = true;
            ctrl.abort();
        }, timeoutMs);
        try {
            return await fetch(url, { ...options, signal: ctrl.signal });
        } catch (err) {
            if (timedOut) {
                throw new ApiError('TIMEOUT', `Kết nối quá thời gian (${Math.round(timeoutMs / 1000)}s).`);
            }
            if (parentSignal && parentSignal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            throw err;
        } finally {
            clearTimeout(timer);
            if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
        }
    }

    async function fetchGeminiWithRetry(model, payload, { signal, apiKeyOverride, timeoutMs } = {}) {
        const apiKey = apiKeyOverride !== undefined ? String(apiKeyOverride).trim() : getApiKey();
        if (!apiKey) {
            throw new ApiError('INVALID_API_KEY', 'Bạn chưa nhập Gemini API Key Free. Hãy bấm "Cài API Key" để dán key miễn phí.');
        }
        const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const effectiveTimeout = Number(timeoutMs) || API_POLICY.REQUEST_TIMEOUT_MS || 22000;

        return scheduleTask(async () => {
            for (let attempt = 0; attempt <= API_POLICY.MAX_RETRIES; attempt++) {
                if (signal && signal.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }

                let response;
                try {
                    response = await fetchWithTimeout(
                        url,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        },
                        effectiveTimeout,
                        signal
                    );
                } catch (networkErr) {
                    if (networkErr.name === 'AbortError') throw networkErr;
                    if (networkErr.code === 'TIMEOUT') {
                        if (attempt === API_POLICY.MAX_RETRIES) throw networkErr;
                        await sleep(500, signal);
                        continue;
                    }
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

    function scoreDiscoveredTextModel(id) {
        const lower = id.toLowerCase();
        if (lower === 'gemini-4-hydrogen') return 100;
        if (lower === 'gemini-3.5-flash-lite') return 96;
        if (lower === 'gemini-3.1-flash-lite') return 92;
        if (lower === 'gemini-4-neon') return 90;
        if (lower === 'gemini-4-argon') return 88;
        if (lower.includes('flash-lite')) return 84;
        if (lower.includes('flash')) return 80;
        if (lower.includes('hydrogen')) return 78;
        if (lower.startsWith('gemma-4-31b')) return 74;
        if (lower.startsWith('gemma-4')) return 70;
        if (lower.includes('gemma')) return 62;
        if (lower.includes('pro')) return 55;
        return 40;
    }

    async function discoverAvailableTextModels(apiKey, { signal, forceRefresh = false } = {}) {
        const cleanKey = String(apiKey || '').trim();
        if (!cleanKey) return [];
        const keyHash = hashString(cleanKey);
        if (!forceRefresh && caches.modelsByKey.has(keyHash)) {
            return caches.modelsByKey.get(keyHash);
        }
        try {
            const url = `${GEMINI_BASE_URL}?key=${encodeURIComponent(cleanKey)}&pageSize=100`;
            const res = await fetchWithTimeout(url, { method: 'GET' }, 8500, signal);
            if (!res.ok) return [];
            const data = await res.json();
            const list = Array.isArray(data?.models) ? data.models : [];
            const excludedRx = /embedding|imagen|nano-banana|image|tts|live|omni|genie|lyria|transcribe|robotics|computer-use|deep-research|decision|aqa/i;
            const filtered = list
                .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
                .map((m) => String(m.name || '').replace(/^models\//, '').trim())
                .filter((id) => id && !excludedRx.test(id))
                .sort((a, b) => scoreDiscoveredTextModel(b) - scoreDiscoveredTextModel(a));
            caches.modelsByKey.set(keyHash, filtered);
            return filtered;
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            return [];
        }
    }

    function adaptPayloadForModel(modelName, payload) {
        const isGemma = /^gemma-/i.test(String(modelName || ''));
        if (!isGemma || !payload?.generationConfig) return payload;
        const nextConfig = { ...payload.generationConfig };
        const wantsJson = Boolean(nextConfig.responseSchema || nextConfig.responseMimeType === 'application/json');
        delete nextConfig.responseSchema;
        delete nextConfig.responseMimeType;
        if (!wantsJson || !Array.isArray(payload.contents) || payload.contents.length === 0) {
            return { ...payload, generationConfig: nextConfig };
        }
        const nextContents = payload.contents.map((c, idx) => {
            if (idx !== 0 || !Array.isArray(c.parts) || c.parts.length === 0) return c;
            const firstText = String(c.parts[0]?.text || '');
            if (/chỉ trả về.*json/i.test(firstText)) return c;
            const jsonGuard = '\n\nQUAN TRỌNG: CHỈ TRẢ VỀ DUY NHẤT 1 KHỐI JSON HỢP LỆ (KHÔNG giải thích thêm ngoài JSON).';
            const nextParts = c.parts.map((p, pIdx) => (pIdx === 0 && typeof p.text === 'string' ? { ...p, text: p.text + jsonGuard } : p));
            return { ...c, parts: nextParts };
        });
        return { ...payload, contents: nextContents, generationConfig: nextConfig };
    }

    async function fetchTextWithFallback(payload, { signal, apiKeyOverride } = {}) {
        const activeKey = apiKeyOverride !== undefined ? String(apiKeyOverride).trim() : getApiKey();
        if (!activeKey) {
            throw new ApiError('INVALID_API_KEY', 'Bạn chưa nhập Gemini API Key Free. Hãy bấm "Cài API Key" để dán key miễn phí.');
        }
        const preferred = App.store?.getState?.().textModel || 'auto';
        const baseCandidates = [
            preferred && preferred !== 'auto' ? preferred : null,
            lastActiveTextModel || null,
            MODELS.TEXT,
            ...(MODELS.TEXT_FALLBACKS || [])
        ].filter(Boolean);

        const cachedDiscovered = caches.modelsByKey.get(hashString(activeKey)) || [];
        const tried = new Set();
        const queue = [];
        [...baseCandidates, ...cachedDiscovered].forEach((m) => {
            if (m && !tried.has(m) && !queue.includes(m)) queue.push(m);
        });

        let lastErr = null;
        let didDiscoverLive = cachedDiscovered.length > 0;

        for (let idx = 0; idx < queue.length; idx++) {
            const modelName = queue[idx];
            tried.add(modelName);
            const adaptedPayload = adaptPayloadForModel(modelName, payload);
            try {
                const res = await fetchGeminiWithRetry(modelName, adaptedPayload, { signal, apiKeyOverride, timeoutMs: API_POLICY.REQUEST_TIMEOUT_MS || 22000 });
                lastActiveTextModel = modelName;
                return res;
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                lastErr = err;
                const shouldFallback =
                    err.status === 404 ||
                    err.status === 400 ||
                    err.status === 429 ||
                    err.status === 500 ||
                    err.status === 502 ||
                    err.status === 503 ||
                    err.status === 504 ||
                    err.code === 'BAD_REQUEST' ||
                    err.code === 'TIMEOUT' ||
                    err.code === 'QUOTA_EXHAUSTED' ||
                    err.code === 'RATE_LIMITED' ||
                    err.code === 'NETWORK_ERROR' ||
                    err.code === 'SERVER_ERROR';

                if (!didDiscoverLive && shouldFallback) {
                    didDiscoverLive = true;
                    const discovered = await discoverAvailableTextModels(activeKey, { signal });
                    discovered.forEach((dm) => {
                        if (!tried.has(dm) && !queue.includes(dm)) queue.push(dm);
                    });
                }

                if (!shouldFallback || idx === queue.length - 1) {
                    throw err;
                }
                console.warn(`Text model ${modelName} unavailable (${err.status || err.code}), switching to ${queue[idx + 1]}`);
            }
        }
        throw lastErr || new ApiError('SERVER_ERROR', 'Không có model văn bản khả dụng.');
    }

    async function testApiKey(candidateKey) {
        const clean = String(candidateKey || '').trim();
        if (!clean) throw new ApiError('MISSING_API_KEY', 'Vui lòng nhập API Key');

        const discoveredModels = await discoverAvailableTextModels(clean, { forceRefresh: true });
        const payload = {
            contents: [{ parts: [{ text: 'Reply with OK' }] }],
            generationConfig: { maxOutputTokens: 8 }
        };
        await fetchTextWithFallback(payload, { apiKeyOverride: clean });
        return {
            ok: true,
            activeModel: lastActiveTextModel || MODELS.TEXT,
            discoveredModels
        };
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
        if (!getApiKey()) {
            throw new ApiError('INVALID_API_KEY', 'Bạn chưa nhập Gemini API Key Free. Hãy bấm "Cài API Key" để dán key miễn phí.');
        }
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
- Tuyệt đối KHÔNG trùng ý tưởng hoặc mô-típ với các tiêu đề đã có: [${(existingTitles || []).slice(0, 30).join('; ')}].
- Hook (3 giây đầu): Tối đa 16 từ, đánh thẳng vào tình huống đời thật, drama nghề nghiệp, sai lầm mất tiền hoặc POV ai cũng từng dính.
- Body: Đúng 5–6 ý ngắn (mỗi ý 12–20 từ, dùng ký tự "• " đầu dòng), nhịp cuốn, có cao trào hoặc bước ngoặt bất ngờ ở cuối.
- CTA: Đặt câu hỏi mở kích thích đồng nghiệp/người cùng ngành/người xem vào bình luận hoặc tag nhau.
- category: Chọn đúng 1 trong 10 giá trị: "office", "career", "finance", "humor", "lifehack", "warning", "reminder", "music", "vlog", "bts".
- duration: Ví dụ "28s", "32s".
- viralScore: Từ "94%" đến "99%".
- hashtags: 4-5 hashtag tiếng Việt không dấu.
- Trả về đúng JSON Array gồm ${targetCount} object với các trường: title, category, duration, viralScore, hook, body, cta, hashtags.`;

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
            const parsed = safeExtractJsonFromText(rawText);
            if (!Array.isArray(parsed)) throw new ApiError('INVALID_JSON', 'Dữ liệu AI trả về không đúng định dạng mảng kịch bản');
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
            const parsed = safeExtractJsonFromText(raw);
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
            const parsed = safeExtractJsonFromText(raw);
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
            const ep = safeExtractJsonFromText(raw);
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

    async function dumpTopicToStudioContent({ keyword, tone = 'viral', targetCount = 8, signal } = {}) {
        const cleanKw = String(keyword || '').trim();
        if (!cleanKw) {
            throw new ApiError('EMPTY_KEYWORD', 'Vui lòng nhập từ khóa chủ đề trước khi AI dump nội dung.');
        }
        const count = Math.max(5, Math.min(12, parseInt(targetCount, 10) || 8));
        const toneRule = TONE_GUIDES[tone] || TONE_GUIDES.viral;
        const cacheKey = `kw-studio-v1:${tone}:${count}:${hashString(cleanKw.toLowerCase())}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        return dedupedCall(cacheKey, async () => {
            if (!getApiKey()) {
                throw new ApiError('INVALID_API_KEY', 'Bạn chưa nhập Gemini API Key Free. Hãy bấm "Cài API Key" để dán key miễn phí.');
            }
            checkCooldown('dumpKeywordStudio', API_POLICY.REWRITE_COOLDOWN_MS);
            const prompt = `Bạn là Đạo Diễn & Biên Kịch Video Ngắn (Facebook Reels / TikTok / YouTube Shorts) hàng đầu Việt Nam.
Từ khóa / Chủ đề người dùng nhập: "${cleanKw}"
${toneRule}
${CREATOR_ETHICS_AND_POLICY_RULE}

NHIỆM VỤ:
Dựa hoàn toàn vào từ khóa "${cleanKw}", tự sáng tạo ngay 1 kịch bản video ngắn hoàn chỉnh, văn nói tự nhiên đời thường, cuốn hút từ giây đầu tiên và khớp nhịp hoạt hình 2D:
1. "title": Tiêu đề cực hút (tối đa 12 từ).
2. "scenes": Mảng ĐÚNG ${count} câu lời thoại nối tiếp nhau theo diễn biến (mỗi câu 10–20 từ, đọc mượt mà trong ~2–3 giây/cảnh, có Hook cảnh 1 -> Thân bài/ví dụ thực tế/so sánh số liệu -> Chốt & CTA đặt câu hỏi ở cảnh cuối).
3. "caption": Caption 2–3 đoạn ngắn sẵn sàng copy đăng Reels.
4. "hashtags": 5–7 hashtag tiếng Việt không dấu sát từ khóa "${cleanKw}".`;

            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            title: { type: 'STRING' },
                            scenes: { type: 'ARRAY', items: { type: 'STRING' } },
                            caption: { type: 'STRING' },
                            hashtags: { type: 'STRING' }
                        },
                        required: ['title', 'scenes', 'caption', 'hashtags']
                    }
                }
            };

            const res = await fetchTextWithFallback(payload, { signal });
            const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = safeExtractJsonFromText(raw);
            if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length < 3) {
                throw new ApiError('INVALID_JSON', 'AI chưa trả về đủ các phân cảnh nội dung cho từ khóa này.');
            }
            const scenes = parsed.scenes.slice(0, 16).map((s) => String(s || '').trim()).filter(Boolean);
            const caption = String(parsed.caption || '').trim();
            const hashtags = String(parsed.hashtags || '').trim();
            const out = {
                title: String(parsed.title || cleanKw).trim(),
                scenes,
                caption,
                hashtags,
                fullPost: [caption, hashtags].filter(Boolean).join('\n\n').trim()
            };
            caches.prompts.set(cacheKey, out);
            return out;
        });
    }

    async function generateRealisticVisualPrompts({ title, sceneTexts, signal }) {
        const cleanTexts = (sceneTexts || []).map((t) => String(t || '').trim()).filter(Boolean);
        const cacheKey = `prompts-v2:${hashString(title + '|' + cleanTexts.join('|'))}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        return dedupedCall(cacheKey, async () => {
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
            const parsed = safeExtractJsonFromText(raw);
            if (!Array.isArray(parsed) || parsed.length < cleanTexts.length) {
                throw new ApiError('INVALID_JSON', 'AI chưa trả về đủ gợi ý khung hình cho từng cảnh.');
            }
            const sliced = parsed.slice(0, cleanTexts.length);
            caches.prompts.set(cacheKey, sliced);
            return sliced;
        });
    }

    async function generateCartoonVisualPrompts({ title, beatTexts, storyboard, signal }) {
        const cleanTexts = (beatTexts || []).map((t) => String(t || '').trim()).filter(Boolean);
        if (cleanTexts.length === 0) return [];
        const cacheKey = `cartoon-prompts-v1:${hashString(title + '|' + cleanTexts.join('|'))}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        return dedupedCall(cacheKey, async () => {
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
            const parsed = safeExtractJsonFromText(raw);
            if (!Array.isArray(parsed) || parsed.length < cleanTexts.length) {
                throw new ApiError('INVALID_JSON', 'AI chưa trả về đủ mô tả hoạt hình 2D cho từng cảnh.');
            }
            const sliced = parsed.slice(0, cleanTexts.length);
            caches.prompts.set(cacheKey, sliced);
            return sliced;
        });
    }

    async function dumpContentTo2DScenes({ rawContent, titleHint = '', mode = 'preserve', visualStyle = 'motion', layouts, backdrops, props, actions, effects, casts, sfxList, screenTypes, signal } = {}) {
        const cleanRaw = String(rawContent || '').trim();
        if (!cleanRaw) {
            throw new ApiError('EMPTY_CONTENT', 'Vui lòng dán nội dung có sẵn trước khi tách cảnh.');
        }

        const layoutList = Array.isArray(layouts) && layouts.length > 0
            ? layouts
            : ['balance-scale', 'bar-compare', 'savings-jar-growth', 'calendar-alert', 'tech-formula-steps', 'journey-route', 'checklist-trio', 'wide-team', 'desk-closeup', 'two-shot-dialogue', 'back-monitors', 'hand-viewfinder', 'hand-pov', 'screen-pointer', 'laptop-popup', 'character-action', 'character-left', 'split-compare', 'multi-trio', 'thought-bubble', 'document-card', 'action-flow', 'center-hero', 'ui-window', 'ui-checklist', 'ui-flow', 'ui-grid-hero'];
        const backdropList = Array.isArray(backdrops) && backdrops.length > 0
            ? backdrops
            : ['warm-cream-stage', 'tech-dark-indigo', 'studio-focus', 'office-shelf', 'office-desk', 'work-late', 'gym-fresh', 'bank-vault', 'home-living', 'street-rain', 'warning-stage', 'bedroom-night', 'kitchen-cozy', 'cafe-chill', 'server-tech', 'cream-room', 'hills-nature', 'city-skyline', 'sunset-warm', 'mint-fresh', 'night-calm', 'alert-tint', 'grid-light', 'blueprint-dark'];
        const propList = Array.isArray(props) && props.length > 0
            ? props
            : ['scale_icon', 'hospital_card', 'bank_counter', 'speedometer', 'scissors_cut', 'umbrella', 'map_pin', 'formula_chip', 'ergo_chair', 'spine_back', 'empty_wallet', 'stretching_pose', 'price_tag', 'shopping_bag', 'house', 'envelope', 'jar', 'phone', 'lightbulb', 'clock', 'water_glass', 'plug_socket', 'laptop', 'card_doc', 'chart_bars', 'cash_stack'];
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
        const transitionList = ['cut', 'zoom-blur', 'diagonal-wipe'];

        const clampTag = (v, max = 16) => String(v || '').trim().slice(0, max);

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
- "scenes": Mảng 6 đến 15 phân cảnh, mỗi phần tử đại diện ĐÚNG 1 nhịp hình-tiếng (6-14 từ) kèm đầy đủ chỉ đạo diễn xuất 2D khớp chính xác từng câu chữ nói (CHỌN ĐÚNG THẾ GIỚI CHỦ ĐỀ — Công nghệ/Công thức dùng tech-dark-indigo + tech-formula-steps; Tài chính/Lương/So sánh dùng warm-cream-stage + balance-scale/bar-compare/savings-jar-growth/calendar-alert; Quãng đường dùng journey-route; Bếp/Gia đình dùng kitchen-cozy/home-living; Cảnh báo dùng warning-stage):
  + text: Câu lời thoại cho cảnh này.
  + visualSubject: Mô tả ngắn vật thể/hành động chính (6-14 từ).
  + roleTag: Nhãn vai RẤT NGẮN 1-2 từ nếu là lời nhân vật, không cần để "".
  + focusTag: Nhãn từ khóa RẤT NGẮN 1-3 từ nhấn mạnh (tuyệt đối KHÔNG viết câu dài), không cần để "".
  + diagramData: Object chứa số liệu/nhãn 1-3 từ RÚT TRỰC TIẾP TỪ CÂU NÓI để vẽ vào biểu đồ/cân/lịch/hũ ({ leftLabel, rightLabel, badgeA, badgeB, highlightNum }, tối đa 16 ký tự mỗi trường, không cần để "").
  + layout, backdrop, transition ("cut", "zoom-blur", "diagonal-wipe"), cast, action, stage2Action (động tác chuyển biến ở nửa sau câu), characterMood, stage2Mood, screenType, phase2Effect, effect, sfx, props (1-2 đạo cụ: props[0] đầu câu -> props[1] cuối câu), crossOut.`;

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
                                    diagramData: {
                                        type: 'OBJECT',
                                        properties: {
                                            leftLabel: { type: 'STRING' },
                                            rightLabel: { type: 'STRING' },
                                            badgeA: { type: 'STRING' },
                                            badgeB: { type: 'STRING' },
                                            highlightNum: { type: 'STRING' }
                                        }
                                    },
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

        const res = await fetchTextWithFallback(payload, { signal });
        const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = safeExtractJsonFromText(raw);
        if (parsed && Array.isArray(parsed.scenes) && parsed.scenes.length >= 2) {
            const sliced = parsed.scenes.slice(0, 16);
            const beatTexts = sliced.map((s) => String(s.text || '').trim()).filter(Boolean);
            const resolvedTitle = String(parsed.title || titleHint || beatTexts[0] || '').trim();
            const normalizedBoard = sliced.map((item, idx) => ({
                visualSubject: String(item.visualSubject || beatTexts[idx] || '').trim(),
                roleTag: String(item.roleTag || '').trim().slice(0, 22),
                focusTag: String(item.focusTag || '').trim().slice(0, 20),
                diagramData: item.diagramData && typeof item.diagramData === 'object' ? {
                    leftLabel: clampTag(item.diagramData.leftLabel),
                    rightLabel: clampTag(item.diagramData.rightLabel),
                    badgeA: clampTag(item.diagramData.badgeA),
                    badgeB: clampTag(item.diagramData.badgeB),
                    highlightNum: clampTag(item.diagramData.highlightNum)
                } : null,
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
            const cacheKey = `storyboard-v12:${hashString(resolvedTitle + '|' + visualStyle + '|' + beatTexts.join('|'))}`;
            caches.prompts.set(cacheKey, normalizedBoard);
            return { title: resolvedTitle, scenes: beatTexts, storyboard: normalizedBoard };
        }
        throw new ApiError('INVALID_JSON', 'AI chưa tách được cấu trúc phân cảnh 2D từ nội dung này.');
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

        const results = new Array(cleanBeats.length).fill(null);
        const missingIndices = [];
        cleanBeats.forEach((sc, idx) => {
            const key = `prop-svg-v4:${hashString(title + '|' + idx + '|' + sc + '|' + subjects[idx])}`;
            if (caches.images.has(key)) {
                results[idx] = caches.images.get(key);
            } else {
                missingIndices.push(idx);
            }
        });

        if (missingIndices.length === 0) return results;

        const visualMetaphorStyles = [
            'Pop-Art Comic Ink (nét viền mực đậm cá tính, màu tương phản mạnh vàng-cam-chàm, hiệu ứng tia chớp/chấm comic)',
            'Isometric 2.5D Diorama (góc nhìn khối 3D cắt lớp tinh xảo, đổ bóng mềm, chiều sâu không gian)',
            'Surreal Editorial Metaphor (ẩn dụ thị giác thông minh, ví dụ não phát sáng như bóng đèn, thời gian hóa thành tên lửa)',
            'Handcrafted Collage & Botanical Vector (nét hữu cơ mềm mại, mảng màu pastel rực rỡ, hình khối uốn lượn tự nhiên)',
            'Cyber-Tech Sci-Fi Blueprint (nét phát sáng neon cyan/tím trên chi tiết cơ khí/số hóa sắc sảo)',
            'Dynamic Manga Action Close-up (góc máy cận cảnh nghiêng góc 15 độ đầy kịch tính, bàn tay/biểu cảm phóng đại)'
        ];

        const buildScenePrompt = (indices) => {
            const itemLines = indices
                .map((idx) => {
                    const styleHint = visualMetaphorStyles[(hashString(title) + idx * 2) % visualMetaphorStyles.length];
                    return `- Cảnh ${idx + 1}/${cleanBeats.length} [Phong cách mỹ thuật RIÊNG: ${styleHint}]:
  + GIỌNG ĐỌC: "${cleanBeats[idx]}"
  + TRỌNG TÂM CẦN SÁNG TÁC: ${subjects[idx]}`;
                })
                .join('\n');
            return `Bạn là Giám Đốc Nghệ Thuật & Họa Sĩ 2D Đột Phá chuyên tạo TRẠNG THÁI CHUYỂN ĐỘNG 2 PHA (Stage 1 -> Stage 2) bằng Vector SVG trong suốt!
Tiêu đề video: "${title}".

NHIỆM VỤ SÁNG TÁC ĐỘC BẢN:
TUYỆT ĐỐI KHÔNG vẽ các biểu tượng rập khuôn nhàm chán (không lặp lại mấy hình tròn/thẻ chữ nhật đơn điệu). Với MỖI cảnh dưới đây, hãy tự sáng tác **2 hình SVG KHÁC NHAU RÕ RỆT** diễn tả sự biến đổi theo đúng vế đầu & vế sau của câu nói:
- \`stage1Svg\`: Hình vẽ VẾ ĐẦU (tình huống mở đầu / vấn đề / hành động ban đầu).
- \`stage2Svg\`: Hình vẽ VẾ SAU (bước ngoặt / phản ứng / giải pháp / ẩn dụ bất ngờ khi câu nói chuyển ý).
${itemLines}

YÊU CẦU KỸ THUẬT SVG NGHIÊM NGẶT:
1. Trả về mảng JSON đúng ${indices.length} object theo thứ tự: \`[ { "stage1Svg": "<svg...>...</svg>", "stage2Svg": "<svg...>...</svg>" } ]\`.
2. Mỗi chuỗi SVG dùng \`viewBox="0 0 340 340" width="340" height="340"\` hợp lệ XML.
3. NỀN TRONG SUỐT 100%: TUYỆT ĐỐI KHÔNG vẽ khung nền vuông phủ toàn bộ 340x340! Mọi chi tiết nằm gọn trong vùng giữa (x: 20..320, y: 20..320).
4. MỖI HÌNH PHẢI GIÀU SÁNG TẠO (18-36 path/circle/polygon có phối màu sáng-tối có gu, góc nghiêng & hình khối táo bạo, ẩn dụ hình ảnh thông minh đúng nghĩa đen & nghĩa bóng câu nói).
5. TUYỆT ĐỐI KHÔNG dùng thẻ <text>, <image>, <foreignObject>, <script>; ký tự "&" phải viết là "&amp;".`;
        };

        const storeSceneItem = (sceneIdx, item) => {
            const raw1 = typeof item === 'string' ? item : (item?.stage1Svg || item?.svg || '');
            const raw2 = typeof item === 'object' && item ? (item.stage2Svg || '') : '';
            const clean1 = sanitizeAndWrapSvg(raw1, '0 0 340 340', 340, 340);
            const clean2 = sanitizeAndWrapSvg(raw2, '0 0 340 340', 340, 340);
            if (!clean1) return false;
            const entry = {
                stage1Url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean1)}`,
                stage2Url: clean2 ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean2)}` : ''
            };
            results[sceneIdx] = entry;
            const key = `prop-svg-v4:${hashString(title + '|' + sceneIdx + '|' + cleanBeats[sceneIdx] + '|' + subjects[sceneIdx])}`;
            caches.images.set(key, entry);
            return true;
        };

        const fetchSvgChunk = async (indices) => {
            const payload = {
                contents: [{ parts: [{ text: buildScenePrompt(indices) }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                stage1Svg: { type: 'STRING' },
                                stage2Svg: { type: 'STRING' }
                            },
                            required: ['stage1Svg', 'stage2Svg']
                        }
                    }
                }
            };
            const res = await fetchTextWithFallback(payload, { signal });
            const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = safeExtractJsonFromText(raw);
            const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.svgs) ? parsed.svgs : null;
            if (Array.isArray(list)) {
                indices.forEach((sceneIdx, pos) => {
                    storeSceneItem(sceneIdx, list[pos]);
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

    // Generate completely bespoke, 3-layer animated 2D scenes per beat (100% unique environment, foreground & twist per topic)
    async function generateLayeredAiScenes({ title, beats, tone = 'viral', onProgress = null, signal } = {}) {
        const cleanBeats = (beats || []).map((b) => String(b?.text || b || '').trim()).filter(Boolean);
        if (cleanBeats.length === 0) return [];

        const results = new Array(cleanBeats.length).fill(null);
        const missingIndices = [];
        cleanBeats.forEach((sc, idx) => {
            const key = `layered-2d-v1:${tone}:${hashString(title + '|' + idx + '|' + sc + '|' + cleanBeats.length)}`;
            if (caches.images.has(key)) {
                results[idx] = caches.images.get(key);
            } else {
                missingIndices.push(idx);
            }
        });

        let doneCount = cleanBeats.length - missingIndices.length;
        if (onProgress) onProgress(doneCount, cleanBeats.length);
        if (missingIndices.length === 0) return results;

        const artDirectives = [
            'Editorial Storybook 2D với bảng màu điện ảnh ấm áp & chiều sâu nhiều lớp',
            'Pop-Art Comic hiện đại với mảng hình chéo tương phản rực rỡ & đường nét đậm',
            'Atmospheric Flat Vector không gian mở (bầu trời, ánh sáng, đổ bóng kiến trúc/thiên nhiên)',
            'Tối giản hình học táo bạo (Bold Bauhaus & Paper-Cutout layered shadows)',
            'Neon Synthwave / Futuristic Clean 2D với quầng sáng rực rỡ & đường nét sắc sảo',
            'Cận cảnh điện ảnh (Cinematic Close-up) với điểm nhấn thị giác lớn ở tiền cảnh'
        ];

        const validHeroMotions = ['float', 'bounce', 'slide-in', 'zoom-pop', 'tilt-swing', 'shake', 'rocket-rise'];
        const validStage2Motions = ['fly-in-right', 'drop-slam', 'orbit', 'pop-burst', 'slide-up'];
        const validCameraMoves = ['zoomIn', 'zoomOut', 'panLeft', 'panRight', 'sway'];
        const validParticles = ['sparkles', 'embers', 'bubbles', 'rain', 'stars', 'confetti', 'petals', 'code', 'none'];

        const fetchSingleScene = async (idx) => {
            if (signal && signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            const beatText = cleanBeats[idx];
            const prevHint = idx > 0 ? `Cảnh liền trước đã nói: "${cleanBeats[idx - 1].slice(0, 65)}" -> BẮT BUỘC đổi hẳn bối cảnh, màu sắc & góc nhìn!` : 'Cảnh mở đầu gây ấn tượng mạnh ngay lập tức!';
            const styleGuide = artDirectives[(hashString(title) + idx * 2) % artDirectives.length];

            const prompt = `Bạn là Họa sĩ & Đạo diễn Hoạt hình 2D ĐỘC BẢN. Hãy sáng tác RIÊNG cảnh ${idx + 1}/${cleanBeats.length} cho video "${title}" (Phong cách video: ${tone}).
LỜI THOẠI CẢNH NÀY: "${beatText}"
Định hướng mỹ thuật: ${styleGuide}
${prevHint}

YÊU CẦU TỐI THƯỢNG:
- TUYỆT ĐỐI KHÔNG dùng lại kiểu phòng văn phòng/bàn làm việc/con người chibi giống các video khác trừ khi câu nói thực sự nhắc tới. Chủ đề gì thì vẽ ĐÚNG thế giới đó (ẩm thực, lịch sử, thể thao, vũ trụ, thiên nhiên, công nghệ, tài chính, động vật, phố xá...).
- Tách làm 3 lớp SVG tách biệt để động cơ Canvas tự tạo chuyển động riêng cho từng lớp:
  1. \`bgSvg\` (viewBox="0 0 540 960", width="540", height="960"): Bối cảnh toàn màn hình đặc trưng cho CẢNH NÀY (bầu trời/gradient, ánh sáng, cảnh vật nền 10-20 khối path sắc nét, KHÔNG có nhân vật chính, KHÔNG viết chữ).
  2. \`heroSvg\` (viewBox="0 0 360 360", width="360", height="360", NỀN TRONG SUỐT 100%): Nhân vật/sinh vật/đối tượng trung tâm diễn tả VẾ ĐẦU của câu nói (12-24 path màu sắc sống động, viền #1e293b hoặc sáng tương phản, KHÔNG vẽ hình chữ nhật phủ nền, nằm gọn trong x:20..340, y:20..340).
  3. \`stage2Svg\` (viewBox="0 0 320 320", width="320", height="320", NỀN TRONG SUỐT 100%): Vật thể/ẩn dụ chuyển biến hoặc cao trào của VẾ SAU câu nói sẽ bay vào giữa chừng (8-18 path rõ nét, nằm trong x:20..300, y:20..300).
- TUYỆT ĐỐI KHÔNG dùng thẻ <text>, <image>, <foreignObject>, <script>; ký tự "&" viết là "&amp;".
- Chọn chuyển động khớp ngữ cảnh:
  + heroMotion: ${validHeroMotions.join(' | ')}
  + stage2Motion: ${validStage2Motions.join(' | ')}
  + cameraMove: ${validCameraMoves.join(' | ')}
  + particleFx: ${validParticles.join(' | ')}
  + emphasisWords: Từ khóa nhấn ngắn tối đa 16 ký tự (hoặc "" nếu không cần).
  + isDarkBg: true nếu nền bgSvg tối màu, false nếu sáng màu.
  + showHost: true CHỈ ở cảnh mở/kết cần người dẫn (còn lại để false để tranh toàn cảnh sạch đẹp).`;

            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            bgSvg: { type: 'STRING' },
                            heroSvg: { type: 'STRING' },
                            stage2Svg: { type: 'STRING' },
                            heroMotion: { type: 'STRING', enum: validHeroMotions },
                            stage2Motion: { type: 'STRING', enum: validStage2Motions },
                            cameraMove: { type: 'STRING', enum: validCameraMoves },
                            particleFx: { type: 'STRING', enum: validParticles },
                            emphasisWords: { type: 'STRING' },
                            isDarkBg: { type: 'BOOLEAN' },
                            showHost: { type: 'BOOLEAN' }
                        },
                        required: ['bgSvg', 'heroSvg', 'stage2Svg', 'heroMotion', 'stage2Motion', 'cameraMove', 'particleFx', 'isDarkBg', 'showHost']
                    }
                }
            };

            const res = await fetchTextWithFallback(payload, { signal });
            const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = safeExtractJsonFromText(raw);
            if (!parsed || typeof parsed !== 'object') return null;

            const cleanBg = sanitizeAndWrapSvg(parsed.bgSvg, '0 0 540 960', 540, 960);
            const cleanHero = sanitizeAndWrapSvg(parsed.heroSvg, '0 0 360 360', 360, 360);
            const cleanStage2 = sanitizeAndWrapSvg(parsed.stage2Svg, '0 0 320 320', 320, 320);
            if (!cleanBg && !cleanHero) return null;

            return {
                bgUrl: cleanBg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanBg)}` : '',
                heroUrl: cleanHero ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanHero)}` : '',
                stage2Url: cleanStage2 ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanStage2)}` : '',
                heroMotion: validHeroMotions.includes(parsed.heroMotion) ? parsed.heroMotion : 'float',
                stage2Motion: validStage2Motions.includes(parsed.stage2Motion) ? parsed.stage2Motion : 'pop-burst',
                cameraMove: validCameraMoves.includes(parsed.cameraMove) ? parsed.cameraMove : validCameraMoves[idx % validCameraMoves.length],
                particleFx: validParticles.includes(parsed.particleFx) ? parsed.particleFx : 'none',
                emphasisWords: String(parsed.emphasisWords || '').trim().slice(0, 18),
                isDarkBg: Boolean(parsed.isDarkBg),
                showHost: Boolean(parsed.showHost)
            };
        };

        // Process 2 scenes concurrently per wave to honor API_POLICY without overflowing tokens
        for (let i = 0; i < missingIndices.length; i += 2) {
            const pair = missingIndices.slice(i, i + 2);
            await Promise.all(
                pair.map(async (sceneIdx) => {
                    try {
                        const built = await fetchSingleScene(sceneIdx);
                        if (built) {
                            results[sceneIdx] = built;
                            const key = `layered-2d-v1:${tone}:${hashString(title + '|' + sceneIdx + '|' + cleanBeats[sceneIdx] + '|' + cleanBeats.length)}`;
                            caches.images.set(key, built);
                        }
                    } catch (err) {
                        if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                        console.warn(`Layered 2D scene ${sceneIdx + 1} skipped for retry:`, err.message);
                    } finally {
                        doneCount++;
                        if (onProgress) onProgress(doneCount, cleanBeats.length);
                    }
                })
            );
        }

        // Single retry pass for any scene that didn't parse cleanly on the first wave
        const stillMissing = missingIndices.filter((idx) => !results[idx]);
        for (const idx of stillMissing) {
            try {
                const retryBuilt = await fetchSingleScene(idx);
                if (retryBuilt) {
                    results[idx] = retryBuilt;
                    const key = `layered-2d-v1:${tone}:${hashString(title + '|' + idx + '|' + cleanBeats[idx] + '|' + cleanBeats.length)}`;
                    caches.images.set(key, retryBuilt);
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
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
            const cameraAngles = [
                'Góc nhìn toàn cảnh Isometric 2.5D từ trên chéo xuống',
                'Góc cận cảnh POV đôi tay & vật thể chính đầy kịch tính',
                'Bố cục chia đôi đường chéo Pop-Art (tương phản Trước vs Sau)',
                'Góc thấp ngước lên hoành tráng với tia sáng ngược chiều',
                'Khung truyện tranh đa lớp (Manga action panels + hiệu ứng tốc độ)',
                'Cảnh ẩn dụ siêu thực tinh tế (vật thể biến hóa kích thước phóng đại)'
            ];
            const sceneSpecs = chunkIndices
                .map((idx) => {
                    const prevHint = idx > 0 ? `(Cảnh trước: "${cleanScenes[idx - 1].slice(0, 50)}")` : '';
                    const angleHint = cameraAngles[(hashString(title) + idx) % cameraAngles.length];
                    return `- Cảnh ${idx + 1}/${cleanScenes.length} [Bắt buộc góc máy: ${angleHint} | Bảng màu: ${palettes[idx % palettes.length]}]: "${cleanScenes[idx]}" ${prevHint}`;
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
                const parsed = safeExtractJsonFromText(raw);
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

        // Single-scene retry for any frame whose batch parse/XML validation missed
        const stillMissing = missingIndices.filter((idx) => !results[idx]);
        for (const idx of stillMissing) {
            if (signal && signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            try {
                const retryPrompt = `Vẽ ĐÚNG 1 tranh minh họa SVG 2D (viewBox="0 0 540 960", width="540", height="960") hợp lệ XML, phong cách Flat Editorial sinh động, KHÔNG dùng <text>, khớp 100% câu nói: "${cleanScenes[idx]}" (Video: "${title}"). Bảng màu: ${palettes[idx % palettes.length]}. Trả về mảng JSON đúng 1 phần tử [ "<svg...>...</svg>" ].`;
                const payload = {
                    contents: [{ parts: [{ text: retryPrompt }] }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: { type: 'ARRAY', items: { type: 'STRING' } }
                    }
                };
                const res = await fetchTextWithFallback(payload, { signal });
                const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
                const parsed = safeExtractJsonFromText(raw);
                const svgCandidate = Array.isArray(parsed) ? parsed[0] : (typeof parsed?.svg === 'string' ? parsed.svg : raw);
                const clean = sanitizeAndWrapSvg(svgCandidate);
                if (clean) {
                    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
                    results[idx] = dataUrl;
                    const key = `svg:${tone}:${hashString(title + '|' + idx + '|' + cleanScenes[idx])}`;
                    caches.images.set(key, dataUrl);
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
            }
        }

        return results;
    }

    // Generate completely bespoke, 3-layer animated 2D scenes per beat (100% unique environment, foreground & twist per topic)
    async function generateLayeredAiScenes({ title, beats, tone = 'viral', onProgress = null, signal } = {}) {
        const cleanBeats = (beats || []).map((b) => String(b?.text || b || '').trim()).filter(Boolean);
        if (cleanBeats.length === 0) return [];

        const results = new Array(cleanBeats.length).fill(null);
        const missingIndices = [];
        cleanBeats.forEach((sc, idx) => {
            const key = `layered-2d-v1:${tone}:${hashString(title + '|' + idx + '|' + sc + '|' + cleanBeats.length)}`;
            if (caches.images.has(key)) {
                results[idx] = caches.images.get(key);
            } else {
                missingIndices.push(idx);
            }
        });

        let doneCount = cleanBeats.length - missingIndices.length;
        if (onProgress) onProgress(doneCount, cleanBeats.length);
        if (missingIndices.length === 0) return results;

        const artDirectives = [
            'Editorial Storybook 2D với bảng màu điện ảnh ấm áp & chiều sâu nhiều lớp',
            'Pop-Art Comic hiện đại với mảng hình chéo tương phản rực rỡ & đường nét đậm',
            'Atmospheric Flat Vector không gian mở (bầu trời, ánh sáng, đổ bóng kiến trúc/thiên nhiên)',
            'Tối giản hình học táo bạo (Bold Bauhaus & Paper-Cutout layered shadows)',
            'Neon Synthwave / Futuristic Clean 2D với quầng sáng rực rỡ & đường nét sắc sảo',
            'Cận cảnh điện ảnh (Cinematic Close-up) với điểm nhấn thị giác lớn ở tiền cảnh'
        ];

        const validHeroMotions = ['float', 'bounce', 'slide-in', 'zoom-pop', 'tilt-swing', 'shake', 'rocket-rise'];
        const validStage2Motions = ['fly-in-right', 'drop-slam', 'orbit', 'pop-burst', 'slide-up'];
        const validCameraMoves = ['zoomIn', 'zoomOut', 'panLeft', 'panRight', 'sway'];
        const validParticles = ['sparkles', 'embers', 'bubbles', 'rain', 'stars', 'confetti', 'petals', 'code', 'none'];

        const fetchSingleScene = async (idx) => {
            if (signal && signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            const beatText = cleanBeats[idx];
            const prevHint = idx > 0 ? `Cảnh liền trước đã nói: "${cleanBeats[idx - 1].slice(0, 65)}" -> BẮT BUỘC đổi hẳn bối cảnh, màu sắc & góc nhìn!` : 'Cảnh mở đầu gây ấn tượng mạnh ngay lập tức!';
            const styleGuide = artDirectives[(hashString(title) + idx * 2) % artDirectives.length];

            const prompt = `Bạn là Họa sĩ & Đạo diễn Hoạt hình 2D ĐỘC BẢN. Hãy sáng tác RIÊNG cảnh ${idx + 1}/${cleanBeats.length} cho video "${title}" (Phong cách video: ${tone}).
LỜI THOẠI CẢNH NÀY: "${beatText}"
Định hướng mỹ thuật: ${styleGuide}
${prevHint}

YÊU CẦU TỐI THƯỢNG:
- TUYỆT ĐỐI KHÔNG dùng lại kiểu phòng văn phòng/bàn làm việc/con người chibi giống các video khác trừ khi câu nói thực sự nhắc tới. Chủ đề gì thì vẽ ĐÚNG thế giới đó (ẩm thực, lịch sử, thể thao, vũ trụ, thiên nhiên, công nghệ, tài chính, động vật, phố xá...).
- Tách làm 3 lớp SVG tách biệt để động cơ Canvas tự tạo chuyển động riêng cho từng lớp:
  1. \`bgSvg\` (viewBox="0 0 540 960", width="540", height="960"): Bối cảnh toàn màn hình đặc trưng cho CẢNH NÀY (bầu trời/gradient, ánh sáng, cảnh vật nền 10-20 khối path sắc nét, KHÔNG có nhân vật chính, KHÔNG viết chữ).
  2. \`heroSvg\` (viewBox="0 0 360 360", width="360", height="360", NỀN TRONG SUỐT 100%): Nhân vật/sinh vật/đối tượng trung tâm diễn tả VẾ ĐẦU của câu nói (12-24 path màu sắc sống động, viền #1e293b hoặc sáng tương phản, KHÔNG vẽ hình chữ nhật phủ nền, nằm gọn trong x:20..340, y:20..340).
  3. \`stage2Svg\` (viewBox="0 0 320 320", width="320", height="320", NỀN TRONG SUỐT 100%): Vật thể/ẩn dụ chuyển biến hoặc cao trào của VẾ SAU câu nói sẽ bay vào giữa chừng (8-18 path rõ nét, nằm trong x:20..300, y:20..300).
- TUYỆT ĐỐI KHÔNG dùng thẻ <text>, <image>, <foreignObject>, <script>; ký tự "&" viết là "&amp;".
- Chọn chuyển động khớp ngữ cảnh:
  + heroMotion: ${validHeroMotions.join(' | ')}
  + stage2Motion: ${validStage2Motions.join(' | ')}
  + cameraMove: ${validCameraMoves.join(' | ')}
  + particleFx: ${validParticles.join(' | ')}
  + emphasisWords: Từ khóa nhấn ngắn tối đa 16 ký tự (hoặc "" nếu không cần).
  + isDarkBg: true nếu nền bgSvg tối màu, false nếu sáng màu.
  + showHost: true CHỈ ở cảnh mở/kết cần người dẫn (còn lại để false để tranh toàn cảnh sạch đẹp).`;

            const payload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'OBJECT',
                        properties: {
                            bgSvg: { type: 'STRING' },
                            heroSvg: { type: 'STRING' },
                            stage2Svg: { type: 'STRING' },
                            heroMotion: { type: 'STRING', enum: validHeroMotions },
                            stage2Motion: { type: 'STRING', enum: validStage2Motions },
                            cameraMove: { type: 'STRING', enum: validCameraMoves },
                            particleFx: { type: 'STRING', enum: validParticles },
                            emphasisWords: { type: 'STRING' },
                            isDarkBg: { type: 'BOOLEAN' },
                            showHost: { type: 'BOOLEAN' }
                        },
                        required: ['bgSvg', 'heroSvg', 'stage2Svg', 'heroMotion', 'stage2Motion', 'cameraMove', 'particleFx', 'isDarkBg', 'showHost']
                    }
                }
            };

            const res = await fetchTextWithFallback(payload, { signal });
            const raw = res?.candidates?.[0]?.content?.parts?.[0]?.text;
            const parsed = safeExtractJsonFromText(raw);
            if (!parsed || typeof parsed !== 'object') return null;

            const cleanBg = sanitizeAndWrapSvg(parsed.bgSvg, '0 0 540 960', 540, 960);
            const cleanHero = sanitizeAndWrapSvg(parsed.heroSvg, '0 0 360 360', 360, 360);
            const cleanStage2 = sanitizeAndWrapSvg(parsed.stage2Svg, '0 0 320 320', 320, 320);
            if (!cleanBg && !cleanHero) return null;

            return {
                bgUrl: cleanBg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanBg)}` : '',
                heroUrl: cleanHero ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanHero)}` : '',
                stage2Url: cleanStage2 ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cleanStage2)}` : '',
                heroMotion: validHeroMotions.includes(parsed.heroMotion) ? parsed.heroMotion : 'float',
                stage2Motion: validStage2Motions.includes(parsed.stage2Motion) ? parsed.stage2Motion : 'pop-burst',
                cameraMove: validCameraMoves.includes(parsed.cameraMove) ? parsed.cameraMove : validCameraMoves[idx % validCameraMoves.length],
                particleFx: validParticles.includes(parsed.particleFx) ? parsed.particleFx : 'none',
                emphasisWords: String(parsed.emphasisWords || '').trim().slice(0, 18),
                isDarkBg: Boolean(parsed.isDarkBg),
                showHost: Boolean(parsed.showHost)
            };
        };

        // Process 2 scenes concurrently per wave to honor API_POLICY without overflowing tokens
        for (let i = 0; i < missingIndices.length; i += 2) {
            const pair = missingIndices.slice(i, i + 2);
            await Promise.all(
                pair.map(async (sceneIdx) => {
                    try {
                        const built = await fetchSingleScene(sceneIdx);
                        if (built) {
                            results[sceneIdx] = built;
                            const key = `layered-2d-v1:${tone}:${hashString(title + '|' + sceneIdx + '|' + cleanBeats[sceneIdx] + '|' + cleanBeats.length)}`;
                            caches.images.set(key, built);
                        }
                    } catch (err) {
                        if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                        console.warn(`Layered 2D scene ${sceneIdx + 1} skipped for retry:`, err.message);
                    } finally {
                        doneCount++;
                        if (onProgress) onProgress(doneCount, cleanBeats.length);
                    }
                })
            );
        }

        // Single retry pass for any scene that didn't parse cleanly on the first wave
        const stillMissing = missingIndices.filter((idx) => !results[idx]);
        for (const idx of stillMissing) {
            try {
                const retryBuilt = await fetchSingleScene(idx);
                if (retryBuilt) {
                    results[idx] = retryBuilt;
                    const key = `layered-2d-v1:${tone}:${hashString(title + '|' + idx + '|' + cleanBeats[idx] + '|' + cleanBeats.length)}`;
                    caches.images.set(key, retryBuilt);
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
            }
        }

        return results;
    }

    async function generateMultiBeatStoryboard({ title, beatTexts, layouts, backdrops, props, actions, effects, casts, sfxList, screenTypes, visualStyle = 'motion', signal }) {
        const cleanBeats = (beatTexts || []).map((b) => String(b || '').trim()).filter(Boolean);
        if (cleanBeats.length === 0) return null;

        const cacheKey = `storyboard-v12:${hashString(title + '|' + visualStyle + '|' + cleanBeats.join('|'))}`;
        if (caches.prompts.has(cacheKey)) {
            return caches.prompts.get(cacheKey);
        }

        const layoutList = Array.isArray(layouts) && layouts.length > 0
            ? layouts
            : ['balance-scale', 'bar-compare', 'savings-jar-growth', 'calendar-alert', 'tech-formula-steps', 'journey-route', 'checklist-trio', 'wide-team', 'desk-closeup', 'two-shot-dialogue', 'back-monitors', 'hand-viewfinder', 'hand-pov', 'screen-pointer', 'laptop-popup', 'character-action', 'character-left', 'split-compare', 'multi-trio', 'thought-bubble', 'document-card', 'action-flow', 'center-hero', 'ui-window', 'ui-checklist', 'ui-flow', 'ui-grid-hero'];
        const backdropList = Array.isArray(backdrops) && backdrops.length > 0
            ? backdrops
            : ['warm-cream-stage', 'tech-dark-indigo', 'studio-focus', 'office-shelf', 'office-desk', 'work-late', 'gym-fresh', 'bank-vault', 'home-living', 'street-rain', 'warning-stage', 'bedroom-night', 'kitchen-cozy', 'cafe-chill', 'server-tech', 'cream-room', 'hills-nature', 'city-skyline', 'sunset-warm', 'mint-fresh', 'night-calm', 'alert-tint', 'grid-light', 'blueprint-dark'];
        const propList = Array.isArray(props) && props.length > 0
            ? props
            : ['scale_icon', 'hospital_card', 'bank_counter', 'speedometer', 'scissors_cut', 'umbrella', 'map_pin', 'formula_chip', 'ergo_chair', 'spine_back', 'empty_wallet', 'stretching_pose', 'price_tag', 'shopping_bag', 'house', 'envelope', 'jar', 'phone', 'lightbulb', 'clock', 'water_glass', 'plug_socket', 'laptop', 'card_doc', 'chart_bars', 'cash_stack'];
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
        const transitionList = ['cut', 'zoom-blur', 'diagonal-wipe'];
        const clampTag = (v, max = 16) => String(v || '').trim().slice(0, max);

        return dedupedCall(cacheKey, async () => {
            try {
                const numberedBeats = cleanBeats.map((b, i) => `${i + 1}. "${b}"`).join('\n');
                const isUiMode = visualStyle === 'ui-motion';
                const styleDirective = isUiMode
                    ? `PHONG CÁCH HIỆN ĐẠI DOT-GRID & DATA MOTION UI:
- Ưu tiên các bố cục [tech-formula-steps, back-monitors, bar-compare, checklist-trio, ui-window, ui-checklist, ui-flow, ui-grid-hero]. KHÔNG lặp cùng layout 2 cảnh liền nhau.
- backdrop: Chọn từ [grid-light, tech-dark-indigo, blueprint-dark, studio-focus, mint-fresh].
- Dùng transition="diagonal-wipe" hoặc "zoom-blur" ở các bước chuyển ý lớn.`
                    : `PHONG CÁCH HOẠT HÌNH 2D CHỦ ĐỀ CHUYÊN NGHIỆP (CHỌN ĐÚNG THẾ GIỚI CHO TỪNG CHỦ ĐỀ):
- PHÂN BIỆT RÕ TỪNG THẾ GIỚI CHỦ ĐỀ (KHÔNG RẬP KHUÔN 1 STYLE):
  + Chủ đề Tech / Mạng / Công thức / Thuật toán / Code: dùng [tech-dark-indigo, blueprint-dark, server-tech] & [tech-formula-steps, bar-compare, back-monitors, checklist-trio] + props [formula_chip, laptop].
  + Chủ đề Tài chính / Tiết kiệm / Thu chi / Mua sắm: dùng [warm-cream-stage, bank-vault, mint-fresh] & [balance-scale, bar-compare, savings-jar-growth, calendar-alert, journey-route, split-compare].
  + Chủ đề Nấu ăn / Gia đình / Mẹo vặt nhà cửa: dùng [kitchen-cozy, home-living, cream-room] & [character-action, character-left, hand-viewfinder, split-compare, checklist-trio, multi-trio] (TUYỆT ĐỐI KHÔNG dùng office-shelf, wide-team, desk-closeup!).
  + Chủ đề Cảnh báo / Lừa đảo / An toàn: dùng [warning-stage, alert-tint, work-late] & [hand-viewfinder, hand-pov, split-compare, calendar-alert, character-action].
  + Chủ đề Nhạc / Mood / Mini Vlog / Du lịch / Quê hương: dùng [cafe-chill, hills-nature, street-rain, city-skyline, night-calm] + [journey-route, character-left, center-hero].
  + Chủ đề Sức khỏe / Giãn cơ / Nhắc nhở: dùng [gym-fresh, mint-fresh, home-living, bedroom-night (chỉ khi nói về giấc ngủ)].
  + Chủ đề Công sở / MKT / Sale: dùng đa góc máy [wide-team, desk-closeup, two-shot-dialogue, back-monitors, screen-pointer, checklist-trio].
- Đổi góc máy (layout) và transition ("cut", "zoom-blur", "diagonal-wipe") liên tục: TUYỆT ĐỐI KHÔNG dùng lại cùng \`layout\`, \`props[0]\` hay \`cast\` trong 2-3 cảnh liên tiếp (chuyển nhịp điện ảnh: nhân vật cận mặt -> góc nhìn tay cầm đồ -> biểu đồ/cân so sánh -> toàn cảnh/hành động -> thẻ 3 bước) để mỗi cảnh là 1 khung hình hoàn toàn mới mẻ.`;

                const prompt = `Bạn là Đạo diễn Hoạt Hình 2D chuyên dựng phim ngắn hành động khớp chặt từng câu chữ lời thoại (KHÔNG viết câu phụ đề dài lên video).
Tiêu đề tổng thể: "${title}"
Danh sách ${cleanBeats.length} nhịp lời thoại theo thứ tự:
${numberedBeats}

${styleDirective}

Hãy phân cảnh ĐÚNG ${cleanBeats.length} cảnh (mỗi câu nói 1 phân cảnh riêng) khớp 100% ý nghĩa câu nói:
- visualSubject: Mô tả ngắn 6-14 từ vật thể/tình huống trung tâm cần vẽ minh họa.
- roleTag: Nhãn vai nhân vật RẤT NGẮN 1-2 từ nếu đang đối thoại/giải thích, không cần để rỗng "".
- focusTag: Nhãn từ khóa RẤT NGẮN 1-3 từ nhấn mạnh, không cần để rỗng "".
- diagramData: Object trích xuất trực tiếp con số / nhãn 1-3 từ từ câu nói để vẽ lên biểu đồ/cân/lịch/hũ ({ leftLabel, rightLabel, badgeA, badgeB, highlightNum }, mỗi trường tối đa 16 ký tự).
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
- props: Mảng 1-2 đạo cụ vẽ trực tiếp vật được nhắc tới trong câu (hướng dẫn: scale_icon=cân so sánh, jar/locked_jar=hũ tiền tiết kiệm, hospital_card=bệnh viện/viện phí, bank_counter=quầy ngân hàng/rút tiền, speedometer=tốc độ, scissors_cut=cắt giảm, umbrella=ô che mưa, map_pin=lộ trình bản đồ, formula_chip=công thức/bit/mã, ergo_chair=ghế ngồi, spine_back=cột sống/đau lưng, empty_wallet=ví hết tiền, stretching_pose=giãn cơ, price_tag=giá tiền, shopping_bag=mua sắm, house=ngôi nhà, bus=xe buýt, scooter=xe máy, envelope=phong bì lương, cash_stack=tiền mặt, coin=đồng xu, card_doc=tài liệu/danh sách, chart_bars=biểu đồ, rice_bowl=bữa ăn, coffee_cup=cà phê/trà, water_glass=ly nước, heart=tim/cảm xúc, cake=sinh nhật, gift_box=quà tặng, phone=điện thoại/tin nhắn, scam_link=link lừa đảo, plug_socket=ổ điện, battery=pin, padlock=khóa bảo mật, fire_flame=cháy/khẩn cấp, warning_triangle=cảnh báo, clock=thời gian, calendar=lịch tháng/ngày, lightbulb=ý tưởng, music_bars=âm nhạc, sleep_bed=giường ngủ, laptop=máy tính/code, megaphone=quảng cáo/loa, target_kpi=mục tiêu, speech_drama=hội thoại) từ [${propList.join(', ')}].
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
                                    diagramData: {
                                        type: 'OBJECT',
                                        properties: {
                                            leftLabel: { type: 'STRING' },
                                            rightLabel: { type: 'STRING' },
                                            badgeA: { type: 'STRING' },
                                            badgeB: { type: 'STRING' },
                                            highlightNum: { type: 'STRING' }
                                        }
                                    },
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
                const parsed = safeExtractJsonFromText(raw);
                if (Array.isArray(parsed) && parsed.length >= cleanBeats.length) {
                    const normalized = parsed.slice(0, cleanBeats.length).map((item, idx) => ({
                        visualSubject: String(item.visualSubject || cleanBeats[idx] || '').trim(),
                        roleTag: String(item.roleTag || '').trim().slice(0, 22),
                        focusTag: String(item.focusTag || '').trim().slice(0, 20),
                        diagramData: item.diagramData && typeof item.diagramData === 'object' ? {
                            leftLabel: clampTag(item.diagramData.leftLabel),
                            rightLabel: clampTag(item.diagramData.rightLabel),
                            badgeA: clampTag(item.diagramData.badgeA),
                            badgeB: clampTag(item.diagramData.badgeB),
                            highlightNum: clampTag(item.diagramData.highlightNum)
                        } : null,
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
                throw new ApiError('INVALID_JSON', 'AI chưa trả về đủ phân cảnh storyboard cho video.');
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                throw err;
            }
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

    // Generate the ENTIRE script in 1 single TTS API call for 100% consistent voice, tone & natural flow
    async function fetchCombinedTtsPcm({ texts, voiceName, ttsModel, signal }) {
        const cleanTexts = (texts || [])
            .map((t) => String(t || '').trim())
            .filter(Boolean);
        if (cleanTexts.length === 0) return { buffer: null, fromCache: false, rateLimited: false };

        const voice = voiceName || 'Aoede';
        const targetModel = ttsModel || MODELS.TTS;
        const cacheKey = `tts-batch-v2:${targetModel}:${voice}:${hashString(cleanTexts.join('|'))}`;

        if (caches.ttsPcm.has(cacheKey)) {
            const cached = caches.ttsPcm.get(cacheKey);
            return {
                buffer: cached?.buffer || cached,
                mimeType: cached?.mimeType || 'audio/wav',
                fromCache: true,
                rateLimited: false
            };
        }

        return dedupedCall(cacheKey, async () => {
            try {
                // Gemini 3.8 TTS strictly expects clean verbatim transcript (zero prompt wrapper!)
                const formattedBody = cleanTexts
                    .map((t) => (/[.!?…]$/.test(t) ? t : `${t}.`))
                    .join('\n\n');

                const payload = {
                    contents: [
                        {
                            parts: [
                                {
                                    text: formattedBody
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
                    const mimeType = part.inlineData.mimeType || 'audio/wav';
                    caches.ttsPcm.set(cacheKey, { buffer: pcmBuffer, mimeType });
                    return { buffer: pcmBuffer, mimeType, fromCache: false, rateLimited: false };
                }
            } catch (err) {
                if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                const isRateLimited = err.code === 'RATE_LIMITED' || err.code === 'QUOTA_EXHAUSTED' || err.status === 429;
                console.warn('Combined TTS failed:', err.message);
                return { buffer: null, fromCache: false, rateLimited: isRateLimited, errorReason: err.message };
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

        // Keep WebSocket sessions cohesive (up to 6 chapters) to minimize speaker shifts across reconnects
        const MAX_TURNS_PER_SESSION = 6;
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
        const parsed = safeExtractJsonFromText(raw);
        if (!parsed?.caption || !parsed?.hashtags) {
            throw new ApiError('INVALID_JSON', 'AI chưa trả về Caption và Hashtag hợp lệ.');
        }
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

    function stripHtmlToPlain(htmlStr) {
        return String(htmlStr || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function pickCategoryFromNewsText(text, niche = 'all') {
        const lower = String(text || '').toLowerCase();
        if (niche === 'tech' || /\bai\b|công nghệ|chip|phần mềm|bảo mật|mạng/.test(lower)) return 'career';
        if (niche === 'finance' || /lừa đảo|cảnh báo|ngân hàng|otp/.test(lower)) return /lừa đảo|cảnh báo/.test(lower) ? 'warning' : 'finance';
        if (niche === 'health' || /sức khỏe|ngủ|dinh dưỡng|bác sĩ|y tế/.test(lower)) return 'reminder';
        if (/văn phòng|lương|việc làm|nhân sự|công sở/.test(lower)) return 'office';
        return 'lifehack';
    }

    async function fetchPublicRssTrends({ niche = 'all', signal } = {}) {
        const gnewsMap = {
            all: 'https://news.google.com/rss?hl=vi&gl=VN&ceid=VN:vi',
            tech: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=vi&gl=VN&ceid=VN:vi',
            finance: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=vi&gl=VN&ceid=VN:vi',
            health: 'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=vi&gl=VN&ceid=VN:vi',
            social: 'https://news.google.com/rss/search?q=xu+h%C6%B0%E1%BB%9Bng+vi%E1%BB%87t+nam+h%C3%B4m+nay&hl=vi&gl=VN&ceid=VN:vi'
        };
        const vnexpressMap = {
            all: 'https://vnexpress.net/rss/tin-moi-nhat.rss',
            tech: 'https://vnexpress.net/rss/so-hoa.rss',
            finance: 'https://vnexpress.net/rss/kinh-doanh.rss',
            health: 'https://vnexpress.net/rss/suc-khoe.rss',
            social: 'https://vnexpress.net/rss/doi-song.rss'
        };

        const feedUrls = [gnewsMap[niche] || gnewsMap.all, vnexpressMap[niche] || vnexpressMap.all];

        for (const rssUrl of feedUrls) {
            // 1. Primary CORS JSON bridge (no API key needed)
            try {
                const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
                const res = await fetch(apiUrl, { signal });
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data?.items) && data.items.length > 0) {
                        const cleanItems = data.items
                            .map((it) => {
                                const rawTitle = stripHtmlToPlain(it.title || '');
                                const parts = rawTitle.split(/\s+[-–]\s+/);
                                const cleanTitle = parts.length > 1 ? parts.slice(0, -1).join(' - ').trim() : rawTitle;
                                const publisher = parts.length > 1 ? parts[parts.length - 1].trim() : 'Báo chí Việt Nam';
                                const desc = stripHtmlToPlain(it.description || it.content || '');
                                return {
                                    rawTitle: cleanTitle,
                                    publisher,
                                    desc: desc && desc !== cleanTitle ? desc : cleanTitle,
                                    url: String(it.link || '').trim(),
                                    pubDate: String(it.pubDate || '').trim()
                                };
                            })
                            .filter((x) => x.rawTitle && quickLocalPolicyScan(`${x.rawTitle} ${x.desc}`).status === 'safe')
                            .slice(0, 6);
                        if (cleanItems.length > 0) return cleanItems;
                    }
                }
            } catch (err) {
                if (err.name === 'AbortError') throw err;
            }

            // 2. XML CORS fallback via allorigins
            if (typeof global.DOMParser !== 'undefined') {
                try {
                    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}`;
                    const res = await fetch(proxyUrl, { signal });
                    if (res.ok) {
                        const xmlText = await res.text();
                        const doc = new global.DOMParser().parseFromString(xmlText, 'text/xml');
                        const nodes = Array.from(doc.querySelectorAll('item')).slice(0, 8);
                        const parsed = nodes
                            .map((node) => {
                                const rawTitle = stripHtmlToPlain(node.querySelector('title')?.textContent || '');
                                const parts = rawTitle.split(/\s+[-–]\s+/);
                                const cleanTitle = parts.length > 1 ? parts.slice(0, -1).join(' - ').trim() : rawTitle;
                                const publisher = parts.length > 1 ? parts[parts.length - 1].trim() : 'VnExpress / Google News';
                                const desc = stripHtmlToPlain(node.querySelector('description')?.textContent || '');
                                const link = stripHtmlToPlain(node.querySelector('link')?.textContent || '');
                                return {
                                    rawTitle: cleanTitle,
                                    publisher,
                                    desc: desc || cleanTitle,
                                    url: link,
                                    pubDate: stripHtmlToPlain(node.querySelector('pubDate')?.textContent || '')
                                };
                            })
                            .filter((x) => x.rawTitle && quickLocalPolicyScan(`${x.rawTitle} ${x.desc}`).status === 'safe')
                            .slice(0, 6);
                        if (parsed.length > 0) return parsed;
                    }
                } catch (err) {
                    if (err.name === 'AbortError') throw err;
                }
            }
        }
        return [];
    }

    function buildKeylessTrendCards(rssItems, niche, todayIso, todayDisplay) {
        return rssItems.slice(0, 4).map((it, idx) => {
            const summary = it.desc.length > 170 ? `${it.desc.slice(0, 167)}...` : it.desc;
            const cleanTitle = it.rawTitle.length > 95 ? `${it.rawTitle.slice(0, 92)}...` : it.rawTitle;
            return {
                id: `trend-rss-${todayIso}-${niche}-${idx}`,
                dateDisplay: todayDisplay,
                title: cleanTitle,
                category: pickCategoryFromNewsText(`${cleanTitle} ${summary}`, niche),
                factSummary: summary,
                sourceNote: `${it.publisher || 'Báo chí Việt Nam'} (Tin cập nhật hôm nay)`,
                hook: `Tin mới hôm nay: ${cleanTitle}`,
                scenes: [
                    `Điểm tin nổi bật hôm nay: ${cleanTitle}.`,
                    summary && summary !== cleanTitle ? summary : `Thông tin vừa được ${it.publisher || 'báo chí chính thống'} cập nhật mới nhất.`,
                    'Điều đáng chú ý nhất là tác động trực tiếp đến thói quen hằng ngày của nhiều người.',
                    'Khi theo dõi tin mới, hãy luôn kiểm chứng từ báo chí chính thống trước khi chia sẻ.',
                    'Lưu lại ý chính này để áp dụng và chủ động hơn trong công việc lẫn cuộc sống.',
                    'Bạn nghĩ sao về thông tin hôm nay? Để lại bình luận và theo dõi kênh nhé!'
                ],
                hashtags: '#tinnong #tinthoisu #reelsvn #capnhatmoingay',
                sources: /^https?:\/\//i.test(it.url) ? [{ title: it.publisher || cleanTitle.slice(0, 50), url: it.url }] : [],
                grounded: true,
                sourceType: 'rss-free'
            };
        });
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
            const hasKey = Boolean(getApiKey());

            // Path 1: Free Gemini API Key + Google Search Grounding (across user's Free models)
            if (hasKey) {
                const candidates = [MODELS.TEXT, ...(MODELS.TEXT_FALLBACKS || [])].filter(Boolean);
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
                                grounded: webSources.length > 0,
                                sourceType: 'gemini-search'
                            })).filter((x) => x.title && x.scenes.length >= 2);

                            if (normalized.length > 0) {
                                const out = { dateDisplay: todayDisplay, items: normalized, grounded: webSources.length > 0, sourceType: 'gemini-search' };
                                caches.prompts.set(cacheKey, out);
                                return out;
                            }
                        }
                    } catch (err) {
                        if (err.name === 'AbortError' || err.code === 'INVALID_API_KEY') throw err;
                        console.warn(`Daily trends grounding on ${modelName} fallback to public RSS:`, err.message);
                    }
                }
            }

            // Path 2: 100% Free Public RSS Feeds (Google News VN / VnExpress) — works even WITHOUT Gemini API Key
            // or when Gemini Search Grounding isn't enabled on Free Tier!
            const rssItems = await fetchPublicRssTrends({ niche, signal });
            if (rssItems.length > 0) {
                // If user HAS a Free Gemini text Key, polish the real RSS news into crisp 6-scene 2D stories without inventing facts!
                if (hasKey) {
                    try {
                        const rssDigest = rssItems
                            .slice(0, 4)
                            .map((r, i) => `${i + 1}. Tiêu đề: "${r.rawTitle}" | Nguồn: ${r.publisher} | Tóm tắt: "${r.desc}"`)
                            .join('\n');
                        const formatPrompt = `Hôm nay là ${todayDisplay}. Dưới đây là 4 tin tức CÓ THẬT vừa lấy từ báo chí Việt Nam:
${rssDigest}

${CREATOR_ETHICS_AND_POLICY_RULE}
Hãy chuyển thể CHÍNH XÁC 4 tin trên thành 4 kịch bản Reels ngắn trung thực (KHÔNG bịa thêm số liệu ngoài bản tin) dạng mảng JSON gồm:
- "title", "category" (1 trong [office, career, finance, humor, lifehack, warning, reminder, music, vlog, bts]), "factSummary", "sourceNote", "hook", "scenes" (mảng 6 câu thoại ngắn 8-16 từ), "hashtags".`;

                        const textPayload = {
                            contents: [{ parts: [{ text: formatPrompt }] }],
                            generationConfig: { responseMimeType: 'application/json' }
                        };
                        const aiRes = await fetchTextWithFallback(textPayload, { signal });
                        const aiRaw = aiRes?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        const aiParsed = safeExtractJsonFromText(aiRaw);
                        if (Array.isArray(aiParsed) && aiParsed.length > 0) {
                            const formattedItems = aiParsed.slice(0, 4).map((item, idx) => {
                                const srcItem = rssItems[idx] || rssItems[0];
                                return {
                                    id: `trend-rss-ai-${todayIso}-${niche}-${idx}`,
                                    dateDisplay: todayDisplay,
                                    title: String(item.title || srcItem.rawTitle).trim(),
                                    category: String(item.category || pickCategoryFromNewsText(srcItem.rawTitle, niche)).trim(),
                                    factSummary: String(item.factSummary || srcItem.desc).trim(),
                                    sourceNote: String(item.sourceNote || srcItem.publisher).trim(),
                                    hook: String(item.hook || srcItem.rawTitle).trim(),
                                    scenes: Array.isArray(item.scenes) && item.scenes.length >= 2
                                        ? item.scenes.map((s) => String(s || '').trim()).filter(Boolean)
                                        : buildKeylessTrendCards([srcItem], niche, todayIso, todayDisplay)[0].scenes,
                                    hashtags: String(item.hashtags || '#tinnong #reelsvn #xuhuong').trim(),
                                    sources: /^https?:\/\//i.test(srcItem.url) ? [{ title: srcItem.publisher || 'Bài viết gốc', url: srcItem.url }] : [],
                                    grounded: true,
                                    sourceType: 'rss-gemini-free'
                                };
                            });
                            const out = { dateDisplay: todayDisplay, items: formattedItems, grounded: true, sourceType: 'rss-gemini-free' };
                            caches.prompts.set(cacheKey, out);
                            return out;
                        }
                    } catch (aiErr) {
                        if (aiErr.name === 'AbortError') throw aiErr;
                        console.warn('RSS + Gemini Free format fallback to pure RSS cards:', aiErr.message);
                    }
                }

                const keylessItems = buildKeylessTrendCards(rssItems, niche, todayIso, todayDisplay);
                const out = { dateDisplay: todayDisplay, items: keylessItems, grounded: true, sourceType: 'rss-free' };
                caches.prompts.set(cacheKey, out);
                return out;
            }

            throw new ApiError('SERVER_ERROR', 'Không thể kết nối nguồn tin nóng hoặc Google Search lúc này. Vui lòng thử lại sau.');
        });
    }

    async function auditScriptPolicyAndFacts({ title = '', scenes = [], signal } = {}) {
        const cleanScenes = (scenes || []).map((s) => String(s || '').trim()).filter(Boolean);
        const combined = [title, ...cleanScenes].filter(Boolean).join('\n');
        const localScan = quickLocalPolicyScan(combined);

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
        discoverAvailableTextModels,
        dumpFreshScripts,
        dumpTopicToStudioContent,
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
        generateLayeredAiScenes,
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
