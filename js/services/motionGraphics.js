/* ==========================================================================
   Composable 2D Motion Infographic Engine
   - Inspired by modern viral TikTok/Reels explainer animations
   - Combines 7 Backdrops x 7 Spatial Layouts x 30+ Vector Props
   - Real Audio-Envelope Lip Sync & Dynamic Motion Choreography
   - Zero consecutive repetition across layouts, backdrops, and props
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const W = 540;
    const H = 960;
    const FLOOR_Y = 782;

    const BACKDROPS = {
        'cream-room': { top: '#f5ecd4', bot: '#e7d9b6', floor: '#d6c398', line: '#9c8b68', accent: '#10b981', dark: false },
        'hills-nature': { top: '#e2f1dc', bot: '#cde5c4', floor: '#8cb369', hill: '#a2c97d', line: '#6c914d', accent: '#059669', dark: false },
        'city-skyline': { top: '#dce9f6', bot: '#c5d9ef', floor: '#b8cce2', line: '#6e8bad', accent: '#2563eb', dark: false },
        'sunset-warm': { top: '#fde8d7', bot: '#f9ceb7', floor: '#ecc1aa', line: '#b57b61', accent: '#ea580c', dark: false },
        'mint-fresh': { top: '#dff7ec', bot: '#c3eedb', floor: '#a2dcc2', line: '#4d9b7b', accent: '#0d9488', dark: false },
        'night-calm': { top: '#1e1b4b', bot: '#312e81', floor: '#17153b', line: '#6366f1', accent: '#f59e0b', dark: true },
        'alert-tint': { top: '#fee2e2', bot: '#fecdd3', floor: '#fca5a5', line: '#be123c', accent: '#e11d48', dark: false }
    };

    const BACKDROP_NAMES = Object.keys(BACKDROPS);

    const LAYOUT_NAMES = [
        'center-hero',
        'character-left',
        'split-compare',
        'multi-trio',
        'thought-bubble',
        'document-card',
        'action-flow'
    ];

    const PROP_NAMES = [
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

    // ---- Math & Easing ----
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

    function stagePop(progress, startP, span = 0.18) {
        if (progress < startP) return 0;
        return easeOutBack(clamp01((progress - startP) / span));
    }

    // ---- Context & Keyword Parsing ----
    function extractMetricBadge(text) {
        const m = String(text || '').match(/(\d+(?:[.,]\d+)?\s*(?:triệu|tr|k|nghìn|ngàn|%|giây|s|phút|giờ|h|ngày|tháng|độ|lần|món|bước|câu|lít|ml|đ))/i);
        if (m) return m[1].toUpperCase();
        const tm = String(text || '').match(/(\d{1,2}:\d{2})/);
        if (tm) return tm[1];
        return '';
    }

    function extractShortLabel(text, fallback = 'CUỘC SỐNG') {
        const clean = String(text || '')
            .replace(/[•\-!?,.:;"“”()]/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        if (clean.length === 0) return fallback;
        return clean.slice(0, 3).join(' ').toUpperCase();
    }

    const SEMANTIC_RULES = [
        { regex: /code|it|dev|bug|server|deploy|lập trình|phần mềm|service|laptop/, backdrop: 'city-skyline', layout: 'character-left', props: ['laptop', 'fire_flame', 'clock'], mood: 'shocked', badge: '💻 DÂN IT' },
        { regex: /marketing|ads|content|viral|chiến dịch|quảng cáo|thu hút|follower/, backdrop: 'sunset-warm', layout: 'action-flow', props: ['megaphone', 'chart_bars', 'laptop'], mood: 'happy', badge: '📣 MARKETING' },
        { regex: /sale|chốt đơn|khách hàng|tư vấn|doanh số|kpi|mục tiêu|bán hàng/, backdrop: 'mint-fresh', layout: 'split-compare', props: ['target_kpi', 'phone', 'cash_stack'], mood: 'happy', badge: '🎯 SALE / KPI' },
        { regex: /drama|sếp|đồng nghiệp|thảo mai|họp|ot|tăng lương|phỏng vấn|hr|báo cáo/, backdrop: 'alert-tint', layout: 'character-left', props: ['speech_drama', 'card_doc', 'clock'], mood: 'shocked', badge: '🏢 CÔNG SỞ' },
        { regex: /lừa đảo|link lạ|otp|giả mạo|tin nhắn lạ|bẫy/, backdrop: 'alert-tint', layout: 'character-left', props: ['phone', 'scam_link', 'warning_triangle'], mood: 'shocked', badge: '⚠️ CẢNH BÁO', crossOut: true },
        { regex: /ổ điện|cháy|nổ|quá tải|giật điện|nóng máy|cắm sạc/, backdrop: 'alert-tint', layout: 'split-compare', props: ['plug_socket', 'fire_flame', 'battery'], mood: 'shocked', badge: '🔥 NGUY HIỂM', crossOut: true },
        { regex: /điện thoại|màn hình|lướt|thông báo|app|reels|mạng/, backdrop: 'city-skyline', layout: 'center-hero', props: ['phone', 'lightbulb'], mood: 'thinking', badge: '📱 MẸO SỐ' },
        { regex: /uống nước|ly nước|cốc nước|nước ấm|nước lọc|thải độc/, backdrop: 'mint-fresh', layout: 'character-left', props: ['water_glass', 'clock'], mood: 'happy', badge: '💧 SỨC KHỎE' },
        { regex: /cơm|ăn|nấu|bếp|chảo|hành|tỏi|bữa|mì|trà sữa|cà phê/, backdrop: 'cream-room', layout: 'multi-trio', props: ['rice_bowl', 'coffee_cup', 'clock'], mood: 'happy', badge: '🍳 ĐỜI SỐNG' },
        { regex: /nhạc|lofi|lo-fi|giai điệu|âm thanh|piano|chill|nghe/, backdrop: 'night-calm', layout: 'center-hero', props: ['music_bars', 'coffee_cup'], mood: 'happy', badge: '🎵 MOOD CHILL' },
        { regex: /ngủ|đêm|tối|chữa lành|thư giãn|nghỉ ngơi|21h|22h/, backdrop: 'night-calm', layout: 'thought-bubble', props: ['sleep_bed', 'heart', 'clock'], mood: 'happy', badge: '🌙 THƯ GIÃN' },
        { regex: /lương|thu nhập|tiền|phong bì|triệu|nghìn|50k|100k/, backdrop: 'cream-room', layout: 'character-left', props: ['envelope', 'cash_stack'], mood: 'happy', badge: '💵 THU NHẬP' },
        { regex: /tiết kiệm|hũ|giữ lại|để dành|tích lũy|còn lại|số dư/, backdrop: 'mint-fresh', layout: 'action-flow', props: ['jar', 'locked_jar', 'coin'], mood: 'happy', badge: '💰 TÍCH LŨY' },
        { regex: /liệt kê|danh sách|hóa đơn|chi tiêu|cộng lại|tính|bước|kiểm tra|viết ra/, backdrop: 'cream-room', layout: 'document-card', props: ['card_doc', 'coin'], mood: 'thinking', badge: '📝 GHI CHÉP' },
        { regex: /đắt|tốn|giá|mua|chợ|siêu thị|phí|trả/, backdrop: 'sunset-warm', layout: 'multi-trio', props: ['house', 'rice_bowl', 'scooter'], mood: 'shocked', badge: '🏷️ CHI PHÍ' },
        { regex: /so sánh|gấp đôi|chênh lệch|ít hơn|hơn hẳn|tăng|x2/, backdrop: 'city-skyline', layout: 'split-compare', props: ['chart_bars', 'jar'], mood: 'thinking', badge: '📊 SO SÁNH' },
        { regex: /quê|nhà|gia đình|bố mẹ|ở ghép/, backdrop: 'hills-nature', layout: 'character-left', props: ['house', 'heart'], mood: 'happy', badge: '🏠 GIA ĐÌNH' },
        { regex: /thành phố|công ty|văn phòng|cơ hội|sự nghiệp|làm việc|deadline/, backdrop: 'city-skyline', layout: 'action-flow', props: ['city_building', 'suitcase'], mood: 'happy', badge: '💼 CÔNG VIỆC' },
        { regex: /xe|đi làm|xăng|chuyến|về quê|du lịch/, backdrop: 'hills-nature', layout: 'center-hero', props: ['bus', 'scooter'], mood: 'happy', badge: '🛵 DI CHUYỂN' },
        { regex: /sinh nhật|chúc mừng|quà|thiệp|tiệc|tình cảm/, backdrop: 'sunset-warm', layout: 'center-hero', props: ['cake', 'gift_box'], mood: 'happy', badge: '🎁 KHOẢNH KHẮC' },
        { regex: /bí quyết|hóa ra|tưởng tượng|bật mí|đừng|khoan|sai lầm|90%/, backdrop: 'cream-room', layout: 'thought-bubble', props: ['lightbulb', 'red_button'], mood: 'thinking', badge: '💡 BÍ QUYẾT' },
        { regex: /khóa|bảo mật|an toàn|cửa|cất/, backdrop: 'mint-fresh', layout: 'center-hero', props: ['padlock', 'door'], mood: 'happy', badge: '🔒 AN TOÀN' },
        { regex: /giờ|phút|giây|sáng|tháng|tuần|ngày|lịch|cuối tháng/, backdrop: 'sunset-warm', layout: 'center-hero', props: ['calendar', 'clock'], mood: 'thinking', badge: '⏰ THỜI GIAN' }
    ];

    function buildLocalItemsFromPhrase(text, mainProp) {
        const metric = extractMetricBadge(text);
        const clauses = String(text || '')
            .split(/[,.;:!?\-]+/)
            .map((c) => c.trim())
            .filter(Boolean);
        if (clauses.length >= 2) {
            return clauses.slice(0, 3).map((c) => extractShortLabel(c, mainProp.toUpperCase()));
        }
        const words = String(text || '')
            .replace(/[•\-!?,.:;"“”()]/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        const first = words.slice(0, 2).join(' ').toUpperCase() || mainProp.toUpperCase();
        const second = metric || (words.slice(2, 4).join(' ').toUpperCase()) || 'THỰC TẾ';
        const third = words.slice(4, 6).join(' ').toUpperCase() || 'ÁP DỤNG';
        return [first, second, third];
    }

    function analyzeSceneVisualCue(sceneText, beatIdx, videoTitle = '', state = {}) {
        const s = String(sceneText || '').toLowerCase();
        const metric = extractMetricBadge(sceneText) || (beatIdx === 0 ? extractMetricBadge(videoTitle) : '');
        const prevLayout = state.prevLayout || '';
        const prevBackdrop = state.prevBackdrop || '';
        const prevProp = state.prevProp || '';

        const matched = SEMANTIC_RULES.filter((r) => r.regex.test(s));
        const rule = matched.length > 0 ? matched[beatIdx % matched.length] : null;

        let layout = rule ? rule.layout : LAYOUT_NAMES[beatIdx % LAYOUT_NAMES.length];
        if (layout === prevLayout) {
            const altLayouts = LAYOUT_NAMES.filter((l) => l !== prevLayout);
            layout = altLayouts[(beatIdx * 3) % altLayouts.length];
        }

        let backdrop = rule ? rule.backdrop : BACKDROP_NAMES[beatIdx % BACKDROP_NAMES.length];
        if (backdrop === prevBackdrop) {
            const altBgs = BACKDROP_NAMES.filter((b) => b !== prevBackdrop);
            backdrop = altBgs[(beatIdx * 2) % altBgs.length];
        }

        const candidateProps = rule ? [...rule.props] : [PROP_NAMES[(beatIdx * 5) % PROP_NAMES.length], PROP_NAMES[(beatIdx * 5 + 7) % PROP_NAMES.length]];
        if (candidateProps[0] === prevProp) {
            if (candidateProps.length > 1) {
                const first = candidateProps.shift();
                candidateProps.push(first);
            } else {
                const alt = PROP_NAMES[(PROP_NAMES.indexOf(prevProp) + 3 + beatIdx) % PROP_NAMES.length];
                candidateProps[0] = alt;
            }
        }

        const items = buildLocalItemsFromPhrase(sceneText, candidateProps[0]);
        const characterMood = rule ? rule.mood : beatIdx % 3 === 1 ? 'thinking' : 'happy';

        return {
            layout,
            backdrop,
            props: candidateProps,
            characterMood,
            topBadge: metric && !rule?.badge?.includes(metric) ? metric : rule?.badge || extractShortLabel(sceneText, `NHỊP ${beatIdx + 1}`),
            items,
            accentBadge: metric || (beatIdx === 0 ? 'XEM NGAY' : beatIdx % 2 === 0 ? 'QUAN TRỌNG' : ''),
            crossOut: Boolean(rule?.crossOut && /đừng|không|sai|tránh|nổ|lừa/.test(s)),
            sceneText: String(sceneText || ''),
            videoTitle: String(videoTitle || '')
        };
    }

    // ---- Shared Flat-Vector Primitives (crisp 3px dark outline + soft drop shadow) ----
    function drawOutlinedRect(ctx, x, y, w, h, r, fill, stroke = '#1e293b', lw = 3, shadow = true) {
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

    function drawPillBadge(ctx, text, cx, cy, fill, textColor = '#ffffff', scale = 1, fontSize = 18) {
        if (!text || scale <= 0.02) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.font = `900 ${fontSize}px Inter, sans-serif`;
        const tw = ctx.measureText(text).width;
        const pw = Math.min(440, Math.max(92, tw + 36));
        const ph = fontSize + 20;
        drawOutlinedRect(ctx, -pw / 2, -ph / 2, pw, ph, 11, fill, '#1e293b', 2.8, true);
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 1, pw - 16);
        ctx.restore();
    }

    function drawPriceTagCallout(ctx, text, tx, ty, targetX, targetY, scale = 1, fill = '#fef2f2', textColor = '#dc2626') {
        if (!text || scale <= 0.05) return;
        ctx.save();
        ctx.globalAlpha = scale;
        // Pointer line
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();

        ctx.translate(tx, ty);
        ctx.scale(scale, scale);
        ctx.font = '900 15px Inter, sans-serif';
        const pw = Math.min(170, Math.max(70, ctx.measureText(text).width + 26));
        drawOutlinedRect(ctx, -pw / 2, -16, pw, 32, 8, fill, '#1e293b', 2.5, true);
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 1, pw - 12);
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
        ctx.lineTo(-4, -145);
        ctx.lineTo(4, -145);
        ctx.lineTo(8, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.translate(0, -145);
        ctx.rotate(sway * 0.045);
        ctx.fillStyle = '#558b2f';
        [-2.4, -1.7, -0.8, 0.3, 1.0].forEach((ang) => {
            ctx.save();
            ctx.rotate(ang);
            ctx.beginPath();
            ctx.ellipse(28, 0, 32, 9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
        ctx.restore();
    }

    // ---- 7 Rich Backdrops ----
    function drawBackdrop(ctx, backdropId, progress, t) {
        const b = BACKDROPS[backdropId] || BACKDROPS['cream-room'];
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, b.top);
        grad.addColorStop(1, b.bot);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        if (backdropId === 'hills-nature') {
            // Double curved rolling hills
            ctx.fillStyle = b.hill;
            ctx.beginPath();
            ctx.moveTo(0, FLOOR_Y - 35);
            ctx.quadraticCurveTo(145, FLOOR_Y - 95, 290, FLOOR_Y - 40);
            ctx.quadraticCurveTo(420, FLOOR_Y - 10, W, FLOOR_Y - 55);
            ctx.lineTo(W, H);
            ctx.lineTo(0, H);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = b.floor;
            ctx.beginPath();
            ctx.moveTo(0, FLOOR_Y - 15);
            ctx.quadraticCurveTo(210, FLOOR_Y - 60, 410, FLOOR_Y - 12);
            ctx.quadraticCurveTo(485, FLOOR_Y + 5, W, FLOOR_Y - 22);
            ctx.lineTo(W, H);
            ctx.lineTo(0, H);
            ctx.closePath();
            ctx.fill();

            drawPalmTree(ctx, 56, FLOOR_Y, 0.96, Math.sin(t * 2));
            drawPalmTree(ctx, W - 56, FLOOR_Y, 0.96, Math.cos(t * 2));
            return;
        }

        if (backdropId === 'city-skyline') {
            const buildings = [
                { x: 18, w: 78, h: 270, c: '#94a3b8' },
                { x: 108, w: 88, h: 350, c: '#788ba4' },
                { x: 208, w: 96, h: 395, c: '#64748b' },
                { x: 316, w: 86, h: 310, c: '#788ba4' },
                { x: 414, w: 94, h: 255, c: '#94a3b8' }
            ];
            buildings.forEach((bd, idx) => {
                const rise = easeOutCubic(clamp01(progress * 2.2 - idx * 0.04));
                const bh = bd.h * Math.max(0.7, rise);
                const by = FLOOR_Y - bh;
                drawOutlinedRect(ctx, bd.x, by, bd.w, bh, 6, bd.c, '#334155', 2.5, false);
                ctx.fillStyle = '#fef08a';
                for (let wy = by + 20; wy < FLOOR_Y - 28; wy += 34) {
                    for (let wx = bd.x + 14; wx < bd.x + bd.w - 20; wx += 26) {
                        ctx.fillRect(wx, wy, 13, 18);
                    }
                }
            });
        } else if (backdropId === 'night-calm') {
            // Crescent moon + twinkling stars
            ctx.save();
            ctx.fillStyle = '#fef08a';
            ctx.beginPath();
            ctx.arc(435, 165, 36, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = b.top;
            ctx.beginPath();
            ctx.arc(452, 155, 32, 0, Math.PI * 2);
            ctx.fill();

            [
                [78, 170],
                [145, 220],
                [295, 140],
                [355, 235],
                [465, 290]
            ].forEach(([sx, sy], i) => {
                ctx.fillStyle = `rgba(254, 240, 138, ${0.45 + 0.45 * Math.sin(t * 3 + i)})`;
                ctx.beginPath();
                ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        } else if (backdropId === 'sunset-warm' || backdropId === 'mint-fresh') {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.beginPath();
            ctx.arc(270, 390, 195 + Math.sin(t * 2) * 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else if (backdropId === 'alert-tint') {
            const pulseAlpha = 0.08 + Math.abs(Math.sin(t * 5)) * 0.08;
            ctx.save();
            ctx.fillStyle = `rgba(225, 29, 72, ${pulseAlpha})`;
            ctx.beginPath();
            ctx.arc(270, 410, 220, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
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

    // ---- Expressive Audio-Synced Talking Character ----
    function drawExpressiveCharacter(ctx, cx, cy, scale, t, mood = 'happy', audioLevel = 0) {
        if (scale <= 0.02) return;
        const bob = Math.sin(t * 4.5) * 3;
        const blink = Math.sin(t * 2.1) > 0.96;
        const shirtColor = mood === 'shocked' ? '#60a5fa' : mood === 'thinking' ? '#38bdf8' : '#60a5fa';
        const talkOpen = clamp01(audioLevel * 1.4);

        ctx.save();
        ctx.translate(cx, cy + bob);
        ctx.scale(scale, scale);

        // Shadow on floor
        ctx.fillStyle = 'rgba(15,23,42,0.12)';
        ctx.beginPath();
        ctx.ellipse(0, 122, 42, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Legs + shoes
        drawOutlinedRect(ctx, -24, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
        drawOutlinedRect(ctx, 7, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
        drawOutlinedRect(ctx, -28, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);
        drawOutlinedRect(ctx, 6, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);

        // Left arm
        drawOutlinedRect(ctx, -40, -10, 14, 56, 7, shirtColor, '#1e293b', 2.8, false);

        // Right arm gestures dynamically based on mood (pointing up-right or lowered)
        ctx.save();
        ctx.translate(28, -4);
        const gestureAng = mood === 'happy' ? -0.95 + Math.sin(t * 5) * 0.14 : mood === 'thinking' ? -0.35 : 0.08;
        ctx.rotate(gestureAng);
        drawOutlinedRect(ctx, -6, 0, 14, 54, 7, shirtColor, '#1e293b', 2.8, false);
        ctx.fillStyle = '#fde68a';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(1, 56, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Shirt Torso + ID Lanyard
        drawOutlinedRect(ctx, -28, -14, 56, 76, 12, shirtColor, '#1e293b', 3, true);
        drawOutlinedRect(ctx, -10, 14, 20, 26, 4, '#ffffff', '#1e293b', 2, false);

        // Head
        ctx.fillStyle = '#fed7aa';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(0, -56, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Hair
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(0, -64, 40, Math.PI, Math.PI * 2);
        ctx.lineTo(35, -56);
        ctx.quadraticCurveTo(0, -76, -35, -56);
        ctx.closePath();
        ctx.fill();

        // Eyes
        ctx.fillStyle = '#1e293b';
        if (blink) {
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-20, -56);
            ctx.lineTo(-10, -56);
            ctx.moveTo(10, -56);
            ctx.lineTo(20, -56);
            ctx.stroke();
        } else if (mood === 'shocked') {
            ctx.fillStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(-14, -56, 8, 0, Math.PI * 2);
            ctx.arc(14, -56, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#1e293b';
            ctx.beginPath();
            ctx.arc(-14, -56, 3.5, 0, Math.PI * 2);
            ctx.arc(14, -56, 3.5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(-14, -56, 4.3, 0, Math.PI * 2);
            ctx.arc(14, -56, 4.3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Eyebrows
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        if (mood === 'thinking') {
            ctx.beginPath();
            ctx.moveTo(-22, -67);
            ctx.lineTo(-8, -69);
            ctx.moveTo(8, -71);
            ctx.lineTo(22, -66);
            ctx.stroke();
        }

        // Cheeks
        ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
        ctx.beginPath();
        ctx.arc(-24, -44, 5.5, 0, Math.PI * 2);
        ctx.arc(24, -44, 5.5, 0, Math.PI * 2);
        ctx.fill();

        // Audio-synced Mouth (opens/closes naturally with voice!)
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.8;
        if (mood === 'shocked') {
            ctx.fillStyle = '#991b1b';
            ctx.beginPath();
            ctx.ellipse(0, -36, 7, 8 + talkOpen * 4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (talkOpen > 0.14) {
            ctx.fillStyle = '#be123c';
            ctx.beginPath();
            ctx.ellipse(0, -39, 9, 4 + talkOpen * 7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(0, -40, 9, 0.1 * Math.PI, 0.9 * Math.PI);
            ctx.stroke();
        }

        ctx.restore();
    }

    // ---- 32 Crisp Flat-Vector Prop Renderers (drawn centered around 0,0) ----
    function drawProp(ctx, propId, label, cx, cy, scale, progress, t, audioLevel = 0) {
        if (scale <= 0.02) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);

        switch (propId) {
            case 'house': {
                drawOutlinedRect(ctx, -82, -20, 164, 122, 6, '#fef3c7', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -20, 36, 40, 66, 5, '#92400e', '#1e293b', 3, false);
                ctx.fillStyle = '#ef4444';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.5;
                ctx.beginPath();
                ctx.moveTo(-100, -18);
                ctx.lineTo(0, -100);
                ctx.lineTo(100, -18);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                if (label) drawPillBadge(ctx, label, 0, 118, '#ffffff', '#0f172a', 1, 17);
                break;
            }
            case 'door': {
                drawOutlinedRect(ctx, -64, -105, 128, 210, 12, '#0d9488', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -46, -86, 92, 72, 6, '#14b8a6', '#1e293b', 2.5, false);
                ctx.fillStyle = '#fbbf24';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(38, 12, 8, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                if (label) drawPillBadge(ctx, label, 0, -48, '#ffffff', '#0f172a', 1, 15);
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
                if (label) drawPillBadge(ctx, label, 0, 115, '#2563eb', '#ffffff', 1, 16);
                break;
            }
            case 'bus': {
                const bounce = Math.sin(t * 7) * 2.5;
                ctx.translate(0, bounce);
                drawOutlinedRect(ctx, -110, -56, 220, 108, 18, '#facc15', '#1e293b', 3.5, true);
                [-72, -16, 40].forEach((wx) => drawOutlinedRect(ctx, wx, -38, 42, 34, 6, '#bae6fd', '#1e293b', 2.5, false));
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
                if (label) drawPillBadge(ctx, label, 0, 16, '#ffffff', '#0f172a', 1, 15);
                break;
            }
            case 'scooter': {
                drawOutlinedRect(ctx, -84, -18, 168, 52, 24, '#ef4444', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -38, -28, 86, 18, 8, '#334155', '#1e293b', 2.5, false);
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
                if (label) drawPillBadge(ctx, label, 0, -76, '#ffffff', '#0f172a', 1, 16);
                break;
            }
            case 'envelope': {
                drawOutlinedRect(ctx, -110, -68, 220, 136, 12, '#fffbeb', '#1e293b', 3.5, true);
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(-108, -64);
                ctx.lineTo(0, 10);
                ctx.lineTo(108, -64);
                ctx.stroke();
                drawPillBadge(ctx, label || 'LƯƠNG', 0, -10, '#10b981', '#ffffff', 1, 17);
                break;
            }
            case 'cash_stack': {
                drawOutlinedRect(ctx, -88, -32, 176, 80, 10, '#4ade80', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -88, -50, 176, 80, 10, '#86efac', '#1e293b', 3.5, false);
                drawOutlinedRect(ctx, -26, -50, 52, 80, 4, '#fef08a', '#1e293b', 2.5, false);
                if (label) drawPillBadge(ctx, label, 0, -82, '#fbbf24', '#0f172a', 1, 17);
                break;
            }
            case 'jar':
            case 'locked_jar': {
                const fillRatio = 0.28 + 0.48 * easeOutCubic(Math.min(1, progress * 1.4));
                drawOutlinedRect(ctx, -64, -122, 128, 24, 8, '#94a3b8', '#1e293b', 3.5, false);
                drawOutlinedRect(ctx, -90, -98, 180, 212, 28, 'rgba(255,255,255,0.78)', '#1e293b', 3.5, true);
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(-82, -90, 164, 196, 22);
                ctx.clip();
                const liqH = 180 * fillRatio;
                ctx.fillStyle = '#4ade80';
                ctx.fillRect(-82, 106 - liqH, 164, liqH);
                ctx.restore();
                if (propId === 'locked_jar') {
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 6;
                    ctx.beginPath();
                    ctx.arc(0, -130, 24, Math.PI, Math.PI * 2);
                    ctx.stroke();
                }
                drawPillBadge(ctx, label || 'TIẾT KIỆM', 0, 8, '#facc15', '#0f172a', 1, 16);
                break;
            }
            case 'card_doc': {
                drawOutlinedRect(ctx, -96, -118, 192, 236, 14, '#ffffff', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -72, -96, 144, 34, 8, '#e2e8f0', '#1e293b', 2, false);
                [-36, -6, 24, 54].forEach((ly) => {
                    ctx.fillStyle = '#94a3b8';
                    ctx.fillRect(-72, ly, 144, 6);
                });
                if (label) drawPillBadge(ctx, label, 0, -79, '#0f172a', '#ffffff', 1, 15);
                break;
            }
            case 'coin': {
                const bob = Math.sin(t * 4) * 5;
                ctx.translate(0, bob);
                ctx.fillStyle = '#fbbf24';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.arc(0, 0, 62, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#f59e0b';
                ctx.beginPath();
                ctx.arc(0, 0, 44, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#0f172a';
                ctx.font = '900 40px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('$', 0, 2);
                if (label) drawPillBadge(ctx, label, 0, 84, '#ffffff', '#0f172a', 1, 16);
                break;
            }
            case 'red_button': {
                const press = Math.sin(t * 6) > 0.3 ? 5 : 0;
                drawOutlinedRect(ctx, -78, -6, 156, 46, 22, '#991b1b', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -78, -28 + press, 156, 46, 22, '#ef4444', '#1e293b', 3.5, false);
                ctx.fillStyle = '#ffffff';
                ctx.font = '900 22px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label || 'NHẬN', 0, -5 + press, 130);
                break;
            }
            case 'chart_bars': {
                const h1 = 100 * easeOutCubic(Math.min(1, progress * 1.4));
                const h2 = 185 * easeOutCubic(Math.min(1, progress * 1.3));
                drawOutlinedRect(ctx, -92, 90 - h1, 78, h1, 10, '#93c5fd', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, 14, 90 - h2, 86, h2, 10, '#34d399', '#1e293b', 3.5, true);
                if (label) drawPillBadge(ctx, label, 0, 118, '#fbbf24', '#0f172a', 1, 16);
                break;
            }
            case 'rice_bowl': {
                ctx.fillStyle = '#92400e';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.5;
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
                if (label) drawPillBadge(ctx, label, 0, -64, '#10b981', '#ffffff', 1, 16);
                break;
            }
            case 'coffee_cup': {
                drawOutlinedRect(ctx, -46, -54, 92, 128, 14, '#fef3c7', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -54, -72, 108, 22, 8, '#78350f', '#1e293b', 3, false);
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 7;
                ctx.beginPath();
                ctx.moveTo(14, -72);
                ctx.lineTo(28, -112);
                ctx.stroke();
                if (label) drawPillBadge(ctx, label, 0, 14, '#78350f', '#ffffff', 1, 15);
                break;
            }
            case 'water_glass': {
                const fillR = 0.35 + 0.5 * easeOutCubic(Math.min(1, progress * 1.4));
                ctx.fillStyle = 'rgba(255,255,255,0.8)';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.5;
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
                if (label) drawPillBadge(ctx, label, 0, 114, '#0ea5e9', '#ffffff', 1, 16);
                break;
            }
            case 'heart': {
                const beat = 1 + Math.sin(t * 5.5) * 0.06 + audioLevel * 0.06;
                ctx.scale(beat, beat);
                ctx.fillStyle = '#fb7185';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.5;
                ctx.beginPath();
                ctx.moveTo(0, 62);
                ctx.bezierCurveTo(-86, 8, -90, -76, -38, -76);
                ctx.bezierCurveTo(-12, -76, 0, -48, 0, -48);
                ctx.bezierCurveTo(0, -48, 12, -76, 38, -76);
                ctx.bezierCurveTo(90, -76, 86, 8, 0, 62);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                if (label) drawPillBadge(ctx, label, 0, 88, '#ffffff', '#e11d48', 1, 16);
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
                drawOutlinedRect(ctx, -78, -36, 156, 76, 12, '#fbcfe8', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -78, -14, 156, 18, 4, '#ffffff', '#1e293b', 2, false);
                if (label) drawPillBadge(ctx, label, 0, 14, '#db2777', '#ffffff', 1, 16);
                break;
            }
            case 'gift_box': {
                drawOutlinedRect(ctx, -72, -38, 144, 110, 12, '#ef4444', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -82, -62, 164, 30, 8, '#f87171', '#1e293b', 3.5, false);
                drawOutlinedRect(ctx, -14, -62, 28, 134, 4, '#fde047', '#1e293b', 2.5, false);
                if (label) drawPillBadge(ctx, label, 0, 16, '#ffffff', '#0f172a', 1, 16);
                break;
            }
            case 'phone': {
                drawOutlinedRect(ctx, -82, -130, 164, 260, 24, '#1e293b', '#0f172a', 3.5, true);
                drawOutlinedRect(ctx, -70, -114, 140, 228, 16, '#f8fafc', '#334155', 2, false);
                drawOutlinedRect(ctx, -56, -72, 112, 64, 12, '#dbeafe', '#1e293b', 2.5, false);
                if (label) drawPillBadge(ctx, label, 0, 32, '#2563eb', '#ffffff', 1, 15);
                break;
            }
            case 'scam_link': {
                drawOutlinedRect(ctx, -112, -58, 224, 116, 16, '#ffffff', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -112, -58, 224, 34, 14, '#ef4444', '#1e293b', 3.5, false);
                ctx.fillStyle = '#ffffff';
                ctx.font = '900 15px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('HTTP://LINK-LA.XYZ', 0, -35);
                drawPillBadge(ctx, label || 'LỪA ĐẢO', 0, 18, '#fbbf24', '#0f172a', 1, 16);
                break;
            }
            case 'plug_socket': {
                drawOutlinedRect(ctx, -76, -76, 152, 152, 22, '#ffffff', '#1e293b', 3.5, true);
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
                if (label) drawPillBadge(ctx, label, 0, 96, '#ef4444', '#ffffff', 1, 16);
                break;
            }
            case 'battery': {
                const charge = 0.25 + 0.65 * easeOutCubic(Math.min(1, progress * 1.4));
                drawOutlinedRect(ctx, -28, -112, 56, 20, 6, '#94a3b8', '#1e293b', 3, false);
                drawOutlinedRect(ctx, -68, -92, 136, 190, 18, '#ffffff', '#1e293b', 3.5, true);
                const barH = Math.max(24, 166 * charge);
                drawOutlinedRect(ctx, -56, 86 - barH, 112, barH, 10, '#4ade80', '#1e293b', 2.5, false);
                if (label) drawPillBadge(ctx, label, 0, 0, '#fbbf24', '#0f172a', 1, 16);
                break;
            }
            case 'padlock': {
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 14;
                ctx.beginPath();
                ctx.arc(0, -38, 42, Math.PI, Math.PI * 2);
                ctx.stroke();
                drawOutlinedRect(ctx, -68, -36, 136, 114, 18, '#fbbf24', '#1e293b', 3.5, true);
                ctx.fillStyle = '#1e293b';
                ctx.beginPath();
                ctx.arc(0, 14, 14, 0, Math.PI * 2);
                ctx.fill();
                if (label) drawPillBadge(ctx, label, 0, 96, '#10b981', '#ffffff', 1, 16);
                break;
            }
            case 'fire_flame': {
                const flicker = 1 + Math.sin(t * 10) * 0.06 + audioLevel * 0.08;
                ctx.scale(flicker, flicker);
                ctx.fillStyle = '#ef4444';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.5;
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
                if (label) drawPillBadge(ctx, label, 0, 108, '#ffffff', '#dc2626', 1, 16);
                break;
            }
            case 'warning_triangle': {
                const pulse = 1 + Math.sin(t * 7) * 0.04;
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
                ctx.font = '900 72px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('!', 0, 44);
                if (label) drawPillBadge(ctx, label, 0, 96, '#fbbf24', '#0f172a', 1, 16);
                break;
            }
            case 'suitcase': {
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 8;
                ctx.strokeRect(-26, -104, 52, 32);
                drawOutlinedRect(ctx, -64, -74, 128, 164, 18, '#fb7185', '#1e293b', 3.5, true);
                ctx.fillStyle = '#fda4af';
                ctx.fillRect(-32, -52, 12, 120);
                ctx.fillRect(20, -52, 12, 120);
                if (label) drawPillBadge(ctx, label, 0, 108, '#ffffff', '#0f172a', 1, 16);
                break;
            }
            case 'clock': {
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 4.5;
                ctx.beginPath();
                ctx.arc(0, 0, 88, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
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
                if (label) drawPillBadge(ctx, label, 0, 108, '#fbbf24', '#0f172a', 1, 16);
                break;
            }
            case 'calendar': {
                drawOutlinedRect(ctx, -92, -92, 184, 184, 18, '#ffffff', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -92, -92, 184, 52, 18, '#ef4444', '#1e293b', 3.5, false);
                ctx.fillStyle = '#ffffff';
                ctx.font = '900 18px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(label || 'NHẮC NHỞ', 0, -60, 164);
                ctx.fillStyle = '#0f172a';
                ctx.font = '900 46px Inter, sans-serif';
                const num = (label || '').match(/\d+/)?.[0] || '30';
                ctx.fillText(num, 0, 42);
                break;
            }
            case 'lightbulb': {
                const glow = 1 + Math.sin(t * 6) * 0.08 + audioLevel * 0.08;
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
                ctx.lineWidth = 3.5;
                ctx.beginPath();
                ctx.arc(0, -16, 56, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                drawOutlinedRect(ctx, -26, 36, 52, 30, 8, '#94a3b8', '#1e293b', 3, false);
                if (label) drawPillBadge(ctx, label, 0, 92, '#ffffff', '#0f172a', 1, 16);
                break;
            }
            case 'laptop': {
                drawOutlinedRect(ctx, -92, -78, 184, 114, 12, '#334155', '#0f172a', 3.5, true);
                drawOutlinedRect(ctx, -80, -66, 160, 90, 6, '#e0f2fe', '#334155', 2, false);
                ctx.fillStyle = '#0ea5e9';
                ctx.fillRect(-66, -50, 74, 10);
                ctx.fillStyle = '#ef4444';
                ctx.fillRect(-66, -32, 118, 10);
                ctx.fillStyle = '#10b981';
                ctx.fillRect(-66, -14, 92, 10);
                drawOutlinedRect(ctx, -112, 36, 224, 24, 8, '#94a3b8', '#1e293b', 3, true);
                if (label) drawPillBadge(ctx, label, 0, 86, '#2563eb', '#ffffff', 1, 15);
                break;
            }
            case 'megaphone': {
                ctx.save();
                ctx.rotate(-0.18);
                ctx.fillStyle = '#f97316';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 3.5;
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
                if (label) drawPillBadge(ctx, label, 0, 94, '#fbbf24', '#0f172a', 1, 16);
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
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(4, -4);
                ctx.lineTo(74, -64);
                ctx.stroke();
                if (label) drawPillBadge(ctx, label, 0, 108, '#059669', '#ffffff', 1, 16);
                break;
            }
            case 'speech_drama': {
                drawOutlinedRect(ctx, -110, -78, 150, 74, 18, '#fef2f2', '#1e293b', 3.5, true);
                ctx.fillStyle = '#dc2626';
                ctx.font = '900 22px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('EM ƠI?!', -35, -34);
                drawOutlinedRect(ctx, -20, 6, 140, 72, 18, '#fef3c7', '#1e293b', 3.5, true);
                ctx.fillStyle = '#0f172a';
                ctx.fillText('LẠI GÌ NỮA...', 50, 48, 124);
                if (label) drawPillBadge(ctx, label, 0, 104, '#e11d48', '#ffffff', 1, 15);
                break;
            }
            case 'music_bars': {
                drawOutlinedRect(ctx, -110, -90, 220, 180, 22, '#1e1b4b', '#1e293b', 3.5, true);
                for (let i = 0; i < 7; i++) {
                    const boost = 1 + audioLevel * 0.7;
                    const bh = Math.min(110, (24 + Math.abs(Math.sin(t * 6 + i * 0.8)) * 68) * boost);
                    drawOutlinedRect(ctx, -84 + i * 25, 48 - bh, 15, bh, 6, i % 2 === 0 ? '#a855f7' : '#38bdf8', '#0f172a', 1.8, false);
                }
                if (label) drawPillBadge(ctx, label, 0, 74, '#fde047', '#0f172a', 1, 15);
                break;
            }
            case 'sleep_bed': {
                drawOutlinedRect(ctx, -95, 10, 190, 44, 10, '#a78bfa', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -86, -16, 52, 28, 10, '#ffffff', '#1e293b', 2.8, false);
                drawOutlinedRect(ctx, -30, -6, 120, 34, 12, '#818cf8', '#1e293b', 2.8, false);
                ctx.fillStyle = '#fde047';
                ctx.font = '900 28px Inter, sans-serif';
                ctx.fillText('Z', 46, -40 + Math.sin(t * 3) * 5);
                ctx.font = '900 20px Inter, sans-serif';
                ctx.fillText('z', 72, -62 + Math.cos(t * 3) * 5);
                if (label) drawPillBadge(ctx, label, 0, 82, '#ffffff', '#312e81', 1, 16);
                break;
            }
            default: {
                drawOutlinedRect(ctx, -90, -65, 180, 130, 18, '#ffffff', '#1e293b', 3.5, true);
                drawPillBadge(ctx, label || 'MẸO HAY', 0, 0, '#fbbf24', '#0f172a', 1, 18);
                break;
            }
        }
        ctx.restore();
    }

    // ---- 7 Composable Spatial Layouts ----
    function renderSingleMotionScene(ctx, scene, progress, sceneIdx, t, audioLevel = 0) {
        const cue = scene.motionCue || analyzeSceneVisualCue(scene.text, sceneIdx, '');
        const backdropId = BACKDROPS[cue.backdrop] ? cue.backdrop : 'cream-room';
        const bd = BACKDROPS[backdropId];
        const props = Array.isArray(cue.props) && cue.props.length > 0 ? cue.props : ['lightbulb'];
        const items = Array.isArray(cue.items) ? cue.items : [];
        const mood = cue.characterMood || 'happy';

        // 1. Dynamic Backdrop
        drawBackdrop(ctx, backdropId, progress, t);

        // Horizontal slide entrance for smooth scene whip
        const slideT = easeOutCubic(Math.min(1, progress / 0.14));
        const slideX = (1 - slideT) * (sceneIdx === 0 ? 0 : 120);
        const pop1 = stagePop(progress, 0.04, 0.22);
        const pop2 = stagePop(progress, 0.22, 0.22);
        const pop3 = stagePop(progress, 0.42, 0.2);

        ctx.save();
        ctx.translate(slideX, 0);

        // Optional Top Pill (alternates clean badge styles or hides when document header suffices)
        if (cue.topBadge && cue.layout !== 'document-card') {
            drawPillBadge(ctx, cue.topBadge, 270, 118, bd.accent, '#ffffff', stagePop(progress, 0.08, 0.18), 19);
        }

        // 2. Composable Layout Choreography
        switch (cue.layout) {
            case 'character-left': {
                // Talking character left + framed hero prop on right
                drawExpressiveCharacter(ctx, 118, 535, pop1, t, mood === 'none' ? 'happy' : mood, audioLevel);
                drawProp(ctx, props[0], items[0] || '', 345, 390, pop2 * 0.98, progress, t, audioLevel);
                if (cue.accentBadge) {
                    drawPillBadge(ctx, cue.accentBadge, 345, 225, '#fbbf24', '#0f172a', pop3, 18);
                }
                if (cue.crossOut && pop3 > 0.2) {
                    drawRedCross(ctx, 345, 390, 95, pop3);
                }
                break;
            }

            case 'split-compare': {
                // Side-by-side balance / comparison cards with optional X or arrow
                drawOutlinedRect(ctx, 42, 235, 212, 315, 20, 'rgba(255,255,255,0.65)', '#1e293b', 3, true);
                drawOutlinedRect(ctx, 286, 235, 212, 315, 20, 'rgba(255,255,255,0.85)', '#1e293b', 3, true);

                drawProp(ctx, props[0], items[0] || 'TRƯỚC', 148, 395, pop1 * 0.72, progress, t, audioLevel);
                drawProp(ctx, props[1] || props[0], items[1] || 'SAU', 392, 395, pop2 * 0.72, progress, t, audioLevel);

                if (cue.crossOut && pop3 > 0.2) {
                    drawRedCross(ctx, 270, 395, 165, pop3);
                } else if (cue.accentBadge) {
                    drawPillBadge(ctx, cue.accentBadge, 270, 212, '#ef4444', '#ffffff', pop3, 18);
                }
                break;
            }

            case 'multi-trio': {
                // Three horizontal props + pointed callout tags from top
                const xs = [105, 270, 435];
                const pops = [pop1, pop2, pop3];
                xs.forEach((px, idx) => {
                    const pr = props[idx] || props[idx % props.length];
                    drawProp(ctx, pr, '', px, 455, pops[idx] * 0.56, progress, t, audioLevel);
                    if (items[idx]) {
                        drawPriceTagCallout(ctx, items[idx], px, 275, px, 355, pops[idx], idx === 0 ? '#fef2f2' : '#ffffff', idx === 0 ? '#dc2626' : '#0f172a');
                    }
                });
                break;
            }

            case 'thought-bubble': {
                drawExpressiveCharacter(ctx, 118, 555, pop1, t, 'thinking', audioLevel);
                // Thought cloud dots + main cloud
                if (pop2 > 0.1) {
                    ctx.save();
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(178, 462, 10 * pop2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.arc(204, 428, 16 * pop2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();

                    ctx.translate(316, 325);
                    ctx.scale(pop2, pop2);
                    drawOutlinedRect(ctx, -165, -110, 330, 220, 48, '#ffffff', '#1e293b', 3.5, true);
                    ctx.restore();

                    drawProp(ctx, props[0], items[0] || '', 316, 325, pop2 * 0.72, progress, t, audioLevel);
                }
                if (cue.accentBadge) {
                    drawPillBadge(ctx, cue.accentBadge, 316, 468, '#fbbf24', '#0f172a', pop3, 17);
                }
                break;
            }

            case 'document-card': {
                // Big structured itemized list / bill / contract popping row by row
                ctx.save();
                ctx.translate(270, 395);
                ctx.scale(pop1, pop1);
                drawOutlinedRect(ctx, -172, -195, 344, 370, 22, '#ffffff', '#1e293b', 4, true);
                drawPillBadge(ctx, cue.topBadge || 'DANH SÁCH', 0, -195, '#0f172a', '#ffffff', 1, 18);

                const rowLabels = items.length >= 2 ? items.slice(0, 3) : [extractShortLabel(cue.sceneText, 'MỤC 1'), 'CHI TIẾT', 'KẾT QUẢ'];
                rowLabels.forEach((lbl, idx) => {
                    const rowP = stagePop(progress, 0.18 + idx * 0.16, 0.16);
                    if (rowP <= 0.05) return;
                    const ry = -112 + idx * 78;
                    ctx.save();
                    ctx.globalAlpha = rowP;
                    drawOutlinedRect(ctx, -140, ry - 22, 38, 38, 9, '#34d399', '#1e293b', 2.8, false);
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.moveTo(-129, ry - 2);
                    ctx.lineTo(-121, ry + 6);
                    ctx.lineTo(-110, ry - 10);
                    ctx.stroke();

                    ctx.fillStyle = '#0f172a';
                    ctx.font = '800 19px Inter, sans-serif';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(lbl, -88, ry - 2, 224);
                    ctx.restore();
                });

                drawPillBadge(ctx, cue.accentBadge || 'GHI NHỚ', 0, 134, '#ef4444', '#ffffff', pop3, 19);
                ctx.restore();
                break;
            }

            case 'action-flow': {
                // Step 1 -> Animated Arrow -> Step 2
                drawProp(ctx, props[0], items[0] || '', 136, 415, pop1 * 0.68, progress, t, audioLevel);

                if (pop2 > 0.1) {
                    ctx.save();
                    ctx.translate(270, 410);
                    ctx.scale(pop2, pop2);
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

                drawProp(ctx, props[1] || 'lightbulb', items[1] || '', 404, 415, pop2 * 0.68, progress, t, audioLevel);
                if (cue.accentBadge) {
                    drawPillBadge(ctx, cue.accentBadge, 410, 225, '#fbbf24', '#0f172a', pop3, 19);
                }
                break;
            }

            case 'center-hero':
            default: {
                drawProp(ctx, props[0], items[0] || '', 270, 415, pop1, progress, t, audioLevel);
                if (props[1] && pop2 > 0.1) {
                    drawProp(ctx, props[1], '', 420, 265, pop2 * 0.42, progress, t, audioLevel);
                }
                if (cue.accentBadge) {
                    drawPillBadge(ctx, cue.accentBadge, 415, 215, '#ef4444', '#ffffff', pop3, 17);
                }
                if (cue.crossOut && pop3 > 0.2) {
                    drawRedCross(ctx, 270, 415, 130, pop3);
                }
                break;
            }
        }

        // Dynamic audio-reactive sparkle accents
        const spSize = 11 + audioLevel * 7;
        drawSparkle(ctx, 76, 195, spSize, '#fbbf24', t * 1.4);
        drawSparkle(ctx, 464, 240, spSize * 0.9, '#fde047', -t * 1.4);

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

    function drawMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime, prevScene = null, audioLevel = 0) {
        if (sceneIdx > 0 && prevScene && sceneProgress < 0.14) {
            const t = easeOutCubic(sceneProgress / 0.14);
            const prevOffset = -W * t;
            const currOffset = W * (1 - t);

            ctx.save();
            ctx.translate(prevOffset, 0);
            renderSingleMotionScene(ctx, prevScene, 1, sceneIdx - 1, globalTime, 0);
            ctx.restore();

            ctx.save();
            ctx.translate(currOffset, 0);
            renderSingleMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime, audioLevel);
            ctx.restore();
            return;
        }

        renderSingleMotionScene(ctx, scene, sceneProgress, sceneIdx, globalTime, audioLevel);
    }

    App.motionGraphics = {
        LAYOUT_NAMES,
        BACKDROP_NAMES,
        PROP_NAMES,
        analyzeSceneVisualCue,
        drawMotionScene
    };
})(window);
