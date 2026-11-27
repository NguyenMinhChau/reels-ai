/* ==========================================================================
   AI Reels Video & Voice Studio Modal Controller
   - No auto-API call on modal open (prevents API spam!)
   - Per-scene image upload or batch upload + smart diff caching
   - AbortController cancels pending API requests on close/regenerate
   - Interactive Play/Pause/Scrubbing & Export (.mp4/.webm)
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { MOTION_TYPES } = App.CONFIG;
    const { splitScriptIntoFiveScenes, hashString } = App.utils;

    let customImages = [null, null, null, null, null];
    let lastGeneratedMeta = [null, null, null, null, null]; // Track scene cache signatures
    let generationAbortController = null;
    let rewriteAbortController = null;
    let isSeeking = false;

    function getSceneInputs() {
        return [1, 2, 3, 4, 5].map((i) => document.getElementById(`vs-scene-${i}`));
    }

    function updateStudioProgress(pct, text, statusType = 'loading') {
        const box = document.getElementById('vs-progress-box');
        const pctEl = document.getElementById('vs-progress-pct');
        const barEl = document.getElementById('vs-progress-bar');
        const textEl = document.getElementById('vs-progress-text');
        if (!box || !pctEl || !barEl || !textEl) return;

        box.classList.remove('hidden');
        pctEl.textContent = `${pct}%`;
        barEl.style.width = `${pct}%`;

        const iconHtml =
            statusType === 'done'
                ? '<i class="fa-solid fa-circle-check text-emerald-600 mr-1.5"></i>'
                : statusType === 'error'
                    ? '<i class="fa-solid fa-circle-exclamation text-rose-600 mr-1.5"></i>'
                    : '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>';

        textEl.innerHTML = `${iconHtml}<span></span>`;
        textEl.lastElementChild.textContent = text;
    }

    function updateImageStatusLabel() {
        const count = customImages.filter(Boolean).length;
        const label = document.getElementById('vs-img-status');
        if (!label) return;
        label.textContent = count > 0 ? `Đã chọn ${count}/5 ảnh thật` : 'Chế độ ảnh thật tự nhiên';
    }

    function syncPlaybackUI(playbackState) {
        const playIcon = document.getElementById('icon-preview-play');
        const scrubber = document.getElementById('vs-scrubber');

        if (playIcon) {
            playIcon.className = playbackState.isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play ml-0.5';
        }
        if (scrubber && !isSeeking && playbackState.totalDuration > 0) {
            scrubber.max = String(playbackState.totalDuration);
            scrubber.value = String(playbackState.currentTime);
        }
    }

    function open({ title, scenes }) {
        App.mediaEngine.stopPlayback();
        cancelOngoingRequests();

        customImages = [null, null, null, null, null];
        lastGeneratedMeta = [null, null, null, null, null];
        updateImageStatusLabel();

        const titleInput = document.getElementById('vs-title');
        if (titleInput) titleInput.value = title || '';

        const inputs = getSceneInputs();
        inputs.forEach((el, i) => {
            if (el) el.value = scenes[i] || '';
        });

        const uploadInput = document.getElementById('vs-upload-images');
        if (uploadInput) uploadInput.value = '';

        document.getElementById('btn-generate-ai-assets').disabled = false;
        document.getElementById('btn-export-video').disabled = true;
        document.getElementById('vs-playback-controls')?.classList.add('hidden');
        document.getElementById('vs-timer-badge')?.classList.add('hidden');
        document.getElementById('vs-progress-box')?.classList.add('hidden');

        App.mediaEngine.drawPlaceholderCanvas(title);
        document.getElementById('video-studio-modal')?.classList.remove('hidden');
    }

    function openFromScratch() {
        open({
            title: 'Mẹo nhỏ giúp cuộc sống nhẹ nhàng hơn',
            scenes: [
                'Bạn có biết chỉ một thay đổi nhỏ mỗi sáng có thể giúp cả ngày làm việc hiệu quả gấp đôi?',
                'Nhiều người thường vội vàng lướt điện thoại ngay khi vừa mở mắt khiến tinh thần mệt mỏi.',
                'Thay vào đó, hãy uống một ly nước ấm và mở cửa sổ đón ánh nắng tự nhiên trong 5 phút.',
                'Tiếp theo, viết ra đúng 3 việc quan trọng nhất cần hoàn thành trong ngày hôm nay.',
                'Thử áp dụng ngay sáng mai nhé, và đừng quên Follow mình để nhận thêm năng lượng tích cực!'
            ]
        });
    }

    function openFromTemplate(templateId) {
        const tpl = App.store.getState().templates.find((t) => t.id === templateId);
        if (!tpl) return;
        open({
            title: tpl.title,
            scenes: splitScriptIntoFiveScenes(tpl.hook, tpl.body, tpl.cta)
        });
    }

    function openFromUserScript(userScriptId) {
        const item = App.store.getState().userScripts.find((s) => s.id === userScriptId);
        if (!item) return;
        open({
            title: item.title,
            scenes: splitScriptIntoFiveScenes(item.hook, item.body, item.cta)
        });
    }

    function cancelOngoingRequests() {
        if (generationAbortController) {
            generationAbortController.abort();
            generationAbortController = null;
        }
        if (rewriteAbortController) {
            rewriteAbortController.abort();
            rewriteAbortController = null;
        }
    }

    function close() {
        cancelOngoingRequests();
        App.mediaEngine.stopPlayback();
        const btnGen = document.getElementById('btn-generate-ai-assets');
        if (btnGen) btnGen.disabled = false;
        document.getElementById('video-studio-modal')?.classList.add('hidden');
    }

    function handleCustomImagesUpload(e) {
        const files = Array.from(e.target.files || []).slice(0, 5);
        if (files.length === 0) return;

        customImages = [null, null, null, null, null];
        let loaded = 0;

        files.forEach((file, idx) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    customImages[idx] = img;
                    loaded++;
                    if (loaded === files.length) {
                        updateImageStatusLabel();
                        App.toast.show(`Đã tải lên ${files.length} ảnh thật của bạn!`);
                    }
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function handleEnhanceStorytelling() {
        const btn = document.getElementById('btn-rewrite-story');
        if (!btn || btn.disabled) return;

        const title = document.getElementById('vs-title')?.value.trim() || '';
        const draftLines = getSceneInputs().map((el) => (el ? el.value.trim() : ''));

        btn.disabled = true;
        const prevHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang viết lời thoại...</span>';

        if (rewriteAbortController) rewriteAbortController.abort();
        rewriteAbortController = new AbortController();

        try {
            const rewritten = await App.geminiApi.enhanceStorytelling({
                title,
                draftLines,
                signal: rewriteAbortController.signal
            });

            getSceneInputs().forEach((el, i) => {
                if (el && rewritten[i]) el.value = rewritten[i];
            });
            App.toast.show('Đã nâng cấp 5 đoạn lời thoại kể chuyện cuốn hút!');
        } catch (err) {
            if (err.name === 'AbortError') return;
            App.toast.show(err.message || 'Không thể viết lại lời thoại.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = prevHtml;
            rewriteAbortController = null;
        }
    }

    async function handleGenerateAssets() {
        const btn = document.getElementById('btn-generate-ai-assets');
        if (!btn || btn.disabled) return;

        btn.disabled = true;
        const btnExport = document.getElementById('btn-export-video');
        if (btnExport) btnExport.disabled = true;

        App.mediaEngine.stopPlayback();
        if (generationAbortController) generationAbortController.abort();
        generationAbortController = new AbortController();
        const signal = generationAbortController.signal;

        const videoTitle = document.getElementById('vs-title')?.value.trim() || 'Mẹo hay cuộc sống';
        const texts = getSceneInputs().map((el) => (el ? el.value.trim() : '') || 'Chia sẻ khoảnh khắc đời sống hằng ngày gần gũi.');
        const voiceName = document.getElementById('vs-voice')?.value || 'Aoede';
        const speedRate = parseFloat(document.getElementById('vs-speed')?.value || '1.18') || 1.18;
        const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';
        const imageSourceMode = document.getElementById('vs-image-source')?.value || 'ai';

        const audioCtx = App.mediaEngine.ensureAudioContext();
        const existingScenes = App.mediaEngine.getScenes();

        try {
            const needAnyAiImages = imageSourceMode !== 'stock';
            updateStudioProgress(
                10,
                needAnyAiImages
                    ? 'Đang phân tích bối cảnh thực tế sát với nội dung...'
                    : 'Đang chuẩn bị tạo giọng đọc AI...'
            );

            const visualPrompts = needAnyAiImages
                ? await App.geminiApi.generateRealisticVisualPrompts({
                      title: videoTitle,
                      sceneTexts: texts,
                      signal
                  })
                : texts.map((t, idx) => `${videoTitle} ${idx + 1}`);

            updateStudioProgress(25, 'Đang tạo giọng đọc AI 5 phân cảnh (ưu tiên âm thanh mượt)...');

            let fallbackTtsCount = 0;
            let lastTtsError = '';
            const sceneAudios = new Array(5);
            const sceneHasRealTts = new Array(5).fill(false);

            // 1. Prioritize generating all 5 TTS voices cleanly before image API calls compete for RPM
            await Promise.all(
                [0, 1, 2, 3, 4].map(async (i) => {
                    const sceneText = texts[i];
                    const textVoiceSig = hashString(`${sceneText}|${voiceName}`);
                    const prevMeta = lastGeneratedMeta[i];
                    const prevScene = existingScenes[i];

                    if (prevMeta && prevMeta.hasRealTts && prevMeta.textVoiceSig === textVoiceSig && prevScene?.audioBuffer) {
                        sceneAudios[i] = prevScene.audioBuffer;
                        sceneHasRealTts[i] = true;
                        return;
                    }

                    const ttsRes = await App.geminiApi.fetchSceneTtsPcm({
                        text: sceneText,
                        voiceName,
                        signal
                    });
                    if (ttsRes.buffer) {
                        const rateMatch = String(ttsRes.mimeType || '').match(/rate=(\d+)/i);
                        const parsedRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
                        const decoded = await App.mediaEngine.decodeTtsToAudioBuffer(ttsRes.buffer, audioCtx, parsedRate || 24000);
                        if (decoded) {
                            sceneAudios[i] = decoded;
                            sceneHasRealTts[i] = true;
                            return;
                        }
                    }

                    fallbackTtsCount++;
                    if (ttsRes.errorReason && !lastTtsError) lastTtsError = ttsRes.errorReason;
                    sceneAudios[i] = App.mediaEngine.createSilentBuffer(audioCtx, sceneText);
                })
            );

            updateStudioProgress(60, 'Đã xong giọng đọc! Đang dựng hình ảnh 5 phân cảnh...');

            let completedCount = 0;
            const builtScenes = new Array(5);

            // 2. Load/generate scene images
            await Promise.all(
                [0, 1, 2, 3, 4].map(async (i) => {
                    const sceneText = texts[i];
                    const textVoiceSig = hashString(`${sceneText}|${voiceName}`);
                    const imageSig = hashString(`${videoTitle}|${visualPrompts[i]}|${imageSourceMode}`);
                    const prevMeta = lastGeneratedMeta[i];
                    const prevScene = existingScenes[i];

                    let imgObj =
                        customImages[i] ||
                        (customImages.some(Boolean) ? customImages[i % customImages.length] || customImages.find(Boolean) : null);
                    let hasRealAiImage = false;

                    const allowAiImageThisScene =
                        imageSourceMode === 'ai' || (imageSourceMode === 'hybrid' && (i === 0 || i === 2));

                    if (!imgObj && allowAiImageThisScene) {
                        if (prevMeta && prevMeta.hasRealAiImage && prevMeta.imageSig === imageSig && !prevMeta.wasCustom && prevScene?.imageObj) {
                            imgObj = prevScene.imageObj;
                            hasRealAiImage = true;
                        } else {
                            const imgRes = await App.geminiApi.fetchSceneImageDataUrl({
                                promptText: visualPrompts[i],
                                signal
                            });
                            if (imgRes.dataUrl) {
                                try {
                                    imgObj = await App.mediaEngine.loadImageFromUrl(imgRes.dataUrl);
                                    hasRealAiImage = true;
                                } catch (_) {
                                    imgObj = null;
                                }
                            }
                        }
                    }

                    if (!imgObj) {
                        imgObj = await App.mediaEngine.loadRealLifeStockPhoto(i, videoTitle);
                    }

                    completedCount++;
                    const pct = 60 + Math.round((completedCount / 5) * 35);
                    updateStudioProgress(pct, `Đã dựng xong ${completedCount}/5 phân cảnh...`);

                    const audioBuffer = sceneAudios[i];
                    const effectiveAudioDur = audioBuffer.duration / speedRate;
                    lastGeneratedMeta[i] = {
                        textVoiceSig,
                        imageSig,
                        wasCustom: Boolean(customImages[i]),
                        hasRealTts: sceneHasRealTts[i],
                        hasRealAiImage
                    };

                    builtScenes[i] = {
                        text: sceneText,
                        visualPrompt: visualPrompts[i],
                        imageObj: imgObj,
                        audioBuffer,
                        playbackRate: speedRate,
                        duration: Math.max(1.2, effectiveAudioDur + 0.04),
                        motionType: MOTION_TYPES[i % MOTION_TYPES.length]
                    };
                })
            );

            App.mediaEngine.setScenes(builtScenes);
            const totalSec = Math.round(App.mediaEngine.getTotalDuration());

            if (fallbackTtsCount === 5) {
                const detailMsg = lastTtsError || 'Không nhận được giọng đọc AI (kiểm tra API Key hoặc quota 429).';
                updateStudioProgress(
                    100,
                    `Đã dựng video (${totalSec}s) — Lỗi TTS: ${detailMsg}`,
                    'done'
                );
                App.toast.show(detailMsg, 'warning', {
                    actionLabel: 'Cài Key',
                    onAction: () => App.modals.openSettingsModal(),
                    duration: 7000
                });
            } else if (fallbackTtsCount > 0) {
                const detailMsg = lastTtsError ? ` (${lastTtsError})` : '';
                updateStudioProgress(
                    100,
                    `Đã dựng video (${totalSec}s); có ${fallbackTtsCount}/5 cảnh bị thiếu giọng đọc${detailMsg}.`,
                    'done'
                );
                App.toast.show(`Đã tạo video ${totalSec}s (${5 - fallbackTtsCount}/5 cảnh có giọng AI)!`, 'warning');
            } else {
                updateStudioProgress(
                    100,
                    `Hoàn tất! Video 5 cảnh (${totalSec}s) đã sẵn sàng phát & tải về.`,
                    'done'
                );
                App.toast.show(`Đã tạo xong video ${totalSec}s đầy đủ & khớp âm thanh!`);
            }
            if (btnExport) btnExport.disabled = false;
            document.getElementById('vs-playback-controls')?.classList.remove('hidden');
            document.getElementById('vs-timer-badge')?.classList.remove('hidden');

            await App.mediaEngine.startPlayback({ startAt: 0, bgmStyle, recordMode: false });
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error(err);
            updateStudioProgress(0, err.message || 'Có lỗi xảy ra. Vui lòng thử lại!', 'error');
            App.toast.show(err.message || 'Lỗi tạo tài nguyên video', 'error');
        } finally {
            btn.disabled = false;
            generationAbortController = null;
        }
    }

    function handleTogglePlayPause() {
        const state = App.mediaEngine.getPlaybackState();
        const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';
        if (state.isPlaying) {
            App.mediaEngine.pausePlayback();
        } else {
            App.mediaEngine.startPlayback({ bgmStyle, recordMode: false });
        }
    }

    function handleExportVideo() {
        const scenes = App.mediaEngine.getScenes();
        if (scenes.length === 0) return;

        const btnExport = document.getElementById('btn-export-video');
        const btnGen = document.getElementById('btn-generate-ai-assets');
        const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';

        if (btnExport) btnExport.disabled = true;
        if (btnGen) btnGen.disabled = true;

        updateStudioProgress(100, 'Đang ghi hình & đồng bộ âm thanh (vui lòng giữ tab mở cho đến khi chạy xong)...', 'loading');

        App.mediaEngine.startPlayback({
            startAt: 0,
            bgmStyle,
            recordMode: true,
            onRecordComplete: (blob, mimeType) => {
                const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const safeTitle = (document.getElementById('vs-title')?.value.trim() || 'facebook-reels')
                    .toLowerCase()
                    .replace(/[^a-z0-9\u00C0-\u1EF9]+/g, '-')
                    .replace(/^-+|-+$/g, '');

                a.href = url;
                a.download = `${safeTitle || 'facebook-reels'}-reels.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 5000);

                if (btnExport) btnExport.disabled = false;
                if (btnGen) btnGen.disabled = false;
                updateStudioProgress(100, `Hoàn tất! Đã tải video (.${ext}) về máy của bạn.`, 'done');
                App.toast.show('Video Reels đã được tải về máy của bạn!');
            }
        });
    }

    function init() {
        const canvas = document.getElementById('reels-canvas');
        const timerBadge = document.getElementById('vs-timer-badge');
        const scrubber = document.getElementById('vs-scrubber');

        let lastScrubberUpdate = 0;
        App.mediaEngine.bindCanvasElements(canvas, timerBadge, {
            onStateChange: syncPlaybackUI,
            onProgressUpdate: (elapsed, total) => {
                const now = performance.now();
                if (scrubber && !isSeeking && total > 0 && now - lastScrubberUpdate >= 100) {
                    lastScrubberUpdate = now;
                    scrubber.max = String(total);
                    scrubber.value = String(elapsed);
                }
            }
        });

        document.getElementById('btn-open-studio-scratch')?.addEventListener('click', openFromScratch);
        document.getElementById('btn-rewrite-story')?.addEventListener('click', handleEnhanceStorytelling);
        document.getElementById('btn-generate-ai-assets')?.addEventListener('click', handleGenerateAssets);
        document.getElementById('btn-export-video')?.addEventListener('click', handleExportVideo);
        document.getElementById('btn-preview-play')?.addEventListener('click', handleTogglePlayPause);
        document.getElementById('btn-preview-replay')?.addEventListener('click', () => {
            const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';
            App.mediaEngine.startPlayback({ startAt: 0, bgmStyle, recordMode: false });
        });
        document.getElementById('vs-upload-images')?.addEventListener('change', handleCustomImagesUpload);
        document.getElementById('btn-clear-custom-images')?.addEventListener('click', () => {
            customImages = [null, null, null, null, null];
            const uploadInput = document.getElementById('vs-upload-images');
            if (uploadInput) uploadInput.value = '';
            updateImageStatusLabel();
            App.toast.show('Đã xóa ảnh tải lên, dùng ảnh tự động.', 'info');
        });

        if (scrubber) {
            scrubber.addEventListener('input', (e) => {
                isSeeking = true;
                App.mediaEngine.renderFrameAtTime(parseFloat(e.target.value) || 0);
            });
            scrubber.addEventListener('change', (e) => {
                isSeeking = false;
                App.mediaEngine.seekTo(parseFloat(e.target.value) || 0);
            });
        }
    }

    App.videoStudio = {
        init,
        open,
        openFromScratch,
        openFromTemplate,
        openFromUserScript,
        close
    };
})(window);
