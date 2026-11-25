/**
 * Yandex Music Fisher mod by vectorserver
 * offscreen.js — service page (reason: BLOBS). Создаёт/освобождает Blob URL.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { cacheGet, cacheDelete } from './modules/historyDB.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || '');
    const payload = message?.payload || {};

    if (type === 'offscreen:blob:create') {
        (async () => {
            try {
                const value = await cacheGet(payload.key);
                if (!value?.bytes) {
                    sendResponse({ ok: false, error: 'Нет байтов в IndexedDB' });
                    return;
                }
                const blob = new Blob([value.bytes], { type: value.mime || 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                sendResponse({ ok: true, url });
            } catch (e) {
                sendResponse({ ok: false, error: String(e?.message || e) });
            }
        })();
        return true;
    }

    if (type === 'offscreen:blob:revoke') {
        (async () => {
            try {
                if (payload.url) URL.revokeObjectURL(payload.url);
                if (payload.key) await cacheDelete(payload.key);
                sendResponse({ ok: true });
            } catch (e) {
                sendResponse({ ok: false, error: String(e?.message || e) });
            }
        })();
        return true;
    }

    return false;
});
