/* ==========================================================================
   Studio-Grade 2D Storytelling & UI Motion Animation Engine
   - Multi-layer cel-shaded 2D characters (articulated Bezier limbs, fingers,
     2-layer hair + highlights, eye catchlights, 4-stage audio lip-sync)
   - Deep illustrated environments (window light beams, bookshelves, plants,
     monitors, night moonlight, cafe ambiance, dot-grid spotlights)
   - Real-time speech-envelope & phase choreography (setup -> action -> payoff)
   - Zero script/subtitle text clutter over artwork
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const W = 540;
    const H = 960;
    const FLOOR_Y = 784;
    let currentAudioViseme = -1;

    const BACKDROPS = {
        'studio-focus': { top: '#fafbff', bot: '#eef2ff', floor: '#dbeafe', line: '#93c5fd', accent: '#2563eb', wallTrim: '#e2e8f0', dark: false },
        'warm-cream-stage': { top: '#f7f0e2', bot: '#ebe0c8', floor: '#ddcca8', line: '#b39b70', accent: '#059669', wallTrim: '#e5d6b8', dark: false },
        'tech-dark-indigo': { top: '#060919', bot: '#12173d', floor: '#040712', line: '#6366f1', accent: '#38bdf8', wallTrim: '#1e2554', dark: true },
        'office-shelf': { top: '#f5ede0', bot: '#e2d2ba', floor: '#c8a680', line: '#9c7d5b', accent: '#2563eb', wallTrim: '#d4bfa2', dark: false },
        'office-desk': { top: '#f0f6ff', bot: '#dceafe', floor: '#c7d2fe', line: '#6366f1', accent: '#2563eb', wallTrim: '#c7d9fc', dark: false },
        'work-late': { top: '#111827', bot: '#1e293b', floor: '#0f172a', line: '#334155', accent: '#f59e0b', wallTrim: '#1e293b', dark: true },
        'gym-fresh': { top: '#ecfeff', bot: '#cffafe', floor: '#99f6e4', line: '#0d9488', accent: '#059669', wallTrim: '#a5f3fc', dark: false },
        'bank-vault': { top: '#064e3b', bot: '#047857', floor: '#065f46', line: '#34d399', accent: '#fbbf24', wallTrim: '#059669', dark: true },
        'home-living': { top: '#fff7ed', bot: '#fde6c8', floor: '#d6a97a', line: '#9a6b3f', accent: '#ea580c', wallTrim: '#fbd5aa', dark: false },
        'street-rain': { top: '#0f172a', bot: '#1e293b', floor: '#1e293b', line: '#38bdf8', accent: '#60a5fa', wallTrim: '#334155', dark: true },
        'warning-stage': { top: '#2b0910', bot: '#4c0519', floor: '#3b0714', line: '#fb7185', accent: '#f43f5e', wallTrim: '#6b0f26', dark: true },
        'cream-room': { top: '#fef8e8', bot: '#f2e2be', floor: '#d6c194', line: '#9c8b68', accent: '#10b981', wallTrim: '#e8d4a8', dark: false },
        'grid-light': { top: '#f6f9ff', bot: '#e5efff', floor: '#dbeafe', line: '#93c5fd', accent: '#2563eb', wallTrim: '#dbeafe', dark: false },
        'blueprint-dark': { top: '#091224', bot: '#122443', floor: '#0d172a', line: '#1e3a5f', accent: '#38bdf8', wallTrim: '#172e4f', dark: true },
        'bedroom-night': { top: '#0d142b', bot: '#1e1b4b', floor: '#151336', line: '#4338ca', accent: '#fbbf24', wallTrim: '#272361', dark: true },
        'kitchen-cozy': { top: '#fff8ef', bot: '#ffecd6', floor: '#fed7aa', line: '#c2410c', accent: '#ea580c', wallTrim: '#fde0c2', dark: false },
        'cafe-chill': { top: '#fef5d8', bot: '#fde4a6', floor: '#d9913b', line: '#78350f', accent: '#b45309', wallTrim: '#f5cf7f', dark: false },
        'server-tech': { top: '#070b14', bot: '#122048', floor: '#0d1528', line: '#38bdf8', accent: '#ef4444', wallTrim: '#1b2e5e', dark: true },
        'hills-nature': { top: '#e2f3de', bot: '#cce7c4', floor: '#8cb369', hill: '#a2c97d', line: '#6c914d', accent: '#059669', wallTrim: '#b4d692', dark: false },
        'city-skyline': { top: '#ddeaf8', bot: '#c3d9f0', floor: '#b6cce2', line: '#6e8bad', accent: '#2563eb', wallTrim: '#d0e2f4', dark: false },
        'sunset-warm': { top: '#feeadb', bot: '#fbd0b9', floor: '#ecc1aa', line: '#b57b61', accent: '#ea580c', wallTrim: '#f8be9f', dark: false },
        'mint-fresh': { top: '#e2f9ef', bot: '#c5f0dc', floor: '#a0dbc0', line: '#4d9b7b', accent: '#0d9488', wallTrim: '#b5e7cf', dark: false },
        'night-calm': { top: '#181642', bot: '#2b2870', floor: '#131133', line: '#6366f1', accent: '#f59e0b', wallTrim: '#353288', dark: true },
        'alert-tint': { top: '#fee5e7', bot: '#fecdd3', floor: '#fca5a5', line: '#be123c', accent: '#e11d48', dark: false }
    };

    const BACKDROP_NAMES = Object.keys(BACKDROPS);

    const LAYOUT_NAMES = [
        'balance-scale',
        'bar-compare',
        'savings-jar-growth',
        'calendar-alert',
        'tech-formula-steps',
        'journey-route',
        'checklist-trio',
        'wide-team',
        'desk-closeup',
        'two-shot-dialogue',
        'back-monitors',
        'hand-viewfinder',
        'hand-pov',
        'screen-pointer',
        'laptop-popup',
        'character-action',
        'character-left',
        'split-compare',
        'action-flow',
        'thought-bubble',
        'multi-trio',
        'document-card',
        'center-hero',
        'ui-window',
        'ui-checklist',
        'ui-flow',
        'ui-grid-hero'
    ];

    const DIAGRAM_LAYOUTS = [
        'balance-scale',
        'bar-compare',
        'savings-jar-growth',
        'calendar-alert',
        'tech-formula-steps',
        'journey-route',
        'checklist-trio'
    ];
    const UI_LAYOUTS = ['back-monitors', 'tech-formula-steps', 'bar-compare', 'checklist-trio', 'ui-window', 'ui-checklist', 'ui-flow', 'ui-grid-hero'];
    const STORY_LAYOUTS_GENERAL = [
        'character-action',
        'character-left',
        'balance-scale',
        'bar-compare',
        'savings-jar-growth',
        'calendar-alert',
        'journey-route',
        'checklist-trio',
        'back-monitors',
        'hand-viewfinder',
        'split-compare',
        'action-flow',
        'thought-bubble',
        'multi-trio',
        'center-hero'
    ];
    const STORY_LAYOUTS = [
        'wide-team',
        'desk-closeup',
        'two-shot-dialogue',
        'back-monitors',
        'hand-viewfinder',
        'screen-pointer',
        'laptop-popup',
        'balance-scale',
        'bar-compare',
        'checklist-trio',
        'character-action',
        'character-left',
        'split-compare',
        'action-flow',
        'thought-bubble'
    ];

    const CAST_NAMES = ['narrator', 'girl-purple', 'boy-spiky', 'girl-bun', 'manager-red'];
    const CAST_PROFILES = {
        narrator: {
            shirt: '#1e3a5f',
            shirtShade: '#142742',
            inner: '#f8fafc',
            hair: '#1e293b',
            hairHi: '#475569',
            skin: '#fbd3b4',
            skinShade: '#eab08a',
            style: 'parted',
            glasses: false,
            tie: '#38bdf8',
            laptopDot: false
        },
        'girl-purple': {
            shirt: '#ec4899',
            shirtShade: '#be185d',
            inner: '#fce7f3',
            hair: '#6b21a8',
            hairHi: '#a855f7',
            skin: '#fde0c8',
            skinShade: '#f0b892',
            style: 'top-bun',
            glasses: false,
            tie: null,
            laptopDot: true
        },
        'boy-spiky': {
            shirt: '#475569',
            shirtShade: '#334155',
            inner: '#e2e8f0',
            hair: '#18181b',
            hairHi: '#3f3f46',
            skin: '#fbd3b4',
            skinShade: '#e8ad86',
            style: 'spiky',
            glasses: true,
            tie: null,
            laptopDot: false
        },
        'girl-bun': {
            shirt: '#f97316',
            shirtShade: '#c2410c',
            inner: '#fff7ed',
            hair: '#292524',
            hairHi: '#57534e',
            skin: '#fde0c8',
            skinShade: '#efb890',
            style: 'high-bun',
            glasses: false,
            tie: null,
            laptopDot: true
        },
        'manager-red': {
            shirt: '#dc2626',
            shirtShade: '#991b1b',
            inner: '#ffffff',
            hair: '#1e293b',
            hairHi: '#64748b',
            skin: '#f7c8a5',
            skinShade: '#df9f74',
            style: 'short',
            glasses: true,
            tie: '#1e293b',
            laptopDot: true
        }
    };

    const ACTION_NAMES = [
        'pointing',
        'typing',
        'hunched-pain',
        'stretching',
        'empty-wallet',
        'back-ache',
        'calling',
        'phone-scroll',
        'shocked-phone',
        'cooking',
        'counting-money',
        'sleeping',
        'running',
        'drinking',
        'celebrating'
    ];

    const EFFECT_NAMES = ['sparkles', 'sparks', 'sweat', 'steam', 'hearts', 'confetti', 'money', 'notes'];
    const SFX_NAMES = ['pop', 'click', 'whoosh', 'ding', 'none'];
    const SCREEN_TYPES = [
        'chat_msg',
        'excel_err',
        'revenue_up',
        'revenue_down',
        'checklist_done',
        'calendar_due',
        'notification_bell',
        'wallet_cash',
        'code_bug',
        'contract_sign',
        'tea_break',
        'night_scroll'
    ];

    const PROP_NAMES = [
        'scale_icon',
        'hospital_card',
        'bank_counter',
        'speedometer',
        'scissors_cut',
        'umbrella',
        'map_pin',
        'formula_chip',
        'ergo_chair',
        'spine_back',
        'empty_wallet',
        'stretching_pose',
        'price_tag',
        'shopping_bag',
        'house',
        'door',
        'city_building',
        'bus',
        'scooter',
        'envelope',
        'cash_stack',
        'jar',
        'locked_jar',
        'card_doc',
        'coin',
        'red_button',
        'chart_bars',
        'rice_bowl',
        'coffee_cup',
        'water_glass',
        'heart',
        'cake',
        'gift_box',
        'phone',
        'scam_link',
        'plug_socket',
        'battery',
        'padlock',
        'fire_flame',
        'warning_triangle',
        'suitcase',
        'clock',
        'calendar',
        'lightbulb',
        'music_bars',
        'sleep_bed',
        'laptop',
        'megaphone',
        'target_kpi',
        'speech_drama'
    ];

    function clamp01(t) {
        return Math.max(0, Math.min(1, t));
    }

    function lerp(a, b, t) {
        return a + (b - a) * clamp01(t);
    }

    function easeOutCubic(t) {
        const x = clamp01(t);
        return 1 - Math.pow(1 - x, 3);
    }

    function easeInOutCubic(t) {
        const x = clamp01(t);
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }

    function easeOutBack(t) {
        const x = clamp01(t);
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }

    function stagePop(progress, startP, span = 0.16) {
        if (progress < startP) return 0;
        return easeOutBack(clamp01((progress - startP) / span));
    }

    // ---- Weighted Context-Rich Story & Domain Resolver ----
    const SEMANTIC_RULES = [
        {
            regex: /gù lưng|cong lưng|cột sống|dán mặt vào màn hình|10 tiếng|ngồi lâu|cúi gằm|sai tư thế|đau lưng|mỏi nhừ|mỏi lưng|đau vai|bẫy ghế/,
            backdrop: 'work-late', layout: 'character-action', cast: 'boy-spiky', action: 'hunched-pain',
            props: ['spine_back', 'ergo_chair'], mood: 'shocked', effect: 'sweat', sfx: 'pop', screenType: 'excel_err', phase2Effect: 'back_pain'
        },
        {
            regex: /ghế ergonomic|ghế công thái học|chiếc ghế|ghế xịn|ngồi êm|mua ghế|tựa lưng/,
            backdrop: 'studio-focus', layout: 'character-left', cast: 'narrator', action: 'back-ache',
            props: ['ergo_chair', 'spine_back'], mood: 'thinking', effect: 'sparkles', sfx: 'pop', screenType: 'checklist_done', phase2Effect: 'none'
        },
        {
            regex: /đứng lên|đi lại|giãn cơ|vươn vai|tập thể dục|5 phút|đi bộ|duỗi lưng/,
            backdrop: 'gym-fresh', layout: 'character-action', cast: 'girl-bun', action: 'stretching',
            props: ['stretching_pose', 'clock'], mood: 'happy', effect: 'confetti', sfx: 'ding', screenType: 'checklist_done', phase2Effect: 'stretch_up'
        },
        {
            regex: /ví thì xẹp|xẹp lép|cháy túi|hết tiền|rỗng túi|ví rỗng|năm củ|5 củ|5 triệu|tiền mất|tốn tiền|đắt xắt/,
            backdrop: 'sunset-warm', layout: 'character-left', cast: 'boy-spiky', action: 'empty-wallet',
            props: ['empty_wallet', 'price_tag'], mood: 'shocked', effect: 'money', sfx: 'pop', screenType: 'wallet_cash', phase2Effect: 'wallet_empty'
        },
        {
            regex: /nghe quảng cáo|múc ngay|chốt đơn mua|mua ngay|sắm ngay|đặt mua|giỏ hàng/,
            backdrop: 'office-desk', layout: 'hand-pov', cast: 'narrator', action: 'phone-scroll',
            props: ['shopping_bag', 'ergo_chair'], mood: 'happy', effect: 'sparkles', sfx: 'click', screenType: 'chat_msg', phase2Effect: 'check_win'
        },
        {
            regex: /phòng kinh doanh|công ty|văn phòng|đội ngũ|cả team|họp team|họp sáng|nhân viên|đồng nghiệp|họp/,
            backdrop: 'office-shelf', layout: 'wide-team', cast: 'narrator', action: 'pointing',
            props: ['laptop', 'chart_bars'], mood: 'happy', effect: 'sparkles', sfx: 'whoosh', screenType: 'revenue_up', phase2Effect: 'none'
        },
        {
            regex: /gọi điện|nghe máy|alo|tư vấn khách|chốt sale|điện thoại lên|gọi khách/,
            backdrop: 'office-desk', layout: 'desk-closeup', cast: 'manager-red', action: 'calling',
            props: ['phone', 'coffee_cup'], mood: 'happy', effect: 'sparkles', sfx: 'pop', screenType: 'notification_bell', phase2Effect: 'none'
        },
        {
            regex: /hợp đồng|chữ ký|ký tên|giấy tờ|hóa đơn|bảng giá|báo giá|tài liệu|hồ sơ|duyệt đơn/,
            backdrop: 'office-desk', layout: 'hand-pov', cast: 'girl-bun', action: 'pointing',
            props: ['card_doc', 'envelope'], mood: 'thinking', effect: 'sparkles', sfx: 'click', screenType: 'contract_sign', phase2Effect: 'check_win'
        },
        {
            regex: /excel|bảng tính|lỗi công thức|nhập liệu|file báo cáo|mở file|phần mềm|erp|crm|hệ thống/,
            backdrop: 'office-desk', layout: 'laptop-popup', cast: 'girl-purple', action: 'typing',
            props: ['laptop', 'card_doc'], mood: 'shocked', effect: 'sweat', sfx: 'pop', screenType: 'excel_err', phase2Effect: 'shock_alert'
        },
        {
            regex: /deadline|trễ hạn|chạy số|kpi|áp lực|ot|tăng ca|sếp mắng|gấp rút|trưởng phòng/,
            backdrop: 'work-late', layout: 'desk-closeup', cast: 'boy-spiky', action: 'typing',
            props: ['clock', 'target_kpi', 'laptop'], mood: 'shocked', effect: 'sweat', sfx: 'pop', screenType: 'calendar_due', phase2Effect: 'shock_alert'
        },
        {
            regex: /sập server|lỗi|bug|code|it|dev|deploy|lập trình|api|crash|sự cố/,
            backdrop: 'server-tech', layout: 'character-action', cast: 'boy-spiky', action: 'typing',
            props: ['laptop', 'fire_flame', 'warning_triangle'], mood: 'shocked', effect: 'sparks', sfx: 'pop', screenType: 'code_bug', phase2Effect: 'shock_alert'
        },
        {
            regex: /đi ngủ|nằm ngủ|giấc ngủ|mất ngủ|trên giường|chăn gối|nửa đêm|2 giờ sáng|khuya rồi/,
            backdrop: 'bedroom-night', layout: 'character-action', cast: 'girl-purple', action: 'sleeping',
            props: ['sleep_bed', 'phone', 'clock'], mood: 'sleepy', effect: 'sparkles', sfx: 'none', screenType: 'night_scroll', phase2Effect: 'none'
        },
        {
            regex: /lướt điện thoại|tin nhắn|sếp nhắn|check tin|nhắn tin|chat|zalo|thông báo|notification|seen|im lặng/,
            backdrop: 'office-desk', layout: 'hand-pov', cast: 'girl-purple', action: 'shocked-phone',
            props: ['phone', 'speech_drama'], mood: 'shocked', effect: 'sweat', sfx: 'pop', screenType: 'chat_msg'
        },
        {
            regex: /bước \d|cách làm|hướng dẫn|quy trình|từng bước|kiểm tra|danh sách|checklist|tối ưu|cài đặt/,
            backdrop: 'grid-light', layout: 'ui-checklist', cast: 'narrator', action: 'pointing',
            props: ['card_doc', 'lightbulb', 'laptop'], mood: 'happy', effect: 'sparkles', sfx: 'click', screenType: 'checklist_done'
        },
        {
            regex: /marketing|quảng cáo|ads|content|nội dung|viral|kênh|thu hút|tăng trưởng|tỷ lệ|chuyển đổi/,
            backdrop: 'office-desk', layout: 'action-flow', cast: 'girl-bun', action: 'pointing',
            props: ['megaphone', 'chart_bars', 'target_kpi'], mood: 'happy', effect: 'sparkles', sfx: 'whoosh', screenType: 'revenue_up'
        },
        {
            regex: /so sánh|gấp đôi|chênh lệch|ít hơn|hơn hẳn|tăng|giảm|hiệu quả|kết quả|trước|sau/,
            backdrop: 'mint-fresh', layout: 'split-compare', cast: 'narrator', action: 'celebrating',
            props: ['chart_bars', 'lightbulb'], mood: 'happy', effect: 'confetti', sfx: 'ding', screenType: 'revenue_up'
        },
        {
            regex: /lừa đảo|link lạ|otp|giả mạo|tin nhắn lạ|mất tiền|cảnh báo|bẫy|rủi ro|nguy hiểm/,
            backdrop: 'alert-tint', layout: 'character-action', cast: 'girl-bun', action: 'shocked-phone',
            props: ['scam_link', 'warning_triangle', 'padlock'], mood: 'shocked', effect: 'sparks', sfx: 'pop', screenType: 'code_bug', crossOut: true
        },
        {
            regex: /ổ điện|cháy|nổ|quá tải|giật điện|nóng máy|cắm sạc|pin/,
            backdrop: 'alert-tint', layout: 'split-compare', cast: 'boy-spiky', action: 'shocked-phone',
            props: ['plug_socket', 'fire_flame', 'battery'], mood: 'shocked', effect: 'sparks', sfx: 'pop', screenType: 'code_bug', crossOut: true
        },
        {
            regex: /uống nước|ly nước|cốc nước|nước ấm|nước lọc|cà phê|trà sữa|nghỉ giải lao|thải độc/,
            backdrop: 'cafe-chill', layout: 'character-action', cast: 'girl-purple', action: 'drinking',
            props: ['coffee_cup', 'water_glass', 'heart'], mood: 'happy', effect: 'steam', sfx: 'pop', screenType: 'tea_break'
        },
        {
            regex: /cơm|ăn|nấu|bếp|chảo|hành|tỏi|bữa|tủ lạnh|ngăn đá|chợ/,
            backdrop: 'kitchen-cozy', layout: 'character-action', cast: 'girl-bun', action: 'cooking',
            props: ['rice_bowl', 'coffee_cup', 'jar'], mood: 'happy', effect: 'steam', sfx: 'pop', screenType: 'tea_break'
        },
        {
            regex: /nhạc|lofi|lo-fi|giai điệu|âm thanh|piano|chill|thư giãn/,
            backdrop: 'cafe-chill', layout: 'center-hero', cast: 'girl-purple', action: 'drinking',
            props: ['music_bars', 'coffee_cup', 'heart'], mood: 'happy', effect: 'notes', sfx: 'none', screenType: 'tea_break'
        },
        {
            regex: /cân bằng|bằng nhau|tài sản|công dụng|nặng hơn|nhẹ hơn|giá trị thực|đánh đổi|công sức/,
            weight: 2.2,
            backdrop: 'warm-cream-stage', layout: 'balance-scale', cast: 'narrator', action: 'pointing',
            props: ['scale_icon', 'cash_stack'], mood: 'thinking', effect: 'money', sfx: 'ding', screenType: 'wallet_cash'
        },
        {
            regex: /subnet|cidr|ip|mask|block|bit|binary|công thức|thuật toán|tính nhanh|chia đôi/,
            weight: 2.4,
            backdrop: 'tech-dark-indigo', layout: 'tech-formula-steps', cast: 'boy-spiky', action: 'pointing',
            props: ['formula_chip', 'laptop'], mood: 'happy', effect: 'sparks', sfx: 'click', screenType: 'code_bug'
        },
        {
            regex: /quỹ khẩn cấp|tích lũy|cất bù|chia hũ|bỏ ống|hũ tiền|gửi tiết kiệm|sổ tiết kiệm/,
            weight: 2.2,
            backdrop: 'warm-cream-stage', layout: 'savings-jar-growth', cast: 'narrator', action: 'counting-money',
            props: ['jar', 'coin'], mood: 'happy', effect: 'money', sfx: 'ding', screenType: 'wallet_cash'
        },
        {
            regex: /tháng \d+|ngày \d+|12 tháng|24 tháng|kỳ hạn|đến hạn|mỗi năm|viện phí|bệnh viện|tất toán/,
            weight: 2.2,
            backdrop: 'warm-cream-stage', layout: 'calendar-alert', cast: 'narrator', action: 'pointing',
            props: ['calendar', 'hospital_card'], mood: 'shocked', effect: 'sparkles', sfx: 'pop', screenType: 'calendar_due'
        },
        {
            regex: /quãng đường|\d+\s*km|đi làm|về quê|đèn đỏ|kẹt xe|đi mưa|áo mưa|xe buýt|xe máy/,
            weight: 2.2,
            backdrop: 'warm-cream-stage', layout: 'journey-route', cast: 'boy-spiky', action: 'running',
            props: ['scooter', 'map_pin', 'umbrella'], mood: 'happy', effect: 'sparkles', sfx: 'whoosh', screenType: 'calendar_due'
        },
        {
            regex: /3 việc|3 bước|3 điều|3 cách|danh sách|công thức nấu|nguyên liệu/,
            weight: 2.0,
            backdrop: 'grid-light', layout: 'checklist-trio', cast: 'girl-purple', action: 'pointing',
            props: ['card_doc', 'lightbulb'], mood: 'happy', effect: 'confetti', sfx: 'ding', screenType: 'checklist_done'
        },
        {
            regex: /lương|thu nhập|tiền|phong bì|triệu|nghìn|50k|100k|tiết kiệm|hũ|ví|trả góp|chi tiêu|tài chính|ngân sách|đầu tư|lãi/,
            backdrop: 'warm-cream-stage', layout: 'bar-compare', cast: 'narrator', action: 'counting-money',
            props: ['cash_stack', 'jar', 'coin'], mood: 'happy', effect: 'money', sfx: 'ding', screenType: 'wallet_cash'
        },
        {
            regex: /chạy|vội|muộn|trễ|tắc đường|xe|đi làm|xăng|chuyến|tan tầm/,
            backdrop: 'city-skyline', layout: 'character-action', cast: 'boy-spiky', action: 'running',
            props: ['scooter', 'clock', 'city_building'], mood: 'shocked', effect: 'sweat', sfx: 'whoosh', screenType: 'calendar_due'
        },
        {
            regex: /thành công|chúc mừng|tuyệt vời|nhẹ nhàng|dư thời gian|bí quyết|thay đổi|follow|đăng ký|chốt đơn/,
            backdrop: 'sunset-warm', layout: 'character-left', cast: 'narrator', action: 'celebrating',
            props: ['lightbulb', 'heart', 'gift_box'], mood: 'happy', effect: 'confetti', sfx: 'ding', screenType: 'revenue_up'
        },
        {
            regex: /quê|nhà|gia đình|bố mẹ|tình cảm|yêu/,
            backdrop: 'hills-nature', layout: 'character-left', cast: 'girl-purple', action: 'celebrating',
            props: ['house', 'heart', 'gift_box'], mood: 'happy', effect: 'hearts', sfx: 'pop', screenType: 'tea_break'
        }
    ];

    function inferDomainContext(fullText) {
        const lower = String(fullText || '').toLowerCase();
        if (/lừa đảo|scam|otp|link lạ|giả mạo|cảnh báo|cháy|nổ|ổ điện|rủi ro|nguy hiểm|an toàn|bẫy/.test(lower)) {
            return {
                domainKey: 'warning',
                backdrops: ['warning-stage', 'alert-tint', 'work-late'],
                layouts: STORY_LAYOUTS_GENERAL,
                props: ['warning_triangle', 'scam_link'],
                action: 'shocked-phone',
                screenType: 'code_bug',
                cast: 'girl-bun'
            };
        }
        if (/subnet|cidr|mask|ip|it|dev|code|bug|server|phần mềm|hệ thống|erp|ai|công nghệ|máy tính|dữ liệu|lập trình|công thức/.test(lower)) {
            return {
                domainKey: 'tech',
                backdrops: ['tech-dark-indigo', 'blueprint-dark', 'grid-light'],
                layouts: ['tech-formula-steps', 'back-monitors', 'bar-compare', 'checklist-trio', 'ui-window', 'character-action'],
                props: ['formula_chip', 'laptop', 'chart_bars'],
                action: 'typing',
                screenType: 'code_bug',
                cast: 'boy-spiky'
            };
        }
        if (/tiền|lương|tài chính|tiết kiệm|đầu tư|ngân sách|nợ|chi tiêu|trả góp|hũ|ví|lãi|giá|triệu|quỹ|sổ/.test(lower)) {
            return {
                domainKey: 'finance',
                backdrops: ['warm-cream-stage', 'mint-fresh', 'bank-vault', 'sunset-warm', 'studio-focus'],
                layouts: [
                    'character-action', 'balance-scale', 'hand-viewfinder', 'bar-compare',
                    'character-left', 'savings-jar-growth', 'split-compare', 'calendar-alert',
                    'thought-bubble', 'journey-route', 'action-flow', 'multi-trio'
                ],
                props: ['cash_stack', 'jar', 'scale_icon', 'envelope', 'coin', 'empty_wallet', 'calendar', 'bank_counter'],
                action: 'counting-money',
                screenType: 'wallet_cash',
                cast: 'narrator'
            };
        }
        if (/công sở|văn phòng|sếp|nhân viên|đồng nghiệp|marketing|sale|chốt đơn|hr|phỏng vấn|kpi|deadline|họp|ghế ergonomic/.test(lower)) {
            return {
                domainKey: 'office',
                backdrops: ['office-shelf', 'office-desk', 'work-late', 'studio-focus'],
                layouts: STORY_LAYOUTS,
                props: ['laptop', 'card_doc'],
                action: 'pointing',
                screenType: 'checklist_done',
                cast: 'narrator'
            };
        }
        if (/nấu|bếp|cơm|món|tủ lạnh|chảo|ăn|rau|thịt|mẹo bếp|dọn nhà|giặt/.test(lower)) {
            return {
                domainKey: 'kitchen',
                backdrops: ['kitchen-cozy', 'home-living', 'cream-room'],
                layouts: STORY_LAYOUTS_GENERAL,
                props: ['rice_bowl', 'coffee_cup'],
                action: 'cooking',
                screenType: 'tea_break',
                cast: 'girl-bun'
            };
        }
        if (/nhạc|lofi|lo-fi|giai điệu|âm thanh|piano|chill|tâm trạng|cô đơn|mưa/.test(lower)) {
            return {
                domainKey: 'music',
                backdrops: ['cafe-chill', 'night-calm', 'street-rain'],
                layouts: STORY_LAYOUTS_GENERAL,
                props: ['music_bars', 'coffee_cup'],
                action: 'drinking',
                screenType: 'tea_break',
                cast: 'girl-purple'
            };
        }
        if (/sức khỏe|cột sống|lưng|giãn cơ|vươn vai|tập thể dục|uống nước|ngủ|mắt|nhắc nhở/.test(lower)) {
            return {
                domainKey: 'health',
                backdrops: ['gym-fresh', 'mint-fresh', 'bedroom-night'],
                layouts: STORY_LAYOUTS_GENERAL,
                props: ['stretching_pose', 'water_glass'],
                action: 'stretching',
                screenType: 'checklist_done',
                cast: 'girl-purple'
            };
        }
        if (/du lịch|quê|gia đình|bố mẹ|vlog|cà phê|đi chơi|cuối tuần|xe|đường phố/.test(lower)) {
            return {
                domainKey: 'vlog',
                backdrops: ['hills-nature', 'cafe-chill', 'city-skyline', 'street-rain'],
                layouts: STORY_LAYOUTS_GENERAL,
                props: ['house', 'coffee_cup'],
                action: 'celebrating',
                screenType: 'tea_break',
                cast: 'girl-purple'
            };
        }
        return {
            domainKey: 'home',
            backdrops: ['home-living', 'studio-focus', 'cream-room', 'sunset-warm'],
            layouts: STORY_LAYOUTS_GENERAL,
            props: ['lightbulb', 'speech_drama'],
            action: 'pointing',
            screenType: 'chat_msg',
            cast: 'narrator'
        };
    }

    function extractLocalDiagramData(beatLower, layout, domainKey) {
        const cleanNum = (rx, fallback) => {
            const m = beatLower.match(rx);
            return m ? String(m[0]).toUpperCase().trim().slice(0, 16) : fallback;
        };
        const numMatches = beatLower.match(/\d+(?:[.,]\d+)?\s*(?:triệu|tr|nghìn|k|km|tháng|năm|%|ngày|giờ|củ)?/gi) || [];
        const n1 = (numMatches[0] || '').toUpperCase().trim().slice(0, 14);
        const n2 = (numMatches[1] || '').toUpperCase().trim().slice(0, 14);

        if (layout === 'balance-scale') {
            return {
                leftLabel: /tài sản|giá trị|thu nhập/.test(beatLower) ? 'TÀI SẢN' : (/công dụng|lợi ích/.test(beatLower) ? 'CÔNG DỤNG' : 'GIÁ TRỊ'),
                rightLabel: /chi tiêu|trả góp|xe mới/.test(beatLower) ? 'CHI TIÊU' : 'CHI PHÍ',
                badgeA: n1 || '+',
                badgeB: n2 || '-',
                highlightNum: 'CÂN BẰNG'
            };
        }
        if (layout === 'bar-compare') {
            return {
                leftLabel: /trước|cũ|ngắn hạn|ban đầu/.test(beatLower) ? 'TRƯỚC ĐÂY' : (/thu|tiết kiệm|tài sản/.test(beatLower) ? 'TÍCH LŨY' : 'MỨC A'),
                rightLabel: /sau|mới|dài hạn|tích lũy/.test(beatLower) ? 'HIỆN TẠI' : (/chi|tốn|nợ/.test(beatLower) ? 'CHI PHÍ' : 'MỨC B'),
                badgeA: n1 || 'THẤP',
                badgeB: n2 || (n1 ? 'TỐI ƯU' : 'CAO'),
                highlightNum: n1 || 'SO SÁNH'
            };
        }
        if (layout === 'savings-jar-growth') {
            return {
                leftLabel: 'TÍCH LŨY',
                rightLabel: /khẩn cấp/.test(beatLower) ? 'QUỸ DỰ PHÒNG' : 'QUỸ TÍCH LŨY',
                badgeA: n1 || '+TÍCH LŨY',
                badgeB: n2 || 'TĂNG ĐỀU',
                highlightNum: n1 || 'QUỸ TÍCH LŨY'
            };
        }
        if (layout === 'calendar-alert') {
            return {
                leftLabel: 'KỲ HẠN',
                rightLabel: 'ĐẾN HẠN',
                badgeA: cleanNum(/\d+\s*tháng/, n1 || 'ĐỊNH KỲ'),
                badgeB: 'LƯU Ý',
                highlightNum: cleanNum(/tháng\s*\d+/, n1 || 'MỐC THỜI GIAN')
            };
        }
        if (layout === 'tech-formula-steps') {
            return {
                leftLabel: 'INPUT',
                rightLabel: 'OUTPUT',
                badgeA: n1 || (/subnet|cidr|mask/.test(beatLower) ? '/24' : 'DỮ LIỆU'),
                badgeB: n2 || (/subnet|cidr|mask/.test(beatLower) ? '/26' : 'KẾT QUẢ'),
                highlightNum: /subnet|cidr|mask/.test(beatLower) ? '256 - MASK' : (n1 ? `CÔNG THỨC ${n1}` : 'CẤU TRÚC')
            };
        }
        if (layout === 'journey-route') {
            return {
                leftLabel: /quê/.test(beatLower) ? 'THÀNH PHỐ' : 'XUẤT PHÁT',
                rightLabel: /quê/.test(beatLower) ? 'VỀ QUÊ' : 'ĐÍCH ĐẾN',
                badgeA: 'ĐIỂM A',
                badgeB: 'ĐIỂM B',
                highlightNum: cleanNum(/\d+\s*km/, n1 || 'LỘ TRÌNH')
            };
        }
        if (layout === 'checklist-trio') {
            return {
                leftLabel: domainKey === 'tech' ? 'BƯỚC 1' : (/nấu|bếp/.test(beatLower) ? 'CHUẨN BỊ' : 'MỤC TIÊU 1'),
                rightLabel: domainKey === 'tech' ? 'BƯỚC 2' : (/nấu|bếp/.test(beatLower) ? 'THỰC HIỆN' : 'MỤC TIÊU 2'),
                badgeA: domainKey === 'tech' ? 'BƯỚC 3' : 'HOÀN TẤT',
                badgeB: '✓',
                highlightNum: '3 BƯỚC'
            };
        }
        return {
            leftLabel: n1 || '',
            rightLabel: n2 || '',
            badgeA: '',
            badgeB: '',
            highlightNum: n1 || ''
        };
    }

    function analyzeSceneVisualCue(sceneText, beatIdx, videoTitle = '', state = {}, visualStyle = 'motion') {
        const beatLower = String(sceneText || '').toLowerCase();
        const titleLower = String(videoTitle || '').toLowerCase();
        const combinedLower = `${beatLower} ${titleLower}`;
        const isUiMode = visualStyle === 'ui-motion';
        const recentLayouts = Array.isArray(state.recentLayouts) ? state.recentLayouts : (state.prevLayout ? [state.prevLayout] : []);
        const recentBackdrops = Array.isArray(state.recentBackdrops) ? state.recentBackdrops : (state.prevBackdrop ? [state.prevBackdrop] : []);
        const recentProps = Array.isArray(state.recentProps) ? state.recentProps : (state.prevProp ? [state.prevProp] : []);
        const prevCast = state.prevCast || '';

        let bestBeatRule = null;
        let bestBeatScore = 0;
        let bestTitleRule = null;
        let bestTitleScore = 0;
        for (const r of SEMANTIC_RULES) {
            const globalRx = new RegExp(r.regex.source, 'gi');
            const beatHits = (beatLower.match(globalRx) || []).length;
            const titleHits = (titleLower.match(globalRx) || []).length;
            const w = Number(r.weight) || 1;
            const bScore = beatHits * 3 * w;
            const tScore = (beatHits * 3 + titleHits) * w;
            if (bScore > bestBeatScore) {
                bestBeatScore = bScore;
                bestBeatRule = r;
            }
            if (tScore > bestTitleScore) {
                bestTitleScore = tScore;
                bestTitleRule = r;
            }
        }
        const bestRule = bestBeatRule || bestTitleRule;

        // Spoken beat topic overrides overall title topic when the sentence itself names a concrete world
        const beatDomain = inferDomainContext(beatLower);
        const domain = beatDomain.domainKey !== 'home' ? beatDomain : inferDomainContext(combinedLower);
        const poolLayouts = isUiMode ? UI_LAYOUTS : (domain.layouts || STORY_LAYOUTS_GENERAL);

        let layout = isUiMode
            ? UI_LAYOUTS[beatIdx % UI_LAYOUTS.length]
            : (bestRule && poolLayouts.includes(bestRule.layout) && !recentLayouts.includes(bestRule.layout)
                ? bestRule.layout
                : poolLayouts[(beatIdx * 3 + 1) % poolLayouts.length]);

        if (recentLayouts.includes(layout) && poolLayouts.length > 1) {
            const freshLayouts = poolLayouts.filter((l) => !recentLayouts.includes(l));
            const fallbackLayouts = poolLayouts.filter((l) => l !== recentLayouts[0]);
            const picks = freshLayouts.length > 0 ? freshLayouts : (fallbackLayouts.length > 0 ? fallbackLayouts : poolLayouts);
            layout = picks[(beatIdx * 5 + 1) % picks.length];
        }

        const domainBackdrops = domain.backdrops || ['warm-cream-stage', 'home-living', 'studio-focus', 'sunset-warm'];
        let backdrop = isUiMode
            ? (beatIdx % 3 === 1 ? 'tech-dark-indigo' : 'grid-light')
            : (bestRule && !recentBackdrops.includes(bestRule.backdrop) ? bestRule.backdrop : domainBackdrops[beatIdx % domainBackdrops.length]);

        if (!isUiMode && recentBackdrops.includes(backdrop) && domainBackdrops.length > 1) {
            const freshBgs = domainBackdrops.filter((b) => !recentBackdrops.includes(b));
            const fallbackBgs = domainBackdrops.filter((b) => b !== recentBackdrops[0]);
            const bgPool = freshBgs.length > 0 ? freshBgs : (fallbackBgs.length > 0 ? fallbackBgs : domainBackdrops);
            backdrop = bgPool[beatIdx % bgPool.length];
        }

        const mergedPropPool = [...new Set([...(bestRule?.props || []), ...(domain.props || [])])];
        let candidateProps = [...mergedPropPool];
        if (candidateProps.length > 1 && recentProps.includes(candidateProps[0])) {
            const freshProps = candidateProps.filter((p) => !recentProps.includes(p));
            const alt = freshProps.length > 0 ? freshProps[0] : candidateProps.find((p) => p !== recentProps[0]);
            if (alt) {
                candidateProps = [alt, ...candidateProps.filter((p) => p !== alt)];
            }
        }

        let cast = bestRule?.cast || domain.cast || CAST_NAMES[beatIdx % CAST_NAMES.length];
        if (cast === prevCast && CAST_NAMES.length > 1) {
            const altCasts = CAST_NAMES.filter((c) => c !== prevCast);
            cast = altCasts[beatIdx % altCasts.length];
        }
        const action = bestRule ? bestRule.action : domain.action;
        const characterMood = bestRule ? bestRule.mood : (/hỏi|sao|tại sao|gì|\?/.test(beatLower) ? 'thinking' : 'happy');
        const effect = bestRule ? bestRule.effect : 'sparkles';
        const sfx = bestRule?.sfx || (beatIdx === 0 ? 'whoosh' : beatIdx % 2 === 0 ? 'pop' : 'click');
        const screenType = bestRule?.screenType || domain.screenType || 'chat_msg';
        const phase2Effect = bestRule?.phase2Effect || 'none';
        const transition = isUiMode && beatIdx % 2 === 1 ? 'diagonal-wipe' : (DIAGRAM_LAYOUTS.includes(layout) && beatIdx > 0 ? 'zoom-blur' : 'cut');

        return {
            domainKey: domain.domainKey || 'home',
            beatRuleMatched: Boolean(bestBeatRule),
            layout,
            backdrop,
            transition,
            cast,
            action,
            effect,
            sfx,
            screenType,
            phase2Effect,
            props: candidateProps.slice(0, 3),
            diagramData: extractLocalDiagramData(beatLower, layout, domain.domainKey),
            characterMood,
            crossOut: Boolean(bestRule?.crossOut || (/sai lầm|đừng bao giờ|tuyệt đối không|cảnh báo|tránh ngay|sập bẫy|bó tay|sai bét/.test(beatLower))),
            sceneText: String(sceneText || ''),
            videoTitle: String(videoTitle || '')
        };
    }

    // ---- Shared Vector & Cel-Shaded Primitives ----
    function drawOutlinedRect(ctx, x, y, w, h, r, fill, stroke = '#1e293b', lw = 2.8, shadow = true) {
        ctx.save();
        if (shadow) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
            ctx.beginPath();
            ctx.roundRect(x + 4, y + 7, w, h, r);
            ctx.fill();
        }
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();
        if (stroke && lw > 0) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lw;
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawArticulatedLimb(ctx, x1, y1, mx, my, x2, y2, thickness, color, outline = '#1e293b', handColor = null, pointFinger = false) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Dark outer outline pass
        ctx.strokeStyle = outline;
        ctx.lineWidth = thickness + 5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(mx, my, x2, y2);
        ctx.stroke();

        // Inner sleeve/pant fill pass
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(mx, my, x2, y2);
        ctx.stroke();

        if (handColor) {
            ctx.fillStyle = handColor;
            ctx.strokeStyle = outline;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.arc(x2, y2, thickness * 0.62, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            if (pointFinger) {
                const ang = Math.atan2(y2 - my, x2 - mx);
                ctx.beginPath();
                ctx.moveTo(x2, y2);
                ctx.lineTo(x2 + Math.cos(ang) * 15, y2 + Math.sin(ang) * 15);
                ctx.lineWidth = 5;
                ctx.strokeStyle = handColor;
                ctx.stroke();
                ctx.lineWidth = 2.2;
                ctx.strokeStyle = outline;
                ctx.beginPath();
                ctx.arc(x2 + Math.cos(ang) * 13, y2 + Math.sin(ang) * 13, 3.2, 0, Math.PI * 2);
                ctx.fillStyle = handColor;
                ctx.fill();
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    function drawCursorPointer(ctx, x, y, clickScale = 1, ripple = 0) {
        ctx.save();
        if (ripple > 0.02 && ripple < 0.98) {
            ctx.strokeStyle = `rgba(37, 99, 235, ${1 - ripple})`;
            ctx.lineWidth = 3.2;
            ctx.beginPath();
            ctx.arc(x, y, 10 + ripple * 32, 0, Math.PI * 2);
            ctx.stroke();
        }
        // Soft drop shadow
        ctx.translate(x + 2, y + 4);
        ctx.scale(clickScale, clickScale);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 30);
        ctx.lineTo(8, 22);
        ctx.lineTo(14, 34);
        ctx.lineTo(20, 31);
        ctx.lineTo(14, 19);
        ctx.lineTo(24, 18);
        ctx.closePath();
        ctx.fill();

        ctx.translate(-2, -4);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 30);
        ctx.lineTo(8, 22);
        ctx.lineTo(14, 34);
        ctx.lineTo(20, 31);
        ctx.lineTo(14, 19);
        ctx.lineTo(24, 18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    function drawSparkle(ctx, x, y, size, color = '#fbbf24', rot = 0) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillStyle = color;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI) / 2;
            ctx.lineTo(Math.cos(angle) * size, Math.sin(angle) * size);
            ctx.lineTo(Math.cos(angle + Math.PI / 4) * (size * 0.34), Math.sin(angle + Math.PI / 4) * (size * 0.34));
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    function drawPottedPlant(ctx, x, y, scale = 1, sway = 0) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        // Leaves
        [
            [-18, -58, -0.5, '#15803d'],
            [18, -56, 0.5, '#16a34a'],
            [0, -76, 0.05, '#22c55e'],
            [-26, -42, -0.85, '#166534'],
            [26, -40, 0.85, '#15803d']
        ].forEach(([lx, ly, ang, col], i) => {
            ctx.save();
            ctx.translate(0, -26);
            ctx.rotate(ang + sway * 0.03 * (i % 2 === 0 ? 1 : -1));
            ctx.fillStyle = col;
            ctx.strokeStyle = '#14532d';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(lx * 0.35, ly * 0.55, 11, 24, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        });
        // Ceramic pot
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(-22, -32);
        ctx.lineTo(22, -32);
        ctx.lineTo(17, 0);
        ctx.lineTo(-17, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawOutlinedRect(ctx, -25, -38, 50, 9, 4, '#e2e8f0', '#1e293b', 2.2, false);
        ctx.restore();
    }

    function drawPalmTree(ctx, x, y, scale = 1, sway = 0) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#8b5e3c';
        ctx.strokeStyle = '#3e2723';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.quadraticCurveTo(-2, -70, -4, -145);
        ctx.lineTo(4, -145);
        ctx.quadraticCurveTo(6, -70, 9, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.translate(0, -145);
        ctx.rotate(sway * 0.045);
        [-2.4, -1.7, -0.8, 0.3, 1.0].forEach((ang, idx) => {
            ctx.save();
            ctx.rotate(ang);
            ctx.fillStyle = idx % 2 === 0 ? '#4d7c0f' : '#65a30d';
            ctx.strokeStyle = '#365314';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.ellipse(28, 0, 32, 9.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        });
        ctx.restore();
    }

    // ---- Detailed Room Backdrops with Lighting & Depth ----
    function drawOfficeBookshelfAndWindow(ctx, t, audioLevel = 0) {
        // Upper-right window with diagonal warm sunlight beam
        drawOutlinedRect(ctx, 328, 108, 174, 198, 10, '#dbeafe', '#64748b', 3.2, true);
        drawOutlinedRect(ctx, 336, 116, 158, 182, 6, '#e0f2fe', '#94a3b8', 1.8, false);
        // Sun rays diagonal soft beam
        ctx.save();
        ctx.fillStyle = 'rgba(254, 249, 195, 0.24)';
        ctx.beginPath();
        ctx.moveTo(336, 116);
        ctx.lineTo(494, 116);
        ctx.lineTo(395, FLOOR_Y);
        ctx.lineTo(155, FLOOR_Y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // Window blinds slats
        ctx.fillStyle = 'rgba(255,255,255,0.62)';
        for (let wy = 128; wy < 280; wy += 24) {
            ctx.fillRect(340, wy, 150, 7);
        }

        // Tall Wooden Bookshelf left side with 3D side edge
        drawOutlinedRect(ctx, 26, 154, 256, 264, 8, '#b08457', '#6f4e32', 3, true);
        drawOutlinedRect(ctx, 36, 164, 236, 72, 4, '#8d6640', '#5c4026', 2, false);
        drawOutlinedRect(ctx, 36, 248, 236, 72, 4, '#8d6640', '#5c4026', 2, false);
        drawOutlinedRect(ctx, 36, 332, 236, 74, 4, '#8d6640', '#5c4026', 2, false);

        const binderCols = ['#38bdf8', '#fb923c', '#facc15', '#34d399', '#ef4444', '#60a5fa', '#a855f7'];
        [164, 248, 332].forEach((ry, row) => {
            for (let b = 0; b < 6; b++) {
                const bx = 44 + b * 36;
                const bh = 54 + ((b + row) % 2) * 6;
                const col = binderCols[(row * 3 + b) % binderCols.length];
                drawOutlinedRect(ctx, bx, ry + (68 - bh), 28, bh, 4, col, '#1e293b', 1.8, false);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(bx + 7, ry + (68 - bh) + 10, 14, 10);
            }
        });

        // Framed Analytics Whiteboard / Poster
        drawOutlinedRect(ctx, 326, 326, 178, 128, 10, '#ffffff', '#64748b', 3, true);
        const barH = [38, 66, 52, 84];
        const barCols = ['#93c5fd', '#60a5fa', '#3b82f6', '#10b981'];
        barH.forEach((h, i) => {
            const bx = 348 + i * 36;
            const pulse = i === 3 ? audioLevel * 8 : 0;
            drawOutlinedRect(ctx, bx, 434 - h - pulse, 24, h + pulse, 4, barCols[i], '#1e293b', 1.8, false);
        });
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(356, 392);
        ctx.lineTo(394, 364);
        ctx.lineTo(432, 378);
        ctx.lineTo(472, 344);
        ctx.stroke();

        // Cozy potted Monstera plant on floor left
        drawPottedPlant(ctx, 56, FLOOR_Y, 1.05, Math.sin(t * 1.8));
    }

    function drawBackdrop(ctx, backdropId, progress, t, audioLevel = 0) {
        const b = BACKDROPS[backdropId] || BACKDROPS['cream-room'];
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, b.top);
        grad.addColorStop(1, b.bot);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        if (backdropId === 'grid-light' || backdropId === 'blueprint-dark' || backdropId === 'tech-dark-indigo') {
            const isDark = backdropId !== 'grid-light';
            const dotCol = backdropId === 'tech-dark-indigo' ? 'rgba(99, 102, 241, 0.24)' : (isDark ? 'rgba(56, 189, 248, 0.18)' : 'rgba(37, 99, 235, 0.15)');
            ctx.fillStyle = dotCol;
            for (let gx = 20; gx < W; gx += 28) {
                for (let gy = 48; gy < H - 48; gy += 28) {
                    ctx.beginPath();
                    ctx.arc(gx, gy, 1.8, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            const aura = ctx.createRadialGradient(270, 410, 30, 270, 410, 350);
            aura.addColorStop(
                0,
                backdropId === 'tech-dark-indigo'
                    ? `rgba(79, 70, 229, ${0.30 + audioLevel * 0.10})`
                    : (isDark ? `rgba(37, 99, 235, ${0.26 + audioLevel * 0.08})` : 'rgba(255, 255, 255, 0.78)')
            );
            aura.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = aura;
            ctx.fillRect(0, 0, W, H);
            return;
        }

        if (backdropId === 'warm-cream-stage') {
            // Uncluttered signature broadcast studio: soft sunlit cream spotlight + clean horizon floor
            const warmSpot = ctx.createRadialGradient(270, 360, 40, 270, 360, 360);
            warmSpot.addColorStop(0, 'rgba(255, 252, 244, 0.75)');
            warmSpot.addColorStop(1, 'rgba(235, 224, 200, 0)');
            ctx.fillStyle = warmSpot;
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = b.floor;
            ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
            ctx.strokeStyle = b.line;
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.moveTo(0, FLOOR_Y);
            ctx.lineTo(W, FLOOR_Y);
            ctx.stroke();
            return;
        }

        // Baseboard wall molding for interior rooms
        if (!['hills-nature', 'city-skyline', 'server-tech'].includes(backdropId)) {
            ctx.fillStyle = b.wallTrim || b.bot;
            ctx.fillRect(0, FLOOR_Y - 22, W, 22);
        }

        if (backdropId === 'office-shelf') {
            drawOfficeBookshelfAndWindow(ctx, t, audioLevel);
        } else if (backdropId === 'office-desk') {
            // Minimalist clean desk room (NO cloned bookshelf!) with warm pendant lamp & hanging board
            drawOutlinedRect(ctx, 72, 175, 195, 16, 6, '#d97706', '#78350f', 2.4, true);
            drawOutlinedRect(ctx, 94, 130, 32, 45, 5, '#38bdf8', '#1e293b', 2, false);
            drawOutlinedRect(ctx, 136, 138, 28, 37, 5, '#facc15', '#1e293b', 2, false);
            // Warm ceiling pendant lamp right side
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(410, 0);
            ctx.lineTo(410, 128);
            ctx.stroke();
            ctx.fillStyle = 'rgba(254, 240, 138, 0.34)';
            ctx.beginPath();
            ctx.moveTo(378, 152);
            ctx.lineTo(442, 152);
            ctx.lineTo(525, FLOOR_Y);
            ctx.lineTo(295, FLOOR_Y);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#1e293b';
            ctx.beginPath();
            ctx.arc(410, 152, 34, Math.PI, Math.PI * 2);
            ctx.closePath();
            ctx.fill();
        } else if (backdropId === 'work-late') {
            // Late-night desk lamp cone + dim room for working 10 hours/hunched scenes
            const glow = ctx.createRadialGradient(270, 390, 30, 270, 390, 320);
            glow.addColorStop(0, 'rgba(251, 191, 36, 0.22)');
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, W, H);
            drawOutlinedRect(ctx, 340, 118, 164, 150, 10, '#090d16', '#334155', 2.8, true);
            ctx.fillStyle = '#facc15';
            ctx.beginPath();
            ctx.arc(452, 162, 18, 0, Math.PI * 2);
            ctx.fill();
        } else if (backdropId === 'gym-fresh') {
            // Bright airy diagonal sunbeams + crisp wall clock for stretching/active scenes
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.44)';
            ctx.beginPath();
            ctx.moveTo(40, 0);
            ctx.lineTo(220, 0);
            ctx.lineTo(480, FLOOR_Y);
            ctx.lineTo(250, FLOOR_Y);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            drawPottedPlant(ctx, 474, FLOOR_Y, 0.92, Math.sin(t * 2.2));
        } else if (backdropId === 'studio-focus') {
            const spot = ctx.createRadialGradient(270, 410, 25, 270, 410, 310);
            spot.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
            spot.addColorStop(1, 'rgba(219, 234, 254, 0)');
            ctx.fillStyle = spot;
            ctx.fillRect(0, 0, W, H);
        } else if (backdropId === 'bank-vault') {
            // Emerald Finance Vault Dial & subtle golden rays
            ctx.save();
            ctx.strokeStyle = 'rgba(52, 211, 153, 0.24)';
            ctx.lineWidth = 4;
            [115, 165, 215].forEach((r) => {
                ctx.beginPath();
                ctx.arc(270, 395, r, 0, Math.PI * 2);
                ctx.stroke();
            });
            ctx.restore();
        } else if (backdropId === 'home-living') {
            // Cozy Pastel Living Room: wall picture frames + warm floor lamp
            drawOutlinedRect(ctx, 56, 155, 110, 86, 10, '#ffffff', '#b45309', 2.4, true);
            drawOutlinedRect(ctx, 184, 175, 88, 66, 10, '#fef3c7', '#b45309', 2.2, true);
            // Warm floor lamp right
            ctx.strokeStyle = '#78350f';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(458, FLOOR_Y);
            ctx.lineTo(458, 280);
            ctx.stroke();
            ctx.fillStyle = 'rgba(254, 240, 138, 0.32)';
            ctx.beginPath();
            ctx.moveTo(426, 285);
            ctx.lineTo(490, 285);
            ctx.lineTo(525, FLOOR_Y);
            ctx.lineTo(395, FLOOR_Y);
            ctx.closePath();
            ctx.fill();
            drawOutlinedRect(ctx, 424, 224, 68, 60, 12, '#fef08a', '#92400e', 2.6, true);
        } else if (backdropId === 'street-rain') {
            // Urban street lights bokeh + soft diagonal rain streaks
            [[95, 210], [270, 180], [440, 230]].forEach(([bx, by], i) => {
                ctx.fillStyle = i === 1 ? 'rgba(250, 204, 21, 0.16)' : 'rgba(56, 189, 248, 0.18)';
                ctx.beginPath();
                ctx.arc(bx, by, 44, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.strokeStyle = 'rgba(147, 197, 253, 0.25)';
            ctx.lineWidth = 2;
            for (let i = 0; i < 14; i++) {
                const rx = (i * 42 + Math.floor(t * 90)) % W;
                const ry = 120 + ((i * 87 + Math.floor(t * 280)) % 560);
                ctx.beginPath();
                ctx.moveTo(rx, ry);
                ctx.lineTo(rx - 10, ry + 28);
                ctx.stroke();
            }
        } else if (backdropId === 'warning-stage') {
            // High-contrast dark alert radial spotlight
            const warnGlow = ctx.createRadialGradient(270, 395, 30, 270, 395, 310);
            warnGlow.addColorStop(0, `rgba(244, 63, 94, ${0.28 + Math.abs(Math.sin(t * 5)) * 0.12})`);
            warnGlow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = warnGlow;
            ctx.fillRect(0, 0, W, H);
        } else if (backdropId === 'bedroom-night' || backdropId === 'night-calm') {
            drawOutlinedRect(ctx, 318, 118, 174, 210, 12, '#020617', '#4f46e5', 3.5, true);
            ctx.save();
            ctx.fillStyle = 'rgba(129, 140, 248, 0.14)';
            ctx.beginPath();
            ctx.moveTo(318, 328);
            ctx.lineTo(492, 328);
            ctx.lineTo(360, FLOOR_Y);
            ctx.lineTo(90, FLOOR_Y);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(405, 118);
            ctx.lineTo(405, 328);
            ctx.moveTo(318, 223);
            ctx.lineTo(492, 223);
            ctx.stroke();

            ctx.fillStyle = '#fef08a';
            ctx.beginPath();
            ctx.arc(442, 168, 28, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#020617';
            ctx.beginPath();
            ctx.arc(455, 159, 24, 0, Math.PI * 2);
            ctx.fill();
            [[72, 165], [150, 210], [248, 145], [358, 165], [462, 268]].forEach(([sx, sy], i) => {
                ctx.fillStyle = `rgba(254, 240, 138, ${0.4 + 0.5 * Math.sin(t * 3 + i)})`;
                ctx.beginPath();
                ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
                ctx.fill();
            });
        } else if (backdropId === 'kitchen-cozy') {
            ctx.strokeStyle = 'rgba(194, 65, 12, 0.13)';
            ctx.lineWidth = 2;
            for (let ty = 150; ty < FLOOR_Y; ty += 52) {
                ctx.beginPath();
                ctx.moveTo(0, ty);
                ctx.lineTo(W, ty);
                ctx.stroke();
            }
            for (let tx = 40; tx < W; tx += 76) {
                ctx.beginPath();
                ctx.moveTo(tx, 150);
                ctx.lineTo(tx, FLOOR_Y);
                ctx.stroke();
            }
            drawOutlinedRect(ctx, 48, 212, 210, 14, 6, '#b45309', '#1e293b', 2.5, true);
            drawOutlinedRect(ctx, 74, 168, 36, 44, 8, '#34d399', '#1e293b', 2, false);
            drawOutlinedRect(ctx, 124, 162, 38, 50, 8, '#fbbf24', '#1e293b', 2, false);
            drawPottedPlant(ctx, 466, FLOOR_Y, 0.9, Math.sin(t * 2));
        } else if (backdropId === 'cafe-chill') {
            // Large warm window looking out + pendant lamps
            drawOutlinedRect(ctx, 175, 125, 190, 195, 16, '#fef3c7', '#92400e', 3, true);
            [115, 425].forEach((lx, idx) => {
                const sway = Math.sin(t * 1.8 + idx) * 5;
                ctx.strokeStyle = '#78350f';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(lx, 0);
                ctx.lineTo(lx + sway, 138);
                ctx.stroke();
                ctx.fillStyle = 'rgba(254, 240, 138, 0.36)';
                ctx.beginPath();
                ctx.arc(lx + sway, 172, 64 + audioLevel * 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#92400e';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2.6;
                ctx.beginPath();
                ctx.arc(lx + sway, 148, 30, Math.PI, Math.PI * 2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            });
            drawPottedPlant(ctx, 56, FLOOR_Y, 0.95, Math.sin(t * 1.6));
        } else if (backdropId === 'server-tech') {
            [36, 422].forEach((rx, col) => {
                drawOutlinedRect(ctx, rx, 190, 82, FLOOR_Y - 190, 8, '#0f172a', '#334155', 2.5, true);
                for (let row = 0; row < 8; row++) {
                    const ry = 215 + row * 64;
                    drawOutlinedRect(ctx, rx + 10, ry, 62, 44, 4, '#1e293b', '#334155', 1.8, false);
                    const isAlert = (Math.floor(t * 5 + row + col) % 3) === 0;
                    ctx.fillStyle = isAlert ? '#ef4444' : '#22c55e';
                    ctx.beginPath();
                    ctx.arc(rx + 22, ry + 22, 4.5 + audioLevel * 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        } else if (backdropId === 'hills-nature') {
            ctx.fillStyle = b.hill;
            ctx.beginPath();
            ctx.moveTo(0, FLOOR_Y - 35);
            ctx.quadraticCurveTo(145, FLOOR_Y - 98, 290, FLOOR_Y - 40);
            ctx.quadraticCurveTo(420, FLOOR_Y - 10, W, FLOOR_Y - 55);
            ctx.lineTo(W, H);
            ctx.lineTo(0, H);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = b.floor;
            ctx.beginPath();
            ctx.moveTo(0, FLOOR_Y - 15);
            ctx.quadraticCurveTo(210, FLOOR_Y - 62, 410, FLOOR_Y - 12);
            ctx.quadraticCurveTo(485, FLOOR_Y + 5, W, FLOOR_Y - 22);
            ctx.lineTo(W, H);
            ctx.lineTo(0, H);
            ctx.closePath();
            ctx.fill();
            drawPalmTree(ctx, 56, FLOOR_Y, 0.96, Math.sin(t * 2));
            drawPalmTree(ctx, W - 56, FLOOR_Y, 0.96, Math.cos(t * 2));
            return;
        } else if (backdropId === 'city-skyline') {
            // Soft drifting clouds
            ctx.fillStyle = 'rgba(255,255,255,0.68)';
            [[90 + ((t * 14) % 180), 130], [310 + ((t * 10) % 150), 185]].forEach(([cx, cy]) => {
                ctx.beginPath();
                ctx.arc(cx, cy, 24, 0, Math.PI * 2);
                ctx.arc(cx + 22, cy - 8, 28, 0, Math.PI * 2);
                ctx.arc(cx + 46, cy, 22, 0, Math.PI * 2);
                ctx.fill();
            });
            const buildings = [
                { x: 18, w: 78, h: 270, c: '#94a3b8' },
                { x: 108, w: 88, h: 350, c: '#788ba4' },
                { x: 208, w: 96, h: 395, c: '#64748b' },
                { x: 316, w: 86, h: 310, c: '#788ba4' },
                { x: 414, w: 94, h: 255, c: '#94a3b8' }
            ];
            buildings.forEach((bd, idx) => {
                const rise = easeOutCubic(clamp01(progress * 2.2 - idx * 0.04));
                const bh = bd.h * Math.max(0.75, rise);
                const by = FLOOR_Y - bh;
                drawOutlinedRect(ctx, bd.x, by, bd.w, bh, 6, bd.c, '#334155', 2.4, false);
                ctx.fillStyle = '#fef08a';
                for (let wy = by + 20; wy < FLOOR_Y - 28; wy += 34) {
                    for (let wx = bd.x + 14; wx < bd.x + bd.w - 20; wx += 26) {
                        ctx.fillRect(wx, wy, 13, 18);
                    }
                }
            });
        } else if (backdropId === 'alert-tint') {
            const pulseAlpha = 0.09 + Math.abs(Math.sin(t * 5)) * 0.08 + audioLevel * 0.06;
            ctx.save();
            ctx.fillStyle = `rgba(225, 29, 72, ${pulseAlpha})`;
            ctx.beginPath();
            ctx.arc(270, 405, 240, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.34)';
            ctx.beginPath();
            ctx.arc(270, 385, 200 + Math.sin(t * 2) * 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            drawPottedPlant(ctx, 56, FLOOR_Y, 0.92, Math.sin(t * 1.6));
        }

        // Horizon Floor
        ctx.fillStyle = b.floor;
        ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
        ctx.strokeStyle = b.line;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, FLOOR_Y);
        ctx.lineTo(W, FLOOR_Y);
        ctx.stroke();
    }

    // ---- Cel-Shaded Expressive Multi-Cast Cartoon Head (Neck + Ears + Highlighted Hair + 4-stage Audio Lip-Sync) ----
    function drawCharacterHead(ctx, hx, hy, t, mood = 'happy', audioLevel = 0, cast = 'narrator', shirtExtra = {}) {
        const prof = CAST_PROFILES[cast] || CAST_PROFILES.narrator;
        const blink = Math.sin(t * 2.2 + hx * 0.3) > 0.965;
        const tilt = Math.sin(t * 3.1 + hy * 0.01) * 0.025 + audioLevel * 0.03;

        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(tilt);

        // Neck + Chin shadow before head
        drawOutlinedRect(ctx, -10, 30, 20, 22, 6, prof.skinShade, '#1e293b', 2.4, false);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(-9, 34, 18, 6);

        // Back hair / Top bun silhouette behind face
        if (prof.style === 'top-bun' || prof.style === 'high-bun') {
            ctx.fillStyle = prof.hair;
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2.8;
            ctx.beginPath();
            ctx.arc(0, -49, 17, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            // Hair tie / clip accent
            drawOutlinedRect(ctx, -13, -38, 26, 7, 3, prof.style === 'top-bun' ? '#f472b6' : '#fb923c', '#1e293b', 2, false);
            // Side long locks behind neck
            ctx.fillStyle = prof.hair;
            ctx.beginPath();
            ctx.roundRect(-41, -10, 12, 46, 6);
            ctx.roundRect(29, -10, 12, 46, 6);
            ctx.fill();
            ctx.stroke();
        }

        // Side Ears
        [-39, 39].forEach((ex) => {
            ctx.fillStyle = prof.skin;
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.ellipse(ex, 4, 6.5, 9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });

        // Contoured Anime/Cartoon Face (rounded forehead + tapered chin)
        ctx.fillStyle = prof.skin;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-39, -6);
        ctx.bezierCurveTo(-40, -46, 40, -46, 39, -6);
        ctx.bezierCurveTo(39, 25, 18, 41, 0, 41);
        ctx.bezierCurveTo(-18, 41, -39, 25, -39, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Forehead / Front Hair Layers + Cel Highlight
        ctx.fillStyle = prof.hair;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.4;
        if (prof.style === 'spiky') {
            ctx.beginPath();
            ctx.moveTo(-40, -8);
            ctx.lineTo(-34, -40);
            ctx.lineTo(-19, -29);
            ctx.lineTo(-6, -50);
            ctx.lineTo(8, -28);
            ctx.lineTo(23, -47);
            ctx.lineTo(35, -24);
            ctx.lineTo(40, -6);
            ctx.quadraticCurveTo(0, -23, -40, -8);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else if (prof.style === 'parted') {
            ctx.beginPath();
            ctx.arc(0, -10, 40, Math.PI * 0.94, Math.PI * 2.06);
            ctx.lineTo(38, 0);
            ctx.quadraticCurveTo(10, -20, 4, -3);
            ctx.quadraticCurveTo(-8, -21, -38, 0);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(0, -10, 40, Math.PI * 0.96, Math.PI * 2.04);
            ctx.lineTo(38, -2);
            ctx.quadraticCurveTo(12, -24, 0, -10);
            ctx.quadraticCurveTo(-12, -24, -38, -2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        // Subtle glossy hair highlight arc
        ctx.strokeStyle = prof.hairHi;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, -18, 25, Math.PI * 1.18, Math.PI * 1.48);
        ctx.stroke();

        // Eyes with dual highlight catchlights + squinting celebrate
        if (mood === 'sleepy' || blink) {
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-21, -1);
            ctx.quadraticCurveTo(-15, 3, -9, -1);
            ctx.moveTo(9, -1);
            ctx.quadraticCurveTo(15, 3, 21, -1);
            ctx.stroke();
        } else {
            const eyeR = mood === 'shocked' ? 8.6 : 7.2;
            const pupilShift = Math.sin(t * 1.6) * 1.4;
            [-14, 14].forEach((ex) => {
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2.1;
                ctx.beginPath();
                ctx.ellipse(ex, -2, eyeR, eyeR * 1.08, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // Upper lash accent line
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(ex, -2, eyeR, Math.PI * 1.1, Math.PI * 1.9);
                ctx.stroke();

                // Iris + pupil + white catchlight
                ctx.fillStyle = '#0f172a';
                const pr = mood === 'shocked' ? 3.5 : 4.4;
                ctx.beginPath();
                ctx.arc(ex + pupilShift, -1.5, pr, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(ex + pupilShift - 1.5, -3.5, 1.7, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // Glasses for boy-spiky / manager-red
        if (prof.glasses) {
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2.4;
            drawOutlinedRect(ctx, -26, -11, 22, 17, 4, 'rgba(255,255,255,0.16)', '#1e293b', 2.2, false);
            drawOutlinedRect(ctx, 4, -11, 22, 17, 4, 'rgba(255,255,255,0.16)', '#1e293b', 2.2, false);
            ctx.beginPath();
            ctx.moveTo(-4, -3);
            ctx.lineTo(4, -3);
            ctx.stroke();
        }

        // Expressive Eyebrows
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        if (mood === 'thinking') {
            ctx.beginPath();
            ctx.moveTo(-22, -14);
            ctx.lineTo(-8, -16);
            ctx.moveTo(8, -18);
            ctx.quadraticCurveTo(15, -21, 22, -14);
            ctx.stroke();
        } else if (mood === 'shocked') {
            ctx.beginPath();
            ctx.moveTo(-22, -17);
            ctx.quadraticCurveTo(-15, -21, -8, -14);
            ctx.moveTo(8, -14);
            ctx.quadraticCurveTo(15, -21, 22, -17);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.moveTo(-21, -13);
            ctx.quadraticCurveTo(-14, -16, -8, -14);
            ctx.moveTo(8, -14);
            ctx.quadraticCurveTo(14, -16, 21, -13);
            ctx.stroke();
        }

        // Subtle Nose Line & Rosy Cheeks
        ctx.strokeStyle = prof.skinShade;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(0, 3);
        ctx.lineTo(-2, 9);
        ctx.lineTo(2, 9.5);
        ctx.stroke();

        ctx.fillStyle = 'rgba(244, 63, 94, 0.28)';
        ctx.beginPath();
        ctx.ellipse(-24, 11, 5.5, 3.8, 0, 0, Math.PI * 2);
        ctx.ellipse(24, 11, 5.5, 3.8, 0, 0, Math.PI * 2);
        ctx.fill();

        // 5-Shape Real Phonetic Viseme Lip-Sync (closed -> soft murmur -> wide vowel w/ teeth -> rounded O -> spread E/I)
        const talkOpen = clamp01(audioLevel * 1.55);
        const viseme = audioLevel >= 0.12 && currentAudioViseme >= 0
            ? currentAudioViseme
            : (talkOpen > 0.56 ? (Math.sin(t * 17) > 0.35 ? 3 : 2) : (talkOpen > 0.25 ? 4 : (talkOpen > 0.10 ? 1 : 0)));
        const jawY = 19 + talkOpen * 1.6;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        if (mood === 'shocked' && talkOpen < 0.25) {
            ctx.fillStyle = '#9f1239';
            ctx.beginPath();
            ctx.ellipse(0, 20, 8.5, 10, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (viseme === 3 && talkOpen > 0.18) {
            // Rounded O / Ô / U shape
            const rX = 7.2 + talkOpen * 2.5;
            const rY = 8.4 + talkOpen * 3.6;
            ctx.fillStyle = '#881337';
            ctx.beginPath();
            ctx.ellipse(0, jawY, rX, rY, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#fb7185';
            ctx.beginPath();
            ctx.ellipse(0, jawY + rY * 0.35, rX * 0.55, rY * 0.3, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (viseme === 4 && talkOpen > 0.14) {
            // Spread E / I / Ê expressive band with white upper teeth
            const mw = 13 + talkOpen * 3.2;
            const mh = 4.6 + talkOpen * 3.8;
            ctx.fillStyle = '#881337';
            ctx.beginPath();
            ctx.ellipse(0, jawY - 0.5, mw, mh, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(-mw * 0.72, jawY - mh * 0.85, mw * 1.44, 3.8, 2);
            ctx.fill();
        } else if (viseme === 2 || talkOpen > 0.38) {
            const mh = 6.2 + talkOpen * 8.6;
            const mw = 11.2 + talkOpen * 3;
            ctx.fillStyle = '#881337';
            ctx.beginPath();
            ctx.ellipse(0, jawY, mw, mh, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(-mw * 0.65, jawY - mh * 0.85, mw * 1.3, 4.2, 2);
            ctx.fill();
            ctx.fillStyle = '#fb7185';
            ctx.beginPath();
            ctx.ellipse(0, jawY + mh * 0.38, mw * 0.56, mh * 0.34, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (viseme === 1 || talkOpen > 0.09) {
            ctx.fillStyle = '#9f1239';
            ctx.beginPath();
            ctx.ellipse(0, 19, 9.2, 3.8 + talkOpen * 3.8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.beginPath();
            if (mood === 'thinking') {
                ctx.moveTo(-8, 19);
                ctx.quadraticCurveTo(0, 18, 9, 20);
            } else {
                ctx.arc(0, 15, 9.5, 0.16 * Math.PI, 0.84 * Math.PI);
            }
            ctx.stroke();
        }

        if (shirtExtra.headphone) {
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(0, -5, 44, Math.PI * 0.95, Math.PI * 2.05);
            ctx.stroke();
            drawOutlinedRect(ctx, -49, -12, 13, 28, 6, '#a855f7', '#0f172a', 2.4, false);
            drawOutlinedRect(ctx, 36, -12, 13, 28, 6, '#a855f7', '#0f172a', 2.4, false);
        }

        ctx.restore();
    }

    // ---- Comic Reaction Badges attached near speaking character ----
    function drawComicReaction(ctx, rx, ry, mood, audioLevel, t) {
        if (audioLevel < 0.32 && mood === 'happy') return;
        const bob = Math.sin(t * 7) * 3;
        ctx.save();
        ctx.translate(rx, ry + bob);
        if (mood === 'shocked') {
            drawOutlinedRect(ctx, -18, -22, 36, 44, 12, '#fef2f2', '#ef4444', 2.8, true);
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(-3.5, -13, 7, 17);
            ctx.beginPath();
            ctx.arc(0, 11, 4, 0, Math.PI * 2);
            ctx.fill();
        } else if (mood === 'thinking') {
            drawOutlinedRect(ctx, -20, -20, 40, 40, 14, '#fef3c7', '#d97706', 2.6, true);
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(0, -4, 7, Math.PI * 0.9, Math.PI * 2.15);
            ctx.lineTo(0, 6);
            ctx.stroke();
            ctx.fillStyle = '#d97706';
            ctx.beginPath();
            ctx.arc(0, 12, 2.5, 0, Math.PI * 2);
            ctx.fill();
        } else if (audioLevel > 0.35) {
            // Minimal pulsing audio voice wave arcs
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 2.8;
            ctx.lineCap = 'round';
            [8, 16].forEach((r, idx) => {
                ctx.globalAlpha = Math.max(0.25, audioLevel - idx * 0.2);
                ctx.beginPath();
                ctx.arc(-6, 0, r, -0.35 * Math.PI, 0.35 * Math.PI);
                ctx.stroke();
            });
        }
        ctx.restore();
    }

    // ---- Seated Office Desk Character (Detailed Collar/Lapels, Ergonomic Chair, Glowing Monitor + Desk Mug) ----
    function drawSeatedDeskCharacter(ctx, cx, cy, scale, t, cast = 'girl-purple', mood = 'happy', audioLevel = 0, isCalling = false) {
        if (scale <= 0.02) return;
        const prof = CAST_PROFILES[cast] || CAST_PROFILES['girl-purple'];
        const bob = Math.sin(t * 3 + cx) * 1.6 + audioLevel * -2.2;

        ctx.save();
        ctx.translate(cx, cy + bob);
        ctx.scale(scale, scale);

        // Ergonomic Mesh Office Chair Backrest + Headrest bar
        drawOutlinedRect(ctx, -56, -74, 112, 120, 24, '#cbd5e1', '#64748b', 2.6, false);
        drawOutlinedRect(ctx, -46, -64, 92, 92, 18, '#e2e8f0', null, 0, false);

        // Contoured Torso & Cel-Shaded Collar + Lapels
        drawOutlinedRect(ctx, -44, -6, 88, 72, 22, prof.shirt, '#1e293b', 2.8, false);
        ctx.fillStyle = prof.shirtShade;
        ctx.beginPath();
        ctx.roundRect(-44, 34, 88, 30, 12);
        ctx.fill();

        // Inner shirt V-collar + optional tie
        ctx.fillStyle = prof.inner;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-16, -6);
        ctx.lineTo(0, 16);
        ctx.lineTo(16, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (prof.tie) {
            ctx.fillStyle = prof.tie;
            ctx.beginPath();
            ctx.moveTo(-5, 6);
            ctx.lineTo(5, 6);
            ctx.lineTo(6, 36);
            ctx.lineTo(0, 42);
            ctx.lineTo(-6, 36);
            ctx.closePath();
            ctx.fill();
        }

        if (isCalling) {
            drawArticulatedLimb(ctx, 32, 6, 48, -14, 38, -48, 14, prof.shirt, '#1e293b', prof.skin, false);
            drawOutlinedRect(ctx, 30, -76, 18, 34, 5, '#0f172a', '#1e293b', 2, false);
            // Phone call ring pulse
            ctx.strokeStyle = `rgba(37, 99, 235, ${0.4 + Math.abs(Math.sin(t * 7)) * 0.5})`;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.arc(48, -64, 12, -0.5, 0.5);
            ctx.stroke();
        } else if (audioLevel > 0.28) {
            // Expressive hand gesture above desk while speaking!
            drawArticulatedLimb(ctx, 34, 8, 56, 22, 62, -6 + Math.sin(t * 9) * 5, 13, prof.shirt, '#1e293b', prof.skin, true);
        }

        drawCharacterHead(ctx, 0, -56, t, mood, audioLevel, cast);

        // Wooden Desk Top + Front Skirt
        drawOutlinedRect(ctx, -114, 48, 228, 18, 6, '#eab37c', '#9c6f44', 2.8, true);
        drawOutlinedRect(ctx, -110, 64, 220, 34, 4, '#d19c68', '#9c6f44', 2.6, false);

        // Laptop lid facing camera with realistic metallic bezel + soft screen glow behind
        drawOutlinedRect(ctx, -50, 4, 100, 64, 9, '#cbd5e1', '#475569', 2.5, true);
        drawOutlinedRect(ctx, -44, 10, 88, 52, 6, '#e2e8f0', null, 0, false);
        if (prof.laptopDot) {
            ctx.fillStyle = '#fb923c';
            ctx.beginPath();
            ctx.arc(0, 36, 9.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-8, 30);
            ctx.lineTo(-9, 21);
            ctx.lineTo(-2, 28);
            ctx.moveTo(8, 30);
            ctx.lineTo(9, 21);
            ctx.lineTo(2, 28);
            ctx.fill();
        } else {
            const dots = ['#ef4444', '#facc15', '#22c55e', '#3b82f6'];
            dots.forEach((dc, idx) => {
                ctx.fillStyle = dc;
                ctx.beginPath();
                ctx.arc(-21 + idx * 14, 36, 4.5, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // Desk Coffee Mug with handle + soft steam on corner
        drawOutlinedRect(ctx, 72, 28, 22, 22, 5, '#ffffff', '#1e293b', 2.2, false);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(94, 39, 5.5, -Math.PI * 0.5, Math.PI * 0.5);
        ctx.stroke();

        ctx.restore();
    }

    // ---- Screen Content Renderer inside Devices / Windows (matches scene context!) ----
    function drawRichScreenContent(ctx, x, y, w, h, screenType, progress, t, audioLevel = 0) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 8);
        ctx.clip();

        if (screenType === 'chat_msg' || screenType === 'night_scroll') {
            ctx.fillStyle = screenType === 'night_scroll' ? '#0f172a' : '#f1f5f9';
            ctx.fillRect(x, y, w, h);
            // Animated chat bubbles popping sequentially
            const b1 = stagePop(progress, 0.05, 0.18);
            const b2 = stagePop(progress, 0.30, 0.18);
            const b3 = stagePop(progress, 0.58, 0.18);
            if (b1 > 0.05) {
                drawOutlinedRect(ctx, x + 12, y + 16, w * 0.62 * b1, h * 0.22, 10, '#cbd5e1', '#64748b', 1.5, false);
            }
            if (b2 > 0.05) {
                drawOutlinedRect(ctx, x + w - 12 - w * 0.64 * b2, y + h * 0.44, w * 0.64 * b2, h * 0.22, 10, '#3b82f6', '#1d4ed8', 1.5, false);
            }
            if (b3 > 0.05) {
                drawOutlinedRect(ctx, x + 12, y + h * 0.72, w * 0.45 * b3, h * 0.18, 10, '#fecaca', '#ef4444', 1.5, false);
            }
        } else if (screenType === 'excel_err' || screenType === 'code_bug') {
            ctx.fillStyle = screenType === 'code_bug' ? '#090d16' : '#f8fafc';
            ctx.fillRect(x, y, w, h);
            const rows = 4;
            const rowH = (h - 24) / rows;
            for (let r = 0; r < rows; r++) {
                const ry = y + 12 + r * rowH;
                const isErr = r === 1 || (r === 2 && Math.sin(t * 8) > 0);
                drawOutlinedRect(
                    ctx,
                    x + 10,
                    ry + 2,
                    w - 20,
                    rowH - 6,
                    6,
                    isErr ? 'rgba(239, 68, 68, 0.24)' : 'rgba(148, 163, 184, 0.18)',
                    isErr ? '#ef4444' : '#94a3b8',
                    isErr ? 2 : 1,
                    false
                );
                if (isErr) {
                    ctx.strokeStyle = '#ef4444';
                    ctx.lineWidth = 3;
                    const cxE = x + w - 26;
                    const cyE = ry + rowH * 0.45;
                    ctx.beginPath();
                    ctx.moveTo(cxE - 6, cyE - 6);
                    ctx.lineTo(cxE + 6, cyE + 6);
                    ctx.moveTo(cxE + 6, cyE - 6);
                    ctx.lineTo(cxE - 6, cyE + 6);
                    ctx.stroke();
                }
            }
        } else if (screenType === 'revenue_up' || screenType === 'wallet_cash') {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(x, y, w, h);
            const grow = easeOutCubic(clamp01(progress * 1.35));
            const bars = [0.32, 0.48, 0.65, 0.92];
            const bw = (w - 44) / 4;
            bars.forEach((ratio, idx) => {
                const bh = (h - 30) * ratio * grow * (idx === 3 ? 1 + audioLevel * 0.08 : 1);
                drawOutlinedRect(ctx, x + 14 + idx * (bw + 6), y + h - 14 - bh, bw, bh, 5, idx === 3 ? '#22c55e' : '#38bdf8', null, 0, false);
            });
            // Trend line
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(x + 20, y + h * 0.72);
            ctx.lineTo(x + 20 + (w - 40) * grow, y + h * 0.72 - h * 0.5 * grow);
            ctx.stroke();
        } else {
            // checklist_done / calendar_due / notification_bell
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(x, y, w, h);
            for (let i = 0; i < 3; i++) {
                const ry = y + 14 + i * ((h - 24) / 3);
                const done = progress > 0.18 + i * 0.22;
                drawOutlinedRect(ctx, x + 12, ry, w - 24, (h - 36) / 3, 8, '#ffffff', done ? '#22c55e' : '#cbd5e1', 1.8, false);
                ctx.fillStyle = done ? '#22c55e' : '#cbd5e1';
                ctx.beginPath();
                ctx.arc(x + 28, ry + (h - 36) / 6, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = done ? '#1e293b' : '#94a3b8';
                ctx.fillRect(x + 44, ry + (h - 36) / 6 - 4, w - 74, 8);
            }
        }
        ctx.restore();
    }

    // ---- 11 Expressive Standing/Action Poses (Articulated Cel-Shaded Poses) ----
    function drawAnimatedActor(ctx, cx, cy, scale, progress, t, action = 'pointing', mood = 'happy', audioLevel = 0, cast = 'narrator') {
        if (scale <= 0.02) return;
        const prof = CAST_PROFILES[cast] || CAST_PROFILES.narrator;
        const shirtColor = prof.shirt;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);

        if (action === 'sleeping') {
            const breathe = Math.sin(t * 2.5) * 3;
            drawOutlinedRect(ctx, -145, 22, 290, 62, 16, '#818cf8', '#1e293b', 3.4, true);
            drawOutlinedRect(ctx, -155, -24, 22, 118, 8, '#475569', '#1e293b', 3, false);
            drawOutlinedRect(ctx, 133, 4, 22, 90, 8, '#475569', '#1e293b', 3, false);
            drawOutlinedRect(ctx, -128, -4, 72, 34, 12, '#ffffff', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, -56, 8 + breathe * 0.3, 195, 58, 18, '#a78bfa', '#1e293b', 3, false);
            drawCharacterHead(ctx, -90, -24 + breathe * 0.5, t, 'sleepy', audioLevel * 0.25, cast);
            for (let z = 0; z < 3; z++) {
                const zp = (t * 0.45 + z * 0.33) % 1;
                const zx = -40 + z * 28 + Math.sin(t * 3 + z) * 6;
                const zy = -55 - zp * 75;
                ctx.save();
                ctx.globalAlpha = 1 - zp;
                ctx.strokeStyle = '#fde047';
                ctx.lineWidth = 3.5;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(zx - 8, zy - 8);
                ctx.lineTo(zx + 8, zy - 8);
                ctx.lineTo(zx - 8, zy + 8);
                ctx.lineTo(zx + 8, zy + 8);
                ctx.stroke();
                ctx.restore();
            }
            ctx.restore();
            return;
        }

        if (action === 'typing') {
            const typeBob = Math.sin(t * 14) * (1.8 + audioLevel * 2.5);
            drawOutlinedRect(ctx, -140, 36, 280, 18, 7, '#eab37c', '#8c6239', 3, true);
            drawOutlinedRect(ctx, -122, 54, 16, 74, 4, '#b47c4a', '#78502b', 2.6, false);
            drawOutlinedRect(ctx, 106, 54, 16, 74, 4, '#b47c4a', '#78502b', 2.6, false);

            drawOutlinedRect(ctx, -38, -16 + typeBob * 0.4, 76, 56, 16, shirtColor, '#1e293b', 3, false);
            drawCharacterHead(ctx, 0, -56 + typeBob * 0.5, t, mood, audioLevel, cast);
            drawArticulatedLimb(ctx, -36, -2, -52, 18, -32, 24 + Math.sin(t * 16) * 4, 13, shirtColor, '#1e293b', prof.skin);
            drawArticulatedLimb(ctx, 36, -2, 52, 18, 32, 24 + Math.cos(t * 16) * 4, 13, shirtColor, '#1e293b', prof.skin);

            drawOutlinedRect(ctx, -64, -28, 128, 66, 10, '#334155', '#0f172a', 3, true);
            drawRichScreenContent(ctx, -56, -20, 112, 50, mood === 'shocked' ? 'excel_err' : 'revenue_up', progress, t, audioLevel);
            drawOutlinedRect(ctx, 84, 8, 24, 28, 6, '#ffffff', '#1e293b', 2.4, false);
            ctx.restore();
            return;
        }

        if (action === 'cooking') {
            const stir = Math.sin(t * 8) * 14;
            drawOutlinedRect(ctx, -145, 42, 290, 86, 12, '#fed7aa', '#1e293b', 3.2, true);
            drawOutlinedRect(ctx, -38, -16, 76, 62, 16, shirtColor, '#1e293b', 3, false);
            drawOutlinedRect(ctx, -24, 0, 48, 44, 8, '#ffffff', '#1e293b', 2.2, false);
            drawCharacterHead(ctx, 0, -56, t, mood, audioLevel, cast);
            drawOutlinedRect(ctx, -78, 22, 92, 22, 8, '#475569', '#0f172a', 3, false);
            drawOutlinedRect(ctx, 14, 26, 46, 10, 5, '#1e293b', '#0f172a', 2, false);
            ctx.save();
            ctx.translate(-32 + stir * 0.5, 16);
            ctx.rotate(stir * 0.02);
            drawOutlinedRect(ctx, -4, -36, 8, 42, 4, '#d97706', '#1e293b', 2, false);
            ctx.restore();
            drawArticulatedLimb(ctx, 32, -2, 48, 10, 26, 14 + Math.sin(t * 8) * 5, 13, shirtColor, '#1e293b', prof.skin);
            ctx.restore();
            return;
        }

        if (action === 'phone-scroll' || action === 'shocked-phone' || action === 'calling') {
            const shake = action === 'shocked-phone' ? Math.sin(t * 22) * 3.2 : Math.sin(t * 4) * 1.8;
            ctx.translate(shake, Math.sin(t * 4.5) * 2.5);
            ctx.fillStyle = 'rgba(15,23,42,0.14)';
            ctx.beginPath();
            ctx.ellipse(0, 122, 44, 8, 0, 0, Math.PI * 2);
            ctx.fill();

            drawArticulatedLimb(ctx, -14, 56, -16, 86, -18, 112, 16, '#334155', '#1e293b');
            drawArticulatedLimb(ctx, 14, 56, 16, 86, 18, 112, 16, '#334155', '#1e293b');
            drawOutlinedRect(ctx, -28, 108, 22, 12, 6, '#1e293b', '#0f172a', 2, false);
            drawOutlinedRect(ctx, 6, 108, 22, 12, 6, '#1e293b', '#0f172a', 2, false);

            drawOutlinedRect(ctx, -30, -14, 60, 76, 16, shirtColor, '#1e293b', 3, true);
            drawOutlinedRect(ctx, -11, -14, 22, 74, 4, prof.inner, null, 0, false);
            drawCharacterHead(ctx, 0, -56, t, action === 'shocked-phone' ? 'shocked' : mood, audioLevel, cast);

            if (action === 'calling') {
                drawArticulatedLimb(ctx, 28, -2, 48, -18, 40, -52, 13, shirtColor, '#1e293b', prof.skin);
                drawOutlinedRect(ctx, 30, -80, 20, 36, 5, '#0f172a', '#0f172a', 2.4, true);
            } else {
                drawArticulatedLimb(ctx, 26, -2, 44, 14, 54, -8 + Math.sin(t * 6) * 2, 13, shirtColor, '#1e293b', prof.skin);
                drawOutlinedRect(ctx, 48, -46 + Math.sin(t * 7) * 2.5, 48, 82, 10, '#0f172a', '#0f172a', 3, true);
                drawRichScreenContent(ctx, 53, -38 + Math.sin(t * 7) * 2.5, 38, 66, action === 'shocked-phone' ? 'code_bug' : 'chat_msg', progress, t, audioLevel);
            }
            ctx.restore();
            return;
        }

        if (action === 'running') {
            const stride = Math.sin(t * 14);
            ctx.translate(0, Math.abs(stride) * -7);
            ctx.strokeStyle = 'rgba(30, 41, 59, 0.28)';
            ctx.lineWidth = 3;
            [-40, -10, 25].forEach((ly, i) => {
                const lx = -112 - ((t * 180 + i * 30) % 45);
                ctx.beginPath();
                ctx.moveTo(lx, ly);
                ctx.lineTo(lx + 46, ly);
                ctx.stroke();
            });
            drawArticulatedLimb(ctx, -10, 56, -22 + stride * 24, 86, -12 + stride * 34, 112, 15, '#334155', '#1e293b');
            drawArticulatedLimb(ctx, 10, 56, 22 - stride * 24, 86, 12 - stride * 34, 112, 15, '#334155', '#1e293b');
            ctx.rotate(0.16);
            drawOutlinedRect(ctx, -30, -14, 60, 74, 16, shirtColor, '#1e293b', 3, true);
            drawArticulatedLimb(ctx, 26, -2, 44, 12, 50 + stride * 12, -16, 12, shirtColor, '#1e293b', prof.skin);
            drawCharacterHead(ctx, 4, -56, t, mood, audioLevel, cast);
            ctx.restore();
            return;
        }

        if (action === 'celebrating') {
            const jump = Math.abs(Math.sin(t * 6)) * -(10 + audioLevel * 12);
            ctx.translate(0, jump);
            ctx.fillStyle = 'rgba(15,23,42,0.14)';
            ctx.beginPath();
            ctx.ellipse(0, 122 - jump, 44, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            drawArticulatedLimb(ctx, -14, 56, -16, 86, -18, 112, 16, '#334155', '#1e293b');
            drawArticulatedLimb(ctx, 14, 56, 16, 86, 18, 112, 16, '#334155', '#1e293b');
            drawArticulatedLimb(ctx, -28, -2, -52, -26, -42, -58 + Math.sin(t * 8) * 5, 13, shirtColor, '#1e293b', prof.skin);
            drawArticulatedLimb(ctx, 28, -2, 52, -26, 42, -58 + Math.cos(t * 8) * 5, 13, shirtColor, '#1e293b', prof.skin);
            drawOutlinedRect(ctx, -30, -14, 60, 76, 16, shirtColor, '#1e293b', 3, true);
            drawOutlinedRect(ctx, -11, -14, 22, 74, 4, prof.inner, null, 0, false);
            drawCharacterHead(ctx, 0, -56, t, 'happy', audioLevel, cast);
            ctx.restore();
            return;
        }

        if (action === 'hunched-pain') {
            // Character hunched forward painfully over laptop + glowing red curved spine + ache bolts!
            const leanShake = Math.sin(t * 14) * (1.2 + audioLevel * 2);
            drawOutlinedRect(ctx, -145, 40, 290, 18, 7, '#d19c68', '#78502b', 3, true);
            // Hunched ergonomic chair behind character
            drawOutlinedRect(ctx, -108, -42, 24, 118, 10, '#1e293b', '#0f172a', 2.6, false);
            drawOutlinedRect(ctx, -110, 46, 86, 16, 6, '#334155', '#0f172a', 2.4, false);

            // Curved hunched torso leaning forward toward laptop
            ctx.save();
            ctx.translate(-34 + leanShake, 2);
            ctx.rotate(0.42);
            drawOutlinedRect(ctx, -28, -22, 58, 74, 18, shirtColor, '#1e293b', 3, true);
            // Glowing red curved spine line across back
            const pulseAlpha = 0.55 + 0.45 * Math.sin(t * 9);
            ctx.strokeStyle = `rgba(239, 68, 68, ${pulseAlpha})`;
            ctx.lineWidth = 6.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-18, -14);
            ctx.quadraticCurveTo(-36, 16, -12, 46);
            ctx.stroke();
            ctx.restore();

            // Red pain sparks behind lower back
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3.2;
            [[-96, -8], [-110, 14]].forEach(([px, py], i) => {
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px - 14, py - 8 + i * 10);
                ctx.lineTo(px - 6, py + 2);
                ctx.lineTo(px - 22, py - 2);
                ctx.stroke();
            });

            drawCharacterHead(ctx, -2 + leanShake, -42, t, 'shocked', audioLevel, cast);
            drawArticulatedLimb(ctx, -10 + leanShake, 12, 18, 22, 34, 30, 12, shirtColor, '#1e293b', prof.skin);
            // Bright laptop screen glaring at face
            drawOutlinedRect(ctx, 28, -22, 92, 62, 8, '#334155', '#0f172a', 2.8, true);
            drawRichScreenContent(ctx, 35, -15, 78, 48, 'excel_err', progress, t, audioLevel);
            ctx.restore();
            return;
        }

        if (action === 'stretching') {
            // Character standing tall raising arms in energizing V-stretch + bright sparkle aura!
            const reach = Math.sin(t * 4) * 5 + audioLevel * 7;
            ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
            ctx.beginPath();
            ctx.ellipse(0, 122, 48, 9, 0, 0, Math.PI * 2);
            ctx.fill();
            drawArticulatedLimb(ctx, -14, 56, -18, 86, -20, 112, 16, '#334155', '#1e293b');
            drawArticulatedLimb(ctx, 14, 56, 18, 86, 20, 112, 16, '#334155', '#1e293b');
            drawOutlinedRect(ctx, -30, 108, 22, 12, 6, '#1e293b', '#0f172a', 2, false);
            drawOutlinedRect(ctx, 8, 108, 22, 12, 6, '#1e293b', '#0f172a', 2, false);
            drawArticulatedLimb(ctx, -28, -4, -52, -38, -34, -76 - reach, 13, shirtColor, '#1e293b', prof.skin);
            drawArticulatedLimb(ctx, 28, -4, 52, -38, 34, -76 - reach, 13, shirtColor, '#1e293b', prof.skin);
            drawOutlinedRect(ctx, -29, -14, 58, 76, 16, shirtColor, '#1e293b', 3, true);
            drawOutlinedRect(ctx, -11, -14, 22, 74, 4, prof.inner, null, 0, false);
            drawCharacterHead(ctx, 0, -56 - reach * 0.25, t, 'happy', audioLevel, cast);
            drawSparkle(ctx, -64, -78, 11, '#22c55e', t * 2);
            drawSparkle(ctx, 64, -78, 11, '#38bdf8', -t * 2);
            ctx.restore();
            return;
        }

        if (action === 'empty-wallet' || action === 'back-ache') {
            const bob = Math.sin(t * 4) * 2.5;
            ctx.translate(0, bob);
            ctx.fillStyle = 'rgba(15,23,42,0.14)';
            ctx.beginPath();
            ctx.ellipse(0, 122, 44, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            drawArticulatedLimb(ctx, -14, 56, -16, 86, -18, 112, 16, '#334155', '#1e293b');
            drawArticulatedLimb(ctx, 14, 56, 16, 86, 18, 112, 16, '#334155', '#1e293b');
            drawOutlinedRect(ctx, -28, 108, 22, 12, 6, '#1e293b', '#0f172a', 2, false);
            drawOutlinedRect(ctx, 6, 108, 22, 12, 6, '#1e293b', '#0f172a', 2, false);
            if (action === 'back-ache') {
                drawArticulatedLimb(ctx, -28, 0, -48, 26, -24, 42, 13, shirtColor, '#1e293b', prof.skin);
                drawArticulatedLimb(ctx, 28, -2, 44, 18, 56, -8, 13, shirtColor, '#1e293b', prof.skin, true);
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 3.2;
                ctx.beginPath();
                ctx.moveTo(-42, 32);
                ctx.lineTo(-58, 24);
                ctx.lineTo(-50, 36);
                ctx.lineTo(-66, 30);
                ctx.stroke();
            } else {
                drawArticulatedLimb(ctx, -28, 0, -46, 18, -20, 26, 13, shirtColor, '#1e293b', prof.skin);
                drawArticulatedLimb(ctx, 28, 0, 50, 16, 54, 4, 13, shirtColor, '#1e293b', prof.skin);
                // Held open flat brown wallet
                drawOutlinedRect(ctx, 42, -16, 42, 30, 6, '#92400e', '#1e293b', 2.4, true);
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(62, -22);
                ctx.quadraticCurveTo(72, -38, 86, -34);
                ctx.stroke();
            }
            drawOutlinedRect(ctx, -30, -14, 60, 76, 16, shirtColor, '#1e293b', 3, true);
            drawOutlinedRect(ctx, -11, -14, 22, 74, 4, prof.inner, null, 0, false);
            drawCharacterHead(ctx, 0, -56, t, action === 'back-ache' ? mood : 'shocked', audioLevel, cast);
            ctx.restore();
            return;
        }

        // Default standing presenter with articulated pointing/gesturing arm responding to speech energy!
        const bob = Math.sin(t * 4.2) * 2.5 + audioLevel * -2.5;
        ctx.translate(0, bob);
        ctx.fillStyle = 'rgba(15,23,42,0.14)';
        ctx.beginPath();
        ctx.ellipse(0, 122 - bob * 0.5, 44, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        drawArticulatedLimb(ctx, -14, 56, -16, 86, -18, 112, 16, '#334155', '#1e293b');
        drawArticulatedLimb(ctx, 14, 56, 16, 86, 18, 112, 16, '#334155', '#1e293b');
        drawOutlinedRect(ctx, -28, 108, 22, 12, 6, '#1e293b', '#0f172a', 2, false);
        drawOutlinedRect(ctx, 6, 108, 22, 12, 6, '#1e293b', '#0f172a', 2, false);

        // Relaxed left arm + Expressive right pointing/gesturing arm driven by audioLevel!
        drawArticulatedLimb(ctx, -28, -2, -40, 22, -32, 46, 13, shirtColor, '#1e293b', prof.skin);
        const gestureLift = action === 'drinking' ? -28 : (-18 - audioLevel * 24 + Math.sin(t * 6.5) * 6);
        drawArticulatedLimb(ctx, 28, -2, 52, 8, 66, gestureLift, 13, shirtColor, '#1e293b', prof.skin, action === 'pointing');

        // Jacket/Torso + Cel-shade + Collar & Tie
        drawOutlinedRect(ctx, -30, -14, 60, 76, 16, shirtColor, '#1e293b', 3, true);
        drawOutlinedRect(ctx, -11, -14, 22, 74, 4, prof.inner, null, 0, false);
        if (prof.tie) {
            ctx.fillStyle = prof.tie;
            ctx.beginPath();
            ctx.moveTo(-4, -10);
            ctx.lineTo(4, -10);
            ctx.lineTo(5, 22);
            ctx.lineTo(0, 28);
            ctx.lineTo(-5, 22);
            ctx.closePath();
            ctx.fill();
        }
        drawCharacterHead(ctx, 0, -56, t, mood, audioLevel, cast, { headphone: action === 'drinking' && mood === 'happy' });
        ctx.restore();
    }

    // ---- Ambient Particle Effects ----
    function drawAmbientEffects(ctx, effect = 'sparkles', t, audioLevel = 0) {
        const pulse = 1 + audioLevel * 0.4;
        if (effect === 'steam') {
            for (let i = 0; i < 4; i++) {
                const p = (t * 0.4 + i * 0.25) % 1;
                const sx = 220 + i * 38 + Math.sin(t * 3 + i) * 10;
                const sy = 360 - p * 120;
                ctx.save();
                ctx.globalAlpha = (1 - p) * 0.52;
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(sx, sy, 10 + p * 14, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
            return;
        }
        if (effect === 'sweat') {
            for (let i = 0; i < 3; i++) {
                const p = (t * 0.9 + i * 0.3) % 1;
                const x = 95 + i * 165;
                const y = 240 + p * 45;
                ctx.save();
                ctx.globalAlpha = 1 - p;
                ctx.fillStyle = '#38bdf8';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x, y - 12);
                ctx.quadraticCurveTo(x + 9, y + 2, x, y + 9);
                ctx.quadraticCurveTo(x - 9, y + 2, x, y - 12);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
            return;
        }
        if (effect === 'sparks') {
            [[95, 225], [445, 215], [415, 490]].forEach(([sx, sy], i) => {
                drawSparkle(ctx, sx, sy, (11 + audioLevel * 9) * (i % 2 === 0 ? 1 : 0.8), '#ef4444', t * 3 + i);
            });
            return;
        }
        if (effect === 'hearts') {
            for (let i = 0; i < 3; i++) {
                const p = (t * 0.45 + i * 0.33) % 1;
                const hx = 120 + i * 150 + Math.sin(t * 2 + i) * 12;
                const hy = 310 - p * 120;
                ctx.save();
                ctx.globalAlpha = 1 - p;
                ctx.translate(hx, hy);
                ctx.scale(0.24 * pulse, 0.24 * pulse);
                ctx.fillStyle = '#fb7185';
                ctx.beginPath();
                ctx.moveTo(0, 40);
                ctx.bezierCurveTo(-50, 0, -50, -45, -20, -45);
                ctx.bezierCurveTo(-5, -45, 0, -25, 0, -25);
                ctx.bezierCurveTo(0, -25, 5, -45, 20, -45);
                ctx.bezierCurveTo(50, -45, 50, 0, 0, 40);
                ctx.fill();
                ctx.restore();
            }
            return;
        }
        if (effect === 'confetti') {
            const cols = ['#facc15', '#34d399', '#fb7185', '#38bdf8', '#a855f7'];
            for (let i = 0; i < 10; i++) {
                const p = (t * 0.55 + i * 0.11) % 1;
                const cx = 56 + ((i * 52) % 428) + Math.sin(t * 4 + i) * 14;
                const cy = 110 + p * 270;
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(t * 5 + i);
                ctx.fillStyle = cols[i % cols.length];
                ctx.fillRect(-6, -3, 12, 6);
                ctx.restore();
            }
            return;
        }
        if (effect === 'money') {
            for (let i = 0; i < 4; i++) {
                const p = (t * 0.5 + i * 0.25) % 1;
                const mx = 100 + i * 110;
                const my = 140 + p * 210;
                ctx.save();
                ctx.globalAlpha = 1 - p;
                ctx.fillStyle = '#fbbf24';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(mx, my, 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
            return;
        }
        if (effect === 'notes') {
            for (let i = 0; i < 4; i++) {
                const p = (t * 0.5 + i * 0.25) % 1;
                const nx = 90 + i * 120 + Math.sin(t * 3 + i) * 10;
                const ny = 290 - p * 120;
                ctx.save();
                ctx.globalAlpha = 1 - p;
                ctx.fillStyle = i % 2 === 0 ? '#a855f7' : '#38bdf8';
                ctx.beginPath();
                ctx.ellipse(nx, ny, 9 * pulse, 6.5 * pulse, -0.3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillRect(nx + 6, ny - 26, 3.5, 26);
                ctx.restore();
            }
            return;
        }

        const spSize = 9.5 + audioLevel * 7;
        drawSparkle(ctx, 74, 195, spSize, '#fbbf24', t * 1.4);
        drawSparkle(ctx, 466, 240, spSize * 0.85, '#fde047', -t * 1.4);
    }

    // ---- 36 High-Craft Vector Props (with inner Screen/Lighting/Shading detail) ----
    function drawProp(ctx, propId, cx, cy, scale, progress, t, audioLevel = 0, screenType = 'chat_msg') {
        if (scale <= 0.02) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);

        switch (propId) {
            case 'house': {
                drawOutlinedRect(ctx, -82, -20, 164, 122, 8, '#fef3c7', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -20, 36, 40, 66, 6, '#92400e', '#1e293b', 2.8, false);
                drawOutlinedRect(ctx, -64, 8, 32, 32, 5, '#bae6fd', '#1e293b', 2.4, false);
                drawOutlinedRect(ctx, 32, 8, 32, 32, 5, '#bae6fd', '#1e293b', 2.4, false);
                ctx.fillStyle = '#ef4444';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.4;
                ctx.beginPath();
                ctx.moveTo(-102, -16);
                ctx.lineTo(0, -102);
                ctx.lineTo(102, -16);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                break;
            }
            case 'door': {
                drawOutlinedRect(ctx, -64, -105, 128, 210, 12, '#0d9488', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -46, -86, 92, 72, 6, '#14b8a6', '#1e293b', 2.4, false);
                ctx.fillStyle = '#fbbf24';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                ctx.arc(38, 12, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                break;
            }
            case 'city_building': {
                drawOutlinedRect(ctx, -84, -95, 62, 195, 6, '#64748b', '#1e293b', 3, true);
                drawOutlinedRect(ctx, -18, -130, 74, 230, 6, '#475569', '#1e293b', 3, true);
                drawOutlinedRect(ctx, 56, -75, 48, 175, 6, '#94a3b8', '#1e293b', 3, true);
                ctx.fillStyle = '#fef08a';
                for (let ry = -105; ry < 75; ry += 32) {
                    ctx.fillRect(-4, ry, 16, 18);
                    ctx.fillRect(24, ry, 16, 18);
                }
                break;
            }
            case 'bus': {
                ctx.translate(0, Math.sin(t * 7) * 2.5);
                drawOutlinedRect(ctx, -110, -56, 220, 108, 18, '#facc15', '#1e293b', 3.4, true);
                [-72, -16, 40].forEach((wx) => drawOutlinedRect(ctx, wx, -38, 42, 34, 6, '#bae6fd', '#1e293b', 2.4, false));
                [-64, 64].forEach((cxW) => {
                    ctx.fillStyle = '#1e293b';
                    ctx.beginPath();
                    ctx.arc(cxW, 54, 22, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#cbd5e1';
                    ctx.beginPath();
                    ctx.arc(cxW, 54, 10, 0, Math.PI * 2);
                    ctx.fill();
                });
                break;
            }
            case 'scooter': {
                drawOutlinedRect(ctx, -84, -18, 168, 52, 24, '#ef4444', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -38, -28, 86, 18, 8, '#334155', '#1e293b', 2.4, false);
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(62, -18);
                ctx.lineTo(82, -74);
                ctx.lineTo(100, -78);
                ctx.stroke();
                [-56, 56].forEach((wx) => {
                    ctx.fillStyle = '#1e293b';
                    ctx.beginPath();
                    ctx.arc(wx, 44, 24, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#e2e8f0';
                    ctx.beginPath();
                    ctx.arc(wx, 44, 10, 0, Math.PI * 2);
                    ctx.fill();
                });
                break;
            }
            case 'envelope': {
                drawOutlinedRect(ctx, -110, -68, 220, 136, 12, '#fffbeb', '#1e293b', 3.4, true);
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(-108, -64);
                ctx.lineTo(0, 10);
                ctx.lineTo(108, -64);
                ctx.stroke();
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(0, 12, 16, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                break;
            }
            case 'cash_stack': {
                drawOutlinedRect(ctx, -88, -32, 176, 80, 10, '#22c55e', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -88, -50, 176, 80, 10, '#86efac', '#1e293b', 3.4, false);
                drawOutlinedRect(ctx, -26, -50, 52, 80, 4, '#fef08a', '#1e293b', 2.5, false);
                ctx.strokeStyle = '#15803d';
                ctx.lineWidth = 2.5;
                ctx.strokeRect(-72, -36, 144, 52);
                break;
            }
            case 'jar':
            case 'locked_jar': {
                const fillRatio = 0.28 + 0.5 * easeOutCubic(Math.min(1, progress * 1.4));
                drawOutlinedRect(ctx, -64, -122, 128, 24, 8, '#94a3b8', '#1e293b', 3.4, false);
                drawOutlinedRect(ctx, -90, -98, 180, 212, 28, 'rgba(255,255,255,0.82)', '#1e293b', 3.4, true);
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(-82, -90, 164, 196, 22);
                ctx.clip();
                const liqH = 180 * fillRatio;
                ctx.fillStyle = '#4ade80';
                ctx.fillRect(-82, 106 - liqH, 164, liqH);
                ctx.fillStyle = 'rgba(255,255,255,0.28)';
                ctx.fillRect(-70, -76, 18, 168);
                ctx.restore();
                if (propId === 'locked_jar') {
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 6;
                    ctx.beginPath();
                    ctx.arc(0, -130, 24, Math.PI, Math.PI * 2);
                    ctx.stroke();
                }
                break;
            }
            case 'card_doc': {
                drawOutlinedRect(ctx, -96, -118, 192, 236, 14, '#ffffff', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -72, -96, 144, 24, 6, '#3b82f6', '#1e293b', 2, false);
                [-44, -10, 24, 58].forEach((ly, i) => {
                    const checked = progress > 0.15 + i * 0.18;
                    ctx.fillStyle = checked ? '#22c55e' : '#cbd5e1';
                    ctx.beginPath();
                    ctx.arc(-58, ly + 4, 8.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#cbd5e1';
                    ctx.fillRect(-38, ly, 104, 8);
                });
                break;
            }
            case 'coin': {
                ctx.translate(0, Math.sin(t * 4) * 5);
                ctx.fillStyle = '#fbbf24';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.8;
                ctx.beginPath();
                ctx.arc(0, 0, 62, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#f59e0b';
                ctx.beginPath();
                ctx.arc(0, 0, 40, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#fef08a';
                ctx.lineWidth = 5;
                ctx.strokeRect(-9, -18, 18, 36);
                break;
            }
            case 'red_button': {
                const press = progress > 0.5 ? 6 : 0;
                drawOutlinedRect(ctx, -78, -6, 156, 46, 22, '#991b1b', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -78, -28 + press, 156, 46, 22, '#ef4444', '#1e293b', 3.4, false);
                break;
            }
            case 'chart_bars': {
                const grow = easeOutCubic(Math.min(1, progress * 1.45));
                const h1 = 96 * grow;
                const h2 = 140 * grow;
                const h3 = (185 + audioLevel * 12) * grow;
                drawOutlinedRect(ctx, -104, 90 - h1, 56, h1, 8, '#93c5fd', '#1e293b', 3, true);
                drawOutlinedRect(ctx, -28, 90 - h2, 56, h2, 8, '#60a5fa', '#1e293b', 3, true);
                drawOutlinedRect(ctx, 48, 90 - h3, 56, h3, 8, '#22c55e', '#1e293b', 3, true);
                break;
            }
            case 'rice_bowl': {
                ctx.fillStyle = '#92400e';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.4;
                ctx.beginPath();
                ctx.ellipse(0, 14, 115, 48, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                [
                    { x: -46, y: 6, c: '#ffffff' },
                    { x: 0, y: -4, c: '#facc15' },
                    { x: 46, y: 6, c: '#ef4444' },
                    { x: -20, y: 24, c: '#4ade80' },
                    { x: 24, y: 24, c: '#fb923c' }
                ].forEach((d) => {
                    ctx.fillStyle = d.c;
                    ctx.beginPath();
                    ctx.ellipse(d.x, d.y, 20, 12, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                });
                break;
            }
            case 'coffee_cup': {
                drawOutlinedRect(ctx, -46, -54, 92, 128, 14, '#fef3c7', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -54, -72, 108, 22, 8, '#78350f', '#1e293b', 3, false);
                drawOutlinedRect(ctx, -46, -4, 92, 40, 4, '#d97706', '#1e293b', 2, false);
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 7;
                ctx.beginPath();
                ctx.moveTo(14, -72);
                ctx.lineTo(28, -112);
                ctx.stroke();
                break;
            }
            case 'water_glass': {
                const fillR = 0.35 + 0.5 * easeOutCubic(Math.min(1, progress * 1.4));
                ctx.fillStyle = 'rgba(255,255,255,0.84)';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.4;
                ctx.beginPath();
                ctx.moveTo(-66, -86);
                ctx.lineTo(66, -86);
                ctx.lineTo(50, 88);
                ctx.lineTo(-50, 88);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(-60, -80);
                ctx.lineTo(60, -80);
                ctx.lineTo(46, 82);
                ctx.lineTo(-46, 82);
                ctx.closePath();
                ctx.clip();
                const wy = 82 - 150 * fillR;
                ctx.fillStyle = '#38bdf8';
                ctx.fillRect(-70, wy, 140, 170);
                ctx.restore();
                break;
            }
            case 'heart': {
                const beat = 1 + Math.sin(t * 5.5) * 0.06 + audioLevel * 0.08;
                ctx.scale(beat, beat);
                ctx.fillStyle = '#fb7185';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.4;
                ctx.beginPath();
                ctx.moveTo(0, 62);
                ctx.bezierCurveTo(-86, 8, -90, -76, -38, -76);
                ctx.bezierCurveTo(-12, -76, 0, -48, 0, -48);
                ctx.bezierCurveTo(0, -48, 12, -76, 38, -76);
                ctx.bezierCurveTo(90, -76, 86, 8, 0, 62);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                break;
            }
            case 'cake': {
                [-32, 0, 32].forEach((cxC, idx) => {
                    drawOutlinedRect(ctx, cxC - 5, -72, 10, 36, 3, '#fbbf24', '#1e293b', 2, false);
                    ctx.fillStyle = idx % 2 === 0 ? '#ef4444' : '#f97316';
                    ctx.beginPath();
                    ctx.arc(cxC, -82 + Math.sin(t * 8 + idx) * 2, 6, 0, Math.PI * 2);
                    ctx.fill();
                });
                drawOutlinedRect(ctx, -78, -36, 156, 76, 12, '#fbcfe8', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -78, -14, 156, 18, 4, '#ffffff', '#1e293b', 2, false);
                break;
            }
            case 'gift_box': {
                drawOutlinedRect(ctx, -72, -38, 144, 110, 12, '#ef4444', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -82, -62, 164, 30, 8, '#f87171', '#1e293b', 3.4, false);
                drawOutlinedRect(ctx, -14, -62, 28, 134, 4, '#fde047', '#1e293b', 2.4, false);
                break;
            }
            case 'phone': {
                ctx.translate(Math.sin(t * 16) * (0.4 + audioLevel * 1.4), 0);
                drawOutlinedRect(ctx, -84, -132, 168, 264, 26, '#1e293b', '#0f172a', 3.4, true);
                drawRichScreenContent(ctx, -72, -114, 144, 228, screenType === 'night_scroll' ? 'night_scroll' : 'chat_msg', progress, t, audioLevel);
                // Dynamic Island notch + notification red dot
                drawOutlinedRect(ctx, -26, -124, 52, 11, 5, '#0f172a', null, 0, false);
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(58, -96, 10 + audioLevel * 4, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'scam_link': {
                drawOutlinedRect(ctx, -112, -58, 224, 116, 16, '#ffffff', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -112, -58, 224, 34, 14, '#ef4444', '#1e293b', 3.4, false);
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 6;
                ctx.beginPath();
                ctx.arc(0, 20, 28, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = '#ef4444';
                ctx.fillRect(-4, 4, 8, 20);
                ctx.beginPath();
                ctx.arc(0, 32, 4.5, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'plug_socket': {
                drawOutlinedRect(ctx, -76, -76, 152, 152, 22, '#ffffff', '#1e293b', 3.4, true);
                ctx.fillStyle = '#1e293b';
                ctx.beginPath();
                ctx.arc(-24, -10, 11, 0, Math.PI * 2);
                ctx.arc(24, -10, 11, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#f59e0b';
                ctx.beginPath();
                ctx.moveTo(8, -56);
                ctx.lineTo(-14, 2);
                ctx.lineTo(6, 2);
                ctx.lineTo(-6, 54);
                ctx.lineTo(20, -6);
                ctx.lineTo(0, -6);
                ctx.closePath();
                ctx.fill();
                break;
            }
            case 'battery': {
                const charge = 0.25 + 0.65 * easeOutCubic(Math.min(1, progress * 1.4));
                drawOutlinedRect(ctx, -28, -112, 56, 20, 6, '#94a3b8', '#1e293b', 3, false);
                drawOutlinedRect(ctx, -68, -92, 136, 190, 18, '#ffffff', '#1e293b', 3.4, true);
                const barH = Math.max(24, 166 * charge);
                drawOutlinedRect(ctx, -56, 86 - barH, 112, barH, 10, '#4ade80', '#1e293b', 2.4, false);
                break;
            }
            case 'padlock': {
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 14;
                ctx.beginPath();
                ctx.arc(0, -38, 42, Math.PI, Math.PI * 2);
                ctx.stroke();
                drawOutlinedRect(ctx, -68, -36, 136, 114, 18, '#fbbf24', '#1e293b', 3.4, true);
                ctx.fillStyle = '#1e293b';
                ctx.beginPath();
                ctx.arc(0, 14, 14, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'fire_flame': {
                const flicker = 1 + Math.sin(t * 10) * 0.06 + audioLevel * 0.1;
                ctx.scale(flicker, flicker);
                ctx.fillStyle = '#ef4444';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.4;
                ctx.beginPath();
                ctx.moveTo(0, -96);
                ctx.bezierCurveTo(64, -36, 78, 66, 0, 88);
                ctx.bezierCurveTo(-78, 66, -64, -36, 0, -96);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#fde047';
                ctx.beginPath();
                ctx.moveTo(0, -36);
                ctx.bezierCurveTo(32, 0, 36, 52, 0, 66);
                ctx.bezierCurveTo(-36, 52, -32, 0, 0, -36);
                ctx.fill();
                break;
            }
            case 'warning_triangle': {
                const pulse = 1 + Math.sin(t * 7) * 0.05 + audioLevel * 0.07;
                ctx.scale(pulse, pulse);
                ctx.fillStyle = '#ef4444';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(0, -92);
                ctx.lineTo(94, 72);
                ctx.lineTo(-94, 72);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(-7, -36, 14, 54);
                ctx.beginPath();
                ctx.arc(0, 38, 9, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'suitcase': {
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 8;
                ctx.strokeRect(-26, -104, 52, 32);
                drawOutlinedRect(ctx, -64, -74, 128, 164, 18, '#fb7185', '#1e293b', 3.4, true);
                ctx.fillStyle = '#fda4af';
                ctx.fillRect(-32, -52, 12, 120);
                ctx.fillRect(20, -52, 12, 120);
                break;
            }
            case 'clock': {
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 4.2;
                ctx.beginPath();
                ctx.arc(0, 0, 88, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                for (let h = 0; h < 12; h++) {
                    const ang = (h * Math.PI) / 6;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(ang) * 70, Math.sin(ang) * 70);
                    ctx.lineTo(Math.cos(ang) * 78, Math.sin(ang) * 78);
                    ctx.lineWidth = 2.6;
                    ctx.stroke();
                }
                const mA = -Math.PI / 2 + t * 2.4;
                const hA = -Math.PI / 2 + t * 0.4;
                ctx.lineCap = 'round';
                ctx.lineWidth = 6;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos(hA) * 42, Math.sin(hA) * 42);
                ctx.stroke();
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos(mA) * 62, Math.sin(mA) * 62);
                ctx.stroke();
                break;
            }
            case 'calendar': {
                drawOutlinedRect(ctx, -92, -92, 184, 184, 18, '#ffffff', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -92, -92, 184, 48, 18, '#ef4444', '#1e293b', 3.4, false);
                for (let r = 0; r < 3; r++) {
                    for (let c = 0; c < 4; c++) {
                        drawOutlinedRect(ctx, -64 + c * 36, -24 + r * 34, 24, 22, 4, r === 1 && c === 2 ? '#fde047' : '#e2e8f0', '#94a3b8', 1.5, false);
                    }
                }
                break;
            }
            case 'lightbulb': {
                const glow = 1 + Math.sin(t * 6) * 0.08 + audioLevel * 0.1;
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 5;
                for (let i = 0; i < 8; i++) {
                    const ang = (i * Math.PI) / 4;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(ang) * 72 * glow, Math.sin(ang) * 72 * glow - 16);
                    ctx.lineTo(Math.cos(ang) * 94 * glow, Math.sin(ang) * 94 * glow - 16);
                    ctx.stroke();
                }
                ctx.fillStyle = '#fde047';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.4;
                ctx.beginPath();
                ctx.arc(0, -16, 56, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                drawOutlinedRect(ctx, -26, 36, 52, 30, 8, '#94a3b8', '#1e293b', 3, false);
                break;
            }
            case 'laptop': {
                drawOutlinedRect(ctx, -96, -82, 192, 120, 12, '#334155', '#0f172a', 3.4, true);
                drawRichScreenContent(ctx, -84, -70, 168, 96, screenType, progress, t, audioLevel);
                drawOutlinedRect(ctx, -114, 38, 228, 22, 8, '#94a3b8', '#1e293b', 3, true);
                break;
            }
            case 'megaphone': {
                ctx.save();
                ctx.rotate(-0.18 + Math.sin(t * 7) * 0.06 + audioLevel * 0.06);
                ctx.fillStyle = '#f97316';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.4;
                ctx.beginPath();
                ctx.moveTo(-64, -18);
                ctx.lineTo(54, -64);
                ctx.lineTo(54, 64);
                ctx.lineTo(-64, 18);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                drawOutlinedRect(ctx, -82, -22, 26, 44, 8, '#ffffff', '#1e293b', 3, false);
                drawOutlinedRect(ctx, -56, 18, 18, 44, 6, '#334155', '#1e293b', 3, false);
                ctx.restore();
                break;
            }
            case 'target_kpi': {
                [88, 60, 32].forEach((r, idx) => {
                    ctx.fillStyle = idx % 2 === 0 ? '#ef4444' : '#ffffff';
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(0, 0, r, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                });
                ctx.fillStyle = '#facc15';
                ctx.beginPath();
                ctx.arc(0, 0, 12, 0, Math.PI * 2);
                ctx.fill();
                const hit = 1 - easeOutCubic(clamp01(progress * 2.2));
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(4 + hit * 60, -4 - hit * 60);
                ctx.lineTo(74 + hit * 60, -64 - hit * 60);
                ctx.stroke();
                break;
            }
            case 'speech_drama': {
                drawOutlinedRect(ctx, -108, -76, 146, 72, 22, '#fef2f2', '#1e293b', 3.4, true);
                ctx.fillStyle = '#ef4444';
                ctx.fillRect(-42, -58, 12, 24);
                ctx.beginPath();
                ctx.arc(-36, -24, 6, 0, Math.PI * 2);
                ctx.fill();
                drawOutlinedRect(ctx, -16, 8, 134, 68, 22, '#fef3c7', '#1e293b', 3.4, true);
                [-12, 16, 44].forEach((dx, i) => {
                    const dy = 42 + Math.sin(t * 7 + i) * 4;
                    ctx.fillStyle = '#475569';
                    ctx.beginPath();
                    ctx.arc(dx + 34, dy, 6.5, 0, Math.PI * 2);
                    ctx.fill();
                });
                break;
            }
            case 'music_bars': {
                drawOutlinedRect(ctx, -110, -90, 220, 180, 22, '#1e1b4b', '#1e293b', 3.4, true);
                for (let i = 0; i < 7; i++) {
                    const boost = 1 + audioLevel * 0.9;
                    const bh = Math.min(130, (24 + Math.abs(Math.sin(t * 6 + i * 0.8)) * 75) * boost);
                    drawOutlinedRect(ctx, -84 + i * 25, 58 - bh, 15, bh, 6, i % 2 === 0 ? '#a855f7' : '#38bdf8', '#0f172a', 1.8, false);
                }
                break;
            }
            case 'sleep_bed': {
                drawOutlinedRect(ctx, -95, 10, 190, 44, 10, '#a78bfa', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -86, -16, 52, 28, 10, '#ffffff', '#1e293b', 2.8, false);
                drawOutlinedRect(ctx, -30, -6, 120, 34, 12, '#818cf8', '#1e293b', 2.8, false);
                break;
            }
            case 'ergo_chair': {
                // Detailed Modern Ergonomic Mesh Office Chair with Headrest, Lumbar Cushion & 5-Star Base
                const hover = Math.sin(t * 2.5) * 3;
                ctx.translate(0, hover);
                // 5-star caster base
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 6;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(0, 48);
                ctx.lineTo(0, 92);
                ctx.moveTo(-64, 108);
                ctx.lineTo(0, 90);
                ctx.lineTo(64, 108);
                ctx.stroke();
                [-64, 0, 64].forEach((wx) => {
                    ctx.fillStyle = '#334155';
                    ctx.beginPath();
                    ctx.arc(wx, 114, 9, 0, Math.PI * 2);
                    ctx.fill();
                });
                // Headrest
                drawOutlinedRect(ctx, -36, -124, 72, 26, 10, '#334155', '#0f172a', 3, true);
                drawOutlinedRect(ctx, -8, -98, 16, 16, 4, '#64748b', '#0f172a', 2.4, false);
                // Mesh Backrest + Ergonomic Lumbar Pillow Highlight
                drawOutlinedRect(ctx, -56, -86, 112, 116, 22, '#1e293b', '#0f172a', 3.4, true);
                drawOutlinedRect(ctx, -46, -76, 92, 96, 16, '#334155', '#475569', 2, false);
                drawOutlinedRect(ctx, -40, -14, 80, 26, 10, '#38bdf8', '#0284c7', 2.2, false);
                // Armrests + Seat cushion
                drawOutlinedRect(ctx, -78, 6, 22, 34, 6, '#475569', '#0f172a', 2.4, false);
                drawOutlinedRect(ctx, 56, 6, 22, 34, 6, '#475569', '#0f172a', 2.4, false);
                drawOutlinedRect(ctx, -64, 28, 128, 26, 10, '#1e293b', '#0f172a', 3.2, true);
                break;
            }
            case 'spine_back': {
                // Curving Red-Warning Spine vs Upright Vertebrae Stack
                drawOutlinedRect(ctx, -84, -112, 168, 224, 24, '#ffffff', '#1e293b', 3.4, true);
                const pulse = 0.65 + 0.35 * Math.sin(t * 7);
                ctx.strokeStyle = `rgba(239, 68, 68, ${pulse})`;
                ctx.lineWidth = 10;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(8, -76);
                ctx.bezierCurveTo(-48, -28, 48, 24, -10, 78);
                ctx.stroke();
                for (let v = 0; v < 6; v++) {
                    const vy = -66 + v * 26;
                    const vx = Math.sin(v * 0.9) * -14;
                    drawOutlinedRect(ctx, vx - 18, vy - 7, 36, 14, 6, '#fee2e2', '#ef4444', 2.4, false);
                }
                break;
            }
            case 'empty_wallet': {
                const flapOpen = easeOutBack(clamp01(progress * 1.6));
                ctx.rotate(-0.08);
                drawOutlinedRect(ctx, -96, -54, 192, 118, 16, '#92400e', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -84, -42, 168, 94, 12, '#78350f', null, 0, false);
                // Falling coins out of empty wallet
                for (let c = 0; c < 3; c++) {
                    const fall = (t * 0.6 + c * 0.32) % 1;
                    ctx.save();
                    ctx.globalAlpha = 1 - fall;
                    ctx.fillStyle = '#fbbf24';
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 2.4;
                    ctx.beginPath();
                    ctx.arc(-40 + c * 42, 54 + fall * 58, 14, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                }
                // Empty puff wave arcs
                if (flapOpen > 0.3) {
                    ctx.strokeStyle = '#94a3b8';
                    ctx.lineWidth = 3.2;
                    ctx.beginPath();
                    ctx.arc(0, -78, 22 * flapOpen, Math.PI * 0.2, Math.PI * 0.8);
                    ctx.stroke();
                }
                break;
            }
            case 'stretching_pose': {
                drawOutlinedRect(ctx, -92, -104, 184, 208, 28, '#dcfce7', '#059669', 3.2, true);
                // Joyful stick-cartoon figure stretching upward + green checkmark wave
                ctx.strokeStyle = '#059669';
                ctx.lineWidth = 10;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(0, -28);
                ctx.lineTo(0, 34);
                ctx.moveTo(0, -14);
                ctx.lineTo(-42, -58 - Math.sin(t * 4) * 6);
                ctx.moveTo(0, -14);
                ctx.lineTo(42, -58 - Math.sin(t * 4) * 6);
                ctx.moveTo(0, 34);
                ctx.lineTo(-26, 78);
                ctx.moveTo(0, 34);
                ctx.lineTo(26, 78);
                ctx.stroke();
                ctx.fillStyle = '#059669';
                ctx.beginPath();
                ctx.arc(0, -54, 18, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'scale_icon': {
                const tilt = Math.sin(t * 2.5 + progress * 3.14) * 0.16;
                drawOutlinedRect(ctx, -46, 72, 92, 20, 8, '#78350f', '#1e293b', 3, true);
                drawOutlinedRect(ctx, -8, -72, 16, 146, 6, '#b45309', '#1e293b', 2.8, false);
                ctx.save();
                ctx.translate(0, -56);
                ctx.rotate(tilt);
                drawOutlinedRect(ctx, -86, -7, 172, 14, 7, '#f59e0b', '#1e293b', 2.8, true);
                [-72, 72].forEach((px, i) => {
                    ctx.strokeStyle = '#64748b';
                    ctx.lineWidth = 2.4;
                    ctx.beginPath();
                    ctx.moveTo(px, 6);
                    ctx.lineTo(px - 22, 54);
                    ctx.moveTo(px, 6);
                    ctx.lineTo(px + 22, 54);
                    ctx.stroke();
                    drawOutlinedRect(ctx, px - 28, 52, 56, 14, 7, i === 0 ? '#4ade80' : '#fb7185', '#1e293b', 2.4, false);
                });
                ctx.restore();
                break;
            }
            case 'hospital_card': {
                drawOutlinedRect(ctx, -92, -96, 184, 192, 18, '#ffffff', '#1e293b', 3.4, true);
                drawOutlinedRect(ctx, -92, -96, 184, 42, 16, '#ef4444', '#1e293b', 3.4, false);
                drawOutlinedRect(ctx, -12, -26, 24, 76, 5, '#ef4444', '#1e293b', 2, false);
                drawOutlinedRect(ctx, -38, 0, 76, 24, 5, '#ef4444', '#1e293b', 2, false);
                break;
            }
            case 'bank_counter': {
                drawOutlinedRect(ctx, -110, -78, 220, 128, 12, '#ecfdf5', '#065f46', 3.2, true);
                drawOutlinedRect(ctx, -94, -60, 188, 66, 8, '#d1fae5', '#059669', 2, false);
                drawOutlinedRect(ctx, -118, 42, 236, 42, 8, '#047857', '#064e3b', 3.2, true);
                break;
            }
            case 'speedometer': {
                ctx.fillStyle = '#0f172a';
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(0, 12, 86, Math.PI, Math.PI * 2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                const needleA = Math.PI + clamp01(progress * 1.1) * Math.PI * 0.72 + Math.sin(t * 7) * 0.05;
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(0, 12);
                ctx.lineTo(Math.cos(needleA) * 62, 12 + Math.sin(needleA) * 62);
                ctx.stroke();
                break;
            }
            case 'scissors_cut': {
                ctx.rotate(-0.2 + Math.sin(t * 9) * 0.14);
                ctx.strokeStyle = '#64748b';
                ctx.lineWidth = 10;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(-40, 20);
                ctx.lineTo(68, -28);
                ctx.moveTo(-40, -20);
                ctx.lineTo(68, 28);
                ctx.stroke();
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 6;
                [-34, 34].forEach((ry) => {
                    ctx.beginPath();
                    ctx.arc(-58, ry * 0.75, 22, 0, Math.PI * 2);
                    ctx.stroke();
                });
                break;
            }
            case 'umbrella': {
                ctx.fillStyle = '#3b82f6';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.2;
                ctx.beginPath();
                ctx.arc(0, 8, 92, Math.PI, Math.PI * 2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 6;
                ctx.beginPath();
                ctx.moveTo(0, 8);
                ctx.lineTo(0, 82);
                ctx.arc(14, 82, 14, Math.PI, 0, true);
                ctx.stroke();
                break;
            }
            case 'map_pin': {
                ctx.fillStyle = '#ef4444';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.4;
                ctx.beginPath();
                ctx.arc(0, -26, 48, Math.PI * 0.85, Math.PI * 2.15);
                ctx.lineTo(0, 74);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.arc(0, -26, 18, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'formula_chip': {
                drawOutlinedRect(ctx, -108, -68, 216, 136, 20, '#0f172a', '#38bdf8', 3.2, true);
                drawOutlinedRect(ctx, -84, -38, 168, 32, 8, '#1e293b', '#6366f1', 2, false);
                drawOutlinedRect(ctx, -84, 12, 74, 30, 8, '#22c55e', '#1e293b', 2, false);
                drawOutlinedRect(ctx, 10, 12, 74, 30, 8, '#f59e0b', '#1e293b', 2, false);
                break;
            }
            case 'price_tag':
            case 'shopping_bag': {
                drawOutlinedRect(ctx, -78, -56, 156, 140, 18, '#fb7185', '#1e293b', 3.4, true);
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 8;
                ctx.beginPath();
                ctx.arc(0, -56, 34, Math.PI, Math.PI * 2);
                ctx.stroke();
                drawSparkle(ctx, 0, 12, 26 + audioLevel * 6, '#fef08a', t * 2);
                break;
            }
            default: {
                drawOutlinedRect(ctx, -68, -68, 136, 136, 28, '#fef3c7', '#1e293b', 3.4, true);
                drawSparkle(ctx, 0, 0, 36 + audioLevel * 8, '#facc15', t * 2);
                break;
            }
        }
        ctx.restore();
    }

    function drawRedCross(ctx, cx, cy, size, scale = 1) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 14;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-size, -size);
        ctx.lineTo(size, size);
        ctx.moveTo(size, -size);
        ctx.lineTo(-size, size);
        ctx.stroke();
        ctx.restore();
    }

    function drawNarratorCameo(ctx, cx, cy, t, mood = 'happy', audioLevel = 0, cast = 'narrator', audioViseme = -1) {
        const prevViseme = currentAudioViseme;
        if (audioViseme >= 0) currentAudioViseme = audioViseme;
        try {
        const prof = CAST_PROFILES[cast] || CAST_PROFILES.narrator;
        const talkBounce = 1 + audioLevel * 0.05;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(talkBounce, talkBounce);

        // Soft shadow + speaking aura ring
        if (audioLevel > 0.25) {
            ctx.strokeStyle = `rgba(37, 99, 235, ${Math.min(0.6, audioLevel * 0.65)})`;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(0, 0, 56 + audioLevel * 7, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, 52, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, 49, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(-52, -52, 104, 104);
        drawOutlinedRect(ctx, -32, 16, 64, 42, 16, prof.shirt, '#1e293b', 2.4, false);
        drawCharacterHead(ctx, 0, 2, t, mood, audioLevel, cast);
        ctx.restore();

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, 52, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        } finally {
            currentAudioViseme = prevViseme;
        }
    }

    function drawHeroSubject(ctx, scene, propId, cx, cy, scale, progress, t, audioLevel, screenType, allowCustomHero = true) {
        if (scale <= 0.02) return;
        const customImg = allowCustomHero ? scene?.customHeroImg : null;
        if (customImg) {
            const pivot = scene?.speechPivot || 0.52;
            const afterPivot = progress >= pivot;
            const phaseBoost = afterPivot ? 1 + stagePop(progress, pivot, 0.14) * 0.06 : 1;
            const bobY = Math.sin(t * 2.8) * (3.5 + audioLevel * 4.5);
            const tilt = Math.sin(t * 2.1) * (0.02 + audioLevel * 0.035);
            ctx.save();
            ctx.translate(cx, cy + bobY);
            ctx.rotate(tilt);
            const dynScale = scale * phaseBoost * (1 + audioLevel * 0.055);
            ctx.scale(dynScale, dynScale);
            // Soft grounded shadow + subtle glowing stage behind bespoke AI 2D vector illustration
            ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
            ctx.beginPath();
            ctx.ellipse(0, 126, 98, 17, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.drawImage(customImg, -150, -150, 300, 300);
            ctx.restore();
            return;
        }
        drawProp(ctx, propId, cx, cy, scale, progress, t, audioLevel, screenType);
    }

    function drawPhase2Overlay(ctx, phase2Effect, pivot, progress, t, audioLevel) {
        if (!phase2Effect || phase2Effect === 'none' || progress < pivot) return;
        const localP = stagePop(progress, pivot, 0.16);
        if (localP <= 0.03) return;
        ctx.save();
        if (phase2Effect === 'cross_mistake') {
            drawRedCross(ctx, 270, 390, 118, localP);
        } else if (phase2Effect === 'check_win' || phase2Effect === 'stretch_up') {
            ctx.translate(418, 224);
            ctx.scale(localP * (1 + audioLevel * 0.06), localP * (1 + audioLevel * 0.06));
            ctx.fillStyle = '#22c55e';
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.arc(0, 0, 32, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 5.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(-13, 2);
            ctx.lineTo(-3, 12);
            ctx.lineTo(15, -10);
            ctx.stroke();
        } else if (phase2Effect === 'wallet_empty' || phase2Effect === 'money_fly') {
            for (let i = 0; i < 4; i++) {
                const fly = clamp01((progress - pivot) * 2.2);
                const px = 270 + (i - 1.5) * (48 + fly * 52);
                const py = 360 - fly * 120 + i * 18;
                ctx.save();
                ctx.globalAlpha = Math.max(0.15, 1 - fly * 0.85);
                ctx.fillStyle = '#fbbf24';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                ctx.arc(px, py, 14, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        } else if (phase2Effect === 'back_pain' || phase2Effect === 'shock_alert') {
            const shake = Math.sin(t * 24) * 3;
            ctx.translate(425 + shake, 226);
            ctx.scale(localP, localP);
            ctx.fillStyle = '#ef4444';
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(0, -34);
            ctx.lineTo(34, 26);
            ctx.lineTo(-34, 26);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-3.5, -16, 7, 22);
            ctx.beginPath();
            ctx.arc(0, 14, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawShortPillBadge(ctx, text, cx, cy, bg = 'rgba(15, 23, 42, 0.78)', fg = '#ffffff', scale = 1) {
        const clean = String(text || '').trim().slice(0, 22);
        if (!clean || scale <= 0.05) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.font = '700 15px "Inter", "Plus Jakarta Sans", sans-serif';
        const tw = Math.min(200, Math.max(54, ctx.measureText(clean).width + 26));
        drawOutlinedRect(ctx, -tw / 2, -16, tw, 32, 16, bg, 'rgba(255,255,255,0.28)', 1.5, true);
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(clean, 0, 1);
        ctx.restore();
    }

    function drawWoodenPointerStick(ctx, tipX, tipY, progress, pivot) {
        const slideP = easeOutBack(clamp01((progress - 0.16) / 0.34));
        if (slideP <= 0.02) return;
        const tapOffset = progress > pivot && progress < pivot + 0.16 ? Math.sin(((progress - pivot) / 0.16) * Math.PI) * 10 : 0;
        const tx = lerp(520, tipX, slideP) - tapOffset * 0.4;
        const ty = lerp(740, tipY, slideP) + tapOffset * 0.4;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(-0.62);
        drawOutlinedRect(ctx, -10, -8, 175, 16, 8, '#c69358', '#5c3c1e', 2.4, true);
        // Pointer tip cap
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-14, -7, 20, 14, 7);
        ctx.fill();
        ctx.stroke();
        // Hand gripping handle
        ctx.fillStyle = '#fbd3b4';
        ctx.beginPath();
        ctx.ellipse(126, 2, 22, 17, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    function drawBackViewMonitorsShot(ctx, scene, props, progress, t, audioLevel, screenType, cast, pivot, pop1, pop2, focusTag) {
        const prof = CAST_PROFILES[cast] || CAST_PROFILES.narrator;
        const camZoom = 1 + easeOutCubic(progress) * 0.04;

        ctx.save();
        ctx.translate(270, 440);
        ctx.scale(camZoom, camZoom);
        ctx.translate(-270, -440);

        // Desk surface & subtle studio glow behind dual floating monitors
        drawOutlinedRect(ctx, 24, 520, 492, 26, 12, '#e2e8f0', '#94a3b8', 2.6, true);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(46, 546, 448, 18);

        // Monitor stand arms
        drawOutlinedRect(ctx, 212, 466, 18, 56, 6, '#334155', '#0f172a', 2.2, false);
        drawOutlinedRect(ctx, 184, 512, 74, 12, 6, '#1e293b', '#0f172a', 2, false);
        drawOutlinedRect(ctx, 412, 476, 14, 46, 6, '#334155', '#0f172a', 2, false);

        // Main Elevated Monitor (Left/Center)
        ctx.save();
        ctx.translate(216, 362);
        ctx.scale(pop1, pop1);
        drawOutlinedRect(ctx, -162, -114, 324, 218, 18, '#0f172a', '#38bdf8', 3, true);
        drawOutlinedRect(ctx, -150, -102, 300, 194, 12, '#f8fafc', '#334155', 1.6, false);
        if (scene?.customHeroImg) {
            drawHeroSubject(ctx, scene, props[0], 0, -4, 0.56, progress, t, audioLevel, screenType, true);
        } else {
            drawRichScreenContent(ctx, -142, -94, 284, 178, screenType, progress, t, audioLevel);
        }
        ctx.restore();

        // Secondary Angled Monitor (Right)
        ctx.save();
        ctx.translate(422, 378);
        ctx.scale(pop2, pop2);
        drawOutlinedRect(ctx, -84, -92, 168, 178, 16, '#0f172a', '#64748b', 2.8, true);
        drawOutlinedRect(ctx, -74, -82, 148, 158, 10, '#1e293b', '#334155', 1.4, false);
        drawProp(ctx, props[1] || props[0], 0, -4, 0.42, progress, t, audioLevel, screenType);
        ctx.restore();

        // Desk accessories: ceramic mug + succulent plant
        drawOutlinedRect(ctx, 52, 488, 28, 32, 6, '#ffffff', '#1e293b', 2.2, false);
        ctx.fillStyle = '#8b5e3c';
        ctx.fillRect(56, 491, 20, 6);
        drawPottedPlant(ctx, 494, 520, 0.48, Math.sin(t * 2));

        // Character from behind sitting in ergonomic mesh chair facing monitors
        const headTilt = Math.sin(t * 3.1) * 0.04 + audioLevel * 0.05;
        ctx.save();
        ctx.translate(274, 650 + Math.sin(t * 2.4) * 2);
        ctx.scale(pop1 * 1.15, pop1 * 1.15);
        // Shoulders & torso back
        drawOutlinedRect(ctx, -74, -56, 148, 114, 34, prof.shirt, '#1e293b', 3, true);
        ctx.fillStyle = prof.shirtShade;
        ctx.beginPath();
        ctx.roundRect(-70, 10, 140, 44, 20);
        ctx.fill();
        // Ergonomic Chair Backrest + Mesh & Headrest overlapping lower back
        drawOutlinedRect(ctx, -56, -24, 112, 134, 26, '#334155', '#0f172a', 3, true);
        drawOutlinedRect(ctx, -44, -12, 88, 106, 18, '#475569', '#1e293b', 1.8, false);
        drawOutlinedRect(ctx, -18, 108, 36, 48, 8, '#1e293b', '#0f172a', 2.2, false);
        // Neck & back of head with cel highlight
        ctx.fillStyle = prof.skinShade;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.roundRect(-14, -74, 28, 26, 8);
        ctx.fill();
        ctx.stroke();
        ctx.save();
        ctx.translate(0, -106);
        ctx.rotate(headTilt);
        ctx.fillStyle = prof.skin;
        ctx.beginPath();
        ctx.arc(-40, 6, 8, 0, Math.PI * 2);
        ctx.arc(40, 6, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = prof.hair;
        ctx.beginPath();
        ctx.arc(0, 0, 42, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = prof.hairHi;
        ctx.beginPath();
        ctx.ellipse(-12, -18, 20, 9, -0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.restore();

        if (focusTag) {
            drawShortPillBadge(ctx, focusTag, 216, 226, '#2563eb', '#ffffff', pop2);
        }
        if (progress > pivot) {
            drawCursorPointer(ctx, 290 - easeInOutCubic(clamp01((progress - 0.15) / 0.5)) * 68, 410 - easeInOutCubic(clamp01((progress - 0.15) / 0.5)) * 45, progress < pivot + 0.14 ? 0.85 : 1, clamp01((progress - pivot) * 3));
        }
        ctx.restore();
    }

    // ---- Reference-Grade Data-Driven Animated Infographics (02.mp4 - 07.mov) ----
    function drawDiagramLabelBox(ctx, text, cx, cy, bg = '#ffffff', fg = '#0f172a', stroke = '#1e293b', scale = 1, fontSize = 16) {
        const clean = String(text || '').trim().slice(0, 18);
        if (!clean || scale <= 0.04) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.font = `800 ${fontSize}px "Inter", "Plus Jakarta Sans", sans-serif`;
        const w = Math.min(220, Math.max(72, ctx.measureText(clean).width + 28));
        drawOutlinedRect(ctx, -w / 2, -18, w, 36, 12, bg, stroke, 2.4, true);
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(clean, 0, 1);
        ctx.restore();
    }

    function drawDataDiagramLayout(ctx, layout, scene, cue, progress, t, audioLevel, cast, mood, action, pop1, pop2, pop3, pivot, sceneIdx = 0) {
        const rawD = cue?.diagramData || extractLocalDiagramData(String(scene?.text || '').toLowerCase(), layout, cue?.domainKey || 'home');
        const leftLbl = String(rawD.leftLabel || cue?.focusTag || 'TRƯỚC').trim().slice(0, 16);
        const rightLbl = String(rawD.rightLabel || 'SAU').trim().slice(0, 16);
        const badgeA = String(rawD.badgeA || '').trim().slice(0, 16);
        const badgeB = String(rawD.badgeB || '').trim().slice(0, 16);
        const hiNum = String(rawD.highlightNum || cue?.focusTag || '').trim().slice(0, 16);
        const showHost = sceneIdx % 2 === 0;
        const focusScale = showHost ? 1 : 1.12;
        const focusOffsetY = showHost ? 0 : 48;

        ctx.save();
        if (!showHost) {
            ctx.translate(270, 420 + focusOffsetY);
            ctx.scale(focusScale, focusScale);
            ctx.translate(-270, -420);
        }

        if (layout === 'balance-scale') {
            const tiltTarget = progress >= pivot ? 0.14 : -0.14;
            const tilt = Math.sin(t * 2.2) * 0.04 + tiltTarget * easeOutCubic(clamp01(progress * 1.4));
            drawDiagramLabelBox(ctx, hiNum || 'CÂN BẰNG', 270, 178, '#0f172a', '#ffffff', '#38bdf8', pop1, 17);

            ctx.save();
            ctx.translate(270, 392);
            ctx.scale(pop1, pop1);
            drawOutlinedRect(ctx, -74, 134, 148, 24, 10, '#78350f', '#1e293b', 3.2, true);
            drawOutlinedRect(ctx, -12, -88, 24, 224, 8, '#b45309', '#1e293b', 3, false);

            ctx.save();
            ctx.translate(0, -78);
            ctx.rotate(tilt);
            drawOutlinedRect(ctx, -156, -9, 312, 18, 9, '#f59e0b', '#1e293b', 3, true);
            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.arc(0, 0, 14, 0, Math.PI * 2);
            ctx.fill();

            [[-132, '#22c55e', leftLbl, badgeA], [132, '#fb7185', rightLbl, badgeB]].forEach(([px, col, lbl, val], side) => {
                ctx.strokeStyle = '#475569';
                ctx.lineWidth = 2.8;
                ctx.beginPath();
                ctx.moveTo(px, 8);
                ctx.lineTo(px - 36, 98);
                ctx.moveTo(px, 8);
                ctx.lineTo(px + 36, 98);
                ctx.stroke();
                drawOutlinedRect(ctx, px - 54, 96, 108, 22, 10, col, '#1e293b', 2.8, true);
                const blocks = side === 0 ? 3 : (progress >= pivot ? 1 : 4);
                for (let bi = 0; bi < blocks; bi++) {
                    drawOutlinedRect(ctx, px - 34, 70 - bi * 22, 68, 20, 6, '#fbbf24', '#1e293b', 2.2, false);
                }
                if (val) drawDiagramLabelBox(ctx, val, px, 144, '#ffffff', '#0f172a', col, pop2, 15);
                if (lbl) drawDiagramLabelBox(ctx, lbl, px, -36, col, '#ffffff', '#1e293b', pop2, 14);
            });
            ctx.restore();
            ctx.restore();

            ctx.restore();
            if (showHost) drawAnimatedActor(ctx, 118, 678, pop2 * 0.86, progress, t, action, mood, audioLevel, cast);
            return;
        }

        if (layout === 'bar-compare') {
            if (hiNum) drawDiagramLabelBox(ctx, hiNum, 270, 174, '#0f172a', '#fde047', '#f59e0b', pop1, 17);
            const grow = easeOutCubic(clamp01(progress * 1.35));
            const hA = 95 * grow;
            const hB = (225 + audioLevel * 12) * grow;

            drawOutlinedRect(ctx, 54, 214, 432, 338, 26, 'rgba(255,255,255,0.92)', '#cbd5e1', 2.8, true);
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(92, 488);
            ctx.lineTo(448, 488);
            ctx.stroke();

            drawOutlinedRect(ctx, 134, 488 - hA, 92, Math.max(24, hA), 12, '#60a5fa', '#1e293b', 3, true);
            drawOutlinedRect(ctx, 314, 488 - hB, 92, Math.max(24, hB), 12, '#22c55e', '#1e293b', 3, true);

            if (badgeA) drawDiagramLabelBox(ctx, badgeA, 180, 488 - hA - 28, '#eff6ff', '#1d4ed8', '#3b82f6', pop2, 16);
            if (badgeB) drawDiagramLabelBox(ctx, badgeB, 360, 488 - hB - 28, '#dcfce7', '#15803d', '#22c55e', pop2, 16);
            drawDiagramLabelBox(ctx, leftLbl, 180, 522, '#1e293b', '#ffffff', '#1e293b', pop1, 14);
            drawDiagramLabelBox(ctx, rightLbl, 360, 522, '#15803d', '#ffffff', '#1e293b', pop1, 14);

            ctx.restore();
            if (showHost) drawAnimatedActor(ctx, 432, 682, pop2 * 0.86, progress, t, action, mood, audioLevel, cast);
            return;
        }

        if (layout === 'savings-jar-growth') {
            const fillR = 0.25 + 0.56 * easeOutCubic(clamp01(progress * 1.4));
            if (hiNum) drawDiagramLabelBox(ctx, hiNum, 270, 174, '#059669', '#ffffff', '#064e3b', pop1, 17);

            ctx.save();
            ctx.translate(showHost ? 296 : 270, 405);
            ctx.scale(pop1 * 1.12, pop1 * 1.12);
            drawOutlinedRect(ctx, -74, -126, 148, 26, 10, '#94a3b8', '#1e293b', 3.4, true);
            drawOutlinedRect(ctx, -104, -100, 208, 224, 34, 'rgba(255,255,255,0.88)', '#1e293b', 3.6, true);
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(-94, -90, 188, 204, 26);
            ctx.clip();
            const liqH = 190 * fillR;
            ctx.fillStyle = '#4ade80';
            ctx.fillRect(-94, 114 - liqH, 188, liqH);
            for (let ci = 0; ci < 5; ci++) {
                ctx.fillStyle = '#fbbf24';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(-52 + ci * 26, 86 - (ci % 2) * 18, 13, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
            ['T1', 'T2', 'T3'].forEach((tk, idx) => {
                const ty = 74 - idx * 54;
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2.4;
                ctx.beginPath();
                ctx.moveTo(64, ty);
                ctx.lineTo(86, ty);
                ctx.stroke();
                ctx.fillStyle = '#334155';
                ctx.font = '800 13px Inter, sans-serif';
                ctx.fillText(tk, 40, ty + 4);
            });
            const coinDrop = (t * 1.1) % 1;
            ctx.fillStyle = '#facc15';
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, -172 + coinDrop * 64, 17, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();

            if (badgeA) drawDiagramLabelBox(ctx, badgeA, showHost ? 396 : 382, 268, '#fef08a', '#92400e', '#f59e0b', pop2, 16);
            if (rightLbl) drawDiagramLabelBox(ctx, rightLbl, showHost ? 296 : 270, 560, '#0f172a', '#ffffff', '#22c55e', pop2, 15);
            ctx.restore();
            if (showHost) drawAnimatedActor(ctx, 108, 675, pop2 * 0.86, progress, t, 'counting-money', mood, audioLevel, cast);
            return;
        }

        if (layout === 'calendar-alert') {
            if (hiNum) drawDiagramLabelBox(ctx, hiNum, 270, 174, '#ef4444', '#ffffff', '#7f1d1d', pop1, 17);
            const activeMonth = Math.min(11, Math.floor(easeOutCubic(clamp01(progress * 1.25)) * 11));

            ctx.save();
            ctx.translate(270, 390);
            ctx.scale(pop1, pop1);
            drawOutlinedRect(ctx, -182, -148, 364, 296, 24, '#ffffff', '#1e293b', 3.6, true);
            drawOutlinedRect(ctx, -182, -148, 364, 58, 24, '#dc2626', '#1e293b', 3.6, false);
            for (let m = 0; m < 12; m++) {
                const c = m % 4;
                const r = Math.floor(m / 4);
                const tx = -148 + c * 78;
                const ty = -64 + r * 66;
                const isTarget = m === activeMonth && m >= 9;
                const isLit = m <= activeMonth;
                drawOutlinedRect(ctx, tx, ty, 64, 52, 10, isTarget ? '#ef4444' : (isLit ? '#fde047' : '#e2e8f0'), isTarget ? '#7f1d1d' : '#64748b', isTarget ? 3 : 1.8, isTarget);
                ctx.fillStyle = isTarget ? '#ffffff' : '#1e293b';
                ctx.font = '800 17px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`T${m + 1}`, tx + 32, ty + 27);
            }
            ctx.restore();

            if (badgeA) drawDiagramLabelBox(ctx, badgeA, 162, 566, '#0f172a', '#ffffff', '#38bdf8', pop2, 15);
            if (badgeB) drawDiagramLabelBox(ctx, badgeB, 378, 566, '#fef2f2', '#dc2626', '#ef4444', pop3, 15);
            ctx.restore();
            if (showHost) drawAnimatedActor(ctx, 114, 682, pop2 * 0.84, progress, t, action, mood, audioLevel, cast);
            return;
        }

        if (layout === 'tech-formula-steps') {
            drawDiagramLabelBox(ctx, hiNum || 'CÔNG THỨC', 270, 184, '#1e1b4b', '#38bdf8', '#6366f1', pop1, 19);

            const splitRatio = progress >= pivot ? 0.5 : 1;
            drawOutlinedRect(ctx, 56, 236, 428, 128, 22, '#0f172a', '#6366f1', 3.2, true);
            const segs = progress >= pivot ? 4 : 2;
            const segW = (380 - (segs - 1) * 10) / segs;
            for (let si = 0; si < segs; si++) {
                const bg = si === 0 ? '#22c55e' : (si === 1 ? '#3b82f6' : '#8b5cf6');
                const drop = stagePop(progress, 0.08 + si * 0.14, 0.16);
                drawOutlinedRect(ctx, 80 + si * (segW + 10), 258, segW, 84 * Math.max(0.2, drop), 10, bg, '#ffffff', 2, false);
            }

            if (badgeA) drawDiagramLabelBox(ctx, `${leftLbl}: ${badgeA}`, 160, 408, '#1e293b', '#38bdf8', '#38bdf8', pop2, 15);
            if (badgeB) drawDiagramLabelBox(ctx, `${rightLbl}: ${badgeB}`, 380, 408, '#1e293b', '#4ade80', '#22c55e', pop3, 15);

            drawOutlinedRect(ctx, 76, 456, 388, 66, 16, 'rgba(15, 23, 42, 0.9)', '#475569', 2.4, true);
            for (let b = 0; b < 8; b++) {
                const on = (b < Math.round(8 * splitRatio));
                drawOutlinedRect(ctx, 96 + b * 44, 472, 34, 34, 7, on ? '#38bdf8' : '#1e293b', '#6366f1', 1.8, false);
            }
            ctx.restore();
            if (showHost) drawAnimatedActor(ctx, 426, 682, pop2 * 0.86, progress, t, 'pointing', mood, audioLevel, cast);
            return;
        }

        if (layout === 'journey-route') {
            if (hiNum) drawDiagramLabelBox(ctx, hiNum, 270, 174, '#0f172a', '#fde047', '#f59e0b', pop1, 18);
            drawOutlinedRect(ctx, 48, 224, 444, 290, 26, 'rgba(255,255,255,0.92)', '#94a3b8', 3, true);
            ctx.save();
            ctx.setLineDash([12, 10]);
            ctx.lineDashOffset = -t * 48;
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(116, 434);
            ctx.quadraticCurveTo(270, 278, 424, 434);
            ctx.stroke();
            ctx.restore();

            drawDiagramLabelBox(ctx, leftLbl, 118, 468, '#1e293b', '#ffffff', '#1e293b', pop1, 14);
            drawDiagramLabelBox(ctx, rightLbl, 422, 468, '#059669', '#ffffff', '#064e3b', pop2, 14);

            const travelT = easeInOutCubic(clamp01((progress - 0.08) / 0.78));
            const vx = (1 - travelT) * (1 - travelT) * 116 + 2 * (1 - travelT) * travelT * 270 + travelT * travelT * 424;
            const vy = (1 - travelT) * (1 - travelT) * 434 + 2 * (1 - travelT) * travelT * 278 + travelT * travelT * 434;
            const vehProp = cue?.props?.includes('bus') ? 'bus' : 'scooter';
            drawProp(ctx, vehProp, vx, vy - 18, 0.42 * pop1, progress, t, audioLevel);

            ctx.restore();
            if (showHost) drawAnimatedActor(ctx, 118, 682, pop2 * 0.85, progress, t, action, mood, audioLevel, cast);
            return;
        }

        if (hiNum) drawDiagramLabelBox(ctx, hiNum, 270, 174, '#2563eb', '#ffffff', '#1e3a8a', pop1, 17);
        const rows = [
            leftLbl || 'BƯỚC 1',
            rightLbl || 'BƯỚC 2',
            badgeA || 'BƯỚC 3'
        ];
        rows.forEach((lbl, idx) => {
            const rowP = stagePop(progress, 0.06 + idx * 0.18, 0.18);
            if (rowP <= 0.02) return;
            const ry = 240 + idx * 104;
            ctx.save();
            ctx.translate(270, ry);
            ctx.scale(rowP, rowP);
            drawOutlinedRect(ctx, -196, -38, 392, 76, 20, '#ffffff', '#cbd5e1', 3, true);
            const checked = progress >= 0.22 + idx * 0.20;
            ctx.fillStyle = checked ? '#22c55e' : '#e2e8f0';
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.arc(-142, 0, 20, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            if (checked) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(-150, 1);
                ctx.lineTo(-144, 7);
                ctx.lineTo(-132, -6);
                ctx.stroke();
            }
            ctx.fillStyle = '#0f172a';
            ctx.font = '800 20px "Inter", "Plus Jakarta Sans", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(lbl, -104, 1);
            ctx.restore();
        });
        ctx.restore();
        if (showHost) drawAnimatedActor(ctx, 424, 682, pop2 * 0.84, progress, t, 'pointing', mood, audioLevel, cast);
    }

    // ---- Main Storyboard & UI Motion Choreography ----
    function renderSingleMotionScene(ctx, scene, progress, sceneIdx, t, audioLevel = 0, audioViseme = -1) {
        currentAudioViseme = audioViseme;
        try {
        const visualStyle = scene.visualStyle || 'motion';
        const cue = scene.motionCue || analyzeSceneVisualCue(scene.text, sceneIdx, '', {}, visualStyle);
        const backdropId = BACKDROPS[cue.backdrop] ? cue.backdrop : (visualStyle === 'ui-motion' ? 'grid-light' : 'studio-focus');
        const props = Array.isArray(cue.props) && cue.props.length > 0 ? cue.props : ['lightbulb'];
        const pivot = Number.isFinite(scene.speechPivot) ? scene.speechPivot : 0.52;
        const afterPivot = progress >= pivot;
        const mood = (afterPivot && cue.stage2Mood) ? cue.stage2Mood : (cue.characterMood || 'happy');
        const action = (afterPivot && cue.stage2Action) ? cue.stage2Action : (cue.action || 'pointing');
        const activeProp = (afterPivot && props.length > 1) ? props[1] : props[0];
        const propSwitchScale = (afterPivot && props.length > 1) ? stagePop(progress, Math.max(0.05, pivot - 0.04), 0.16) : 1;
        const cast = cue.cast || 'narrator';
        const effect = cue.effect || 'sparkles';
        const screenType = cue.screenType || 'chat_msg';
        const phase2Effect = cue.phase2Effect || 'none';
        const roleTag = String(cue.roleTag || '').trim();
        const focusTag = String(cue.focusTag || '').trim();

        drawBackdrop(ctx, backdropId, progress, t, audioLevel);

        const pop1 = stagePop(progress, 0.02, 0.18);
        const pop2 = stagePop(progress, 0.14, 0.18);
        const pop3 = stagePop(progress, 0.36, 0.18);

        switch (cue.layout) {
            case 'balance-scale':
            case 'bar-compare':
            case 'savings-jar-growth':
            case 'calendar-alert':
            case 'tech-formula-steps':
            case 'journey-route':
            case 'checklist-trio': {
                drawDataDiagramLayout(ctx, cue.layout, scene, cue, progress, t, audioLevel, cast, mood, action, pop1, pop2, pop3, pivot, sceneIdx);
                break;
            }

            case 'wide-team': {
                const camZoom = 1 + easeOutCubic(progress) * 0.055;
                ctx.save();
                ctx.translate(270, 520);
                ctx.scale(camZoom, camZoom);
                ctx.translate(-270, -520);
                drawSeatedDeskCharacter(ctx, 136, 545, pop1 * 0.72, t, 'girl-purple', 'happy', 0, false);
                drawSeatedDeskCharacter(ctx, 304, 545, pop2 * 0.72, t, 'boy-spiky', mood, 0, false);
                drawSeatedDeskCharacter(ctx, 438, 480, pop2 * 0.56, t, 'manager-red', 'happy', 0, action === 'calling');
                ctx.restore();
                drawHeroSubject(ctx, scene, activeProp, 270, 272, pop2 * 0.60 * propSwitchScale, progress, t, audioLevel, screenType, true);
                drawAnimatedActor(ctx, 444, 702, pop1 * 0.94, progress, t, action === 'celebrating' ? 'celebrating' : 'pointing', mood, audioLevel, cast);
                if (roleTag) drawShortPillBadge(ctx, roleTag, 444, 548, 'rgba(15, 23, 42, 0.80)', '#ffffff', pop1);
                drawComicReaction(ctx, 378, 590, mood, audioLevel, t);
                break;
            }

            case 'desk-closeup': {
                const camZoom = 1 + easeOutCubic(progress) * 0.065;
                ctx.save();
                ctx.translate(270, 545);
                ctx.scale(camZoom, camZoom);
                ctx.translate(-270, -545);
                drawSeatedDeskCharacter(ctx, 265, 540, pop1 * 1.48, t, cast, mood, audioLevel, action === 'calling');
                drawHeroSubject(ctx, scene, activeProp, 430, 345, pop2 * 0.56 * propSwitchScale, progress, t, audioLevel, screenType, true);
                if (roleTag) drawShortPillBadge(ctx, roleTag, 265, 344, 'rgba(15, 23, 42, 0.82)', '#ffffff', pop1);
                drawComicReaction(ctx, 118, 385, mood, audioLevel, t);
                ctx.restore();
                break;
            }

            case 'two-shot-dialogue': {
                const listener = cast === 'girl-purple' ? 'boy-spiky' : 'girl-purple';
                drawSeatedDeskCharacter(ctx, 372, 520, pop2 * 0.96, t, listener, mood === 'shocked' ? 'thinking' : 'happy', audioLevel * 0.2, false);
                drawHeroSubject(ctx, scene, activeProp, 266, 286, pop2 * 0.62 * propSwitchScale, progress, t, audioLevel, screenType, true);
                drawAnimatedActor(ctx, 134, 668, pop1 * 1.12, progress, t, action, mood, audioLevel, cast);
                if (roleTag) drawShortPillBadge(ctx, roleTag, 134, 492, 'rgba(15, 23, 42, 0.82)', '#ffffff', pop1);
                drawComicReaction(ctx, 214, 535, mood, audioLevel, t);
                break;
            }

            case 'back-monitors': {
                drawBackViewMonitorsShot(ctx, scene, props, progress, t, audioLevel, screenType, cast, pivot, pop1, pop2, focusTag);
                break;
            }

            case 'hand-viewfinder':
            case 'hand-pov': {
                const isDocShot = cue.layout === 'hand-pov' && (props[0] === 'card_doc' || props[0] === 'envelope' || screenType === 'contract_sign');
                const docScale = pop1 * 1.12;
                if (isDocShot) {
                    drawOutlinedRect(ctx, 88, 198, 364, 440, 22, '#ffffff', '#cbd5e1', 3, true);
                } else {
                    drawOutlinedRect(ctx, 76, 194, 388, 430, 24, 'rgba(255,255,255,0.94)', '#1e293b', 3.2, true);
                }

                if (scene?.customHeroImg) {
                    drawHeroSubject(ctx, scene, props[0], 270, 408, pop1 * 1.04, progress, t, audioLevel, screenType, true);
                } else {
                    drawProp(ctx, isDocShot ? 'card_doc' : props[0], 270, 404, docScale * 0.94, progress, t, audioLevel, screenType);
                }

                const drawPovHand = (hx, hy, tilt, sleeveCol = '#1e3a5f') => {
                    ctx.save();
                    ctx.translate(hx, hy);
                    ctx.rotate(tilt);
                    drawOutlinedRect(ctx, -20, 0, 40, 175, 16, sleeveCol, '#0f172a', 2.8, true);
                    drawOutlinedRect(ctx, -22, -6, 44, 14, 6, '#f8fafc', '#1e293b', 2, false);
                    ctx.fillStyle = '#fbd3b4';
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 2.6;
                    ctx.beginPath();
                    ctx.arc(0, -20, 24, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.ellipse(16, -24, 8, 14, 0.4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                };

                if (isDocShot) {
                    const signProg = easeOutCubic(clamp01((progress - 0.12) / 0.55));
                    const signX = 200 + signProg * 135;
                    const signY = 486 + Math.sin(signProg * Math.PI * 5) * 6;
                    ctx.strokeStyle = '#2563eb';
                    ctx.lineWidth = 4.2;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(200, 488);
                    for (let k = 1; k <= 12; k++) {
                        const kp = (k / 12) * signProg;
                        ctx.lineTo(200 + kp * 135, 488 + Math.sin(kp * Math.PI * 6) * 5);
                    }
                    ctx.stroke();
                    drawPovHand(signX + 34, signY + 32, -0.45);
                    if (progress > pivot) {
                        const stP = stagePop(progress, pivot, 0.16);
                        ctx.save();
                        ctx.translate(342, 466);
                        ctx.scale(stP, stP);
                        ctx.rotate(-0.18);
                        ctx.strokeStyle = '#ef4444';
                        ctx.lineWidth = 4.5;
                        ctx.beginPath();
                        ctx.arc(0, 0, 32, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.moveTo(-12, 2);
                        ctx.lineTo(-3, 12);
                        ctx.lineTo(14, -10);
                        ctx.stroke();
                        ctx.restore();
                    }
                } else {
                    // Camera Viewfinder L-Brackets framing live focus (Reference Video 1)
                    const brkPulse = 1 + (progress > pivot && progress < pivot + 0.18 ? 0.06 : 0);
                    ctx.save();
                    ctx.translate(270, 408);
                    ctx.scale(brkPulse, brkPulse);
                    ctx.strokeStyle = '#f59e0b';
                    ctx.lineWidth = 5;
                    ctx.lineCap = 'round';
                    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
                        const bx = sx * 158;
                        const by = sy * 158;
                        ctx.beginPath();
                        ctx.moveTo(bx, by - sy * 36);
                        ctx.lineTo(bx, by);
                        ctx.lineTo(bx - sx * 36, by);
                        ctx.stroke();
                    });
                    ctx.restore();
                    const handY = 638 - easeOutBack(clamp01(progress * 2.2)) * 42;
                    drawPovHand(88, handY, -0.22);
                    drawPovHand(452, handY, 0.22);
                    if (focusTag) {
                        drawShortPillBadge(ctx, focusTag, 270, 224, 'rgba(15, 23, 42, 0.84)', '#fde047', pop2);
                    }
                }
                break;
            }

            case 'screen-pointer':
            case 'laptop-popup': {
                drawSeatedDeskCharacter(ctx, 270, 565, 1.08, t, cast, mood, audioLevel * 0.45, false);
                ctx.fillStyle = 'rgba(15, 23, 42, 0.26)';
                ctx.fillRect(0, 0, W, H);
                ctx.save();
                ctx.translate(270, 395);
                ctx.scale(pop1, pop1);
                drawOutlinedRect(ctx, -214, -162, 428, 314, 22, '#ffffff', '#64748b', 3.4, true);
                drawOutlinedRect(ctx, -214, -162, 428, 44, 18, '#334155', '#1e293b', 3, false);
                ['#ef4444', '#facc15', '#22c55e'].forEach((dotC, di) => {
                    ctx.fillStyle = dotC;
                    ctx.beginPath();
                    ctx.arc(-182 + di * 22, -140, 7, 0, Math.PI * 2);
                    ctx.fill();
                });
                if (scene?.customHeroImg) {
                    drawHeroSubject(ctx, scene, props[0], 0, 14, 0.86, progress, t, audioLevel, screenType, true);
                } else if (activeProp && activeProp !== 'laptop' && activeProp !== 'card_doc') {
                    drawRichScreenContent(ctx, -192, -102, 384, 234, screenType, progress, t, audioLevel);
                    drawHeroSubject(ctx, scene, activeProp, 0, 18, 0.78 * propSwitchScale, progress, t, audioLevel, screenType, false);
                } else {
                    drawRichScreenContent(ctx, -192, -102, 384, 234, screenType, progress, t, audioLevel);
                }
                ctx.restore();
                if (focusTag) {
                    drawShortPillBadge(ctx, focusTag, 270, 214, '#2563eb', '#ffffff', pop2);
                }
                drawWoodenPointerStick(ctx, 294, 412, progress, pivot);
                break;
            }

            case 'ui-window': {
                ctx.save();
                ctx.translate(270, 410);
                ctx.scale(pop1, pop1);
                drawOutlinedRect(ctx, -220, -210, 440, 405, 24, '#0f172a', '#334155', 2.8, true);
                drawOutlinedRect(ctx, -200, -188, 400, 40, 12, '#1e293b', '#334155', 1.6, false);
                ['#ef4444', '#facc15', '#22c55e'].forEach((dc, i) => {
                    ctx.fillStyle = dc;
                    ctx.beginPath();
                    ctx.arc(-178 + i * 18, -168, 5.5, 0, Math.PI * 2);
                    ctx.fill();
                });
                if (scene?.customHeroImg) {
                    drawOutlinedRect(ctx, -196, -132, 392, 236, 14, '#f8fafc', '#334155', 1.8, false);
                    drawHeroSubject(ctx, scene, props[0], 0, -14, 0.78, progress, t, audioLevel, screenType, true);
                } else {
                    drawRichScreenContent(ctx, -196, -132, 392, 236, screenType, progress, t, audioLevel);
                }

                const btnClicked = progress > pivot;
                const btnScale = progress > pivot && progress < pivot + 0.12 ? 0.94 : 1;
                ctx.save();
                ctx.translate(0, 146);
                ctx.scale(btnScale, btnScale);
                drawOutlinedRect(ctx, -110, -22, 220, 44, 14, btnClicked ? '#22c55e' : '#3b82f6', '#ffffff', 2, true);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3.5;
                ctx.lineCap = 'round';
                if (btnClicked) {
                    ctx.beginPath();
                    ctx.moveTo(-12, 2);
                    ctx.lineTo(-3, 11);
                    ctx.lineTo(14, -8);
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(-16, 0);
                    ctx.lineTo(16, 0);
                    ctx.moveTo(6, -9);
                    ctx.lineTo(16, 0);
                    ctx.lineTo(6, 9);
                    ctx.stroke();
                }
                ctx.restore();
                ctx.restore();

                const curP = easeInOutCubic(clamp01((progress - 0.1) / Math.max(0.25, pivot - 0.1)));
                drawCursorPointer(
                    ctx,
                    430 - curP * 145,
                    640 - curP * 85,
                    progress > pivot && progress < pivot + 0.12 ? 0.84 : 1,
                    progress > pivot ? clamp01((progress - pivot) * 3.2) : 0
                );
                break;
            }

            case 'ui-checklist': {
                const cols = 2;
                [0, 1, 2, 3].forEach((idx) => {
                    const cardP = stagePop(progress, 0.05 + idx * 0.14, 0.18);
                    if (cardP <= 0.02) return;
                    const c = idx % cols;
                    const r = Math.floor(idx / cols);
                    const px = 148 + c * 244;
                    const py = 305 + r * 205;
                    ctx.save();
                    ctx.translate(px, py);
                    ctx.scale(cardP, cardP);
                    drawOutlinedRect(ctx, -106, -82, 212, 164, 24, '#ffffff', '#bfdbfe', 2.8, true);
                    drawHeroSubject(ctx, scene, props[idx % props.length], 0, -6, 0.44, progress, t, audioLevel, screenType, idx === 0);
                    const chkP = stagePop(progress, 0.24 + idx * 0.14, 0.16);
                    if (chkP > 0.05) {
                        ctx.save();
                        ctx.translate(88, -70);
                        ctx.scale(chkP, chkP);
                        ctx.fillStyle = '#2563eb';
                        ctx.beginPath();
                        ctx.arc(0, 0, 19, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 3.5;
                        ctx.beginPath();
                        ctx.moveTo(-7, 1);
                        ctx.lineTo(-2, 7);
                        ctx.lineTo(9, -6);
                        ctx.stroke();
                        ctx.restore();
                    }
                    ctx.restore();
                });
                break;
            }

            case 'ui-flow': {
                const s1 = stagePop(progress, 0.04, 0.18);
                const s2 = stagePop(progress, 0.22, 0.18);
                const s3 = stagePop(progress, 0.40, 0.18);
                ctx.save();
                ctx.setLineDash([8, 8]);
                ctx.lineDashOffset = -t * 36;
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = 3.5;
                ctx.beginPath();
                ctx.moveTo(120, 310);
                ctx.lineTo(420, 310);
                ctx.stroke();
                ctx.restore();

                [[116, s1, '#e0f2fe'], [270, s2, '#fef3c7'], [424, s3, '#dcfce7']].forEach(([px, sp, fill], i) => {
                    if (sp <= 0.04) return;
                    ctx.save();
                    ctx.translate(px, 310);
                    ctx.scale(sp, sp);
                    drawOutlinedRect(ctx, -58, -50, 116, 100, 22, fill, '#64748b', 2.5, true);
                    drawProp(ctx, props[i % props.length], 0, 0, 0.34, progress, t, audioLevel, screenType);
                    ctx.restore();
                });

                const heroP = stagePop(progress, pivot * 0.85, 0.20);
                if (heroP > 0.05) {
                    ctx.save();
                    ctx.translate(270, 525);
                    ctx.scale(heroP, heroP);
                    drawOutlinedRect(ctx, -188, -96, 376, 192, 24, '#0f172a', '#3b82f6', 3, true);
                    if (scene?.customHeroImg) {
                        drawHeroSubject(ctx, scene, props[0], 0, 0, 0.62, progress, t, audioLevel, screenType, true);
                    } else {
                        drawRichScreenContent(ctx, -172, -80, 344, 160, screenType, progress, t, audioLevel);
                    }
                    ctx.restore();
                }
                break;
            }

            case 'ui-grid-hero': {
                ctx.save();
                ctx.translate(270, 410);
                ctx.scale(pop1 * (1 + audioLevel * 0.04), pop1 * (1 + audioLevel * 0.04));
                drawOutlinedRect(ctx, -162, -162, 324, 324, 46, '#ffffff', '#93c5fd', 3.2, true);
                drawHeroSubject(ctx, scene, props[0], 0, 0, 0.96, progress, t, audioLevel, screenType, true);
                ctx.restore();
                const curP = easeInOutCubic(clamp01(progress * 1.4));
                drawCursorPointer(
                    ctx,
                    415 - curP * 105,
                    555 - curP * 100,
                    progress > pivot && progress < pivot + 0.13 ? 0.82 : 1,
                    progress > pivot ? clamp01((progress - pivot) * 3) : 0
                );
                break;
            }

            case 'character-action': {
                drawHeroSubject(ctx, scene, activeProp, 342, 292, pop2 * 0.90 * propSwitchScale, progress, t, audioLevel, screenType, true);
                if (props[1] && !afterPivot && !scene?.customHeroImg) {
                    drawProp(ctx, props[1], 138, 270, pop3 * 0.46, progress, t, audioLevel, screenType);
                }
                drawAnimatedActor(ctx, 255, 628, pop1 * 1.12, progress, t, action, mood, audioLevel, cast);
                if (roleTag) drawShortPillBadge(ctx, roleTag, 255, 456, 'rgba(15, 23, 42, 0.80)', '#ffffff', pop1);
                drawComicReaction(ctx, 355, 515, mood, audioLevel, t);
                if (cue.crossOut && progress > pivot * 0.7) {
                    drawRedCross(ctx, 342, 292, 78, stagePop(progress, pivot * 0.7, 0.16));
                }
                break;
            }

            case 'character-left': {
                drawAnimatedActor(ctx, 134, 622, pop1 * 1.06, progress, t, action, mood, audioLevel, cast);
                if (roleTag) drawShortPillBadge(ctx, roleTag, 134, 452, 'rgba(15, 23, 42, 0.80)', '#ffffff', pop1);
                drawComicReaction(ctx, 212, 515, mood, audioLevel, t);
                drawHeroSubject(ctx, scene, activeProp, 362, 410, pop2 * 1.02 * propSwitchScale, progress, t, audioLevel, screenType, true);
                if (props[1] && pop3 > 0.1 && !afterPivot && !scene?.customHeroImg) {
                    drawProp(ctx, props[1], 418, 215, pop3 * 0.44, progress, t, audioLevel, screenType);
                }
                if (focusTag) drawShortPillBadge(ctx, focusTag, 362, 256, '#2563eb', '#ffffff', pop2);
                if (cue.crossOut && progress > pivot * 0.7) {
                    drawRedCross(ctx, 362, 410, 95, stagePop(progress, pivot * 0.7, 0.16));
                }
                break;
            }

            case 'split-compare': {
                drawOutlinedRect(ctx, 42, 235, 212, 336, 24, 'rgba(254, 226, 226, 0.9)', '#1e293b', 3, true);
                drawOutlinedRect(ctx, 286, 235, 212, 336, 24, 'rgba(220, 252, 231, 0.94)', '#1e293b', 3, true);
                drawHeroSubject(ctx, scene, props[0], 148, 405, pop1 * 0.74, progress, t, audioLevel, 'excel_err', true);
                drawProp(ctx, props[1] || props[0], 392, 405, pop2 * 0.74, progress, t, audioLevel, 'revenue_up');
                if (cue.crossOut && progress > pivot * 0.65) {
                    drawRedCross(ctx, 148, 405, 76, stagePop(progress, pivot * 0.65, 0.16));
                } else if (pop3 > 0.2) {
                    ctx.save();
                    ctx.translate(458, 260);
                    ctx.scale(pop3, pop3);
                    ctx.fillStyle = '#22c55e';
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(0, 0, 22, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 4.5;
                    ctx.beginPath();
                    ctx.moveTo(-9, 1);
                    ctx.lineTo(-2, 8);
                    ctx.lineTo(10, -7);
                    ctx.stroke();
                    ctx.restore();
                }
                break;
            }

            case 'multi-trio': {
                [108, 270, 432].forEach((px, idx) => {
                    const pr = props[idx] || props[idx % props.length];
                    const hoverY = 445 + Math.sin(t * 3 + idx) * 8;
                    drawHeroSubject(ctx, scene, pr, px, hoverY, [pop1, pop2, pop3][idx] * 0.64, progress, t, audioLevel, screenType, idx === 1);
                });
                break;
            }

            case 'thought-bubble': {
                drawAnimatedActor(ctx, 128, 635, pop1, progress, t, action, 'thinking', audioLevel, cast);
                if (pop2 > 0.1) {
                    ctx.save();
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(188, 515, 10 * pop2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(214, 475, 16 * pop2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.translate(320, 345);
                    ctx.scale(pop2, pop2);
                    drawOutlinedRect(ctx, -162, -112, 324, 224, 52, '#ffffff', '#1e293b', 3.5, true);
                    ctx.restore();
                    drawHeroSubject(ctx, scene, props[0], 320, 345, pop2 * 0.80, progress, t, audioLevel, screenType, true);
                }
                break;
            }

            case 'document-card': {
                ctx.save();
                ctx.translate(270, 415);
                ctx.scale(pop1, pop1);
                drawOutlinedRect(ctx, -168, -195, 336, 370, 24, '#ffffff', '#1e293b', 3.8, true);
                if (scene?.customHeroImg || (activeProp && activeProp !== 'card_doc')) {
                    drawHeroSubject(ctx, scene, activeProp, 0, 0, 0.92 * propSwitchScale, progress, t, audioLevel, screenType, true);
                } else {
                    drawRichScreenContent(ctx, -148, -172, 296, 324, 'checklist_done', progress, t, audioLevel);
                }
                ctx.restore();
                if (focusTag) {
                    drawShortPillBadge(ctx, focusTag, 270, 200, '#2563eb', '#ffffff', pop2);
                }
                break;
            }

            case 'action-flow': {
                drawHeroSubject(ctx, scene, props[0], 136, 435, pop1 * 0.74, progress, t, audioLevel, screenType, true);
                if (pop2 > 0.1) {
                    ctx.save();
                    ctx.translate(270, 430);
                    ctx.scale(pop2 + audioLevel * 0.08, pop2 + audioLevel * 0.08);
                    ctx.fillStyle = '#22c55e';
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(-34, -14);
                    ctx.lineTo(8, -14);
                    ctx.lineTo(8, -30);
                    ctx.lineTo(40, 0);
                    ctx.lineTo(8, 30);
                    ctx.lineTo(8, 14);
                    ctx.lineTo(-34, 14);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                }
                drawProp(ctx, props[1] || 'lightbulb', 404, 435, pop2 * 0.74, progress, t, audioLevel, screenType);
                break;
            }

            case 'center-hero':
            default: {
                drawHeroSubject(ctx, scene, props[0], 270, 435, pop1 * (1.06 + audioLevel * 0.05), progress, t, audioLevel, screenType, true);
                if (props[1] && pop2 > 0.1 && !scene?.customHeroImg) {
                    drawProp(ctx, props[1], 420, 245, pop2 * 0.45, progress, t, audioLevel, screenType);
                }
                if (cue.crossOut && progress > pivot * 0.7) {
                    drawRedCross(ctx, 270, 435, 130, stagePop(progress, pivot * 0.7, 0.16));
                }
                break;
            }
        }

        drawPhase2Overlay(ctx, phase2Effect, pivot, progress, t, audioLevel);
        drawAmbientEffects(ctx, effect, t, audioLevel);
        } finally {
            currentAudioViseme = -1;
        }
    }

    function drawMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime, prevScene = null, audioLevel = 0, audioViseme = -1) {
        if (sceneIdx > 0 && prevScene && sceneProgress < 0.14) {
            const cue = scene?.motionCue || {};
            const useWipe = cue.transition === 'diagonal-wipe' || (scene?.visualStyle === 'ui-motion' && sceneIdx % 2 === 1);
            if (useWipe) {
                const wipeP = easeOutCubic(clamp01(sceneProgress / 0.14));
                renderSingleMotionScene(ctx, prevScene, 1, sceneIdx - 1, globalTime, 0, -1);
                // Signature SaaS diagonal color panel sweep
                ctx.save();
                const sweepX = lerp(-260, W + 240, wipeP);
                ctx.fillStyle = '#0ea5e9';
                ctx.beginPath();
                ctx.moveTo(sweepX - 180, 0);
                ctx.lineTo(sweepX + 40, 0);
                ctx.lineTo(sweepX - 100, H);
                ctx.lineTo(sweepX - 320, H);
                ctx.closePath();
                ctx.fill();

                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(sweepX - 140, 0);
                ctx.lineTo(sweepX - 280, H);
                ctx.lineTo(0, H);
                ctx.closePath();
                ctx.clip();
                renderSingleMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime, audioLevel, audioViseme);
                ctx.restore();
                return;
            }

            if (cue.transition === 'zoom-blur' && sceneProgress < 0.11) {
                const zp = easeOutCubic(sceneProgress / 0.11);
                const zScale = lerp(0.92, 1.0, zp);
                renderSingleMotionScene(ctx, prevScene, 1, sceneIdx - 1, globalTime, 0, -1);
                ctx.save();
                ctx.globalAlpha = zp;
                ctx.translate(W / 2, H / 2);
                ctx.scale(zScale, zScale);
                ctx.translate(-W / 2, -H / 2);
                renderSingleMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime, audioLevel, audioViseme);
                ctx.restore();
                return;
            }

            if (sceneProgress < 0.08) {
                const blend = easeOutCubic(sceneProgress / 0.08);
                renderSingleMotionScene(ctx, prevScene, 1, sceneIdx - 1, globalTime, 0, -1);
                ctx.save();
                ctx.globalAlpha = blend;
                renderSingleMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime, audioLevel, audioViseme);
                ctx.restore();
                return;
            }
        }

        renderSingleMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime, audioLevel, audioViseme);
    }

    App.motionGraphics = {
        LAYOUT_NAMES,
        BACKDROP_NAMES,
        PROP_NAMES,
        ACTION_NAMES,
        EFFECT_NAMES,
        CAST_NAMES,
        SFX_NAMES,
        SCREEN_TYPES,
        analyzeSceneVisualCue,
        drawMotionScene,
        drawShortPillBadge,
        drawNarratorCameo
    };
})(window);
