/* ==========================================================================
   Centralized Reactive-Lite State Store (Targeted Subscriptions, No Extra Re-renders)
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const { STORAGE_KEYS, MAX_TEMPLATES } = App.CONFIG;
    const { safeStorage } = App.utils;

    function loadInitialTemplates() {
        const saved = safeStorage.get(STORAGE_KEYS.TEMPLATES, null);
        if (!Array.isArray(saved)) return [];
        return saved.filter((t) => t && t.title && t.hook).slice(0, MAX_TEMPLATES || 120);
    }

    function loadInitialScripts() {
        const saved = safeStorage.get(STORAGE_KEYS.SCRIPTS, null);
        return Array.isArray(saved) ? saved : [];
    }

    function loadInitialGoals() {
        const saved = safeStorage.get(STORAGE_KEYS.GOALS, null);
        if (saved && typeof saved === 'object') {
            return {
                views: Math.max(0, Number(saved.views) || 0),
                follows: Math.max(0, Number(saved.follows) || 0)
            };
        }
        return { views: 0, follows: 0 };
    }

    const state = {
        templates: loadInitialTemplates(),
        userScripts: loadInitialScripts(),
        userGoals: loadInitialGoals(),
        activeTab: 'library',
        currentCategory: 'all',
        searchQuery: '',
        onlyNewTemplates: false,
        mobilePlannerStatus: 'idea',
        apiKey: safeStorage.getRaw(STORAGE_KEYS.API_KEY, '').trim(),
        theme: safeStorage.getRaw(STORAGE_KEYS.THEME, 'light'),
        autoDumpOnBoot: safeStorage.get(STORAGE_KEYS.AUTO_DUMP_ON_BOOT, true) !== false
    };

    const subscribers = {
        templates: new Set(),
        scripts: new Set(),
        goals: new Set(),
        tab: new Set(),
        apiKey: new Set(),
        theme: new Set()
    };

    function notify(channel) {
        const listeners = subscribers[channel];
        if (!listeners) return;
        listeners.forEach((fn) => {
            try {
                fn(state);
            } catch (e) {
                console.error(`Store listener error [${channel}]:`, e);
            }
        });
    }

    const store = {
        getState() {
            return state;
        },

        subscribe(channel, fn) {
            if (!subscribers[channel]) return () => {};
            subscribers[channel].add(fn);
            return () => subscribers[channel].delete(fn);
        },

        setActiveTab(tabName) {
            if (state.activeTab === tabName) return;
            state.activeTab = tabName;
            notify('tab');
        },

        setCategory(cat) {
            if (state.currentCategory === cat) return;
            state.currentCategory = cat;
            notify('templates');
        },

        setSearchQuery(q) {
            const next = String(q || '').trim().toLowerCase();
            if (state.searchQuery === next) return;
            state.searchQuery = next;
            notify('templates');
        },

        setOnlyNewTemplates(flag) {
            const next = Boolean(flag);
            if (state.onlyNewTemplates === next) return;
            state.onlyNewTemplates = next;
            notify('templates');
        },

        setMobilePlannerStatus(status) {
            if (state.mobilePlannerStatus === status) return;
            state.mobilePlannerStatus = status;
            notify('scripts');
        },

        prependTemplates(newItems) {
            if (!Array.isArray(newItems) || newItems.length === 0) return 0;
            const existingTitles = new Set(state.templates.map((t) => t.title.trim().toLowerCase()));
            const validCategories = ['office', 'career', 'finance', 'humor', 'lifehack', 'warning', 'reminder', 'music', 'vlog', 'bts'];
            const toAdd = [];

            newItems.forEach((item, idx) => {
                const title = (item.title || '').trim();
                const hook = (item.hook || '').trim();
                if (!title || !hook || existingTitles.has(title.toLowerCase())) return;
                existingTitles.add(title.toLowerCase());

                const safeCat = validCategories.includes(item.category)
                    ? item.category
                    : state.currentCategory !== 'all'
                        ? state.currentCategory
                        : 'lifehack';

                toAdd.push({
                    id: `tpl-ai-${Date.now()}-${idx}`,
                    category: safeCat,
                    title,
                    duration: item.duration || '25s',
                    viralScore: item.viralScore || '96%',
                    hook,
                    body: (item.body || '').trim(),
                    cta: (item.cta || '').trim(),
                    hashtags: (item.hashtags || '').trim(),
                    isNew: true
                });
            });

            if (toAdd.length === 0) return 0;
            state.templates = [...toAdd, ...state.templates].slice(0, MAX_TEMPLATES || 60);
            safeStorage.set(STORAGE_KEYS.TEMPLATES, state.templates);
            notify('templates');
            return toAdd.length;
        },

        removeTemplate(id) {
            const prevLen = state.templates.length;
            state.templates = state.templates.filter((t) => t.id !== id);
            if (state.templates.length === prevLen) return false;
            safeStorage.set(STORAGE_KEYS.TEMPLATES, state.templates);
            notify('templates');
            return true;
        },

        clearTemplates() {
            state.templates = [];
            state.currentCategory = 'all';
            state.searchQuery = '';
            state.onlyNewTemplates = false;
            safeStorage.set(STORAGE_KEYS.TEMPLATES, []);
            notify('templates');
        },

        upsertUserScript(data) {
            const idx = state.userScripts.findIndex((s) => s.id === data.id);
            const isUpdate = idx !== -1;
            if (isUpdate) {
                state.userScripts[idx] = data;
            } else {
                state.userScripts.unshift(data);
            }
            safeStorage.set(STORAGE_KEYS.SCRIPTS, state.userScripts);
            notify('scripts');
            return isUpdate;
        },

        addUserScriptsBatch(items) {
            if (!Array.isArray(items) || items.length === 0) return 0;
            const existingIds = new Set(state.userScripts.map((s) => s.id));
            const clean = items.filter((item) => item && item.id && !existingIds.has(item.id));
            if (clean.length === 0) return 0;
            state.userScripts = [...clean, ...state.userScripts];
            safeStorage.set(STORAGE_KEYS.SCRIPTS, state.userScripts);
            notify('scripts');
            return clean.length;
        },

        moveScriptStatus(id, newStatus) {
            const item = state.userScripts.find((s) => s.id === id);
            if (!item || item.status === newStatus) return false;
            item.status = newStatus;
            safeStorage.set(STORAGE_KEYS.SCRIPTS, state.userScripts);
            notify('scripts');
            return true;
        },

        deleteUserScript(id) {
            const idx = state.userScripts.findIndex((s) => s.id === id);
            if (idx === -1) return null;
            const [removed] = state.userScripts.splice(idx, 1);
            safeStorage.set(STORAGE_KEYS.SCRIPTS, state.userScripts);
            notify('scripts');
            return { item: removed, index: idx };
        },

        restoreUserScript(item, index = 0) {
            if (!item) return;
            if (state.userScripts.some((s) => s.id === item.id)) return;
            const safeIdx = Math.max(0, Math.min(index, state.userScripts.length));
            state.userScripts.splice(safeIdx, 0, item);
            safeStorage.set(STORAGE_KEYS.SCRIPTS, state.userScripts);
            notify('scripts');
        },

        updateGoals(views, follows) {
            const nextViews = Math.max(0, parseInt(views, 10) || 0);
            const nextFollows = Math.max(0, parseInt(follows, 10) || 0);
            if (state.userGoals.views === nextViews && state.userGoals.follows === nextFollows) return;
            state.userGoals = { views: nextViews, follows: nextFollows };
            safeStorage.set(STORAGE_KEYS.GOALS, state.userGoals);
            notify('goals');
        },

        setApiKey(key) {
            const clean = String(key || '').trim();
            state.apiKey = clean;
            safeStorage.setRaw(STORAGE_KEYS.API_KEY, clean);
            notify('apiKey');
        },

        setTheme(theme) {
            const next = theme === 'dark' ? 'dark' : 'light';
            state.theme = next;
            safeStorage.setRaw(STORAGE_KEYS.THEME, next);
            notify('theme');
        },

        setAutoDumpOnBoot(enabled) {
            const next = Boolean(enabled);
            state.autoDumpOnBoot = next;
            safeStorage.set(STORAGE_KEYS.AUTO_DUMP_ON_BOOT, next);
        },

        exportBackup() {
            return {
                version: 2,
                exportedAt: new Date().toISOString(),
                templates: state.templates,
                userScripts: state.userScripts,
                userGoals: state.userGoals
            };
        },

        importBackup(payload) {
            if (!payload || typeof payload !== 'object') throw new Error('File sao lưu không hợp lệ');
            if (Array.isArray(payload.templates) && payload.templates.length > 0) {
                state.templates = payload.templates;
                safeStorage.set(STORAGE_KEYS.TEMPLATES, state.templates);
                notify('templates');
            }
            if (Array.isArray(payload.userScripts)) {
                state.userScripts = payload.userScripts;
                safeStorage.set(STORAGE_KEYS.SCRIPTS, state.userScripts);
                notify('scripts');
            }
            if (payload.userGoals && typeof payload.userGoals === 'object') {
                this.updateGoals(payload.userGoals.views, payload.userGoals.follows);
            }
        }
    };

    App.store = store;
})(window);
