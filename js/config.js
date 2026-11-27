/* ==========================================================================
   Configuration & Constants
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});

    App.CONFIG = {
        STORAGE_KEYS: {
            TEMPLATES: 'reels_studio_templates_v6',
            LEGACY_TEMPLATES_V2: 'reels_studio_templates_v5',
            ROTATION_HISTORY: 'reels_studio_rotation_history',
            SCRIPTS: 'reels_studio_scripts',
            GOALS: 'reels_studio_goals',
            API_KEY: 'reels_studio_gemini_api_key',
            THEME: 'reels_studio_theme',
            AUTO_DUMP_ON_BOOT: 'reels_studio_auto_dump_boot'
        },
        MAX_TEMPLATES: 120,

        GOAL_TARGETS: {
            VIEWS: 1000000,
            FOLLOWS: 5000
        },

        GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
        GEMINI_LIVE_WS_URL: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
        MODELS: {
            TEXT: 'gemini-4-hydrogen',
            TEXT_FALLBACKS: ['gemini-3.5-flash-lite', 'gemini-3.8-flash'],
            TTS: 'gemini-3.8-flash-lite-tts',
            TTS_PRO: 'gemini-3.8-flash-tts',
            LIVE_38: 'gemini-3.8-live',
            LIVE_3_FLASH: 'gemini-3-flash-live',
            IMAGE_PRIMARY: 'gemini-nano-banana-2.1',
            IMAGE_FALLBACK: 'gemini-3.1-flash-lite-image'
        },

        API_POLICY: {
            MAX_CONCURRENT_REQUESTS: 2,
            REQUEST_GAP_MS: 350,
            RETRYABLE_STATUSES: [429, 500, 502, 503, 504],
            MAX_RETRIES: 1,
            DUMP_COOLDOWN_MS: 3000,
            REWRITE_COOLDOWN_MS: 2000,
            MAX_CACHE_ENTRIES: 40
        },

        CATEGORY_BADGES: {
            office: {
                label: '🏢 Công sở & Drama',
                cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30'
            },
            career: {
                label: '💼 IT / MKT / Sale',
                cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30'
            },
            finance: {
                label: '💰 Tài chính',
                cls: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30'
            },
            humor: {
                label: '😂 Hài hước',
                cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
            },
            lifehack: {
                label: '💡 Mẹo vặt',
                cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'
            },
            warning: {
                label: '⚠️ Cảnh báo',
                cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30'
            },
            reminder: {
                label: '🔔 Nhắc nhở',
                cls: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30'
            },
            music: {
                label: '🎵 Nhạc & Mood',
                cls: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-500/15 dark:text-fuchsia-300 dark:border-fuchsia-500/30'
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

        MOTION_TYPES: ['zoomIn', 'panRight', 'zoomOut', 'panLeft', 'zoomIn', 'panRight'],

        STOCK_PHOTOS: {
            default: [
                '1556910103-1c02745aae4d',
                '1507048331197-7d4ac70811cf',
                '1495474472287-4d71bcdd2085',
                '1484480974693-6ca0a78fb36b',
                '1512917774080-9991f1c4c750',
                '1513694203232-719a280e022f',
                '1498050108023-c5249f4df085',
                '1506126613408-eca07ce68773',
                '1511671782779-c97d3d27a1d4',
                '1554224155-6726b3ff858f'
            ],
            kitchen: [
                '1556910103-1c02745aae4d',
                '1507048331197-7d4ac70811cf',
                '1547592180-85f173990554',
                '1466637574441-749b8f19452f',
                '1556909114-f6e7ad7d3136',
                '1495521821757-a1efb6729352',
                '1504674900247-0877df9cc836',
                '1546069901-ba9599a7e63c'
            ],
            sleep: [
                '1513694203232-719a280e022f',
                '1505693416388-ac5ce068fe85',
                '1495474472287-4d71bcdd2085',
                '1517842645767-c639042777db',
                '1522771739844-6a9f6d5f14af',
                '1540518614846-7eded433c457',
                '1515879218367-8466d910aaa4'
            ],
            tidy: [
                '1489987707025-afc232f7ea0f',
                '1558769132-cb1aea458c5e',
                '1484480974693-6ca0a78fb36b',
                '1513694203232-719a280e022f',
                '1527515637462-cff94eecc1ac',
                '1586023492125-27b2c045efd7',
                '1555041469-a586c61ea9bc'
            ],
            work: [
                '1484480974693-6ca0a78fb36b',
                '1498050108023-c5249f4df085',
                '1517694712202-14dd9538aa97',
                '1499750310107-5fef28a66643',
                '1507208773393-40d9fc670acf',
                '1497215728101-856f4ea42174',
                '1522202176988-66273c2fd55f'
            ],
            money: [
                '1554224155-6726b3ff858f',
                '1579621970563-ebec7560ff3e',
                '1542838132-92c53300491e',
                '1534452203293-494d7ddbf7e0',
                '1495474472287-4d71bcdd2085',
                '1553729459-efe14ef6055d',
                '1526304640581-d334cdbbf45e'
            ],
            creator: [
                '1516035069371-29a1b244cc32',
                '1492691527719-9d1e07e534b4',
                '1511671782779-c97d3d27a1d4',
                '1526170375885-4d8ecf77b99f',
                '1484480974693-6ca0a78fb36b',
                '1536240478700-b869070f9279',
                '1485846234645-a62644f84728'
            ],
            warning: [
                '1555421689-d68471e189f2',
                '1563986768609-322da13575f3',
                '1558002038-1055907df827',
                '1584467735815-f778f274e296',
                '1516321497487-e288fb19713f',
                '1510511459019-5dda7724fd87',
                '1550751827-4bd374c3f58b'
            ],
            reminder: [
                '1506126613408-eca07ce68773',
                '1544367567-0f2fcb009e0b',
                '1511895426328-dc8714191300',
                '1548839140-29a749e1cf4d',
                '1495474472287-4d71bcdd2085',
                '1518611012118-696072aa579a',
                '1507525428034-b723cf961d3e'
            ],
            music: [
                '1511671782779-c97d3d27a1d4',
                '1514525253161-7a46d19cd819',
                '1507838153414-b4b713384a76',
                '1470225620780-dba8ba36b745',
                '1518609878373-06d740f60d8b',
                '1508700115892-45ecd05ae2ad',
                '1511379938547-c1f69419868d'
            ]
        }
    };
})(window);
