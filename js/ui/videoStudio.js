/* ==========================================================================
   AI Reels Video & Voice Studio Modal Controller
   - Supports 2D Motion Infographic & Photo/AI Reels modes
   - No auto-API call on modal open (prevents API spam!)
   - Smart scene diff caching + AbortController cancellation
   - Interactive Play/Pause/Scrubbing & Fast MP4/WebM Export + Mobile Share
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { MOTION_TYPES } = App.CONFIG;
    const { splitScriptIntoFiveScenes, splitTextIntoVisualBeats, hashString } = App.utils;

    let customImages = [null, null, null, null, null];
    let lastChapterAudioMeta = [null, null, null, null, null];
    let cachedChapterAudios = [null, null, null, null, null];
    let generationAbortController = null;
    let rewriteAbortController = null;
    let exportAbortController = null;
    let lastExportedFile = null;
    let isSeeking = false;

    function revokeLastExport() {
        if (lastExportedFile?.url) {
            try {
                URL.revokeObjectURL(lastExportedFile.url);
            } catch (_) {}
        }
        lastExportedFile = null;
        document.getElementById('vs-export-ready-box')?.classList.add('hidden');
    }

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

    function pickDefaultBgmForTitle(title) {
        const lower = (title || '').toLowerCase();
        if (/cảnh báo|lừa đảo|cháy|nổ|ổ điện|cốp xe|hỏng/.test(lower)) return 'alert';
        if (/ngủ|đêm|chữa lành|piano|21 giờ|stress/.test(lower)) return 'healing';
        if (/nhắc|uống nước|bố mẹ|lofi|lo-fi|tập trung/.test(lower)) return 'lofi';
        if (/sáng|5h30|năng lượng/.test(lower)) return 'morning';
        return 'upbeat';
    }

    function open({ title, scenes }) {
        App.mediaEngine.stopPlayback();
        cancelOngoingRequests();
        revokeLastExport();

        customImages = [null, null, null, null, null];
        lastChapterAudioMeta = [null, null, null, null, null];
        cachedChapterAudios = [null, null, null, null, null];
        updateImageStatusLabel();

        const titleInput = document.getElementById('vs-title');
        if (titleInput) titleInput.value = title || '';

        const bgmSelect = document.getElementById('vs-bgm');
        if (bgmSelect) bgmSelect.value = pickDefaultBgmForTitle(title);

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
        document.getElementById('btn-unmute-mobile-audio')?.classList.add('hidden');

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
        if (exportAbortController) {
            exportAbortController.abort();
            exportAbortController = null;
        }
    }

    function close() {
        cancelOngoingRequests();
        App.mediaEngine.stopPlayback();
        revokeLastExport();
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
        const tone = document.getElementById('vs-tone')?.value || 'viral';
        const draftLines = getSceneInputs().map((el) => (el ? el.value.trim() : ''));

        btn.disabled = true;
        const prevHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang viết lại cực cuốn...</span>';

        if (rewriteAbortController) rewriteAbortController.abort();
        rewriteAbortController = new AbortController();

        try {
            const rewritten = await App.geminiApi.enhanceStorytelling({
                title,
                draftLines,
                tone,
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

    function buildSyncedCueSequence(flatBeats, aiStoryboard, videoTitle) {
        const templates = App.motionGraphics?.VISUAL_TEMPLATES || [];
        const themes = App.motionGraphics?.THEME_NAMES || [];
        const usedCounts = new Map();
        let prevTemplate = '';
        let prevTheme = '';

        return flatBeats.map((beat, idx) => {
            const localCue = App.motionGraphics
                ? App.motionGraphics.analyzeSceneVisualCue(beat.text, idx, videoTitle, {
                      prevTemplate,
                      prevTheme,
                      usedCounts
                  })
                : {
                      template: 'character',
                      theme: 'cream',
                      topBadge: `NHỊP ${idx + 1}`,
                      cardLabel: beat.text.slice(0, 20).toUpperCase(),
                      highlightBadge: 'REELS',
                      sceneText: beat.text,
                      videoTitle
                  };

            const aiItem = Array.isArray(aiStoryboard) ? aiStoryboard[idx] : null;
            let finalCue = localCue;

            if (aiItem && templates.includes(aiItem.template)) {
                let tpl = aiItem.template;
                // Strictly forbid consecutive duplicate templates even if AI slipped
                if (tpl === prevTemplate) {
                    tpl = localCue.template;
                }
                let thm = themes.includes(aiItem.theme) ? aiItem.theme : localCue.theme;
                if (thm === prevTheme) {
                    thm = localCue.theme;
                }
                usedCounts.set(tpl, (usedCounts.get(tpl) || 0) + 1);
                finalCue = {
                    template: tpl,
                    theme: thm,
                    topBadge: aiItem.topBadge || localCue.topBadge,
                    cardLabel: aiItem.cardLabel || localCue.cardLabel,
                    highlightBadge: aiItem.highlightBadge || localCue.highlightBadge,
                    sceneText: beat.text,
                    videoTitle
                };
            }

            prevTemplate = finalCue.template;
            prevTheme = finalCue.theme;
            return finalCue;
        });
    }

    async function handleGenerateAssets() {
        const btn = document.getElementById('btn-generate-ai-assets');
        if (!btn || btn.disabled) return;

        btn.disabled = true;
        const btnExport = document.getElementById('btn-export-video');
        if (btnExport) btnExport.disabled = true;

        App.mediaEngine.stopPlayback();
        revokeLastExport();

        if (generationAbortController) generationAbortController.abort();
        generationAbortController = new AbortController();
        const signal = generationAbortController.signal;

        const videoTitle = document.getElementById('vs-title')?.value.trim() || 'Mẹo hay cuộc sống';
        const texts = getSceneInputs().map((el) => (el ? el.value.trim() : '') || 'Chia sẻ khoảnh khắc đời sống hằng ngày gần gũi.');
        const voiceName = document.getElementById('vs-voice')?.value || 'Aoede';
        const ttsEngine = document.getElementById('vs-tts-engine')?.value || 'live-3.8';
        const speedRate = parseFloat(document.getElementById('vs-speed')?.value || '1.18') || 1.18;
        const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';
        const visualStyle = document.getElementById('vs-visual-style')?.value || 'motion';
        const scenePacing = document.getElementById('vs-scene-pacing')?.value || 'dynamic';
        const imageSourceMode = document.getElementById('vs-image-source')?.value || 'stock';
        const hasApiKey = Boolean((App.store.getState().apiKey || '').trim());

        const audioCtx = App.mediaEngine.unlockAudioSync();

        try {
            // 1. Expand 5 narration chapters into 10-15 audio-aligned visual beats
            const maxBeatsPerChapter = scenePacing === 'dynamic' ? 3 : 1;
            const chapterBeatTexts = texts.map((t) => splitTextIntoVisualBeats(t, maxBeatsPerChapter));
            const flatBeats = [];
            chapterBeatTexts.forEach((beatList, chapterIdx) => {
                beatList.forEach((beatText, beatInChapter) => {
                    flatBeats.push({
                        beatIdx: flatBeats.length,
                        chapterIdx,
                        beatInChapter,
                        text: beatText
                    });
                });
            });

            updateStudioProgress(
                10,
                hasApiKey
                    ? `Đang thiết kế ${flatBeats.length} phân cảnh không trùng lặp & kết nối giọng AI...`
                    : `Đang chuẩn bị ${flatBeats.length} nhịp chuyển cảnh đa dạng...`
            );

            // Launch 1 single Free Gemini AI Storyboard call in parallel with TTS when API Key is available
            const storyboardPromise = hasApiKey
                ? App.geminiApi.generateMultiBeatStoryboard({
                      title: videoTitle,
                      beatTexts: flatBeats.map((b) => b.text),
                      templates: App.motionGraphics?.VISUAL_TEMPLATES,
                      themes: App.motionGraphics?.THEME_NAMES,
                      signal
                  })
                : Promise.resolve(null);

            const needAnyAiImages = hasApiKey && visualStyle === 'photo' && imageSourceMode !== 'stock';
            const visualPromptsPromise = needAnyAiImages
                ? App.geminiApi.generateRealisticVisualPrompts({
                      title: videoTitle,
                      sceneTexts: texts,
                      signal
                  })
                : Promise.resolve(texts.map((t, idx) => `${videoTitle} ${idx + 1}`));

            const isLiveEngine = ttsEngine === 'live-3.8' || ttsEngine === 'live-3-flash';
            const liveModelId = ttsEngine === 'live-3-flash' ? App.CONFIG.MODELS.LIVE_3_FLASH : App.CONFIG.MODELS.LIVE_38;
            const restTtsModelId = ttsEngine === 'tts-pro' ? App.CONFIG.MODELS.TTS_PRO : App.CONFIG.MODELS.TTS;

            updateStudioProgress(
                22,
                isLiveEngine
                    ? `Đang đọc giọng Gemini Live Free cho ${flatBeats.length} nhịp cảnh...`
                    : `Đang tạo giọng đọc AI cho ${flatBeats.length} nhịp cảnh...`
            );

            let fallbackTtsCount = 0;
            let lastTtsError = '';
            const chapterAudios = new Array(5);
            const chapterHasRealTts = new Array(5).fill(false);

            const uncachedChapters = [];
            for (let i = 0; i < 5; i++) {
                const textVoiceSig = hashString(`${texts[i]}|${voiceName}|${ttsEngine}`);
                const prevMeta = lastChapterAudioMeta[i];
                if (prevMeta && prevMeta.hasRealTts && prevMeta.textVoiceSig === textVoiceSig && cachedChapterAudios[i]) {
                    chapterAudios[i] = cachedChapterAudios[i];
                    chapterHasRealTts[i] = true;
                } else {
                    uncachedChapters.push(i);
                }
            }

            if (isLiveEngine && uncachedChapters.length > 0 && hasApiKey) {
                try {
                    let liveDoneCount = 5 - uncachedChapters.length;
                    const liveRes = await App.geminiApi.fetchBatchLiveTtsPcm({
                        texts,
                        voiceName,
                        model: liveModelId,
                        signal,
                        onSceneDone: () => {
                            liveDoneCount++;
                            const pct = 22 + Math.round((liveDoneCount / 5) * 38);
                            updateStudioProgress(pct, `Đã đọc xong giọng AI phần ${liveDoneCount}/5 (Live API)...`);
                        }
                    });

                    for (let i = 0; i < 5; i++) {
                        if (!chapterHasRealTts[i] && liveRes.buffers[i]) {
                            const decoded = await App.mediaEngine.decodeTtsToAudioBuffer(liveRes.buffers[i], audioCtx, 24000);
                            if (decoded) {
                                chapterAudios[i] = decoded;
                                chapterHasRealTts[i] = true;
                            }
                        }
                    }
                } catch (liveErr) {
                    if (liveErr.name === 'AbortError') throw liveErr;
                    lastTtsError = liveErr.message || 'Live API không phản hồi';
                    console.warn('Live API fallback to REST TTS:', lastTtsError);
                }
            }

            if (!hasApiKey || !isLiveEngine || chapterHasRealTts.some((v) => !v)) {
                await Promise.all(
                    [0, 1, 2, 3, 4].map(async (i) => {
                        if (chapterHasRealTts[i]) return;
                        const sceneText = texts[i];
                        if (hasApiKey) {
                            const ttsRes = await App.geminiApi.fetchSceneTtsPcm({
                                text: sceneText,
                                voiceName,
                                ttsModel: restTtsModelId,
                                signal
                            });
                            if (ttsRes.buffer) {
                                const rateMatch = String(ttsRes.mimeType || '').match(/rate=(\d+)/i);
                                const parsedRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
                                const decoded = await App.mediaEngine.decodeTtsToAudioBuffer(ttsRes.buffer, audioCtx, parsedRate || 24000);
                                if (decoded) {
                                    chapterAudios[i] = decoded;
                                    chapterHasRealTts[i] = true;
                                    return;
                                }
                            }
                            if (ttsRes.errorReason && !lastTtsError) lastTtsError = ttsRes.errorReason;
                        } else {
                            lastTtsError = 'Chưa nhập Gemini API Key';
                        }
                        fallbackTtsCount++;
                        chapterAudios[i] = App.mediaEngine.createSilentBuffer(audioCtx, sceneText);
                    })
                );
            }

            for (let i = 0; i < 5; i++) {
                lastChapterAudioMeta[i] = {
                    textVoiceSig: hashString(`${texts[i]}|${voiceName}|${ttsEngine}`),
                    hasRealTts: chapterHasRealTts[i]
                };
                cachedChapterAudios[i] = chapterAudios[i];
            }

            // 2. Slice each chapter audio right at breath/silence valleys so EVERY beat aligns tightly to voice
            const flatAudioSlices = [];
            for (let c = 0; c < 5; c++) {
                const sliced = App.mediaEngine.splitAudioBufferIntoBeats(chapterAudios[c], chapterBeatTexts[c], audioCtx);
                for (let b = 0; b < chapterBeatTexts[c].length; b++) {
                    flatAudioSlices.push(sliced[b] || App.mediaEngine.createSilentBuffer(audioCtx, chapterBeatTexts[c][b]));
                }
            }

            const [aiStoryboard, visualPrompts] = await Promise.all([storyboardPromise, visualPromptsPromise]);
            const motionCues = buildSyncedCueSequence(flatBeats, aiStoryboard, videoTitle);

            updateStudioProgress(64, `Đang ghép ${flatBeats.length} cảnh chuyển động khớp từng nhịp âm thanh...`);

            let completedCount = 0;
            const builtScenes = new Array(flatBeats.length);
            const usedPhotoIds = new Set();

            await Promise.all(
                flatBeats.map(async (beat, beatIdx) => {
                    const cue = motionCues[beatIdx];
                    let imgObj = null;

                    if (visualStyle === 'photo') {
                        // Use uploaded custom photo ONLY once for its chapter's opening beat (never repeat on every beat!)
                        if (beat.beatInChapter === 0 && customImages[beat.chapterIdx]) {
                            imgObj = customImages[beat.chapterIdx];
                        }

                        const allowAiImage =
                            !imgObj &&
                            needAnyAiImages &&
                            beat.beatInChapter === 0 &&
                            (imageSourceMode === 'ai' || (imageSourceMode === 'hybrid' && (beat.chapterIdx === 0 || beat.chapterIdx === 2)));

                        if (allowAiImage) {
                            const imgRes = await App.geminiApi.fetchSceneImageDataUrl({
                                promptText: visualPrompts[beat.chapterIdx],
                                signal
                            });
                            if (imgRes.dataUrl) {
                                try {
                                    imgObj = await App.mediaEngine.loadImageFromUrl(imgRes.dataUrl);
                                } catch (_) {
                                    imgObj = null;
                                }
                            }
                        }

                        if (!imgObj) {
                            imgObj = await App.mediaEngine.loadRealLifeStockPhoto(beatIdx, videoTitle, beat.text, usedPhotoIds);
                        }
                    }

                    completedCount++;
                    const pct = 64 + Math.round((completedCount / flatBeats.length) * 32);
                    updateStudioProgress(pct, `Đã dựng ${completedCount}/${flatBeats.length} phân cảnh khớp âm thanh...`);

                    const audioBuffer = flatAudioSlices[beatIdx];
                    const effectiveAudioDur = audioBuffer.duration / speedRate;

                    builtScenes[beatIdx] = {
                        text: beat.text,
                        visualPrompt: visualPrompts[beat.chapterIdx],
                        visualStyle,
                        motionCue: cue,
                        imageObj: imgObj,
                        audioBuffer,
                        playbackRate: speedRate,
                        duration: Math.max(0.85, effectiveAudioDur + 0.02),
                        motionType: MOTION_TYPES[beatIdx % MOTION_TYPES.length]
                    };
                })
            );

            App.mediaEngine.setScenes(builtScenes, videoTitle);
            const totalSec = Math.round(App.mediaEngine.getTotalDuration());
            const beatCount = builtScenes.length;

            if (fallbackTtsCount === 5) {
                const detailMsg = !hasApiKey
                    ? 'Trình duyệt này chưa nhập Gemini API Key → mới có nhạc nền, chưa có giọng đọc AI.'
                    : lastTtsError || 'Không nhận được giọng đọc AI (kiểm tra API Key hoặc quota 429).';
                updateStudioProgress(100, `Đã dựng ${beatCount} phân cảnh (${totalSec}s) — ${detailMsg}`, 'done');
                App.toast.show(detailMsg, 'warning', {
                    actionLabel: 'Cài Key',
                    onAction: () => App.modals.openSettingsModal(),
                    duration: 8000
                });
            } else if (fallbackTtsCount > 0) {
                const detailMsg = lastTtsError ? ` (${lastTtsError})` : '';
                updateStudioProgress(100, `Đã dựng ${beatCount} cảnh (${totalSec}s); có ${fallbackTtsCount}/5 đoạn thiếu giọng${detailMsg}.`, 'done');
                App.toast.show(`Đã tạo video ${beatCount} cảnh (${totalSec}s, ${5 - fallbackTtsCount}/5 đoạn có giọng AI)!`, 'warning');
            } else {
                updateStudioProgress(100, `Hoàn tất! Video ${beatCount} cảnh khớp từng nhịp âm thanh (${totalSec}s) đã sẵn sàng.`, 'done');
                App.toast.show(`Đã tạo xong video ${beatCount} phân cảnh (${totalSec}s) khớp giọng đọc!`);
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
        App.mediaEngine.unlockAudioSync();
        const state = App.mediaEngine.getPlaybackState();
        const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';
        if (state.isPlaying) {
            App.mediaEngine.pausePlayback();
        } else {
            App.mediaEngine.startPlayback({ bgmStyle, recordMode: false });
        }
    }

    function prepareDownloadAndShare(blob, mimeType) {
        revokeLastExport();

        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const safeTitle = (document.getElementById('vs-title')?.value.trim() || 'facebook-reels')
            .toLowerCase()
            .replace(/[^a-z0-9\u00C0-\u1EF9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const filename = `${safeTitle || 'facebook-reels'}-reels.${ext}`;
        const url = URL.createObjectURL(blob);
        const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);

        lastExportedFile = { blob, url, filename, ext, mimeType, sizeMB };

        const readyBox = document.getElementById('vs-export-ready-box');
        const infoEl = document.getElementById('vs-export-file-info');
        const manualLink = document.getElementById('btn-manual-download');
        const shareBtn = document.getElementById('btn-share-video');

        if (infoEl) infoEl.textContent = `File .${ext.toUpperCase()} (${sizeMB} MB) sẵn sàng`;
        if (manualLink) {
            manualLink.href = url;
            manualLink.download = filename;
            manualLink.querySelector('span').textContent = `Tải .${ext.toUpperCase()}`;
        }

        if (shareBtn) {
            let canShareFiles = false;
            try {
                const testFile = new File([blob], filename, { type: mimeType });
                canShareFiles = Boolean(navigator.canShare && navigator.canShare({ files: [testFile] }));
            } catch (_) {
                canShareFiles = false;
            }
            shareBtn.classList.toggle('hidden', !canShareFiles);
        }

        readyBox?.classList.remove('hidden');

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        return ext;
    }

    async function handleShareExportedVideo() {
        if (!lastExportedFile) return;
        try {
            const file = new File([lastExportedFile.blob], lastExportedFile.filename, {
                type: lastExportedFile.mimeType
            });
            await navigator.share({
                files: [file],
                title: document.getElementById('vs-title')?.value.trim() || 'Reels Video'
            });
        } catch (err) {
            if (err && err.name !== 'AbortError') {
                App.toast.show('Hãy bấm nút "Tải" bên cạnh để lưu file về máy.', 'info');
            }
        }
    }

    async function handleExportVideo() {
        App.mediaEngine.unlockAudioSync();
        const scenes = App.mediaEngine.getScenes();
        if (scenes.length === 0) return;

        const btnExport = document.getElementById('btn-export-video');
        const btnGen = document.getElementById('btn-generate-ai-assets');
        const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';

        if (btnExport) btnExport.disabled = true;
        if (btnGen) btnGen.disabled = true;

        if (exportAbortController) exportAbortController.abort();
        exportAbortController = new AbortController();

        const restoreButtons = () => {
            if (btnExport) btnExport.disabled = false;
            if (btnGen) btnGen.disabled = false;
            exportAbortController = null;
        };

        try {
            const fastResult = await App.mediaEngine.fastExportVideo({
                bgmStyle,
                signal: exportAbortController.signal,
                onProgress: (pct, msg) => updateStudioProgress(pct, msg, 'loading')
            });

            if (fastResult && fastResult.blob) {
                const ext = prepareDownloadAndShare(fastResult.blob, fastResult.mimeType);
                restoreButtons();
                updateStudioProgress(100, `Hoàn tất! Đã tạo file video .${ext.toUpperCase()} (tải tự động hoặc bấm Tải / Lưu vào Ảnh).`, 'done');
                App.toast.show(`Đã xuất video .${ext.toUpperCase()} thành công!`);
                return;
            }
        } catch (fastErr) {
            if (fastErr.name === 'AbortError') {
                restoreButtons();
                return;
            }
            console.warn('Fast WebCodecs export fallback to MediaRecorder:', fastErr);
        }

        updateStudioProgress(0, 'Đang ghi hình chuẩn trình duyệt (chạy theo thời lượng video)...', 'loading');

        App.mediaEngine.startPlayback({
            startAt: 0,
            bgmStyle,
            recordMode: true,
            onRecordProgress: (pct) => {
                updateStudioProgress(pct, `Đang ghi hình & đồng bộ âm thanh (${pct}%)...`, 'loading');
            },
            onRecordError: (err) => {
                restoreButtons();
                updateStudioProgress(0, err?.message || 'Lỗi khi xuất video.', 'error');
                App.toast.show(err?.message || 'Không thể xuất video trên trình duyệt này.', 'error');
            },
            onRecordComplete: (videoBlob, mimeType) => {
                const ext = prepareDownloadAndShare(videoBlob, mimeType);
                restoreButtons();
                updateStudioProgress(100, `Hoàn tất! Video .${ext.toUpperCase()} đã sẵn sàng tải về máy.`, 'done');
                App.toast.show(`Đã xuất video .${ext.toUpperCase()} thành công!`);
            }
        });
    }

    function init() {
        const canvas = document.getElementById('reels-canvas');
        const timerBadge = document.getElementById('vs-timer-badge');
        const scrubber = document.getElementById('vs-scrubber');
        const unmuteBtn = document.getElementById('btn-unmute-mobile-audio');

        let lastScrubberUpdate = 0;
        App.mediaEngine.bindCanvasElements(canvas, timerBadge, {
            onStateChange: syncPlaybackUI,
            onAudioBlocked: (blocked) => {
                unmuteBtn?.classList.toggle('hidden', !blocked);
            },
            onProgressUpdate: (elapsed, total) => {
                const now = performance.now();
                if (scrubber && !isSeeking && total > 0 && now - lastScrubberUpdate >= 100) {
                    lastScrubberUpdate = now;
                    scrubber.max = String(total);
                    scrubber.value = String(elapsed);
                }
            }
        });

        // Global one-time gesture unlock for mobile browsers (iOS Safari & Android Chrome)
        const unlockOnce = () => {
            App.mediaEngine.unlockAudioSync();
            document.removeEventListener('touchstart', unlockOnce);
            document.removeEventListener('pointerdown', unlockOnce);
        };
        document.addEventListener('touchstart', unlockOnce, { passive: true, once: true });
        document.addEventListener('pointerdown', unlockOnce, { passive: true, once: true });

        unmuteBtn?.addEventListener('click', () => {
            App.mediaEngine.unlockAudioSync();
            unmuteBtn.classList.add('hidden');
            const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';
            const state = App.mediaEngine.getPlaybackState();
            App.mediaEngine.startPlayback({
                startAt: state.currentTime || 0,
                bgmStyle,
                recordMode: false
            });
        });

        canvas?.addEventListener('click', () => {
            if (App.mediaEngine.getScenes().length === 0) return;
            if (unmuteBtn && !unmuteBtn.classList.contains('hidden')) {
                unmuteBtn.click();
                return;
            }
            handleTogglePlayPause();
        });

        document.getElementById('btn-open-studio-scratch')?.addEventListener('click', openFromScratch);
        document.getElementById('btn-rewrite-story')?.addEventListener('click', handleEnhanceStorytelling);
        document.getElementById('btn-generate-ai-assets')?.addEventListener('click', handleGenerateAssets);
        document.getElementById('btn-export-video')?.addEventListener('click', handleExportVideo);
        document.getElementById('btn-share-video')?.addEventListener('click', handleShareExportedVideo);
        document.getElementById('btn-preview-bgm')?.addEventListener('click', () => {
            App.mediaEngine.unlockAudioSync();
            const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';
            if (bgmStyle === 'none') {
                App.toast.show('Bạn đang chọn "Chỉ Giọng Đọc" (không có nhạc nền).', 'info');
                return;
            }
            App.mediaEngine.previewBgmSample(bgmStyle, 4.0);
        });
        document.getElementById('btn-preview-play')?.addEventListener('click', handleTogglePlayPause);
        document.getElementById('btn-preview-replay')?.addEventListener('click', () => {
            App.mediaEngine.unlockAudioSync();
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

        const visualStyleEl = document.getElementById('vs-visual-style');
        const photoRowEl = document.getElementById('vs-photo-options-row');
        const syncStyleControls = () => {
            if (!visualStyleEl || !photoRowEl) return;
            const isPhoto = visualStyleEl.value === 'photo';
            photoRowEl.classList.toggle('hidden', !isPhoto);
        };
        visualStyleEl?.addEventListener('change', syncStyleControls);
        syncStyleControls();
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
