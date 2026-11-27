/* ==========================================================================
   Planner View — 3-Column Kanban (Desktop) + Mobile Column Tabs + Drag & Drop
   - Dirty-flag guarded (only renders when planner is visible & data changed)
   - Delegated click & drag events
   - Delete with Undo Toast
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { escapeHtml, formatDateTimeVN, copyToClipboard, addDaysToSchedule, getDefaultTomorrowSchedule } = App.utils;

    let isDirty = true;
    let draggedScriptId = null;

    function updateBadgeCount(total) {
        const badge = document.getElementById('planner-badge');
        if (badge) badge.textContent = total;
    }

    function updateMobileColumnVisibility(activeStatus) {
        const colWrappers = {
            idea: document.getElementById('planner-col-wrap-idea'),
            scheduled: document.getElementById('planner-col-wrap-scheduled'),
            published: document.getElementById('planner-col-wrap-published')
        };

        Object.entries(colWrappers).forEach(([status, el]) => {
            if (!el) return;
            if (status === activeStatus) {
                el.classList.remove('hidden', 'lg:flex');
                el.classList.add('flex');
            } else {
                el.classList.add('hidden', 'lg:flex');
            }
        });

        document.querySelectorAll('.mobile-planner-tab').forEach((btn) => {
            const isActive = btn.dataset.status === activeStatus;
            btn.className = isActive
                ? 'mobile-planner-tab px-3 py-2 rounded-xl text-xs font-extrabold bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-300 shadow-sm transition cursor-pointer flex items-center justify-center gap-1.5'
                : 'mobile-planner-tab px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 transition cursor-pointer flex items-center justify-center gap-1.5';
        });
    }

    function createCardElement(script, status) {
        const dateLabel = formatDateTimeVN(script.schedule);
        const card = document.createElement('div');
        card.className =
            'min-w-0 kanban-card bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-sm space-y-2.5 cursor-grab active:cursor-grabbing';
        card.draggable = true;
        card.dataset.scriptId = script.id;

        const moveControls =
            status === 'idea'
                ? `<button type="button" data-action="move" data-next="scheduled" data-id="${escapeHtml(script.id)}" class="px-2.5 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold transition cursor-pointer">Đặt lịch →</button>`
                : status === 'scheduled'
                    ? `<div class="flex items-center gap-1">
                         <button type="button" data-action="move" data-next="idea" data-id="${escapeHtml(script.id)}" class="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 text-[11px] font-bold transition cursor-pointer" title="Trả về Ý tưởng">←</button>
                         <button type="button" data-action="move" data-next="published" data-id="${escapeHtml(script.id)}" class="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/15 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold transition cursor-pointer">Đã đăng ✓</button>
                       </div>`
                    : `<span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><i class="fa-solid fa-check-double"></i>Hoàn tất</span>`;

        const seriesBadge = script.episodeNumber
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30"><i class="fa-solid fa-layer-group"></i>Tập ${script.episodeNumber}${script.totalEpisodes ? '/' + script.totalEpisodes : ''}</span>`
            : '';

        const sceneBadge = Array.isArray(script.scenes) && script.scenes.length > 0
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">${script.scenes.length} cảnh</span>`
            : '';

        card.innerHTML = `
            <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 space-y-1">
                    ${seriesBadge || sceneBadge ? `<div class="flex items-center gap-1 flex-wrap">${seriesBadge}${sceneBadge}</div>` : ''}
                    <h4 class="font-bold text-sm text-slate-900 dark:text-slate-100 leading-snug">${escapeHtml(script.title)}</h4>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" data-action="edit" data-id="${escapeHtml(script.id)}" class="w-7 h-7 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-indigo-600 dark:text-slate-400 flex items-center justify-center transition cursor-pointer" title="Chỉnh sửa">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button type="button" data-action="delete" data-id="${escapeHtml(script.id)}" class="w-7 h-7 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/15 text-slate-400 hover:text-rose-600 flex items-center justify-center transition cursor-pointer" title="Xóa">
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>
                </div>
            </div>

            <p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 bg-slate-50 dark:bg-slate-800/70 p-2 rounded-xl border border-slate-100 dark:border-slate-700/60">"${escapeHtml(script.hook)}"</p>

            ${script.cliffhanger ? `<p class="text-[11px] font-semibold text-rose-600 dark:text-rose-400 line-clamp-1">🔗 ${escapeHtml(script.cliffhanger)}</p>` : ''}

            <div class="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span><i class="fa-regular fa-clock mr-1 text-indigo-500"></i>${escapeHtml(dateLabel)}</span>
            </div>

            <div class="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1.5 flex-wrap">
                <div class="flex items-center gap-1 flex-wrap">
                    <button type="button" data-action="studio" data-id="${escapeHtml(script.id)}" class="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold transition flex items-center gap-1 cursor-pointer">
                        <i class="fa-solid fa-film"></i> Video AI
                    </button>
                    <button type="button" data-action="sequel" data-id="${escapeHtml(script.id)}" class="px-2 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-500/20 hover:bg-amber-200 text-amber-900 dark:text-amber-300 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer disabled:opacity-60" title="AI viết tiếp tập kế nối mạch chuyện">
                        <i class="fa-solid fa-forward-step"></i> + Tập tiếp
                    </button>
                    <button type="button" data-action="copy" data-id="${escapeHtml(script.id)}" class="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer" title="Copy Caption & Hashtag">
                        <i class="fa-regular fa-copy"></i>
                    </button>
                </div>
                ${moveControls}
            </div>
        `;
        return card;
    }

    function render(force = false) {
        const state = App.store.getState();
        updateBadgeCount(state.userScripts.length);
        updateMobileColumnVisibility(state.mobilePlannerStatus);

        if (state.activeTab !== 'planner' && !force) {
            isDirty = true;
            return;
        }
        isDirty = false;

        const cols = {
            idea: document.getElementById('col-idea'),
            scheduled: document.getElementById('col-scheduled'),
            published: document.getElementById('col-published')
        };

        const fragments = {
            idea: document.createDocumentFragment(),
            scheduled: document.createDocumentFragment(),
            published: document.createDocumentFragment()
        };

        const counts = { idea: 0, scheduled: 0, published: 0 };

        state.userScripts.forEach((script) => {
            const st = script.status || 'idea';
            if (!cols[st]) return;
            counts[st]++;
            fragments[st].appendChild(createCardElement(script, st));
        });

        Object.keys(cols).forEach((k) => {
            const colEl = cols[k];
            if (!colEl) return;
            colEl.innerHTML = '';

            if (counts[k] === 0) {
                colEl.innerHTML =
                    '<div class="text-center py-8 px-3 text-xs text-slate-400 dark:text-slate-500 border border-dashed border-slate-300/80 dark:border-slate-700 rounded-xl">Chưa có kịch bản nào ở mục này</div>';
            } else {
                colEl.appendChild(fragments[k]);
            }

            const countEl = document.getElementById(`count-${k}`);
            if (countEl) countEl.textContent = counts[k];
            const mobileCountEl = document.getElementById(`mobile-count-${k}`);
            if (mobileCountEl) mobileCountEl.textContent = counts[k];
        });
    }

    async function handleCopyCaption(id) {
        const item = App.store.getState().userScripts.find((s) => s.id === id);
        if (!item) return;
        const captionText = [item.hook, item.cta, item.hashtags].filter(Boolean).join('\n\n');
        const ok = await copyToClipboard(captionText);
        if (ok) {
            App.toast.show('Đã copy Caption + Hashtag! Dán ngay khi đăng Reels nhé.');
        } else {
            App.toast.show('Trình duyệt chặn copy tự động, hãy chọn và copy thủ công.', 'warning');
        }
    }

    function handleDeleteScript(id) {
        const removed = App.store.deleteUserScript(id);
        if (!removed) return;
        App.toast.show('Đã xóa kịch bản khỏi lịch.', 'info', {
            actionLabel: 'Hoàn tác',
            onAction: () => {
                App.store.restoreUserScript(removed.item, removed.index);
                App.toast.show('Đã khôi phục kịch bản!');
            }
        });
    }

    async function handleGenerateSequel(scriptId, btn) {
        const state = App.store.getState();
        const origin = state.userScripts.find((s) => s.id === scriptId);
        if (!origin || !btn || btn.disabled) return;

        const seriesId = origin.seriesId || `series-${origin.id}`;
        const seriesTitle = origin.seriesTitle || origin.title;
        let previousEpisodes = state.userScripts.filter((s) => s.seriesId === seriesId);
        if (previousEpisodes.length === 0) {
            previousEpisodes = [origin];
        } else {
            previousEpisodes.sort((a, b) => (a.episodeNumber || 1) - (b.episodeNumber || 1));
        }

        const latestEp = previousEpisodes[previousEpisodes.length - 1];
        const nextSchedule = addDaysToSchedule(latestEp.schedule || getDefaultTomorrowSchedule(20, 0), 1);

        btn.disabled = true;
        const prevHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang viết...</span>';

        try {
            const ep = await App.geminiApi.generateNextSeriesEpisode({
                seriesTitle,
                previousEpisodes,
                scenesPerEp: Array.isArray(origin.scenes) && origin.scenes.length >= 6 ? origin.scenes.length : 8,
                tone: document.getElementById('vs-tone')?.value || 'viral'
            });

            // Tag origin into the same series if it started as a standalone script
            if (!origin.seriesId) {
                App.store.upsertUserScript({
                    ...origin,
                    seriesId,
                    seriesTitle,
                    episodeNumber: 1,
                    totalEpisodes: ep.episodeNumber
                });
            }

            const epScenes = ep.scenes && ep.scenes.length > 0 ? ep.scenes : [ep.hook, ep.cta];
            const middleScenes = epScenes.length > 2 ? epScenes.slice(1, -1) : epScenes;
            const newId = `${seriesId}-ep-${ep.episodeNumber}-${Date.now()}`;

            App.store.upsertUserScript({
                id: newId,
                seriesId,
                seriesTitle,
                episodeNumber: ep.episodeNumber,
                totalEpisodes: ep.episodeNumber,
                cliffhanger: ep.cliffhanger || '',
                title: ep.title,
                status: 'scheduled',
                schedule: nextSchedule,
                hook: ep.hook || epScenes[0] || '',
                body: middleScenes.map((s) => `• ${s}`).join('\n'),
                cta: ep.cta || '',
                scenes: epScenes,
                hashtags: ep.hashtags || origin.hashtags || '#seri #reelsvn'
            });

            App.toast.show(`Đã viết tiếp Tập ${ep.episodeNumber} nối mạch Seri!`, 'success', {
                actionLabel: 'Quay Video',
                onAction: () => App.videoStudio.openFromUserScript(newId),
                duration: 6000
            });
        } catch (err) {
            App.toast.show(err.message || 'Không thể tạo tập tiếp theo.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = prevHtml;
        }
    }

    function init() {
        const board = document.getElementById('planner-board');
        if (board) {
            // Delegated clicks on Kanban cards
            board.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-action]');
                if (!btn) return;
                const action = btn.dataset.action;
                const id = btn.dataset.id;

                if (action === 'edit') {
                    App.modals.openScriptModal(id);
                } else if (action === 'delete') {
                    handleDeleteScript(id);
                } else if (action === 'studio') {
                    App.videoStudio.openFromUserScript(id);
                } else if (action === 'sequel') {
                    handleGenerateSequel(id, btn);
                } else if (action === 'copy') {
                    handleCopyCaption(id);
                } else if (action === 'move') {
                    const nextStatus = btn.dataset.next;
                    if (App.store.moveScriptStatus(id, nextStatus)) {
                        const msg =
                            nextStatus === 'published'
                                ? 'Chúc mừng! Đã đánh dấu video đã đăng.'
                                : nextStatus === 'scheduled'
                                    ? 'Đã chuyển sang mục Sẵn sàng / Đặt lịch!'
                                    : 'Đã đưa về mục Ý tưởng.';
                        App.toast.show(msg);
                    }
                }
            });

            // Smooth HTML5 Drag & Drop across Kanban columns
            board.addEventListener('dragstart', (e) => {
                const card = e.target.closest('.kanban-card');
                if (!card) return;
                draggedScriptId = card.dataset.scriptId;
                card.classList.add('is-dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', draggedScriptId);
                }
            });

            board.addEventListener('dragend', (e) => {
                const card = e.target.closest('.kanban-card');
                if (card) card.classList.remove('is-dragging');
                draggedScriptId = null;
                board.querySelectorAll('.kanban-dropzone').forEach((z) => z.classList.remove('is-drag-over'));
            });

            board.addEventListener('dragover', (e) => {
                const zone = e.target.closest('.kanban-dropzone');
                if (!zone || !draggedScriptId) return;
                e.preventDefault();
                zone.classList.add('is-drag-over');
            });

            board.addEventListener('dragleave', (e) => {
                const zone = e.target.closest('.kanban-dropzone');
                if (!zone) return;
                if (!zone.contains(e.relatedTarget)) {
                    zone.classList.remove('is-drag-over');
                }
            });

            board.addEventListener('drop', (e) => {
                const zone = e.target.closest('.kanban-dropzone');
                if (!zone || !draggedScriptId) return;
                e.preventDefault();
                zone.classList.remove('is-drag-over');
                const targetStatus = zone.dataset.status;
                if (targetStatus && App.store.moveScriptStatus(draggedScriptId, targetStatus)) {
                    App.toast.show('Đã chuyển trạng thái kịch bản!');
                }
            });
        }

        // Mobile Planner Status Switcher
        document.getElementById('mobile-planner-tabs')?.addEventListener('click', (e) => {
            const tab = e.target.closest('.mobile-planner-tab');
            if (!tab || !tab.dataset.status) return;
            App.store.setMobilePlannerStatus(tab.dataset.status);
        });

        App.store.subscribe('scripts', () => {
            isDirty = true;
            render(false);
        });

        App.store.subscribe('tab', (state) => {
            if (state.activeTab === 'planner' && isDirty) {
                render(false);
            }
        });

        render(true);
    }

    App.plannerView = { init, render };
})(window);
