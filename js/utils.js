/* ==========================================================================
   Shared Pure Utilities
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});

    const HTML_ESCAPE_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
    }

    function debounce(fn, wait = 200) {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function hashString(str) {
        let hash = 2166136261;
        const input = String(str || '');
        for (let i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    const safeStorage = {
        get(key, fallback) {
            try {
                const raw = global.localStorage.getItem(key);
                if (raw === null) return fallback;
                return JSON.parse(raw);
            } catch (e) {
                return fallback;
            }
        },
        set(key, value) {
            try {
                global.localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                return false;
            }
        },
        getRaw(key, fallback = '') {
            try {
                const raw = global.localStorage.getItem(key);
                return raw === null ? fallback : raw;
            } catch (e) {
                return fallback;
            }
        },
        setRaw(key, value) {
            try {
                global.localStorage.setItem(key, String(value));
                return true;
            } catch (e) {
                return false;
            }
        }
    };

    function formatCompactNumber(n) {
        const num = Number(n) || 0;
        if (num >= 1000000) return (num / 1000000).toFixed(2).replace(/\.00$/, '') + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(num);
    }

    function formatTimeMMSS(seconds) {
        const total = Math.max(0, Math.floor(seconds || 0));
        const mins = Math.floor(total / 60);
        const secs = total % 60;
        return `${mins < 10 ? '0' + mins : mins}:${secs < 10 ? '0' + secs : secs}`;
    }

    function formatDateTimeVN(iso) {
        if (!iso) return 'Chưa đặt giờ';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return 'Chưa đặt giờ';
        return d.toLocaleString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit'
        });
    }

    function getDefaultTomorrowSchedule(hour = 20, minute = 0, daysAhead = 1) {
        const target = new Date(Date.now() + daysAhead * 86400000);
        target.setHours(hour, minute, 0, 0);
        return new Date(target.getTime() - target.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
    }

    function addDaysToSchedule(scheduleIso, daysToAdd) {
        const base = scheduleIso ? new Date(scheduleIso) : new Date(Date.now() + 86400000);
        const safe = Number.isNaN(base.getTime()) ? new Date(Date.now() + 86400000) : base;
        const shifted = new Date(safe.getTime() + daysToAdd * 86400000);
        return new Date(shifted.getTime() - shifted.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (e) {
                // Fall back to execCommand below
            }
        }
        const tempInput = document.createElement('textarea');
        tempInput.value = text;
        tempInput.setAttribute('readonly', '');
        tempInput.style.position = 'fixed';
        tempInput.style.opacity = '0';
        document.body.appendChild(tempInput);
        tempInput.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        }
        document.body.removeChild(tempInput);
        return ok;
    }

    function cleanNarrationText(raw) {
        if (!raw) return '';
        return String(raw)
            .replace(/^[•\-\*]\s*/g, '')
            .replace(/^(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}|\d+\s*[-–]\s*\d+\s*s)\s*:\s*/i, '')
            .replace(/^(Phần|Cảnh)\s*\d+\s*:\s*/i, '')
            .trim();
    }

    function splitScriptIntoFiveScenes(hook, body, cta) {
        const rawLines = (body || '')
            .split('\n')
            .map((l) => cleanNarrationText(l))
            .filter(Boolean);

        const cleanHook = cleanNarrationText(hook) || 'Bí quyết cuộc sống hằng ngày cực hay mà bạn nhất định phải biết!';
        const cleanCta = cleanNarrationText(cta) || 'Lưu ngay video này và Follow mình để xem thêm nhiều mẹo hay mỗi ngày nhé!';

        let mid1 = '';
        let mid2 = '';
        let mid3 = '';

        if (rawLines.length >= 3) {
            mid1 = rawLines[0];
            mid2 = rawLines[1];
            mid3 = rawLines.slice(2).join(' ');
        } else if (rawLines.length === 2) {
            mid1 = rawLines[0];
            const sentences = rawLines[1].split(/(?<=[.!?])\s+/).filter(Boolean);
            mid2 = sentences[0] || rawLines[1];
            mid3 = sentences.slice(1).join(' ') || 'Áp dụng cách này vừa tiết kiệm thời gian lại hiệu quả bất ngờ.';
        } else if (rawLines.length === 1) {
            const sentences = rawLines[0].split(/(?<=[.!?])\s+/).filter(Boolean);
            mid1 = sentences[0] || rawLines[0];
            mid2 = sentences[1] || 'Thực hiện từng bước cực kỳ đơn giản ngay tại nhà.';
            mid3 = sentences.slice(2).join(' ') || 'Kết quả thay đổi rõ rệt ngay từ lần đầu áp dụng.';
        } else {
            mid1 = 'Tình huống quen thuộc mà hầu như ngày nào chúng ta cũng gặp phải.';
            mid2 = 'Chỉ cần thay đổi một thói quen nhỏ là mọi thứ trở nên gọn gàng và dễ dàng hơn.';
            mid3 = 'Thành quả thực tế vừa nhanh gọn lại tiết kiệm được rất nhiều công sức.';
        }

        return [cleanHook, mid1, mid2, mid3, cleanCta];
    }

    function splitScriptIntoScenes(hook, body, cta) {
        const rawLines = (body || '')
            .split('\n')
            .map((l) => cleanNarrationText(l))
            .filter(Boolean);

        const cleanHook = cleanNarrationText(hook) || 'Bí quyết cuộc sống hằng ngày cực hay mà bạn nhất định phải biết!';
        const cleanCta = cleanNarrationText(cta) || 'Lưu ngay video này và Follow mình để đón xem phần tiếp theo nhé!';

        if (rawLines.length >= 4) {
            return [cleanHook, ...rawLines, cleanCta];
        }
        return splitScriptIntoFiveScenes(hook, body, cta);
    }

    function splitTextIntoVisualBeats(text, maxBeats = 3) {
        const cleaned = cleanNarrationText(text);
        if (!cleaned) return ['Khoảnh khắc đời sống hằng ngày.'];

        // Split on natural Vietnamese pauses first
        let parts = cleaned
            .split(/(?<=[,.;:!?—–])\s+|(?:\s+[—–-]\s+)/)
            .map((p) => p.trim())
            .filter(Boolean);

        // Merge tiny fragments (< 4 words) so cuts don't flash for < 1s
        const merged = [];
        for (const part of parts) {
            const wc = part.split(/\s+/).filter(Boolean).length;
            if (merged.length > 0 && wc < 4) {
                merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`.trim();
            } else {
                merged.push(part);
            }
        }
        parts = merged.length > 0 ? merged : [cleaned];

        // Subdivide long clauses (> 11 words) cleanly into ~6-8 word beats
        const expanded = [];
        for (const part of parts) {
            const words = part.split(/\s+/).filter(Boolean);
            if (words.length <= 11) {
                expanded.push(part);
            } else {
                const subCount = Math.min(maxBeats, Math.ceil(words.length / 7));
                const chunkLen = Math.ceil(words.length / subCount);
                for (let s = 0; s < words.length; s += chunkLen) {
                    const slice = words.slice(s, s + chunkLen).join(' ');
                    if (slice) expanded.push(slice);
                }
            }
        }

        // Clamp total beats to maxBeats by balancing tail fragments
        if (expanded.length <= maxBeats) return expanded;
        const result = expanded.slice(0, maxBeats - 1);
        result.push(expanded.slice(maxBeats - 1).join(' '));
        return result;
    }

    function base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function sleep(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal && signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            const id = setTimeout(() => {
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            function onAbort() {
                clearTimeout(id);
                reject(new DOMException('Aborted', 'AbortError'));
            }
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    App.utils = {
        escapeHtml,
        debounce,
        hashString,
        safeStorage,
        formatCompactNumber,
        formatTimeMMSS,
        formatDateTimeVN,
        getDefaultTomorrowSchedule,
        addDaysToSchedule,
        copyToClipboard,
        cleanNarrationText,
        splitScriptIntoFiveScenes,
        splitScriptIntoScenes,
        splitTextIntoVisualBeats,
        base64ToArrayBuffer,
        sleep
    };
})(window);
