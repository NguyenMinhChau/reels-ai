/* ==========================================================================
   Modals, Header Progress & Settings Manager
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { GOAL_TARGETS } = App.CONFIG;
    const { formatCompactNumber, getDefaultTomorrowSchedule } = App.utils;

    function updateGoalUI() {
        const { userGoals } = App.store.getState();
        const viewPct = Math.min(100, Math.round((userGoals.views / GOAL_TARGETS.VIEWS) * 100));
        const followPct = Math.min(100, Math.round((userGoals.follows / GOAL_TARGETS.FOLLOWS) * 100));

        const viewText = document.getElementById('view-progress-text');
        const viewBar = document.getElementById('view-progress-bar');
        const followText = document.getElementById('follow-progress-text');
        const followBar = document.getElementById('follow-progress-bar');

        if (viewText) viewText.textContent = `${formatCompactNumber(userGoals.views)} / 1M (${viewPct}%)`;
        if (viewBar) viewBar.style.width = `${viewPct}%`;
        if (followText) followText.textContent = `${formatCompactNumber(userGoals.follows)} / 5K (${followPct}%)`;
        if (followBar) followBar.style.width = `${followPct}%`;
    }

    function updateApiStatusIndicator() {
        const { apiKey } = App.store.getState();
        const hasKey = Boolean(apiKey && apiKey.trim());
        const badge = document.getElementById('api-status-badge');
        const dot = document.getElementById('api-status-dot');
        const label = document.getElementById('api-status-label');
        const studioNote = document.getElementById('vs-api-mode-note');

        if (badge && dot && label) {
            if (hasKey) {
                badge.className =
                    'h-9 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 border border-emerald-200 dark:border-emerald-500/30 text-xs font-bold text-emerald-700 dark:text-emerald-300 transition inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer';
                dot.className = 'w-2 h-2 rounded-full bg-emerald-500 shrink-0';
                label.textContent = 'API Key Riêng';
            } else {
                badge.className =
                    'h-9 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer';
                dot.className = 'w-2 h-2 rounded-full bg-indigo-500 shrink-0';
                label.textContent = 'Cài API Key';
            }
        }

        if (studioNote) {
            studioNote.textContent = hasKey
                ? 'Đang kết nối Gemini API Key thật (Free Tier • có cache chống spam)'
                : 'Chưa nhập Gemini API Key — bấm "Cài API Key" ở góc trên để dán Key Free từ Google AI Studio';
            studioNote.className = hasKey
                ? 'text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold'
                : 'text-[11px] text-amber-700 dark:text-amber-300 font-semibold';
        }
    }

    // ---- Script Create/Edit Modal ----
    function openScriptModal(scriptId = null) {
        const modal = document.getElementById('script-modal');
        const titleEl = document.getElementById('modal-title');
        const form = document.getElementById('script-form');
        if (!modal || !form) return;

        form.reset();
        document.getElementById('edit-id').value = '';

        if (scriptId) {
            const existing = App.store.getState().userScripts.find((s) => s.id === scriptId);
            if (existing) {
                titleEl.textContent = 'Chỉnh sửa Kịch bản Reels';
                document.getElementById('edit-id').value = existing.id;
                document.getElementById('input-title').value = existing.title;
                document.getElementById('input-status').value = existing.status;
                document.getElementById('input-schedule').value = existing.schedule || '';
                document.getElementById('input-hashtags').value = existing.hashtags || '';
                document.getElementById('input-hook').value = existing.hook;
                document.getElementById('input-body').value = existing.body || '';
                document.getElementById('input-cta').value = existing.cta || '';
            }
        } else {
            titleEl.textContent = 'Thêm Kịch bản Mới vào Lịch';
        }
        modal.classList.remove('hidden');
        setTimeout(() => document.getElementById('input-title')?.focus(), 50);
    }

    function openScriptModalFromTemplate(templateId) {
        const tpl = App.store.getState().templates.find((t) => t.id === templateId);
        if (!tpl) return;

        openScriptModal();
        document.getElementById('modal-title').textContent = 'Lên lịch từ Kịch bản mẫu';
        document.getElementById('input-title').value = tpl.title;
        document.getElementById('input-status').value = 'scheduled';
        document.getElementById('input-hashtags').value = tpl.hashtags || '';
        document.getElementById('input-hook').value = tpl.hook;
        document.getElementById('input-body').value = tpl.body || '';
        document.getElementById('input-cta').value = tpl.cta || '';
        document.getElementById('input-schedule').value = getDefaultTomorrowSchedule(20, 0);
    }

    function closeScriptModal() {
        document.getElementById('script-modal')?.classList.add('hidden');
    }

    function handleSaveScript(e) {
        e.preventDefault();
        const id = document.getElementById('edit-id').value;
        const data = {
            id: id || 'user-' + Date.now(),
            title: document.getElementById('input-title').value.trim(),
            status: document.getElementById('input-status').value,
            schedule: document.getElementById('input-schedule').value,
            hashtags: document.getElementById('input-hashtags').value.trim(),
            hook: document.getElementById('input-hook').value.trim(),
            body: document.getElementById('input-body').value.trim(),
            cta: document.getElementById('input-cta').value.trim()
        };

        const isUpdate = App.store.upsertUserScript(data);
        closeScriptModal();
        App.toast.show(isUpdate ? 'Đã cập nhật kịch bản trong lịch!' : 'Đã thêm kịch bản mới vào Lịch Đăng!');
        App.router.switchTab('planner');
    }

    // ---- Goal Modal ----
    function openGoalModal() {
        const { userGoals } = App.store.getState();
        document.getElementById('input-current-views').value = userGoals.views;
        document.getElementById('input-current-follows').value = userGoals.follows;
        document.getElementById('goal-modal')?.classList.remove('hidden');
    }

    function closeGoalModal() {
        document.getElementById('goal-modal')?.classList.add('hidden');
    }

    function handleSaveGoals(e) {
        e.preventDefault();
        const views = document.getElementById('input-current-views').value;
        const follows = document.getElementById('input-current-follows').value;
        App.store.updateGoals(views, follows);
        closeGoalModal();
        App.toast.show('Đã cập nhật chỉ số tiến độ kiếm tiền!');
    }

    // ---- Settings / API Key / Backup Modal ----
    function openSettingsModal() {
        const state = App.store.getState();
        const input = document.getElementById('input-gemini-api-key');
        if (input) {
            input.value = state.apiKey || '';
            input.type = 'password';
        }
        const autoDumpToggle = document.getElementById('toggle-auto-dump-boot');
        if (autoDumpToggle) {
            autoDumpToggle.checked = Boolean(state.autoDumpOnBoot);
        }
        const modelSel = document.getElementById('setting-text-model');
        if (modelSel) {
            modelSel.value = state.textModel || 'auto';
        }
        const toggleIcon = document.getElementById('icon-toggle-api-key');
        if (toggleIcon) toggleIcon.className = 'fa-regular fa-eye';
        document.getElementById('settings-modal')?.classList.remove('hidden');
    }

    function closeSettingsModal() {
        document.getElementById('settings-modal')?.classList.add('hidden');
    }

    function handleSaveApiKey(e) {
        e.preventDefault();
        const key = document.getElementById('input-gemini-api-key')?.value || '';
        const textModel = document.getElementById('setting-text-model')?.value || 'auto';
        const autoDumpToggle = document.getElementById('toggle-auto-dump-boot');
        if (autoDumpToggle) {
            App.store.setAutoDumpOnBoot(autoDumpToggle.checked);
        }
        App.store.setTextModel(textModel);
        App.store.setApiKey(key);
        App.geminiApi.clearMediaCaches();
        closeSettingsModal();
        App.toast.show(key.trim() ? `Đã lưu Gemini API Key (Model: ${textModel === 'auto' ? 'Tự động tối ưu' : textModel})!` : 'Đã xóa API Key.');
        if (key.trim() && App.store.getState().autoDumpOnBoot && App.libraryView?.maybeAutoDumpOnBoot) {
            App.libraryView.maybeAutoDumpOnBoot();
        }
    }

    async function handleTestApiKey() {
        const btn = document.getElementById('btn-test-api-key');
        const key = document.getElementById('input-gemini-api-key')?.value || '';
        const modelSel = document.getElementById('setting-text-model');
        const statusEl = document.getElementById('setting-models-status');
        if (!btn || btn.disabled) return;

        btn.disabled = true;
        const prevHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang quét Key &amp; Model...</span>';

        try {
            const preferred = modelSel?.value || 'auto';
            App.store.setTextModel(preferred);
            const res = await App.geminiApi.testApiKey(key);
            App.store.setApiKey(key);

            if (modelSel && Array.isArray(res?.discoveredModels) && res.discoveredModels.length > 0) {
                const existingValues = new Set(Array.from(modelSel.options).map((o) => o.value));
                res.discoveredModels.slice(0, 10).forEach((mId) => {
                    if (!existingValues.has(mId)) {
                        const opt = document.createElement('option');
                        opt.value = mId;
                        opt.textContent = `🆓 ${mId} (Khả dụng trên Key)`;
                        modelSel.appendChild(opt);
                    }
                });
            }
            if (statusEl) {
                const active = res?.activeModel || 'Gemini';
                const totalFound = res?.discoveredModels?.length || 0;
                statusEl.textContent = totalFound > 0
                    ? `Hoạt động: ${active} (${totalFound} model Free)`
                    : `Hoạt động tốt: ${active}`;
            }
            App.toast.show(`Kết nối thành công! Model đang chạy: ${res?.activeModel || 'Gemini Free'}.`, 'success');
        } catch (err) {
            if (statusEl) statusEl.textContent = 'Lỗi kết nối Key';
            App.toast.show(err.message || 'API Key chưa hợp lệ.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = prevHtml;
        }
    }

    function handleToggleApiKeyVisibility() {
        const input = document.getElementById('input-gemini-api-key');
        const icon = document.getElementById('icon-toggle-api-key');
        if (!input || !icon) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        icon.className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    }

    function handleExportBackup() {
        const data = App.store.exportBackup();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reels-studio-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        App.toast.show('Đã tải xuống file sao lưu dữ liệu!');
    }

    function handleImportBackup(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const parsed = JSON.parse(ev.target.result);
                App.store.importBackup(parsed);
                App.toast.show('Khôi phục dữ liệu thành công!');
                closeSettingsModal();
            } catch (err) {
                App.toast.show('File sao lưu không hợp lệ: ' + err.message, 'error');
            } finally {
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    }

    function init() {
        document.getElementById('script-form')?.addEventListener('submit', handleSaveScript);
        document.getElementById('goal-form')?.addEventListener('submit', handleSaveGoals);
        document.getElementById('settings-form')?.addEventListener('submit', handleSaveApiKey);

        document.getElementById('btn-open-goal-mobile')?.addEventListener('click', openGoalModal);
        document.getElementById('btn-open-goal-desktop')?.addEventListener('click', openGoalModal);
        document.getElementById('btn-open-settings')?.addEventListener('click', openSettingsModal);
        document.getElementById('api-status-badge')?.addEventListener('click', openSettingsModal);
        document.getElementById('btn-new-script')?.addEventListener('click', () => openScriptModal());

        document.getElementById('btn-test-api-key')?.addEventListener('click', handleTestApiKey);
        document.getElementById('btn-toggle-api-key')?.addEventListener('click', handleToggleApiKeyVisibility);
        document.getElementById('btn-clear-api-key')?.addEventListener('click', () => {
            const input = document.getElementById('input-gemini-api-key');
            if (input) input.value = '';
            App.store.setApiKey('');
            App.geminiApi.clearMediaCaches();
            App.toast.show('Đã xóa API Key.', 'info');
        });

        document.getElementById('btn-export-backup')?.addEventListener('click', handleExportBackup);
        document.getElementById('input-import-backup')?.addEventListener('change', handleImportBackup);
        document.getElementById('btn-reset-templates')?.addEventListener('click', () => {
            App.store.clearTemplates();
            App.toast.show('Đã xóa sạch kho kịch bản — sẵn sàng để AI tạo mới hoàn toàn!', 'info');
        });

        // Close buttons & backdrop click
        document.querySelectorAll('[data-close-modal]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const target = btn.getAttribute('data-close-modal');
                if (target === 'script-modal') closeScriptModal();
                else if (target === 'goal-modal') closeGoalModal();
                else if (target === 'settings-modal') closeSettingsModal();
                else if (target === 'series-modal') App.seriesModal?.close();
                else if (target === 'video-studio-modal') App.videoStudio.close();
            });
        });

        ['script-modal', 'goal-modal', 'settings-modal', 'series-modal', 'video-studio-modal'].forEach((id) => {
            const el = document.getElementById(id);
            el?.addEventListener('click', (e) => {
                if (e.target !== el) return;
                if (id === 'video-studio-modal') App.videoStudio.close();
                else if (id === 'series-modal') App.seriesModal?.close();
                else el.classList.add('hidden');
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!document.getElementById('video-studio-modal')?.classList.contains('hidden')) {
                App.videoStudio.close();
            } else if (!document.getElementById('series-modal')?.classList.contains('hidden')) {
                App.seriesModal?.close();
            } else if (!document.getElementById('settings-modal')?.classList.contains('hidden')) {
                closeSettingsModal();
            } else if (!document.getElementById('script-modal')?.classList.contains('hidden')) {
                closeScriptModal();
            } else if (!document.getElementById('goal-modal')?.classList.contains('hidden')) {
                closeGoalModal();
            }
        });

        App.store.subscribe('goals', updateGoalUI);
        App.store.subscribe('apiKey', updateApiStatusIndicator);

        updateGoalUI();
        updateApiStatusIndicator();
    }

    App.modals = {
        init,
        openScriptModal,
        openScriptModalFromTemplate,
        closeScriptModal,
        openGoalModal,
        openSettingsModal
    };
})(window);
