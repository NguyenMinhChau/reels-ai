/* ==========================================================================
   2D Motion Infographic Renderer (18 Vector Templates + Anti-Repeat Engine)
   - Zero external image API required (crisp 60fps procedural Canvas 2D)
   - Synchronizes multi-beat scene changes with exact narration audio segments
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const W = 540;
    const H = 960;
    const FLOOR_Y = 778;

    const THEMES = {
        cream: { bgTop: '#f6edd9', bgBot: '#ebe0c5', floor: '#dfd0ae', line: '#9c8b68', accent: '#10b981', pill: '#fbbf24' },
        mint: { bgTop: '#e7f2df', bgBot: '#d5e8cb', floor: '#a5c882', line: '#7aa158', accent: '#059669', pill: '#34d399' },
        sky: { bgTop: '#e3f0fb', bgBot: '#d3e5f8', floor: '#c2d8f0', line: '#7da1c4', accent: '#2563eb', pill: '#fbbf24' },
        rose: { bgTop: '#fbe9e7', bgBot: '#f6d8d4', floor: '#e8c1bc', line: '#b87c75', accent: '#e11d48', pill: '#fb7185' },
        lavender: { bgTop: '#efe8fb', bgBot: '#e2d7f6', floor: '#cfc0ec', line: '#8b74b8', accent: '#7c3aed', pill: '#c084fc' },
        amber: { bgTop: '#fef3c7', bgBot: '#fde68a', floor: '#f5d061', line: '#b45309', accent: '#d97706', pill: '#f59e0b' },
        teal: { bgTop: '#e0f7f6', bgBot: '#ccefeb', floor: '#99dcd5', line: '#0f766e', accent: '#0d9488', pill: '#2dd4bf' }
    };

    const THEME_NAMES = Object.keys(THEMES);

    const VISUAL_TEMPLATES = [
        'character',
        'house',
        'envelope',
        'jar',
        'city',
        'checklist',
        'chart',
        'alert',
        'calendar',
        'music',
        'food',
        'phone',
        'lightbulb',
        'clock',
        'water',
        'battery',
        'heart',
        'cart'
    ];

    function clamp01(t) {
        return Math.max(0, Math.min(1, t));
    }

    function easeOutCubic(t) {
        const x = clamp01(t);
        return 1 - Math.pow(1 - x, 3);
    }

    function easeOutBack(t) {
        const x = clamp01(t);
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }

    function extractMetricBadge(text) {
        const match = String(text || '').match(/(\d+(?:[.,]\d+)?\s*(?:triệu|tr|k|nghìn|ngàn|%|giây|s|phút|giờ|h|ngày|tháng|độ|lần|món|bước|câu|lít|ml))/i);
        if (match) return match[1].toUpperCase();
        const timeMatch = String(text || '').match(/(\d{1,2}:\d{2})/);
        if (timeMatch) return timeMatch[1];
        return '';
    }

    function extractShortLabel(text, fallback) {
        const clean = String(text || '')
            .replace(/[•\-!?,.:;"“”()]/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (clean.length === 0) return fallback;
        return clean.slice(0, 3).join(' ').toUpperCase();
    }

    const TEMPLATE_MATCHERS = [
        { template: 'alert', regex: /lừa đảo|cảnh báo|nguy hiểm|cháy|nổ|vi khuẩn|khẩn|otp|link lạ|tránh|sai lầm|cẩn thận/ },
        { template: 'phone', regex: /điện thoại|màn hình|app|tin nhắn|reels|lướt|thông báo|bấm|tải|online|wifi|mạng/ },
        { template: 'battery', regex: /pin|sạc|ổ điện|cắm|điện|năng lượng|mệt mỏi|kết nối|tắt máy/ },
        { template: 'water', regex: /uống nước|nước ấm|ly nước|cốc nước|trà|nước lọc|thải độc/ },
        { template: 'food', regex: /hành|tỏi|cơm|ăn|bếp|chảo|cà phê|nấu|bữa|rau|thịt|nồi/ },
        { template: 'clock', regex: /giờ|phút|giây|đồng hồ|sáng|tối|đêm|thức|ngủ dậy|5h|21h|22h|lịch/ },
        { template: 'heart', regex: /ngủ|chữa lành|gia đình|bố mẹ|thương|ấm áp|bình yên|nghỉ ngơi|thư giãn/ },
        { template: 'music', regex: /nhạc|lofi|lo-fi|giai điệu|âm thanh|piano|nghe|chill|bài hát/ },
        { template: 'cart', regex: /mua|siêu thị|chợ|giỏ|đắt|rẻ|tốn|thanh toán|hóa đơn|chi tiêu/ },
        { template: 'jar', regex: /tiết kiệm|hũ|để dành|còn lại|số dư|giữ lại|tích lũy/ },
        { template: 'envelope', regex: /lương|tiền|nghìn|triệu|50k|100k|ví|thu nhập/ },
        { template: 'chart', regex: /gấp đôi|tăng|giảm|so sánh|chênh|tổng|hiệu quả|top|%/ },
        { template: 'lightbulb', regex: /bí quyết|mẹo|hóa ra|thay vào đó|thử ngay|ý tưởng|bất ngờ|não|tập trung/ },
        { template: 'house', regex: /quê|nhà|phòng|cửa|khóa|gọn|dọn|ban công/ },
        { template: 'city', regex: /thành phố|công ty|văn phòng|deadline|làm việc|bàn|đi làm|sếp/ },
        { template: 'checklist', regex: /bước|cách|danh sách|kiểm tra|viết ra|ghi nhớ|áp dụng|3 việc/ },
        { template: 'calendar', regex: /mỗi ngày|hằng ngày|tuần|tháng|định kỳ|thói quen/ },
        { template: 'character', regex: /bạn|mọi người|ai cũng|follow|comment|chia sẻ|mình/ }
    ];

    const DEFAULT_CUE_META = {
        alert: { theme: 'rose', badge: '⚠️ CẢNH BÁO', label: 'PHÒNG TRÁNH', highlight: 'CHÚ Ý!' },
        phone: { theme: 'sky', badge: '📱 MẸO SỐ', label: 'ĐIỆN THOẠI', highlight: 'CỰC NHANH' },
        battery: { theme: 'amber', badge: '⚡ NĂNG LƯỢNG', label: 'AN TOÀN', highlight: 'BẬT NGAY' },
        water: { theme: 'teal', badge: '💧 SỨC KHỎE', label: 'MỖI NGÀY', highlight: 'TỐT CHO BẠN' },
        food: { theme: 'mint', badge: '🍳 BẾP NHÀ', label: 'NGON SẠCH', highlight: 'MẸO HAY' },
        clock: { theme: 'amber', badge: '⏰ THỜI GIAN', label: 'ĐÚNG NHỊP', highlight: 'KHUNG GIỜ VÀNG' },
        heart: { theme: 'rose', badge: '🌙 CHỮA LÀNH', label: 'BÌNH YÊN', highlight: 'NHẸ NHÀNG' },
        music: { theme: 'lavender', badge: '🎵 MOOD CHILL', label: 'ÂM THANH', highlight: 'THƯ GIÃN' },
        cart: { theme: 'cream', badge: '🛒 CHI TIÊU', label: 'THÔNG MINH', highlight: 'TIẾT KIỆM' },
        jar: { theme: 'mint', badge: '💰 TÍCH LŨY', label: 'GIỮ TIỀN', highlight: 'TĂNG DẦN' },
        envelope: { theme: 'cream', badge: '💵 TÀI CHÍNH', label: 'THỰC TẾ', highlight: 'QUAN TRỌNG' },
        chart: { theme: 'sky', badge: '📈 HIỆU QUẢ', label: 'SO SÁNH', highlight: 'X2 KẾT QUẢ' },
        lightbulb: { theme: 'amber', badge: '💡 BÍ QUYẾT', label: 'HÓA RA LÀ', highlight: 'ÁP DỤNG NGAY' },
        house: { theme: 'mint', badge: '🏠 TẠI NHÀ', label: 'KHÔNG GIAN', highlight: 'GỌN GÀNG' },
        city: { theme: 'sky', badge: '💼 CÔNG VIỆC', label: 'NHỊP SỐNG', highlight: 'HIỆU SUẤT' },
        checklist: { theme: 'teal', badge: '✅ GHI NHỚ', label: 'LÀM THEO', highlight: 'CỰC DỄ' },
        calendar: { theme: 'cream', badge: '📅 THÓI QUEN', label: 'ĐỀU ĐẶN', highlight: 'MỖI NGÀY' },
        character: { theme: 'sky', badge: '👋 GÓC NHÌN', label: 'THỰC TẾ', highlight: 'ĐỪNG BỎ LỠ' }
    };

    function pickDistinctTemplate(candidates, prevTemplate, usedCounts, sceneIdx) {
        const pool = candidates.length > 0 ? candidates : VISUAL_TEMPLATES;
        // Try matched candidates excluding prevTemplate, preferring lowest usage count
        const filtered = pool.filter((tpl) => tpl !== prevTemplate);
        if (filtered.length > 0) {
            filtered.sort((a, b) => (usedCounts.get(a) || 0) - (usedCounts.get(b) || 0));
            return filtered[0];
        }
        // Fallback rotation across all 18 templates, lowest count and != prevTemplate
        const rotated = [];
        for (let i = 0; i < VISUAL_TEMPLATES.length; i++) {
            const t = VISUAL_TEMPLATES[(sceneIdx * 5 + i) % VISUAL_TEMPLATES.length];
            if (t !== prevTemplate) rotated.push(t);
        }
        rotated.sort((a, b) => (usedCounts.get(a) || 0) - (usedCounts.get(b) || 0));
        return rotated[0] || 'lightbulb';
    }

    function pickDistinctTheme(preferredTheme, prevTheme, sceneIdx) {
        if (preferredTheme && THEMES[preferredTheme] && preferredTheme !== prevTheme) {
            return preferredTheme;
        }
        for (let i = 0; i < THEME_NAMES.length; i++) {
            const candidate = THEME_NAMES[(sceneIdx + i) % THEME_NAMES.length];
            if (candidate !== prevTheme) return candidate;
        }
        return 'cream';
    }

    function analyzeSceneVisualCue(sceneText, sceneIdx, videoTitle = '', state = {}) {
        const s = String(sceneText || '').toLowerCase();
        const metric = extractMetricBadge(sceneText) || (sceneIdx === 0 ? extractMetricBadge(videoTitle) : '');
        const prevTemplate = state.prevTemplate || '';
        const prevTheme = state.prevTheme || '';
        const usedCounts = state.usedCounts || new Map();

        const matched = TEMPLATE_MATCHERS.filter((m) => m.regex.test(s)).map((m) => m.template);
        // Add contextual fallback variety based on beat position
        if (matched.length === 0) {
            const rolePools = [
                ['lightbulb', 'alert', 'character'],
                ['character', 'phone', 'city'],
                ['checklist', 'clock', 'water'],
                ['chart', 'lightbulb', 'jar'],
                ['heart', 'checklist', 'calendar']
            ];
            matched.push(...rolePools[sceneIdx % rolePools.length]);
        }

        const template = pickDistinctTemplate(matched, prevTemplate, usedCounts, sceneIdx);
        usedCounts.set(template, (usedCounts.get(template) || 0) + 1);

        const def = DEFAULT_CUE_META[template] || DEFAULT_CUE_META.character;
        const theme = pickDistinctTheme(def.theme, prevTheme, sceneIdx);

        return {
            template,
            theme,
            topBadge: metric ? `${def.badge.split(' ')[0]} ${metric}` : def.badge,
            cardLabel: extractShortLabel(sceneText, def.label),
            highlightBadge: metric || def.highlight,
            sceneText: String(sceneText || ''),
            videoTitle: String(videoTitle || '')
        };
    }

    // ---- Shared Vector Primitives ----
    function drawOutlinedRect(ctx, x, y, w, h, r, fill, stroke = '#1e293b', lw = 3.5, shadow = true) {
        ctx.save();
        if (shadow) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
            ctx.beginPath();
            ctx.roundRect(x + 3, y + 6, w, h, r);
            ctx.fill();
        }
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    function drawPillBadge(ctx, text, cx, cy, fill, textColor = '#ffffff', scale = 1, fontSize = 20) {
        if (!text) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.font = `900 ${fontSize}px Inter, sans-serif`;
        const tw = ctx.measureText(text).width;
        const pw = Math.min(460, Math.max(110, tw + 42));
        const ph = fontSize + 24;
        drawOutlinedRect(ctx, -pw / 2, -ph / 2, pw, ph, 12, fill, '#1e293b', 3, true);
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 1, pw - 20);
        ctx.restore();
    }

    function drawSparkle(ctx, x, y, size, color = '#fbbf24', rot = 0) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        ctx.fillStyle = color;
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
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

    function drawPalmTree(ctx, x, y, scale = 1, sway = 0) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#8b5e3c';
        ctx.strokeStyle = '#3e2723';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(-4, -140);
        ctx.lineTo(4, -140);
        ctx.lineTo(8, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.translate(0, -140);
        ctx.rotate(sway * 0.04);
        ctx.fillStyle = '#558b2f';
        [-2.4, -1.7, -0.8, 0.3, 1.0].forEach((ang) => {
            ctx.save();
            ctx.rotate(ang);
            ctx.beginPath();
            ctx.ellipse(26, 0, 30, 9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        ctx.restore();
    }

    function drawCuteCharacter(ctx, cx, cy, progress, t, happy = true, shirtColor = '#60a5fa') {
        const bob = Math.sin(t * 5) * 4;
        const blink = Math.sin(t * 2.2) > 0.96;
        const wave = Math.sin(t * 6) * 0.25;

        ctx.save();
        ctx.translate(cx, cy + bob);

        drawOutlinedRect(ctx, -26, 56, 18, 52, 6, '#334155', '#1e293b', 3, false);
        drawOutlinedRect(ctx, 8, 56, 18, 52, 6, '#334155', '#1e293b', 3, false);
        drawOutlinedRect(ctx, -30, 102, 24, 12, 6, '#1e293b', '#1e293b', 2, false);
        drawOutlinedRect(ctx, 6, 102, 24, 12, 6, '#1e293b', '#1e293b', 2, false);

        ctx.save();
        ctx.translate(-36, -6);
        ctx.rotate(-0.5 + wave);
        drawOutlinedRect(ctx, -14, -52, 16, 54, 8, shirtColor, '#1e293b', 3, false);
        ctx.fillStyle = '#fde68a';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(-6, -56, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        drawOutlinedRect(ctx, 26, -6, 15, 52, 7, shirtColor, '#1e293b', 3, false);
        drawOutlinedRect(ctx, -30, -14, 60, 74, 14, shirtColor, '#1e293b', 3.5, true);
        drawOutlinedRect(ctx, -12, 14, 24, 28, 4, '#ffffff', '#1e293b', 2, false);

        ctx.fillStyle = '#fed7aa';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, -56, 42, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(0, -64, 42, Math.PI, Math.PI * 2);
        ctx.lineTo(36, -56);
        ctx.quadraticCurveTo(0, -78, -36, -56);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#1e293b';
        if (blink) {
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-20, -56);
            ctx.lineTo(-10, -56);
            ctx.moveTo(10, -56);
            ctx.lineTo(20, -56);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(-15, -56, 4.5, 0, Math.PI * 2);
            ctx.arc(15, -56, 4.5, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
        ctx.beginPath();
        ctx.arc(-25, -44, 6, 0, Math.PI * 2);
        ctx.arc(25, -44, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (happy) {
            ctx.arc(0, -40, 10, 0.1 * Math.PI, 0.9 * Math.PI);
        } else {
            ctx.ellipse(0, -36, 7, 9, 0, 0, Math.PI * 2);
        }
        ctx.stroke();

        ctx.restore();
    }

    // ---- 18 Vector Scene Illustrations ----
    function drawSceneHouse(ctx, cue, pop, t) {
        drawPalmTree(ctx, 64, FLOOR_Y, 1.0, Math.sin(t * 2));
        drawPalmTree(ctx, W - 64, FLOOR_Y, 1.0, Math.cos(t * 2));

        ctx.save();
        ctx.translate(270, 445);
        ctx.scale(pop, pop);

        drawOutlinedRect(ctx, -95, -25, 190, 145, 8, '#fef3c7', '#1e293b', 4, true);
        drawOutlinedRect(ctx, -22, 42, 44, 78, 6, '#92400e', '#1e293b', 3.5, false);
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-118, -22);
        ctx.lineTo(0, -116);
        ctx.lineTo(118, -22);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
        drawPillBadge(ctx, cue.cardLabel || 'NHÀ', 270, 585, '#ffffff', '#0f172a', pop, 20);
    }

    function drawSceneEnvelope(ctx, cue, pop, t) {
        drawCuteCharacter(ctx, 130, 540, pop, t, true, '#34d399');

        ctx.save();
        ctx.translate(310, 395);
        ctx.scale(pop, pop);

        drawOutlinedRect(ctx, -125, -80, 250, 160, 14, '#fffbeb', '#1e293b', 4, true);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-123, -76);
        ctx.lineTo(0, 12);
        ctx.lineTo(123, -76);
        ctx.stroke();

        ctx.restore();

        drawPillBadge(ctx, cue.cardLabel || 'TÀI CHÍNH', 310, 372, '#10b981', '#ffffff', pop, 20);
        drawPillBadge(ctx, cue.highlightBadge || 'TIỀN MẶT', 310, 434, '#fbbf24', '#0f172a', pop, 21);
    }

    function drawSceneJar(ctx, cue, pop, progress) {
        const fillRatio = 0.25 + 0.55 * easeOutCubic(Math.min(1, progress * 1.4));

        ctx.save();
        ctx.translate(270, 440);
        ctx.scale(pop, pop);

        drawOutlinedRect(ctx, -78, -145, 156, 30, 10, '#94a3b8', '#1e293b', 4, false);
        drawOutlinedRect(ctx, -108, -115, 216, 255, 34, 'rgba(255,255,255,0.75)', '#1e293b', 4, true);

        const maxH = 220;
        const liqH = maxH * fillRatio;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(-98, -105, 196, 235, 26);
        ctx.clip();
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(-98, 130 - liqH, 196, liqH);
        ctx.fillStyle = 'rgba(22, 163, 74, 0.25)';
        ctx.fillRect(-55, 145 - liqH, 46, 24);
        ctx.fillRect(10, 175 - liqH, 46, 24);
        ctx.restore();

        drawPillBadge(ctx, cue.cardLabel || 'TIẾT KIỆM', 0, 10, '#facc15', '#0f172a', 1, 18);
        ctx.restore();
    }

    function drawSceneCity(ctx, cue, pop, t) {
        const buildings = [
            { x: 30, w: 85, h: 250, c: '#94a3b8' },
            { x: 125, w: 95, h: 330, c: '#64748b' },
            { x: 230, w: 105, h: 380, c: '#475569' },
            { x: 345, w: 85, h: 290, c: '#64748b' },
            { x: 440, w: 72, h: 220, c: '#94a3b8' }
        ];

        ctx.save();
        buildings.forEach((b, idx) => {
            const rise = easeOutCubic(clamp01(pop * 1.15 - idx * 0.05));
            const bh = b.h * rise;
            const by = FLOOR_Y - bh;
            drawOutlinedRect(ctx, b.x, by, b.w, bh, 8, b.c, '#1e293b', 3, false);

            ctx.fillStyle = '#fef08a';
            for (let wy = by + 22; wy < FLOOR_Y - 30; wy += 36) {
                for (let wx = b.x + 14; wx < b.x + b.w - 22; wx += 26) {
                    ctx.fillRect(wx, wy, 14, 18);
                }
            }
        });
        ctx.restore();

        ctx.save();
        ctx.translate(270, 390 + Math.sin(t * 2.5) * 4);
        ctx.scale(pop, pop);
        drawOutlinedRect(ctx, -130, -75, 260, 150, 18, '#ffffff', '#1e293b', 4, true);
        drawPillBadge(ctx, cue.cardLabel || 'CÔNG VIỆC', 0, -24, '#2563eb', '#ffffff', 1, 18);
        drawPillBadge(ctx, cue.highlightBadge || 'MỤC TIÊU', 0, 28, '#fbbf24', '#0f172a', 1, 19);
        ctx.restore();
    }

    function drawSceneChecklist(ctx, cue, pop, progress) {
        const lines = String(cue.sceneText || '')
            .split(/[,.;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 4);

        const items =
            lines.length >= 2
                ? lines.map((l) => l.split(/\s+/).slice(0, 3).join(' ').toUpperCase())
                : [cue.cardLabel || 'BƯỚC 1', 'THỰC HÀNH', 'KIỂM TRA', 'HOÀN TẤT'];

        ctx.save();
        ctx.translate(270, 430);
        ctx.scale(pop, pop);

        drawOutlinedRect(ctx, -170, -175, 340, 340, 24, '#ffffff', '#1e293b', 4, true);
        drawPillBadge(ctx, cue.highlightBadge || 'CẦN NHỚ', 0, -175, '#0d9488', '#ffffff', 1, 20);

        items.forEach((label, idx) => {
            const rowY = -98 + idx * 74;
            const checked = progress > 0.12 + idx * 0.18;

            drawOutlinedRect(ctx, -135, rowY - 20, 40, 40, 10, checked ? '#34d399' : '#f1f5f9', '#1e293b', 3, false);
            if (checked) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 4.5;
                ctx.beginPath();
                ctx.moveTo(-123, rowY);
                ctx.lineTo(-115, rowY + 10);
                ctx.lineTo(-102, rowY - 8);
                ctx.stroke();
            }

            ctx.fillStyle = '#0f172a';
            ctx.font = '800 20px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, -80, rowY, 220);
        });

        ctx.restore();
    }

    function drawSceneChart(ctx, cue, pop, progress) {
        const bar1H = 140 * easeOutCubic(Math.min(1, progress * 1.5));
        const bar2H = 260 * easeOutCubic(Math.min(1, progress * 1.3));

        ctx.save();
        drawOutlinedRect(ctx, 130, 560 - bar1H, 105, bar1H, 12, '#93c5fd', '#1e293b', 4, true);
        drawOutlinedRect(ctx, 275, 560 - bar2H, 125, bar2H, 12, '#34d399', '#1e293b', 4, true);

        ctx.fillStyle = '#0f172a';
        ctx.font = '900 24px Inter, sans-serif';
        ctx.textAlign = 'center';
        if (bar1H > 50) ctx.fillText('TRƯỚC', 182, 560 - bar1H + 40);
        if (bar2H > 50) ctx.fillText('SAU', 337, 560 - bar2H + 40);
        ctx.restore();

        drawPillBadge(ctx, cue.cardLabel || 'SO SÁNH', 270, 225, '#2563eb', '#ffffff', pop, 20);
        drawPillBadge(ctx, cue.highlightBadge || 'X2 HIỆU QUẢ', 270, 610, '#fbbf24', '#0f172a', pop, 21);
    }

    function drawSceneAlert(ctx, cue, pop, t) {
        const pulse = 1 + Math.sin(t * 7) * 0.03;

        ctx.save();
        ctx.translate(270, 425);
        ctx.scale(pop * pulse, pop * pulse);

        drawOutlinedRect(ctx, -160, -145, 320, 290, 28, '#ffffff', '#1e293b', 4.5, true);

        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, -105);
        ctx.lineTo(75, 25);
        ctx.lineTo(-75, 25);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 54px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('!', 0, 8);

        drawPillBadge(ctx, cue.cardLabel || 'CẨN THẬN', 0, 88, '#fbbf24', '#0f172a', 1, 19);
        ctx.restore();
    }

    function drawSceneCalendar(ctx, cue, pop, t) {
        ctx.save();
        ctx.translate(270, 425 + Math.sin(t * 2.5) * 4);
        ctx.scale(pop, pop);

        drawOutlinedRect(ctx, -145, -140, 290, 275, 24, '#ffffff', '#1e293b', 4.5, true);
        drawOutlinedRect(ctx, -145, -140, 290, 72, 24, '#ef4444', '#1e293b', 4.5, false);

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 22px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(cue.cardLabel || 'LỊCH HẰNG NGÀY', 0, -96, 250);

        ctx.fillStyle = '#0f172a';
        ctx.font = '900 42px Inter, sans-serif';
        ctx.fillText(cue.highlightBadge || 'MỖI NGÀY', 0, 38, 250);
        ctx.restore();
    }

    function drawSceneMusic(ctx, cue, pop, t) {
        ctx.save();
        ctx.translate(270, 425);
        ctx.scale(pop, pop);

        drawOutlinedRect(ctx, -165, -145, 330, 290, 28, '#1e1b4b', '#1e293b', 4.5, true);

        const barCount = 9;
        for (let i = 0; i < barCount; i++) {
            const h = 38 + Math.abs(Math.sin(t * 5 + i * 0.7)) * 115;
            const bx = -120 + i * 28;
            drawOutlinedRect(ctx, bx, 60 - h, 18, h, 8, i % 2 === 0 ? '#a855f7' : '#38bdf8', '#0f172a', 2, false);
        }

        drawPillBadge(ctx, cue.cardLabel || 'CHILL MOOD', 0, 108, '#fde047', '#0f172a', 1, 18);
        ctx.restore();
    }

    function drawSceneFood(ctx, cue, pop, t) {
        ctx.save();
        ctx.translate(270, 445);
        ctx.scale(pop, pop);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        [-50, 0, 50].forEach((sx, idx) => {
            const offset = Math.sin(t * 3 + idx) * 6;
            ctx.beginPath();
            ctx.moveTo(sx, -70);
            ctx.quadraticCurveTo(sx + offset, -110, sx - offset, -145);
            ctx.stroke();
        });

        ctx.fillStyle = '#92400e';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(0, 20, 145, 58, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.ellipse(0, 14, 122, 44, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        [
            { x: -55, y: 12, c: '#ffffff' },
            { x: 0, y: 4, c: '#facc15' },
            { x: 55, y: 12, c: '#ef4444' },
            { x: -24, y: 26, c: '#4ade80' },
            { x: 26, y: 26, c: '#fb923c' }
        ].forEach((d) => {
            ctx.fillStyle = d.c;
            ctx.beginPath();
            ctx.ellipse(d.x, d.y, 24, 14, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });

        ctx.restore();
        drawPillBadge(ctx, cue.cardLabel || 'BẾP NHÀ', 270, 575, '#ffffff', '#0f172a', pop, 19);
    }

    function drawScenePhone(ctx, cue, pop, t) {
        const tilt = Math.sin(t * 2.5) * 0.03;
        ctx.save();
        ctx.translate(270, 430);
        ctx.rotate(tilt);
        ctx.scale(pop, pop);

        // Phone outer body
        drawOutlinedRect(ctx, -108, -175, 216, 350, 32, '#1e293b', '#0f172a', 4, true);
        // Inner screen
        drawOutlinedRect(ctx, -94, -155, 188, 310, 22, '#f8fafc', '#334155', 2, false);
        // Notch
        drawOutlinedRect(ctx, -36, -150, 72, 14, 7, '#0f172a', '#0f172a', 1, false);

        // Notification popup inside phone
        const notifScale = 0.96 + Math.sin(t * 5) * 0.04;
        ctx.save();
        ctx.scale(notifScale, notifScale);
        drawOutlinedRect(ctx, -80, -95, 160, 88, 16, '#dbeafe', '#1e293b', 3, true);
        ctx.fillStyle = '#2563eb';
        ctx.beginPath();
        ctx.arc(-50, -52, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-24, -64, 88, 10);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(-24, -46, 62, 8);
        ctx.restore();

        drawPillBadge(ctx, cue.cardLabel || 'ĐIỆN THOẠI', 0, 55, '#fbbf24', '#0f172a', 1, 17);
        ctx.restore();
    }

    function drawSceneLightbulb(ctx, cue, pop, t) {
        const glow = 1 + Math.sin(t * 6) * 0.08;
        ctx.save();
        ctx.translate(270, 405);
        ctx.scale(pop, pop);

        // Light rays
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        for (let i = 0; i < 8; i++) {
            const ang = (i * Math.PI) / 4 + Math.sin(t * 2) * 0.05;
            const r1 = 98 * glow;
            const r2 = 128 * glow;
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1 - 24);
            ctx.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2 - 24);
            ctx.stroke();
        }

        // Bulb glass
        ctx.fillStyle = '#fde047';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.arc(0, -24, 78, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Bulb neck & screw base
        drawOutlinedRect(ctx, -34, 44, 68, 42, 10, '#94a3b8', '#1e293b', 4, false);
        drawOutlinedRect(ctx, -24, 86, 48, 20, 8, '#475569', '#1e293b', 3.5, false);

        ctx.restore();
        drawPillBadge(ctx, cue.cardLabel || 'BÍ QUYẾT', 270, 565, '#ffffff', '#0f172a', pop, 20);
    }

    function drawSceneClock(ctx, cue, pop, t) {
        ctx.save();
        ctx.translate(270, 415);
        ctx.scale(pop, pop);

        // Outer ring
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, 128, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.arc(0, 0, 108, 0, Math.PI * 2);
        ctx.fill();

        // Tick marks
        for (let i = 0; i < 12; i++) {
            const a = (i * Math.PI) / 6;
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = i % 3 === 0 ? 4 : 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * 86, Math.sin(a) * 86);
            ctx.lineTo(Math.cos(a) * 100, Math.sin(a) * 100);
            ctx.stroke();
        }

        // Animated sweeping hands
        const minAng = -Math.PI / 2 + t * 2.2;
        const hrAng = -Math.PI / 2 + t * 0.4;
        ctx.lineCap = 'round';
        ctx.lineWidth = 7;
        ctx.strokeStyle = '#1e293b';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(hrAng) * 56, Math.sin(hrAng) * 56);
        ctx.stroke();

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(minAng) * 82, Math.sin(minAng) * 82);
        ctx.stroke();

        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        drawPillBadge(ctx, cue.highlightBadge || 'ĐÚNG GIỜ', 270, 580, '#fbbf24', '#0f172a', pop, 20);
    }

    function drawSceneWater(ctx, cue, pop, progress, t) {
        const fillRatio = 0.3 + 0.55 * easeOutCubic(Math.min(1, progress * 1.4));

        ctx.save();
        ctx.translate(270, 440);
        ctx.scale(pop, pop);

        // Glass cup trapezoid
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.moveTo(-98, -125);
        ctx.lineTo(98, -125);
        ctx.lineTo(74, 130);
        ctx.lineTo(-74, 130);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Clipped animated blue water + wave
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-90, -118);
        ctx.lineTo(90, -118);
        ctx.lineTo(68, 122);
        ctx.lineTo(-68, 122);
        ctx.closePath();
        ctx.clip();

        const topY = 122 - 220 * fillRatio;
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(-100, topY + Math.sin(t * 4) * 6);
        ctx.quadraticCurveTo(0, topY - Math.sin(t * 4) * 10, 100, topY + Math.cos(t * 4) * 6);
        ctx.lineTo(100, 130);
        ctx.lineTo(-100, 130);
        ctx.closePath();
        ctx.fill();

        // Bubbles
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        [-28, 12, 34].forEach((bx, idx) => {
            const by = 95 - ((t * 55 + idx * 45) % 140);
            ctx.beginPath();
            ctx.arc(bx, by, 7 + idx * 2, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();

        ctx.restore();
        drawPillBadge(ctx, cue.cardLabel || 'UỐNG NƯỚC', 270, 600, '#0ea5e9', '#ffffff', pop, 20);
    }

    function drawSceneBattery(ctx, cue, pop, progress) {
        const charge = 0.2 + 0.72 * easeOutCubic(Math.min(1, progress * 1.4));

        ctx.save();
        ctx.translate(270, 425);
        ctx.scale(pop, pop);

        // Battery tip
        drawOutlinedRect(ctx, -38, -155, 76, 26, 8, '#94a3b8', '#1e293b', 4, false);
        // Battery body
        drawOutlinedRect(ctx, -95, -130, 190, 265, 24, '#ffffff', '#1e293b', 4.5, true);

        const barH = Math.max(30, 230 * charge);
        const barColor = charge > 0.5 ? '#4ade80' : '#f59e0b';
        drawOutlinedRect(ctx, -78, 120 - barH, 156, barH, 14, barColor, '#1e293b', 3, false);

        // Lightning bolt
        ctx.fillStyle = '#fde047';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(10, -72);
        ctx.lineTo(-32, 8);
        ctx.lineTo(4, 8);
        ctx.lineTo(-14, 78);
        ctx.lineTo(36, -6);
        ctx.lineTo(-2, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
        drawPillBadge(ctx, cue.cardLabel || 'NĂNG LƯỢNG', 270, 595, '#fbbf24', '#0f172a', pop, 20);
    }

    function drawSceneHeart(ctx, cue, pop, t) {
        const beat = 1 + Math.sin(t * 5) * 0.05;
        ctx.save();
        ctx.translate(270, 415);
        ctx.scale(pop * beat, pop * beat);

        drawOutlinedRect(ctx, -155, -135, 310, 270, 30, '#ffffff', '#1e293b', 4.5, true);

        ctx.fillStyle = '#fb7185';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 62);
        ctx.bezierCurveTo(-92, 6, -96, -86, -40, -86);
        ctx.bezierCurveTo(-12, -86, 0, -56, 0, -56);
        ctx.bezierCurveTo(0, -56, 12, -86, 40, -86);
        ctx.bezierCurveTo(96, -86, 92, 6, 0, 62);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
        drawPillBadge(ctx, cue.cardLabel || 'CHỮA LÀNH', 270, 575, '#e11d48', '#ffffff', pop, 20);
    }

    function drawSceneCart(ctx, cue, pop, t) {
        const bounce = Math.sin(t * 4) * 5;
        ctx.save();
        ctx.translate(270, 435);
        ctx.scale(pop, pop);

        // Bag Handle
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(0, -102, 54, Math.PI, Math.PI * 2);
        ctx.stroke();

        // Shopping Bag
        drawOutlinedRect(ctx, -110, -102, 220, 225, 20, '#fb923c', '#1e293b', 4.5, true);
        drawPillBadge(ctx, cue.highlightBadge || 'TIẾT KIỆM', 0, -4, '#fef08a', '#0f172a', 1, 20);

        // Floating Coin
        ctx.save();
        ctx.translate(105, -110 + bounce);
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#0f172a';
        ctx.font = '900 26px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', 0, 2);
        ctx.restore();

        ctx.restore();
        drawPillBadge(ctx, cue.cardLabel || 'MUA SẮM', 270, 585, '#ffffff', '#0f172a', pop, 20);
    }

    function renderSingleMotionScene(ctx, scene, progress, sceneIdx, globalTime) {
        const cue = scene.motionCue || analyzeSceneVisualCue(scene.text, sceneIdx, '');
        const th = THEMES[cue.theme] || THEMES.cream;

        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, th.bgTop);
        grad.addColorStop(1, th.bgBot);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = th.floor;
        ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
        ctx.strokeStyle = th.line;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, FLOOR_Y);
        ctx.lineTo(W, FLOOR_Y);
        ctx.stroke();

        const slideT = easeOutCubic(Math.min(1, progress / 0.14));
        const slideX = (1 - slideT) * (sceneIdx === 0 ? 0 : 180);
        const pop = easeOutBack(Math.min(1, progress / 0.24));
        const badgePop = easeOutBack(Math.min(1, Math.max(0, (progress - 0.05) / 0.22)));

        ctx.save();
        ctx.translate(slideX, 0);

        drawPillBadge(ctx, cue.topBadge, 270, 118, th.accent, '#ffffff', badgePop, 22);
        drawSparkle(ctx, 88, 225, 16, '#fbbf24', globalTime * 1.5);
        drawSparkle(ctx, 456, 265, 14, '#fde047', -globalTime * 1.5);

        switch (cue.template) {
            case 'house':
                drawSceneHouse(ctx, cue, pop, globalTime);
                break;
            case 'envelope':
                drawSceneEnvelope(ctx, cue, pop, globalTime);
                break;
            case 'jar':
                drawSceneJar(ctx, cue, pop, progress);
                break;
            case 'city':
                drawSceneCity(ctx, cue, pop, globalTime);
                break;
            case 'checklist':
                drawSceneChecklist(ctx, cue, pop, progress);
                break;
            case 'chart':
                drawSceneChart(ctx, cue, pop, progress);
                break;
            case 'alert':
                drawSceneAlert(ctx, cue, pop, globalTime);
                break;
            case 'calendar':
                drawSceneCalendar(ctx, cue, pop, globalTime);
                break;
            case 'music':
                drawSceneMusic(ctx, cue, pop, globalTime);
                break;
            case 'food':
                drawSceneFood(ctx, cue, pop, globalTime);
                break;
            case 'phone':
                drawScenePhone(ctx, cue, pop, globalTime);
                break;
            case 'lightbulb':
                drawSceneLightbulb(ctx, cue, pop, globalTime);
                break;
            case 'clock':
                drawSceneClock(ctx, cue, pop, globalTime);
                break;
            case 'water':
                drawSceneWater(ctx, cue, pop, progress, globalTime);
                break;
            case 'battery':
                drawSceneBattery(ctx, cue, pop, progress);
                break;
            case 'heart':
                drawSceneHeart(ctx, cue, pop, globalTime);
                break;
            case 'cart':
                drawSceneCart(ctx, cue, pop, globalTime);
                break;
            default:
                drawCuteCharacter(ctx, 270, 445, pop, globalTime, true);
                drawPillBadge(ctx, cue.highlightBadge, 270, 235, '#fbbf24', '#0f172a', badgePop, 22);
                break;
        }

        ctx.restore();
    }

    function drawMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime, prevScene = null) {
        if (sceneIdx > 0 && prevScene && sceneProgress < 0.14) {
            const t = easeOutCubic(sceneProgress / 0.14);
            const prevOffset = -W * t;
            const currOffset = W * (1 - t);

            ctx.save();
            ctx.translate(prevOffset, 0);
            renderSingleMotionScene(ctx, prevScene, 1, sceneIdx - 1, globalTime);
            ctx.restore();

            ctx.save();
            ctx.translate(currOffset, 0);
            renderSingleMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime);
            ctx.restore();
            return;
        }

        renderSingleMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime);
    }

    App.motionGraphics = {
        VISUAL_TEMPLATES,
        THEME_NAMES,
        analyzeSceneVisualCue,
        drawMotionScene
    };
})(window);
