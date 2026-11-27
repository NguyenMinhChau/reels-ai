/* ==========================================================================
   Application Bootstrap, Tab Router & Theme Manager
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});

    const TABS = ['library', 'planner', 'guide'];

    function applyTheme(theme) {
        const isDark = theme === 'dark';
        document.documentElement.classList.toggle('dark', isDark);
        const icon = document.getElementById('theme-toggle-icon');
        if (icon) {
            icon.className = isDark ? 'fa-solid fa-sun text-amber-400' : 'fa-solid fa-moon text-slate-600';
        }
    }

    function applyTabUI(tabName) {
        TABS.forEach((t) => {
            const view = document.getElementById(`view-${t}`);
            const btn = document.getElementById(`tab-btn-${t}`);
            const isActive = t === tabName;
            if (view) view.classList.toggle('hidden', !isActive);
            if (btn) {
                btn.classList.toggle('bg-white', isActive);
                btn.classList.toggle('dark:bg-slate-800', isActive);
                btn.classList.toggle('text-indigo-600', isActive);
                btn.classList.toggle('dark:text-indigo-300', isActive);
                btn.classList.toggle('shadow-sm', isActive);
                btn.classList.toggle('text-slate-600', !isActive);
                btn.classList.toggle('dark:text-slate-400', !isActive);
            }
        });
    }

    function switchTab(tabName) {
        if (!TABS.includes(tabName)) return;
        App.store.setActiveTab(tabName);
    }

    function init() {
        // Theme setup
        applyTheme(App.store.getState().theme);
        App.store.subscribe('theme', (state) => applyTheme(state.theme));

        document.getElementById('btn-toggle-theme')?.addEventListener('click', () => {
            const next = App.store.getState().theme === 'dark' ? 'light' : 'dark';
            App.store.setTheme(next);
        });

        // Tab routing
        document.getElementById('main-tab-nav')?.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-tab]');
            if (btn) switchTab(btn.dataset.tab);
        });

        App.store.subscribe('tab', (state) => applyTabUI(state.activeTab));
        applyTabUI(App.store.getState().activeTab);

        // Initialize UI Modules
        App.modals.init();
        App.libraryView.init();
        App.plannerView.init();
        App.videoStudio.init();
    }

    App.router = { switchTab };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window);
