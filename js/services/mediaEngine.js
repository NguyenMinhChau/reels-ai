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

    const bgmBufferCache = new Map();

    // Callbacks registered by VideoStudio UI
    let callbacks = {
        onProgressUpdate: null,
        onStateChange: null
    };

    function bindCanvasElements(canvas, timerBadge, cbs = {}) {
        canvasEl = canvas;
        ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
        timerBadgeEl = timerBadge || null;
        callbacks = { ...callbacks, ...cbs };
        cachedOverlayGrad = null;
        cachedFallbackGrad = null;
    }

    function ensureAudioContext() {
        if (!audioCtx || audioCtx.state === 'closed') {
            const Ctx = global.AudioContext || global.webkitAudioContext;
            audioCtx = new Ctx();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    }

    function trimAudioSilence(audioBuffer, targetCtx, threshold = 0.012, keepPadSec = 0.05) {
        if (!audioBuffer || audioBuffer.length === 0) return audioBuffer;
        const sr = audioBuffer.sampleRate;
        const data = audioBuffer.getChannelData(0);
        const len = data.length;

        let start = 0;
        while (start < len && Math.abs(data[start]) < threshold) start++;

        let end = len - 1;
        while (end > start && Math.abs(data[end]) < threshold) end--;

        if (start >= end) return audioBuffer;

        const padSamples = Math.floor(sr * keepPadSec);
        const trimStart = Math.max(0, start - padSamples);
        const trimEnd = Math.min(len, end + padSamples + 1);
        const outLen = trimEnd - trimStart;

        if (outLen <= 0 || outLen >= len * 0.96) return audioBuffer;

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
        return outBuf;
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

    // Split a single combined TTS AudioBuffer cleanly into N scene chunks at silence valleys
    function splitCombinedAudioBuffer(fullBuffer, texts, targetCtx) {
        if (!fullBuffer || !Array.isArray(texts) || texts.length === 0) return [];
        const count = texts.length;
        const sr = fullBuffer.sampleRate;
        const data = fullBuffer.getChannelData(0);
        const totalSamples = data.length;
        const totalDur = totalSamples / sr;

        const wordCounts = texts.map((t) => Math.max(1, String(t || '').split(/\s+/).filter(Boolean).length));
        const totalWords = wordCounts.reduce((a, b) => a + b, 0);

        const winSamples = Math.max(1, Math.floor(sr * 0.04)); // 40ms energy window
        const cutSamples = [0];
        let cumWords = 0;

        for (let k = 0; k < count - 1; k++) {
            cumWords += wordCounts[k];
            const expectedSample = Math.floor(totalSamples * (cumWords / totalWords));
            const minSample = Math.max(cutSamples[k] + Math.floor(sr * 1.2), expectedSample - Math.floor(sr * 2.2));
            const maxSample = Math.min(totalSamples - Math.floor(sr * 1.2), expectedSample + Math.floor(sr * 2.2));

            let bestSample = Math.min(Math.max(expectedSample, cutSamples[k] + Math.floor(sr * 0.8)), totalSamples - 1);
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

        return texts.map((t, idx) => {
            const start = cutSamples[idx];
            const end = Math.max(start + Math.floor(sr * 0.5), cutSamples[idx + 1]);
            const len = Math.min(totalSamples - start, end - start);
            const chunkBuf = targetCtx.createBuffer(1, Math.max(1, len), sr);
            chunkBuf.getChannelData(0).set(data.subarray(start, start + len));
            return chunkBuf;
        });
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

    async function loadRealLifeStockPhoto(sceneIndex, videoTitle) {
        const lower = (videoTitle || '').toLowerCase();
        let photoIds = STOCK_PHOTOS.default;
        if (lower.includes('ngủ') || lower.includes('đêm') || lower.includes('sáng')) {
            photoIds = STOCK_PHOTOS.sleep;
        } else if (lower.includes('áo') || lower.includes('giày') || lower.includes('dọn')) {
            photoIds = STOCK_PHOTOS.tidy;
        }

        const chosenId = photoIds[sceneIndex % photoIds.length];
        const url = `https://images.unsplash.com/photo-${chosenId}?auto=format&fit=crop&w=720&h=1280&q=85`;

        try {
            return await loadImageFromUrl(url, 'anonymous');
        } catch (_) {
            return createIllustratedFallbackCard(sceneIndex, videoTitle);
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
        const chunkSize = 7;
        const rawChunks = [];

        for (let i = 0; i < allWords.length; i += chunkSize) {
            rawChunks.push(allWords.slice(i, i + chunkSize).join(' '));
        }
        if (rawChunks.length === 0) rawChunks.push(fullSubText || '...');

        const measureCtx = ctx || document.createElement('canvas').getContext('2d');

        return rawChunks.map((chunkText) => {
            const fontSize = chunkText.length > 36 ? 27 : 31;
            const lineHeight = fontSize + 12;
            measureCtx.font = `900 ${fontSize}px Inter, sans-serif`;
            const lines = measureWrappedLines(measureCtx, chunkText, 460);
            const totalHeight = lines.length * lineHeight;
            const bottomMargin = 95;
            const startY = CANVAS_H - bottomMargin - totalHeight + fontSize;
            return {
                fontSize,
                lineHeight,
                lines,
                startY
            };
        });
    }

    function setScenes(scenes) {
        studioScenes = (scenes || []).map((scene) => ({
            ...scene,
            precomputedChunks: precomputeSceneSubtitles(scene.text)
        }));
        totalDuration = studioScenes.reduce((sum, s) => sum + s.duration, 0);
        pausedAt = 0;
        lastFormattedSecond = '';
        updateTimerText(0);
        if (studioScenes.length > 0) {
            renderFrameAtTime(0);
        }
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
        const elapsed =
            audioCtx && audioCtx.state === 'running'
                ? Math.max(0, audioCtx.currentTime - audioStartTime)
                : Math.max(0, (performance.now() - perfStartTime) / 1000);
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
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        // 1. Background image + smooth crossfade
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

        // 3. Top 5-segment progress bars
        const count = studioScenes.length;
        const barWidth = (CANVAS_W - 48 - (count - 1) * 6) / count;
        for (let i = 0; i < count; i++) {
            const bx = 24 + i * (barWidth + 6);
            ctx.fillStyle = 'rgba(255,255,255,0.32)';
            ctx.beginPath();
            ctx.roundRect(bx, 18, barWidth, 5, 3);
            ctx.fill();

            if (i < activeIdx) {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.roundRect(bx, 18, barWidth, 5, 3);
                ctx.fill();
            } else if (i === activeIdx) {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.roundRect(bx, 18, barWidth * Math.min(1, sceneProgress), 5, 3);
                ctx.fill();
            }
        }

        // 4. Precomputed CapCut-style dynamic subtitles
        const chunks = currentScene.precomputedChunks;
        if (chunks && chunks.length > 0) {
            const chunkIdx = Math.min(chunks.length - 1, Math.floor(sceneProgress * chunks.length));
            const chunkLocalProgress = sceneProgress * chunks.length - chunkIdx;
            const chunk = chunks[chunkIdx];
            const popScale = chunkLocalProgress < 0.15 ? 0.92 + (chunkLocalProgress / 0.15) * 0.08 : 1.0;

            ctx.font = `900 ${chunk.fontSize}px Inter, sans-serif`;
            ctx.save();
            ctx.translate(270, chunk.startY);
            ctx.scale(popScale, popScale);
            ctx.translate(-270, -chunk.startY);
            ctx.textAlign = 'center';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
            ctx.lineWidth = 8;

            chunk.lines.forEach((line, i) => {
                const ly = chunk.startY + i * chunk.lineHeight;
                ctx.strokeText(line, 270, ly);
                const isHighlight = (activeIdx === 0 && chunkIdx === 0) || (activeIdx === 4 && i === 0);
                ctx.fillStyle = isHighlight ? '#fde047' : '#ffffff';
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

        const chords =
            style === 'upbeat'
                ? [
                      [261.63, 329.63, 392.0],
                      [293.66, 369.99, 440.0],
                      [329.63, 415.3, 493.88],
                      [261.63, 329.63, 392.0]
                  ]
                : [
                      [220.0, 261.63, 329.63],
                      [174.61, 220.0, 261.63],
                      [196.0, 246.94, 293.66],
                      [164.81, 196.0, 246.94]
                  ];

        const beatDur = style === 'upbeat' ? 1.5 : 2.5;
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const chordIdx = Math.floor(t / beatDur) % chords.length;
            const chord = chords[chordIdx];
            const env = Math.sin((Math.PI * (t % beatDur)) / beatDur);
            let sample = 0;
            for (let c = 0; c < chord.length; c++) {
                sample += Math.sin(2 * Math.PI * chord[c] * t);
            }
            data[i] = (sample / chord.length) * env * 0.11;
        }

        if (bgmBufferCache.size > 6) {
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
        if (!isPlaying || isRecording) return;
        pausedAt = getCurrentTime();
        isPlaying = false;
        stopTimers();
        clearScheduledAudio();
        if (callbacks.onStateChange) callbacks.onStateChange(getPlaybackState());
    }

    function stopPlayback({ resetToZero = true } = {}) {
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

    async function startPlayback({ startAt = null, bgmStyle = 'upbeat', recordMode = false, onRecordComplete = null } = {}) {
        if (studioScenes.length === 0) return;

        stopPlayback({ resetToZero: false });
        currentBgmStyle = bgmStyle;

        const targetStart = startAt !== null ? startAt : pausedAt >= totalDuration - 0.05 ? 0 : pausedAt;
        playbackOffset = Math.max(0, Math.min(totalDuration, targetStart));
        pausedAt = playbackOffset;

        const ctxAudio = ensureAudioContext();
        if (ctxAudio.state === 'suspended') {
            try {
                await ctxAudio.resume();
            } catch (_) {}
        }

        if (ctxAudio.state !== 'running' && !recordMode && App.toast) {
            App.toast.show('Trình duyệt đang tạm khóa tự phát âm thanh — bấm nút Phát (▶) trên khung video để nghe!', 'info');
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
                const rate = scene.playbackRate || 1.18;
                src.playbackRate.value = rate;
                src.connect(ctxAudio.destination);
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
            bgmNode.connect(ctxAudio.destination);
            if (destNode) bgmNode.connect(destNode);
            bgmNode.start(audioStartTime, playbackOffset % bgmBuffer.duration);
            activeAudioSources.push(bgmNode);
        }

        // Setup MediaRecorder if exporting
        const recordedChunks = [];
        if (recordMode && canvasEl) {
            const canvasStream = canvasEl.captureStream(30);
            const combinedStream = new MediaStream([
                ...canvasStream.getVideoTracks(),
                ...destNode.stream.getAudioTracks()
            ]);

            const mimeTypes = [
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
            activeRecorder.onstop = () => {
                const type = supportedMime || 'video/webm';
                const blob = new Blob(recordedChunks, { type });
                if (onRecordComplete && recordedChunks.length > 0) {
                    onRecordComplete(blob, type);
                }
            };
            activeRecorder.start(250);
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

    App.mediaEngine = {
        bindCanvasElements,
        ensureAudioContext,
        decodeTtsToAudioBuffer,
        pcm16ToAudioBuffer,
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
        startPlayback,
        pausePlayback,
        stopPlayback,
        seekTo
    };
})(window);
