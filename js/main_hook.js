/**
 * Yandex Music Fisher mod by vectorserver
 * main_hook.js — крошечный MAIN-world патч, запускается на document_start
 * ДО скриптов Яндекс.Музыки.
 *
 * Зачем нужен отдельный файл:
 *  - SPA-переходы Next.js иногда происходят раньше, чем service worker успевает
 *    внедрить parser.js. Здесь мы заранее перехватываем pushState/replaceState
 *    и складываем ответы API в очередь, которую parser.js потом забирает.
 *  - Так личные плейлисты, данные которых грузятся только клиентским запросом,
 *    не теряются, даже если запрос ушёл до инъекции parser.js.
 *
 * @author vectorserver
 * @version 3.0.0
 */
(() => {
    'use strict';

    if (window.__appYaMainHook) return;
    window.__appYaMainHook = true;

    const MAX_QUEUE = 24;
    const queue = window.__appYaNetworkQueue = window.__appYaNetworkQueue || [];

    const relevant = (url) => {
        if (!url || url.includes('byVectorserver')) return false;
        if (!/music\.yandex\./.test(url)) return false;
        return /(?:^|\/)(?:playlists?|albums?|artists?)\//.test(url) || /\/(?:chart|landing)/.test(url);
    };

    const push = (url, contentType, text) => {
        if (!text || text.length > 3 * 1024 * 1024) return;
        queue.push({ url: String(url), contentType: String(contentType || ''), text, at: Date.now() });
        while (queue.length > MAX_QUEUE) queue.shift();
        try {
            document.dispatchEvent(new CustomEvent('appYa:network', { detail: '' }));
        } catch { /* noop */ }
    };

    // --- fetch -------------------------------------------------------------
    try {
        const originalFetch = window.fetch;
        if (typeof originalFetch === 'function') {
            window.fetch = function patchedFetch(...args) {
                const req = args[0];
                const url = typeof req === 'string' ? req : (req?.url || '');
                const promise = originalFetch.apply(this, args);
                if (relevant(url)) {
                    promise.then((res) => {
                        try {
                            if (!res?.ok) return;
                            const ct = res.headers.get('content-type') || '';
                            res.clone().text().then((text) => push(url, ct, text)).catch(() => {});
                        } catch { /* noop */ }
                    }).catch(() => {});
                }
                return promise;
            };
        }
    } catch { /* noop */ }

    // --- XMLHttpRequest ----------------------------------------------------
    try {
        const XHR = window.XMLHttpRequest;
        if (XHR && !XHR.prototype.__appYaMainHook) {
            XHR.prototype.__appYaMainHook = true;
            const originalOpen = XHR.prototype.open;
            const originalSend = XHR.prototype.send;

            XHR.prototype.open = function patchedOpen(method, url, ...rest) {
                this.__appYaUrl = url;
                return originalOpen.call(this, method, url, ...rest);
            };
            XHR.prototype.send = function patchedSend(...args) {
                this.addEventListener('load', () => {
                    try {
                        const url = String(this.__appYaUrl || '');
                        if (!relevant(url)) return;
                        const ct = this.getResponseHeader('content-type') || '';
                        push(url, ct, this.responseText || '');
                    } catch { /* noop */ }
                });
                return originalSend.apply(this, args);
            };
        }
    } catch { /* noop */ }

    // --- SPA-навигация -----------------------------------------------------
    const notifyUrl = () => {
        try {
            document.dispatchEvent(new CustomEvent('appYa:url-changed', {
                detail: JSON.stringify({ href: window.location.href, pathname: window.location.pathname }),
            }));
        } catch { /* noop */ }
    };

    for (const method of ['pushState', 'replaceState']) {
        try {
            const original = history[method];
            if (!original || original.__appYaMainHook) continue;
            const wrapped = function wrappedHistory(...args) {
                const result = original.apply(this, args);
                setTimeout(notifyUrl, 0);
                return result;
            };
            wrapped.__appYaMainHook = true;
            history[method] = wrapped;
        } catch { /* noop */ }
    }

    window.addEventListener('popstate', () => setTimeout(notifyUrl, 0));

    try {
        if (window.navigation?.addEventListener) {
            window.navigation.addEventListener('navigate', () => setTimeout(notifyUrl, 0));
        }
    } catch { /* noop */ }
})();
