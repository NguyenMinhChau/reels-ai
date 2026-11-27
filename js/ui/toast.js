/* ==========================================================================
   Toast Notification Manager (XSS-safe, capped stack, supports Undo action)
   ========================================================================== */
(function (global) {
    'use strict';

    const App = (global.ReelsStudio = global.ReelsStudio || {});
    const MAX_TOASTS = 3;

    function showToast(message, type = 'success', options = {}) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        // Cap visible toasts so rapid clicks don't stack infinitely
        while (container.children.length >= MAX_TOASTS) {
            container.firstElementChild.remove();
        }

        const toast = document.createElement('div');
        const bgClass =
            type === 'success'
                ? 'bg-slate-900 dark:bg-slate-800 text-white border border-slate-700/60'
                : type === 'error'
                    ? 'bg-rose-600 text-white border border-rose-500/60'
                    : type === 'warning'
                        ? 'bg-amber-500 text-slate-950 border border-amber-400/60'
                        : 'bg-indigo-600 text-white border border-indigo-500/60';

        const iconClass =
            type === 'success'
                ? 'fa-circle-check text-emerald-400'
                : type === 'error'
                    ? 'fa-circle-exclamation text-white'
                    : type === 'warning'
                        ? 'fa-triangle-exclamation text-slate-950'
                        : 'fa-circle-info text-indigo-100';

        toast.className = `${bgClass} px-4 py-3 rounded-2xl shadow-xl text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto max-w-sm`;

        const left = document.createElement('div');
        left.className = 'flex items-center gap-2.5 min-w-0';

        const icon = document.createElement('i');
        icon.className = `fa-solid ${iconClass} text-base shrink-0`;

        const textSpan = document.createElement('span');
        textSpan.className = 'leading-snug break-words';
        textSpan.textContent = String(message || '');

        left.appendChild(icon);
        left.appendChild(textSpan);
        toast.appendChild(left);

        let dismissed = false;
        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            toast.classList.add('opacity-0', 'translate-y-2');
            setTimeout(() => toast.remove(), 260);
        };

        if (options.actionLabel && typeof options.onAction === 'function') {
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.className =
                'px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-extrabold shrink-0 transition cursor-pointer';
            actionBtn.textContent = options.actionLabel;
            actionBtn.addEventListener('click', () => {
                options.onAction();
                dismiss();
            });
            toast.appendChild(actionBtn);
        }

        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.remove('translate-y-2', 'opacity-0'));

        const duration = options.duration || (options.actionLabel ? 5000 : 3200);
        setTimeout(dismiss, duration);
    }

    App.toast = { show: showToast };
})(window);
