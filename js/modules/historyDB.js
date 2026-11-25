/**
 * Yandex Music Fisher mod by vectorserver
 * historyDB.js — IndexedDB-слой: история загрузок, очередь задач, чанки докачки, кэш.
 *
 * Почему IndexedDB, а не chrome.storage.local:
 *  - chrome.storage.local ограничен ~10 МБ (и это JSON, а не бинарные данные);
 *  - чанки частично скачанных MP3 — ArrayBuffer, их нельзя положить в storage;
 *  - история на тысячи треков с обложками быстро упирается в квоту.
 *
 * База открывается из service worker и из popup — это один и тот же origin
 * (chrome-extension://<id>), поэтому обе стороны видят общие данные.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { DB_NAME, DB_VERSION, STORES, HISTORY_LIMIT, STATUS } from './constants.js';
import { warn } from './utils.js';

/** @type {IDBDatabase|null} */
let dbInstance = null;
/** @type {Promise<IDBDatabase>|null} */
let opening = null;

/** Открыть (или вернуть существующее) соединение со схемой v3. */
export function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (opening) return opening;

    opening = new Promise((resolve, reject) => {
        let req;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (e) {
            reject(e);
            return;
        }

        req.onupgradeneeded = (ev) => {
            const db = req.result;

            // --- История ---
            if (!db.objectStoreNames.contains(STORES.HISTORY)) {
                const s = db.createObjectStore(STORES.HISTORY, { keyPath: 'id' });
                s.createIndex('createdAt', 'createdAt');
                s.createIndex('status', 'status');
                s.createIndex('trackId', 'trackId');
                s.createIndex('batchId', 'batchId');
            }

            // --- Очередь ---
            if (!db.objectStoreNames.contains(STORES.QUEUE)) {
                const s = db.createObjectStore(STORES.QUEUE, { keyPath: 'id' });
                s.createIndex('status', 'status');
                s.createIndex('batchId', 'batchId');
                s.createIndex('position', 'position');
                s.createIndex('nextAttemptAt', 'nextAttemptAt');
            }

            // --- Чанки для докачки (Range) ---
            if (!db.objectStoreNames.contains(STORES.CHUNKS)) {
                const s = db.createObjectStore(STORES.CHUNKS, {
                    keyPath: ['historyId', 'index'],
                });
                s.createIndex('historyId', 'historyId');
            }

            // --- Кэш метаданных/обложек ---
            if (!db.objectStoreNames.contains(STORES.CACHE)) {
                db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
            }

            // Служебная таблица «манIFEST» прогресса частичных загрузок
            if (!db.objectStoreNames.contains('partials')) {
                db.createObjectStore('partials', { keyPath: 'historyId' });
            }
        };

        req.onsuccess = () => {
            dbInstance = req.result;
            opening = null;

            // Если соединение закроется (место на диске, обновление) — сбрасываем кэш
            dbInstance.onclose = () => {
                dbInstance = null;
                warn('IndexedDB closed — переподключимся при следующем обращении');
            };
            dbInstance.onversionchange = () => {
                dbInstance.close();
                dbInstance = null;
            };

            resolve(dbInstance);
        };

        req.onerror = () => {
            opening = null;
            reject(req.error || new Error('IndexedDB open failed'));
        };

        req.onblocked = () => warn('IndexedDB open blocked — закройте другие вкладки расширения');
    });

    return opening;
}

/* -------------------------------------------------------------------------- */
/* Низкоуровневые хелперы                                                     */
/* -------------------------------------------------------------------------- */

/** Выполнить one-shot запрос. */
function run(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Выполнить транзакцию, дождавшись commit. */
async function tx(storeNames, mode, fn) {
    const db = await openDB();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = db.transaction(names, mode);

    return new Promise((resolve, reject) => {
        const stores = Object.fromEntries(
            names.map((n) => [n, transaction.objectStore(n)])
        );
        let result;
        let rejected = false;

        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => {
            rejected = true;
            reject(transaction.error);
        };
        transaction.onabort = () => {
            if (!rejected) reject(transaction.error || new Error('tx aborted'));
        };

        Promise.resolve(fn(stores))
            .then((r) => {
                result = r;
            })
            .catch((e) => {
                rejected = true;
                try { transaction.abort(); } catch { /* noop */ }
                reject(e);
            });
    });
}

/* -------------------------------------------------------------------------- */
/* Кэш произвольных значений (метаданные треков, обложки)                     */
/* -------------------------------------------------------------------------- */

export async function cacheGet(key) {
    try {
        const row = await tx(STORES.CACHE, 'readonly', (s) => run(s[STORES.CACHE].get(key)));
        return row?.value;
    } catch {
        return undefined;
    }
}

export async function cacheSet(key, value, ttlMs = 7 * 24 * 3600 * 1000) {
    try {
        await tx(STORES.CACHE, 'readwrite', (s) => {
            s[STORES.CACHE].put({ key, value, expiresAt: Date.now() + ttlMs });
        });
    } catch (e) {
        warn('cacheSet failed:', e?.message);
    }
}

/** Удалить значение кэша (например, временный Blob перед скачиванием). */
export async function cacheDelete(key) {
    try {
        await tx(STORES.CACHE, 'readwrite', (s) => s[STORES.CACHE].delete(key));
        return true;
    } catch {
        return false;
    }
}

/** Удалить просроченные записи кэша. */
export async function cacheSweep() {
    const now = Date.now();
    try {
        await tx(STORES.CACHE, 'readwrite', async (s) => {
            const all = await run(s[STORES.CACHE].getAllKeys());
            for (const k of all) {
                const row = await run(s[STORES.CACHE].get(k));
                if (row?.expiresAt && row.expiresAt < now) s[STORES.CACHE].delete(k);
            }
        });
    } catch { /* не критично */ }
}

/* -------------------------------------------------------------------------- */
/* ИСТОРИЯ                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Создать запись истории.
 * @param {object} t задача/трек
 */
export async function addHistory(t) {
    const record = {
        id: t.id,
        trackId: t.trackId,
        batchId: t.batchId || null,
        title: t.title || 'Unknown',
        artists: t.artists || 'Unknown Artist',
        album: t.album || '',
        year: t.year || null,
        trackNumber: t.trackNumber ?? null,
        pageType: t.pageType || 'track',
        playlistName: t.playlistName || '',
        filename: t.filename || '',
        coverUrl: t.coverUrl || '',
        streamUrl: t.streamUrl || '',
        quality: t.quality || '',
        tabId: t.tabId ?? null,
        meta: t.meta || null,
        warning: t.warning || null,
        downloadId: t.downloadId ?? null,
        status: t.status || STATUS.QUEUED,
        progress: 0,
        bytesReceived: 0,
        totalBytes: t.totalBytes || 0,
        attempts: 0,
        resumed: 0,
        error: null,
        createdAt: t.createdAt || Date.now(),
        updatedAt: Date.now(),
        finishedAt: null,
    };

    try {
        await tx(STORES.HISTORY, 'readwrite', (s) => s[STORES.HISTORY].put(record));
    } catch (e) {
        warn('addHistory failed:', e?.message);
    }
    return record;
}

/**
 * Пакетное создание записей истории — одна транзакция на всю пачку.
 * Для альбомов/плейлистов это критично: 50 отдельных транзакций в prod-подходе
 * блокировали event loop service worker.
 */
export async function addHistoryMany(records) {
    if (!records?.length) return 0;

    try {
        await tx(STORES.HISTORY, 'readwrite', (s) => {
            for (const t of records) {
                s[STORES.HISTORY].put({
                    id: t.id,
                    trackId: t.trackId,
                    batchId: t.batchId || null,
                    title: t.title || 'Unknown',
                    artists: t.artists || 'Unknown Artist',
                    album: t.album || '',
                    year: t.year || null,
                    trackNumber: t.trackNumber ?? null,
                    pageType: t.pageType || 'track',
                    playlistName: t.playlistName || '',
                    filename: t.filename || '',
                    coverUrl: t.coverUrl || '',
                    streamUrl: t.streamUrl || '',
                    quality: t.quality || '',
                    tabId: t.tabId ?? null,
                    meta: t.meta || null,
                    warning: t.warning || null,
                    downloadId: t.downloadId ?? null,
                    status: t.status || STATUS.QUEUED,
                    progress: 0,
                    bytesReceived: 0,
                    totalBytes: t.totalBytes || 0,
                    attempts: 0,
                    resumed: 0,
                    error: null,
                    createdAt: t.createdAt || Date.now(),
                    updatedAt: Date.now(),
                    finishedAt: null,
                });
            }
        });
        return records.length;
    } catch (e) {
        warn('addHistoryMany failed:', e?.message);
        return 0;
    }
}

/** Точечное обновление записи (без перечитания всей строки). */
export async function updateHistory(id, patch) {
    if (!id) return null;
    try {
        return await tx(STORES.HISTORY, 'readwrite', async (s) => {
            const store = s[STORES.HISTORY];
            const current = await run(store.get(id));
            if (!current) return null;

            const next = { ...current, ...patch, updatedAt: Date.now() };
            if (patch.status === STATUS.DONE || patch.status === STATUS.ERROR) {
                next.finishedAt = Date.now();
            } else if (patch.status === STATUS.QUEUED || patch.status === STATUS.DOWNLOADING) {
                next.finishedAt = null;
            }
            store.put(next);
            return next;
        });
    } catch (e) {
        warn('updateHistory failed:', e?.message);
        return null;
    }
}

export async function getHistory(id) {
    try {
        return (await tx(STORES.HISTORY, 'readonly', (s) => run(s[STORES.HISTORY].get(id)))) || null;
    } catch {
        return null;
    }
}

/**
 * Список истории с поиском и фильтрами.
 * @param {{search?: string, status?: string, pageType?: string, limit?: number, offset?: number}} opts
 */
export async function listHistory(opts = {}) {
    const { search = '', status = '', pageType = '', limit = 200, offset = 0 } = opts;

    try {
        const all = await tx(STORES.HISTORY, 'readonly', (s) => run(s[STORES.HISTORY].getAll()));

        const q = search.trim().toLowerCase();
        const filtered = all.filter((r) => {
            if (status && r.status !== status) return false;
            if (pageType && r.pageType !== pageType) return false;
            if (q) {
                const hay = `${r.title} ${r.artists} ${r.album} ${r.playlistName} ${r.filename}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        return {
            total: filtered.length,
            items: filtered.slice(offset, offset + limit),
        };
    } catch (e) {
        warn('listHistory failed:', e?.message);
        return { total: 0, items: [] };
    }
}

/** Одна последняя запись по trackId (для проверки «уже качался ли»). */
export async function findHistoryByTrack(trackId) {
    try {
        const rows = await tx(STORES.HISTORY, 'readonly', (s) =>
            run(s[STORES.HISTORY].index('trackId').getAll(String(trackId)))
        );
        return rows?.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))?.[0] || null;
    } catch {
        return null;
    }
}

export async function deleteHistory(id) {
    try {
        await tx([STORES.HISTORY, STORES.CHUNKS], 'readwrite', async (s) => {
            s[STORES.HISTORY].delete(id);
            await deleteChunksIn(s, id);
        });
        return true;
    } catch (e) {
        warn('deleteHistory failed:', e?.message);
        return false;
    }
}

/** Очистить историю (опционально — только завершённые/ошибочные). */
export async function clearHistory(onlyStatuses = null) {
    try {
        await tx([STORES.HISTORY, STORES.CHUNKS], 'readwrite', async (s) => {
            const rows = await run(s[STORES.HISTORY].getAll());
            for (const r of rows) {
                if (onlyStatuses && !onlyStatuses.includes(r.status)) continue;
                s[STORES.HISTORY].delete(r.id);
                await deleteChunksIn(s, r.id);
            }
        });
        return true;
    } catch (e) {
        warn('clearHistory failed:', e?.message);
        return false;
    }
}

/** Обрезать историю до HISTORY_LIMIT самых свежих. */
export async function pruneHistory(limit = HISTORY_LIMIT) {
    try {
        await tx(STORES.HISTORY, 'readwrite', async (s) => {
            const rows = await run(s[STORES.HISTORY].getAll());
            if (rows.length <= limit) return 0;
            const sorted = rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            const doomed = sorted.slice(limit);
            for (const r of doomed) s[STORES.HISTORY].delete(r.id);
            return doomed.length;
        });
    } catch {
        return 0;
    }
}

/** Сводка для шапки таба «История». */
export async function historyStats() {
    try {
        const rows = await tx(STORES.HISTORY, 'readonly', (s) => run(s[STORES.HISTORY].getAll()));
        const stats = { total: rows.length, done: 0, error: 0, partial: 0, bytes: 0 };
        for (const r of rows) {
            if (r.status === STATUS.DONE) stats.done++;
            else if (r.status === STATUS.ERROR) stats.error++;
            else if (r.bytesReceived > 0) stats.partial++;
            if (r.status === STATUS.DONE && r.totalBytes) stats.bytes += r.totalBytes;
        }
        return stats;
    } catch {
        return { total: 0, done: 0, error: 0, partial: 0, bytes: 0 };
    }
}

/* -------------------------------------------------------------------------- */
/* ОЧЕРЕДЬ                                                                    */
/* -------------------------------------------------------------------------- */

/** Поставить задачи в очередь атомарно. */
export async function enqueueTasks(tasks) {
    if (!tasks?.length) return 0;
    try {
        await tx(STORES.QUEUE, 'readwrite', (s) => {
            const store = s[STORES.QUEUE];
            tasks.forEach((t, i) => {
                store.put({
                    id: t.id,
                    batchId: t.batchId,
                    trackId: t.trackId,
                    position: t.position ?? i,
                    status: t.status || STATUS.QUEUED,
                    attempts: t.attempts || 0,
                    nextAttemptAt: t.nextAttemptAt || 0,
                    payload: t.payload || null,
                    error: null,
                    createdAt: Date.now(),
                });
            });
        });
        return tasks.length;
    } catch (e) {
        warn('enqueueTasks failed:', e?.message);
        return 0;
    }
}

export async function updateTask(id, patch) {
    try {
        return await tx(STORES.QUEUE, 'readwrite', async (s) => {
            const store = s[STORES.QUEUE];
            const cur = await run(store.get(id));
            if (!cur) return null;
            const next = { ...cur, ...patch };
            store.put(next);
            return next;
        });
    } catch {
        return null;
    }
}

export async function getTask(id) {
    try {
        return (await tx(STORES.QUEUE, 'readonly', (s) => run(s[STORES.QUEUE].get(id)))) || null;
    } catch {
        return null;
    }
}

/** Все задачи (для «Активных» и восстановления после сна SW). */
export async function listTasks(filter = {}) {
    try {
        const rows = await tx(STORES.QUEUE, 'readonly', (s) => run(s[STORES.QUEUE].getAll()));
        const out = rows.filter((r) => {
            if (filter.status && r.status !== filter.status) return false;
            if (filter.batchId && r.batchId !== filter.batchId) return false;
            return true;
        });
        return out.sort((a, b) => (a.position || 0) - (b.position || 0));
    } catch (e) {
        warn('listTasks failed:', e?.message);
        return [];
    }
}

/** Задачи, готовые к запуску (учитывая backoff). */
export async function nextRunnableTasks(limit, now = Date.now()) {
    const rows = await listTasks();
    return rows
        // В работу берём только «ждущие»; paused/error — только по команде пользователя
        .filter((r) => r.status === STATUS.QUEUED)
        .filter((r) => !r.nextAttemptAt || r.nextAttemptAt <= now)
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .slice(0, limit);
}

export async function removeTask(id) {
    try {
        await tx(STORES.QUEUE, 'readwrite', (s) => s[STORES.QUEUE].delete(id));
        return true;
    } catch {
        return false;
    }
}

export async function removeTasks(ids = []) {
    try {
        await tx(STORES.QUEUE, 'readwrite', (s) => {
            ids.forEach((id) => s[STORES.QUEUE].delete(id));
        });
        return ids.length;
    } catch {
        return 0;
    }
}

export async function clearQueue() {
    try {
        await tx(STORES.QUEUE, 'readwrite', (s) => s[STORES.QUEUE].clear());
        return true;
    } catch {
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/* ЧАНКИ (докачка через Range)                                                */
/* -------------------------------------------------------------------------- */

/** Сохранить один чанк тела файла. */
export async function putChunk(historyId, index, data, offset) {
    try {
        await tx(STORES.CHUNKS, 'readwrite', (s) => {
            s[STORES.CHUNKS].put({
                historyId,
                index,
                offset,
                size: data.byteLength,
                data,
                updatedAt: Date.now(),
            });
        });
        return true;
    } catch (e) {
        warn('putChunk failed:', e?.message);
        return false;
    }
}

/** Все чанки задачи, упорядоченные по индексу. */
export async function getChunks(historyId) {
    try {
        const rows = await tx(STORES.CHUNKS, 'readonly', (s) =>
            run(s[STORES.CHUNKS].index('historyId').getAll(historyId))
        );
        return (rows || []).sort((a, b) => a.index - b.index);
    } catch {
        return [];
    }
}

/** Смещение, с которого надо продолжать загрузку (конец непрерывного ряда чанков). */
export async function getResumeOffset(historyId) {
    const chunks = await getChunks(historyId);
    if (!chunks.length) return 0;

    let expected = 0;
    for (const c of chunks) {
        if (c.index !== expected) break;
        expected++;
    }
    const usable = chunks.filter((c) => c.index < expected);
    return usable.reduce((acc, c) => acc + (c.size || 0), 0);
}

/** Удалить чанки задачи (после успешной сборки файла). */
export async function deleteChunks(historyId) {
    try {
        await tx(STORES.CHUNKS, 'readwrite', async (s) => {
            await deleteChunksIn(s, historyId);
        });
        return true;
    } catch {
        return false;
    }
}

/** Внутренний вариант внутри уже открытой транзакции. */
async function deleteChunksIn(s, historyId) {
    const store = s[STORES.CHUNKS];
    const keys = await run(store.index('historyId').getAllKeys(historyId));
    for (const k of keys) store.delete(k);
}

/** Прогресс частичной загрузки: сколько байт лежит в БД. */
export async function getPartialSize(historyId) {
    const chunks = await getChunks(historyId);
    return chunks.reduce((acc, c) => acc + (c.size || 0), 0);
}

/* -------------------------------------------------------------------------- */
/* ПОЛНАЯ ОЧИСТКА                                                             */
/* -------------------------------------------------------------------------- */

export async function wipeAll() {
    try {
        const db = await openDB();
        const names = [...Object.values(STORES), 'partials'];
        await new Promise((resolve, reject) => {
            const t = db.transaction(names, 'readwrite');
            names.forEach((n) => t.objectStore(n).clear());
            t.oncomplete = resolve;
            t.onerror = () => reject(t.error);
        });
        return true;
    } catch (e) {
        warn('wipeAll failed:', e?.message);
        return false;
    }
}

/** Оценка занятого места (если браузер даёт Permissions API). */
export async function estimateUsage() {
    try {
        if (navigator?.storage?.estimate) return await navigator.storage.estimate();
    } catch { /* noop */ }
    return { usage: 0, quota: 0 };
}

export { STATUS };
