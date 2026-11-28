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

    const MAX_DIALOGUE_SCENES = 16;
    let customImages = [];
    let currentTopicHashtags = '';
    let lastChapterAudioMeta = [];
    let cachedChapterAudios = [];
    const beatAudioCache = new Map();
    let lastVoiceSessionKey = '';
    let generationAbortController = null;
    let rewriteAbortController = null;
    let importAbortController = null;
    let auditAbortController = null;
    let pendingSafeFixScenes = null;
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
        const previewVid = document.getElementById('vs-exported-preview');
        if (previewVid) {
            try {
                previewVid.pause();
                previewVid.removeAttribute('src');
                previewVid.load();
            } catch (_) {}
            previewVid.classList.add('hidden');
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
        const capArea = document.getElementById('vs-social-caption');
        if (capArea) {
            capArea.value = currentTopicHashtags ? currentTopicHashtags : '';
        }

        const uploadInput = document.getElementById('vs-upload-images');
        if (uploadInput) uploadInput.value = '';

        document.getElementById('btn-generate-ai-assets').disabled = false;
        document.getElementById('btn-export-video').disabled = true;
        document.getElementById('vs-safety-report')?.classList.add('hidden');
        pendingSafeFixScenes = null;
        document.getElementById('vs-playback-controls')?.classList.add('hidden');
        document.getElementById('vs-timer-badge')?.classList.add('hidden');
        document.getElementById('vs-progress-box')?.classList.add('hidden');
        document.getElementById('btn-unmute-mobile-audio')?.classList.add('hidden');

        App.mediaEngine.drawPlaceholderCanvas(title || 'Nhập từ khóa hoặc dán nội dung để AI dựng video');
        document.getElementById('video-studio-modal')?.classList.remove('hidden');
    }

    function openFromScratch() {
        open({
            title: '',
            scenes: ['', ''],
            hashtags: ''
        });
        const kwInput = document.getElementById('vs-keyword-input');
        if (kwInput) {
            kwInput.value = '';
            setTimeout(() => kwInput.focus(), 60);
        }
    }

    let keywordDumpAbortController = null;
    async function handleStudioDumpKeyword(autoGenerate = false) {
        const kwInput = document.getElementById('vs-keyword-input');
        const btn = document.getElementById('btn-studio-dump-keyword');
        const keyword = kwInput?.value.trim() || '';
        if (!keyword) {
            App.toast.show('Hãy nhập từ khóa chủ đề để AI tự viết kịch bản & các cảnh quay!', 'warning');
            kwInput?.focus();
            return;
        }
        if (!btn || btn.disabled) return;

        const tone = document.getElementById('vs-tone')?.value || 'viral';
        const targetCount = parseInt(document.getElementById('vs-target-scenes')?.value || '8', 10) || 8;

        btn.disabled = true;
        const prevHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>AI đang dump...</span>';

        if (keywordDumpAbortController) keywordDumpAbortController.abort();
        keywordDumpAbortController = new AbortController();

        try {
            const res = await App.geminiApi.dumpTopicToStudioContent({
                keyword,
                tone,
                targetCount,
                signal: keywordDumpAbortController.signal
            });
            const titleInput = document.getElementById('vs-title');
            if (titleInput) titleInput.value = res.title || keyword;
            currentTopicHashtags = res.hashtags || '';
            if (Array.isArray(res.scenes) && res.scenes.length >= 2) {
                renderSceneInputs(res.scenes);
            }
            if (res.fullPost) setSocialCaptionPreview(res);
            lastChapterAudioMeta = [];
            cachedChapterAudios = [];
            App.mediaEngine.drawPlaceholderCanvas(res.title || keyword);
            App.toast.show(`AI đã dump xong "${res.title}" gồm ${res.scenes.length} cảnh lời thoại!`);
            if (autoGenerate) {
                setTimeout(() => handleGenerateAssets(), 60);
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (err.code === 'INVALID_API_KEY') {
                App.toast.show(err.message, 'warning', {
                    actionLabel: 'Cài Key',
                    onAction: () => App.modals.openSettingsModal()
                });
            } else {
                App.toast.show(err.message || 'Không thể dump nội dung từ khóa lúc này.', 'error');
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = prevHtml;
            keywordDumpAbortController = null;
        }
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
        if (importAbortController) {
            importAbortController.abort();
            importAbortController = null;
        }
        if (auditAbortController) {
            auditAbortController.abort();
            auditAbortController = null;
        }
        if (exportAbortController) {
            exportAbortController.abort();
            exportAbortController = null;
        }
        if (socialAbortController) {
            socialAbortController.abort();
            socialAbortController = null;
        }
        if (keywordDumpAbortController) {
            keywordDumpAbortController.abort();
            keywordDumpAbortController = null;
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

    async function handleImportContentTo2D(autoGenerate = false) {
        const rawInput = document.getElementById('vs-raw-content-input');
        const btnDump = document.getElementById('btn-dump-content-to-2d');
        const btnAuto = document.getElementById('btn-dump-and-generate-2d');
        const rawContent = rawInput?.value.trim() || '';
        if (!rawContent) {
            App.toast.show('Hãy dán content / kịch bản có sẵn vào ô trước nhé!', 'warning');
            rawInput?.focus();
            return;
        }

        const titleEl = document.getElementById('vs-title');
        const mode = document.getElementById('vs-import-mode')?.value || 'preserve';
        const visualStyle = document.getElementById('vs-visual-style')?.value || 'motion';

        if (btnDump) btnDump.disabled = true;
        if (btnAuto) btnAuto.disabled = true;
        const activeBtn = autoGenerate ? btnAuto : btnDump;
        const prevHtml = activeBtn ? activeBtn.innerHTML : '';
        if (activeBtn) {
            activeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Đang tách nhịp &amp; đạo diễn 2D...';
        }

        if (importAbortController) importAbortController.abort();
        importAbortController = new AbortController();

        try {
            const result = await App.geminiApi.dumpContentTo2DScenes({
                rawContent,
                titleHint: titleEl?.value.trim() || '',
                mode,
                visualStyle,
                layouts: App.motionGraphics?.LAYOUT_NAMES,
                backdrops: App.motionGraphics?.BACKDROP_NAMES,
                props: App.motionGraphics?.PROP_NAMES,
                actions: App.motionGraphics?.ACTION_NAMES,
                effects: App.motionGraphics?.EFFECT_NAMES,
                casts: App.motionGraphics?.CAST_NAMES,
                sfxList: App.motionGraphics?.SFX_NAMES,
                screenTypes: App.motionGraphics?.SCREEN_TYPES,
                signal: importAbortController.signal
            });

            if (titleEl && result.title && !titleEl.value.trim()) {
                titleEl.value = result.title;
            } else if (titleEl && result.title && mode === 'polish') {
                titleEl.value = result.title;
            }

            if (Array.isArray(result.scenes) && result.scenes.length >= 2) {
                renderSceneInputs(result.scenes);
                lastChapterAudioMeta = [];
                cachedChapterAudios = [];
                document.getElementById('vs-import-content-panel')?.classList.add('hidden');
                App.toast.show(`Đã tách content thành ${result.scenes.length} nhịp cảnh 2D khớp giọng nói!`);
                if (autoGenerate) {
                    setTimeout(() => handleGenerateAssets(), 60);
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            App.toast.show(err.message || 'Không thể phân tích content thành cảnh 2D.', 'error');
        } finally {
            if (btnDump) btnDump.disabled = false;
            if (btnAuto) btnAuto.disabled = false;
            if (activeBtn) activeBtn.innerHTML = prevHtml;
            importAbortController = null;
        }
    }

    function renderSafetyAuditReport(report) {
        const box = document.getElementById('vs-safety-report');
        const badge = document.getElementById('vs-safety-badge');
        const summary = document.getElementById('vs-safety-summary');
        const details = document.getElementById('vs-safety-details');
        const fixBtn = document.getElementById('btn-apply-safe-fix');
        if (!box || !badge || !summary || !details) return;

        box.classList.remove('hidden', 'bg-emerald-50', 'border-emerald-200', 'bg-amber-50', 'border-amber-200', 'bg-rose-50', 'border-rose-200', 'dark:bg-emerald-950/30', 'dark:bg-amber-950/30', 'dark:bg-rose-950/30');
        if (report.status === 'safe') {
            box.classList.add('bg-emerald-50', 'dark:bg-emerald-950/30', 'border-emerald-200');
            badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-600 text-white shrink-0';
            badge.textContent = `🟢 An toàn ${report.score}/100`;
        } else if (report.status === 'caution') {
            box.classList.add('bg-amber-50', 'dark:bg-amber-950/30', 'border-amber-200');
            badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-500 text-white shrink-0';
            badge.textContent = `🟡 Cần lưu ý ${report.score}/100`;
        } else {
            box.classList.add('bg-rose-50', 'dark:bg-rose-950/30', 'border-rose-200');
            badge.className = 'px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-600 text-white shrink-0';
            badge.textContent = `🔴 Rủi ro ${report.score}/100`;
        }

        summary.textContent = report.summary || '';
        const listItems = [];
        (report.flags || []).forEach((f) => listItems.push(`<li class="text-rose-700 dark:text-rose-300 font-semibold">⚠️ ${escapeHtml(f)}</li>`));
        (report.factCheckNotes || []).forEach((n) => listItems.push(`<li class="text-slate-700 dark:text-slate-300">🔍 ${escapeHtml(n)}</li>`));
        details.innerHTML = listItems.length > 0 ? listItems.join('') : '<li class="text-emerald-700 dark:text-emerald-300">✅ Nội dung đạt chuẩn cộng đồng Facebook Reels, TikTok &amp; YouTube Shorts.</li>';

        const currentScenes = getSceneInputs().map((el) => el.value.trim()).filter(Boolean);
        const hasImprovedDiff =
            Array.isArray(report.improvedScenes) &&
            report.improvedScenes.length === currentScenes.length &&
            report.improvedScenes.some((s, i) => s && s !== currentScenes[i]);

        pendingSafeFixScenes = hasImprovedDiff ? report.improvedScenes : null;
        if (fixBtn) fixBtn.classList.toggle('hidden', !hasImprovedDiff);
    }

    async function handleAuditContentSafety() {
        const btn = document.getElementById('btn-audit-content-safety');
        if (!btn || btn.disabled) return;

        const title = document.getElementById('vs-title')?.value.trim() || '';
        const scenes = getSceneInputs().map((el) => el.value.trim()).filter(Boolean);
        if (scenes.length === 0) {
            App.toast.show('Chưa có lời thoại nào để kiểm duyệt.', 'info');
            return;
        }

        btn.disabled = true;
        const prevHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang duyệt...</span>';

        if (auditAbortController) auditAbortController.abort();
        auditAbortController = new AbortController();

        try {
            const report = await App.geminiApi.auditScriptPolicyAndFacts({
                title,
                scenes,
                signal: auditAbortController.signal
            });
            renderSafetyAuditReport(report);
            App.toast.show(
                report.status === 'safe'
                    ? `Kiểm duyệt an toàn (${report.score}/100)!`
                    : `Phát hiện điểm cần lưu ý (${report.score}/100) — xem gợi ý sửa bên dưới.`,
                report.status === 'safe' ? 'success' : 'warning'
            );
        } catch (err) {
            if (err.name === 'AbortError') return;
            App.toast.show(err.message || 'Không thể kiểm duyệt lúc này.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = prevHtml;
            auditAbortController = null;
        }
    }

    function findClausePivotRatio(text) {
        const clean = String(text || '').trim();
        const words = clean.split(/\s+/).filter(Boolean);
        if (words.length < 4) return 0.52;
        // Locate natural Vietnamese clause break (punctuation or pivot conjunction)
        for (let i = 1; i < words.length - 1; i++) {
            if (/[,.;:—–]$/.test(words[i])) {
                return Math.max(0.30, Math.min(0.76, (i + 1) / words.length));
            }
        }
        const pivots = new Set(['mà', 'nhưng', 'rồi', 'thì', 'nên', 'vì', 'nếu', 'chứ', 'bảo']);
        for (let i = 2; i < words.length - 1; i++) {
            const w = words[i].toLowerCase().replace(/[^a-zà-ỹ]/gi, '');
            if (pivots.has(w)) {
                return Math.max(0.32, Math.min(0.75, i / words.length));
            }
        }
        return 0.52;
    }

    function buildSyncedCueSequence(flatBeats, aiStoryboard, videoTitle, visualStyle = 'motion') {
        const layouts = App.motionGraphics?.LAYOUT_NAMES || [];
        const backdrops = App.motionGraphics?.BACKDROP_NAMES || [];
        const propNames = App.motionGraphics?.PROP_NAMES || [];
        const casts = App.motionGraphics?.CAST_NAMES || [];
        const sfxNames = App.motionGraphics?.SFX_NAMES || [];
        const screenTypes = App.motionGraphics?.SCREEN_TYPES || [];
        const recentLayouts = [];
        const recentBackdrops = [];
        const recentProps = [];
        const recentCasts = [];

        return flatBeats.map((beat, idx) => {
            const localCue = App.motionGraphics
                ? App.motionGraphics.analyzeSceneVisualCue(
                      beat.text,
                      idx,
                      videoTitle,
                      {
                          prevLayout: recentLayouts[0] || '',
                          prevBackdrop: recentBackdrops[0] || '',
                          prevProp: recentProps[0] || '',
                          prevCast: recentCasts[0] || '',
                          recentLayouts,
                          recentBackdrops,
                          recentProps
                      },
                      visualStyle
                  )
                : {
                      layout: 'character-action',
                      backdrop: 'cream-room',
                      cast: 'narrator',
                      action: 'pointing',
                      screenType: 'chat_msg',
                      effect: 'sparkles',
                      sfx: 'none',
                      props: ['lightbulb'],
                      characterMood: 'happy',
                      crossOut: false,
                      sceneText: beat.text,
                      videoTitle
                  };

            const aiItem = Array.isArray(aiStoryboard) ? aiStoryboard[idx] : null;
            let finalCue = localCue;

            if (aiItem && layouts.includes(aiItem.layout)) {
                const isOfficeDomain = localCue.domainKey === 'office' || localCue.domainKey === 'tech';
                const beatMentionsOffice = /văn phòng|công ty|họp|laptop|excel|code|server|sếp|nhân viên/.test((beat.text || '').toLowerCase());
                const officeOnlyLayouts = ['wide-team', 'desk-closeup', 'two-shot-dialogue', 'laptop-popup', 'screen-pointer'];

                let lay = aiItem.layout;
                if (!isOfficeDomain && !beatMentionsOffice && officeOnlyLayouts.includes(lay)) {
                    lay = localCue.layout;
                }
                // Enforce 3-scene anti-repetition window on camera layout (no A -> B -> A -> B!)
                if (recentLayouts.includes(lay)) {
                    if (localCue.layout && !recentLayouts.includes(localCue.layout)) {
                        lay = localCue.layout;
                    } else if (layouts.length > 1) {
                        const freshAlts = layouts.filter((l) => !recentLayouts.includes(l) && (isOfficeDomain || !officeOnlyLayouts.includes(l)));
                        const fallbackAlts = layouts.filter((l) => l !== recentLayouts[0] && (isOfficeDomain || !officeOnlyLayouts.includes(l)));
                        const pool = freshAlts.length > 0 ? freshAlts : fallbackAlts;
                        if (pool.length > 0) lay = pool[(idx * 3 + 1) % pool.length];
                    }
                }

                // Prevent non-office topics from rendering office backdrops AND prevent 2-scene backdrop repeats!
                let bd = backdrops.includes(aiItem.backdrop) ? aiItem.backdrop : localCue.backdrop;
                if (!isOfficeDomain && !beatMentionsOffice && ['office-shelf', 'office-desk', 'server-tech'].includes(bd)) {
                    bd = localCue.backdrop;
                }
                if (recentBackdrops.includes(bd) && backdrops.length > 1) {
                    if (localCue.backdrop && !recentBackdrops.includes(localCue.backdrop)) {
                        bd = localCue.backdrop;
                    } else {
                        const allowedBgs = backdrops.filter((b) => !recentBackdrops.includes(b) && (isOfficeDomain || !['office-shelf', 'office-desk', 'server-tech'].includes(b)));
                        if (allowedBgs.length > 0) bd = allowedBgs[idx % allowedBgs.length];
                    }
                }

                let cast = casts.includes(aiItem.cast) ? aiItem.cast : (localCue.cast || 'narrator');
                if (recentCasts.includes(cast) && casts.length > 1) {
                    const altCasts = casts.filter((c) => !recentCasts.includes(c));
                    if (altCasts.length > 0) cast = altCasts[idx % altCasts.length];
                }

                // Combine AI & beat props, ensuring primary prop never clones consecutive scenes!
                const combinedProps = [...new Set([
                    ...(Array.isArray(aiItem.props) ? aiItem.props : []),
                    ...(Array.isArray(localCue.props) ? localCue.props : [])
                ])].filter((p) => propNames.includes(p));
                let chosenProps = combinedProps.length > 0 ? combinedProps : ['lightbulb'];
                if (chosenProps.length > 1 && recentProps.includes(chosenProps[0])) {
                    const freshProp = chosenProps.find((p) => !recentProps.includes(p)) || chosenProps.find((p) => p !== recentProps[0]);
                    if (freshProp) {
                        chosenProps = [freshProp, ...chosenProps.filter((p) => p !== freshProp)];
                    }
                }
                chosenProps = chosenProps.slice(0, 3);

                const sfx = sfxNames.includes(aiItem.sfx) ? aiItem.sfx : (localCue.sfx || 'none');
                const screenType = screenTypes.includes(aiItem.screenType) ? aiItem.screenType : (localCue.screenType || 'chat_msg');

                finalCue = {
                    layout: lay,
                    backdrop: bd,
                    transition: ['diagonal-wipe', 'zoom-blur'].includes(aiItem.transition) ? aiItem.transition : (localCue.transition || 'cut'),
                    cast,
                    action: aiItem.action || localCue.action,
                    stage2Action: aiItem.stage2Action || '',
                    screenType,
                    phase2Effect: aiItem.phase2Effect || localCue.phase2Effect || 'none',
                    visualSubject: aiItem.visualSubject || '',
                    roleTag: String(aiItem.roleTag || '').trim().slice(0, 22),
                    focusTag: String(aiItem.focusTag || '').trim().slice(0, 20),
                    diagramData: {
                        leftLabel: String(aiItem.diagramData?.leftLabel || localCue.diagramData?.leftLabel || '').trim().slice(0, 16),
                        rightLabel: String(aiItem.diagramData?.rightLabel || localCue.diagramData?.rightLabel || '').trim().slice(0, 16),
                        badgeA: String(aiItem.diagramData?.badgeA || localCue.diagramData?.badgeA || '').trim().slice(0, 16),
                        badgeB: String(aiItem.diagramData?.badgeB || localCue.diagramData?.badgeB || '').trim().slice(0, 16),
                        highlightNum: String(aiItem.diagramData?.highlightNum || localCue.diagramData?.highlightNum || '').trim().slice(0, 16)
                    },
                    effect: aiItem.effect || localCue.effect,
                    sfx,
                    props: chosenProps,
                    characterMood: aiItem.characterMood || localCue.characterMood,
                    stage2Mood: aiItem.stage2Mood || '',
                    crossOut: Boolean(aiItem.crossOut),
                    sceneText: beat.text,
                    videoTitle
                };
            }

            recentLayouts.unshift(finalCue.layout);
            if (recentLayouts.length > 3) recentLayouts.pop();
            recentBackdrops.unshift(finalCue.backdrop);
            if (recentBackdrops.length > 2) recentBackdrops.pop();
            if (finalCue.props?.[0]) {
                recentProps.unshift(finalCue.props[0]);
                if (recentProps.length > 2) recentProps.pop();
            }
            if (finalCue.cast) {
                recentCasts.unshift(finalCue.cast);
                if (recentCasts.length > 2) recentCasts.pop();
            }
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

        // Fast zero-latency deterministic policy/anti-misinfo pre-scan
        const preScan = App.geminiApi?.quickLocalPolicyScan?.([videoTitle, ...texts].join('\n'));
        if (preScan && preScan.flags.length > 0) {
            renderSafetyAuditReport({
                status: preScan.status,
                score: preScan.status === 'risk' ? 52 : 74,
                summary: 'Cảnh báo nhanh trước khi dựng video: có cụm từ dễ vi phạm chính sách hoặc phóng đại.',
                flags: preScan.flags,
                factCheckNotes: ['Bấm "Duyệt chính sách" để AI đề xuất câu chữ an toàn hơn nếu cần.'],
                improvedScenes: texts
            });
        }

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
        if (!hasApiKey) {
            App.toast.show('Vui lòng nhập Gemini API Key để AI tạo giọng đọc & dựng video thật (không dùng dữ liệu mẫu).', 'warning', {
                actionLabel: 'Cài Key',
                onAction: () => App.modals.openSettingsModal()
            });
            btn.disabled = false;
            return;
        }

        const audioCtx = App.mediaEngine.unlockAudioSync();
        isSeeking = false;

        try {
            // 1. Expand narration chapters into balanced audio-locked scenes
            // Keep beats brisk (1.8-3s) so every clause/action gets its own crisp camera cut!
            const chapterBeatTexts = texts.map((t) => {
                const wc = String(t || '').split(/\s+/).filter(Boolean).length;
                if (scenePacing === 'standard') return [t];
                if (scenePacing === 'dynamic') return splitTextIntoVisualBeats(t, chapterCount >= 10 ? 2 : 3);
                return wc >= 12 || chapterCount < 7 ? splitTextIntoVisualBeats(t, 2) : [t];
            });
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
                    ? `Đang đạo diễn ${flatBeats.length} nhịp cảnh 2D khớp từng câu nói & kết nối giọng AI...`
                    : `Đang chuẩn bị ${flatBeats.length} nhịp chuyển cảnh đa dạng...`
            );

            // Launch 1 Free Gemini AI Storyboard Director call in parallel with TTS
            const storyboardPromise =
                hasApiKey && (visualStyle === 'motion' || visualStyle === 'ui-motion' || visualStyle === 'photo' || visualStyle === 'ai-cartoon')
                    ? App.geminiApi.generateMultiBeatStoryboard({
                          title: videoTitle,
                          beatTexts: flatBeats.map((b) => b.text),
                          layouts: App.motionGraphics?.LAYOUT_NAMES,
                          backdrops: App.motionGraphics?.BACKDROP_NAMES,
                          props: App.motionGraphics?.PROP_NAMES,
                          actions: App.motionGraphics?.ACTION_NAMES,
                          effects: App.motionGraphics?.EFFECT_NAMES,
                          casts: App.motionGraphics?.CAST_NAMES,
                          sfxList: App.motionGraphics?.SFX_NAMES,
                          screenTypes: App.motionGraphics?.SCREEN_TYPES,
                          visualStyle: visualStyle === 'ai-cartoon' ? 'motion' : visualStyle,
                          signal
                      })
                    : Promise.resolve(null);

            const needAiImagePrompts =
                hasApiKey && (visualStyle === 'ai-image' || visualStyle === 'ai-cartoon' || (visualStyle === 'photo' && imageSourceMode !== 'stock'));
            const visualPromptsPromise = needAiImagePrompts
                ? (visualStyle === 'ai-cartoon'
                      ? storyboardPromise.then((sb) =>
                            App.geminiApi.generateCartoonVisualPrompts({
                                title: videoTitle,
                                beatTexts: flatBeats.map((b) => b.text),
                                storyboard: sb,
                                signal
                            })
                        )
                      : App.geminiApi.generateRealisticVisualPrompts({
                            title: videoTitle,
                            sceneTexts: visualStyle === 'ai-image' ? flatBeats.map((b) => b.text) : texts,
                            signal
                        }))
                : Promise.resolve(
                      (visualStyle === 'ai-image' || visualStyle === 'ai-cartoon' ? flatBeats.map((b) => b.text) : texts).map(
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

            const totalBeats = flatBeats.length;
            const flatAudioSlices = new Array(totalBeats).fill(null);
            const beatHasRealTts = new Array(totalBeats).fill(false);
            let usedSingleStreamAudio = false;
            let lastTtsError = '';

            // Reset per-beat audio cache whenever voice/engine changes so two different sessions' voices never mix
            const currentVoiceSessionKey = `${ttsEngine}|${voiceName}|${hashString(videoTitle)}`;
            if (lastVoiceSessionKey && lastVoiceSessionKey !== currentVoiceSessionKey) {
                beatAudioCache.clear();
            }
            lastVoiceSessionKey = currentVoiceSessionKey;

            const assignChapterBufferToBeats = (cIdx, chBuf, hasReal) => {
                let offset = 0;
                for (let k = 0; k < cIdx; k++) offset += chapterBeatTexts[k].length;
                const sliced = App.mediaEngine.splitAudioBufferIntoBeats(chBuf, chapterBeatTexts[cIdx], audioCtx);
                for (let b = 0; b < chapterBeatTexts[cIdx].length; b++) {
                    const targetIdx = offset + b;
                    flatAudioSlices[targetIdx] = sliced[b] || App.mediaEngine.createSilentBuffer(audioCtx, flatBeats[targetIdx].text);
                    beatHasRealTts[targetIdx] = hasReal;
                }
            };

            if (!hasApiKey) {
                lastTtsError = 'Chưa nhập Gemini API Key';
                for (let c = 0; c < chapterCount; c++) {
                    assignChapterBufferToBeats(c, App.mediaEngine.createSilentBuffer(audioCtx, texts[c]), false);
                }
            } else if (!isLiveEngine && typeof App.geminiApi.fetchCombinedTtsPcm === 'function') {
                // PATH A (Default): 1 single unified TTS call reading the entire script smoothly -> ZERO voice switching!
                updateStudioProgress(26, `Đang thu âm 1 luồng đồng nhất cho toàn bộ ${chapterCount} câu thoại (không đổi giọng)...`);
                const batchRes = await App.geminiApi.fetchCombinedTtsPcm({
                    texts,
                    voiceName,
                    ttsModel: restTtsModelId,
                    signal
                });
                if (batchRes?.buffer) {
                    const rateMatch = String(batchRes.mimeType || '').match(/rate=(\d+)/i);
                    const parsedRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
                    const decodedAll = await App.mediaEngine.decodeTtsToAudioBuffer(batchRes.buffer, audioCtx, parsedRate || 24000);
                    if (decodedAll && decodedAll.duration >= Math.max(0.8, chapterCount * 0.45)) {
                        usedSingleStreamAudio = true;
                        const beatTracks = App.mediaEngine.splitAudioBufferIntoBeats(
                            decodedAll,
                            flatBeats.map((b) => b.text),
                            audioCtx
                        );
                        for (let b = 0; b < totalBeats; b++) {
                            flatAudioSlices[b] = beatTracks[b] || App.mediaEngine.createSilentBuffer(audioCtx, flatBeats[b].text);
                            beatHasRealTts[b] = true;
                        }
                    }
                }
                if (!usedSingleStreamAudio && batchRes?.errorReason) {
                    lastTtsError = batchRes.errorReason;
                }
            }

            // PATH B: Cohesive per-chapter audio (Live API or REST fallback) — ALWAYS keeps ONE single engine across all chapters!
            const anyMissingVoice = beatHasRealTts.some((v) => !v);
            if (hasApiKey && anyMissingVoice) {
                const chapterAudios = new Array(chapterCount).fill(null);
                const chapterHasRealTts = new Array(chapterCount).fill(false);

                if (isLiveEngine) {
                    // Generate 1 Live turn per FULL chapter (never fragment mid-sentence) so speech flows naturally
                    for (let liveAttempt = 0; liveAttempt < 2; liveAttempt++) {
                        const pendingChapterIdx = [];
                        for (let c = 0; c < chapterCount; c++) {
                            if (!chapterHasRealTts[c]) pendingChapterIdx.push(c);
                        }
                        if (pendingChapterIdx.length === 0) break;
                        try {
                            let doneChapters = chapterCount - pendingChapterIdx.length;
                            const liveRes = await App.geminiApi.fetchBatchLiveTtsPcm({
                                texts: pendingChapterIdx.map((c) => texts[c]),
                                voiceName,
                                model: liveModelId,
                                signal,
                                onSceneDone: () => {
                                    doneChapters++;
                                    const pct = 24 + Math.round((doneChapters / chapterCount) * 36);
                                    updateStudioProgress(pct, `Đang thu giọng Gemini Live câu ${doneChapters}/${chapterCount}...`);
                                }
                            });
                            for (let m = 0; m < pendingChapterIdx.length; m++) {
                                const cIdx = pendingChapterIdx[m];
                                if (liveRes.buffers[m]) {
                                    const mime = liveRes.mimeTypes?.[m] || 'audio/pcm;rate=24000';
                                    const rateMatch = String(mime).match(/rate=(\d+)/i);
                                    const parsedRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
                                    const decoded = await App.mediaEngine.decodeTtsToAudioBuffer(liveRes.buffers[m], audioCtx, parsedRate || 24000);
                                    if (decoded && decoded.duration >= 0.35) {
                                        chapterAudios[cIdx] = decoded;
                                        chapterHasRealTts[cIdx] = true;
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

                // If NOT live OR Live failed completely/partially -> use unified REST TTS consistently across missing chapters
                // (If Live failed >= half chapters, switch ALL chapters to unified 1-stream REST TTS so voice never changes mid-video!)
                const liveSuccessCount = chapterHasRealTts.filter(Boolean).length;
                const needUniformRestSwitch = !isLiveEngine || (liveSuccessCount > 0 && liveSuccessCount < chapterCount) || liveSuccessCount === 0;

                if (needUniformRestSwitch && (!isLiveEngine || liveSuccessCount < chapterCount)) {
                    const fallbackIndices = [];
                    if (isLiveEngine && liveSuccessCount < chapterCount) {
                        // Prefer 1 unified combined REST call over mixing Live + REST voices!
                        const unifiedRetry = await App.geminiApi.fetchCombinedTtsPcm({
                            texts,
                            voiceName,
                            ttsModel: restTtsModelId,
                            signal
                        });
                        if (unifiedRetry?.buffer) {
                            const rateMatch = String(unifiedRetry.mimeType || '').match(/rate=(\d+)/i);
                            const parsedRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
                            const decodedAll = await App.mediaEngine.decodeTtsToAudioBuffer(unifiedRetry.buffer, audioCtx, parsedRate || 24000);
                            if (decodedAll && decodedAll.duration >= Math.max(0.8, chapterCount * 0.45)) {
                                usedSingleStreamAudio = true;
                                const beatTracks = App.mediaEngine.splitAudioBufferIntoBeats(
                                    decodedAll,
                                    flatBeats.map((b) => b.text),
                                    audioCtx
                                );
                                for (let b = 0; b < totalBeats; b++) {
                                    flatAudioSlices[b] = beatTracks[b] || App.mediaEngine.createSilentBuffer(audioCtx, flatBeats[b].text);
                                    beatHasRealTts[b] = true;
                                }
                            }
                        }
                    }

                    if (!usedSingleStreamAudio) {
                        for (let c = 0; c < chapterCount; c++) {
                            if (!chapterHasRealTts[c]) fallbackIndices.push(c);
                        }
                        for (const cIdx of fallbackIndices) {
                            const chapterText = texts[cIdx];
                            const textVoiceSig = hashString(`${chapterText}|${voiceName}|${ttsEngine}`);
                            const prevMeta = lastChapterAudioMeta[cIdx];
                            if (prevMeta && prevMeta.hasRealTts && prevMeta.textVoiceSig === textVoiceSig && cachedChapterAudios[cIdx]) {
                                chapterAudios[cIdx] = cachedChapterAudios[cIdx];
                                chapterHasRealTts[cIdx] = true;
                                continue;
                            }
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
                                    continue;
                                }
                            }
                            if (ttsRes.errorReason && !lastTtsError) lastTtsError = ttsRes.errorReason;
                            chapterAudios[cIdx] = App.mediaEngine.createSilentBuffer(audioCtx, chapterText);
                        }
                    }
                }

                if (!usedSingleStreamAudio) {
                    for (let c = 0; c < chapterCount; c++) {
                        const buf = chapterAudios[c] || App.mediaEngine.createSilentBuffer(audioCtx, texts[c]);
                        assignChapterBufferToBeats(c, buf, Boolean(chapterHasRealTts[c]));
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
            const motionCues = buildSyncedCueSequence(flatBeats, aiStoryboard, videoTitle, visualStyle);

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
            } else if (visualStyle === 'ai-image' || visualStyle === 'ai-cartoon') {
                if (hasApiKey) {
                    const isCartoon = visualStyle === 'ai-cartoon';
                    let hitRateLimit = false;
                    for (let b = 0; b < flatBeats.length; b++) {
                        if (b > 0) await App.utils.sleep(800, signal);
                        const pct = 62 + Math.round((b / Math.max(1, flatBeats.length)) * 28);
                        updateStudioProgress(
                            pct,
                            isCartoon
                                ? `Nano Banana đang vẽ khung hình hoạt hình 2D cảnh ${b + 1}/${flatBeats.length}...`
                                : `Đang tạo ảnh AI cảnh ${b + 1}/${flatBeats.length} khớp lời thoại...`
                        );
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
                        // Fall back cleanly per missing scene to our crisp 2-stage cel-shaded 2D motion director!
                        missingIndices.forEach((mIdx) => {
                            sceneStyleOverrides[mIdx] = 'motion';
                        });
                        if (hitRateLimit) {
                            App.toast.show(
                                missingIndices.length === flatBeats.length
                                    ? 'Model ảnh Nano Banana tạm giới hạn Free → tự chuyển sang Hoạt Hình 2D Kể Chuyện 2 pha!'
                                    : `Có ${missingIndices.length} cảnh chạm hạn mức ảnh AI → tự bù bằng Hoạt Hình 2D Kể Chuyện khớp giọng.`,
                                'warning',
                                { duration: 5500 }
                            );
                        }
                    }
                } else {
                    flatBeats.forEach((_, idx) => {
                        sceneStyleOverrides[idx] = 'motion';
                    });
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
                updateStudioProgress(82, `Đang dựng ${flatBeats.length} phân cảnh hoạt hình 2D 2 pha khớp từng nhịp âm thanh...`);
            }

            const builtScenes = flatBeats.map((beat, beatIdx) => {
                const audioBuffer = flatAudioSlices[beatIdx];
                const rawAudioDur = audioBuffer && Number.isFinite(audioBuffer.duration) ? audioBuffer.duration : 2.5;
                const effectiveAudioDur = rawAudioDur / speedRate;
                const isMidSentenceCut = beat.beatInChapter < chapterBeatTexts[beat.chapterIdx].length - 1;
                const trailingGap = isMidSentenceCut ? 0.0 : (usedSingleStreamAudio ? 0.01 : 0.06);
                const clausePivot = findClausePivotRatio(beat.text);
                const speechPivot =
                    typeof App.mediaEngine.findAudioPivotRatio === 'function'
                        ? App.mediaEngine.findAudioPivotRatio(audioBuffer, clausePivot)
                        : clausePivot;

                return {
                    text: beat.text,
                    visualPrompt:
                        visualStyle === 'ai-image' || visualStyle === 'ai-cartoon'
                            ? visualPrompts[beatIdx] || beat.text
                            : visualPrompts[beat.chapterIdx] || beat.text,
                    visualStyle: sceneStyleOverrides[beatIdx],
                    showSubtitles,
                    motionCue: motionCues[beatIdx],
                    imageObj: sceneImageObjs[beatIdx],
                    customHeroImg: null,
                    speechPivot,
                    audioBuffer,
                    playbackRate: speedRate,
                    duration: Math.max(0.7, effectiveAudioDur + trailingGap),
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

            await Promise.all([
                App.mediaEngine.prepareMixedPreviewWavUrl?.(bgmStyle),
                App.mediaEngine.prebuildExportAssets?.(bgmStyle)
            ]);
            if (window.innerWidth < 1024) {
                document.getElementById('reels-canvas')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
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

    async function prepareDownloadAndShare(blob, mimeType, bgmStyle = 'upbeat', hasAudio = true, engineLabel = '') {
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
        const previewVid = document.getElementById('vs-exported-preview');

        const tagInfo = engineLabel ? `${engineLabel} • ` : '';
        if (infoEl) {
            infoEl.textContent = hasAudio
                ? `File .${ext.toUpperCase()} (${tagInfo}${sizeMB} MB • Có âm thanh) sẵn sàng`
                : `File .${ext.toUpperCase()} (${tagInfo}${sizeMB} MB — nếu máy mất tiếng hãy tải thêm .WAV bên cạnh)`;
        }
        if (previewVid) {
            previewVid.src = url;
            previewVid.muted = false;
            previewVid.volume = 1.0;
            previewVid.classList.remove('hidden');
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

    function handleExportVideo() {
        const scenes = App.mediaEngine.getScenes();
        if (scenes.length === 0) return;

        const btnExport = document.getElementById('btn-export-video');
        const btnGen = document.getElementById('btn-generate-ai-assets');
        const bgmStyle = document.getElementById('vs-bgm')?.value || 'upbeat';

        if (btnExport) btnExport.disabled = true;
        if (btnGen) btnGen.disabled = true;

        if (exportAbortController) exportAbortController.abort();
        exportAbortController = new AbortController();

        let exportGuard = { release: () => {} };
        const restoreButtons = () => {
            exportGuard.release();
            if (btnExport) btnExport.disabled = false;
            if (btnGen) btnGen.disabled = false;
            exportAbortController = null;
        };

        const runMediaRecorderFallback = () => {
            updateStudioProgress(0, 'Đang ghi hình chuẩn trình duyệt (chạy theo thời lượng video)...', 'loading');
            App.mediaEngine.startRecordingSync({
                bgmStyle,
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
        };

        // Only use async fast WebCodecs path if pre-probe already confirmed H.264 + AAC support;
        // otherwise execute MediaRecorder 100% SYNCHRONOUSLY inside the user's tap gesture with ZERO awaits!
        if (App.mediaEngine.canFastExportSync?.()) {
            exportGuard = App.mediaEngine.prepareForExportSync
                ? App.mediaEngine.prepareForExportSync()
                : exportGuard;
            App.mediaEngine
                .fastExportVideo({
                    bgmStyle,
                    signal: exportAbortController.signal,
                    onProgress: (pct, msg) => updateStudioProgress(pct, msg, 'loading')
                })
                .then(async (fastResult) => {
                    if (fastResult && fastResult.blob) {
                        const ext = await prepareDownloadAndShare(
                            fastResult.blob,
                            fastResult.mimeType,
                            bgmStyle,
                            fastResult.hasAudio !== false,
                            fastResult.engineLabel || ''
                        );
                        restoreButtons();
                        updateStudioProgress(100, `Hoàn tất! Đã tạo file video .${ext.toUpperCase()} (${fastResult.engineLabel || 'H.264 + AAC'}) có âm thanh.`, 'done');
                        App.toast.show(`Đã xuất video .${ext.toUpperCase()} có âm thanh thành công!`);
                        return;
                    }
                    runMediaRecorderFallback();
                })
                .catch((fastErr) => {
                    if (fastErr?.name === 'AbortError') {
                        restoreButtons();
                        return;
                    }
                    console.warn('Fast WebCodecs export fallback to MediaRecorder:', fastErr);
                    runMediaRecorderFallback();
                });
            return;
        }

        runMediaRecorderFallback();
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
        document.getElementById('btn-studio-dump-keyword')?.addEventListener('click', () => handleStudioDumpKeyword(false));
        document.getElementById('vs-keyword-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleStudioDumpKeyword(false);
            }
        });
        document.getElementById('btn-toggle-import-content')?.addEventListener('click', () => {
            const panel = document.getElementById('vs-import-content-panel');
            if (!panel) return;
            const willOpen = panel.classList.contains('hidden');
            panel.classList.toggle('hidden');
            if (willOpen) document.getElementById('vs-raw-content-input')?.focus();
        });
        document.getElementById('btn-close-import-panel')?.addEventListener('click', () => {
            document.getElementById('vs-import-content-panel')?.classList.add('hidden');
        });
        document.getElementById('btn-dump-content-to-2d')?.addEventListener('click', () => handleImportContentTo2D(false));
        document.getElementById('btn-dump-and-generate-2d')?.addEventListener('click', () => handleImportContentTo2D(true));
        document.getElementById('btn-rewrite-story')?.addEventListener('click', handleEnhanceStorytelling);
        document.getElementById('btn-audit-content-safety')?.addEventListener('click', handleAuditContentSafety);
        document.getElementById('btn-apply-safe-fix')?.addEventListener('click', () => {
            if (!Array.isArray(pendingSafeFixScenes) || pendingSafeFixScenes.length === 0) return;
            renderSceneInputs(pendingSafeFixScenes);
            pendingSafeFixScenes = null;
            document.getElementById('btn-apply-safe-fix')?.classList.add('hidden');
            App.toast.show('Đã cập nhật lời thoại sang bản an toàn chính sách!');
        });
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
