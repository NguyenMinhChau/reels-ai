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

    // Tiny silent WAV (0.05s) to switch iOS WebKit audio hardware channel from Ambient -> Playback
    // so Web Audio works even when iPhone physical Silent Switch is ON.
    const SILENT_WAV_DATA_URI =
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    let silentHtmlAudioEl = null;
    let isAudioUnlocked = false;

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
    function unlockAudioSync() {
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

        if (!isAudioUnlocked) {
            try {
                if (!silentHtmlAudioEl) {
                    silentHtmlAudioEl = new Audio(SILENT_WAV_DATA_URI);
                    silentHtmlAudioEl.setAttribute('playsinline', 'true');
                    silentHtmlAudioEl.playsInline = true;
                    silentHtmlAudioEl.volume = 0.01;
                }
                const p = silentHtmlAudioEl.play();
                if (p && typeof p.then === 'function') {
                    p.then(() => {
                        isAudioUnlocked = true;
                    }).catch(() => {});
                } else {
                    isAudioUnlocked = true;
                }
            } catch (_) {}
        }
        return ctxAudio;
    }

    function normalizeVoiceBuffer(audioBuffer) {
        if (!audioBuffer || audioBuffer.length === 0) return audioBuffer;
        const data = audioBuffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]);
            if (abs > peak) peak = abs;
        }
        if (peak > 0.02 && peak < 0.78) {
            const gain = Math.min(2.6, 0.85 / peak);
            for (let i = 0; i < data.length; i++) {
                data[i] = Math.max(-0.98, Math.min(0.98, data[i] * gain));
            }
        }
        return audioBuffer;
    }

    function trimAudioSilence(audioBuffer, targetCtx, threshold = 0.01, keepPadSec = 0.11) {
        if (!audioBuffer || audioBuffer.length === 0) return audioBuffer;
        const sr = audioBuffer.sampleRate;
        const data = audioBuffer.getChannelData(0);
        const len = data.length;

        let start = 0;
        while (start < len && Math.abs(data[start]) < threshold) start++;

        let end = len - 1;
        while (end > start && Math.abs(data[end]) < threshold) end--;

        if (start >= end) return normalizeVoiceBuffer(audioBuffer);

        const padSamples = Math.floor(sr * keepPadSec);
        const trimStart = Math.max(0, start - padSamples);
        const trimEnd = Math.min(len, end + padSamples + 1);
        const outLen = trimEnd - trimStart;

        if (outLen <= 0 || outLen >= len * 0.96) return normalizeVoiceBuffer(audioBuffer);

        const outBuf = targetCtx.createBuffer(1, outLen, sr);
        const outData = outBuf.getChannelData(0);
        outData.set(data.subarray(trimStart, trimEnd));

        // 8ms micro fade-in/fade-out prevents clicks at scene boundaries
        const fadeSamples = Math.min(Math.floor(sr * 0.008), Math.floor(outLen / 4));
        for (let i = 0; i < fadeSamples; i++) {
            const g = i / fadeSamples;
            outData[i] *= g;
            outData[outLen - 1 - i] *= g;
        }
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
                chunkBuf.getChannelData(0).set(data.subarray(start, start + len));
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
            chunkBuf.getChannelData(0).set(data.subarray(start, start + len));
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
    function precomputeSceneSubtitles(text) {
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
            const fontSize = chunkText.length > 26 ? 29 : 33;
            const lineHeight = fontSize + 12;
            measureCtx.font = `900 ${fontSize}px Inter, sans-serif`;
            const lines = measureWrappedLines(measureCtx, chunkText, 460);
            const totalHeight = lines.length * lineHeight;
            const bottomMargin = 105;
            const startY = CANVAS_H - bottomMargin - totalHeight + fontSize;
            return {
                fontSize,
                lineHeight,
                lines,
                startY
            };
        });
    }

    function setScenes(scenes, videoTitle = '') {
        stopPlayback({ resetToZero: false });
        currentVideoTitle = String(videoTitle || '').trim();
        const measureCtx = ctx || document.createElement('canvas').getContext('2d');
        measureCtx.font = '800 22px Inter, sans-serif';
        precomputedTitleLines = currentVideoTitle
            ? measureWrappedLines(measureCtx, currentVideoTitle.toUpperCase(), 420).slice(0, 2)
            : [];

        studioScenes = (scenes || []).map((scene) => ({
            ...scene,
            precomputedChunks: precomputeSceneSubtitles(scene.text)
        }));
        totalDuration = studioScenes.reduce((sum, s) => sum + (Number.isFinite(s.duration) ? s.duration : 2.0), 0);
        pausedAt = 0;
        playbackOffset = 0;
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
        let elapsed = wallElapsed;
        if (audioCtx && audioCtx.state === 'running') {
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
        const isMotionStyle = currentScene.visualStyle === 'motion' && Boolean(App.motionGraphics);
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        if (isMotionStyle) {
            // 1. Flat-Vector 2D Motion Infographic Scene (with whip-slide transition)
            const prevScene = activeIdx > 0 ? studioScenes[activeIdx - 1] : null;
            App.motionGraphics.drawMotionScene(ctx, currentScene, sceneProgress, activeIdx, elapsed, prevScene);
        } else {
            // 1. Photo background + smooth crossfade
            if (currentScene.imageObj) {
                drawImageWithMotion(currentScene.imageObj, sceneProgress, currentScene.motionType, 1);
                if (sceneProgress < 0.12 && activeIdx > 0 && studioScenes[activeIdx - 1].imageObj) {
                    const fadeOutAlpha = 1 - sceneProgress / 0.12;
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

            // 2. Cached top/bottom gradient overlay
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

        // 3. Top Story Progress Bars (adapts cleanly for 5..15+ synced beats)
        const count = studioScenes.length;
        const barGap = count > 8 ? 4 : 6;
        const barWidth = (CANVAS_W - 48 - (count - 1) * barGap) / count;
        for (let i = 0; i < count; i++) {
            const bx = 24 + i * (barWidth + barGap);
            ctx.fillStyle = isMotionStyle ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.32)';
            ctx.beginPath();
            ctx.roundRect(bx, 18, barWidth, 5, 3);
            ctx.fill();

            if (i < activeIdx) {
                ctx.fillStyle = isMotionStyle ? '#0f172a' : '#ffffff';
                ctx.beginPath();
                ctx.roundRect(bx, 18, barWidth, 5, 3);
                ctx.fill();
            } else if (i === activeIdx) {
                ctx.fillStyle = isMotionStyle ? '#0f172a' : '#ffffff';
                ctx.beginPath();
                ctx.roundRect(bx, 18, barWidth * Math.min(1, sceneProgress), 5, 3);
                ctx.fill();
            }
        }

        // 3b. Dynamic Beat Callout Pill in Photo mode (so every synced cut feels fresh)
        if (!isMotionStyle && currentScene.motionCue && (activeIdx > 0 || precomputedTitleLines.length === 0)) {
            const badgeText = currentScene.motionCue.highlightBadge || currentScene.motionCue.topBadge;
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

        // 3c. Top Hook Title Banner during first beat in Photo mode
        if (!isMotionStyle && activeIdx === 0 && precomputedTitleLines.length > 0) {
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

        // 4. Precomputed dynamic subtitles aligned to actual speech span (finishes slightly before 0.18s scene breath gap)
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

            if (!isMotionStyle) {
                const boxTop = chunk.startY - chunk.fontSize - 4;
                const boxHeight = chunk.lines.length * chunk.lineHeight + 12;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
                ctx.beginPath();
                ctx.roundRect(28, boxTop, CANVAS_W - 56, boxHeight, 16);
                ctx.fill();
            }

            ctx.textAlign = 'center';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = isMotionStyle ? '#0f172a' : 'rgba(0, 0, 0, 0.95)';
            ctx.lineWidth = isMotionStyle ? 8 : 7;

            chunk.lines.forEach((line, i) => {
                const ly = chunk.startY + i * chunk.lineHeight;
                ctx.strokeText(line, 270, ly);
                if (isMotionStyle) {
                    ctx.fillStyle = '#ffffff';
                } else {
                    const isHighlight = activeIdx === 0 || (activeIdx === 4 && i === 0);
                    ctx.fillStyle = isHighlight ? '#fde047' : '#ffffff';
                }
                ctx.fillText(line, 270, ly);
            });
            ctx.restore();
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

    async function fastExportVideo({ bgmStyle = 'upbeat', onProgress = null, signal = null } = {}) {
        if (
            studioScenes.length === 0 ||
            !canvasEl ||
            typeof global.VideoEncoder === 'undefined' ||
            typeof global.AudioEncoder === 'undefined' ||
            typeof global.VideoFrame === 'undefined' ||
            typeof global.AudioData === 'undefined' ||
            typeof global.OfflineAudioContext === 'undefined'
        ) {
            return null;
        }

        const fps = 30;
        const sampleRate = 48000;

        // Probe best container & codecs:
        // 1) MP4 (H.264 + AAC) — plays & saves natively on iPhone/iOS, Android, Facebook Reels
        // 2) WebM (VP9/VP8 + Opus) — fallback for browsers without AAC/H264 WebCodecs
        let chosenFormat = null;

        if (typeof global.Mp4Muxer !== 'undefined') {
            const h264Candidates = ['avc1.42001f', 'avc1.4d001f', 'avc1.42001e'];
            for (const h264Codec of h264Candidates) {
                const vCfg = {
                    codec: h264Codec,
                    width: CANVAS_W,
                    height: CANVAS_H,
                    bitrate: 2_500_000,
                    framerate: fps,
                    avc: { format: 'avc' }
                };
                const aCfg = {
                    codec: 'mp4a.40.2',
                    sampleRate,
                    numberOfChannels: 1,
                    bitrate: 128_000
                };
                const [vSup, aSup] = await Promise.all([
                    VideoEncoder.isConfigSupported(vCfg).catch(() => ({ supported: false })),
                    AudioEncoder.isConfigSupported(aCfg).catch(() => ({ supported: false }))
                ]);
                if (vSup.supported && aSup.supported) {
                    chosenFormat = {
                        container: 'mp4',
                        mimeType: 'video/mp4',
                        videoConfig: vCfg,
                        audioConfig: aCfg
                    };
                    break;
                }
            }
        }

        if (!chosenFormat && typeof global.WebMMuxer !== 'undefined') {
            const vpCandidates = [
                { codec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
                { codec: 'vp8', muxerCodec: 'V_VP8' }
            ];
            for (const vp of vpCandidates) {
                const vCfg = {
                    codec: vp.codec,
                    width: CANVAS_W,
                    height: CANVAS_H,
                    bitrate: 2_200_000,
                    framerate: fps
                };
                const aCfg = {
                    codec: 'opus',
                    sampleRate,
                    numberOfChannels: 1,
                    bitrate: 96_000
                };
                const [vSup, aSup] = await Promise.all([
                    VideoEncoder.isConfigSupported(vCfg).catch(() => ({ supported: false })),
                    AudioEncoder.isConfigSupported(aCfg).catch(() => ({ supported: false }))
                ]);
                if (vSup.supported && aSup.supported) {
                    chosenFormat = {
                        container: 'webm',
                        mimeType: 'video/webm',
                        muxerCodec: vp.muxerCodec,
                        videoConfig: vCfg,
                        audioConfig: aCfg
                    };
                    break;
                }
            }
        }

        if (!chosenFormat) {
            return null;
        }

        stopPlayback({ resetToZero: false });
        isRecording = true;
        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());

        let videoEncoder = null;
        let audioEncoder = null;

        try {
            if (onProgress) onProgress(5, `Đang trộn âm thanh (${chosenFormat.container.toUpperCase()})...`);

            // 1. Offline Audio Rendering (~0.1s for a 30s video)
            const totalSamples = Math.max(1, Math.ceil(totalDuration * sampleRate));
            const offlineCtx = new OfflineAudioContext(1, totalSamples, sampleRate);

            let sceneStart = 0;
            studioScenes.forEach((scene) => {
                if (scene.audioBuffer) {
                    const src = offlineCtx.createBufferSource();
                    src.buffer = scene.audioBuffer;
                    src.playbackRate.value = scene.playbackRate || 1.0;
                    src.connect(offlineCtx.destination);
                    src.start(sceneStart);
                }
                sceneStart += scene.duration;
            });

            const bgmBuffer = getCachedBgmBuffer(offlineCtx, bgmStyle, totalDuration);
            if (bgmBuffer) {
                const bgmNode = offlineCtx.createBufferSource();
                bgmNode.buffer = bgmBuffer;
                bgmNode.connect(offlineCtx.destination);
                bgmNode.start(0);
            }

            const mixedAudio = await offlineCtx.startRendering();
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
                              numberOfChannels: 1,
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
                              numberOfChannels: 1
                          },
                          firstTimestampBehavior: 'offset'
                      });

            let encodeErr = null;
            videoEncoder = new VideoEncoder({
                output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
                error: (e) => {
                    encodeErr = e;
                }
            });
            videoEncoder.configure(chosenFormat.videoConfig);

            audioEncoder = new AudioEncoder({
                output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
                error: (e) => {
                    encodeErr = e;
                }
            });
            audioEncoder.configure(chosenFormat.audioConfig);

            // 3. Encode Audio in 0.5s chunks
            if (onProgress) onProgress(15, 'Đang nén luồng âm thanh...');
            const channelData = mixedAudio.getChannelData(0);
            const audioChunkFrames = sampleRate / 2;
            for (let offset = 0; offset < channelData.length; offset += audioChunkFrames) {
                if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
                if (encodeErr) throw encodeErr;
                const slice = channelData.subarray(offset, Math.min(channelData.length, offset + audioChunkFrames));
                const audioData = new AudioData({
                    format: 'f32-planar',
                    sampleRate,
                    numberOfFrames: slice.length,
                    numberOfChannels: 1,
                    timestamp: Math.round((offset / sampleRate) * 1_000_000),
                    data: slice
                });
                audioEncoder.encode(audioData);
                audioData.close();
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

            muxer.finalize();
            renderFrameAtTime(0);

            return {
                blob: new Blob([muxer.target.buffer], { type: chosenFormat.mimeType }),
                mimeType: chosenFormat.mimeType
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

    async function startPlayback({ startAt = null, bgmStyle = 'upbeat', recordMode = false, onRecordComplete = null, onRecordProgress = null, onRecordError = null } = {}) {
        if (studioScenes.length === 0 || totalDuration <= 0) return;

        stopPlayback({ resetToZero: false });
        const runId = ++playbackRunId;
        currentBgmStyle = bgmStyle;

        const targetStart = startAt !== null ? startAt : pausedAt >= totalDuration - 0.05 ? 0 : pausedAt;
        playbackOffset = Math.max(0, Math.min(totalDuration, targetStart));
        pausedAt = playbackOffset;

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

        const audioBlocked = ctxAudio.state !== 'running' && !recordMode;
        if (callbacks.onAudioBlocked) {
            callbacks.onAudioBlocked(audioBlocked);
        }
        if (audioBlocked && App.toast) {
            App.toast.show('Trình duyệt điện thoại cần bạn chạm nút "Chạm để bật âm thanh" trên khung video!', 'info', { duration: 4500 });
        }

        isPlaying = true;
        isRecording = Boolean(recordMode);
        const destNode = recordMode ? ctxAudio.createMediaStreamDestination() : null;

        audioStartTime = ctxAudio.currentTime + 0.05;
        perfStartTime = performance.now() + 50;

        // Schedule scene audio buffers starting cleanly from playbackOffset
        let sceneStart = 0;
        studioScenes.forEach((scene) => {
            const sceneEnd = sceneStart + scene.duration;
            if (scene.audioBuffer && sceneEnd > playbackOffset) {
                const src = ctxAudio.createBufferSource();
                src.buffer = scene.audioBuffer;
                const rate = scene.playbackRate || 1.0;
                src.playbackRate.value = rate;
                if (!recordMode) src.connect(ctxAudio.destination);
                if (destNode) src.connect(destNode);

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
            sceneStart = sceneEnd;
        });

        // Schedule cached BGM
        const bgmBuffer = getCachedBgmBuffer(ctxAudio, bgmStyle, totalDuration);
        if (bgmBuffer) {
            const bgmNode = ctxAudio.createBufferSource();
            bgmNode.buffer = bgmBuffer;
            if (!recordMode) bgmNode.connect(ctxAudio.destination);
            if (destNode) bgmNode.connect(destNode);
            bgmNode.start(audioStartTime, playbackOffset % bgmBuffer.duration);
            activeAudioSources.push(bgmNode);
        }

        // Keep audio stream alive during recording on Safari/WebKit even across micro gaps
        if (recordMode && destNode) {
            try {
                const keepAliveOsc = ctxAudio.createOscillator();
                const keepAliveGain = ctxAudio.createGain();
                keepAliveGain.gain.value = 0.0001;
                keepAliveOsc.connect(keepAliveGain);
                keepAliveGain.connect(destNode);
                keepAliveOsc.start(audioStartTime);
                activeAudioSources.push(keepAliveOsc);
            } catch (_) {}
        }

        // Setup MediaRecorder if exporting
        const recordedChunks = [];
        if (recordMode && canvasEl) {
            try {
                const canvasStream = canvasEl.captureStream(30);
                const combinedStream = new MediaStream([
                    ...canvasStream.getVideoTracks(),
                    ...destNode.stream.getAudioTracks()
                ]);

                const mimeTypes = [
                    'video/mp4;codecs=avc1,mp4a.40.2',
                    'video/mp4',
                    'video/webm;codecs=vp9,opus',
                    'video/webm;codecs=vp8,opus',
                    'video/webm'
                ];
                const supportedMime = mimeTypes.find((m) => global.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

                activeRecorder = new MediaRecorder(
                    combinedStream,
                    supportedMime ? { mimeType: supportedMime } : {}
                );
                activeRecorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
                };
                activeRecorder.onerror = (ev) => {
                    stopPlayback({ resetToZero: true });
                    if (onRecordError) onRecordError(ev?.error || new Error('Lỗi ghi video trên trình duyệt.'));
                };
                activeRecorder.onstop = () => {
                    const type = supportedMime || 'video/webm';
                    const blob = new Blob(recordedChunks, { type });
                    if (onRecordComplete && recordedChunks.length > 0) {
                        onRecordComplete(blob, type);
                    } else if (onRecordError) {
                        onRecordError(new Error('Không thu được dữ liệu video.'));
                    }
                };
                activeRecorder.start(250);
            } catch (recErr) {
                stopPlayback({ resetToZero: true });
                if (onRecordError) onRecordError(recErr);
                return;
            }
        }

        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());

        const tick = () => {
            if (!isPlaying) return;
            const current = getCurrentTime();
            if (current >= totalDuration) {
                renderFrameAtTime(totalDuration - 0.01);
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
            if (isRecording && onRecordProgress && totalDuration > 0) {
                onRecordProgress(Math.min(99, Math.round((current / totalDuration) * 100)));
            }
            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);

        // Background fallback heartbeat during export in case tab is hidden (rAF pauses when backgrounded)
        if (recordMode) {
            bgTimerId = setInterval(() => {
                if (!isPlaying) return;
                if (document.hidden) {
                    const current = getCurrentTime();
                    if (current >= totalDuration) {
                        tick();
                    } else {
                        renderFrameAtTime(current);
                    }
                }
            }, 33);
        }
    }

    let previewBgmSource = null;

    function previewBgmSample(style = 'upbeat', durationSec = 3.5) {
        if (previewBgmSource) {
            try {
                previewBgmSource.stop();
                previewBgmSource.disconnect();
            } catch (_) {}
            previewBgmSource = null;
        }
        if (style === 'none') return;
        const ctxAudio = unlockAudioSync();
        const buf = getCachedBgmBuffer(ctxAudio, style, durationSec);
        if (!buf) return;
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
        previewBgmSample,
        decodeTtsToAudioBuffer,
        pcm16ToAudioBuffer,
        splitAudioBufferIntoBeats,
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
        startPlayback,
        pausePlayback,
        stopPlayback,
        seekTo
    };
})(window);
