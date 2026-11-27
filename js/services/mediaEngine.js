/* ==========================================================================
   Media & Canvas 9:16 Rendering Engine
   - Precomputed wrapped subtitle chunks (zero per-frame text measurement)
   - Cached Canvas gradients & DOM nodes
   - Safe AudioContext + performance.now() timer fallback (no infinite rAF loop)
   - Real Pause / Resume / Seek scrubbing
   - Cached BGM AudioBuffer + robust MediaRecorder export
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { STOCK_PHOTOS } = App.CONFIG;
    const { cleanNarrationText, formatTimeMMSS } = App.utils;

    const CANVAS_W = 540;
    const CANVAS_H = 960;

    let canvasEl = null;
    let ctx = null;
    let timerBadgeEl = null;
    let cachedOverlayGrad = null;
    let cachedFallbackGrad = null;

    // Audio & Playback State
    let studioScenes = [];
    let currentVideoTitle = '';
    let precomputedTitleLines = [];
    let totalDuration = 0;
    let isPlaying = false;
    let isRecording = false;
    let pausedAt = 0;
    let playbackOffset = 0;
    let audioCtx = null;
    let activeAudioSources = [];
    let audioStartTime = 0;
    let perfStartTime = 0;
    let rafId = null;
    let bgTimerId = null;
    let activeRecorder = null;
    let lastFormattedSecond = '';
    let playbackRunId = 0;

    const bgmBufferCache = new Map();

    // Callbacks registered by VideoStudio UI
    let callbacks = {
        onProgressUpdate: null,
        onStateChange: null,
        onAudioBlocked: null
    };

    // Unified HTML <audio playsinline> playback channel:
    // - Works natively even when iPhone physical Silent Switch is ON
    // - Uses hardware media volume buttons cleanly on both iOS & Android
    let previewAudioEl = null;
    let silentUnlockWavUrl = null;
    let mixedPreviewCache = { key: '', url: '' };
    let isAudioUnlocked = false;
    let useHtmlAudioClock = false;

    function getSilentUnlockWavUrl() {
        if (silentUnlockWavUrl) return silentUnlockWavUrl;
        try {
            const sampleRate = 8000;
            const numSamples = 800; // 0.1s genuine silent PCM16 WAV
            const buf = new ArrayBuffer(44 + numSamples * 2);
            const view = new DataView(buf);
            const writeStr = (off, s) => {
                for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
            };
            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + numSamples * 2, true);
            writeStr(8, 'WAVE');
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeStr(36, 'data');
            view.setUint32(40, numSamples * 2, true);
            silentUnlockWavUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
            return silentUnlockWavUrl;
        } catch (_) {
            return 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        }
    }

    function encodeAudioBufferToWavBlob(audioBuffer) {
        const sr = audioBuffer.sampleRate || 44100;
        const data = audioBuffer.getChannelData(0);
        const len = data.length;
        const buf = new ArrayBuffer(44 + len * 2);
        const view = new DataView(buf);
        const writeStr = (off, s) => {
            for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
        };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + len * 2, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sr, true);
        view.setUint32(28, sr * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeStr(36, 'data');
        view.setUint32(40, len * 2, true);

        let offset = 44;
        for (let i = 0; i < len; i++) {
            const s = Math.max(-1, Math.min(1, data[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            offset += 2;
        }
        return new Blob([buf], { type: 'audio/wav' });
    }

    function getOrCreatePreviewAudioEl() {
        if (previewAudioEl) return previewAudioEl;
        if (typeof document === 'undefined' || !global.Audio) return null;
        const el = new global.Audio();
        el.id = 'vs-preview-audio';
        el.setAttribute('playsinline', 'true');
        el.playsInline = true;
        el.preload = 'auto';
        el.style.display = 'none';
        if (document.body) {
            document.body.appendChild(el);
        }
        previewAudioEl = el;
        return el;
    }

    function revokeMixedPreviewCache() {
        if (mixedPreviewCache.url) {
            try {
                URL.revokeObjectURL(mixedPreviewCache.url);
            } catch (_) {}
        }
        mixedPreviewCache = { key: '', url: '' };
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                isAudioUnlocked = false;
            }
        });
    }

    function bindCanvasElements(canvas, timerBadge, cbs = {}) {
        canvasEl = canvas;
        ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
        timerBadgeEl = timerBadge || null;
        callbacks = { ...callbacks, ...cbs };
        cachedOverlayGrad = null;
        cachedFallbackGrad = null;
    }

    function ensureAudioContext() {
        try {
            if (global.navigator?.audioSession && global.navigator.audioSession.type !== 'playback') {
                global.navigator.audioSession.type = 'playback';
            }
        } catch (_) {}

        if (!audioCtx || audioCtx.state === 'closed') {
            const Ctx = global.AudioContext || global.webkitAudioContext;
            audioCtx = new Ctx();
        }
        if (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    }

    // Must be invoked SYNCHRONOUSLY inside tap/click handlers for mobile iOS & Android
    function unlockAudioSync({ skipHtmlAudio = false } = {}) {
        try {
            if (global.navigator?.audioSession && global.navigator.audioSession.type !== 'playback') {
                global.navigator.audioSession.type = 'playback';
            }
        } catch (_) {}

        const ctxAudio = ensureAudioContext();
        try {
            if (ctxAudio.state === 'suspended' || ctxAudio.state === 'interrupted') {
                ctxAudio.resume().catch(() => {});
            }
            const silentBuf = ctxAudio.createBuffer(1, 1, ctxAudio.sampleRate || 22050);
            const src = ctxAudio.createBufferSource();
            src.buffer = silentBuf;
            src.connect(ctxAudio.destination);
            src.start(0);
        } catch (_) {}

        if (!skipHtmlAudio) {
            const audioEl = getOrCreatePreviewAudioEl();
            if (audioEl && !isPlaying && (!isAudioUnlocked || (audioEl.paused && audioEl.dataset?.kind !== 'mixed'))) {
                try {
                    audioEl.muted = false;
                    audioEl.volume = 1.0;
                    if (!audioEl.src || audioEl.dataset?.kind !== 'mixed') {
                        audioEl.src = getSilentUnlockWavUrl();
                        if (audioEl.dataset) audioEl.dataset.kind = 'silent';
                        const p = audioEl.play();
                        if (p && typeof p.then === 'function') {
                            p.then(() => {
                                isAudioUnlocked = true;
                            }).catch(() => {});
                        } else {
                            isAudioUnlocked = true;
                        }
                    }
                } catch (_) {}
            }
        }
        return ctxAudio;
    }

    function applyEdgeFades(samples, sr, fadeInMs = 20, fadeOutMs = 28) {
        if (!samples || samples.length < 16) return;
        const len = samples.length;
        const inLen = Math.min(Math.floor((sr * fadeInMs) / 1000), Math.floor(len / 4));
        const outLen = Math.min(Math.floor((sr * fadeOutMs) / 1000), Math.floor(len / 4));
        for (let i = 0; i < inLen; i++) {
            samples[i] *= i / inLen;
        }
        for (let i = 0; i < outLen; i++) {
            samples[len - 1 - i] *= i / outLen;
        }
    }

    function normalizeVoiceBuffer(audioBuffer) {
        if (!audioBuffer || audioBuffer.length === 0) return audioBuffer;
        const data = audioBuffer.getChannelData(0);
        let sumSq = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            sumSq += v * v;
            const abs = Math.abs(v);
            if (abs > peak) peak = abs;
        }
        const rms = Math.sqrt(sumSq / data.length);
        // Gentle RMS match across scenes prevents abrupt quiet/loud jumps without boosting breath noise
        if (rms > 0.01 && peak > 0.03) {
            const desiredGain = Math.max(0.90, Math.min(1.35, 0.13 / rms));
            const safePeakGain = Math.min(desiredGain, 0.92 / peak);
            if (Math.abs(safePeakGain - 1.0) > 0.05) {
                for (let i = 0; i < data.length; i++) {
                    data[i] = Math.max(-0.94, Math.min(0.94, data[i] * safePeakGain));
                }
            }
        }
        return audioBuffer;
    }

    function trimAudioSilence(audioBuffer, targetCtx, threshold = 0.0028, keepPadSec = 0.14) {
        if (!audioBuffer || audioBuffer.length === 0) return audioBuffer;
        const sr = audioBuffer.sampleRate;
        const data = audioBuffer.getChannelData(0);
        const len = data.length;

        let start = 0;
        while (start < len && Math.abs(data[start]) < threshold) start++;

        let end = len - 1;
        while (end > start && Math.abs(data[end]) < threshold) end--;

        if (start >= end) {
            applyEdgeFades(data, sr, 20, 28);
            return normalizeVoiceBuffer(audioBuffer);
        }

        const padSamples = Math.floor(sr * keepPadSec);
        const trimStart = Math.max(0, start - padSamples);
        const trimEnd = Math.min(len, end + padSamples + 1);
        const outLen = trimEnd - trimStart;

        if (outLen <= 0 || outLen >= len * 0.96) {
            applyEdgeFades(data, sr, 20, 28);
            return normalizeVoiceBuffer(audioBuffer);
        }

        const outBuf = targetCtx.createBuffer(1, outLen, sr);
        const outData = outBuf.getChannelData(0);
        outData.set(data.subarray(trimStart, trimEnd));
        applyEdgeFades(outData, sr, 22, 32);
        return normalizeVoiceBuffer(outBuf);
    }

    async function decodeTtsToAudioBuffer(rawBuffer, targetCtx, sampleRate = 24000) {
        if (!rawBuffer || rawBuffer.byteLength < 4) return null;

        // Check for RIFF/WAV or encoded audio container header
        const header = new Uint8Array(rawBuffer, 0, 4);
        const isWavOrEncoded =
            (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) || // RIFF
            (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) || // ID3
            (header[0] === 0x4f && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53); // OggS

        if (isWavOrEncoded) {
            try {
                const decoded = await targetCtx.decodeAudioData(rawBuffer.slice(0));
                return trimAudioSilence(decoded, targetCtx);
            } catch (_) {
                // Fall through to raw PCM16
            }
        }

        const evenLength = rawBuffer.byteLength - (rawBuffer.byteLength % 2);
        if (evenLength <= 0) return null;
        const int16 = new Int16Array(rawBuffer, 0, evenLength / 2);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0;
        }
        const buffer = targetCtx.createBuffer(1, float32.length, sampleRate);
        buffer.getChannelData(0).set(float32);
        return trimAudioSilence(buffer, targetCtx);
    }

    function pcm16ToAudioBuffer(pcmArrayBuffer, targetCtx, sampleRate = 24000) {
        const evenLength = pcmArrayBuffer.byteLength - (pcmArrayBuffer.byteLength % 2);
        const int16 = new Int16Array(pcmArrayBuffer, 0, evenLength / 2);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0;
        }
        const buffer = targetCtx.createBuffer(1, float32.length, sampleRate);
        buffer.getChannelData(0).set(float32);
        return buffer;
    }

    // Split an AudioBuffer cleanly into N beat chunks at lowest-energy breath/silence valleys
    function splitAudioBufferIntoBeats(fullBuffer, texts, targetCtx) {
        if (!fullBuffer || !Array.isArray(texts) || texts.length <= 1) {
            return fullBuffer ? [fullBuffer] : [];
        }
        const count = texts.length;
        const sr = fullBuffer.sampleRate;
        const data = fullBuffer.getChannelData(0);
        const totalSamples = data.length;
        const minSegSamples = Math.floor(sr * 0.65);

        // If audio is too short to slice safely into N beats, divide proportionally
        if (totalSamples < minSegSamples * count) {
            const wordCounts = texts.map((t) => Math.max(1, String(t || '').split(/\s+/).filter(Boolean).length));
            const totalWords = wordCounts.reduce((a, b) => a + b, 0);
            const cuts = [0];
            let accW = 0;
            for (let k = 0; k < count - 1; k++) {
                accW += wordCounts[k];
                cuts.push(Math.floor(totalSamples * (accW / totalWords)));
            }
            cuts.push(totalSamples);
            return texts.map((_, idx) => {
                const start = cuts[idx];
                const len = Math.max(1, cuts[idx + 1] - start);
                const chunkBuf = targetCtx.createBuffer(1, len, sr);
                const out = chunkBuf.getChannelData(0);
                out.set(data.subarray(start, start + len));
                applyEdgeFades(out, sr, 20, 26);
                return chunkBuf;
            });
        }

        const wordCounts = texts.map((t) => Math.max(1, String(t || '').split(/\s+/).filter(Boolean).length));
        const totalWords = wordCounts.reduce((a, b) => a + b, 0);

        const winSamples = Math.max(1, Math.floor(sr * 0.035)); // 35ms energy window
        const searchRadius = Math.floor(sr * 0.85);
        const cutSamples = [0];
        let cumWords = 0;

        for (let k = 0; k < count - 1; k++) {
            cumWords += wordCounts[k];
            const expectedSample = Math.floor(totalSamples * (cumWords / totalWords));
            const minSample = Math.max(cutSamples[k] + minSegSamples, expectedSample - searchRadius);
            const maxSample = Math.min(totalSamples - minSegSamples * (count - k - 1), expectedSample + searchRadius);

            let bestSample = Math.min(Math.max(expectedSample, cutSamples[k] + minSegSamples), totalSamples - 1);
            let minEnergy = Infinity;

            if (maxSample > minSample + winSamples) {
                for (let s = minSample; s < maxSample - winSamples; s += Math.floor(winSamples / 2)) {
                    let energy = 0;
                    for (let j = 0; j < winSamples; j++) {
                        const v = data[s + j];
                        energy += v * v;
                    }
                    if (energy < minEnergy) {
                        minEnergy = energy;
                        bestSample = s + Math.floor(winSamples / 2);
                    }
                }
            }
            cutSamples.push(bestSample);
        }
        cutSamples.push(totalSamples);

        return texts.map((_, idx) => {
            const start = cutSamples[idx];
            const end = Math.max(start + Math.floor(sr * 0.25), cutSamples[idx + 1]);
            const len = Math.min(totalSamples - start, end - start);
            const chunkBuf = targetCtx.createBuffer(1, Math.max(1, len), sr);
            const out = chunkBuf.getChannelData(0);
            out.set(data.subarray(start, start + len));
            applyEdgeFades(out, sr, 20, 26);
            return chunkBuf;
        });
    }

    function splitCombinedAudioBuffer(fullBuffer, texts, targetCtx) {
        return splitAudioBufferIntoBeats(fullBuffer, texts, targetCtx);
    }

    function createSilentBuffer(targetCtx, text) {
        const wordCount = String(text || '').split(/\s+/).filter(Boolean).length;
        const estSeconds = Math.max(3.2, wordCount * 0.28);
        return targetCtx.createBuffer(1, Math.ceil(targetCtx.sampleRate * estSeconds), targetCtx.sampleRate);
    }

    function loadImageFromUrl(src, crossOrigin = null) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            if (crossOrigin) img.crossOrigin = crossOrigin;
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(e);
            img.src = src;
        });
    }

    function createIllustratedFallbackCard(sceneIndex, title) {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = CANVAS_W;
        offCanvas.height = CANVAS_H;
        const octx = offCanvas.getContext('2d');

        const palettes = [
            ['#1e1b4b', '#312e81', '#f59e0b'],
            ['#0f172a', '#1e3a8a', '#38bdf8'],
            ['#064e3b', '#065f46', '#34d399'],
            ['#3b0764', '#581c87', '#e879f9'],
            ['#172554', '#1d4ed8', '#fbbf24']
        ];
        const [c1, c2, accent] = palettes[sceneIndex % palettes.length];

        const grad = octx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
        grad.addColorStop(0, c1);
        grad.addColorStop(0.55, c2);
        grad.addColorStop(1, '#090d16');
        octx.fillStyle = grad;
        octx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        octx.save();
        octx.fillStyle = accent;
        octx.globalAlpha = 0.16;
        octx.beginPath();
        octx.arc(270, 340, 190, 0, Math.PI * 2);
        octx.fill();
        octx.beginPath();
        octx.arc(430, 180, 90, 0, Math.PI * 2);
        octx.fill();
        octx.restore();

        octx.fillStyle = 'rgba(255,255,255,0.08)';
        octx.strokeStyle = 'rgba(255,255,255,0.22)';
        octx.lineWidth = 2;
        octx.beginPath();
        octx.roundRect(56, 210, 428, 280, 28);
        octx.fill();
        octx.stroke();

        octx.fillStyle = accent;
        octx.font = '800 22px Inter, sans-serif';
        octx.textAlign = 'center';
        octx.fillText(`CẢNH ${sceneIndex + 1} / 5`, 270, 265);

        octx.fillStyle = '#ffffff';
        octx.font = '700 24px Inter, sans-serif';
        const lines = measureWrappedLines(octx, title || 'Reels Studio', 370);
        lines.forEach((l, i) => octx.fillText(l, 270, 325 + i * 34));

        return offCanvas;
    }

    function pickStockBucketForText(text) {
        const lower = (text || '').toLowerCase();
        if (/cảnh báo|lừa đảo|cháy|nổ|ổ điện|hỏng|vi khuẩn|cốp xe|sạc|otp|link/.test(lower)) return 'warning';
        if (/nhắc nhở|nhắc nhẹ|uống nước|giãn cơ|bố mẹ|khóa cửa|thay định kỳ|21 giờ/.test(lower)) return 'reminder';
        if (/nhạc|lofi|lo-fi|giai điệu|âm thanh|stress|piano|playlist|nghe/.test(lower)) return 'music';
        if (/ngủ|đêm|sáng|trà|cà phê|thức dậy/.test(lower)) return 'sleep';
        if (/bếp|hành|tỏi|cơm|chảo|nấu|ăn|đồ ăn/.test(lower)) return 'kitchen';
        if (/áo|giày|dọn|phòng|quần|giũ|mùa|gọn/.test(lower)) return 'tidy';
        if (/bàn|laptop|làm việc|văn phòng|điện thoại|pin|deadline/.test(lower)) return 'work';
        if (/lương|tiền|50k|100k|siêu thị|chợ|tiết kiệm|hũ/.test(lower)) return 'money';
        if (/ảnh|quay|reels|sống ảo|sáng tạo|video|tiêu đề/.test(lower)) return 'creator';
        return '';
    }

    async function loadRealLifeStockPhoto(sceneIndex, videoTitle, phraseText = '', usedPhotoIds = null) {
        const bucketKey = pickStockBucketForText(phraseText) || pickStockBucketForText(videoTitle) || 'default';
        const candidatePool = [
            ...(STOCK_PHOTOS[bucketKey] || []),
            ...(STOCK_PHOTOS.default || []),
            ...Object.values(STOCK_PHOTOS).flat()
        ];

        let chosenId = null;
        if (usedPhotoIds instanceof Set) {
            for (const id of candidatePool) {
                if (!usedPhotoIds.has(id)) {
                    chosenId = id;
                    usedPhotoIds.add(id);
                    break;
                }
            }
        }
        if (!chosenId) {
            const pool = STOCK_PHOTOS[bucketKey] || STOCK_PHOTOS.default;
            chosenId = pool[sceneIndex % pool.length];
        }

        const url = `https://images.unsplash.com/photo-${chosenId}?auto=format&fit=crop&w=720&h=1280&q=85`;

        try {
            return await loadImageFromUrl(url, 'anonymous');
        } catch (_) {
            return createIllustratedFallbackCard(sceneIndex, phraseText || videoTitle);
        }
    }

    function measureWrappedLines(targetCtx, text, maxWidth) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        if (words.length === 0) return [];
        const lines = [];
        let line = '';
        for (let n = 0; n < words.length; n++) {
            const testLine = line ? `${line} ${words[n]}` : words[n];
            if (targetCtx.measureText(testLine).width > maxWidth && n > 0) {
                lines.push(line);
                line = words[n];
            } else {
                line = testLine;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    // Precompute subtitle chunks & wrapped lines once per scene build!
    function precomputeSceneSubtitles(text, isMotion = false) {
        const fullSubText = cleanNarrationText(text);
        const allWords = fullSubText.split(/\s+/).filter(Boolean);
        const chunkSize = 5; // Snappy 5-word Reels captions for fast reading retention
        const rawChunks = [];

        for (let i = 0; i < allWords.length; i += chunkSize) {
            rawChunks.push(allWords.slice(i, i + chunkSize).join(' '));
        }
        if (rawChunks.length === 0) rawChunks.push(fullSubText || '...');

        const measureCtx = ctx || document.createElement('canvas').getContext('2d');

        return rawChunks.map((chunkText) => {
            const fontSize = isMotion ? (chunkText.length > 26 ? 25 : 28) : chunkText.length > 26 ? 29 : 33;
            const lineHeight = fontSize + 10;
            measureCtx.font = `900 ${fontSize}px Inter, sans-serif`;
            const lines = measureWrappedLines(measureCtx, chunkText, 460);
            const totalHeight = lines.length * lineHeight;
            const bottomMargin = isMotion ? 215 : 105;
            const startY = CANVAS_H - bottomMargin - totalHeight + fontSize;
            return {
                fontSize,
                lineHeight,
                lines,
                startY
            };
        });
    }

    function findAudioPivotRatio(audioBuffer, targetRatio = 0.52) {
        const clampedTarget = Math.max(0.28, Math.min(0.78, Number(targetRatio) || 0.52));
        if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function' || audioBuffer.length === 0) {
            return clampedTarget;
        }
        const sr = audioBuffer.sampleRate || 24000;
        const data = audioBuffer.getChannelData(0);
        const total = data.length;
        if (total < sr * 0.9) return clampedTarget;

        const win = Math.max(1, Math.floor(sr * 0.045));
        const expected = Math.floor(total * clampedTarget);
        const radius = Math.floor(total * 0.18);
        const minS = Math.max(Math.floor(total * 0.24), expected - radius);
        const maxS = Math.min(Math.floor(total * 0.82) - win, expected + radius);
        if (maxS <= minS) return clampedTarget;

        let bestSample = expected;
        let minEnergy = Infinity;
        const step = Math.max(1, Math.floor(win / 2));
        for (let s = minS; s <= maxS; s += step) {
            let energy = 0;
            for (let j = 0; j < win; j++) {
                const v = data[s + j];
                energy += v * v;
            }
            if (energy < minEnergy) {
                minEnergy = energy;
                bestSample = s + Math.floor(win / 2);
            }
        }
        return Math.max(0.24, Math.min(0.84, bestSample / total));
    }

    function computeAudioEnvelope(audioBuffer, bins = 96) {
        if (!audioBuffer || typeof audioBuffer.getChannelData !== 'function' || audioBuffer.length === 0) {
            return new Float32Array(bins);
        }
        const data = audioBuffer.getChannelData(0);
        const raw = new Float32Array(bins);
        const step = Math.max(1, Math.floor(data.length / bins));
        for (let b = 0; b < bins; b++) {
            const start = b * step;
            const end = Math.min(data.length, start + step);
            let sumSq = 0;
            for (let i = start; i < end; i++) {
                const s = data[i];
                sumSq += s * s;
            }
            raw[b] = end > start ? Math.sqrt(sumSq / (end - start)) : 0;
        }
        const sorted = Array.from(raw).sort((a, b) => a - b);
        const floor = sorted[Math.floor(sorted.length * 0.15)] || 0;
        const peak = sorted[Math.floor(sorted.length * 0.92)] || 0;
        const span = Math.max(0.035, peak - floor);

        const env = new Float32Array(bins);
        for (let b = 0; b < bins; b++) {
            const norm = Math.max(0, Math.min(1, (raw[b] - floor * 1.1) / span));
            // Smooth lightly across neighbor bin to prevent mouth jitter while preserving syllable edges
            const prev = b > 0 ? env[b - 1] : norm;
            env[b] = prev * 0.25 + norm * 0.75;
        }
        return env;
    }

    function setScenes(scenes, videoTitle = '') {
        stopPlayback({ resetToZero: false });
        revokeMixedPreviewCache();
        if (previewAudioEl && previewAudioEl.dataset) {
            previewAudioEl.dataset.kind = '';
        }
        currentVideoTitle = String(videoTitle || '').trim();
        const measureCtx = ctx || document.createElement('canvas').getContext('2d');
        measureCtx.font = '800 22px Inter, sans-serif';
        precomputedTitleLines = currentVideoTitle
            ? measureWrappedLines(measureCtx, currentVideoTitle.toUpperCase(), 420).slice(0, 2)
            : [];

        studioScenes = (scenes || []).map((scene) => ({
            ...scene,
            precomputedChunks: precomputeSceneSubtitles(
                scene.text,
                scene.visualStyle === 'motion' || scene.visualStyle === 'ui-motion' || scene.visualStyle === 'ai-svg'
            ),
            audioEnvelope: computeAudioEnvelope(scene.audioBuffer)
        }));
        totalDuration = studioScenes.reduce((sum, s) => sum + (Number.isFinite(s.duration) ? s.duration : 2.0), 0);
        pausedAt = 0;
        playbackOffset = 0;
        cachedRecordMix = { key: '', buffer: null };
        lastFormattedSecond = '';
        updateTimerText(0);
        if (studioScenes.length > 0) {
            renderFrameAtTime(0);
        }
        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
    }

    function getScenes() {
        return studioScenes;
    }

    function getTotalDuration() {
        return totalDuration;
    }

    function getPlaybackState() {
        return {
            isPlaying,
            isRecording,
            currentTime: getCurrentTime(),
            totalDuration
        };
    }

    function getCurrentTime() {
        if (!isPlaying) return pausedAt;
        const wallElapsed = Math.max(0, (performance.now() - perfStartTime) / 1000);
        if (useHtmlAudioClock && previewAudioEl && !previewAudioEl.paused && !previewAudioEl.ended) {
            const mediaTime = previewAudioEl.currentTime;
            if (Number.isFinite(mediaTime) && (mediaTime > playbackOffset + 0.02 || wallElapsed < 0.3)) {
                return Math.min(totalDuration, Math.max(0, mediaTime));
            }
        }
        let elapsed = wallElapsed;
        if (!useHtmlAudioClock && audioCtx && audioCtx.state === 'running') {
            const audioElapsed = Math.max(0, audioCtx.currentTime - audioStartTime);
            // Guard against frozen OS/mobile AudioContext clock stuck at 0 while claiming state==='running'
            if (audioElapsed > 0.02 || wallElapsed < 0.25) {
                elapsed = Math.abs(wallElapsed - audioElapsed) > 0.45 && audioElapsed <= 0.05 ? wallElapsed : audioElapsed;
            }
        }
        return Math.min(totalDuration, Math.max(0, playbackOffset + elapsed));
    }

    function drawPlaceholderCanvas(title) {
        if (!ctx) return;
        const grad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
        grad.addColorStop(0, '#1e1b4b');
        grad.addColorStop(0.5, '#312e81');
        grad.addColorStop(1, '#0f172a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.arc(270, 390, 96, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fbbf24';
        ctx.font = '800 24px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('AI REELS STUDIO 9:16', 270, 398);

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 28px Inter, sans-serif';
        const lines = measureWrappedLines(
            ctx,
            title || 'Bấm "Tạo Video 5 Cảnh & Giọng Đọc" để bắt đầu',
            440
        );
        lines.forEach((l, i) => ctx.fillText(l, 270, 520 + i * 40));
    }

    function drawImageWithMotion(img, progress, motionType = 'zoomIn', alpha = 1) {
        if (!img || !ctx) return;
        const imgW = img.naturalWidth || img.width || CANVAS_W;
        const imgH = img.naturalHeight || img.height || CANVAS_H;
        const baseScale = Math.max(CANVAS_W / imgW, CANVAS_H / imgH);

        let scale = baseScale * 1.04;
        let offsetX = 0;

        const handheldSwayX = Math.sin(progress * Math.PI * 3) * 5;
        const handheldSwayY = Math.cos(progress * Math.PI * 2) * 4;

        if (motionType === 'zoomIn') {
            scale = baseScale * (1.02 + progress * 0.1);
        } else if (motionType === 'zoomOut') {
            scale = baseScale * (1.12 - progress * 0.1);
        } else if (motionType === 'panRight') {
            scale = baseScale * 1.09;
            offsetX = (progress - 0.5) * 26;
        } else if (motionType === 'panLeft') {
            scale = baseScale * 1.09;
            offsetX = (0.5 - progress) * 26;
        }

        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const drawX = (CANVAS_W - drawW) / 2 + offsetX + handheldSwayX;
        const drawY = (CANVAS_H - drawH) / 2 + handheldSwayY;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        ctx.restore();
    }

    function updateTimerText(elapsed) {
        if (!timerBadgeEl) return;
        const formatted = `${formatTimeMMSS(elapsed)} / ${formatTimeMMSS(totalDuration)}`;
        if (formatted !== lastFormattedSecond) {
            lastFormattedSecond = formatted;
            timerBadgeEl.textContent = formatted;
        }
    }

    function renderFrameAtTime(elapsed) {
        if (!ctx || studioScenes.length === 0) return;

        let acc = 0;
        let activeIdx = 0;
        let sceneProgress = 0;

        for (let i = 0; i < studioScenes.length; i++) {
            const dur = studioScenes[i].duration;
            if (elapsed >= acc && elapsed < acc + dur) {
                activeIdx = i;
                sceneProgress = (elapsed - acc) / dur;
                break;
            }
            acc += dur;
            if (i === studioScenes.length - 1) {
                activeIdx = i;
                sceneProgress = 1;
            }
        }

        const currentScene = studioScenes[activeIdx];
        const isSvgVisual = currentScene.visualStyle === 'ai-svg' && Boolean(currentScene.imageObj);
        const isPhotoVisual = (currentScene.visualStyle === 'photo' || currentScene.visualStyle === 'ai-image') && Boolean(currentScene.imageObj);
        const isMotionStyle = !isSvgVisual && !isPhotoVisual && Boolean(App.motionGraphics);
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        if (isMotionStyle) {
            // 1. Composable 2D Motion Infographic Scene driven by real speech audio envelope
            const prevScene = activeIdx > 0 ? studioScenes[activeIdx - 1] : null;
            let audioLevel = 0;
            if (currentScene.audioEnvelope && currentScene.audioEnvelope.length > 0 && sceneProgress < 0.94) {
                const envIdx = Math.min(
                    currentScene.audioEnvelope.length - 1,
                    Math.floor((sceneProgress / 0.94) * currentScene.audioEnvelope.length)
                );
                audioLevel = currentScene.audioEnvelope[envIdx] || 0;
            }
            App.motionGraphics.drawMotionScene(ctx, currentScene, sceneProgress, activeIdx, elapsed, prevScene, audioLevel);
        } else {
            // 1. Custom AI SVG Illustration OR Real/AI Photo background + whip/crossfade motion
            if (currentScene.imageObj) {
                drawImageWithMotion(currentScene.imageObj, sceneProgress, currentScene.motionType, 1);
                if (sceneProgress < 0.14 && activeIdx > 0 && studioScenes[activeIdx - 1].imageObj) {
                    const fadeOutAlpha = 1 - sceneProgress / 0.14;
                    drawImageWithMotion(
                        studioScenes[activeIdx - 1].imageObj,
                        1,
                        studioScenes[activeIdx - 1].motionType,
                        fadeOutAlpha
                    );
                }
            } else {
                if (!cachedFallbackGrad) {
                    cachedFallbackGrad = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
                    cachedFallbackGrad.addColorStop(0, '#1e1b4b');
                    cachedFallbackGrad.addColorStop(1, '#090d16');
                }
                ctx.fillStyle = cachedFallbackGrad;
                ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            }

            // 2. Subtle gradient overlay (light touch for crisp AI SVGs, cinematic vignette for photos)
            if (!isSvgVisual) {
                if (!cachedOverlayGrad) {
                    cachedOverlayGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
                    cachedOverlayGrad.addColorStop(0, 'rgba(0,0,0,0.45)');
                    cachedOverlayGrad.addColorStop(0.2, 'rgba(0,0,0,0.0)');
                    cachedOverlayGrad.addColorStop(0.62, 'rgba(0,0,0,0.05)');
                    cachedOverlayGrad.addColorStop(1, 'rgba(0,0,0,0.78)');
                }
                ctx.fillStyle = cachedOverlayGrad;
                ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            }
        }

        // 3. Top Story Progress Bars (adapts cleanly for dark backdrops & photo mode)
        const count = studioScenes.length;
        const barGap = count > 8 ? 4 : 6;
        const barWidth = (CANVAS_W - 48 - (count - 1) * barGap) / count;
        const bdName = currentScene.motionCue?.backdrop;
        const useLightBar =
            isPhotoVisual ||
            (isMotionStyle &&
                (bdName === 'night-calm' ||
                    bdName === 'bedroom-night' ||
                    bdName === 'server-tech' ||
                    bdName === 'blueprint-dark' ||
                    bdName === 'work-late' ||
                    bdName === 'bank-vault' ||
                    bdName === 'street-rain' ||
                    bdName === 'warning-stage'));
        const isCleanSubtitle = isMotionStyle || isSvgVisual;
        for (let i = 0; i < count; i++) {
            const bx = 24 + i * (barWidth + barGap);
            ctx.fillStyle = useLightBar ? 'rgba(255,255,255,0.32)' : 'rgba(15,23,42,0.18)';
            ctx.beginPath();
            ctx.roundRect(bx, 18, barWidth, 5, 3);
            ctx.fill();

            if (i < activeIdx) {
                ctx.fillStyle = useLightBar ? '#ffffff' : '#0f172a';
                ctx.beginPath();
                ctx.roundRect(bx, 18, barWidth, 5, 3);
                ctx.fill();
            } else if (i === activeIdx) {
                ctx.fillStyle = useLightBar ? '#ffffff' : '#0f172a';
                ctx.beginPath();
                ctx.roundRect(bx, 18, barWidth * Math.min(1, sceneProgress), 5, 3);
                ctx.fill();
            }
        }

        // 3b & 3c & 4. Render optional text/subtitles ONLY when explicitly enabled (disabled by default for clean 2D animation)
        const showSubtitles = Boolean(currentScene.showSubtitles);
        if (showSubtitles) {
            // Dynamic Beat Callout Pill in Photo mode
            if (!isCleanSubtitle && currentScene.motionCue && (activeIdx > 0 || precomputedTitleLines.length === 0)) {
                const badgeText =
                    currentScene.motionCue.accentBadge ||
                    currentScene.motionCue.topBadge ||
                    (currentScene.motionCue.items && currentScene.motionCue.items[0]);
                if (badgeText) {
                    const badgeAlpha = sceneProgress < 0.15 ? sceneProgress / 0.15 : 1;
                    ctx.save();
                    ctx.globalAlpha = badgeAlpha;
                    ctx.font = '800 17px Inter, sans-serif';
                    const tw = ctx.measureText(badgeText).width;
                    const pw = Math.min(360, Math.max(100, tw + 34));
                    ctx.fillStyle = 'rgba(250, 204, 21, 0.92)';
                    ctx.beginPath();
                    ctx.roundRect(270 - pw / 2, 42, pw, 34, 17);
                    ctx.fill();
                    ctx.fillStyle = '#0f172a';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(badgeText, 270, 60, pw - 16);
                    ctx.restore();
                }
            }

            // Top Hook Title Banner during first beat in Photo mode
            if (!isCleanSubtitle && activeIdx === 0 && precomputedTitleLines.length > 0) {
                const boxH = precomputedTitleLines.length * 28 + 22;
                const fadeOut = sceneProgress > 0.85 ? Math.max(0, 1 - (sceneProgress - 0.85) / 0.15) : 1;
                ctx.save();
                ctx.globalAlpha = fadeOut;
                ctx.fillStyle = 'rgba(250, 204, 21, 0.95)';
                ctx.beginPath();
                ctx.roundRect(38, 46, CANVAS_W - 76, boxH, 16);
                ctx.fill();

                ctx.fillStyle = '#0f172a';
                ctx.font = '900 21px Inter, sans-serif';
                ctx.textAlign = 'center';
                precomputedTitleLines.forEach((line, idx) => {
                    ctx.fillText(line, 270, 74 + idx * 28);
                });
                ctx.restore();
            }

            // Precomputed dynamic subtitles aligned to actual speech span
            const chunks = currentScene.precomputedChunks;
            if (chunks && chunks.length > 0) {
                const speechNorm = Math.min(0.9999, sceneProgress / 0.92);
                const chunkIdx = Math.min(chunks.length - 1, Math.floor(speechNorm * chunks.length));
                const chunkLocalProgress = speechNorm * chunks.length - chunkIdx;
                const chunk = chunks[chunkIdx];
                const popScale = chunkLocalProgress < 0.16 ? 0.9 + (chunkLocalProgress / 0.16) * 0.1 : 1.0;

                ctx.font = `900 ${chunk.fontSize}px Inter, sans-serif`;
                ctx.save();
                ctx.translate(270, chunk.startY);
                ctx.scale(popScale, popScale);
                ctx.translate(-270, -chunk.startY);

                if (!isCleanSubtitle) {
                    const boxTop = chunk.startY - chunk.fontSize - 4;
                    const boxHeight = chunk.lines.length * chunk.lineHeight + 12;
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
                    ctx.beginPath();
                    ctx.roundRect(28, boxTop, CANVAS_W - 56, boxHeight, 16);
                    ctx.fill();
                }

                ctx.textAlign = 'center';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = isCleanSubtitle ? '#0f172a' : 'rgba(0, 0, 0, 0.95)';
                ctx.lineWidth = isCleanSubtitle ? 8 : 7;

                chunk.lines.forEach((line, i) => {
                    const ly = chunk.startY + i * chunk.lineHeight;
                    ctx.strokeText(line, 270, ly);
                    if (isCleanSubtitle) {
                        ctx.fillStyle = '#ffffff';
                    } else {
                        const isHighlight = activeIdx === 0 || (activeIdx === 4 && i === 0);
                        ctx.fillStyle = isHighlight ? '#fde047' : '#ffffff';
                    }
                    ctx.fillText(line, 270, ly);
                });
                ctx.restore();
            }
        }

        updateTimerText(elapsed);
        if (callbacks.onProgressUpdate) {
            callbacks.onProgressUpdate(elapsed, totalDuration);
        }
    }

    function getCachedBgmBuffer(targetCtx, style, duration) {
        if (style === 'none') return null;
        const roundedDur = Math.max(5, Math.ceil(duration));
        const key = `${style}:${targetCtx.sampleRate}:${roundedDur}`;
        if (bgmBufferCache.has(key)) return bgmBufferCache.get(key);

        const sampleRate = targetCtx.sampleRate;
        const length = Math.ceil(sampleRate * roundedDur);
        const buffer = targetCtx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        const presets = {
            upbeat: {
                chords: [
                    [261.63, 329.63, 392.0, 523.25],
                    [293.66, 369.99, 440.0, 587.33],
                    [329.63, 415.3, 493.88, 659.25],
                    [261.63, 329.63, 392.0, 523.25]
                ],
                beatDur: 1.4,
                gain: 0.1,
                arpHz: 4.0
            },
            lofi: {
                chords: [
                    [220.0, 261.63, 329.63, 392.0],
                    [174.61, 220.0, 261.63, 329.63],
                    [196.0, 246.94, 293.66, 349.23],
                    [164.81, 196.0, 246.94, 293.66]
                ],
                beatDur: 2.4,
                gain: 0.11,
                arpHz: 1.5
            },
            morning: {
                chords: [
                    [261.63, 329.63, 392.0, 493.88],
                    [349.23, 440.0, 523.25, 659.25],
                    [392.0, 493.88, 587.33, 698.46],
                    [261.63, 329.63, 392.0, 493.88]
                ],
                beatDur: 1.8,
                gain: 0.1,
                arpHz: 2.5
            },
            alert: {
                chords: [
                    [146.83, 220.0, 261.63, 349.23],
                    [130.81, 196.0, 246.94, 329.63],
                    [146.83, 220.0, 261.63, 349.23],
                    [116.54, 174.61, 220.0, 293.66]
                ],
                beatDur: 1.0,
                gain: 0.11,
                arpHz: 3.0
            },
            healing: {
                chords: [
                    [196.0, 246.94, 293.66, 392.0],
                    [220.0, 261.63, 329.63, 440.0],
                    [174.61, 220.0, 261.63, 349.23],
                    [196.0, 246.94, 293.66, 392.0]
                ],
                beatDur: 2.8,
                gain: 0.11,
                arpHz: 1.2
            }
        };

        const preset = presets[style] || presets.upbeat;
        const { chords, beatDur, gain, arpHz } = preset;

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const chordIdx = Math.floor(t / beatDur) % chords.length;
            const chord = chords[chordIdx];
            const localT = t % beatDur;
            const env = Math.sin((Math.PI * localT) / beatDur);
            const arpIdx = Math.floor(t * arpHz) % chord.length;
            const arpEnv = Math.exp(-((t * arpHz) % 1) * 3.2);

            let pad = 0;
            for (let c = 0; c < chord.length - 1; c++) {
                pad += Math.sin(2 * Math.PI * chord[c] * t) + 0.35 * Math.sin(4 * Math.PI * chord[c] * t);
            }
            const melody =
                (Math.sin(2 * Math.PI * chord[arpIdx] * t) + 0.4 * Math.sin(4 * Math.PI * chord[arpIdx] * t)) *
                arpEnv *
                0.6;
            data[i] = ((pad / (chord.length - 1)) * 0.52 + melody) * env * Math.min(0.22, gain * 1.65);
        }

        if (bgmBufferCache.size > 10) {
            const first = bgmBufferCache.keys().next().value;
            bgmBufferCache.delete(first);
        }
        bgmBufferCache.set(key, buffer);
        return buffer;
    }

    function clearScheduledAudio() {
        useHtmlAudioClock = false;
        if (previewAudioEl && !previewAudioEl.paused) {
            try {
                previewAudioEl.pause();
            } catch (_) {}
        }
        activeAudioSources.forEach((src) => {
            try {
                src.stop();
                src.disconnect();
            } catch (_) {}
        });
        activeAudioSources = [];
        if (previewBgmSource) {
            try {
                previewBgmSource.stop();
                previewBgmSource.disconnect();
            } catch (_) {}
            previewBgmSource = null;
        }
    }

    function stopTimers() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (bgTimerId) {
            clearInterval(bgTimerId);
            bgTimerId = null;
        }
    }

    function pausePlayback() {
        playbackRunId++;
        if (!isPlaying || isRecording) return;
        pausedAt = getCurrentTime();
        isPlaying = false;
        stopTimers();
        clearScheduledAudio();
        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
    }

    function stopPlayback({ resetToZero = true } = {}) {
        playbackRunId++;
        isPlaying = false;
        stopTimers();
        clearScheduledAudio();
        if (activeRecorder && activeRecorder.state !== 'inactive') {
            try {
                activeRecorder.onstop = null;
                activeRecorder.stop();
            } catch (_) {}
        }
        activeRecorder = null;
        isRecording = false;
        if (resetToZero) {
            pausedAt = 0;
            playbackOffset = 0;
            if (studioScenes.length > 0) renderFrameAtTime(0);
        }
        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
    }

    function seekTo(seconds) {
        if (studioScenes.length === 0 || isRecording) return;
        const clamped = Math.max(0, Math.min(totalDuration, Number(seconds) || 0));
        const wasPlaying = isPlaying;
        if (wasPlaying) {
            isPlaying = false;
            stopTimers();
            clearScheduledAudio();
        }
        pausedAt = clamped;
        renderFrameAtTime(clamped);
        if (wasPlaying) {
            startPlayback({ startAt: clamped, bgmStyle: currentBgmStyle });
        } else if (callbacks.onStateChange) {
            callbacks.onStateChange(getPlaybackState());
        }
    }

    let currentBgmStyle = 'upbeat';
    let cachedFastFormat = undefined;
    let cachedRecordMix = { key: '', buffer: null };

    function prepareForExportSync() {
        const ctxAudio = unlockAudioSync({ skipHtmlAudio: true });
        let keepOsc = null;
        let keepGain = null;
        try {
            keepOsc = ctxAudio.createOscillator();
            keepGain = ctxAudio.createGain();
            keepOsc.frequency.value = 440;
            keepGain.gain.value = 0.0002;
            keepOsc.connect(keepGain);
            keepGain.connect(ctxAudio.destination);
            keepOsc.start();
        } catch (_) {}

        return {
            release: () => {
                try {
                    if (keepOsc) {
                        keepOsc.stop();
                        keepOsc.disconnect();
                    }
                    if (keepGain) keepGain.disconnect();
                } catch (_) {}
            }
        };
    }

    let cachedMediabunny = undefined;
    const cachedSfxSamples = new Map();

    function getCachedSfxBuffer(targetCtx, sfxType) {
        if (!targetCtx || !sfxType || sfxType === 'none') return null;
        const type = String(sfxType).toLowerCase();
        if (!['pop', 'click', 'whoosh', 'ding'].includes(type)) return null;

        const sr = targetCtx.sampleRate || 44100;
        const cacheKey = `${type}:${sr}`;
        let samples = cachedSfxSamples.get(cacheKey);

        if (!samples) {
            let dur = 0.08;
            if (type === 'click') dur = 0.04;
            else if (type === 'whoosh') dur = 0.16;
            else if (type === 'ding') dur = 0.24;

            const len = Math.max(1, Math.floor(sr * dur));
            samples = new Float32Array(len);
            for (let i = 0; i < len; i++) {
                const t = i / sr;
                const progress = i / len;
                let v = 0;
                if (type === 'pop') {
                    const freq = 340 + 420 * progress;
                    const env = Math.sin(Math.min(1, progress / 0.15) * Math.PI * 0.5) * Math.exp(-progress * 6.5);
                    v = Math.sin(2 * Math.PI * freq * t) * env * 0.065;
                } else if (type === 'click') {
                    const env = Math.exp(-progress * 14);
                    v = (Math.sin(2 * Math.PI * 1650 * t) * 0.65 + Math.sin(2 * Math.PI * 2450 * t) * 0.35) * env * 0.055;
                } else if (type === 'whoosh') {
                    const env = Math.sin(Math.PI * progress);
                    const pseudoNoise = Math.sin(i * 12.9898) * 0.3 + Math.sin(t * 220 * Math.PI * 2) * 0.7;
                    v = pseudoNoise * env * 0.042;
                } else if (type === 'ding') {
                    const env = Math.sin(Math.min(1, progress / 0.06) * Math.PI * 0.5) * Math.exp(-progress * 5.2);
                    v = (Math.sin(2 * Math.PI * 880 * t) * 0.72 + Math.sin(2 * Math.PI * 1320 * t) * 0.28) * env * 0.055;
                }
                samples[i] = Math.max(-0.2, Math.min(0.2, v));
            }
            cachedSfxSamples.set(cacheKey, samples);
        }

        const buf = targetCtx.createBuffer(1, samples.length, sr);
        buf.getChannelData(0).set(samples);
        return buf;
    }

    async function renderMixedOfflineAudioBuffer(bgmStyle, targetSampleRate = 44100, numChannels = 1) {
        const OfflineCtx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        if (typeof OfflineCtx === 'undefined' || studioScenes.length === 0 || totalDuration <= 0) {
            return null;
        }
        const sr = Math.max(22050, parseInt(targetSampleRate, 10) || 44100);
        const channels = numChannels === 2 ? 2 : 1;
        const totalSamples = Math.max(1, Math.ceil(totalDuration * sr));
        const offlineCtx = new OfflineCtx(channels, totalSamples, sr);

        let masterDest = offlineCtx.destination;
        // Transparent protective peak limiter (prevents volume pumping/stuttering while avoiding clipping)
        if (typeof offlineCtx.createDynamicsCompressor === 'function') {
            try {
                const comp = offlineCtx.createDynamicsCompressor();
                if (comp.threshold) comp.threshold.value = -1.5;
                if (comp.knee) comp.knee.value = 4;
                if (comp.ratio) comp.ratio.value = 2.0;
                if (comp.attack) comp.attack.value = 0.005;
                if (comp.release) comp.release.value = 0.25;
                comp.connect(offlineCtx.destination);
                masterDest = comp;
            } catch (_) {
                masterDest = offlineCtx.destination;
            }
        }

        let sceneStart = 0;
        studioScenes.forEach((scene, idx) => {
            if (scene.audioBuffer) {
                const src = offlineCtx.createBufferSource();
                src.buffer = scene.audioBuffer;
                src.playbackRate.value = scene.playbackRate || 1.0;
                src.connect(masterDest);
                src.start(sceneStart);
            }
            const sfxName = scene.motionCue?.sfx;
            if (sfxName && sfxName !== 'none' && sceneStart < totalDuration - 0.05) {
                const sfxBuf = getCachedSfxBuffer(offlineCtx, sfxName);
                if (sfxBuf) {
                    const sfxNode = offlineCtx.createBufferSource();
                    sfxNode.buffer = sfxBuf;
                    sfxNode.connect(masterDest);
                    sfxNode.start(Math.max(0, idx > 0 ? sceneStart : 0.02));
                }
            }
            sceneStart += scene.duration;
        });

        const bgmBuffer = getCachedBgmBuffer(offlineCtx, bgmStyle, totalDuration);
        if (bgmBuffer) {
            const bgmNode = offlineCtx.createBufferSource();
            bgmNode.buffer = bgmBuffer;
            bgmNode.connect(masterDest);
            bgmNode.start(0);
        }

        return offlineCtx.startRendering();
    }

    function bufferHasAudibleAudio(audioBuffer) {
        if (!audioBuffer || audioBuffer.length === 0) return false;
        const ch = audioBuffer.getChannelData(0);
        const step = Math.max(1, Math.floor(ch.length / 4000));
        for (let i = 0; i < ch.length; i += step) {
            if (Math.abs(ch[i]) > 0.0005) return true;
        }
        return false;
    }

    async function loadMediabunnyTools() {
        if (cachedMediabunny !== undefined) return cachedMediabunny;
        if (typeof global.VideoEncoder === 'undefined' || typeof global.OfflineAudioContext === 'undefined') {
            cachedMediabunny = null;
            return null;
        }

        let mb = global.Mediabunny || null;
        let aacExt = global.MediabunnyAacEncoder || null;

        if (!mb || typeof mb.Output !== 'function') {
            try {
                mb = await import('https://cdn.jsdelivr.net/npm/mediabunny/+esm');
            } catch (_) {
                mb = null;
            }
        }
        if (!mb || typeof mb.Output !== 'function') {
            cachedMediabunny = null;
            return null;
        }

        try {
            let canAvc = false;
            try {
                canAvc = await mb.canEncodeVideo('avc', {
                    width: CANVAS_W,
                    height: CANVAS_H,
                    bitrate: 1_800_000
                });
            } catch (_) {
                canAvc = false;
            }
            if (!canAvc) {
                canAvc = await mb.canEncodeVideo('avc').catch(() => false);
            }
            if (!canAvc) {
                cachedMediabunny = null;
                return null;
            }
            let canNativeAac = false;
            try {
                canNativeAac = await mb.canEncodeAudio('aac');
            } catch (_) {
                canNativeAac = false;
            }
            let usedWasmAac = false;
            if (!canNativeAac) {
                if (!aacExt || typeof aacExt.registerAacEncoder !== 'function') {
                    try {
                        aacExt = await import('https://cdn.jsdelivr.net/npm/@mediabunny/aac-encoder/+esm');
                    } catch (_) {
                        aacExt = null;
                    }
                }
                if (aacExt && typeof aacExt.registerAacEncoder === 'function') {
                    aacExt.registerAacEncoder();
                    usedWasmAac = true;
                    canNativeAac = await mb.canEncodeAudio('aac').catch(() => false);
                }
            }
            if (!canNativeAac) {
                cachedMediabunny = null;
                return null;
            }
            cachedMediabunny = { mb, usedWasmAac };
            return cachedMediabunny;
        } catch (err) {
            console.warn('Mediabunny init failed:', err);
            cachedMediabunny = null;
            return null;
        }
    }

    async function exportWithMediabunny({ bgmStyle = 'upbeat', onProgress = null, signal = null } = {}) {
        const tools = await loadMediabunnyTools();
        if (!tools || studioScenes.length === 0 || !canvasEl) return null;
        const { mb, usedWasmAac } = tools;

        stopPlayback({ resetToZero: false });
        isRecording = true;
        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());

        try {
            if (onProgress) onProgress(5, 'Đang trộn âm thanh Stereo & chuẩn bị bộ mã hóa MP4 AAC...');
            const mixedStereo = await renderMixedOfflineAudioBuffer(bgmStyle, 48000, 2);
            if (!mixedStereo) throw new Error('Không khởi tạo được luồng âm thanh Stereo.');
            if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const hasAudioSignal = bufferHasAudibleAudio(mixedStereo);

            const output = new mb.Output({
                format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
                target: new mb.BufferTarget()
            });

            const videoSource = new mb.CanvasSource(canvasEl, {
                codec: 'avc',
                bitrate: mb.QUALITY_HIGH || 2_500_000
            });
            const audioSource = new mb.AudioBufferSource({
                codec: 'aac',
                bitrate: mb.QUALITY_HIGH || 128_000
            });

            output.addVideoTrack(videoSource);
            output.addAudioTrack(audioSource);
            await output.start();

            if (onProgress) onProgress(12, usedWasmAac ? 'Đang nén AAC Audio chuẩn Mobile (WASM)...' : 'Đang nén AAC Audio...');
            await audioSource.add(mixedStereo);
            audioSource.close();

            const fps = 30;
            const frameDur = 1 / fps;
            const totalFrames = Math.max(1, Math.ceil(totalDuration * fps));

            for (let f = 0; f < totalFrames; f++) {
                if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
                const t = Math.min(Math.max(0, totalDuration - 0.001), f * frameDur);
                renderFrameAtTime(t);
                await videoSource.add(t, frameDur);

                if (f % 8 === 0) {
                    const pct = 18 + Math.round(((f + 1) / totalFrames) * 77);
                    if (onProgress) onProgress(pct, `Đang xuất MP4 + AAC (${f + 1}/${totalFrames} khung hình)...`);
                }
            }

            videoSource.close();
            if (onProgress) onProgress(97, 'Đang đóng gói file .MP4 chuẩn Mobile...');
            await output.finalize();
            renderFrameAtTime(0);

            const outBuffer = output.target?.buffer;
            if (!outBuffer || outBuffer.byteLength < 1024) {
                throw new Error('File MP4 xuất ra quá nhỏ hoặc bị hỏng, đang chuyển bộ xuất dự phòng...');
            }

            return {
                blob: new Blob([outBuffer], { type: 'video/mp4' }),
                mimeType: 'video/mp4',
                hasAudio: hasAudioSignal,
                engineLabel: usedWasmAac ? 'MP4 H.264 + AAC WASM' : 'MP4 H.264 + AAC'
            };
        } finally {
            isRecording = false;
            if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
        }
    }

    async function probeFastExportFormat() {
        if (cachedFastFormat !== undefined) return cachedFastFormat;

        // Priority 1: Mediabunny MP4 (supports BOTH native AAC & @mediabunny/aac-encoder WASM AAC on Android Chrome & iOS Safari!)
        const mbTools = await loadMediabunnyTools();
        if (mbTools) {
            cachedFastFormat = {
                container: 'mediabunny-mp4',
                mimeType: 'video/mp4'
            };
            return cachedFastFormat;
        }

        const OfflineCtx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        if (
            typeof global.VideoEncoder === 'undefined' ||
            typeof global.AudioEncoder === 'undefined' ||
            typeof global.VideoFrame === 'undefined' ||
            typeof global.AudioData === 'undefined' ||
            typeof OfflineCtx === 'undefined'
        ) {
            cachedFastFormat = null;
            return null;
        }

        const fps = 30;
        const isIOS =
            /iPad|iPhone|iPod/.test(global.navigator?.userAgent || '') ||
            (global.navigator?.platform === 'MacIntel' && (global.navigator?.maxTouchPoints || 0) > 1);
        const isMobile =
            isIOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(global.navigator?.userAgent || '');
        const canNativeMp4Record =
            typeof global.MediaRecorder !== 'undefined' &&
            (MediaRecorder.isTypeSupported('video/mp4') || MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2'));

        let chosenFormat = null;

        if (typeof global.Mp4Muxer !== 'undefined') {
            const h264Candidates = ['avc1.42001f', 'avc1.4d001f', 'avc1.42001e'];
            const aacProfiles = [
                { numberOfChannels: 2, sampleRate: 48000, bitrate: 128_000 },
                { numberOfChannels: 2, sampleRate: 44100, bitrate: 128_000 },
                { numberOfChannels: 1, sampleRate: 48000, bitrate: 96_000 },
                { numberOfChannels: 1, sampleRate: 44100, bitrate: 96_000 }
            ];
            outerMp4: for (const h264Codec of h264Candidates) {
                const vCfg = {
                    codec: h264Codec,
                    width: CANVAS_W,
                    height: CANVAS_H,
                    bitrate: 2_500_000,
                    framerate: fps,
                    avc: { format: 'avc' }
                };
                const vSup = await VideoEncoder.isConfigSupported(vCfg).catch(() => ({ supported: false }));
                if (!vSup.supported) continue;

                for (const aProf of aacProfiles) {
                    const baseAac = {
                        codec: 'mp4a.40.2',
                        sampleRate: aProf.sampleRate,
                        numberOfChannels: aProf.numberOfChannels,
                        bitrate: aProf.bitrate
                    };
                    const aSupRaw = await AudioEncoder.isConfigSupported({ ...baseAac, aac: { format: 'aac' } }).catch(() => ({ supported: false }));
                    if (aSupRaw.supported) {
                        chosenFormat = {
                            container: 'mp4',
                            mimeType: 'video/mp4',
                            videoConfig: vCfg,
                            audioConfig: { ...baseAac, aac: { format: 'aac' } }
                        };
                        break outerMp4;
                    }
                    const aSupPlain = await AudioEncoder.isConfigSupported(baseAac).catch(() => ({ supported: false }));
                    if (aSupPlain.supported) {
                        chosenFormat = {
                            container: 'mp4',
                            mimeType: 'video/mp4',
                            videoConfig: vCfg,
                            audioConfig: baseAac
                        };
                        break outerMp4;
                    }
                }
            }
        }

        // On mobile (iOS & Android), prefer native MediaRecorder MP4 over WebM/Opus so phone galleries preserve sound
        if (!chosenFormat && typeof global.WebMMuxer !== 'undefined' && !(isMobile && canNativeMp4Record)) {
            const vpCandidates = [
                { codec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
                { codec: 'vp8', muxerCodec: 'V_VP8' }
            ];
            const opusChannels = [2, 1];
            outerWebm: for (const vp of vpCandidates) {
                const vCfg = {
                    codec: vp.codec,
                    width: CANVAS_W,
                    height: CANVAS_H,
                    bitrate: 2_200_000,
                    framerate: fps
                };
                const vSup = await VideoEncoder.isConfigSupported(vCfg).catch(() => ({ supported: false }));
                if (!vSup.supported) continue;

                for (const ch of opusChannels) {
                    const aCfg = {
                        codec: 'opus',
                        sampleRate: 48000,
                        numberOfChannels: ch,
                        bitrate: ch === 2 ? 128_000 : 96_000
                    };
                    const aSup = await AudioEncoder.isConfigSupported(aCfg).catch(() => ({ supported: false }));
                    if (aSup.supported) {
                        chosenFormat = {
                            container: 'webm',
                            mimeType: 'video/webm',
                            muxerCodec: vp.muxerCodec,
                            videoConfig: vCfg,
                            audioConfig: aCfg
                        };
                        break outerWebm;
                    }
                }
            }
        }

        cachedFastFormat = chosenFormat;
        return chosenFormat;
    }

    function canFastExportSync() {
        return Boolean(cachedFastFormat);
    }

    async function prebuildExportAssets(bgmStyle = 'upbeat') {
        const ctxAudio = ensureAudioContext();
        const targetSr = ctxAudio.sampleRate || 44100;
        const mixKey = `${bgmStyle}:${studioScenes.length}:${totalDuration.toFixed(3)}:${targetSr}`;
        const tasks = [probeFastExportFormat()];
        if (cachedRecordMix.key !== mixKey && studioScenes.length > 0 && totalDuration > 0) {
            tasks.push(
                renderMixedOfflineAudioBuffer(bgmStyle, targetSr)
                    .then((buf) => {
                        if (buf) cachedRecordMix = { key: mixKey, buffer: buf };
                    })
                    .catch(() => {})
            );
        }
        await Promise.all(tasks);
    }

    async function fastExportVideo({ bgmStyle = 'upbeat', onProgress = null, signal = null } = {}) {
        if (studioScenes.length === 0 || !canvasEl) {
            return null;
        }

        const fps = 30;
        let chosenFormat = await probeFastExportFormat();
        if (!chosenFormat) {
            return null;
        }

        if (chosenFormat.container === 'mediabunny-mp4') {
            try {
                const mbRes = await exportWithMediabunny({ bgmStyle, onProgress, signal });
                if (mbRes && mbRes.blob) return mbRes;
            } catch (mbErr) {
                if (mbErr?.name === 'AbortError') throw mbErr;
                console.warn('Mediabunny MP4 export failed, trying fallback:', mbErr);
                // Re-probe without Mediabunny cleanly
                cachedMediabunny = null;
                cachedFastFormat = undefined;
                chosenFormat = await probeFastExportFormat();
                if (!chosenFormat) return null;
            }
        }

        stopPlayback({ resetToZero: false });
        isRecording = true;
        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());

        let videoEncoder = null;
        let audioEncoder = null;

        try {
            const sampleRate = chosenFormat.audioConfig.sampleRate;
            const numChannels = chosenFormat.audioConfig.numberOfChannels;
            if (onProgress) onProgress(5, `Đang trộn âm thanh (${chosenFormat.container.toUpperCase()})...`);

            // 1. Offline Audio Rendering (~0.1s for a 30s video)
            const mixedAudio = await renderMixedOfflineAudioBuffer(bgmStyle, sampleRate);
            if (!mixedAudio) throw new Error('Không khởi tạo được luồng âm thanh Offline.');
            if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');

            // 2. Setup MP4 or WebM Muxer & Encoders
            const muxer =
                chosenFormat.container === 'mp4'
                    ? new Mp4Muxer.Muxer({
                          target: new Mp4Muxer.ArrayBufferTarget(),
                          video: {
                              codec: 'avc',
                              width: CANVAS_W,
                              height: CANVAS_H,
                              frameRate: fps
                          },
                          audio: {
                              codec: 'aac',
                              numberOfChannels: numChannels,
                              sampleRate
                          },
                          fastStart: 'in-memory',
                          firstTimestampBehavior: 'offset'
                      })
                    : new WebMMuxer.Muxer({
                          target: new WebMMuxer.ArrayBufferTarget(),
                          video: {
                              codec: chosenFormat.muxerCodec,
                              width: CANVAS_W,
                              height: CANVAS_H,
                              frameRate: fps
                          },
                          audio: {
                              codec: 'A_OPUS',
                              sampleRate,
                              numberOfChannels: numChannels
                          },
                          firstTimestampBehavior: 'offset'
                      });

            let encodeErr = null;
            let audioChunksEncoded = 0;
            videoEncoder = new VideoEncoder({
                output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                error: (e) => {
                    encodeErr = e;
                }
            });
            videoEncoder.configure(chosenFormat.videoConfig);

            audioEncoder = new AudioEncoder({
                output: (chunk, meta) => {
                    audioChunksEncoded++;
                    muxer.addAudioChunk(chunk, meta);
                },
                error: (e) => {
                    encodeErr = e;
                }
            });
            audioEncoder.configure(chosenFormat.audioConfig);

            // 3. Encode Audio in small hardware-friendly 2048-frame chunks (with stereo duplication if 2ch)
            if (onProgress) onProgress(15, 'Đang nén luồng âm thanh...');
            const channelData = mixedAudio.getChannelData(0);
            const audioChunkFrames = 2048;
            for (let offset = 0; offset < channelData.length; offset += audioChunkFrames) {
                if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
                if (encodeErr) throw encodeErr;

                const frameCount = Math.min(channelData.length - offset, audioChunkFrames);
                const slice = channelData.subarray(offset, offset + frameCount);
                let audioPayload = slice;
                if (numChannels === 2) {
                    const stereo = new Float32Array(frameCount * 2);
                    stereo.set(slice, 0);
                    stereo.set(slice, frameCount);
                    audioPayload = stereo;
                }

                const audioData = new AudioData({
                    format: 'f32-planar',
                    sampleRate,
                    numberOfFrames: frameCount,
                    numberOfChannels: numChannels,
                    timestamp: Math.round((offset / sampleRate) * 1_000_000),
                    data: audioPayload
                });
                audioEncoder.encode(audioData);
                audioData.close();

                if (audioEncoder.encodeQueueSize > 8) {
                    await new Promise((r) => setTimeout(r, 4));
                }
            }

            // 4. Render & Encode Video Frames (~8-10x faster than realtime)
            const totalFrames = Math.max(1, Math.ceil(totalDuration * fps));
            const frameDurationUs = Math.round(1_000_000 / fps);

            for (let f = 0; f < totalFrames; f++) {
                if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
                if (encodeErr) throw encodeErr;

                const t = Math.min(Math.max(0, totalDuration - 0.001), f / fps);
                renderFrameAtTime(t);

                const videoFrame = new VideoFrame(canvasEl, {
                    timestamp: Math.round((f / fps) * 1_000_000),
                    duration: frameDurationUs
                });
                videoEncoder.encode(videoFrame, { keyFrame: f % (fps * 2) === 0 });
                videoFrame.close();

                if (videoEncoder.encodeQueueSize > 8 || f % 10 === 0) {
                    const pct = 18 + Math.round(((f + 1) / totalFrames) * 77);
                    if (onProgress) onProgress(pct, `Đang xuất ${chosenFormat.container.toUpperCase()} (${f + 1}/${totalFrames} khung hình)...`);
                    while (videoEncoder.encodeQueueSize > 8) {
                        await new Promise((r) => setTimeout(r, 8));
                    }
                    if (f % 10 === 0) {
                        await new Promise((r) => setTimeout(r, 0));
                    }
                }
            }

            if (onProgress) onProgress(97, `Đang đóng gói file .${chosenFormat.container}...`);
            await videoEncoder.flush();
            await audioEncoder.flush();
            if (encodeErr) throw encodeErr;
            if (audioChunksEncoded === 0) {
                throw new Error('Trình duyệt không xuất được track âm thanh qua WebCodecs.');
            }

            muxer.finalize();
            renderFrameAtTime(0);

            return {
                blob: new Blob([muxer.target.buffer], { type: chosenFormat.mimeType }),
                mimeType: chosenFormat.mimeType,
                hasAudio: audioChunksEncoded > 0
            };
        } finally {
            isRecording = false;
            try {
                if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close();
            } catch (_) {}
            try {
                if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
            } catch (_) {}
            if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
        }
    }

    function getCachedMixedPreviewWavUrl(bgmStyle) {
        if (studioScenes.length === 0 || totalDuration <= 0) return '';
        const cacheKey = `${bgmStyle}:${studioScenes.length}:${totalDuration.toFixed(3)}`;
        return mixedPreviewCache.key === cacheKey && mixedPreviewCache.url ? mixedPreviewCache.url : '';
    }

    async function prepareMixedPreviewWavUrl(bgmStyle) {
        const cached = getCachedMixedPreviewWavUrl(bgmStyle);
        if (cached) return cached;
        const rendered = await renderMixedOfflineAudioBuffer(bgmStyle, 44100);
        if (!rendered) return '';

        const cacheKey = `${bgmStyle}:${studioScenes.length}:${totalDuration.toFixed(3)}`;
        const wavBlob = encodeAudioBufferToWavBlob(rendered);
        const nextUrl = URL.createObjectURL(wavBlob);
        revokeMixedPreviewCache();
        mixedPreviewCache = { key: cacheKey, url: nextUrl };
        return nextUrl;
    }

    function startRecordingSync({ bgmStyle = 'upbeat', onRecordComplete = null, onRecordProgress = null, onRecordError = null } = {}) {
        if (studioScenes.length === 0 || totalDuration <= 0 || !canvasEl) return;

        // 100% SYNCHRONOUS setup inside user tap gesture (zero awaits before activeRecorder.start) so iOS Safari & Android Chrome never mute audio
        stopPlayback({ resetToZero: false });
        const runId = ++playbackRunId;
        currentBgmStyle = bgmStyle;

        const ctxAudio = unlockAudioSync({ skipHtmlAudio: true });
        isPlaying = true;
        isRecording = true;
        useHtmlAudioClock = false;
        playbackOffset = 0;
        pausedAt = 0;

        let destNode = null;
        let recordMonitorGain = null;
        try {
            destNode = ctxAudio.createMediaStreamDestination();
            recordMonitorGain = ctxAudio.createGain();
            recordMonitorGain.gain.value = 0.002;
            recordMonitorGain.connect(ctxAudio.destination);
        } catch (audioErr) {
            isPlaying = false;
            isRecording = false;
            if (onRecordError) onRecordError(audioErr);
            return;
        }

        const nowAudioT = ctxAudio.currentTime;
        const targetSr = ctxAudio.sampleRate || 44100;
        const mixKey = `${bgmStyle}:${studioScenes.length}:${totalDuration.toFixed(3)}:${targetSr}`;

        if (cachedRecordMix.key === mixKey && cachedRecordMix.buffer) {
            const singleMixNode = ctxAudio.createBufferSource();
            singleMixNode.buffer = cachedRecordMix.buffer;
            singleMixNode.connect(destNode);
            if (recordMonitorGain) singleMixNode.connect(recordMonitorGain);
            singleMixNode.start(0);
            activeAudioSources.push(singleMixNode);
        } else {
            // Synchronous fallback scheduling when prebuild cache misses (e.g. user changed BGM right before Export)
            let sceneStart = 0;
            studioScenes.forEach((scene) => {
                if (scene.audioBuffer) {
                    const src = ctxAudio.createBufferSource();
                    src.buffer = scene.audioBuffer;
                    src.playbackRate.value = scene.playbackRate || 1.0;
                    src.connect(destNode);
                    if (recordMonitorGain) src.connect(recordMonitorGain);
                    src.start(nowAudioT + sceneStart);
                    activeAudioSources.push(src);
                }
                sceneStart += scene.duration;
            });

            const bgmBuffer = getCachedBgmBuffer(ctxAudio, bgmStyle, totalDuration);
            if (bgmBuffer) {
                const bgmNode = ctxAudio.createBufferSource();
                bgmNode.buffer = bgmBuffer;
                bgmNode.connect(destNode);
                if (recordMonitorGain) bgmNode.connect(recordMonitorGain);
                bgmNode.start(nowAudioT);
                activeAudioSources.push(bgmNode);
            }
        }

        // Keep-alive signal at t=0 BEFORE MediaRecorder initialization so Chromium & WebKit register live non-silent audio
        try {
            const keepAliveOsc = ctxAudio.createOscillator();
            const keepAliveGain = ctxAudio.createGain();
            keepAliveOsc.frequency.value = 40;
            keepAliveGain.gain.value = 0.0004;
            keepAliveOsc.connect(keepAliveGain);
            keepAliveGain.connect(destNode);
            if (recordMonitorGain) keepAliveGain.connect(recordMonitorGain);
            keepAliveOsc.start(0);
            activeAudioSources.push(keepAliveOsc);
        } catch (_) {}

        renderFrameAtTime(0);

        const recordedChunks = [];
        let videoTrack = null;
        try {
            const canvasStream = canvasEl.captureStream(30);
            videoTrack = canvasStream.getVideoTracks()[0] || null;
            const recAudioTracks = destNode ? destNode.stream.getAudioTracks() : [];
            recAudioTracks.forEach((track) => {
                track.enabled = true;
            });
            const combinedStream = new MediaStream([
                ...(videoTrack ? [videoTrack] : []),
                ...recAudioTracks
            ]);

            const mimeTypes = [
                'video/mp4;codecs="avc1.42E01E, mp4a.40.2"',
                'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
                'video/mp4;codecs=avc1,mp4a.40.2',
                'video/mp4',
                'video/webm;codecs=vp8,opus',
                'video/webm;codecs=vp9,opus',
                'video/webm'
            ];
            const supportedMime = mimeTypes.find((m) => global.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

            if (supportedMime) {
                if (supportedMime.includes('webm')) {
                    try {
                        activeRecorder = new MediaRecorder(combinedStream, {
                            mimeType: supportedMime,
                            audioBitsPerSecond: 128_000,
                            videoBitsPerSecond: 2_500_000
                        });
                    } catch (_) {
                        activeRecorder = new MediaRecorder(combinedStream, { mimeType: supportedMime });
                    }
                } else {
                    activeRecorder = new MediaRecorder(combinedStream, { mimeType: supportedMime });
                }
            } else {
                activeRecorder = new MediaRecorder(combinedStream);
            }

            activeRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) recordedChunks.push(e.data);
            };
            activeRecorder.onerror = (ev) => {
                stopPlayback({ resetToZero: true });
                if (onRecordError) onRecordError(ev?.error || new Error('Lỗi ghi video trên trình duyệt.'));
            };
            activeRecorder.onstop = () => {
                const type = supportedMime || activeRecorder?.mimeType || 'video/webm';
                const blob = new Blob(recordedChunks, { type });
                if (onRecordComplete && recordedChunks.length > 0) {
                    onRecordComplete(blob, type, recAudioTracks.length > 0 && ctxAudio.state === 'running');
                } else if (onRecordError) {
                    onRecordError(new Error('Không thu được dữ liệu video.'));
                }
            };
            activeRecorder.start(500);
        } catch (recErr) {
            stopPlayback({ resetToZero: true });
            if (onRecordError) onRecordError(recErr);
            return;
        }

        audioStartTime = ctxAudio.currentTime;
        perfStartTime = performance.now();
        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());

        const tick = () => {
            if (!isPlaying || runId !== playbackRunId) return;
            const current = getCurrentTime();
            if (current >= totalDuration) {
                renderFrameAtTime(totalDuration - 0.01);
                if (videoTrack?.requestFrame) {
                    try {
                        videoTrack.requestFrame();
                    } catch (_) {}
                }
                const rec = activeRecorder;
                isPlaying = false;
                isRecording = false;
                pausedAt = 0;
                playbackOffset = 0;
                stopTimers();
                clearScheduledAudio();
                if (rec && rec.state !== 'inactive') {
                    rec.stop();
                }
                activeRecorder = null;
                if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
                return;
            }
            renderFrameAtTime(current);
            if (videoTrack?.requestFrame) {
                try {
                    videoTrack.requestFrame();
                } catch (_) {}
            }
            if (onRecordProgress && totalDuration > 0) {
                onRecordProgress(Math.min(99, Math.round((current / totalDuration) * 100)));
            }
            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);

        bgTimerId = setInterval(() => {
            if (!isPlaying || runId !== playbackRunId) return;
            if (document.hidden) {
                const current = getCurrentTime();
                if (current >= totalDuration) {
                    tick();
                } else {
                    renderFrameAtTime(current);
                    if (videoTrack?.requestFrame) {
                        try {
                            videoTrack.requestFrame();
                        } catch (_) {}
                    }
                }
            }
        }, 33);
    }

    async function startPlayback({ startAt = null, bgmStyle = 'upbeat', recordMode = false, onRecordComplete = null, onRecordProgress = null, onRecordError = null } = {}) {
        if (recordMode) {
            startRecordingSync({ bgmStyle, onRecordComplete, onRecordProgress, onRecordError });
            return;
        }
        if (studioScenes.length === 0 || totalDuration <= 0) return;

        stopPlayback({ resetToZero: false });
        const runId = ++playbackRunId;
        currentBgmStyle = bgmStyle;

        const targetStart = startAt !== null ? startAt : pausedAt >= totalDuration - 0.05 ? 0 : pausedAt;
        playbackOffset = Math.max(0, Math.min(totalDuration, targetStart));
        pausedAt = playbackOffset;

        const audioEl = getOrCreatePreviewAudioEl();
        if (audioEl) {
            try {
                // Use synchronous cache hit first so tapping Play/Unmute on iOS Safari executes .play() with ZERO await delay!
                let wavUrl = getCachedMixedPreviewWavUrl(bgmStyle);
                if (!wavUrl) {
                    wavUrl = await prepareMixedPreviewWavUrl(bgmStyle);
                    if (runId !== playbackRunId) return;
                }
                if (wavUrl) {
                    useHtmlAudioClock = true;
                    isPlaying = true;
                    isRecording = false;
                    perfStartTime = performance.now();

                    if (audioEl.src !== wavUrl) {
                        audioEl.src = wavUrl;
                    }
                    if (audioEl.dataset) audioEl.dataset.kind = 'mixed';
                    audioEl.muted = false;
                    audioEl.volume = 1.0;
                    try {
                        audioEl.currentTime = playbackOffset;
                    } catch (_) {
                        audioEl.addEventListener(
                            'loadedmetadata',
                            () => {
                                try {
                                    audioEl.currentTime = playbackOffset;
                                } catch (_) {}
                            },
                            { once: true }
                        );
                    }

                    const playPromise = audioEl.play();
                    if (playPromise && typeof playPromise.then === 'function') {
                        playPromise
                            .then(() => {
                                if (runId !== playbackRunId) return;
                                isAudioUnlocked = true;
                                if (callbacks.onAudioBlocked) callbacks.onAudioBlocked(false);
                            })
                            .catch(() => {
                                if (runId !== playbackRunId) return;
                                if (callbacks.onAudioBlocked) callbacks.onAudioBlocked(true);
                                if (App.toast) {
                                    App.toast.show('Chạm nút "Chạm để bật âm thanh" trên khung video để nghe!', 'info', { duration: 4500 });
                                }
                            });
                    } else if (callbacks.onAudioBlocked) {
                        callbacks.onAudioBlocked(false);
                    }

                    if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
                    const tickHtml = () => {
                        if (!isPlaying || runId !== playbackRunId) return;
                        const current = getCurrentTime();
                        if (current >= totalDuration || audioEl.ended) {
                            renderFrameAtTime(totalDuration - 0.01);
                            isPlaying = false;
                            pausedAt = 0;
                            playbackOffset = 0;
                            stopTimers();
                            clearScheduledAudio();
                            if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
                            return;
                        }
                        renderFrameAtTime(current);
                        rafId = requestAnimationFrame(tickHtml);
                    };
                    rafId = requestAnimationFrame(tickHtml);
                    return;
                }
            } catch (mixErr) {
                console.warn('HTML Audio mix preview fallback to WebAudio:', mixErr);
                useHtmlAudioClock = false;
            }
        }
        if (runId !== playbackRunId) return;

        let ctxAudio = ensureAudioContext();
        if (ctxAudio.state === 'suspended' || ctxAudio.state === 'interrupted') {
            // Race resume with 120ms cap so playback NEVER freezes indefinitely on hung mobile/OS audio resume
            try {
                await Promise.race([ctxAudio.resume(), new Promise((r) => setTimeout(r, 120))]);
            } catch (_) {}
            if (runId !== playbackRunId) return;

            // If interrupted audio context refused to resume, cleanly recreate a fresh one
            if (ctxAudio.state === 'interrupted' || ctxAudio.state === 'closed') {
                try {
                    ctxAudio.close().catch(() => {});
                } catch (_) {}
                audioCtx = null;
                ctxAudio = ensureAudioContext();
            }
        }
        if (runId !== playbackRunId) return;

        const audioBlocked = ctxAudio.state !== 'running';
        if (callbacks.onAudioBlocked) {
            callbacks.onAudioBlocked(audioBlocked);
        }
        if (audioBlocked && App.toast) {
            App.toast.show('Trình duyệt điện thoại cần bạn chạm nút "Chạm để bật âm thanh" trên khung video!', 'info', { duration: 4500 });
        }

        isPlaying = true;
        isRecording = false;
        audioStartTime = ctxAudio.currentTime + 0.05;
        perfStartTime = performance.now() + 50;

        let sceneStart = 0;
        studioScenes.forEach((scene, idx) => {
            const sceneEnd = sceneStart + scene.duration;
            if (scene.audioBuffer && sceneEnd > playbackOffset) {
                const src = ctxAudio.createBufferSource();
                src.buffer = scene.audioBuffer;
                const rate = scene.playbackRate || 1.0;
                src.playbackRate.value = rate;
                src.connect(ctxAudio.destination);

                if (playbackOffset <= sceneStart) {
                    const delay = sceneStart - playbackOffset;
                    src.start(audioStartTime + delay);
                } else {
                    const skipAudioSec = (playbackOffset - sceneStart) * rate;
                    if (skipAudioSec < scene.audioBuffer.duration) {
                        src.start(audioStartTime, skipAudioSec);
                    }
                }
                activeAudioSources.push(src);
            }
            const sfxName = scene.motionCue?.sfx;
            if (sfxName && sfxName !== 'none' && sceneStart >= playbackOffset && sceneStart < totalDuration - 0.05) {
                const sfxBuf = getCachedSfxBuffer(ctxAudio, sfxName);
                if (sfxBuf) {
                    const sfxNode = ctxAudio.createBufferSource();
                    sfxNode.buffer = sfxBuf;
                    sfxNode.connect(ctxAudio.destination);
                    const sfxDelay = Math.max(0, (idx > 0 ? sceneStart : 0.02) - playbackOffset);
                    sfxNode.start(audioStartTime + sfxDelay);
                    activeAudioSources.push(sfxNode);
                }
            }
            sceneStart = sceneEnd;
        });

        const bgmBuffer = getCachedBgmBuffer(ctxAudio, bgmStyle, totalDuration);
        if (bgmBuffer) {
            const bgmNode = ctxAudio.createBufferSource();
            bgmNode.buffer = bgmBuffer;
            bgmNode.connect(ctxAudio.destination);
            bgmNode.start(audioStartTime, playbackOffset % bgmBuffer.duration);
            activeAudioSources.push(bgmNode);
        }

        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());

        const tick = () => {
            if (!isPlaying) return;
            const current = getCurrentTime();
            if (current >= totalDuration) {
                renderFrameAtTime(totalDuration - 0.01);
                isPlaying = false;
                pausedAt = 0;
                playbackOffset = 0;
                stopTimers();
                clearScheduledAudio();
                if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
                return;
            }
            renderFrameAtTime(current);
            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
    }

    let previewBgmSource = null;

    function previewBgmSample(style = 'upbeat', durationSec = 3.5) {
        clearScheduledAudio();
        if (style === 'none') return;
        const ctxAudio = unlockAudioSync({ skipHtmlAudio: true });
        const buf = getCachedBgmBuffer(ctxAudio, style, durationSec);
        if (!buf) return;

        const audioEl = getOrCreatePreviewAudioEl();
        if (audioEl && typeof global.Blob !== 'undefined') {
            try {
                const wavBlob = encodeAudioBufferToWavBlob(buf);
                const url = URL.createObjectURL(wavBlob);
                if (audioEl.dataset) audioEl.dataset.kind = 'bgm';
                audioEl.src = url;
                audioEl.muted = false;
                audioEl.volume = 1.0;
                audioEl.onended = () => {
                    try {
                        URL.revokeObjectURL(url);
                    } catch (_) {}
                };
                const p = audioEl.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(() => {});
                }
                return;
            } catch (_) {}
        }

        const src = ctxAudio.createBufferSource();
        src.buffer = buf;
        src.connect(ctxAudio.destination);
        src.start(ctxAudio.currentTime);
        previewBgmSource = src;
    }

    App.mediaEngine = {
        bindCanvasElements,
        ensureAudioContext,
        unlockAudioSync,
        prepareForExportSync,
        prebuildExportAssets,
        canFastExportSync,
        prepareMixedPreviewWavUrl,
        encodeAudioBufferToWavBlob,
        previewBgmSample,
        decodeTtsToAudioBuffer,
        pcm16ToAudioBuffer,
        splitAudioBufferIntoBeats,
        findAudioPivotRatio,
        splitCombinedAudioBuffer,
        createSilentBuffer,
        loadImageFromUrl,
        loadRealLifeStockPhoto,
        createIllustratedFallbackCard,
        setScenes,
        getScenes,
        getTotalDuration,
        getPlaybackState,
        drawPlaceholderCanvas,
        renderFrameAtTime,
        fastExportVideo,
        startRecordingSync,
        startPlayback,
        pausePlayback,
        stopPlayback,
        seekTo
    };
})(window);
