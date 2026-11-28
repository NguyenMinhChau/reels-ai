/* ==========================================================================
   Library View — Template Grid, Search, Category Filter & AI Idea Dump
   - Uses DocumentFragment & event delegation (no inline onclick)
   - Skips redundant re-renders via signature check & dirty flag
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { CATEGORY_BADGES } = App.CONFIG;
    const { escapeHtml, debounce, copyToClipboard } = App.utils;

    let isDirty = true;
    let lastSignature = '';
    let currentPage = 1;
    let pageSize = 9;
    let lastFilterKey = '';
    let dumpAbortController = null;
    let trendsAbortController = null;
    let cachedTrendItems = [];
    let hasAutoDumpedThisSession = false;

    function getFilteredTemplates(state) {
        return state.templates.filter((item) => {
            if (state.currentCategory !== 'all' && item.category !== state.currentCategory) return false;
            if (state.onlyNewTemplates && !item.isNew) return false;
            if (state.searchQuery) {
                const hay = `${item.title} ${item.hook} ${item.body} ${item.hashtags || ''}`.toLowerCase();
                if (!hay.includes(state.searchQuery)) return false;
            }
            return true;
        });
    }

    function updateCategoryControls(state) {
        const allBtn = document.querySelector('.cat-btn[data-cat="all"]');
        if (allBtn) allBtn.textContent = `Tất cả (${state.templates.length})`;

        document.querySelectorAll('.cat-btn').forEach((btn) => {
            const active = btn.dataset.cat === state.currentCategory;
            btn.className = active
                ? 'cat-btn active shrink-0 h-8 px-3 rounded-xl text-xs font-bold bg-slate-900 dark:bg-indigo-600 text-white transition cursor-pointer inline-flex items-center justify-center whitespace-nowrap'
                : 'cat-btn shrink-0 h-8 px-3 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer inline-flex items-center justify-center whitespace-nowrap';
        });

        const newToggle = document.getElementById('btn-filter-new');
        if (newToggle) {
            newToggle.className = state.onlyNewTemplates
                ? 'shrink-0 h-8 px-3 rounded-xl text-xs font-bold bg-amber-500 text-white transition cursor-pointer inline-flex items-center justify-center gap-1 whitespace-nowrap'
                : 'shrink-0 h-8 px-3 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-500/30 hover:bg-amber-100 transition cursor-pointer inline-flex items-center justify-center gap-1 whitespace-nowrap';
        }
    }

    function getPaginationPages(totalPages, activePage) {
        if (totalPages <= 5) {
            return Array.from({ length: totalPages }, (_, i) => i + 1);
        }
        const pages = [1];
        if (activePage > 3) pages.push('...');
        const start = Math.max(2, activePage - 1);
        const end = Math.min(totalPages - 1, activePage + 1);
        for (let p = start; p <= end; p++) pages.push(p);
        if (activePage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
        return pages;
    }

    function renderPagination(totalItems, totalPages, startIdx, endIdx) {
        const bar = document.getElementById('library-pagination');
        const summary = document.getElementById('library-page-summary');
        const controls = document.getElementById('library-page-controls');
        if (!bar || !summary || !controls) return;

        if (totalItems === 0) {
            bar.classList.add('hidden');
            return;
        }
        bar.classList.remove('hidden');
        summary.textContent = `Hiển thị ${startIdx + 1}–${endIdx} / ${totalItems} kịch bản`;

        const prevDisabled = currentPage <= 1 ? 'disabled' : '';
        const nextDisabled = currentPage >= totalPages ? 'disabled' : '';
        const pageButtons = getPaginationPages(totalPages, currentPage)
            .map((p) => {
                if (p === '...') {
                    return '<span class="px-1.5 text-xs text-slate-400 select-none">…</span>';
                }
                const activeCls =
                    p === currentPage
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-700';
                return `<button type="button" data-lib-page="${p}" class="min-w-[30px] h-8 px-2 rounded-lg border text-xs font-bold transition cursor-pointer ${activeCls}">${p}</button>`;
            })
            .join('');

        controls.innerHTML = `
            <button type="button" data-lib-page="${currentPage - 1}" ${prevDisabled} class="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer flex items-center gap-1">
                <i class="fa-solid fa-chevron-left text-[10px]"></i><span class="hidden sm:inline">Trước</span>
            </button>
            ${pageButtons}
            <button type="button" data-lib-page="${currentPage + 1}" ${nextDisabled} class="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-slate-700 dark:text-slate-200 transition cursor-pointer flex items-center gap-1">
                <span class="hidden sm:inline">Sau</span><i class="fa-solid fa-chevron-right text-[10px]"></i>
            </button>
        `;
    }

    function render(force = false) {
        const state = App.store.getState();
        updateCategoryControls(state);

        if (state.activeTab !== 'library' && !force) {
            isDirty = true;
            return;
        }

        const grid = document.getElementById('template-grid');
        if (!grid) return;

        const filterKey = `${state.currentCategory}|${state.searchQuery}|${state.onlyNewTemplates}`;
        if (filterKey !== lastFilterKey) {
            currentPage = 1;
            lastFilterKey = filterKey;
        }

        const filtered = getFilteredTemplates(state);
        const totalItems = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const startIdx = (currentPage - 1) * pageSize;
        const pageItems = filtered.slice(startIdx, startIdx + pageSize);
        const endIdx = startIdx + pageItems.length;

        const signature = `${filterKey}|p=${currentPage}|ps=${pageSize}|${pageItems.map((i) => i.id).join(',')}`;

        if (!force && !isDirty && signature === lastSignature) {
            return;
        }
        isDirty = false;
        lastSignature = signature;

        renderPagination(totalItems, totalPages, startIdx, endIdx);

        if (filtered.length === 0) {
            const isEmptyStore = state.templates.length === 0;
            grid.innerHTML = isEmptyStore
                ? `
                <div class="col-span-full bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-amber-300 dark:border-amber-500/40 p-10 text-center space-y-3">
                    <div class="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-500/15 text-amber-500 mx-auto flex items-center justify-center text-xl">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                    </div>
                    <p class="text-sm font-extrabold text-slate-800 dark:text-slate-100">Kho đang trống — 100% hiển thị kịch bản do AI tạo</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">Nhập từ khóa chủ đề vào ô phía trên rồi bấm <strong>"AI Dump Từ Khóa"</strong>, hoặc bấm <strong>"Dump Thêm 5 Ý Tưởng Mới"</strong> để Gemini AI trả về kịch bản thật cho bạn.</p>
                </div>
            `
                : `
                <div class="col-span-full bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center space-y-3">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center text-xl">
                        <i class="fa-solid fa-magnifying-glass"></i>
                    </div>
                    <p class="text-sm font-bold text-slate-700 dark:text-slate-200">Không tìm thấy kịch bản phù hợp</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">Thử từ khóa khác hoặc bấm "AI Dump Từ Khóa" để AI tạo kịch bản mới đúng chủ đề bạn muốn.</p>
                </div>
            `;
            return;
        }

        const fragment = document.createDocumentFragment();

        pageItems.forEach((item) => {
            const badge = CATEGORY_BADGES[item.category] || CATEGORY_BADGES.lifehack;
            const card = document.createElement('article');
            card.className =
                'min-w-0 h-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 flex flex-col justify-between card-hover shadow-sm';
            card.dataset.templateId = item.id;

            const newBadgeHtml = item.isNew
                ? '<span class="px-2 py-0.5 text-[10px] font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full shadow-sm">MỚI</span>'
                : '';

            const deleteBtnHtml = item.isNew
                ? `<button type="button" data-action="delete-tpl" data-id="${escapeHtml(item.id)}" class="w-7 h-7 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/15 text-slate-400 hover:text-rose-600 flex items-center justify-center transition cursor-pointer" title="Xóa ý tưởng này"><i class="fa-solid fa-trash text-xs"></i></button>`
                : '';

            card.innerHTML = `
                <div class="flex-1 flex flex-col min-w-0">
                    <div class="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold border ${badge.cls} truncate">${badge.label}</span>
                            ${newBadgeHtml}
                        </div>
                        <div class="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 shrink-0">
                            <span><i class="fa-regular fa-clock mr-1"></i>${escapeHtml(item.duration)}</span>
                            <span class="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 rounded-md"><i class="fa-solid fa-fire mr-0.5"></i>${escapeHtml(item.viralScore)}</span>
                            ${deleteBtnHtml}
                        </div>
                    </div>

                    <h3 class="font-extrabold text-slate-900 dark:text-slate-100 text-base mb-2.5 leading-snug line-clamp-2 min-h-[2.75rem]">${escapeHtml(item.title)}</h3>

                    <div class="bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-500/25 rounded-xl p-2.5 mb-2.5">
                        <span class="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300 block mb-0.5">⚡ Hook 3s đầu:</span>
                        <p class="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-relaxed line-clamp-2">"${escapeHtml(item.hook)}"</p>
                    </div>

                    <div class="flex-1 text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed mb-2.5 bg-slate-50 dark:bg-slate-800/70 p-3 rounded-xl border border-slate-100 dark:border-slate-700/60 line-clamp-5 min-h-[5.5rem]">${escapeHtml(item.body)}</div>
                    ${item.hashtags ? `<p class="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 mb-3 truncate">${escapeHtml(item.hashtags)}</p>` : ''}
                </div>

                <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
                    <button type="button" data-action="studio" data-id="${escapeHtml(item.id)}" class="flex-1 h-9 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold shadow-sm transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> <span>Tạo Video AI</span>
                    </button>
                    <button type="button" data-action="copy-tpl" data-id="${escapeHtml(item.id)}" class="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98] text-slate-800 dark:text-slate-200 text-xs font-bold transition inline-flex items-center justify-center shrink-0 cursor-pointer" title="Copy nội dung &amp; Hashtag đăng MXH">
                        <i class="fa-regular fa-copy text-emerald-600 dark:text-emerald-400"></i>
                    </button>
                    <button type="button" data-action="schedule" data-id="${escapeHtml(item.id)}" class="h-9 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98] text-slate-800 dark:text-slate-200 text-xs font-bold transition inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer" title="Đưa vào bảng lịch đăng">
                        <i class="fa-solid fa-calendar-plus text-indigo-600 dark:text-indigo-400"></i> <span>Lên lịch</span>
                    </button>
                </div>
            `;
            fragment.appendChild(card);
        });

        grid.innerHTML = '';
        grid.appendChild(fragment);
    }

    async function handleDumpFreshScripts({ isAuto = false } = {}) {
        const btn = document.getElementById('btn-dump-scripts');
        const btnKw = document.getElementById('btn-dump-keyword');
        const autoBanner = document.getElementById('library-auto-dump-status');
        if (!btn || btn.disabled) return;

        const state = App.store.getState();

        btn.disabled = true;
        if (btnKw) btnKw.disabled = true;
        const originalHTML = btn.innerHTML;
        const originalKwHtml = btnKw ? btnKw.innerHTML : '';
        btn.innerHTML = isAuto
            ? '<i class="fa-solid fa-spinner fa-spin"></i> <span>AI đang tự động Dump...</span>'
            : '<i class="fa-solid fa-spinner fa-spin"></i> <span>AI đang sáng tạo...</span>';
        if (btnKw) {
            btnKw.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang Dump...</span>';
        }

        if (isAuto && autoBanner) {
            autoBanner.classList.remove('hidden');
            autoBanner.textContent = '✨ AI đang tự động sáng tạo 3 kịch bản mới cho bạn...';
        }

        if (dumpAbortController) dumpAbortController.abort();
        dumpAbortController = new AbortController();

        try {
            const tone = document.getElementById('library-tone')?.value || 'viral';
            const customTopic = document.getElementById('library-custom-topic')?.value.trim() || '';
            const generatedList = await App.geminiApi.dumpFreshScripts({
                existingTitles: state.templates.map((s) => s.title),
                category: state.currentCategory,
                categoryLabel: CATEGORY_BADGES[state.currentCategory]?.label,
                customTopic,
                tone,
                count: 5,
                signal: dumpAbortController.signal
            });

            if (autoBanner) autoBanner.classList.add('hidden');
            const addedCount = App.store.prependTemplates(generatedList);
            if (addedCount > 0) {
                App.toast.show(
                    isAuto
                        ? `AI đã tự động Dump thêm ${addedCount} kịch bản mới cho bạn!`
                        : `Đã thêm ${addedCount} kịch bản đời sống mới (không trùng lặp)!`
                );
            } else if (!isAuto) {
                App.toast.show('Không có kịch bản mới nào được thêm, hãy thử lại nhé!', 'info');
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (isAuto) {
                if (autoBanner && err.code === 'INVALID_API_KEY') {
                    autoBanner.classList.remove('hidden');
                    autoBanner.innerHTML =
                        '🔑 Chưa cài Gemini API Key — bấm <button type="button" id="btn-banner-open-key" class="underline font-extrabold text-indigo-600 dark:text-indigo-400 cursor-pointer">Nhập Gemini API Key</button> để AI tự tạo kịch bản &amp; video hoàn toàn thật (không dùng dữ liệu mẫu).';
                    document.getElementById('btn-banner-open-key')?.addEventListener('click', () => App.modals.openSettingsModal());
                } else if (autoBanner) {
                    autoBanner.classList.add('hidden');
                }
                console.warn('Auto-dump skipped:', err.message);
                return;
            }

            if (err.code === 'INVALID_API_KEY') {
                App.toast.show(err.message, 'error', {
                    actionLabel: 'Cài Key',
                    onAction: () => App.modals.openSettingsModal()
                });
            } else {
                App.toast.show(err.message || 'Lỗi khi Dump ý tưởng AI', 'error');
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
            if (btnKw) {
                btnKw.disabled = false;
                btnKw.innerHTML = originalKwHtml;
            }
            dumpAbortController = null;
        }
    }

    function maybeAutoDumpOnBoot() {
        const state = App.store.getState();
        if (hasAutoDumpedThisSession || !state.autoDumpOnBoot) return;
        hasAutoDumpedThisSession = true;
        handleDumpFreshScripts({ isAuto: true });
    }

    function renderDailyTrends(result) {
        const grid = document.getElementById('daily-trends-grid');
        const dateBadge = document.getElementById('daily-trends-date-badge');
        if (!grid) return;

        const items = Array.isArray(result?.items) ? result.items : [];
        cachedTrendItems = items;

        if (dateBadge) {
            if (result?.sourceType === 'gemini-search') {
                dateBadge.textContent = `${result.dateDisplay} • Google Search (Gemini Free)`;
            } else if (result?.sourceType === 'rss-gemini-free') {
                dateBadge.textContent = `${result.dateDisplay} • Google News / VnExpress + Gemini Free`;
            } else if (result?.sourceType === 'rss-free') {
                dateBadge.textContent = `${result.dateDisplay} • Google News / VnExpress (Miễn phí 0 cần Key)`;
            } else {
                dateBadge.textContent = result?.grounded
                    ? `${result.dateDisplay} • Đã đối chiếu nguồn Web`
                    : `${result?.dateDisplay || 'Hôm nay'} • Tổng hợp an toàn`;
            }
        }

        if (items.length === 0) {
            grid.innerHTML =
                '<div class="col-span-full text-xs text-slate-500 dark:text-slate-400 p-4 text-center rounded-xl bg-white/80 dark:bg-slate-900 border border-dashed border-sky-200 dark:border-slate-700">Chưa có tin nổi bật nào được trả về, bấm "Cập nhật mới" để thử lại.</div>';
            return;
        }

        const frag = document.createDocumentFragment();
        items.forEach((item, idx) => {
            const card = document.createElement('article');
            card.className =
                'min-w-0 bg-white dark:bg-slate-900 rounded-xl border border-sky-200/80 dark:border-slate-700 p-3.5 flex flex-col justify-between gap-2.5 shadow-sm card-hover';
            const badge = CATEGORY_BADGES[item.category] || CATEGORY_BADGES.lifehack;
            const safeSourcesHtml = (item.sources || [])
                .filter((s) => /^https?:\/\//i.test(s?.url || ''))
                .slice(0, 2)
                .map(
                    (s) =>
                        `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-sky-100 text-[10px] font-semibold text-sky-700 dark:text-sky-300 max-w-full truncate"><i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i><span class="truncate">${escapeHtml(s.title)}</span></a>`
                )
                .join('');

            card.innerHTML = `
                <div class="space-y-1.5 min-w-0">
                    <div class="flex items-center justify-between gap-2 flex-wrap">
                        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold border ${badge.cls}">${badge.label}</span>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            <i class="fa-solid fa-shield-check mr-0.5"></i>An toàn chính sách
                        </span>
                    </div>
                    <h4 class="font-extrabold text-sm text-slate-900 dark:text-white leading-snug">${escapeHtml(item.title)}</h4>
                    <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">${escapeHtml(item.factSummary)}</p>
                    <p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        <i class="fa-regular fa-newspaper mr-1"></i>Nguồn: ${escapeHtml(item.sourceNote || 'Tổng hợp chính thống')}
                    </p>
                    ${safeSourcesHtml ? `<div class="flex flex-wrap gap-1 pt-0.5">${safeSourcesHtml}</div>` : ''}
                </div>
                <div class="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button type="button" data-trend-action="studio" data-trend-idx="${idx}" class="flex-1 h-9 px-3 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-700 hover:to-indigo-700 text-white text-xs font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap">
                        <i class="fa-solid fa-clapperboard"></i><span>Dựng Video 2D</span>
                    </button>
                    <button type="button" data-trend-action="save" data-trend-idx="${idx}" class="h-9 px-3.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0">
                        <i class="fa-solid fa-bookmark text-amber-500"></i><span>Lưu</span>
                    </button>
                </div>
            `;
            frag.appendChild(card);
        });
        grid.innerHTML = '';
        grid.appendChild(frag);
    }

    async function handleFetchDailyTrends({ forceRefresh = false } = {}) {
        const panel = document.getElementById('daily-trends-panel');
        const btnOpen = document.getElementById('btn-fetch-daily-trends');
        const btnRefresh = document.getElementById('btn-refresh-daily-trends');
        const grid = document.getElementById('daily-trends-grid');
        const niche = document.getElementById('daily-trend-niche')?.value || 'all';
        if (panel) panel.classList.remove('hidden');

        if (trendsAbortController) trendsAbortController.abort();
        trendsAbortController = new AbortController();

        if (btnOpen) btnOpen.disabled = true;
        if (btnRefresh) btnRefresh.disabled = true;
        if (grid) {
            grid.innerHTML =
                '<div class="col-span-full p-5 text-center text-xs font-bold text-sky-800 dark:text-sky-200"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Đang tải tin nóng &amp; xu hướng mới nhất hôm nay (từ báo chí / Google Search Free)...</div>';
        }

        try {
            const res = await App.geminiApi.fetchDailyTrendsAndNews({
                niche,
                forceRefresh,
                signal: trendsAbortController.signal
            });
            renderDailyTrends(res);
            App.toast.show(`Đã cập nhật ${res.items.length} tin tức/trend mới nhất hôm nay!`);
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (err.code === 'INVALID_API_KEY') {
                if (grid) {
                    grid.innerHTML =
                        '<div class="col-span-full p-4 text-center text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded-xl">Hãy nhập Gemini API Key để cập nhật tin tức &amp; trend trực tiếp từ Google Search mỗi ngày.</div>';
                }
                App.toast.show(err.message, 'warning', {
                    actionLabel: 'Cài Key',
                    onAction: () => App.modals.openSettingsModal()
                });
            } else {
                if (grid) {
                    grid.innerHTML = `<div class="col-span-full p-4 text-center text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 rounded-xl">${escapeHtml(err.message || 'Không thể tải tin tức hôm nay.')}</div>`;
                }
                App.toast.show(err.message || 'Lỗi tải tin tức hôm nay.', 'error');
            }
        } finally {
            if (btnOpen) btnOpen.disabled = false;
            if (btnRefresh) btnRefresh.disabled = false;
            trendsAbortController = null;
        }
    }

    function init() {
        // Delegated Category Filter clicks
        document.getElementById('category-filter-bar')?.addEventListener('click', (e) => {
            const catBtn = e.target.closest('.cat-btn');
            if (catBtn && catBtn.dataset.cat) {
                App.store.setCategory(catBtn.dataset.cat);
                return;
            }
            if (e.target.closest('#btn-filter-new')) {
                const cur = App.store.getState().onlyNewTemplates;
                App.store.setOnlyNewTemplates(!cur);
            }
        });

        // Debounced Search
        const searchInput = document.getElementById('library-search');
        if (searchInput) {
            searchInput.addEventListener(
                'input',
                debounce((e) => App.store.setSearchQuery(e.target.value), 180)
            );
        }

        // Delegated Template Grid actions
        document.getElementById('template-grid')?.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const id = btn.dataset.id;

            if (action === 'studio') {
                App.videoStudio.openFromTemplate(id);
            } else if (action === 'copy-tpl') {
                const tpl = App.store.getState().templates.find((t) => t.id === id);
                if (!tpl) return;
                const scenes = [tpl.hook, ...(tpl.body || '').split('\n').map((s) => s.replace(/^[•\-]\s*/, '').trim()), tpl.cta].filter(Boolean);
                const post = App.geminiApi?.buildLocalSocialCaption
                    ? App.geminiApi.buildLocalSocialCaption({
                          title: tpl.title,
                          scenes,
                          existingHashtags: tpl.hashtags || ''
                      }).fullPost
                    : [tpl.title, tpl.hook, tpl.cta, tpl.hashtags].filter(Boolean).join('\n\n');
                copyToClipboard(post).then((ok) => {
                    if (ok) {
                        App.toast.show('Đã copy Nội dung + Hashtag! Dán ngay khi đăng Reels nhé.');
                    } else {
                        App.toast.show('Trình duyệt chặn copy tự động, hãy mở Tạo Video AI để copy.', 'warning');
                    }
                });
            } else if (action === 'schedule') {
                App.modals.openScriptModalFromTemplate(id);
            } else if (action === 'delete-tpl') {
                if (App.store.removeTemplate(id)) {
                    App.toast.show('Đã xóa ý tưởng khỏi kho.', 'info');
                }
            }
        });

        document.getElementById('library-page-controls')?.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-lib-page]');
            if (!btn || btn.disabled) return;
            const nextPage = parseInt(btn.dataset.libPage, 10);
            if (!Number.isFinite(nextPage) || nextPage === currentPage) return;
            currentPage = nextPage;
            render(true);
            document.getElementById('template-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        document.getElementById('library-page-size')?.addEventListener('change', (e) => {
            const val = parseInt(e.target.value, 10);
            if (Number.isFinite(val) && val > 0) {
                pageSize = val;
                currentPage = 1;
                render(true);
            }
        });

        document.getElementById('btn-fetch-daily-trends')?.addEventListener('click', () => handleFetchDailyTrends({ forceRefresh: false }));
        document.getElementById('btn-refresh-daily-trends')?.addEventListener('click', () => handleFetchDailyTrends({ forceRefresh: true }));
        document.getElementById('daily-trend-niche')?.addEventListener('change', () => handleFetchDailyTrends({ forceRefresh: false }));
        document.getElementById('btn-close-trends-panel')?.addEventListener('click', () => {
            document.getElementById('daily-trends-panel')?.classList.add('hidden');
        });
        document.getElementById('daily-trends-grid')?.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-trend-action]');
            if (!btn) return;
            const idx = parseInt(btn.dataset.trendIdx, 10);
            const item = cachedTrendItems[idx];
            if (!item) return;
            if (btn.dataset.trendAction === 'studio') {
                App.videoStudio.open({
                    title: item.title,
                    scenes: item.scenes,
                    hashtags: item.hashtags || ''
                });
            } else if (btn.dataset.trendAction === 'save') {
                const body = (item.scenes || []).slice(1, -1).map((s) => `• ${s}`).join('\n') || item.factSummary;
                const cta = (item.scenes || [])[item.scenes.length - 1] || 'Theo dõi để cập nhật tin mới mỗi ngày!';
                const added = App.store.prependTemplates([
                    {
                        title: item.title,
                        category: item.category || 'lifehack',
                        duration: '30s',
                        viralScore: '96%',
                        hook: item.hook || item.scenes[0] || item.title,
                        body,
                        cta,
                        hashtags: item.hashtags || '#tinnong #reelsvn'
                    }
                ]);
                if (added > 0) App.toast.show('Đã lưu kịch bản tin nóng vào Kho!');
                else App.toast.show('Kịch bản này đã có trong Kho.', 'info');
            }
        });

        document.getElementById('btn-dump-scripts')?.addEventListener('click', () => handleDumpFreshScripts({ isAuto: false }));
        document.getElementById('btn-dump-keyword')?.addEventListener('click', () => {
            const kwInput = document.getElementById('library-custom-topic');
            const kw = kwInput?.value.trim() || '';
            if (!kw) {
                App.toast.show('Hãy nhập từ khóa chủ đề muốn AI tạo kịch bản nhé!', 'warning');
                kwInput?.focus();
                return;
            }
            handleDumpFreshScripts({ isAuto: false });
        });
        document.getElementById('library-custom-topic')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('btn-dump-keyword')?.click();
            }
        });
        document.getElementById('library-niche-chips')?.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-niche]');
            if (!btn) return;
            const input = document.getElementById('library-custom-topic');
            if (input) {
                input.value = btn.dataset.niche || '';
                input.focus();
            }
            handleDumpFreshScripts({ isAuto: false });
        });
        document.getElementById('btn-clear-templates')?.addEventListener('click', () => {
            App.store.clearTemplates();
            App.toast.show('Đã xóa kho kịch bản cũ!', 'info');
        });

        App.store.subscribe('apiKey', () => {
            maybeAutoDumpOnBoot();
        });

        App.store.subscribe('templates', () => {
            isDirty = true;
            render(false);
        });

        App.store.subscribe('tab', (state) => {
            if (state.activeTab === 'library' && isDirty) {
                render(false);
            }
        });

        render(true);
        maybeAutoDumpOnBoot();
    }

    App.libraryView = { init, render, maybeAutoDumpOnBoot };
})(window);
