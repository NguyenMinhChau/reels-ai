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
    const { splitScriptIntoScenes, splitTextIntoVisualBeats, hashString, escapeHtml, copyToClipboard } = App.utils;

    const MAX_DIALOGUE_SCENES = 14;
    let customImages = [];
    let currentTopicHashtags = '';
    let lastChapterAudioMeta = [];
    let cachedChapterAudios = [];
    const beatAudioCache = new Map();
    let lastVoiceSessionKey = '';
    let generationAbortController = null;
    let rewriteAbortController = null;
    let exportAbortController = null;
    let socialAbortController = null;
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
        const wavBtn = document.getElementById('btn-download-wav');
        if (wavBtn) {
            wavBtn.classList.add('hidden');
            wavBtn.href = '#';
        }
    }

    function getSceneInputs() {
        const container = document.getElementById('vs-scenes-container');
        if (!container) return [];
        return Array.from(container.querySelectorAll('input[data-scene-input]'));
    }

    function updateSceneCountUI() {
        const inputs = getSceneInputs();
        const count = inputs.length;
        const label = document.getElementById('vs-scenes-count-label');
        if (label) {
            label.innerHTML = `<i class="fa-solid fa-microphone-lines text-indigo-600 dark:text-indigo-400 mr-1"></i> Lời thoại (${count} cảnh)`;
        }
        const addBtn = document.getElementById('btn-add-scene');
        if (addBtn) {
            addBtn.disabled = count >= MAX_DIALOGUE_SCENES;
        }
    }

    function renderSceneInputs(scenesArray) {
        const container = document.getElementById('vs-scenes-container');
        if (!container) return;
        const list = Array.isArray(scenesArray) && scenesArray.length >= 2 ? scenesArray.slice(0, MAX_DIALOGUE_SCENES) : ['', '', '', '', ''];
        const canDelete = list.length > 2;

        container.innerHTML = '';
        list.forEach((sceneVal, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === list.length - 1;
            const badgeText = isFirst ? '1. Hook' : isLast ? `${idx + 1}. Kết/CTA` : `${idx + 1}. Cảnh ${idx + 1}`;
            const badgeCls = isFirst
                ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-500/20'
                : isLast
                    ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-500/20'
                    : 'text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-500/20';

            const row = document.createElement('div');
            row.className = 'flex items-center gap-1.5 min-w-0';
            row.innerHTML = `
                <span class="w-16 shrink-0 text-[10px] font-extrabold ${badgeCls} px-1.5 py-1 rounded-lg text-center truncate">${badgeText}</span>
                <input type="text" data-scene-input="${idx}" value="${escapeHtml(sceneVal || '')}" placeholder="Nhập lời thoại cảnh ${idx + 1}..." class="w-full min-w-0 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-900 focus:outline-none focus:border-indigo-500" />
                <button type="button" data-remove-scene="${idx}" ${canDelete ? '' : 'disabled'} class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/15 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 flex items-center justify-center transition cursor-pointer" title="Xóa cảnh này">
                    <i class="fa-solid fa-xmark text-xs"></i>
                </button>
            `;
            container.appendChild(row);
        });
        updateSceneCountUI();
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
        label.textContent = count > 0 ? `Đã chọn ${count} ảnh thật` : 'Chế độ ảnh thật tự nhiên';
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

    function setSocialCaptionPreview(captionRes) {
        const area = document.getElementById('vs-social-caption');
        if (area && captionRes?.fullPost) {
            area.value = captionRes.fullPost;
        }
    }

    function open({ title, scenes, hashtags = '' }) {
        App.mediaEngine.stopPlayback();
        cancelOngoingRequests();
        revokeLastExport();

        const initialScenes = Array.isArray(scenes) && scenes.length >= 2 ? scenes.slice(0, MAX_DIALOGUE_SCENES) : ['', '', '', '', ''];
        customImages = [];
        currentTopicHashtags = String(hashtags || '').trim();
        lastChapterAudioMeta = [];
        cachedChapterAudios = [];
        isSeeking = false;
        updateImageStatusLabel();

        const titleInput = document.getElementById('vs-title');
        if (titleInput) titleInput.value = title || '';

        const bgmSelect = document.getElementById('vs-bgm');
        if (bgmSelect) bgmSelect.value = pickDefaultBgmForTitle(title);

        const targetSel = document.getElementById('vs-target-scenes');
        if (targetSel) {
            if (initialScenes.length >= 11) targetSel.value = '12';
            else if (initialScenes.length >= 9) targetSel.value = '10';
            else if (initialScenes.length >= 7) targetSel.value = '8';
            else targetSel.value = '5';
        }

        renderSceneInputs(initialScenes);
        setSocialCaptionPreview(
            App.geminiApi?.buildLocalSocialCaption?.({
                title,
                scenes: initialScenes,
                existingHashtags: currentTopicHashtags
            })
        );

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
                'Bạn có biết chỉ một thay đổi nhỏ mỗi sáng có thể giúp cả ngày hiệu quả gấp đôi?',
                'Nhiều người vội vàng lướt điện thoại ngay khi mở mắt khiến não quá tải từ sáng sớm.',
                'Hậu quả là cả ngày làm việc uể oải, dễ cáu gắt và mất tập trung liên tục.',
                'Thay vào đó, hãy uống một cốc nước ấm để đánh thức cơ thể trong 2 phút.',
                'Tiếp theo, mở rèm đón ánh nắng tự nhiên giúp đồng hồ sinh học tỉnh táo hẳn lên.',
                'Sau đó viết ra giấy đúng 3 việc quan trọng nhất cần xong trong hôm nay.',
                'Làm đều đặn 7 ngày bạn sẽ thấy tinh thần nhẹ nhàng và dư thời gian rõ rệt.',
                'Thử áp dụng ngay sáng mai nhé, bạn thường làm gì đầu tiên khi thức dậy?'
            ],
            hashtags: '#thoiquensang #nangsuat #meohaydoisong #phattrienbanthan #reelsvn #xuhuong'
        });
    }

    function openFromTemplate(templateId) {
        const tpl = App.store.getState().templates.find((t) => t.id === templateId);
        if (!tpl) return;
        open({
            title: tpl.title,
            scenes: splitScriptIntoScenes(tpl.hook, tpl.body, tpl.cta),
            hashtags: tpl.hashtags || ''
        });
    }

    function openFromUserScript(userScriptId) {
        const item = App.store.getState().userScripts.find((s) => s.id === userScriptId);
        if (!item) return;
        const scenes =
            Array.isArray(item.scenes) && item.scenes.length >= 2
                ? item.scenes
                : splitScriptIntoScenes(item.hook, item.body, item.cta);
        open({
            title: item.title,
            scenes,
            hashtags: item.hashtags || ''
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
        if (socialAbortController) {
            socialAbortController.abort();
            socialAbortController = null;
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
        const files = Array.from(e.target.files || []).slice(0, 12);
        if (files.length === 0) return;

        customImages = [];
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
        const targetCount = parseInt(document.getElementById('vs-target-scenes')?.value || '8', 10) || 8;
        const draftLines = getSceneInputs().map((el) => (el ? el.value.trim() : '')).filter(Boolean);

        btn.disabled = true;
        const prevHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang viết ${targetCount} cảnh...</span>`;

        if (rewriteAbortController) rewriteAbortController.abort();
        rewriteAbortController = new AbortController();

        try {
            const rewritten = await App.geminiApi.enhanceStorytelling({
                title,
                draftLines,
                tone,
                targetCount,
                signal: rewriteAbortController.signal
            });

            renderSceneInputs(rewritten);
            App.toast.show(`Đã nâng cấp thành ${rewritten.length} cảnh lời thoại kể chuyện cực cuốn!`);
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
        const layouts = App.motionGraphics?.LAYOUT_NAMES || [];
        const backdrops = App.motionGraphics?.BACKDROP_NAMES || [];
        const propNames = App.motionGraphics?.PROP_NAMES || [];
        let prevLayout = '';
        let prevBackdrop = '';
        let prevProp = '';

        return flatBeats.map((beat, idx) => {
            const localCue = App.motionGraphics
                ? App.motionGraphics.analyzeSceneVisualCue(beat.text, idx, videoTitle, {
                      prevLayout,
                      prevBackdrop,
                      prevProp
                  })
                : {
                      layout: 'character-action',
                      backdrop: 'cream-room',
                      action: 'pointing',
                      effect: 'sparkles',
                      props: ['lightbulb'],
                      characterMood: 'happy',
                      crossOut: false,
                      sceneText: beat.text,
                      videoTitle
                  };

            const aiItem = Array.isArray(aiStoryboard) ? aiStoryboard[idx] : null;
            let finalCue = localCue;

            if (aiItem && layouts.includes(aiItem.layout)) {
                let lay = aiItem.layout;
                if (lay === prevLayout) lay = localCue.layout;

                let bd = backdrops.includes(aiItem.backdrop) ? aiItem.backdrop : localCue.backdrop;
                if (bd === prevBackdrop) bd = localCue.backdrop;

                let chosenProps = Array.isArray(aiItem.props) && aiItem.props.length > 0 ? aiItem.props : localCue.props;
                if (chosenProps[0] === prevProp) {
                    if (chosenProps.length > 1) {
                        chosenProps = [...chosenProps.slice(1), chosenProps[0]];
                    } else if (propNames.length > 0) {
                        chosenProps = [localCue.props[0]];
                    }
                }

                finalCue = {
                    layout: lay,
                    backdrop: bd,
                    action: aiItem.action || localCue.action,
                    effect: aiItem.effect || localCue.effect,
                    props: chosenProps,
                    characterMood: aiItem.characterMood || localCue.characterMood,
                    crossOut: Boolean(aiItem.crossOut),
                    sceneText: beat.text,
                    videoTitle
                };
            }

            prevLayout = finalCue.layout;
            prevBackdrop = finalCue.backdrop;
            prevProp = (finalCue.props && finalCue.props[0]) || '';
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
        const texts = getSceneInputs()
            .map((el) => (el ? el.value.trim() : ''))
            .filter(Boolean);
        if (texts.length === 0) texts.push('Chia sẻ khoảnh khắc đời sống hằng ngày gần gũi.');

        const chapterCount = texts.length;
        const voiceName = document.getElementById('vs-voice')?.value || 'Aoede';
        const ttsEngine = document.getElementById('vs-tts-engine')?.value || 'live-3.8';
        const speedRate = parseFloat(document.getElementById('vs-speed')?.value || '1.0') || 1.0;
        const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';
        const visualStyle = document.getElementById('vs-visual-style')?.value || 'motion';
        const showSubtitles = document.getElementById('vs-subtitles')?.value === 'on';
        const scenePacing = document.getElementById('vs-scene-pacing')?.value || 'balanced';
        const imageSourceMode = document.getElementById('vs-image-source')?.value || 'stock';
        const hasApiKey = Boolean((App.store.getState().apiKey || '').trim());

        const audioCtx = App.mediaEngine.unlockAudioSync();
        isSeeking = false;

        try {
            // 1. Expand narration chapters into balanced audio-locked scenes
            // If user already wrote >= 7 scenes, keep 1 scene/line in 'balanced' mode for crisp pacing!
            const maxBeatsPerChapter =
                scenePacing === 'standard'
                    ? 1
                    : scenePacing === 'dynamic'
                        ? (chapterCount >= 8 ? 2 : 3)
                        : chapterCount >= 7
                            ? 1
                            : 2;
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

            // Launch 1 Free Gemini AI Storyboard call in parallel with TTS for motion/photo/offline-fallback metadata
            const storyboardPromise =
                hasApiKey && (visualStyle === 'motion' || visualStyle === 'photo')
                    ? App.geminiApi.generateMultiBeatStoryboard({
                          title: videoTitle,
                          beatTexts: flatBeats.map((b) => b.text),
                          layouts: App.motionGraphics?.LAYOUT_NAMES,
                          backdrops: App.motionGraphics?.BACKDROP_NAMES,
                          props: App.motionGraphics?.PROP_NAMES,
                          actions: App.motionGraphics?.ACTION_NAMES,
                          effects: App.motionGraphics?.EFFECT_NAMES,
                          signal
                      })
                    : Promise.resolve(null);

            const needAiImagePrompts =
                hasApiKey && (visualStyle === 'ai-image' || (visualStyle === 'photo' && imageSourceMode !== 'stock'));
            const visualPromptsPromise = needAiImagePrompts
                ? App.geminiApi.generateRealisticVisualPrompts({
                      title: videoTitle,
                      sceneTexts: visualStyle === 'ai-image' ? flatBeats.map((b) => b.text) : texts,
                      signal
                  })
                : Promise.resolve(
                      (visualStyle === 'ai-image' ? flatBeats.map((b) => b.text) : texts).map(
                          (t, idx) => `${videoTitle} - ${idx + 1}: ${t}`
                      )
                  );

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
            const totalBeats = flatBeats.length;
            const flatAudioSlices = new Array(totalBeats).fill(null);
            const beatHasRealTts = new Array(totalBeats).fill(false);

            // Reset per-beat audio cache whenever voice/engine changes so two different sessions' voices never mix
            const currentVoiceSessionKey = `${ttsEngine}|${voiceName}|${hashString(videoTitle)}`;
            if (lastVoiceSessionKey && lastVoiceSessionKey !== currentVoiceSessionKey) {
                beatAudioCache.clear();
            }
            lastVoiceSessionKey = currentVoiceSessionKey;

            // Check per-beat cache first (1-to-1 voice-to-scene lock when using Live API)
            const uncachedBeatIndices = [];
            for (let b = 0; b < totalBeats; b++) {
                const beatSig = hashString(`${flatBeats[b].text}|${voiceName}|${ttsEngine}|${currentVoiceSessionKey}`);
                if (beatAudioCache.has(beatSig)) {
                    flatAudioSlices[b] = beatAudioCache.get(beatSig);
                    beatHasRealTts[b] = true;
                } else {
                    uncachedBeatIndices.push(b);
                }
            }

            // Generate 1 dedicated Live API TTS clip PER scene/beat over a single WebSocket so scene switches
            // wait strictly until that scene's exact phrase finishes speaking! (With 1 automatic mobile retry for any dropped scenes)
            if (isLiveEngine && uncachedBeatIndices.length > 0 && hasApiKey) {
                for (let liveAttempt = 0; liveAttempt < 2; liveAttempt++) {
                    const pendingIndices = uncachedBeatIndices.filter((idx) => !beatHasRealTts[idx]);
                    if (pendingIndices.length === 0) break;
                    try {
                        let liveDoneCount = totalBeats - pendingIndices.length;
                        const missingBeatTexts = pendingIndices.map((idx) => flatBeats[idx].text);
                        const liveRes = await App.geminiApi.fetchBatchLiveTtsPcm({
                            texts: missingBeatTexts,
                            voiceName,
                            model: liveModelId,
                            signal,
                            onSceneDone: () => {
                                liveDoneCount++;
                                const pct = 22 + Math.round((liveDoneCount / totalBeats) * 38);
                                updateStudioProgress(pct, `Đang thu giọng từng cảnh ${liveDoneCount}/${totalBeats} (khớp 100% khung hình)...`);
                            }
                        });

                        for (let m = 0; m < pendingIndices.length; m++) {
                            const targetIdx = pendingIndices[m];
                            if (liveRes.buffers[m]) {
                                const decoded = await App.mediaEngine.decodeTtsToAudioBuffer(liveRes.buffers[m], audioCtx, 24000);
                                if (decoded && decoded.duration >= 0.25) {
                                    flatAudioSlices[targetIdx] = decoded;
                                    beatHasRealTts[targetIdx] = true;
                                    const beatSig = hashString(`${flatBeats[targetIdx].text}|${voiceName}|${ttsEngine}|${currentVoiceSessionKey}`);
                                    beatAudioCache.set(beatSig, decoded);
                                }
                            }
                        }
                        if (liveRes.errorReason) lastTtsError = liveRes.errorReason;
                    } catch (liveErr) {
                        if (liveErr.name === 'AbortError') throw liveErr;
                        lastTtsError = liveErr.message || 'Live API không phản hồi';
                        console.warn(`Live API attempt ${liveAttempt + 1} warning:`, lastTtsError);
                    }
                }
            }

            // Fallback to REST chapter TTS (or offline silence when no key) ONLY for chapters missing real beat audio
            const missingChapters = new Set();
            flatBeats.forEach((beat, bIdx) => {
                if (!beatHasRealTts[bIdx]) missingChapters.add(beat.chapterIdx);
            });

            if (missingChapters.size > 0) {
                const chapterAudios = new Array(chapterCount);
                const chapterHasRealTts = new Array(chapterCount).fill(false);

                await Promise.all(
                    Array.from(missingChapters).map(async (cIdx) => {
                        const chapterText = texts[cIdx];
                        const textVoiceSig = hashString(`${chapterText}|${voiceName}|${ttsEngine}`);
                        const prevMeta = lastChapterAudioMeta[cIdx];
                        if (prevMeta && prevMeta.hasRealTts && prevMeta.textVoiceSig === textVoiceSig && cachedChapterAudios[cIdx]) {
                            chapterAudios[cIdx] = cachedChapterAudios[cIdx];
                            chapterHasRealTts[cIdx] = true;
                            return;
                        }
                        if (hasApiKey) {
                            const ttsRes = await App.geminiApi.fetchSceneTtsPcm({
                                text: chapterText,
                                voiceName,
                                ttsModel: restTtsModelId,
                                signal
                            });
                            if (ttsRes.buffer) {
                                const rateMatch = String(ttsRes.mimeType || '').match(/rate=(\d+)/i);
                                const parsedRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
                                const decoded = await App.mediaEngine.decodeTtsToAudioBuffer(ttsRes.buffer, audioCtx, parsedRate || 24000);
                                if (decoded) {
                                    chapterAudios[cIdx] = decoded;
                                    chapterHasRealTts[cIdx] = true;
                                    lastChapterAudioMeta[cIdx] = { textVoiceSig, hasRealTts: true };
                                    cachedChapterAudios[cIdx] = decoded;
                                    return;
                                }
                            }
                            if (ttsRes.errorReason && !lastTtsError) lastTtsError = ttsRes.errorReason;
                        } else {
                            lastTtsError = 'Chưa nhập Gemini API Key';
                        }
                        fallbackTtsCount++;
                        chapterAudios[cIdx] = App.mediaEngine.createSilentBuffer(audioCtx, chapterText);
                    })
                );

                // Assign sliced buffers for missing chapters
                const chapterOffsets = {};
                let cursor = 0;
                for (let c = 0; c < chapterCount; c++) {
                    chapterOffsets[c] = cursor;
                    cursor += chapterBeatTexts[c].length;
                }
                for (const cIdx of missingChapters) {
                    const sliced = App.mediaEngine.splitAudioBufferIntoBeats(chapterAudios[cIdx], chapterBeatTexts[cIdx], audioCtx);
                    const startBeat = chapterOffsets[cIdx];
                    for (let b = 0; b < chapterBeatTexts[cIdx].length; b++) {
                        const targetIdx = startBeat + b;
                        if (!beatHasRealTts[targetIdx]) {
                            flatAudioSlices[targetIdx] = sliced[b] || App.mediaEngine.createSilentBuffer(audioCtx, flatBeats[targetIdx].text);
                            beatHasRealTts[targetIdx] = chapterHasRealTts[cIdx];
                        }
                    }
                }
            }

            const storyTone = document.getElementById('vs-tone')?.value || 'viral';
            const socialCaptionPromise = hasApiKey
                ? App.geminiApi
                      .generateSocialCaption({
                          title: videoTitle,
                          scenes: texts,
                          tone: storyTone,
                          existingHashtags: currentTopicHashtags,
                          signal
                      })
                      .catch(() =>
                          App.geminiApi.buildLocalSocialCaption({
                              title: videoTitle,
                              scenes: texts,
                              existingHashtags: currentTopicHashtags
                          })
                      )
                : Promise.resolve(
                      App.geminiApi.buildLocalSocialCaption({
                          title: videoTitle,
                          scenes: texts,
                          existingHashtags: currentTopicHashtags
                      })
                  );

            const [aiStoryboard, visualPrompts] = await Promise.all([storyboardPromise, visualPromptsPromise]);
            const motionCues = buildSyncedCueSequence(flatBeats, aiStoryboard, videoTitle);

            const sceneImageObjs = new Array(flatBeats.length).fill(null);
            const sceneStyleOverrides = new Array(flatBeats.length).fill(visualStyle);
            const loadSvgBatchIntoIndices = async (targetIndices, svgUrls) => {
                await Promise.all(
                    targetIndices.map(async (targetIdx, pos) => {
                        const url = svgUrls[pos];
                        if (!url) return;
                        try {
                            sceneImageObjs[targetIdx] = await App.mediaEngine.loadImageFromUrl(url);
                            sceneStyleOverrides[targetIdx] = 'ai-svg';
                        } catch (_) {
                            sceneImageObjs[targetIdx] = null;
                        }
                    })
                );
            };

            if (visualStyle === 'ai-svg') {
                if (hasApiKey) {
                    updateStudioProgress(62, `AI đang vẽ ${flatBeats.length} tranh minh họa độc bản khớp từng câu nói...`);
                    const svgUrls = await App.geminiApi.generateCustomSceneSvgs({
                        title: videoTitle,
                        scenes: flatBeats.map((b) => b.text),
                        tone: storyTone,
                        signal,
                        onProgress: (done, total) => {
                            const pct = 62 + Math.round((done / Math.max(1, total)) * 30);
                            updateStudioProgress(pct, `AI đang vẽ minh họa độc bản cảnh ${done}/${total}...`);
                        }
                    });
                    await loadSvgBatchIntoIndices(
                        flatBeats.map((_, idx) => idx),
                        svgUrls
                    );
                    if (sceneImageObjs.every((img) => !img)) {
                        App.toast.show('AI SVG tạm quá tải → tự động dựng hoạt hình 2D khớp lời thoại.', 'warning');
                    }
                } else {
                    updateStudioProgress(72, `Chưa có API Key → dùng Hoạt hình 2D Offline cho ${flatBeats.length} cảnh...`);
                }
            } else if (visualStyle === 'ai-image') {
                if (hasApiKey) {
                    let hitRateLimit = false;
                    for (let b = 0; b < flatBeats.length; b++) {
                        if (b > 0) await App.utils.sleep(800, signal);
                        const pct = 62 + Math.round((b / Math.max(1, flatBeats.length)) * 22);
                        updateStudioProgress(pct, `Đang tạo ảnh AI cảnh ${b + 1}/${flatBeats.length} khớp lời thoại...`);
                        const promptText =
                            visualPrompts[b] || visualPrompts[flatBeats[b].chapterIdx] || `${videoTitle}: ${flatBeats[b].text}`;
                        const imgRes = await App.geminiApi.fetchSceneImageDataUrl({ promptText, signal });
                        if (imgRes.dataUrl) {
                            try {
                                sceneImageObjs[b] = await App.mediaEngine.loadImageFromUrl(imgRes.dataUrl);
                            } catch (_) {
                                sceneImageObjs[b] = null;
                            }
                        }
                        if (imgRes.rateLimited) {
                            hitRateLimit = true;
                            break;
                        }
                    }

                    const missingIndices = [];
                    for (let b = 0; b < flatBeats.length; b++) {
                        if (!sceneImageObjs[b]) missingIndices.push(b);
                    }
                    if (missingIndices.length > 0) {
                        if (hitRateLimit && missingIndices.length === flatBeats.length) {
                            App.toast.show(
                                'Model ảnh AI Nano Banana đang giới hạn Free → tự động chuyển sang AI Vẽ Minh Họa Độc Bản khớp ngữ cảnh!',
                                'warning',
                                { duration: 6000 }
                            );
                        } else if (hitRateLimit) {
                            App.toast.show(
                                `Có ${missingIndices.length} cảnh ảnh AI chạm hạn mức → AI tự vẽ minh họa độc bản bù đúng ngữ cảnh.`,
                                'info'
                            );
                        }
                        const fallbackSvgs = await App.geminiApi.generateCustomSceneSvgs({
                            title: videoTitle,
                            scenes: missingIndices.map((idx) => flatBeats[idx].text),
                            tone: bgmStyle,
                            signal,
                            onProgress: (done, total) => {
                                const pct = 84 + Math.round((done / Math.max(1, total)) * 11);
                                updateStudioProgress(pct, `Đang vẽ minh họa bù ${done}/${total} cảnh khớp lời thoại...`);
                            }
                        });
                        await loadSvgBatchIntoIndices(missingIndices, fallbackSvgs);
                    }
                } else {
                    updateStudioProgress(72, `Chưa có API Key → dùng Hoạt hình 2D Offline cho ${flatBeats.length} cảnh...`);
                }
            } else if (visualStyle === 'photo') {
                updateStudioProgress(64, `Đang ghép ${flatBeats.length} ảnh nền khớp từng nhịp âm thanh...`);
                let completedCount = 0;
                const usedPhotoIds = new Set();
                await Promise.all(
                    flatBeats.map(async (beat, beatIdx) => {
                        let imgObj = null;
                        // Use uploaded custom photo ONLY once for its chapter's opening beat (never repeat on every beat!)
                        if (beat.beatInChapter === 0 && customImages[beat.chapterIdx]) {
                            imgObj = customImages[beat.chapterIdx];
                        }

                        const allowAiImage =
                            !imgObj &&
                            needAiImagePrompts &&
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

                        sceneImageObjs[beatIdx] = imgObj;
                        completedCount++;
                        const pct = 64 + Math.round((completedCount / flatBeats.length) * 32);
                        updateStudioProgress(pct, `Đã dựng ${completedCount}/${flatBeats.length} phân cảnh khớp âm thanh...`);
                    })
                );
            } else {
                updateStudioProgress(80, `Đang dựng ${flatBeats.length} cảnh hoạt hình 2D khớp từng nhịp âm thanh...`);
            }

            const builtScenes = flatBeats.map((beat, beatIdx) => {
                const audioBuffer = flatAudioSlices[beatIdx];
                const rawAudioDur = audioBuffer && Number.isFinite(audioBuffer.duration) ? audioBuffer.duration : 2.5;
                const effectiveAudioDur = rawAudioDur / speedRate;

                return {
                    text: beat.text,
                    visualPrompt:
                        visualStyle === 'ai-image'
                            ? visualPrompts[beatIdx] || beat.text
                            : visualPrompts[beat.chapterIdx] || beat.text,
                    visualStyle: sceneStyleOverrides[beatIdx],
                    showSubtitles,
                    motionCue: motionCues[beatIdx],
                    imageObj: sceneImageObjs[beatIdx],
                    audioBuffer,
                    playbackRate: speedRate,
                    duration: Math.max(1.2, effectiveAudioDur + 0.18),
                    motionType: MOTION_TYPES[beatIdx % MOTION_TYPES.length]
                };
            });

            App.mediaEngine.setScenes(builtScenes, videoTitle);
            const socialRes = await socialCaptionPromise;
            setSocialCaptionPreview(socialRes);
            const totalSec = Math.round(App.mediaEngine.getTotalDuration());
            const beatCount = builtScenes.length;
            const missingBeatCount = beatHasRealTts.filter((v) => !v).length;

            if (missingBeatCount === beatCount) {
                const detailMsg = !hasApiKey
                    ? 'Trình duyệt này chưa nhập Gemini API Key → mới có nhạc nền, chưa có giọng đọc AI.'
                    : lastTtsError || 'Không nhận được giọng đọc AI (kiểm tra API Key hoặc quota 429).';
                updateStudioProgress(100, `Đã dựng ${beatCount} phân cảnh (${totalSec}s) — ${detailMsg}`, 'done');
                App.toast.show(detailMsg, 'warning', {
                    actionLabel: 'Cài Key',
                    onAction: () => App.modals.openSettingsModal(),
                    duration: 8000
                });
            } else if (missingBeatCount > 0) {
                const detailMsg = lastTtsError ? ` (${lastTtsError})` : '';
                updateStudioProgress(100, `Đã dựng ${beatCount} cảnh (${totalSec}s); có ${missingBeatCount}/${beatCount} cảnh thiếu giọng${detailMsg}.`, 'done');
                App.toast.show(`Đã tạo video ${beatCount} cảnh (${totalSec}s, ${beatCount - missingBeatCount}/${beatCount} cảnh có giọng AI)!`, 'warning');
            } else {
                updateStudioProgress(100, `Hoàn tất! Video ${beatCount} cảnh khớp từng nhịp âm thanh (${totalSec}s) đã sẵn sàng.`, 'done');
                App.toast.show(`Đã tạo xong video ${beatCount} phân cảnh (${totalSec}s) khớp 100% âm thanh!`);
            }

            if (btnExport) btnExport.disabled = false;
            document.getElementById('vs-playback-controls')?.classList.remove('hidden');
            document.getElementById('vs-timer-badge')?.classList.remove('hidden');

            await App.mediaEngine.prepareMixedPreviewWavUrl?.(bgmStyle);
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

    async function handleRegenSocialCaption() {
        const btn = document.getElementById('btn-regen-social');
        if (!btn || btn.disabled) return;
        const title = document.getElementById('vs-title')?.value.trim() || 'Chia sẻ hay mỗi ngày';
        const scenes = getSceneInputs().map((el) => el.value.trim()).filter(Boolean);
        const tone = document.getElementById('vs-tone')?.value || 'viral';

        btn.disabled = true;
        const prevHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang viết...</span>';
        if (socialAbortController) socialAbortController.abort();
        socialAbortController = new AbortController();

        try {
            const res = await App.geminiApi.generateSocialCaption({
                title,
                scenes,
                tone,
                existingHashtags: currentTopicHashtags,
                forceRefresh: true,
                signal: socialAbortController.signal
            });
            setSocialCaptionPreview(res);
            App.toast.show('Đã tạo Caption + Hashtag mới sẵn sàng đăng!');
        } catch (err) {
            if (err.name !== 'AbortError') {
                App.toast.show(err.message || 'Không tạo được Caption AI lúc này.', 'warning');
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = prevHtml;
            socialAbortController = null;
        }
    }

    async function handleCopySocialCaption() {
        const area = document.getElementById('vs-social-caption');
        const text = area ? area.value.trim() : '';
        if (!text) {
            App.toast.show('Chưa có nội dung để copy.', 'warning');
            return;
        }
        const ok = await copyToClipboard(text);
        if (ok) {
            App.toast.show('Đã copy Nội dung + Hashtag! Dán ngay khi đăng Reels nhé.');
        } else {
            area.focus();
            area.select();
            App.toast.show('Hãy bấm Giữ -> Chọn Sao chép trong khung nội dung.', 'info');
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

    async function prepareDownloadAndShare(blob, mimeType, bgmStyle = 'upbeat', hasAudio = true) {
        revokeLastExport();

        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const safeTitle = (document.getElementById('vs-title')?.value.trim() || 'facebook-reels')
            .toLowerCase()
            .replace(/[^a-z0-9\u00C0-\u1EF9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const baseName = safeTitle || 'facebook-reels';
        const filename = `${baseName}-reels.${ext}`;
        const url = URL.createObjectURL(blob);
        const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);

        lastExportedFile = { blob, url, filename, ext, mimeType, sizeMB };

        const readyBox = document.getElementById('vs-export-ready-box');
        const infoEl = document.getElementById('vs-export-file-info');
        const manualLink = document.getElementById('btn-manual-download');
        const wavBtn = document.getElementById('btn-download-wav');
        const shareBtn = document.getElementById('btn-share-video');

        if (infoEl) {
            infoEl.textContent = hasAudio
                ? `File .${ext.toUpperCase()} (${sizeMB} MB • Có âm thanh) sẵn sàng`
                : `File .${ext.toUpperCase()} (${sizeMB} MB — nếu máy mất tiếng hãy tải thêm .WAV bên cạnh)`;
        }
        if (manualLink) {
            manualLink.href = url;
            manualLink.download = filename;
            manualLink.querySelector('span').textContent = `Tải .${ext.toUpperCase()}`;
        }

        if (wavBtn && App.mediaEngine.prepareMixedPreviewWavUrl) {
            try {
                const wavUrl = await App.mediaEngine.prepareMixedPreviewWavUrl(bgmStyle);
                if (wavUrl) {
                    wavBtn.href = wavUrl;
                    wavBtn.download = `${baseName}-audio.wav`;
                    wavBtn.classList.remove('hidden');
                }
            } catch (_) {}
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
        // Synchronously hold AudioContext unlock BEFORE any async encoder probes so iOS/Android MediaRecorder keeps sound
        const exportGuard = App.mediaEngine.prepareForExportSync
            ? App.mediaEngine.prepareForExportSync()
            : { release: () => {} };
        const scenes = App.mediaEngine.getScenes();
        if (scenes.length === 0) {
            exportGuard.release();
            return;
        }

        const btnExport = document.getElementById('btn-export-video');
        const btnGen = document.getElementById('btn-generate-ai-assets');
        const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';

        if (btnExport) btnExport.disabled = true;
        if (btnGen) btnGen.disabled = true;

        if (exportAbortController) exportAbortController.abort();
        exportAbortController = new AbortController();

        const restoreButtons = () => {
            exportGuard.release();
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
                const ext = await prepareDownloadAndShare(fastResult.blob, fastResult.mimeType, bgmStyle, fastResult.hasAudio !== false);
                restoreButtons();
                updateStudioProgress(100, `Hoàn tất! Đã tạo file video .${ext.toUpperCase()} có âm thanh (bấm Tải hoặc Lưu vào Ảnh).`, 'done');
                App.toast.show(`Đã xuất video .${ext.toUpperCase()} có âm thanh thành công!`);
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
            onRecordComplete: async (videoBlob, mimeType, hasAudioTrack = true) => {
                const ext = await prepareDownloadAndShare(videoBlob, mimeType, bgmStyle, hasAudioTrack);
                restoreButtons();
                updateStudioProgress(
                    100,
                    hasAudioTrack
                        ? `Hoàn tất! Video .${ext.toUpperCase()} có âm thanh đã sẵn sàng tải về máy.`
                        : `Đã xuất .${ext.toUpperCase()} (nếu máy chặn audio trình duyệt, hãy tải thêm file .WAV bên cạnh).`,
                    'done'
                );
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
        document.getElementById('btn-add-scene')?.addEventListener('click', () => {
            const values = getSceneInputs().map((el) => el.value);
            if (values.length >= MAX_DIALOGUE_SCENES) return;
            values.push('');
            renderSceneInputs(values);
            const all = getSceneInputs();
            all[all.length - 1]?.focus();
        });
        document.getElementById('vs-scenes-container')?.addEventListener('click', (e) => {
            const rmBtn = e.target.closest('button[data-remove-scene]');
            if (!rmBtn || rmBtn.disabled) return;
            const rmIdx = parseInt(rmBtn.dataset.removeScene, 10);
            const values = getSceneInputs().map((el) => el.value);
            if (values.length <= 2) return;
            values.splice(rmIdx, 1);
            renderSceneInputs(values);
        });
        document.getElementById('btn-generate-ai-assets')?.addEventListener('click', handleGenerateAssets);
        document.getElementById('btn-export-video')?.addEventListener('click', handleExportVideo);
        document.getElementById('btn-share-video')?.addEventListener('click', handleShareExportedVideo);
        document.getElementById('btn-regen-social')?.addEventListener('click', handleRegenSocialCaption);
        document.getElementById('btn-copy-social')?.addEventListener('click', handleCopySocialCaption);
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
            customImages = [];
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
            const commitSeek = (e) => {
                if (!isSeeking) return;
                isSeeking = false;
                App.mediaEngine.seekTo(parseFloat(e.target.value) || 0);
            };
            scrubber.addEventListener('change', commitSeek);
            scrubber.addEventListener('pointerup', () => {
                setTimeout(() => {
                    isSeeking = false;
                }, 0);
            });
            scrubber.addEventListener('touchend', () => {
                setTimeout(() => {
                    isSeeking = false;
                }, 0);
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

        document.getElementById('vs-subtitles')?.addEventListener('change', (e) => {
            const enabled = e.target.value === 'on';
            const list = App.mediaEngine.getScenes();
            if (!list || list.length === 0) return;
            list.forEach((sc) => {
                sc.showSubtitles = enabled;
            });
            const st = App.mediaEngine.getPlaybackState();
            App.mediaEngine.renderFrameAtTime(st.currentTime || 0);
        });
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
