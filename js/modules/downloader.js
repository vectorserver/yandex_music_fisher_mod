/**
 * Yandex Music Fisher mod by vectorserver
 * downloader.js — загрузка одного трека: Range-докачка, прогресс, ретраи, сохранение.
 *
 * Реализованы оба варианта из ТЗ:
 *   Вариант А — чанковая загрузка с HTTP `Range`: полученные куски складываются
 *     в IndexedDB, при обрыве запрос продолжается с байта обрыва.
 *   Вариант Б — если сервер игнорирует Range (200 вместо 206) или URL протух,
 *     чанки сбрасываются и загрузка повторяется целиком по сохранённому streamUrl,
 *     без повторного парсинга плейлиста.
 *
 * Сохранение готового файла:
 *   - без ID3 → chrome.downloads.download напрямую по stream URL (дешевле всего);
 *   - с ID3   → сборка ArrayBuffer в памяти и data: URL, потому что
 *     chrome.downloads в MV3 не принимает blob: URL (chromium issue 41439098).
 *
 * Все слушатели downloads.onChanged — ОДИН центральный (см. service_worker.js),
 * поэтому подписки больше не накапливаются на каждую загрузку (утечка из prod).
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { CHUNK_SIZE, STATUS, TIMEOUTS } from './constants.js';
import { fetchSafe, warn, error as logError, coverUrl } from './utils.js';
import { putChunk, getChunks, deleteChunks, cacheGet, cacheSet } from './historyDB.js';
import { shrinkCover, writeAudioTags, bufferToDataUrl, canUseDataUrl, isFlac } from './id3.js';
import { offscreenSupported, ensureOffscreen, createBlobUrl, revokeBlobUrl } from './offscreen.js';

/* -------------------------------------------------------------------------- */
/* Реестр ожидающих загрузок (одна подписка на весь цикл жизни SW)             */
/* -------------------------------------------------------------------------- */

/** @type {Map<number, {resolve: Function, reject: Function, timer: number}>} */
const pendingDownloads = new Map();

/** Промис на chrome.downloads.download; резолится на 'complete', реджектится на 'interrupted'. */
export function downloadViaApi(options) {
    return new Promise((resolve, reject) => {
        chrome.downloads.download(options, (downloadId) => {
            if (chrome.runtime.lastError || !downloadId) {
                reject(new Error(chrome.runtime.lastError?.message || 'downloads.download failed'));
                return;
            }

            const timer = setTimeout(() => {
                pendingDownloads.delete(downloadId);
                reject(new Error('DOWNLOAD_TIMEOUT'));
            }, 10 * 60 * 1000);

            pendingDownloads.set(downloadId, { resolve, reject, timer });
        });
    });
}

/**
 * Центральный обработчик chrome.downloads.onChanged.
 * Вызывается ровно один слушатель, зарегистрированный в service_worker.js.
 */
export function handleDownloadsChanged(delta) {
    if (!delta?.id) return;
    const waiter = pendingDownloads.get(delta.id);
    if (!waiter) return;

    if (delta.state) {
        if (delta.state.current === 'complete') {
            pendingDownloads.delete(delta.id);
            clearTimeout(waiter.timer);
            waiter.resolve({ id: delta.id, filename: delta.filename?.current });
        } else if (delta.state.current === 'interrupted') {
            pendingDownloads.delete(delta.id);
            clearTimeout(waiter.timer);
            waiter.reject(new Error(delta.error?.current || 'interrupted'));
        }
    }
}

/** Отменить все ожидающие (при остановке очереди). */
export function cancelAllWaiters(reason = 'cancelled') {
    for (const [id, w] of pendingDownloads) {
        clearTimeout(w.timer);
        w.reject(new Error(reason));
    }
    pendingDownloads.clear();
}

/**
 * Сохранить большой файл с тегами через Blob URL из offscreen document.
 * data: URL для lossless FLAC часто превышает практический лимит Chrome.
 */
async function downloadTaggedViaBlob(bytes, mime, filename) {
    await ensureOffscreen();
    const { url, key } = await createBlobUrl(bytes, mime);
    try {
        return await downloadViaApi({
            url,
            filename,
            saveAs: false,
            conflictAction: 'overwrite',
        });
    } finally {
        await revokeBlobUrl(url, key);
    }
}

/* -------------------------------------------------------------------------- */
/* Загрузка тела файла с докачкой                                             */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} DownloadResult
 * @property {Uint8Array} bytes
 * @property {number} total
 * @property {number} resumedBytes  байты, взятые из ранее докачанных чанков
 */

/**
 * Скачать файл в Uint8Array с поддержкой Range-докачки.
 *
 * @param {string} url
 * @param {Object} o
 * @param {string} [o.historyId]
 * @param {boolean} o.resume   складывать ли чанки в IndexedDB
 * @param {(received: number, total: number) => void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<DownloadResult>}
 */
export async function downloadToBuffer(url, o = {}) {
    const { historyId, resume = true, onProgress, signal } = o;
    const useChunks = resume && !!historyId;

    let startOffset = 0;
    let nextChunkIndex = 0;

    if (useChunks) {
        const state = await getResumeState(historyId);
        startOffset = state.offset;
        nextChunkIndex = state.nextIndex;
    }

    const headers = {};
    if (startOffset > 0) headers.Range = `bytes=${startOffset}-`;

    const res = await fetchSafe(url, { headers, signal, credentials: 'omit' }, TIMEOUTS.CHUNK);

    // 416 — offset ушёл за размер файла: чанки невалидны, качаем заново
    if (res.status === 416) {
        if (useChunks) await deleteChunks(historyId);
        return downloadToBuffer(url, { ...o, resume: false });
    }

    // Сервер проигнорировал Range (200 вместо 206) — старые чанки не подходят
    if (startOffset > 0 && res.status === 200) {
        warn('Range не поддержан (200 вместо 206) — начинаю загрузку заново');
        if (useChunks) await deleteChunks(historyId);
        startOffset = 0;
        nextChunkIndex = 0;
    }

    const contentLength = Number(res.headers.get('content-length') || 0);
    const total = startOffset + contentLength;

    // Браузер не отдал стрим (редкий путь) — читаем одним куском
    if (!res.body) {
        const buf = new Uint8Array(await res.arrayBuffer());
        onProgress?.(startOffset + buf.byteLength, total || buf.byteLength);
        return { bytes: buf, total: buf.byteLength, resumedBytes: 0 };
    }

    const reader = res.body.getReader();

    let memParts = [];   // используется, когда чанковое хранение выключено
    let memLen = 0;
    let pending = [];    // текущий незаписанный чанк
    let pendingLen = 0;
    let received = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || !value.byteLength) continue;

            received += value.byteLength;
            onProgress?.(startOffset + received, total);

            if (useChunks) {
                pending.push(value);
                pendingLen += value.byteLength;

                if (pendingLen >= CHUNK_SIZE) {
                    const merged = concat(pending, pendingLen);
                    await putChunk(historyId, nextChunkIndex++, merged, startOffset + received - pendingLen);
                    pending = [];
                    pendingLen = 0;
                }
            } else {
                memParts.push(value);
                memLen += value.byteLength;
            }
        }
    } finally {
        try { reader.releaseLock(); } catch { /* noop */ }
    }

    /* ---- путь без чанков: всё уже в памяти ---- */
    if (!useChunks) {
        const bytes = concat(memParts, memLen);
        memParts = [];
        return { bytes, total: memLen, resumedBytes: 0 };
    }

    /* ---- путь с чанками: дописываем остаток и собираем из IndexedDB ---- */
    if (pendingLen > 0) {
        await putChunk(historyId, nextChunkIndex, concat(pending, pendingLen), startOffset + received - pendingLen);
        pending = [];
        pendingLen = 0;
    }

    const chunks = await getChunks(historyId);
    const totalSize = chunks.reduce((acc, c) => acc + (c.size || 0), 0);
    const out = new Uint8Array(totalSize);

    let pos = 0;
    for (const c of chunks) {
        const view = c.data instanceof Uint8Array ? c.data : new Uint8Array(c.data);
        out.set(view, pos);
        pos += view.byteLength;
        c.data = null; // освобождаем ссылку на вычитанный чанк
    }
    chunks.length = 0;

    return { bytes: out, total: totalSize, resumedBytes: startOffset };
}

/**
 * Состояние частичной загрузки: непрерывное смещение и следующий индекс чанка.
 * Дырявый ряд (пропущенный индекс) обрывается на дыре — иначе склейка даст битый файл.
 */
async function getResumeState(historyId) {
    const chunks = await getChunks(historyId);
    let offset = 0;
    let nextIndex = 0;

    for (const c of chunks) {
        if (c.index !== nextIndex) break;
        offset += c.size || 0;
        nextIndex++;
    }

    return { offset, nextIndex };
}

/** Склейка массива Uint8Array в один (без промежуточных копий). */
function concat(parts, totalLen) {
    if (parts.length === 1) return parts[0];
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of parts) {
        out.set(p, pos);
        pos += p.byteLength;
    }
    return out;
}

/* -------------------------------------------------------------------------- */
/* Обложка                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Получить байты обложки (с кэшем IndexedDB и ресайзом).
 * @returns {Promise<Uint8Array|null>}
 */
export async function fetchCover(trackId, uri, settings) {
    if (!uri) return null;

    const size = settings.coverQuality;
    const key = `cover_${trackId}_${size}`;

    const cached = await cacheGet(key);
    if (cached?.bytes) {
        return { data: new Uint8Array(cached.bytes), mime: cached.mime };
    }

    try {
        const res = await fetchSafe(coverUrl(uri, size), {}, TIMEOUTS.COVER);
        const raw = new Uint8Array(await res.arrayBuffer());
        const shrunk = await shrinkCover(raw, { maxSide: size, maxBytes: settings.coverMaxBytes });

        // Храним сжатую версию — повторные скачивания не грузят сеть
        await cacheSet(key, { bytes: shrunk.data.buffer.slice(0), mime: shrunk.mime });

        return { data: shrunk.data, mime: shrunk.mime };
    } catch (e) {
        warn('обложка не получена:', e?.message);
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/* Полный цикл: скачать → теги → сохранить                                    */
/* -------------------------------------------------------------------------- */

/**
 * @param {Object} o
 * @param {string} o.historyId
 * @param {string} o.streamUrl      прямой URL стрима от /get-file-info
 * @param {string} o.filename       путь + имя файла для chrome.downloads
 * @param {object} o.meta           данные для ID3
 * @param {object} o.settings
 * @param {(patch: object) => void} o.onProgress  патч в историю
 * @param {AbortSignal} [o.signal]
 * @returns {Promise<{status: string, bytes: number, resumed: number, warning?: string}>}
 */
export async function processTrack(o) {
    const { historyId, streamUrl, filename, meta, settings, onProgress, signal } = o;

    if (!streamUrl) throw new Error('Нет ссылки на стрим — нужен повторный парсинг');

    /* ---- Режим 1: без тегов — прямая загрузка (лёгкий и самый надёжный) ---- */
    if (!settings.writeId3) {
        const info = await downloadViaApi({
            url: streamUrl,
            filename,
            saveAs: false,
            conflictAction: 'overwrite',
        });
        return { status: STATUS.DONE, bytes: 0, resumed: 0, direct: true, ...info };
    }

    /* ---- Режим 2: скачиваем в память, пишем ID3, отдаём data URL ---- */
    onProgress?.({ status: STATUS.DOWNLOADING });

    const fetched = await downloadToBuffer(streamUrl, {
        historyId,
        resume: settings.resumeEnabled,
        signal,
        onProgress: (received, tot) => onProgress?.({
            status: STATUS.DOWNLOADING,
            bytesReceived: received,
            totalBytes: tot || 0,
            progress: tot ? Math.min(99, Math.round((received / tot) * 100)) : 0,
        }),
    });

    let bytes = fetched.bytes;
    const total = fetched.total;
    const resumedBytes = fetched.resumedBytes;

    // Обложку тянем после тела, чтобы не держать два больших буфера одновременно долго
    onProgress?.({ status: STATUS.TAGGING, progress: 99 });
    const cover = await fetchCover(meta.trackId, meta.coverUri, settings);

    let tagged = writeAudioTags(bytes, meta, cover?.data ?? null);

    // Тело и обложка больше не нужны — освобождаем до base64-кодирования
    bytes = null;
    cover?.data && (cover.data = null);
    await deleteChunks(historyId);

    const mime = isFlac(tagged) ? 'audio/flac' : 'audio/mpeg';

    // 1. Большие файлы (lossless FLAC) сохраняем через Blob URL из offscreen:
    //    data: URL в Chrome имеет практический лимит длины.
    if (offscreenSupported()) {
        onProgress?.({ status: STATUS.SAVING, progress: 100 });
        try {
            const info = await downloadTaggedViaBlob(tagged, mime, filename);
            tagged = null;
            return { status: STATUS.DONE, bytes: total, resumed: resumedBytes, ...info };
        } catch (e) {
            logError('сохранение через Blob URL не удалось, пробую data URL:', e?.message);
        }
    }

    /* Если файл слишком велик для data URL — не рискуем, качаем напрямую */
    if (!canUseDataUrl(tagged.byteLength)) {
        warn(`файл ${(tagged.byteLength / 1048576).toFixed(1)} МБ — data URL не подходит, качаю без тегов`);
        const info = await downloadViaApi({
            url: streamUrl, filename, saveAs: false, conflictAction: 'overwrite',
        });
        return {
            status: STATUS.DONE, bytes: total, resumed: resumedBytes, direct: true,
            warning: 'Слишком большой файл — теги не записаны',
        };
    }

    onProgress?.({ status: STATUS.SAVING, progress: 100 });

    const dataUrl = bufferToDataUrl(tagged, mime);
    // Буфер с тегами больше не нужен: data URL — отдельная строка
    tagged = null;

    try {
        const info = await downloadViaApi({
            url: dataUrl,
            filename,
            saveAs: false,
            conflictAction: 'overwrite',
        });
        return { status: STATUS.DONE, bytes: total, resumed: resumedBytes, ...info };
    } catch (e) {
        // data URL мог не пройти по лимиту URL — фолбэк на прямую загрузку
        logError('сохранение через data URL не удалось, фолбэк без тегов:', e?.message);
        const info = await downloadViaApi({
            url: streamUrl, filename, saveAs: false, conflictAction: 'overwrite',
        });
        return {
            status: STATUS.DONE, bytes: total, resumed: resumedBytes, direct: true,
            warning: `Теги записаны не были: ${e?.message}`,
        };
    }
}

export { CHUNK_SIZE, STATUS };
