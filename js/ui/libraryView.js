/* ==========================================================================
   Library View — Template Grid, Search, Category Filter & AI Idea Dump
   - Uses DocumentFragment & event delegation (no inline onclick)
   - Skips redundant re-renders via signature check & dirty flag
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { CATEGORY_BADGES } = App.CONFIG;
    const { escapeHtml, debounce } = App.utils;

    let isDirty = true;
    let lastSignature = '';
    let dumpAbortController = null;
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
                ? 'cat-btn active shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-900 dark:bg-indigo-600 text-white transition cursor-pointer'
                : 'cat-btn shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer';
        });

        const newToggle = document.getElementById('btn-filter-new');
        if (newToggle) {
            newToggle.className = state.onlyNewTemplates
                ? 'shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 text-white transition cursor-pointer flex items-center gap-1'
                : 'shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-500/30 hover:bg-amber-100 transition cursor-pointer flex items-center gap-1';
        }
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

        const filtered = getFilteredTemplates(state);
        const signature = `${state.currentCategory}|${state.searchQuery}|${state.onlyNewTemplates}|${filtered.map((i) => i.id).join(',')}`;

        if (!force && !isDirty && signature === lastSignature) {
            return;
        }
        isDirty = false;
        lastSignature = signature;

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center space-y-3">
                    <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center text-xl">
                        <i class="fa-solid fa-magnifying-glass"></i>
                    </div>
                    <p class="text-sm font-bold text-slate-700 dark:text-slate-200">Không tìm thấy kịch bản phù hợp</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">Thử từ khóa khác hoặc bấm "Dump Thêm 3 Ý Tưởng Mới" để AI gợi ý nhé.</p>
                </div>
            `;
            return;
        }

        const fragment = document.createDocumentFragment();

        filtered.forEach((item) => {
            const badge = CATEGORY_BADGES[item.category] || CATEGORY_BADGES.lifehack;
            const card = document.createElement('article');
            card.className =
                'min-w-0 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 flex flex-col justify-between card-hover shadow-sm';
            card.dataset.templateId = item.id;

            const newBadgeHtml = item.isNew
                ? '<span class="px-2 py-0.5 text-[10px] font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full shadow-sm">MỚI</span>'
                : '';

            const deleteBtnHtml = item.isNew
                ? `<button type="button" data-action="delete-tpl" data-id="${escapeHtml(item.id)}" class="w-7 h-7 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/15 text-slate-400 hover:text-rose-600 flex items-center justify-center transition cursor-pointer" title="Xóa ý tưởng này"><i class="fa-solid fa-trash text-xs"></i></button>`
                : '';

            card.innerHTML = `
                <div>
                    <div class="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
                        <div class="flex items-center gap-1.5">
                            <span class="px-2.5 py-1 rounded-lg text-[11px] font-bold border ${badge.cls}">${badge.label}</span>
                            ${newBadgeHtml}
                        </div>
                        <div class="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                            <span><i class="fa-regular fa-clock mr-1"></i>${escapeHtml(item.duration)}</span>
                            <span class="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 rounded-md"><i class="fa-solid fa-fire mr-0.5"></i>${escapeHtml(item.viralScore)}</span>
                            ${deleteBtnHtml}
                        </div>
                    </div>

                    <h3 class="font-extrabold text-slate-900 dark:text-slate-100 text-base mb-2.5 leading-snug">${escapeHtml(item.title)}</h3>

                    <div class="bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-500/25 rounded-xl p-2.5 mb-2.5">
                        <span class="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-300 block mb-0.5">⚡ Hook 3s đầu:</span>
                        <p class="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-relaxed">"${escapeHtml(item.hook)}"</p>
                    </div>

                    <div class="text-xs text-slate-600 dark:text-slate-300 space-y-1 whitespace-pre-line leading-relaxed mb-3 bg-slate-50 dark:bg-slate-800/70 p-3 rounded-xl border border-slate-100 dark:border-slate-700/60">${escapeHtml(item.body)}</div>
                </div>

                <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
                    <button type="button" data-action="studio" data-id="${escapeHtml(item.id)}" class="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> <span>Tạo Video AI</span>
                    </button>
                    <button type="button" data-action="schedule" data-id="${escapeHtml(item.id)}" class="py-2.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98] text-slate-800 dark:text-slate-200 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer" title="Đưa vào bảng lịch đăng">
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
        const autoBanner = document.getElementById('library-auto-dump-status');
        if (!btn || btn.disabled) return;

        const state = App.store.getState();

        btn.disabled = true;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = isAuto
            ? '<i class="fa-solid fa-spinner fa-spin"></i> <span>AI đang tự động Dump...</span>'
            : '<i class="fa-solid fa-spinner fa-spin"></i> <span>AI đang sáng tạo...</span>';

        if (isAuto && autoBanner) {
            autoBanner.classList.remove('hidden');
            autoBanner.textContent = '✨ AI đang tự động sáng tạo 3 kịch bản mới cho bạn...';
        }

        if (dumpAbortController) dumpAbortController.abort();
        dumpAbortController = new AbortController();

        try {
            const tone = document.getElementById('library-tone')?.value || 'viral';
            const generatedList = await App.geminiApi.dumpFreshScripts({
                existingTitles: state.templates.map((s) => s.title),
                category: state.currentCategory,
                categoryLabel: CATEGORY_BADGES[state.currentCategory]?.label,
                tone,
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
                        '🔄 Đang luân phiên kho 30 mẫu mỗi lần F5. <button type="button" id="btn-banner-open-key" class="underline font-extrabold text-indigo-600 dark:text-indigo-400 cursor-pointer">Nhập Gemini API Key</button> nếu muốn AI tự tạo thêm kịch bản.';
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
            dumpAbortController = null;
        }
    }

    function maybeAutoDumpOnBoot() {
        const state = App.store.getState();
        if (hasAutoDumpedThisSession || !state.autoDumpOnBoot) return;
        hasAutoDumpedThisSession = true;
        handleDumpFreshScripts({ isAuto: true });
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
            } else if (action === 'schedule') {
                App.modals.openScriptModalFromTemplate(id);
            } else if (action === 'delete-tpl') {
                if (App.store.removeTemplate(id)) {
                    App.toast.show('Đã xóa ý tưởng khỏi kho.', 'info');
                }
            }
        });

        document.getElementById('btn-dump-scripts')?.addEventListener('click', () => handleDumpFreshScripts({ isAuto: false }));
        document.getElementById('btn-shuffle-topics')?.addEventListener('click', () => {
            App.store.rotateCuratedTemplates();
            App.toast.show('Đã làm mới danh sách chủ đề lên đầu trang!');
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
