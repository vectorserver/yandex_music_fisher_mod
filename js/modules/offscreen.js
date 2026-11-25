/**
 * Yandex Music Fisher mod by vectorserver
 * offscreen.js — создание Blob URL для готового файла через offscreen document.
 *
 * В MV3 service worker не может надёжно создать blob: URL, а data: URL имеет
 * практический лимит длины (lossless FLAC легко его превышает). Offscreen
 * document с причиной BLOBS создаёт объектный URL, а service worker отдаёт его
 * в chrome.downloads.download.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { cacheSet, cacheDelete } from './historyDB.js';
import { uid, warn, sleep } from './utils.js';

const DOC_URL = 'html/offscreen.html';
let creating = null;

/** Поддерживает ли браузер offscreen API (Chrome/Opera/Edge). */
export function offscreenSupported() {
    try {
        return !!(chrome?.offscreen?.createDocument);
    } catch {
        return false;
    }
}

/** Создать offscreen document ровно один раз. */
export async function ensureOffscreen() {
    if (!offscreenSupported()) throw new Error('offscreen API недоступен');

    try {
        if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return;
    } catch { /* старые версии */ }

    if (creating) return creating;

    creating = (async () => {
        try {
            await chrome.offscreen.createDocument({
                url: DOC_URL,
                reasons: ['BLOBS'],
                justification: 'Yandex Music Fisher: Blob URL для файла с ID3/FLAC-тегами',
            });
        } catch (e) {
            // «Only a single offscreen document may be created» — уже открыт
            if (!/single offscreen|already/i.test(String(e?.message || e))) throw e;
        }
    })();

    try {
        await creating;
    } finally {
        creating = null;
    }
}

/**
 * Положить байты в IndexedDB, попросить offscreen создать Blob URL.
 * @returns {Promise<{url: string, key: string}>}
 */
export async function createBlobUrl(bytes, mime, key = `blob_${uid()}`) {
    await cacheSet(key, { bytes, mime }, 60 * 60 * 1000);

    let response = null;
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            response = await chrome.runtime.sendMessage({
                type: 'offscreen:blob:create',
                payload: { key, mime },
            });
        } catch (e) {
            response = { ok: false, error: String(e?.message || e) };
        }
        if (response?.ok && response.url) break;
        // offscreen-документ мог быть создан, но его скрипт ещё не загрузился
        await sleep(150);
    }

    if (!response?.ok || !response.url) {
        warn('offscreen blob create failed:', response?.error);
        await cacheDelete(key);
        throw new Error(response?.error || 'Не удалось создать Blob URL');
    }
    return { url: response.url, key };
}

/** Освободить Blob URL и временные байты. */
export async function revokeBlobUrl(url, key) {
    try {
        if (url) {
            await chrome.runtime.sendMessage({
                type: 'offscreen:blob:revoke',
                payload: { url, key },
            });
        }
    } catch { /* offscreen мог закрыться */ }
    if (key) await cacheDelete(key);
}
