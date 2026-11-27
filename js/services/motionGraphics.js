/* ==========================================================================
   Composable 2D Storytelling & UI Motion Animation Engine
   - Inspired by Vietnamese 2D Cartoon Storyboards (wide/closeup/POV cuts)
     AND Modern Minimalist UI Motion Explainers (dot-grid cards, cursors, flows)
   - Multi-character cast with audio-envelope lip sync & blinking eyes
   - Zero noisy cropped text clutter over artwork
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const W = 540;
    const H = 960;
    const FLOOR_Y = 782;

    const BACKDROPS = {
        'office-shelf': { top: '#ede3d2', bot: '#dfd1ba', floor: '#c5a47e', line: '#9c7d5b', accent: '#2563eb', dark: false },
        'office-desk': { top: '#eef2ff', bot: '#dbeafe', floor: '#c7d2fe', line: '#6366f1', accent: '#2563eb', dark: false },
        'cream-room': { top: '#fdf6e4', bot: '#eeddb9', floor: '#d6c398', line: '#9c8b68', accent: '#10b981', dark: false },
        'grid-light': { top: '#f4f8ff', bot: '#e2eeff', floor: '#dbeafe', line: '#93c5fd', accent: '#2563eb', dark: false },
        'blueprint-dark': { top: '#0b1528', bot: '#13233f', floor: '#0f172a', line: '#1e3a5f', accent: '#38bdf8', dark: true },
        'bedroom-night': { top: '#0f172a', bot: '#1e1b4b', floor: '#17153b', line: '#4f46e5', accent: '#fbbf24', dark: true },
        'kitchen-cozy': { top: '#fff7ed', bot: '#ffedd5', floor: '#fed7aa', line: '#c2410c', accent: '#ea580c', dark: false },
        'cafe-chill': { top: '#fef3c7', bot: '#fde68a', floor: '#d97706', line: '#78350f', accent: '#b45309', dark: false },
        'server-tech': { top: '#090d16', bot: '#172554', floor: '#0f172a', line: '#38bdf8', accent: '#ef4444', dark: true },
        'hills-nature': { top: '#e2f1dc', bot: '#cde5c4', floor: '#8cb369', hill: '#a2c97d', line: '#6c914d', accent: '#059669', dark: false },
        'city-skyline': { top: '#dce9f6', bot: '#c5d9ef', floor: '#b8cce2', line: '#6e8bad', accent: '#2563eb', dark: false },
        'sunset-warm': { top: '#fde8d7', bot: '#f9ceb7', floor: '#ecc1aa', line: '#b57b61', accent: '#ea580c', dark: false },
        'mint-fresh': { top: '#dff7ec', bot: '#c3eedb', floor: '#a2dcc2', line: '#4d9b7b', accent: '#0d9488', dark: false },
        'night-calm': { top: '#1e1b4b', bot: '#312e81', floor: '#17153b', line: '#6366f1', accent: '#f59e0b', dark: true },
        'alert-tint': { top: '#fee2e2', bot: '#fecdd3', floor: '#fca5a5', line: '#be123c', accent: '#e11d48', dark: false }
    };

    const BACKDROP_NAMES = Object.keys(BACKDROPS);

    const LAYOUT_NAMES = [
        'wide-team',
        'desk-closeup',
        'hand-pov',
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

    const UI_LAYOUTS = ['ui-window', 'ui-checklist', 'ui-flow', 'ui-grid-hero'];
    const STORY_LAYOUTS = ['wide-team', 'desk-closeup', 'hand-pov', 'laptop-popup', 'character-action', 'character-left', 'split-compare', 'action-flow', 'thought-bubble'];

    const CAST_NAMES = ['narrator', 'girl-purple', 'boy-spiky', 'girl-bun', 'manager-red'];
    const CAST_PROFILES = {
        narrator: { shirt: '#1e293b', inner: '#f8fafc', hair: '#1e293b', style: 'parted', laptopDot: false },
        'girl-purple': { shirt: '#f472b6', inner: '#93c5fd', hair: '#9333ea', style: 'top-bun', laptopDot: true },
        'boy-spiky': { shirt: '#64748b', inner: '#0f172a', hair: '#27272a', style: 'spiky', laptopDot: false },
        'girl-bun': { shirt: '#fb923c', inner: '#f8fafc', hair: '#292524', style: 'high-bun', laptopDot: true },
        'manager-red': { shirt: '#ef4444', inner: '#ffffff', hair: '#1e293b', style: 'short', laptopDot: true }
    };

    const ACTION_NAMES = [
        'pointing',
        'typing',
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

    const EFFECT_NAMES = [
        'sparkles',
        'sparks',
        'sweat',
        'steam',
        'hearts',
        'confetti',
        'money',
        'notes'
    ];

    const SFX_NAMES = ['pop', 'click', 'whoosh', 'ding', 'none'];

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

    // ---- Semantic Story & Action Cue Rules ----
    const SEMANTIC_RULES = [
        { regex: /phòng kinh doanh|công ty|văn phòng|mọi người|đội ngũ|nhân viên|đồng nghiệp|họp/, backdrop: 'office-shelf', layout: 'wide-team', cast: 'narrator', action: 'pointing', props: ['laptop', 'chart_bars'], mood: 'happy', effect: 'sparkles', sfx: 'whoosh' },
        { regex: /gọi điện|nghe máy|alo|nhắn tin cho khách|điện thoại lên|nói chuyện điện thoại/, backdrop: 'office-shelf', layout: 'desk-closeup', cast: 'manager-red', action: 'calling', props: ['phone', 'coffee_cup'], mood: 'happy', effect: 'sparkles', sfx: 'pop' },
        { regex: /chụp lại|giấy tờ|chữ ký|ký tên|hợp đồng|bảng giá|hóa đơn|tài liệu|hồ sơ/, backdrop: 'office-shelf', layout: 'hand-pov', cast: 'girl-bun', action: 'pointing', props: ['card_doc', 'phone'], mood: 'thinking', effect: 'sparkles', sfx: 'click' },
        { regex: /mở file|file|excel|bảng tính|màn hình|hệ thống|giao diện|cửa sổ|app/, backdrop: 'office-desk', layout: 'laptop-popup', cast: 'girl-purple', action: 'typing', props: ['laptop', 'card_doc'], mood: 'shocked', effect: 'sweat', sfx: 'pop' },
        { regex: /sập server|lỗi|bug|code|it|dev|deploy|lập trình|service/, backdrop: 'server-tech', layout: 'character-action', cast: 'boy-spiky', action: 'typing', props: ['laptop', 'fire_flame', 'warning_triangle'], mood: 'shocked', effect: 'sparks', sfx: 'pop' },
        { regex: /10 giờ|22 giờ|2 giờ|1 giờ|khuya|nửa đêm|ngủ|nằm|chăn|giấc ngủ|mất ngủ/, backdrop: 'bedroom-night', layout: 'character-action', cast: 'girl-purple', action: 'sleeping', props: ['sleep_bed', 'phone', 'clock'], mood: 'sleepy', effect: 'sparkles', sfx: 'none' },
        { regex: /lướt điện thoại|mở mắt|tin nhắn|sếp nhắn|check tin|điện thoại|reels|mạng xã hội|thông báo/, backdrop: 'bedroom-night', layout: 'character-action', cast: 'boy-spiky', action: 'shocked-phone', props: ['phone', 'speech_drama', 'clock'], mood: 'shocked', effect: 'sweat', sfx: 'pop' },
        { regex: /sếp|trưởng phòng|kế toán|sales|tăng lương|phỏng vấn|hr|deadline|chạy số/, backdrop: 'office-shelf', layout: 'desk-closeup', cast: 'girl-purple', action: 'typing', props: ['laptop', 'speech_drama', 'clock'], mood: 'shocked', effect: 'sweat', sfx: 'pop' },
        { regex: /bước \d|cách làm|hướng dẫn|quy trình|skill|công cụ|tính năng|chọn|bấm nút/, backdrop: 'grid-light', layout: 'ui-window', cast: 'narrator', action: 'pointing', props: ['laptop', 'lightbulb'], mood: 'happy', effect: 'sparkles', sfx: 'click' },
        { regex: /so sánh|gấp đôi|chênh lệch|ít hơn|hơn hẳn|tăng|giảm|hiệu quả|kết quả|trước|sau/, backdrop: 'mint-fresh', layout: 'split-compare', cast: 'narrator', action: 'celebrating', props: ['chart_bars', 'jar', 'lightbulb'], mood: 'happy', effect: 'confetti', sfx: 'ding' },
        { regex: /lừa đảo|link lạ|otp|giả mạo|tin nhắn lạ|bẫy/, backdrop: 'alert-tint', layout: 'character-action', cast: 'girl-bun', action: 'shocked-phone', props: ['scam_link', 'warning_triangle', 'padlock'], mood: 'shocked', effect: 'sparks', sfx: 'pop', crossOut: true },
        { regex: /ổ điện|cháy|nổ|quá tải|giật điện|nóng máy|cắm sạc/, backdrop: 'alert-tint', layout: 'split-compare', cast: 'boy-spiky', action: 'shocked-phone', props: ['plug_socket', 'fire_flame', 'battery'], mood: 'shocked', effect: 'sparks', sfx: 'pop', crossOut: true },
        { regex: /uống nước|ly nước|cốc nước|nước ấm|nước lọc|cà phê|trà sữa|thải độc/, backdrop: 'cafe-chill', layout: 'character-action', cast: 'girl-purple', action: 'drinking', props: ['water_glass', 'coffee_cup', 'heart'], mood: 'happy', effect: 'steam', sfx: 'pop' },
        { regex: /cơm|ăn|nấu|bếp|chảo|hành|tỏi|bữa|tủ lạnh|ngăn đá|chợ/, backdrop: 'kitchen-cozy', layout: 'character-action', cast: 'girl-bun', action: 'cooking', props: ['rice_bowl', 'coffee_cup', 'jar'], mood: 'happy', effect: 'steam', sfx: 'pop' },
        { regex: /nhạc|lofi|lo-fi|giai điệu|âm thanh|piano|chill|thư giãn/, backdrop: 'cafe-chill', layout: 'center-hero', cast: 'girl-purple', action: 'drinking', props: ['music_bars', 'coffee_cup', 'heart'], mood: 'happy', effect: 'notes', sfx: 'none' },
        { regex: /lương|thu nhập|tiền|phong bì|triệu|nghìn|50k|100k|tiết kiệm|hũ|ví|trả góp|chi tiêu|tài chính/, backdrop: 'mint-fresh', layout: 'character-action', cast: 'narrator', action: 'counting-money', props: ['cash_stack', 'jar', 'coin'], mood: 'happy', effect: 'money', sfx: 'ding' },
        { regex: /chạy|vội|muộn|trễ|tắc đường|xe|đi làm|xăng|chuyến/, backdrop: 'city-skyline', layout: 'character-action', cast: 'boy-spiky', action: 'running', props: ['scooter', 'bus', 'clock'], mood: 'shocked', effect: 'sweat', sfx: 'whoosh' },
        { regex: /thành công|chúc mừng|tuyệt vời|nhẹ nhàng|dư thời gian|bí quyết|thay đổi|follow|đăng ký/, backdrop: 'sunset-warm', layout: 'character-left', cast: 'narrator', action: 'celebrating', props: ['lightbulb', 'heart', 'gift_box'], mood: 'happy', effect: 'confetti', sfx: 'ding' },
        { regex: /quê|nhà|gia đình|bố mẹ|tình cảm|yêu/, backdrop: 'hills-nature', layout: 'character-left', cast: 'girl-purple', action: 'celebrating', props: ['house', 'heart', 'gift_box'], mood: 'happy', effect: 'hearts', sfx: 'pop' }
    ];

    function analyzeSceneVisualCue(sceneText, beatIdx, videoTitle = '', state = {}, visualStyle = 'motion') {
        const s = `${sceneText || ''} ${beatIdx === 0 ? videoTitle || '' : ''}`.toLowerCase();
        const isUiMode = visualStyle === 'ui-motion';
        const prevLayout = state.prevLayout || '';
        const prevBackdrop = state.prevBackdrop || '';
        const prevProp = state.prevProp || '';

        const matched = SEMANTIC_RULES.filter((r) => r.regex.test(s));
        const rule = matched.length > 0 ? matched[beatIdx % matched.length] : null;

        const poolLayouts = isUiMode ? UI_LAYOUTS : STORY_LAYOUTS;
        let layout = isUiMode
            ? UI_LAYOUTS[beatIdx % UI_LAYOUTS.length]
            : (rule ? rule.layout : STORY_LAYOUTS[beatIdx % STORY_LAYOUTS.length]);
        if (layout === prevLayout && poolLayouts.length > 1) {
            const alt = poolLayouts.filter((l) => l !== prevLayout);
            layout = alt[(beatIdx * 3) % alt.length];
        }

        let backdrop = isUiMode
            ? (beatIdx % 3 === 1 ? 'blueprint-dark' : 'grid-light')
            : (rule ? rule.backdrop : BACKDROP_NAMES[beatIdx % BACKDROP_NAMES.length]);
        if (!isUiMode && backdrop === prevBackdrop && BACKDROP_NAMES.length > 1) {
            const altBgs = BACKDROP_NAMES.filter((b) => b !== prevBackdrop && b !== 'grid-light' && b !== 'blueprint-dark');
            backdrop = altBgs[(beatIdx * 2) % altBgs.length];
        }

        const candidateProps = rule
            ? [...rule.props]
            : [PROP_NAMES[(beatIdx * 5) % PROP_NAMES.length], PROP_NAMES[(beatIdx * 5 + 7) % PROP_NAMES.length]];
        if (candidateProps[0] === prevProp && candidateProps.length > 1) {
            candidateProps.push(candidateProps.shift());
        }

        const cast = rule?.cast || CAST_NAMES[beatIdx % CAST_NAMES.length];
        const action = rule ? rule.action : ACTION_NAMES[beatIdx % ACTION_NAMES.length];
        const characterMood = rule ? rule.mood : beatIdx % 3 === 1 ? 'thinking' : 'happy';
        const effect = rule ? rule.effect : 'sparkles';
        const sfx = rule?.sfx || (beatIdx === 0 ? 'whoosh' : beatIdx % 2 === 0 ? 'pop' : 'click');

        return {
            layout,
            backdrop,
            cast,
            action,
            effect,
            sfx,
            props: candidateProps,
            characterMood,
            crossOut: Boolean(rule?.crossOut && /đừng|không|sai|tránh|nổ|lừa|sập/.test(s)),
            sceneText: String(sceneText || ''),
            videoTitle: String(videoTitle || '')
        };
    }

    // ---- Shared Vector Primitives ----
    function drawOutlinedRect(ctx, x, y, w, h, r, fill, stroke = '#1e293b', lw = 3, shadow = true) {
        ctx.save();
        if (shadow) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
            ctx.beginPath();
            ctx.roundRect(x + 3, y + 6, w, h, r);
            ctx.fill();
        }
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();
        if (stroke && lw > 0) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lw;
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawCursorPointer(ctx, x, y, clickScale = 1, ripple = 0) {
        ctx.save();
        if (ripple > 0.02 && ripple < 0.98) {
            ctx.strokeStyle = `rgba(37, 99, 235, ${1 - ripple})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, 10 + ripple * 28, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.translate(x, y);
        ctx.scale(clickScale, clickScale);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, 28);
        ctx.lineTo(8, 21);
        ctx.lineTo(14, 32);
        ctx.lineTo(19, 29);
        ctx.lineTo(13, 18);
        ctx.lineTo(23, 17);
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

    // ---- Rich Illustrated Backdrops (Cartoon Office Shelves + Studio Grids) ----
    function drawOfficeBookshelfAndChart(ctx, xShelf = 28, yShelf = 165, chartX = 335, chartY = 175) {
        // Wooden bookshelf frame with 3 rows of colorful upright folders (just like Video 1!)
        drawOutlinedRect(ctx, xShelf, yShelf, 286, 260, 8, '#c5996b', '#8c6642', 3, false);
        const binderCols = ['#38bdf8', '#fb923c', '#facc15', '#34d399', '#ef4444', '#60a5fa'];
        for (let row = 0; row < 3; row++) {
            const ry = yShelf + 12 + row * 82;
            drawOutlinedRect(ctx, xShelf + 10, ry, 266, 70, 4, '#a67f58', '#78583a', 2, false);
            for (let b = 0; b < 7; b++) {
                const bx = xShelf + 18 + b * 36;
                const col = binderCols[(row * 3 + b) % binderCols.length];
                drawOutlinedRect(ctx, bx, ry + 8, 28, 58, 4, col, '#1e293b', 1.8, false);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(bx + 7, ry + 18, 14, 10);
            }
        }
        // Framed Bar Chart Poster on wall
        drawOutlinedRect(ctx, chartX, chartY, 175, 195, 8, '#ffffff', '#cbd5e1', 3, true);
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(chartX + 16, chartY + 18, 143, 24);
        const heights = [62, 108, 48, 86];
        const barCols = ['#3b82f6', '#2563eb', '#60a5fa', '#1d4ed8'];
        heights.forEach((bh, i) => {
            const bx = chartX + 24 + i * 34;
            ctx.fillStyle = barCols[i];
            ctx.fillRect(bx, chartY + 165 - bh, 22, bh);
        });
    }

    function drawBackdrop(ctx, backdropId, progress, t, audioLevel = 0) {
        const b = BACKDROPS[backdropId] || BACKDROPS['cream-room'];
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, b.top);
        grad.addColorStop(1, b.bot);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        if (backdropId === 'grid-light' || backdropId === 'blueprint-dark') {
            const isDark = backdropId === 'blueprint-dark';
            // Modern SaaS Dot Grid / Blueprint Lines (Video 2 aesthetic)
            ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(59, 130, 246, 0.14)';
            for (let gx = 20; gx < W; gx += 28) {
                for (let gy = 40; gy < H - 40; gy += 28) {
                    ctx.beginPath();
                    ctx.arc(gx, gy, 1.8, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            const aura = ctx.createRadialGradient(270, 380, 40, 270, 380, 340);
            aura.addColorStop(0, isDark ? 'rgba(37, 99, 235, 0.24)' : 'rgba(255, 255, 255, 0.72)');
            aura.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = aura;
            ctx.fillRect(0, 0, W, H);
            return;
        }

        if (backdropId === 'office-shelf') {
            drawOfficeBookshelfAndChart(ctx, 26, 160, 336, 175);
        } else if (backdropId === 'office-desk') {
            drawOutlinedRect(ctx, 48, 120, 170, 190, 12, '#e0f2fe', '#64748b', 3, false);
            for (let by = 142; by < 290; by += 28) {
                ctx.fillStyle = 'rgba(255,255,255,0.65)';
                ctx.fillRect(54, by, 158, 8);
            }
            drawOfficeBookshelfAndChart(ctx, 255, 130, 44, 340);
        } else if (backdropId === 'bedroom-night' || backdropId === 'night-calm') {
            if (backdropId === 'bedroom-night') {
                drawOutlinedRect(ctx, 325, 115, 160, 195, 14, '#020617', '#4f46e5', 3.5, false);
                ctx.strokeStyle = '#4f46e5';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(405, 115);
                ctx.lineTo(405, 310);
                ctx.moveTo(325, 212);
                ctx.lineTo(485, 212);
                ctx.stroke();
            }
            ctx.save();
            ctx.fillStyle = '#fef08a';
            ctx.beginPath();
            ctx.arc(432, 168, 30, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = backdropId === 'bedroom-night' ? '#020617' : b.top;
            ctx.beginPath();
            ctx.arc(446, 158, 26, 0, Math.PI * 2);
            ctx.fill();
            [[78, 170], [145, 220], [265, 145], [355, 165], [462, 260]].forEach(([sx, sy], i) => {
                ctx.fillStyle = `rgba(254, 240, 138, ${0.45 + 0.45 * Math.sin(t * 3 + i)})`;
                ctx.beginPath();
                ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        } else if (backdropId === 'kitchen-cozy') {
            ctx.strokeStyle = 'rgba(194, 65, 12, 0.14)';
            ctx.lineWidth = 2;
            for (let ty = 160; ty < FLOOR_Y; ty += 52) {
                ctx.beginPath();
                ctx.moveTo(0, ty);
                ctx.lineTo(W, ty);
                ctx.stroke();
            }
            for (let tx = 40; tx < W; tx += 76) {
                ctx.beginPath();
                ctx.moveTo(tx, 160);
                ctx.lineTo(tx, FLOOR_Y);
                ctx.stroke();
            }
            drawOutlinedRect(ctx, 48, 210, 180, 14, 6, '#b45309', '#1e293b', 2.5, false);
            drawOutlinedRect(ctx, 72, 172, 32, 38, 6, '#34d399', '#1e293b', 2, false);
            drawOutlinedRect(ctx, 118, 166, 36, 44, 6, '#fbbf24', '#1e293b', 2, false);
        } else if (backdropId === 'cafe-chill') {
            [135, 405].forEach((lx, idx) => {
                const sway = Math.sin(t * 2 + idx) * 6;
                ctx.strokeStyle = '#78350f';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(lx, 0);
                ctx.lineTo(lx + sway, 135);
                ctx.stroke();
                ctx.fillStyle = 'rgba(254, 240, 138, 0.32)';
                ctx.beginPath();
                ctx.arc(lx + sway, 165, 58 + audioLevel * 12, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#92400e';
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(lx + sway, 145, 28, Math.PI, Math.PI * 2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            });
        } else if (backdropId === 'server-tech') {
            [42, 416].forEach((rx, col) => {
                drawOutlinedRect(ctx, rx, 200, 82, FLOOR_Y - 200, 8, '#0f172a', '#334155', 2.5, false);
                for (let row = 0; row < 8; row++) {
                    const ry = 225 + row * 62;
                    drawOutlinedRect(ctx, rx + 10, ry, 62, 42, 4, '#1e293b', '#334155', 1.8, false);
                    const isAlertLed = (Math.floor(t * 5 + row + col) % 3) === 0;
                    ctx.fillStyle = isAlertLed ? '#ef4444' : '#22c55e';
                    ctx.beginPath();
                    ctx.arc(rx + 22, ry + 21, 4.5 + audioLevel * 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
        } else if (backdropId === 'hills-nature') {
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
        } else if (backdropId === 'city-skyline') {
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
        } else if (backdropId === 'sunset-warm' || backdropId === 'mint-fresh') {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.beginPath();
            ctx.arc(270, 390, 195 + Math.sin(t * 2) * 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else if (backdropId === 'alert-tint') {
            const pulseAlpha = 0.08 + Math.abs(Math.sin(t * 5)) * 0.08 + audioLevel * 0.06;
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

    // ---- Expressive Multi-Cast Cartoon Head (5 hairstyles + blinking + audio lip-sync!) ----
    function drawCharacterHead(ctx, hx, hy, t, mood = 'happy', audioLevel = 0, cast = 'narrator', shirtExtra = {}) {
        const prof = CAST_PROFILES[cast] || CAST_PROFILES.narrator;
        const blink = Math.sin(t * 2.1 + hx) > 0.96;
        const talkOpen = clamp01(audioLevel * 1.55);
        const tilt = Math.sin(t * 3.5 + hy * 0.01) * 0.03 + audioLevel * 0.035;

        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(tilt);

        // Top bun / back hair before face
        if (prof.style === 'top-bun' || prof.style === 'high-bun') {
            ctx.fillStyle = prof.hair;
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2.8;
            ctx.beginPath();
            ctx.arc(0, -48, 17, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // Head base
        ctx.fillStyle = '#fed7aa';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Hair silhouette per cast profile
        ctx.fillStyle = prof.hair;
        if (prof.style === 'spiky') {
            ctx.beginPath();
            ctx.moveTo(-38, -8);
            ctx.lineTo(-32, -38);
            ctx.lineTo(-18, -28);
            ctx.lineTo(-6, -48);
            ctx.lineTo(8, -28);
            ctx.lineTo(22, -46);
            ctx.lineTo(32, -24);
            ctx.lineTo(38, -6);
            ctx.quadraticCurveTo(0, -24, -38, -8);
            ctx.closePath();
            ctx.fill();
        } else if (prof.style === 'parted') {
            ctx.beginPath();
            ctx.arc(0, -10, 40, Math.PI * 0.96, Math.PI * 2.04);
            ctx.lineTo(36, 0);
            ctx.quadraticCurveTo(6, -18, 0, -4);
            ctx.quadraticCurveTo(-8, -18, -36, 0);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(0, -9, 40, Math.PI, Math.PI * 2);
            ctx.lineTo(36, -2);
            ctx.quadraticCurveTo(0, -22, -36, -2);
            ctx.closePath();
            ctx.fill();
        }

        // Eyes (wide anime/cartoon whites + pupils just like Reference Video 1)
        if (mood === 'sleepy' || blink) {
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-20, -2);
            ctx.lineTo(-9, -2);
            ctx.moveTo(9, -2);
            ctx.lineTo(20, -2);
            ctx.stroke();
        } else {
            const eyeR = mood === 'shocked' ? 8.5 : 7;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(-14, -2, eyeR, 0, Math.PI * 2);
            ctx.arc(14, -2, eyeR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#0f172a';
            const pupilShift = Math.sin(t * 1.4) * 1.2;
            ctx.beginPath();
            ctx.arc(-14 + pupilShift, -2, mood === 'shocked' ? 3.5 : 4.2, 0, Math.PI * 2);
            ctx.arc(14 + pupilShift, -2, mood === 'shocked' ? 3.5 : 4.2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Eyebrows
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.4;
        if (mood === 'thinking') {
            ctx.beginPath();
            ctx.moveTo(-22, -13);
            ctx.lineTo(-8, -15);
            ctx.moveTo(8, -17);
            ctx.lineTo(22, -12);
            ctx.stroke();
        } else if (mood === 'shocked') {
            ctx.beginPath();
            ctx.moveTo(-22, -16);
            ctx.lineTo(-8, -13);
            ctx.moveTo(8, -13);
            ctx.lineTo(22, -16);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.moveTo(-21, -13);
            ctx.lineTo(-8, -14);
            ctx.moveTo(8, -14);
            ctx.lineTo(21, -13);
            ctx.stroke();
        }

        // Cheeks
        ctx.fillStyle = 'rgba(244, 63, 94, 0.32)';
        ctx.beginPath();
        ctx.arc(-24, 11, 5, 0, Math.PI * 2);
        ctx.arc(24, 11, 5, 0, Math.PI * 2);
        ctx.fill();

        // Lip-Synced Mouth (with tongue tint when open like Reference Video 1!)
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        if (talkOpen > 0.14 || mood === 'shocked') {
            const mh = mood === 'shocked' ? 11 + talkOpen * 5 : 4 + talkOpen * 10;
            const mw = mood === 'shocked' ? 10 : 12;
            ctx.fillStyle = '#9f1239';
            ctx.beginPath();
            ctx.ellipse(0, 18, mw, mh, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#fb7185';
            ctx.beginPath();
            ctx.ellipse(0, 18 + mh * 0.35, mw * 0.6, mh * 0.35, 0, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(0, 15, 9, 0.15 * Math.PI, 0.85 * Math.PI);
            ctx.stroke();
        }

        if (shirtExtra.headphone) {
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(0, -4, 44, Math.PI * 0.95, Math.PI * 2.05);
            ctx.stroke();
            drawOutlinedRect(ctx, -49, -12, 14, 28, 7, '#a855f7', '#0f172a', 2.5, false);
            drawOutlinedRect(ctx, 35, -12, 14, 28, 7, '#a855f7', '#0f172a', 2.5, false);
        }

        ctx.restore();
    }

    // ---- Seated Office Desk Character (matches Video 1 desk + chair + open laptop + cute sticker) ----
    function drawSeatedDeskCharacter(ctx, cx, cy, scale, t, cast = 'girl-purple', mood = 'happy', audioLevel = 0, isCalling = false) {
        if (scale <= 0.02) return;
        const prof = CAST_PROFILES[cast] || CAST_PROFILES['girl-purple'];
        const bob = Math.sin(t * 3 + cx) * 1.8;

        ctx.save();
        ctx.translate(cx, cy + bob);
        ctx.scale(scale, scale);

        // Office Chair Backrest
        drawOutlinedRect(ctx, -56, -72, 112, 118, 22, '#cbd5e1', '#94a3b8', 2.5, false);
        // Shoulders & Torso
        drawOutlinedRect(ctx, -44, -6, 88, 72, 22, prof.shirt, '#1e293b', 2.8, false);
        // Collar / Inner neck
        ctx.fillStyle = prof.inner;
        ctx.beginPath();
        ctx.moveTo(-16, -6);
        ctx.lineTo(0, 12);
        ctx.lineTo(16, -6);
        ctx.closePath();
        ctx.fill();

        // Talking/Calling arm lifting smartphone cleanly to ear
        if (isCalling) {
            drawOutlinedRect(ctx, 28, -42, 15, 42, 7, prof.shirt, '#1e293b', 2.5, false);
            drawOutlinedRect(ctx, 26, -72, 20, 34, 4, '#0f172a', '#1e293b', 2, false);
        }

        drawCharacterHead(ctx, 0, -56, t, mood, audioLevel, cast);

        // Desk surface & front laptop
        drawOutlinedRect(ctx, -108, 48, 216, 48, 8, '#e3c099', '#a67c52', 3, true);
        // Laptop lid facing camera with cute minimal sticker icons (like orange cat / colorful dots!)
        drawOutlinedRect(ctx, -48, 8, 96, 60, 8, '#cbd5e1', '#64748b', 2.5, true);
        if (prof.laptopDot) {
            // Cute orange cat icon silhouette
            ctx.fillStyle = '#fb923c';
            ctx.beginPath();
            ctx.arc(0, 38, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-9, 32);
            ctx.lineTo(-10, 23);
            ctx.lineTo(-2, 30);
            ctx.moveTo(9, 32);
            ctx.lineTo(10, 23);
            ctx.lineTo(2, 30);
            ctx.fill();
        } else {
            // Colorful icon dots like boy's Macbook in Video 1
            const dots = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#fb923c'];
            dots.forEach((dc, idx) => {
                const dx = -24 + (idx % 3) * 24;
                const dy = 28 + Math.floor(idx / 3) * 18;
                ctx.fillStyle = dc;
                ctx.beginPath();
                ctx.arc(dx, dy, 6.5, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        ctx.restore();
    }

    // ---- 11 Expressive Standing/Action Poses ----
    function drawAnimatedActor(ctx, cx, cy, scale, progress, t, action = 'pointing', mood = 'happy', audioLevel = 0, cast = 'narrator') {
        if (scale <= 0.02) return;
        const prof = CAST_PROFILES[cast] || CAST_PROFILES.narrator;
        const shirtColor = prof.shirt;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);

        if (action === 'sleeping') {
            const breathe = Math.sin(t * 2.5) * 3;
            drawOutlinedRect(ctx, -145, 22, 290, 62, 16, '#818cf8', '#1e293b', 3.5, true);
            drawOutlinedRect(ctx, -155, -24, 22, 118, 8, '#475569', '#1e293b', 3, false);
            drawOutlinedRect(ctx, 133, 4, 22, 90, 8, '#475569', '#1e293b', 3, false);
            drawOutlinedRect(ctx, -128, -4, 72, 34, 12, '#ffffff', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, -56, 8 + breathe * 0.3, 195, 58, 18, '#a78bfa', '#1e293b', 3, false);
            drawCharacterHead(ctx, -90, -24 + breathe * 0.5, t, 'sleepy', audioLevel * 0.3, cast);
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
            const typeBob = Math.sin(t * 14) * (2 + audioLevel * 3);
            drawOutlinedRect(ctx, -135, 36, 270, 20, 8, '#b45309', '#1e293b', 3.2, true);
            drawOutlinedRect(ctx, -118, 56, 16, 74, 4, '#78350f', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, 102, 56, 16, 74, 4, '#78350f', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, -36, -16 + typeBob * 0.4, 72, 56, 14, shirtColor, '#1e293b', 3, false);
            drawCharacterHead(ctx, 0, -56 + typeBob * 0.5, t, mood, audioLevel, cast);
            drawOutlinedRect(ctx, -46, 6 + Math.sin(t * 18) * 5, 16, 36, 7, shirtColor, '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, 30, 6 + Math.cos(t * 18) * 5, 16, 36, 7, shirtColor, '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, -64, -26, 128, 66, 10, '#334155', '#0f172a', 3, true);
            drawOutlinedRect(ctx, -54, -18, 108, 50, 6, mood === 'shocked' ? '#fee2e2' : '#e0f2fe', '#334155', 2, false);
            const barFlash = Math.sin(t * 10) > 0;
            ctx.fillStyle = mood === 'shocked' ? '#ef4444' : '#0ea5e9';
            ctx.fillRect(-44, -8, barFlash ? 78 : 54, 8);
            ctx.fillStyle = '#10b981';
            ctx.fillRect(-44, 6, barFlash ? 52 : 84, 8);
            ctx.fillStyle = '#f59e0b';
            ctx.fillRect(-44, 20, 64, 6);
            drawOutlinedRect(ctx, 82, 8, 28, 28, 6, '#ffffff', '#1e293b', 2.5, false);
            ctx.restore();
            return;
        }

        if (action === 'cooking') {
            const stir = Math.sin(t * 8) * 14;
            drawOutlinedRect(ctx, -145, 42, 290, 86, 12, '#fed7aa', '#1e293b', 3.2, true);
            drawOutlinedRect(ctx, -38, -16, 76, 62, 14, shirtColor, '#1e293b', 3, false);
            drawOutlinedRect(ctx, -24, 0, 48, 44, 8, '#ffffff', '#1e293b', 2.2, false);
            drawCharacterHead(ctx, 0, -56, t, mood, audioLevel, cast);
            drawOutlinedRect(ctx, -78, 22, 92, 22, 8, '#475569', '#0f172a', 3, false);
            drawOutlinedRect(ctx, 14, 26, 46, 10, 5, '#1e293b', '#0f172a', 2, false);
            ctx.save();
            ctx.translate(-32 + stir * 0.5, 16);
            ctx.rotate(stir * 0.02);
            drawOutlinedRect(ctx, -4, -36, 8, 42, 4, '#d97706', '#1e293b', 2, false);
            ctx.restore();
            drawOutlinedRect(ctx, 18, -4 + Math.sin(t * 8) * 4, 34, 14, 7, shirtColor, '#1e293b', 2.6, false);
            drawOutlinedRect(ctx, 76, -8, 44, 50, 10, '#dcfce7', '#1e293b', 2.6, false);
            ctx.restore();
            return;
        }

        if (action === 'phone-scroll' || action === 'shocked-phone' || action === 'calling') {
            const shake = action === 'shocked-phone' ? Math.sin(t * 22) * 3.5 : Math.sin(t * 4) * 2;
            ctx.translate(shake, Math.sin(t * 4.5) * 3);
            ctx.fillStyle = 'rgba(15,23,42,0.12)';
            ctx.beginPath();
            ctx.ellipse(0, 122, 42, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            drawOutlinedRect(ctx, -24, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, 7, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, -28, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);
            drawOutlinedRect(ctx, 6, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);
            drawOutlinedRect(ctx, -28, -14, 56, 76, 12, shirtColor, '#1e293b', 3, true);
            drawCharacterHead(ctx, 0, -56, t, action === 'shocked-phone' ? 'shocked' : mood, audioLevel, cast);
            if (action === 'calling') {
                drawOutlinedRect(ctx, 22, -48, 15, 44, 7, shirtColor, '#1e293b', 2.6, false);
                drawOutlinedRect(ctx, 22, -78, 22, 36, 5, '#0f172a', '#0f172a', 2.5, true);
            } else {
                drawOutlinedRect(ctx, 18, -8, 42, 15, 7, shirtColor, '#1e293b', 2.6, false);
                drawOutlinedRect(ctx, 48, -44 + Math.sin(t * 7) * 3, 44, 76, 9, '#0f172a', '#0f172a', 3, true);
                drawOutlinedRect(ctx, 53, -36 + Math.sin(t * 7) * 3, 34, 60, 5, action === 'shocked-phone' ? '#fecaca' : '#dbeafe', '#334155', 1.8, false);
            }
            ctx.restore();
            return;
        }

        if (action === 'running') {
            const stride = Math.sin(t * 14);
            ctx.translate(0, Math.abs(stride) * -7);
            ctx.strokeStyle = 'rgba(30, 41, 59, 0.25)';
            ctx.lineWidth = 3;
            [-40, -10, 25].forEach((ly, i) => {
                const lx = -110 - ((t * 180 + i * 30) % 45);
                ctx.beginPath();
                ctx.moveTo(lx, ly);
                ctx.lineTo(lx + 46, ly);
                ctx.stroke();
            });
            ctx.save();
            ctx.translate(-8, 56);
            ctx.rotate(stride * 0.65);
            drawOutlinedRect(ctx, -8, 0, 16, 56, 5, '#475569', '#1e293b', 2.8, false);
            ctx.restore();
            ctx.save();
            ctx.translate(8, 56);
            ctx.rotate(-stride * 0.65);
            drawOutlinedRect(ctx, -8, 0, 16, 56, 5, '#475569', '#1e293b', 2.8, false);
            ctx.restore();
            ctx.rotate(0.16);
            drawOutlinedRect(ctx, -28, -14, 56, 74, 12, shirtColor, '#1e293b', 3, true);
            drawCharacterHead(ctx, 4, -56, t, mood, audioLevel, cast);
            ctx.restore();
            return;
        }

        if (action === 'celebrating') {
            const jump = Math.abs(Math.sin(t * 6)) * -(10 + audioLevel * 12);
            ctx.translate(0, jump);
            ctx.fillStyle = 'rgba(15,23,42,0.12)';
            ctx.beginPath();
            ctx.ellipse(0, 122 - jump, 42, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            drawOutlinedRect(ctx, -24, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, 7, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
            ctx.save();
            ctx.translate(-28, -6);
            ctx.rotate(2.4 + Math.sin(t * 8) * 0.2);
            drawOutlinedRect(ctx, -7, 0, 14, 52, 7, shirtColor, '#1e293b', 2.8, false);
            ctx.restore();
            ctx.save();
            ctx.translate(28, -6);
            ctx.rotate(-2.4 - Math.sin(t * 8) * 0.2);
            drawOutlinedRect(ctx, -7, 0, 14, 52, 7, shirtColor, '#1e293b', 2.8, false);
            ctx.restore();
            drawOutlinedRect(ctx, -28, -14, 56, 76, 12, shirtColor, '#1e293b', 3, true);
            drawCharacterHead(ctx, 0, -56, t, 'happy', audioLevel, cast);
            ctx.restore();
            return;
        }

        // Default standing presenter (jacket + white inner tee look like Minh IT in Video 1!)
        const bob = Math.sin(t * 4.5) * 3;
        ctx.translate(0, bob);
        ctx.fillStyle = 'rgba(15,23,42,0.12)';
        ctx.beginPath();
        ctx.ellipse(0, 122, 42, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        drawOutlinedRect(ctx, -24, 58, 17, 56, 5, '#334155', '#1e293b', 2.8, false);
        drawOutlinedRect(ctx, 7, 58, 17, 56, 5, '#334155', '#1e293b', 2.8, false);
        drawOutlinedRect(ctx, -28, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);
        drawOutlinedRect(ctx, 6, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);
        drawOutlinedRect(ctx, -40, -10, 14, 56, 7, shirtColor, '#1e293b', 2.8, false);

        ctx.save();
        ctx.translate(28, -4);
        const gestureAng = action === 'drinking' ? -1.4 : (mood === 'happy' ? -0.95 + Math.sin(t * 6) * (0.14 + audioLevel * 0.22) : -0.2);
        ctx.rotate(gestureAng);
        drawOutlinedRect(ctx, -6, 0, 14, 54, 7, shirtColor, '#1e293b', 2.8, false);
        ctx.fillStyle = '#fed7aa';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(1, 56, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        drawOutlinedRect(ctx, -28, -14, 56, 76, 12, shirtColor, '#1e293b', 3, true);
        // White inner collar tee stripe
        drawOutlinedRect(ctx, -10, -14, 20, 74, 4, prof.inner, null, 0, false);
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
                ctx.globalAlpha = (1 - p) * 0.55;
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
            for (let i = 0; i < 8; i++) {
                const p = (t * 0.55 + i * 0.13) % 1;
                const cx = 60 + ((i * 63) % 420) + Math.sin(t * 4 + i) * 14;
                const cy = 110 + p * 260;
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

        const spSize = 10 + audioLevel * 7;
        drawSparkle(ctx, 74, 195, spSize, '#fbbf24', t * 1.4);
        drawSparkle(ctx, 466, 240, spSize * 0.85, '#fde047', -t * 1.4);
    }

    // ---- 36 Crisp Flat-Vector Props ----
    function drawProp(ctx, propId, cx, cy, scale, progress, t, audioLevel = 0) {
        if (scale <= 0.02) return;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);

        switch (propId) {
            case 'house': {
                drawOutlinedRect(ctx, -82, -20, 164, 122, 6, '#fef3c7', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -20, 36, 40, 66, 5, '#92400e', '#1e293b', 3, false);
                drawOutlinedRect(ctx, -64, 8, 32, 32, 4, '#bae6fd', '#1e293b', 2.5, false);
                drawOutlinedRect(ctx, 32, 8, 32, 32, 4, '#bae6fd', '#1e293b', 2.5, false);
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
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(0, 12, 16, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                break;
            }
            case 'cash_stack': {
                drawOutlinedRect(ctx, -88, -32, 176, 80, 10, '#4ade80', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -88, -50, 176, 80, 10, '#86efac', '#1e293b', 3.5, false);
                drawOutlinedRect(ctx, -26, -50, 52, 80, 4, '#fef08a', '#1e293b', 2.5, false);
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
                break;
            }
            case 'card_doc': {
                drawOutlinedRect(ctx, -96, -118, 192, 236, 14, '#ffffff', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -72, -96, 144, 24, 6, '#3b82f6', '#1e293b', 2, false);
                [-44, -10, 24, 58].forEach((ly, i) => {
                    ctx.fillStyle = i % 2 === 0 ? '#10b981' : '#94a3b8';
                    ctx.beginPath();
                    ctx.arc(-58, ly + 4, 8, 0, Math.PI * 2);
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
                ctx.lineWidth = 4;
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
                const press = Math.sin(t * 6) > 0.3 ? 6 : 0;
                drawOutlinedRect(ctx, -78, -6, 156, 46, 22, '#991b1b', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -78, -28 + press, 156, 46, 22, '#ef4444', '#1e293b', 3.5, false);
                break;
            }
            case 'chart_bars': {
                const h1 = 96 * easeOutCubic(Math.min(1, progress * 1.4));
                const h2 = 140 * easeOutCubic(Math.min(1, progress * 1.3));
                const h3 = 185 * easeOutCubic(Math.min(1, progress * 1.25));
                drawOutlinedRect(ctx, -104, 90 - h1, 56, h1, 8, '#93c5fd', '#1e293b', 3, true);
                drawOutlinedRect(ctx, -28, 90 - h2, 56, h2, 8, '#60a5fa', '#1e293b', 3, true);
                drawOutlinedRect(ctx, 48, 90 - h3, 56, h3, 8, '#34d399', '#1e293b', 3, true);
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
                break;
            }
            case 'coffee_cup': {
                drawOutlinedRect(ctx, -46, -54, 92, 128, 14, '#fef3c7', '#1e293b', 3.5, true);
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
                break;
            }
            case 'heart': {
                const beat = 1 + Math.sin(t * 5.5) * 0.06 + audioLevel * 0.08;
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
                break;
            }
            case 'gift_box': {
                drawOutlinedRect(ctx, -72, -38, 144, 110, 12, '#ef4444', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -82, -62, 164, 30, 8, '#f87171', '#1e293b', 3.5, false);
                drawOutlinedRect(ctx, -14, -62, 28, 134, 4, '#fde047', '#1e293b', 2.5, false);
                break;
            }
            case 'phone': {
                ctx.translate(Math.sin(t * 16) * (0.4 + audioLevel), 0);
                drawOutlinedRect(ctx, -82, -130, 164, 260, 24, '#1e293b', '#0f172a', 3.5, true);
                drawOutlinedRect(ctx, -70, -114, 140, 228, 16, '#f8fafc', '#334155', 2, false);
                drawOutlinedRect(ctx, -56, -86, 112, 46, 10, '#dbeafe', '#1e293b', 2.2, false);
                drawOutlinedRect(ctx, -56, -24, 112, 46, 10, '#fef3c7', '#1e293b', 2.2, false);
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(54, -90, 13, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'scam_link': {
                drawOutlinedRect(ctx, -112, -58, 224, 116, 16, '#ffffff', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -112, -58, 224, 34, 14, '#ef4444', '#1e293b', 3.5, false);
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
                break;
            }
            case 'battery': {
                const charge = 0.25 + 0.65 * easeOutCubic(Math.min(1, progress * 1.4));
                drawOutlinedRect(ctx, -28, -112, 56, 20, 6, '#94a3b8', '#1e293b', 3, false);
                drawOutlinedRect(ctx, -68, -92, 136, 190, 18, '#ffffff', '#1e293b', 3.5, true);
                const barH = Math.max(24, 166 * charge);
                drawOutlinedRect(ctx, -56, 86 - barH, 112, barH, 10, '#4ade80', '#1e293b', 2.5, false);
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
                break;
            }
            case 'fire_flame': {
                const flicker = 1 + Math.sin(t * 10) * 0.06 + audioLevel * 0.1;
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
                break;
            }
            case 'warning_triangle': {
                const pulse = 1 + Math.sin(t * 7) * 0.05 + audioLevel * 0.06;
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
                drawOutlinedRect(ctx, -64, -74, 128, 164, 18, '#fb7185', '#1e293b', 3.5, true);
                ctx.fillStyle = '#fda4af';
                ctx.fillRect(-32, -52, 12, 120);
                ctx.fillRect(20, -52, 12, 120);
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
                break;
            }
            case 'calendar': {
                drawOutlinedRect(ctx, -92, -92, 184, 184, 18, '#ffffff', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -92, -92, 184, 48, 18, '#ef4444', '#1e293b', 3.5, false);
                for (let r = 0; r < 3; r++) {
                    for (let c = 0; c < 4; c++) {
                        drawOutlinedRect(ctx, -64 + c * 36, -24 + r * 34, 24, 22, 4, r === 1 && c === 2 ? '#fde047' : '#e2e8f0', '#94a3b8', 1.5, false);
                    }
                }
                break;
            }
            case 'lightbulb': {
                const glow = 1 + Math.sin(t * 6) * 0.08 + audioLevel * 0.09;
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
                break;
            }
            case 'megaphone': {
                ctx.save();
                ctx.rotate(-0.18 + Math.sin(t * 7) * 0.06);
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
                break;
            }
            case 'speech_drama': {
                drawOutlinedRect(ctx, -108, -76, 146, 72, 22, '#fef2f2', '#1e293b', 3.5, true);
                ctx.fillStyle = '#ef4444';
                ctx.fillRect(-42, -58, 12, 24);
                ctx.beginPath();
                ctx.arc(-36, -24, 6, 0, Math.PI * 2);
                ctx.fill();
                drawOutlinedRect(ctx, -16, 8, 134, 68, 22, '#fef3c7', '#1e293b', 3.5, true);
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
                drawOutlinedRect(ctx, -110, -90, 220, 180, 22, '#1e1b4b', '#1e293b', 3.5, true);
                for (let i = 0; i < 7; i++) {
                    const boost = 1 + audioLevel * 0.85;
                    const bh = Math.min(130, (24 + Math.abs(Math.sin(t * 6 + i * 0.8)) * 75) * boost);
                    drawOutlinedRect(ctx, -84 + i * 25, 58 - bh, 15, bh, 6, i % 2 === 0 ? '#a855f7' : '#38bdf8', '#0f172a', 1.8, false);
                }
                break;
            }
            case 'sleep_bed': {
                drawOutlinedRect(ctx, -95, 10, 190, 44, 10, '#a78bfa', '#1e293b', 3.5, true);
                drawOutlinedRect(ctx, -86, -16, 52, 28, 10, '#ffffff', '#1e293b', 2.8, false);
                drawOutlinedRect(ctx, -30, -6, 120, 34, 12, '#818cf8', '#1e293b', 2.8, false);
                break;
            }
            default: {
                drawOutlinedRect(ctx, -68, -68, 136, 136, 28, '#fef3c7', '#1e293b', 3.5, true);
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

    // ---- Main Storyboard & UI Motion Choreography ----
    function renderSingleMotionScene(ctx, scene, progress, sceneIdx, t, audioLevel = 0) {
        const visualStyle = scene.visualStyle || 'motion';
        const cue = scene.motionCue || analyzeSceneVisualCue(scene.text, sceneIdx, '', {}, visualStyle);
        const backdropId = BACKDROPS[cue.backdrop] ? cue.backdrop : (visualStyle === 'ui-motion' ? 'grid-light' : 'office-shelf');
        const props = Array.isArray(cue.props) && cue.props.length > 0 ? cue.props : ['lightbulb'];
        const mood = cue.characterMood || 'happy';
        const action = cue.action || 'pointing';
        const cast = cue.cast || 'narrator';
        const effect = cue.effect || 'sparkles';

        drawBackdrop(ctx, backdropId, progress, t, audioLevel);

        const slideT = easeOutCubic(Math.min(1, progress / 0.14));
        const slideX = (1 - slideT) * (sceneIdx === 0 ? 0 : 90);
        const pop1 = stagePop(progress, 0.04, 0.22);
        const pop2 = stagePop(progress, 0.18, 0.22);
        const pop3 = stagePop(progress, 0.36, 0.20);

        ctx.save();
        ctx.translate(slideX, 0);

        switch (cue.layout) {
            case 'wide-team': {
                // Reference Video 1 wide room: 2 desk teammates + narrator foreground-right + soft camera pan!
                const camZoom = 1 + progress * 0.05;
                ctx.save();
                ctx.translate(270, 520);
                ctx.scale(camZoom, camZoom);
                ctx.translate(-270, -520);
                drawSeatedDeskCharacter(ctx, 138, 550, pop1 * 0.72, t, 'girl-purple', 'happy', 0, false);
                drawSeatedDeskCharacter(ctx, 305, 550, pop2 * 0.72, t, 'boy-spiky', mood, 0, false);
                drawSeatedDeskCharacter(ctx, 440, 485, pop2 * 0.56, t, 'manager-red', 'happy', 0, action === 'calling');
                ctx.restore();
                // Narrator character foreground-right speaking with audio lip-sync!
                drawAnimatedActor(ctx, 445, 700, pop1 * 0.92, progress, t, 'pointing', mood, audioLevel, 'narrator');
                break;
            }

            case 'desk-closeup': {
                // Tight close-up at speaker's desk with camera zoom + coffee/phone beside laptop!
                const camZoom = 1 + progress * 0.06;
                ctx.save();
                ctx.translate(270, 540);
                ctx.scale(camZoom, camZoom);
                ctx.translate(-270, -540);
                drawSeatedDeskCharacter(ctx, 270, 535, pop1 * 1.48, t, cast, mood, audioLevel, action === 'calling');
                // Side coffee/phone prop on desk edge
                if (props[1]) {
                    drawProp(ctx, props[1], 455, 585, pop2 * 0.38, progress, t, audioLevel);
                }
                ctx.restore();
                break;
            }

            case 'hand-pov': {
                // First-person hand POV holding camera/pen/document close-up (matches Video 1 signature shots!)
                const docScale = pop1 * 1.15;
                drawOutlinedRect(ctx, 105, 220, 330, 405, 16, '#ffffff', '#cbd5e1', 3, true);
                drawProp(ctx, props[0], 270, 405, docScale * 0.95, progress, t, audioLevel);

                // Animated POV hands framing or signing!
                const handY = 640 - easeOutBack(clamp01(progress * 2.2)) * 45;
                const drawHand = (hx, hy, tilt) => {
                    ctx.save();
                    ctx.translate(hx, hy);
                    ctx.rotate(tilt);
                    drawOutlinedRect(ctx, -22, 0, 44, 150, 14, '#1e293b', '#0f172a', 2.5, false);
                    ctx.fillStyle = '#fed7aa';
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.arc(0, -14, 24, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                };
                if (props[0] === 'card_doc' || props[0] === 'envelope') {
                    // Right hand holding blue pen writing zig-zag signature line!
                    const signX = 270 + Math.sin(t * 9) * 38;
                    ctx.strokeStyle = '#2563eb';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.moveTo(190, 470);
                    ctx.lineTo(190 + easeOutCubic(progress) * 140, 466 + Math.sin(t * 8) * 4);
                    ctx.stroke();
                    drawHand(signX + 35, 505, -0.45);
                } else {
                    drawHand(92, handY, -0.25);
                    drawHand(448, handY, 0.25);
                }
                break;
            }

            case 'laptop-popup': {
                // Soft desk background behind sharp zoomed OS modal popup
                drawSeatedDeskCharacter(ctx, 270, 560, 1.1, t, cast, 'thinking', audioLevel * 0.4, false);
                ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
                ctx.fillRect(0, 0, W, H);
                ctx.save();
                ctx.translate(270, 400);
                ctx.scale(pop1, pop1);
                drawOutlinedRect(ctx, -210, -150, 420, 290, 20, '#ffffff', '#64748b', 3.5, true);
                drawOutlinedRect(ctx, -210, -150, 420, 44, 18, '#475569', '#334155', 3, false);
                ['#ef4444', '#facc15', '#22c55e'].forEach((dotC, di) => {
                    ctx.fillStyle = dotC;
                    ctx.beginPath();
                    ctx.arc(-182 + di * 22, -128, 7, 0, Math.PI * 2);
                    ctx.fill();
                });
                // Highlighted active item inside popup + pointer stick
                drawOutlinedRect(ctx, -172, -62, 344, 68, 12, '#fef2f2', '#ef4444', 3, false);
                drawProp(ctx, props[0], -115, -28, 0.24, progress, t, audioLevel);
                drawOutlinedRect(ctx, -60, -38, 195, 16, 8, '#ef4444', null, 0, false);
                drawOutlinedRect(ctx, -172, 28, 344, 54, 12, '#f1f5f9', '#cbd5e1', 2, false);
                drawOutlinedRect(ctx, -142, 46, 220, 14, 7, '#94a3b8', null, 0, false);
                ctx.restore();
                // Cursor clicking popup row
                const cxCur = 380 - easeOutCubic(progress) * 60;
                const cyCur = 460 - easeOutCubic(progress) * 45;
                drawCursorPointer(ctx, cxCur, cyCur, progress > 0.5 && progress < 0.65 ? 0.85 : 1, progress > 0.55 ? (progress - 0.55) * 4 : 0);
                break;
            }

            case 'ui-window': {
                // Reference Video 2 crisp App Mockup Card + typing/dropdown cursor click
                ctx.save();
                ctx.translate(270, 390);
                ctx.scale(pop1, pop1);
                drawOutlinedRect(ctx, -215, -175, 430, 340, 22, '#0f172a', '#334155', 2.5, true);
                drawOutlinedRect(ctx, -195, -155, 390, 42, 10, '#1e293b', '#334155', 1.5, false);
                drawOutlinedRect(ctx, -182, -143, 210, 18, 6, '#38bdf8', null, 0, false);
                // Interactive blue highlight box popping in center
                const cardPop = stagePop(progress, 0.2, 0.22);
                ctx.save();
                ctx.scale(cardPop, cardPop);
                drawOutlinedRect(ctx, -165, -75, 330, 160, 16, '#1e293b', '#3b82f6', 2.5, true);
                drawProp(ctx, props[0], -85, 5, 0.42, progress, t, audioLevel);
                drawOutlinedRect(ctx, -10, -24, 145, 16, 8, '#60a5fa', null, 0, false);
                drawOutlinedRect(ctx, -10, 8, 105, 12, 6, '#64748b', null, 0, false);
                // Interactive action button
                const isClicked = progress > 0.62;
                drawOutlinedRect(ctx, -10, 38, 128, 34, 10, isClicked ? '#22c55e' : '#2563eb', null, 0, false);
                ctx.restore();
                ctx.restore();
                const curT = easeOutCubic(clamp01(progress * 1.4));
                const clickRipple = progress > 0.62 ? clamp01((progress - 0.62) * 3.5) : 0;
                drawCursorPointer(ctx, 410 - curT * 95, 520 - curT * 60, progress > 0.6 && progress < 0.7 ? 0.84 : 1, clickRipple);
                break;
            }

            case 'ui-checklist': {
                // Reference Video 2 white shadow cards with blue checkmarks popping in sequence!
                const cols = 2;
                [0, 1, 2, 3].forEach((idx) => {
                    const cardP = stagePop(progress, 0.06 + idx * 0.14, 0.18);
                    if (cardP <= 0.02) return;
                    const c = idx % cols;
                    const r = Math.floor(idx / cols);
                    const px = 148 + c * 244;
                    const py = 290 + r * 195;
                    ctx.save();
                    ctx.translate(px, py);
                    ctx.scale(cardP, cardP);
                    drawOutlinedRect(ctx, -105, -78, 210, 156, 22, '#ffffff', '#dbeafe', 2.5, true);
                    drawProp(ctx, props[idx % props.length], 0, -8, 0.36, progress, t, audioLevel);
                    // Blue checkmark badge in top-right corner
                    const chkP = stagePop(progress, 0.24 + idx * 0.14, 0.16);
                    if (chkP > 0.05) {
                        ctx.save();
                        ctx.translate(88, -68);
                        ctx.scale(chkP, chkP);
                        ctx.fillStyle = '#3b82f6';
                        ctx.beginPath();
                        ctx.arc(0, 0, 18, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 3.5;
                        ctx.beginPath();
                        ctx.moveTo(-7, 1);
                        ctx.lineTo(-2, 6);
                        ctx.lineTo(8, -6);
                        ctx.stroke();
                        ctx.restore();
                    }
                    ctx.restore();
                });
                break;
            }

            case 'ui-flow': {
                // Reference Video 2 horizontal pill progression + rotating tilted stamp
                const step1P = stagePop(progress, 0.05, 0.18);
                const step2P = stagePop(progress, 0.22, 0.18);
                const step3P = stagePop(progress, 0.40, 0.18);
                [[120, step1P, '#e2e8f0'], [270, step2P, '#fde68a'], [420, step3P, '#bbf7d0']].forEach(([px, sp, fill], i) => {
                    if (sp <= 0.04) return;
                    ctx.save();
                    ctx.translate(px, 340);
                    ctx.scale(sp, sp);
                    drawOutlinedRect(ctx, -56, -42, 112, 84, 18, fill, '#94a3b8', 2.5, true);
                    drawProp(ctx, props[i % props.length], 0, 0, 0.28, progress, t, audioLevel);
                    ctx.restore();
                });
                // Highlight tilted card hero below
                const tiltP = stagePop(progress, 0.52, 0.22);
                if (tiltP > 0.05) {
                    ctx.save();
                    ctx.translate(270, 520);
                    ctx.rotate(-0.06);
                    ctx.scale(tiltP, tiltP);
                    drawOutlinedRect(ctx, -170, -48, 340, 96, 20, '#3b82f6', '#1d4ed8', 3, true);
                    drawOutlinedRect(ctx, -135, -14, 195, 28, 14, '#ffffff', null, 0, false);
                    drawSparkle(ctx, 112, 0, 20 + audioLevel * 6, '#fde047', t * 2);
                    ctx.restore();
                }
                break;
            }

            case 'ui-grid-hero': {
                // Big sleek app icon / floating button hero with cursor click animation
                ctx.save();
                ctx.translate(270, 390);
                ctx.scale(pop1 * (1 + audioLevel * 0.04), pop1 * (1 + audioLevel * 0.04));
                drawOutlinedRect(ctx, -140, -140, 280, 280, 48, '#ffffff', '#bfdbfe', 3, true);
                drawProp(ctx, props[0], 0, 0, 0.85, progress, t, audioLevel);
                ctx.restore();
                const curP = easeOutCubic(clamp01(progress * 1.5));
                drawCursorPointer(ctx, 410 - curP * 90, 540 - curP * 95, progress > 0.55 && progress < 0.68 ? 0.82 : 1, progress > 0.58 ? (progress - 0.58) * 3 : 0);
                break;
            }

            case 'character-action': {
                drawProp(ctx, props[0], 355, 285, pop2 * 0.72, progress, t, audioLevel);
                if (props[1]) {
                    drawProp(ctx, props[1], 140, 265, pop3 * 0.45, progress, t, audioLevel);
                }
                drawAnimatedActor(ctx, 260, 625, pop1 * 1.12, progress, t, action, mood, audioLevel, cast);
                if (cue.crossOut && pop3 > 0.2) {
                    drawRedCross(ctx, 355, 285, 75, pop3);
                }
                break;
            }

            case 'character-left': {
                drawAnimatedActor(ctx, 132, 620, pop1 * 1.05, progress, t, action, mood, audioLevel, cast);
                drawProp(ctx, props[0], 356, 405, pop2 * 0.96, progress, t, audioLevel);
                if (props[1] && pop3 > 0.1) {
                    drawProp(ctx, props[1], 415, 215, pop3 * 0.42, progress, t, audioLevel);
                }
                if (cue.crossOut && pop3 > 0.2) {
                    drawRedCross(ctx, 356, 405, 95, pop3);
                }
                break;
            }

            case 'split-compare': {
                drawOutlinedRect(ctx, 42, 235, 212, 330, 22, 'rgba(254, 226, 226, 0.85)', '#1e293b', 3, true);
                drawOutlinedRect(ctx, 286, 235, 212, 330, 22, 'rgba(220, 252, 231, 0.92)', '#1e293b', 3, true);
                drawProp(ctx, props[0], 148, 400, pop1 * 0.72, progress, t, audioLevel);
                drawProp(ctx, props[1] || props[0], 392, 400, pop2 * 0.72, progress, t, audioLevel);
                if (cue.crossOut && pop3 > 0.2) {
                    drawRedCross(ctx, 148, 400, 76, pop3);
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
                    drawProp(ctx, pr, px, hoverY, [pop1, pop2, pop3][idx] * 0.62, progress, t, audioLevel);
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
                    drawProp(ctx, props[0], 320, 345, pop2 * 0.78, progress, t, audioLevel);
                }
                break;
            }

            case 'document-card': {
                ctx.save();
                ctx.translate(270, 415);
                ctx.scale(pop1, pop1);
                drawOutlinedRect(ctx, -168, -195, 336, 370, 24, '#ffffff', '#1e293b', 4, true);
                [0, 1, 2].forEach((idx) => {
                    const rowP = stagePop(progress, 0.16 + idx * 0.16, 0.16);
                    if (rowP <= 0.05) return;
                    const ry = -112 + idx * 105;
                    ctx.save();
                    ctx.globalAlpha = rowP;
                    drawOutlinedRect(ctx, -132, ry - 34, 68, 68, 16, '#ecfdf5', '#1e293b', 2.5, false);
                    drawProp(ctx, props[idx % props.length], -98, ry, 0.24 * rowP, progress, t, audioLevel);
                    drawOutlinedRect(ctx, -44, ry - 16, 162, 16, 8, '#34d399', '#1e293b', 2, false);
                    drawOutlinedRect(ctx, -44, ry + 8, 114, 12, 6, '#cbd5e1', '#64748b', 1.5, false);
                    ctx.restore();
                });
                ctx.restore();
                break;
            }

            case 'action-flow': {
                drawProp(ctx, props[0], 136, 435, pop1 * 0.72, progress, t, audioLevel);
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
                drawProp(ctx, props[1] || 'lightbulb', 404, 435, pop2 * 0.72, progress, t, audioLevel);
                break;
            }

            case 'center-hero':
            default: {
                drawProp(ctx, props[0], 270, 435, pop1 * (1 + audioLevel * 0.04), progress, t, audioLevel);
                if (props[1] && pop2 > 0.1) {
                    drawProp(ctx, props[1], 420, 245, pop2 * 0.45, progress, t, audioLevel);
                }
                if (cue.crossOut && pop3 > 0.2) {
                    drawRedCross(ctx, 270, 435, 130, pop3);
                }
                break;
            }
        }

        drawAmbientEffects(ctx, effect, t, audioLevel);
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
        ACTION_NAMES,
        EFFECT_NAMES,
        CAST_NAMES,
        SFX_NAMES,
        analyzeSceneVisualCue,
        drawMotionScene
    };
})(window);
