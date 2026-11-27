/* ==========================================================================
   Connected Series Builder Modal Controller
   - Generates multi-episode linked Reels series (Ep 1 -> Ep N) with cliffhangers
   - Saves whole series into Planner with staggered daily schedules
   - Opens any episode directly inside AI Video Studio
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { escapeHtml, getDefaultTomorrowSchedule, addDaysToSchedule } = App.utils;

    let currentSeriesResult = null;
    let seriesAbortController = null;

    function open(initialTopic = '') {
        const modal = document.getElementById('series-modal');
        if (!modal) return;
        const topicEl = document.getElementById('series-topic-input');
        const dateEl = document.getElementById('series-start-date');
        if (topicEl && initialTopic) topicEl.value = initialTopic;
        if (dateEl && !dateEl.value) {
            dateEl.value = getDefaultTomorrowSchedule(20, 0);
        }
        modal.classList.remove('hidden');
        setTimeout(() => topicEl?.focus(), 50);
    }

    function close() {
        if (seriesAbortController) {
            seriesAbortController.abort();
            seriesAbortController = null;
        }
        const btn = document.getElementById('btn-generate-series');
        if (btn) btn.disabled = false;
        document.getElementById('series-modal')?.classList.add('hidden');
    }

    function renderSeriesPreview(seriesData) {
        const listEl = document.getElementById('series-preview-list');
        const saveBtn = document.getElementById('btn-save-series-to-planner');
        if (!listEl) return;

        if (!seriesData || !Array.isArray(seriesData.episodes) || seriesData.episodes.length === 0) {
            if (saveBtn) saveBtn.disabled = true;
            return;
        }

        const startIso = document.getElementById('series-start-date')?.value || getDefaultTomorrowSchedule(20, 0);
        const totalEps = seriesData.episodes.length;

        listEl.innerHTML = `
            <div class="flex items-center justify-between gap-2 px-1">
                <h4 class="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                    📚 Seri: ${escapeHtml(seriesData.seriesTitle)} (${totalEps} tập)
                </h4>
                <span class="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">Lên lịch +1 ngày/tập</span>
            </div>
        `;

        seriesData.episodes.forEach((ep, idx) => {
            const epSchedule = addDaysToSchedule(startIso, idx);
            const dateText = App.utils.formatDateTimeVN(epSchedule);
            const card = document.createElement('div');
            card.className =
                'bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl p-3.5 space-y-2 shadow-sm';
            card.innerHTML = `
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap mb-1">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300">Tập ${ep.episodeNumber}/${totalEps}</span>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">${ep.scenes.length} cảnh lời thoại</span>
                            <span class="text-[11px] text-slate-500 dark:text-slate-400"><i class="fa-regular fa-clock mr-1"></i>${escapeHtml(dateText)}</span>
                        </div>
                        <h5 class="font-bold text-sm text-slate-900 dark:text-white">${escapeHtml(ep.title)}</h5>
                    </div>
                    <button type="button" data-open-series-ep="${idx}" class="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shrink-0 cursor-pointer flex items-center gap-1.5 transition">
                        <i class="fa-solid fa-film"></i> <span>Quay ngay</span>
                    </button>
                </div>
                <p class="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/60 p-2 rounded-xl border border-slate-100 dark:border-slate-700/60">
                    <strong>Mở đầu:</strong> "${escapeHtml(ep.hook)}"
                </p>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 pl-1">
                    ${ep.scenes.slice(0, 3).map((s, sIdx) => `<p class="truncate">• Cảnh ${sIdx + 1}: ${escapeHtml(s)}</p>`).join('')}
                    ${ep.scenes.length > 3 ? `<p class="italic text-indigo-600 dark:text-indigo-400">+ ${ep.scenes.length - 3} cảnh tiếp theo &amp; CTA nối tập sau...</p>` : ''}
                </div>
                ${ep.cliffhanger ? `<p class="text-[11px] font-semibold text-rose-600 dark:text-rose-400">🔗 Móc nối tập kế: ${escapeHtml(ep.cliffhanger)}</p>` : ''}
            `;
            listEl.appendChild(card);
        });

        if (saveBtn) saveBtn.disabled = false;
    }

    async function handleGenerateSeries() {
        const topicEl = document.getElementById('series-topic-input');
        const btn = document.getElementById('btn-generate-series');
        const topic = topicEl?.value.trim() || '';
        if (!topic) {
            App.toast.show('Hãy nhập chủ đề Seri hoặc chọn nhanh 1 gợi ý bên dưới!', 'warning');
            topicEl?.focus();
            return;
        }
        if (!btn || btn.disabled) return;

        const episodeCount = document.getElementById('series-ep-count')?.value || '5';
        const scenesPerEp = document.getElementById('series-scenes-per-ep')?.value || '8';
        const tone = document.getElementById('series-tone')?.value || 'viral';

        btn.disabled = true;
        const prevHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>AI đang viết chuỗi các tập liên kết...</span>';

        if (seriesAbortController) seriesAbortController.abort();
        seriesAbortController = new AbortController();

        try {
            const result = await App.geminiApi.generateConnectedSeries({
                topic,
                episodeCount,
                scenesPerEp,
                tone,
                signal: seriesAbortController.signal
            });
            currentSeriesResult = result;
            renderSeriesPreview(result);
            App.toast.show(`Đã tạo xong Seri "${result.seriesTitle}" gồm ${result.episodes.length} tập nối tiếp!`);
        } catch (err) {
            if (err.name === 'AbortError') return;
            App.toast.show(err.message || 'Không thể tạo chuỗi Seri lúc này.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = prevHtml;
            seriesAbortController = null;
        }
    }

    function handleSaveSeriesToPlanner() {
        if (!currentSeriesResult || !Array.isArray(currentSeriesResult.episodes)) return;
        const seriesId = `series-${Date.now()}`;
        const startIso = document.getElementById('series-start-date')?.value || getDefaultTomorrowSchedule(20, 0);
        const totalEps = currentSeriesResult.episodes.length;

        const batchItems = currentSeriesResult.episodes.map((ep, idx) => {
            const epScenes = ep.scenes && ep.scenes.length > 0 ? ep.scenes : [ep.hook, ep.cta];
            const middleScenes = epScenes.length > 2 ? epScenes.slice(1, -1) : epScenes;
            return {
                id: `${seriesId}-ep-${ep.episodeNumber || idx + 1}`,
                seriesId,
                seriesTitle: currentSeriesResult.seriesTitle,
                episodeNumber: ep.episodeNumber || idx + 1,
                totalEpisodes: totalEps,
                cliffhanger: ep.cliffhanger || '',
                title: ep.title,
                status: 'scheduled',
                schedule: addDaysToSchedule(startIso, idx),
                hook: ep.hook || epScenes[0] || '',
                body: middleScenes.map((s) => `• ${s}`).join('\n'),
                cta: ep.cta || '',
                scenes: epScenes,
                hashtags: ep.hashtags || '#seri #reelsvn'
            };
        });

        // Reverse when unshifting/adding so Tập 1 appears at top of column
        const added = App.store.addUserScriptsBatch([...batchItems].reverse());
        close();
        App.toast.show(`Đã xếp lịch ${added} tập Seri vào mục Đặt lịch! Bấm "+ Tập tiếp" bất kỳ lúc nào để viết nối tiếp.`);
        App.router.switchTab('planner');
    }

    function init() {
        document.getElementById('btn-open-series-modal')?.addEventListener('click', () => open());
        document.getElementById('btn-generate-series')?.addEventListener('click', handleGenerateSeries);
        document.getElementById('btn-save-series-to-planner')?.addEventListener('click', handleSaveSeriesToPlanner);

        document.getElementById('series-quick-chips')?.addEventListener('click', (e) => {
            const chip = e.target.closest('button[data-topic]');
            if (!chip) return;
            const input = document.getElementById('series-topic-input');
            if (input) input.value = chip.dataset.topic || '';
        });

        document.getElementById('series-preview-list')?.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-open-series-ep]');
            if (!btn || !currentSeriesResult) return;
            const idx = parseInt(btn.dataset.openSeriesEp, 10);
            const ep = currentSeriesResult.episodes[idx];
            if (!ep) return;
            close();
            App.videoStudio.open({
                title: ep.title,
                scenes: ep.scenes && ep.scenes.length > 0 ? ep.scenes : [ep.hook, ep.cta]
            });
        });
    }

    App.seriesModal = { init, open, close };
})(window);
