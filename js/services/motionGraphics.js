/* ==========================================================================
   Composable 2D Action Animation Engine (Zero-Text Pure Visual Storytelling)
   - 12 Illustrated 2D Backdrops x 7 Layouts x 36 Vector Props x 10 Character Actions
   - Driven dynamically by real speech Audio Envelope (lip-sync + gesture energy)
   - Strictly NO text pills, NO floating keyword tags, NO clutter over artwork
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const W = 540;
    const H = 960;
    const FLOOR_Y = 782;

    const BACKDROPS = {
        'cream-room': { top: '#fdf6e4', bot: '#eeddb9', floor: '#d6c398', line: '#9c8b68', accent: '#10b981', dark: false },
        'office-desk': { top: '#eef2ff', bot: '#dbeafe', floor: '#c7d2fe', line: '#6366f1', accent: '#2563eb', dark: false },
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
        'character-action',
        'character-left',
        'split-compare',
        'multi-trio',
        'thought-bubble',
        'document-card',
        'action-flow',
        'center-hero'
    ];

    const ACTION_NAMES = [
        'pointing',
        'typing',
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

    // ---- Semantic Context + Action Rules (matches Vietnamese narration to action + world) ----
    const SEMANTIC_RULES = [
        { regex: /sập server|lỗi|bug|code|it|dev|deploy|lập trình|máy tính|laptop/, backdrop: 'server-tech', layout: 'character-action', action: 'typing', props: ['laptop', 'fire_flame', 'warning_triangle'], mood: 'shocked', effect: 'sparks' },
        { regex: /10 giờ|22 giờ|2 giờ|1 giờ|khuya|nửa đêm|ngủ|nằm|chăn|giấc ngủ|mất ngủ/, backdrop: 'bedroom-night', layout: 'character-action', action: 'sleeping', props: ['sleep_bed', 'phone', 'clock'], mood: 'sleepy', effect: 'sparkles' },
        { regex: /lướt điện thoại|mở mắt|tin nhắn|sếp nhắn|check tin|điện thoại|reels|mạng xã hội|thông báo/, backdrop: 'bedroom-night', layout: 'character-action', action: 'shocked-phone', props: ['phone', 'speech_drama', 'clock'], mood: 'shocked', effect: 'sweat' },
        { regex: /drama|sếp|đồng nghiệp|thảo mai|họp|ot|tăng lương|phỏng vấn|hr|báo cáo|deadline|chạy số/, backdrop: 'office-desk', layout: 'character-action', action: 'typing', props: ['laptop', 'speech_drama', 'clock'], mood: 'shocked', effect: 'sweat' },
        { regex: /marketing|ads|content|viral|chiến dịch|quảng cáo|thu hút|follower|trend/, backdrop: 'office-desk', layout: 'action-flow', action: 'pointing', props: ['megaphone', 'chart_bars', 'laptop'], mood: 'happy', effect: 'sparkles' },
        { regex: /sale|chốt đơn|khách hàng|tư vấn|doanh số|kpi|mục tiêu|bán hàng/, backdrop: 'city-skyline', layout: 'character-left', action: 'pointing', props: ['target_kpi', 'phone', 'cash_stack'], mood: 'happy', effect: 'money' },
        { regex: /lừa đảo|link lạ|otp|giả mạo|tin nhắn lạ|bẫy/, backdrop: 'alert-tint', layout: 'character-action', action: 'shocked-phone', props: ['scam_link', 'warning_triangle', 'padlock'], mood: 'shocked', effect: 'sparks', crossOut: true },
        { regex: /ổ điện|cháy|nổ|quá tải|giật điện|nóng máy|cắm sạc/, backdrop: 'alert-tint', layout: 'split-compare', action: 'shocked-phone', props: ['plug_socket', 'fire_flame', 'battery'], mood: 'shocked', effect: 'sparks', crossOut: true },
        { regex: /uống nước|ly nước|cốc nước|nước ấm|nước lọc|cà phê|trà sữa|thải độc/, backdrop: 'cafe-chill', layout: 'character-action', action: 'drinking', props: ['water_glass', 'coffee_cup', 'heart'], mood: 'happy', effect: 'steam' },
        { regex: /cơm|ăn|nấu|bếp|chảo|hành|tỏi|bữa|tủ lạnh|ngăn đá|chợ/, backdrop: 'kitchen-cozy', layout: 'character-action', action: 'cooking', props: ['rice_bowl', 'coffee_cup', 'jar'], mood: 'happy', effect: 'steam' },
        { regex: /nhạc|lofi|lo-fi|giai điệu|âm thanh|piano|chill|thư giãn/, backdrop: 'cafe-chill', layout: 'center-hero', action: 'drinking', props: ['music_bars', 'coffee_cup', 'heart'], mood: 'happy', effect: 'notes' },
        { regex: /lương|thu nhập|tiền|phong bì|triệu|nghìn|50k|100k|tiết kiệm|hũ|ví|trả góp|chi tiêu|tài chính/, backdrop: 'mint-fresh', layout: 'character-action', action: 'counting-money', props: ['cash_stack', 'jar', 'coin'], mood: 'happy', effect: 'money' },
        { regex: /chạy|vội|muộn|trễ|tắc đường|xe|đi làm|xăng|chuyến/, backdrop: 'city-skyline', layout: 'character-action', action: 'running', props: ['scooter', 'bus', 'clock'], mood: 'shocked', effect: 'sweat' },
        { regex: /so sánh|gấp đôi|chênh lệch|ít hơn|hơn hẳn|tăng|giảm|hiệu quả|kết quả/, backdrop: 'mint-fresh', layout: 'split-compare', action: 'celebrating', props: ['chart_bars', 'jar', 'lightbulb'], mood: 'happy', effect: 'confetti' },
        { regex: /thành công|chúc mừng|tuyệt vời|nhẹ nhàng|dư thời gian|bí quyết|thay đổi|7 ngày/, backdrop: 'sunset-warm', layout: 'character-left', action: 'celebrating', props: ['lightbulb', 'heart', 'gift_box'], mood: 'happy', effect: 'confetti' },
        { regex: /quê|nhà|gia đình|bố mẹ|tình cảm|yêu/, backdrop: 'hills-nature', layout: 'character-left', action: 'celebrating', props: ['house', 'heart', 'gift_box'], mood: 'happy', effect: 'hearts' },
        { regex: /viết ra|danh sách|kế hoạch|3 việc|ghi chép|tập trung/, backdrop: 'office-desk', layout: 'document-card', action: 'pointing', props: ['card_doc', 'lightbulb', 'clock'], mood: 'thinking', effect: 'sparkles' }
    ];

    function analyzeSceneVisualCue(sceneText, beatIdx, videoTitle = '', state = {}) {
        const s = `${sceneText || ''} ${beatIdx === 0 ? videoTitle || '' : ''}`.toLowerCase();
        const prevLayout = state.prevLayout || '';
        const prevBackdrop = state.prevBackdrop || '';
        const prevProp = state.prevProp || '';

        const matched = SEMANTIC_RULES.filter((r) => r.regex.test(s));
        const rule = matched.length > 0 ? matched[beatIdx % matched.length] : null;

        let layout = rule ? rule.layout : LAYOUT_NAMES[beatIdx % LAYOUT_NAMES.length];
        if (layout === prevLayout && LAYOUT_NAMES.length > 1) {
            const altLayouts = LAYOUT_NAMES.filter((l) => l !== prevLayout);
            layout = altLayouts[(beatIdx * 3) % altLayouts.length];
        }

        let backdrop = rule ? rule.backdrop : BACKDROP_NAMES[beatIdx % BACKDROP_NAMES.length];
        if (backdrop === prevBackdrop && BACKDROP_NAMES.length > 1) {
            const altBgs = BACKDROP_NAMES.filter((b) => b !== prevBackdrop);
            backdrop = altBgs[(beatIdx * 2) % altBgs.length];
        }

        const candidateProps = rule
            ? [...rule.props]
            : [PROP_NAMES[(beatIdx * 5) % PROP_NAMES.length], PROP_NAMES[(beatIdx * 5 + 7) % PROP_NAMES.length], PROP_NAMES[(beatIdx * 3 + 11) % PROP_NAMES.length]];
        if (candidateProps[0] === prevProp) {
            if (candidateProps.length > 1) {
                candidateProps.push(candidateProps.shift());
            } else {
                candidateProps[0] = PROP_NAMES[(PROP_NAMES.indexOf(prevProp) + 3 + beatIdx) % PROP_NAMES.length];
            }
        }

        const action = rule ? rule.action : ACTION_NAMES[beatIdx % ACTION_NAMES.length];
        const characterMood = rule ? rule.mood : beatIdx % 3 === 1 ? 'thinking' : 'happy';
        const effect = rule ? rule.effect : 'sparkles';

        return {
            layout,
            backdrop,
            action,
            effect,
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
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
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

    // ---- 12 Rich Illustrated 2D Backdrops (Zero Text) ----
    function drawBackdrop(ctx, backdropId, progress, t, audioLevel = 0) {
        const b = BACKDROPS[backdropId] || BACKDROPS['cream-room'];
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, b.top);
        grad.addColorStop(1, b.bot);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        if (backdropId === 'office-desk') {
            // Window with daylight blinds + wall clock silhouette + desk horizon
            drawOutlinedRect(ctx, 48, 120, 170, 190, 12, '#e0f2fe', '#64748b', 3, false);
            for (let by = 142; by < 290; by += 28) {
                ctx.fillStyle = 'rgba(255,255,255,0.65)';
                ctx.fillRect(54, by, 158, 8);
            }
            // Minimalist wall plant & desk lamp
            ctx.fillStyle = '#86efac';
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.ellipse(455, 705, 18, 42, -0.25, 0, Math.PI * 2);
            ctx.ellipse(478, 705, 18, 42, 0.25, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            drawOutlinedRect(ctx, 442, 728, 50, 54, 8, '#f59e0b', '#1e293b', 2.8, false);
        } else if (backdropId === 'bedroom-night' || backdropId === 'night-calm') {
            // Night window frame + crescent moon + stars
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
            [
                [78, 170],
                [145, 220],
                [265, 145],
                [355, 165],
                [462, 260]
            ].forEach(([sx, sy], i) => {
                ctx.fillStyle = `rgba(254, 240, 138, ${0.45 + 0.45 * Math.sin(t * 3 + i)})`;
                ctx.beginPath();
                ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        } else if (backdropId === 'kitchen-cozy') {
            // Cozy tiled wall + upper shelf + counter backsplash
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
            // Two warm hanging pendant lights gently swaying
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
            // Tech server rack columns with blinking audio-reactive LEDs
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

    // ---- Shared Character Head (expressive eyes, brows, audio lip-sync!) ----
    function drawCharacterHead(ctx, hx, hy, t, mood = 'happy', audioLevel = 0, shirtExtra = {}) {
        const blink = Math.sin(t * 2.1) > 0.96;
        const talkOpen = clamp01(audioLevel * 1.45);
        const tilt = Math.sin(t * 3.5) * 0.04 + audioLevel * 0.04;

        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(tilt);

        // Head base
        ctx.fillStyle = '#fed7aa';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(0, 0, 40, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Hair
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(0, -8, 40, Math.PI, Math.PI * 2);
        ctx.lineTo(35, 0);
        ctx.quadraticCurveTo(0, -20, -35, 0);
        ctx.closePath();
        ctx.fill();

        // Eyes
        ctx.fillStyle = '#1e293b';
        if (mood === 'sleepy' || blink) {
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-20, 0);
            ctx.lineTo(-10, 0);
            ctx.moveTo(10, 0);
            ctx.lineTo(20, 0);
            ctx.stroke();
        } else if (mood === 'shocked') {
            ctx.fillStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(-14, 0, 8, 0, Math.PI * 2);
            ctx.arc(14, 0, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#1e293b';
            ctx.beginPath();
            ctx.arc(-14, 0, 3.5, 0, Math.PI * 2);
            ctx.arc(14, 0, 3.5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.arc(-14, 0, 4.3, 0, Math.PI * 2);
            ctx.arc(14, 0, 4.3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Eyebrows
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        if (mood === 'thinking') {
            ctx.beginPath();
            ctx.moveTo(-22, -11);
            ctx.lineTo(-8, -13);
            ctx.moveTo(8, -15);
            ctx.lineTo(22, -10);
            ctx.stroke();
        } else if (mood === 'shocked') {
            ctx.beginPath();
            ctx.moveTo(-22, -15);
            ctx.lineTo(-8, -12);
            ctx.moveTo(8, -12);
            ctx.lineTo(22, -15);
            ctx.stroke();
        }

        // Cheeks
        ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
        ctx.beginPath();
        ctx.arc(-24, 12, 5.5, 0, Math.PI * 2);
        ctx.arc(24, 12, 5.5, 0, Math.PI * 2);
        ctx.fill();

        // Audio-synced Mouth
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.8;
        if (mood === 'shocked') {
            ctx.fillStyle = '#991b1b';
            ctx.beginPath();
            ctx.ellipse(0, 20, 7, 8 + talkOpen * 4, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else if (talkOpen > 0.12) {
            ctx.fillStyle = '#be123c';
            ctx.beginPath();
            ctx.ellipse(0, 17, 9, 4 + talkOpen * 8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(0, 16, 9, 0.1 * Math.PI, 0.9 * Math.PI);
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

    // ---- 10 Expressive Action Poses (Character interacts physically with props!) ----
    function drawAnimatedActor(ctx, cx, cy, scale, progress, t, action = 'pointing', mood = 'happy', audioLevel = 0) {
        if (scale <= 0.02) return;
        const shirtColor = mood === 'shocked' ? '#60a5fa' : action === 'cooking' ? '#fb923c' : action === 'celebrating' ? '#34d399' : '#38bdf8';

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);

        if (action === 'sleeping') {
            // Cozy bed + character lying under blanket with rising zzz bubbles
            const breathe = Math.sin(t * 2.5) * 3;
            drawOutlinedRect(ctx, -145, 22, 290, 62, 16, '#818cf8', '#1e293b', 3.5, true);
            drawOutlinedRect(ctx, -155, -24, 22, 118, 8, '#475569', '#1e293b', 3, false);
            drawOutlinedRect(ctx, 133, 4, 22, 90, 8, '#475569', '#1e293b', 3, false);
            drawOutlinedRect(ctx, -128, -4, 72, 34, 12, '#ffffff', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, -56, 8 + breathe * 0.3, 195, 58, 18, '#a78bfa', '#1e293b', 3, false);
            drawCharacterHead(ctx, -90, -24 + breathe * 0.5, t, 'sleepy', audioLevel * 0.3);
            // Floating pure Z vector shapes (small rings/zigzags -> sleep vibe)
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
            // Sitting at desk typing frantically on laptop synced to voice!
            const typeBob = Math.sin(t * 14) * (2 + audioLevel * 3);
            // Desk
            drawOutlinedRect(ctx, -135, 36, 270, 20, 8, '#b45309', '#1e293b', 3.2, true);
            drawOutlinedRect(ctx, -118, 56, 16, 74, 4, '#78350f', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, 102, 56, 16, 74, 4, '#78350f', '#1e293b', 2.8, false);
            // Character behind desk
            drawOutlinedRect(ctx, -36, -16 + typeBob * 0.4, 72, 56, 14, shirtColor, '#1e293b', 3, false);
            drawCharacterHead(ctx, 0, -56 + typeBob * 0.5, t, mood, audioLevel);
            // Typing arms moving fast
            drawOutlinedRect(ctx, -46, 6 + Math.sin(t * 18) * 5, 16, 36, 7, shirtColor, '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, 30, 6 + Math.cos(t * 18) * 5, 16, 36, 7, shirtColor, '#1e293b', 2.8, false);
            // Laptop open in front
            drawOutlinedRect(ctx, -64, -26, 128, 66, 10, '#334155', '#0f172a', 3, true);
            drawOutlinedRect(ctx, -54, -18, 108, 50, 6, mood === 'shocked' ? '#fee2e2' : '#e0f2fe', '#334155', 2, false);
            const barFlash = Math.sin(t * 10) > 0;
            ctx.fillStyle = mood === 'shocked' ? '#ef4444' : '#0ea5e9';
            ctx.fillRect(-44, -8, barFlash ? 78 : 54, 8);
            ctx.fillStyle = '#10b981';
            ctx.fillRect(-44, 6, barFlash ? 52 : 84, 8);
            ctx.fillStyle = '#f59e0b';
            ctx.fillRect(-44, 20, 64, 6);
            // Steaming coffee on desk side
            drawOutlinedRect(ctx, 82, 8, 28, 28, 6, '#ffffff', '#1e293b', 2.5, false);
            ctx.restore();
            return;
        }

        if (action === 'cooking') {
            // Kitchen counter + stove + pot/pan + stirring character
            const stir = Math.sin(t * 8) * 14;
            drawOutlinedRect(ctx, -145, 42, 290, 86, 12, '#fed7aa', '#1e293b', 3.2, true);
            drawOutlinedRect(ctx, -38, -16, 76, 62, 14, shirtColor, '#1e293b', 3, false);
            // White apron
            drawOutlinedRect(ctx, -24, 0, 48, 44, 8, '#ffffff', '#1e293b', 2.2, false);
            drawCharacterHead(ctx, 0, -56, t, mood, audioLevel);
            // Pan on counter
            drawOutlinedRect(ctx, -78, 22, 92, 22, 8, '#475569', '#0f172a', 3, false);
            drawOutlinedRect(ctx, 14, 26, 46, 10, 5, '#1e293b', '#0f172a', 2, false);
            // Animated wooden spoon stirring
            ctx.save();
            ctx.translate(-32 + stir * 0.5, 16);
            ctx.rotate(stir * 0.02);
            drawOutlinedRect(ctx, -4, -36, 8, 42, 4, '#d97706', '#1e293b', 2, false);
            ctx.restore();
            // Arm holding spoon
            drawOutlinedRect(ctx, 18, -4 + Math.sin(t * 8) * 4, 34, 14, 7, shirtColor, '#1e293b', 2.6, false);
            // Container/jar on right side of counter
            drawOutlinedRect(ctx, 76, -8, 44, 50, 10, '#dcfce7', '#1e293b', 2.6, false);
            drawOutlinedRect(ctx, 80, -16, 36, 10, 4, '#22c55e', '#1e293b', 2, false);
            ctx.restore();
            return;
        }

        if (action === 'phone-scroll' || action === 'shocked-phone') {
            const shake = action === 'shocked-phone' ? Math.sin(t * 22) * 3.5 : Math.sin(t * 4) * 2;
            ctx.translate(shake, Math.sin(t * 4.5) * 3);
            ctx.fillStyle = 'rgba(15,23,42,0.12)';
            ctx.beginPath();
            ctx.ellipse(0, 122, 42, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            // Legs
            drawOutlinedRect(ctx, -24, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, 7, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, -28, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);
            drawOutlinedRect(ctx, 6, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);
            // Body
            drawOutlinedRect(ctx, -28, -14, 56, 76, 12, shirtColor, '#1e293b', 3, true);
            drawCharacterHead(ctx, 0, -56, t, action === 'shocked-phone' ? 'shocked' : mood, audioLevel);
            // Hands holding glowing phone forward/side
            drawOutlinedRect(ctx, 18, -8, 42, 15, 7, shirtColor, '#1e293b', 2.6, false);
            drawOutlinedRect(ctx, 48, -44 + Math.sin(t * 7) * 3, 44, 76, 9, '#0f172a', '#0f172a', 3, true);
            drawOutlinedRect(ctx, 53, -36 + Math.sin(t * 7) * 3, 34, 60, 5, action === 'shocked-phone' ? '#fecaca' : '#dbeafe', '#334155', 1.8, false);
            if (action === 'shocked-phone') {
                // Red notification circle pulsing!
                const dotScale = 1 + Math.sin(t * 10) * 0.2;
                ctx.fillStyle = '#ef4444';
                ctx.beginPath();
                ctx.arc(88, -42, 10 * dotScale, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            return;
        }

        if (action === 'running') {
            const stride = Math.sin(t * 14);
            ctx.translate(0, Math.abs(stride) * -7);
            // Comic speed lines
            ctx.strokeStyle = 'rgba(30, 41, 59, 0.25)';
            ctx.lineWidth = 3;
            [-40, -10, 25].forEach((ly, i) => {
                const lx = -110 - ((t * 180 + i * 30) % 45);
                ctx.beginPath();
                ctx.moveTo(lx, ly);
                ctx.lineTo(lx + 46, ly);
                ctx.stroke();
            });
            // Dynamic legs swinging
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
            // Leaned torso + head
            ctx.rotate(0.16);
            drawOutlinedRect(ctx, -28, -14, 56, 74, 12, shirtColor, '#1e293b', 3, true);
            drawCharacterHead(ctx, 4, -56, t, mood, audioLevel);
            ctx.save();
            ctx.translate(22, -4);
            ctx.rotate(-stride * 0.7);
            drawOutlinedRect(ctx, -6, 0, 14, 48, 7, shirtColor, '#1e293b', 2.6, false);
            ctx.restore();
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
            // Both arms cheering high!
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
            drawCharacterHead(ctx, 0, -56, t, 'happy', audioLevel);
            ctx.restore();
            return;
        }

        if (action === 'drinking' || action === 'counting-money') {
            const bob = Math.sin(t * 4) * 3;
            ctx.translate(0, bob);
            ctx.fillStyle = 'rgba(15,23,42,0.12)';
            ctx.beginPath();
            ctx.ellipse(0, 122, 42, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            drawOutlinedRect(ctx, -24, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, 7, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
            drawOutlinedRect(ctx, -28, -14, 56, 76, 12, shirtColor, '#1e293b', 3, true);
            drawCharacterHead(ctx, 0, -56, t, mood, audioLevel, { headphone: action === 'drinking' && mood === 'happy' });
            // Right hand lifts cup/money dynamically
            const lift = action === 'drinking' ? -28 + Math.sin(t * 3.5) * 10 : Math.sin(t * 7) * 6;
            drawOutlinedRect(ctx, 18, -2 + lift * 0.3, 38, 14, 7, shirtColor, '#1e293b', 2.6, false);
            if (action === 'drinking') {
                drawOutlinedRect(ctx, 46, -24 + lift * 0.4, 24, 34, 6, '#38bdf8', '#1e293b', 2.6, false);
            } else {
                drawOutlinedRect(ctx, 42, -16 + lift * 0.4, 36, 22, 5, '#4ade80', '#1e293b', 2.5, false);
            }
            ctx.restore();
            return;
        }

        // Default 'pointing' expressive presenter pose
        const bob = Math.sin(t * 4.5) * 3;
        ctx.translate(0, bob);
        ctx.fillStyle = 'rgba(15,23,42,0.12)';
        ctx.beginPath();
        ctx.ellipse(0, 122, 42, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        drawOutlinedRect(ctx, -24, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
        drawOutlinedRect(ctx, 7, 58, 17, 56, 5, '#475569', '#1e293b', 2.8, false);
        drawOutlinedRect(ctx, -28, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);
        drawOutlinedRect(ctx, 6, 108, 22, 11, 5, '#1e293b', '#1e293b', 2, false);
        drawOutlinedRect(ctx, -40, -10, 14, 56, 7, shirtColor, '#1e293b', 2.8, false);

        ctx.save();
        ctx.translate(28, -4);
        const gestureAng = mood === 'happy' ? -1.05 + Math.sin(t * 6) * (0.16 + audioLevel * 0.25) : mood === 'thinking' ? -0.4 : -0.15;
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
        drawCharacterHead(ctx, 0, -56, t, mood, audioLevel);
        ctx.restore();
    }

    // ---- Audio-Reactive Ambient Visual Effects (Zero Text) ----
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

        const spSize = 11 + audioLevel * 8;
        drawSparkle(ctx, 76, 195, spSize, '#fbbf24', t * 1.4);
        drawSparkle(ctx, 464, 240, spSize * 0.9, '#fde047', -t * 1.4);
    }

    // ---- 36 Clean Flat-Vector Props (100% Text-Free Visual Storytelling) ----
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
                const vib = Math.sin(t * 16) * (1 + audioLevel * 2);
                ctx.translate(vib * 0.4, 0);
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
                // Pure animated comic alert bubbles (dots + exclamation bar, NO text!)
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

    // ---- Pure 2D Action Scene Renderer (Zero Text Clutter!) ----
    function renderSingleMotionScene(ctx, scene, progress, sceneIdx, t, audioLevel = 0) {
        const cue = scene.motionCue || analyzeSceneVisualCue(scene.text, sceneIdx, '');
        const backdropId = BACKDROPS[cue.backdrop] ? cue.backdrop : 'cream-room';
        const props = Array.isArray(cue.props) && cue.props.length > 0 ? cue.props : ['lightbulb'];
        const mood = cue.characterMood || 'happy';
        const action = cue.action || 'pointing';
        const effect = cue.effect || 'sparkles';

        // 1. Illustrated 2D Environment
        drawBackdrop(ctx, backdropId, progress, t, audioLevel);

        const slideT = easeOutCubic(Math.min(1, progress / 0.14));
        const slideX = (1 - slideT) * (sceneIdx === 0 ? 0 : 120);
        const pop1 = stagePop(progress, 0.04, 0.22);
        const pop2 = stagePop(progress, 0.20, 0.22);
        const pop3 = stagePop(progress, 0.38, 0.20);

        ctx.save();
        ctx.translate(slideX, 0);

        // 2. Composable Action & Prop Layouts
        switch (cue.layout) {
            case 'character-action': {
                // Hero object floating above/beside active character performing real physical action
                drawProp(ctx, props[0], 355, 290, pop2 * 0.72, progress, t, audioLevel);
                if (props[1]) {
                    drawProp(ctx, props[1], 140, 265, pop3 * 0.45, progress, t, audioLevel);
                }
                drawAnimatedActor(ctx, 260, 625, pop1 * 1.12, progress, t, action, mood, audioLevel);
                if (cue.crossOut && pop3 > 0.2) {
                    drawRedCross(ctx, 355, 290, 75, pop3);
                }
                break;
            }

            case 'character-left': {
                drawAnimatedActor(ctx, 132, 620, pop1 * 1.05, progress, t, action, mood, audioLevel);
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
                // Visual Before vs After (Red tint left vs Green/Bright tint right, NO text labels!)
                drawOutlinedRect(ctx, 42, 235, 212, 330, 22, 'rgba(254, 226, 226, 0.85)', '#1e293b', 3, true);
                drawOutlinedRect(ctx, 286, 235, 212, 330, 22, 'rgba(220, 252, 231, 0.92)', '#1e293b', 3, true);

                drawProp(ctx, props[0], 148, 400, pop1 * 0.72, progress, t, audioLevel);
                drawProp(ctx, props[1] || props[0], 392, 400, pop2 * 0.72, progress, t, audioLevel);

                if (cue.crossOut && pop3 > 0.2) {
                    drawRedCross(ctx, 148, 400, 76, pop3);
                } else if (pop3 > 0.2) {
                    // Clean green check circle on right side!
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
                const xs = [108, 270, 432];
                const pops = [pop1, pop2, pop3];
                xs.forEach((px, idx) => {
                    const pr = props[idx] || props[idx % props.length];
                    const hoverY = 445 + Math.sin(t * 3 + idx) * 8;
                    drawProp(ctx, pr, px, hoverY, pops[idx] * 0.62, progress, t, audioLevel);
                });
                break;
            }

            case 'thought-bubble': {
                drawAnimatedActor(ctx, 128, 635, pop1, progress, t, action, 'thinking', audioLevel);
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
                // Visual icon-list progression card (NO words!)
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
                    // Green check + progress meter bars instead of text
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

        // 3. Contextual audio-reactive particles
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
        analyzeSceneVisualCue,
        drawMotionScene
    };
})(window);
