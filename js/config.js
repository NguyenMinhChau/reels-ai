/* ==========================================================================
   Configuration & Constants
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});

    App.CONFIG = {
        STORAGE_KEYS: {
            TEMPLATES: 'reels_studio_templates_v3',
            LEGACY_TEMPLATES_V2: 'reels_studio_templates_v2',
            ROTATION_HISTORY: 'reels_studio_rotation_history',
            SCRIPTS: 'reels_studio_scripts',
            GOALS: 'reels_studio_goals',
            API_KEY: 'reels_studio_gemini_api_key',
            THEME: 'reels_studio_theme',
            AUTO_DUMP_ON_BOOT: 'reels_studio_auto_dump_boot'
        },
        MAX_TEMPLATES: 60,

        GOAL_TARGETS: {
            VIEWS: 1000000,
            FOLLOWS: 5000
        },

        GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
        MODELS: {
            TEXT: 'gemini-3-flash-preview',
            TTS: 'gemini-2.5-flash-preview-tts',
            IMAGE_PRIMARY: 'gemini-3.1-flash-image',
            IMAGE_FALLBACK: 'gemini-3.1-flash-lite-image'
        },

        API_POLICY: {
            MAX_CONCURRENT_REQUESTS: 2,
            REQUEST_GAP_MS: 350,
            RETRYABLE_STATUSES: [429, 500, 502, 503, 504],
            MAX_RETRIES: 2,
            DUMP_COOLDOWN_MS: 3000,
            REWRITE_COOLDOWN_MS: 2000,
            MAX_CACHE_ENTRIES: 40
        },

        CATEGORY_BADGES: {
            humor: {
                label: '😂 Hài hước',
                cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
            },
            lifehack: {
                label: '💡 Mẹo vặt',
                cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
            },
            vlog: {
                label: '☕ Mini Vlog',
                cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30'
            },
            bts: {
                label: '🎬 Sự thật',
                cls: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30'
            }
        },

        SCENE_META: [
            { badge: '1. Hook', cls: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-500/20', placeholder: 'Câu mở đầu 3 giây đầu gây tò mò...' },
            { badge: '2. Bối cảnh', cls: 'text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-500/20', placeholder: 'Thực trạng đời thường ai cũng gặp...' },
            { badge: '3. Bước 1', cls: 'text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-500/20', placeholder: 'Diễn biến / Cách làm chi tiết 1...' },
            { badge: '4. Bước 2', cls: 'text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-500/20', placeholder: 'Bí quyết đắt giá / Diễn biến 2...' },
            { badge: '5. Kết/CTA', cls: 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-500/20', placeholder: 'Thành quả & Kêu gọi Follow...' }
        ],

        MOTION_TYPES: ['zoomIn', 'panRight', 'zoomOut', 'panLeft', 'zoomIn'],

        STOCK_PHOTOS: {
            default: [
                '1556910103-1c02745aae4d',
                '1507048331197-7d4ac70811cf',
                '1495474472287-4d71bcdd2085',
                '1484480974693-6ca0a78fb36b',
                '1512917774080-9991f1c4c750'
            ],
            sleep: [
                '1513694203232-719a280e022f',
                '1505693416388-ac5ce068fe85',
                '1495474472287-4d71bcdd2085',
                '1517842645767-c639042777db',
                '1522771739844-6a9f6d5f14af'
            ],
            tidy: [
                '1489987707025-afc232f7ea0f',
                '1558769132-cb1aea458c5e',
                '1484480974693-6ca0a78fb36b',
                '1513694203232-719a280e022f',
                '1527515637462-cff94eecc1ac'
            ]
        }
    };
})(window);
