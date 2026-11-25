/**
 * Yandex Music Fisher mod by vectorserver
 * content.js — ISOLATED world bridge между страницей music.yandex.* и
 * service worker (расширением).
 *
 * Отличия от v2:
 *  - нет setInterval на 1 секунду с JSON.stringify(localStorage) — обновления
 *    приходят событиями от parser.js, плюс редкий fallback-опрос (5 с);
 *  - в chrome.storage уходит только белый список ключей (экономия квоты);
 *  - защита от «Extension context invalidated» после обновления расширения.
 *
 * @author vectorserver
 * @version 3.0.0
 */

(() => {
    'use strict';

    if (window.__appYaContentLoaded) return;
    window.__appYaContentLoaded = true;

    const LOG = '[appYa v3]';
    const ALLOWLIST = [
        'aYa_token',
        'aYa_hosting',
        'aYa_page',
        'aYa_collection',
        'aYa_location',
        'aYa_cureitTrack',
        'aYa_authorizationUrl',
        'aYa_get-file-info',
    ];
    const POLL_MS = 5000;

    let lastSerialized = '';
    let pollTimer = null;
    let disposed = false;

    const log = (...a) => console.log(LOG, ...a);
    const warn = (...a) => console.warn(LOG, ...a);

    /** Контекст расширения жив? После перезагрузки расширения — нет. */
    function contextAlive() {
        try {
            return !!(chrome && chrome.runtime && chrome.runtime.id);
        } catch {
            return false;
        }
    }

    function dispose() {
        disposed = true;
        clearInterval(pollTimer);
        pollTimer = null;
    }

    function sendMessage(message) {
        return new Promise((resolve) => {
            if (disposed || !contextAlive()) {
                resolve(null);
                return;
            }
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        // SW мог быть выгружен — это нормально, следующий вызов его разбудит
                        resolve(null);
                    } else {
                        resolve(response ?? null);
                    }
                });
            } catch {
                dispose();
                resolve(null);
            }
        });
    }

    /** Собрать снапшот localStorage только по белому списку. */
    function collectSnapshot() {
        const snapshot = {};
        for (const key of ALLOWLIST) {
            try {
                const value = localStorage.getItem(key);
                if (value !== null) snapshot[key] = value;
            } catch { /* noop */ }
        }
        return snapshot;
    }

    /** Отправить изменившиеся ключи в SW (diff + debounce). */
    let syncTimer = null;
    function scheduleSync() {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncSnapshot, 300);
    }

    async function syncSnapshot() {
        if (disposed) return;
        const snapshot = collectSnapshot();
        const serialized = JSON.stringify(snapshot);
        if (serialized === lastSerialized) return;
        lastSerialized = serialized;

        const response = await sendMessage({ type: 'page:sync', payload: { data: snapshot } });
        if (response === null && !contextAlive()) dispose();
    }

    /** Настройки расширения → localStorage страницы (их читает parser.js). */
    function applySettings(settings) {
        if (!settings || typeof settings !== 'object') return;
        try {
            for (const [key, value] of Object.entries(settings)) {
                localStorage.setItem(`aYa_setting_${key}`, String(value));
            }
        } catch (e) {
            warn('applySettings:', e?.message);
        }
    }

    async function loadSettings() {
        if (!contextAlive()) return;
        try {
            chrome.storage.local.get('app_setting', (result) => {
                if (chrome.runtime.lastError) return;
                applySettings(result?.app_setting);
            });
        } catch {
            dispose();
        }
    }

    /* ---------------------------------------------------------------------- */
    /* События из MAIN world                                                  */
    /* ---------------------------------------------------------------------- */

    document.addEventListener('appYa:storage-changed', (event) => {
        if (disposed) return;
        let detail = {};
        try { detail = JSON.parse(event.detail || '{}'); } catch { /* noop */ }
        scheduleSync();
        if (detail.keys?.includes('aYa_token')) log('токен обновлён');
    });

    document.addEventListener('appYa:download-request', async (event) => {
        if (disposed) return;
        let detail = {};
        try { detail = JSON.parse(event.detail || '{}'); } catch { /* noop */ }
        if (!detail.trackId) return;

        await sendMessage({
            type: 'queue:enqueue',
            payload: {
                trackId: String(detail.trackId),
                playlistName: detail.playlistName || 'music',
                pageType: 'track',
            },
        });
    });

    /* ---------------------------------------------------------------------- */
    /* Изменения настроек из options/popup                                    */
    /* ---------------------------------------------------------------------- */

    if (contextAlive() && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            if (changes.app_setting) applySettings(changes.app_setting.newValue);
        });
    }

    /* ---------------------------------------------------------------------- */
    /* Старт                                                                  */
    /* ---------------------------------------------------------------------- */

    (async function bootstrap() {
        // 1. Убедиться, что parser.js внедрён в MAIN world
        await sendMessage({ type: 'parser:ensure' });

        // 2. Настройки — в localStorage страницы
        loadSettings();

        // 3. Первичный снапшот
        scheduleSync();

        // 4. Резервный опрос на случай, если страница изменила localStorage
        //    не через parser.js (например, пользователь/другое расширение).
        pollTimer = setInterval(() => {
            if (disposed) return;
            if (!contextAlive()) {
                dispose();
                return;
            }
            syncSnapshot();
        }, POLL_MS);

        window.addEventListener('pagehide', dispose, { once: true });
    })();
})();
