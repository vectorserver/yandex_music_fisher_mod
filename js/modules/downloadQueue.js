/**
 * Yandex Music Fisher mod by vectorserver
 * downloadQueue.js — умная очередь загрузок (Вариант Б из ТЗ) поверх Range-докачки.
 *
 * Возможности:
 *  - параллельность из настроек (maxConcurrent), порядок по position;
 *  - exponential backoff с джиттером и лимитом попыток;
 *  - состояние живёт в IndexedDB → переживает выгрузку service worker и рестарт браузера;
 *  - «Повторить» / «Продолжить» для отдельного трека БЕЗ повторного парсинга
 *    плейлиста — переиспользуется сохранённый streamUrl;
 *  - если streamUrl протёк (403/410) — точечно перевыпускается только он один.
 *
 * Тяжёлая работа (сеть, ID3) не касается popup: очередь крутится в SW,
 * popup только читает IndexedDB и шлёт команды.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { STATUS, QUEUE } from './constants.js';
import { uid, backoffDelay, warn, error as logError, applyTemplate, hasTemplateVars, buildTrackFilename, joinArtists, sanitizePath } from './utils.js';
import {
    enqueueTasks, listTasks, updateTask, removeTask, removeTasks, getTask,
    addHistory, addHistoryMany, updateHistory, getHistory, deleteChunks, pruneHistory,
} from './historyDB.js';
import { processTrack, cancelAllWaiters } from './downloader.js';
import { badge } from './badge.js';
import { getSettings } from './storage.js';

/* -------------------------------------------------------------------------- */
/* Разрешитель URL/метаданных — внедряется из service_worker.js               */
/* -------------------------------------------------------------------------- */

/**
 * @typedef {Object} Resolvers
 * @property {(tabId: number, trackIds: string[]) => Promise<Array<object>>} meta
 *   пакетные метаданные треков (один запрос на всю пачку)
 * @property {(tabId: number, trackId: string) => Promise<{streamUrl: string, quality: string}|null>} stream
 *   прямой URL стрима для одного трека (требует HMAC-подписи на странице)
 */

/** @type {Resolvers|null} */
let resolvers = null;

export function setResolvers(r) {
    resolvers = r;
}

/* -------------------------------------------------------------------------- */
/* Состояние очереди                                                          */
/* -------------------------------------------------------------------------- */

const state = {
    running: new Set(),   // id активных задач
    controllers: new Map(),// id -> AbortController
    paused: false,        // общая пауза
    concurrency: QUEUE.DEFAULT_CONCURRENCY,
    maxAttempts: QUEUE.MAX_ATTEMPTS,
    pumping: false,       // защита от параллельных проходов pump()
};

/** Задачи, отменённые пользователем: их финальный статус — SKIPPED, не PAUSED. */
const cancelled = new Set();

/**
 * Троттл для обновлений прогресса: не чаще 250 мс на задачу.
 * В prod historyDB вызывался на каждый байт — сотни транзакций в секунду.
 */
const progressTimers = new Map();

function throttleProgress(taskId) {
    return (patch) => {
        if (!patch) return;
        if (progressTimers.has(taskId)) return; // уже ждём
        progressTimers.set(taskId, setTimeout(() => {
            progressTimers.delete(taskId);
            updateHistory(taskId, patch).catch(() => {});
        }, 250));
    };
}

/**
 * Сбросить отложенный прогресс задачи.
 * Обязательно перед финальной записью статуса — иначе «догоняющий» таймер
 * может перезаписать DONE обратно в DOWNLOADING.
 */
function flushProgress(taskId) {
    const timer = progressTimers.get(taskId);
    if (timer) {
        clearTimeout(timer);
        progressTimers.delete(taskId);
    }
}

/** Широковещательное событие для popup (popup может быть закрыт — молча игнорируем). */
function emit(type, payload = {}) {
    try {
        chrome.runtime.sendMessage({ type: `queue:${type}`, payload }).catch(() => {});
    } catch {
        /* нет приёмников */
    }
}

/* -------------------------------------------------------------------------- */
/* ПОСТАНОВКА В ОЧЕРЕДЬ                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Добавить пачку треков в очередь.
 *
 * @param {Object} o
 * @param {number} o.tabId
 * @param {Array<string|number>} o.trackIds
 * @param {string} o.playlistName  базовая папка/имя партии
 * @param {string} [o.pageType]    album|playlist|artist|chart|track
 * @param {object} o.settings
 * @returns {Promise<{batchId: string, added: number, skipped: number}>}
 */
export async function enqueue({ tabId, trackIds, playlistName, pageType = 'track', settings }) {
    const ids = [...new Set((trackIds || []).map((x) => String(x)).filter(Boolean))];
    if (!ids.length) return { batchId: null, added: 0, skipped: 0 };

    const batchId = uid('b');
    const baseFolder = sanitizePath(playlistName, 'music');
    const downloadRoot = sanitizePath(settings.downloadFolder || 'music', 'music');

    // 1. Пакетные метаданные — один запрос на всю пачку вместо N
    let metas = [];
    try {
        metas = resolvers?.meta ? await resolvers.meta(tabId, ids) : [];
    } catch (e) {
        warn('пакетные метаданные не получены, ухожу в поштучный режим:', e?.message);
    }

    const metaByTrack = new Map((metas || []).map((m) => [String(m?.trackId ?? m?.id), m]));

    const tasks = [];
    const historyRows = [];

    for (const [i, trackId] of ids.entries()) {
        const meta = metaByTrack.get(trackId) || null;

        const folder = hasTemplateVars(settings.downloadFolder)
            ? applyTemplate(settings.downloadFolder, templateVars(meta, baseFolder))
            : sanitizePath(`${downloadRoot}/${baseFolder}`, 'music');

        const nameInfo = buildTrackFilename({
            folder,
            artists: meta ? joinArtists(meta.artists) : 'Unknown Artist',
            title: meta?.title || `track_${trackId}`,
            trackIndex: meta?.trackNumber,
            numbering: settings.numberingTracks,
            extension: settings.audioQuality === 'lossless' ? 'flac' : 'mp3',
        });

        const id = uid('q');

        tasks.push({
            id,
            batchId,
            trackId,
            position: i,
            status: STATUS.QUEUED,
            attempts: 0,
            payload: {
                tabId,
                filename: nameInfo.filename,
                pageType,
                playlistName,
                meta: meta ? slimMeta(meta) : null,
            },
        });

        // Запись истории сразу — трек виден во «Активных» до начала загрузки
        historyRows.push({
            id,
            trackId,
            batchId,
            pageType,
            playlistName,
            filename: nameInfo.filename,
            title: meta?.title || `track_${trackId}`,
            artists: meta ? joinArtists(meta.artists) : 'Unknown Artist',
            album: meta?.album || '',
            year: meta?.year || null,
            trackNumber: meta?.trackNumber ?? null,
            coverUrl: meta?.coverUri || '',
            quality: settings.audioQuality,
            tabId,
            meta: meta ? slimMeta(meta) : null,
            status: STATUS.QUEUED,
        });
    }

    // Один заход в IndexedDB на всю пачку вместо N транзакций
    await Promise.all([enqueueTasks(tasks), addHistoryMany(historyRows)]);
    badge.openBatch(batchId, tasks.length);

    emit('enqueued', { batchId, added: tasks.length });
    schedulePump();

    return { batchId, added: tasks.length, skipped: ids.length - tasks.length };
}

/** Словарь переменных для шаблона пути. */
function templateVars(meta, fallbackDir) {
    const m = meta || {};
    return {
        dir: fallbackDir,
        genre: m.genre || 'Unknown',
        year: m.year || new Date().getFullYear(),
        artist: m.artists ? joinArtists(m.artists) : 'Unknown Artist',
        first_artist: m.artists?.[0]?.name || 'Unknown Artist',
        album: m.album || 'Unknown Album',
    };
}

/** Не тащим в payload лишнее — только то, что нужно для имени файла и ID3. */
function slimMeta(m) {
    return {
        trackId: String(m.trackId ?? m.id),
        title: m.title,
        artists: m.artists,
        album: m.album,
        albumId: m.albumId,
        year: m.year,
        genre: m.genre,
        coverUri: m.coverUri,
        trackNumber: m.trackNumber,
        trackTotal: m.trackTotal,
        discNumber: m.discNumber,
        discTotal: m.discTotal,
        duration: m.duration,
    };
}

/* -------------------------------------------------------------------------- */
/* ДВИЖОК                                                                     */
/* -------------------------------------------------------------------------- */

let pumpTimer = null;

/** Отложенный запуск движка (коалесцирует частые вызовы). */
function schedulePump() {
    if (pumpTimer) return;
    pumpTimer = setTimeout(() => {
        pumpTimer = null;
        pump().catch((e) => logError('pump:', e?.message));
    }, 50);
}

/** Основной цикл: подобрать свободные слоты и запустить задачи. */
export async function pump() {
    if (state.paused || state.pumping) return;
    state.pumping = true;

    try {
        const settings = await getLiveSettings();
        state.concurrency = settings.maxConcurrent;
        state.maxAttempts = settings.maxAttempts;

        while (state.running.size < state.concurrency) {
            const [task] = await listRunnable(1);
            if (!task) break;

            state.running.add(task.id);
            runTask(task)
                .catch((e) => logError('runTask:', e?.message || e))
                .finally(() => {
                    state.running.delete(task.id);
                    schedulePump();
                });
        }
    } finally {
        state.pumping = false;
        emit('stats', await stats());
    }
}

/** Настройки читаем свежими — пользователь мог поменять параллельность на лету. */
async function getLiveSettings() {
    return getSettings();
}

async function listRunnable(limit) {
    const now = Date.now();
    const rows = await listTasks();
    return rows
        .filter((t) => t.status === STATUS.QUEUED)
        .filter((t) => !t.nextAttemptAt || t.nextAttemptAt <= now)
        .filter((t) => !state.running.has(t.id))
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .slice(0, limit);
}

/**
 * Выполнить одну задачу.
 */
async function runTask(task) {
    const settings = await getLiveSettings();
    const controller = new AbortController();
    state.controllers.set(task.id, controller);

    let lastError = null;

    try {
        await updateTask(task.id, { status: STATUS.DOWNLOADING });
        await updateHistory(task.id, { status: STATUS.DOWNLOADING, error: null });

        let payload = task.payload || {};
        let meta = payload.meta;

        // 1. Метаданные могли не прийти пакетом — дотягиваем поштучно
        if (!meta) {
            const got = await resolveMeta(task.payload?.tabId, task.trackId);
            if (got) {
                meta = slimMeta(got);
                payload = { ...payload, meta };
            }
        }

        // 2. Прямой URL стрима. Переиспользуем сохранённый (без повторного парсинга),
        //    при 403/410 перевыпускаем только его.
        let streamUrl = payload.streamUrl || null;

        const onProgress = throttleProgress(task.id);

        if (!streamUrl) {
            streamUrl = await resolveStream(task.payload?.tabId, task.trackId, settings);
        }
        if (!streamUrl) throw new Error('Не удалось получить ссылку на стрим');

        payload = { ...payload, streamUrl };
        // Фиксируем URL в задаче: после выгрузки SW докачка продолжится без
        // повторного выпуска подписи, если ссылка ещё жива.
        await updateTask(task.id, { payload });

        const result = await processTrack({
            historyId: task.id,
            streamUrl,
            filename: payload.filename,
            meta: buildId3Meta(meta, task.trackId, payload),
            settings,
            onProgress,
            signal: controller.signal,
        });

        await updateHistory(task.id, {
            status: STATUS.DONE,
            progress: 100,
            streamUrl,
            error: null,
            warning: result.warning || null,
        });

        await finishTask(task, STATUS.DONE);
        emit('done', { id: task.id, trackId: task.trackId, filename: payload.filename });
        return;
    } catch (e) {
        lastError = e;

        // URL протух — сбрасываем сохранённый, чтобы следующая попытка перевыпустила его
        if (/403|410|Expired|TIMEOUT/i.test(String(e?.message || ''))) {
            const cur = await getTask(task.id);
            if (cur?.payload?.streamUrl) {
                await updateTask(task.id, { payload: { ...cur.payload, streamUrl: null } });
            }
        }
    } finally {
        state.controllers.delete(task.id);
        // Никаких «догоняющих» обновлений прогресса после финального статуса
        flushProgress(task.id);
    }

    /* ---- обработка ошибки с exponential backoff ---- */
    const attempts = (task.attempts || 0) + 1;
    const maxAttempts = state.maxAttempts;
    const aborted = controller.signal.aborted;

    if (aborted) {
        if (cancelled.delete(task.id)) {
            emit('cancelled', { id: task.id });
            return;
        }
        // Если задачу уже отменили/очистили (cancelTask/stopAll), не перетираем
        // финальный статус истории «паузой».
        const still = await getTask(task.id);
        if (!still) {
            emit('cancelled', { id: task.id });
            return;
        }
        await updateTask(task.id, { status: STATUS.PAUSED, error: 'остановлено' });
        await updateHistory(task.id, { status: STATUS.PAUSED, error: 'остановлено пользователем' });
        emit('paused', { id: task.id });
        return;
    }

    if (attempts < maxAttempts) {
        const delay = backoffDelay(attempts - 1, QUEUE.BACKOFF_BASE_MS, QUEUE.BACKOFF_MAX_MS);
        await updateTask(task.id, {
            status: STATUS.QUEUED,
            attempts,
            nextAttemptAt: Date.now() + delay,
            error: String(lastError?.message || lastError),
        });
        // Чанки сохраняем — следующая попытка продолжит с байта обрыва
        await updateHistory(task.id, {
            status: STATUS.QUEUED,
            attempts,
            error: `повтор через ${Math.round(delay / 1000)} c: ${lastError?.message || lastError}`,
        });
        emit('retry', { id: task.id, attempts, delay });
        setTimeout(() => schedulePump(), delay);
        return;
    }

    await updateTask(task.id, {
        status: STATUS.ERROR,
        attempts,
        error: String(lastError?.message || lastError),
    });
    await updateHistory(task.id, {
        status: STATUS.ERROR,
        attempts,
        error: String(lastError?.message || lastError),
    });
    await finishTask(task, STATUS.ERROR);
    emit('error', { id: task.id, trackId: task.trackId, message: String(lastError?.message || lastError) });
}

/** Данные для ID3 из мета + контекста партии. */
function buildId3Meta(meta, trackId, payload) {
    const m = meta || {};
    return {
        trackId: String(trackId),
        title: m.title || 'Unknown',
        artists: m.artists ? joinArtists(m.artists) : 'Unknown Artist',
        album: m.album || m.title || 'Unknown',
        year: m.year || null,
        genre: m.genre || 'Unknown',
        coverUri: m.coverUri || '',
        trackNumber: m.trackNumber || 1,
        trackTotal: m.trackTotal || 1,
        discNumber: m.discNumber || 1,
        discTotal: m.discTotal || 1,
    };
}

/** Снять задачу с учёта и обновить бейдж. */
async function finishTask(task, finalStatus) {
    // Ошибочные задачи оставляем в очереди: так работает «Повторить все» и
    // повтор конкретного трека без пересоздания записи.
    if (finalStatus !== STATUS.ERROR) {
        await removeTask(task.id);
    }

    const remaining = await listTasks({ batchId: task.batchId });
    const notDone = remaining.filter(
        (t) => t.status !== STATUS.DONE && t.status !== STATUS.SKIPPED && t.status !== STATUS.ERROR
    );

    if (notDone.length === 0) {
        badge.closeBatch(task.batchId);
        emit('batch_done', { batchId: task.batchId });
    } else {
        badge.setBatch(task.batchId, notDone.length);
    }

    await pruneHistory();
}

/* -------------------------------------------------------------------------- */
/* Разрешение данных через вкладку ( delegating к parser.js в MAIN world)      */
/* -------------------------------------------------------------------------- */

async function resolveMeta(tabId, trackId) {
    if (!resolvers?.meta) return null;
    try {
        const rows = await resolvers.meta(tabId, [trackId]);
        return rows?.[0] || null;
    } catch {
        return null;
    }
}

async function resolveStream(tabId, trackId, settings) {
    if (!resolvers?.stream) return null;
    try {
        const info = await resolvers.stream(tabId, trackId, settings?.audioQuality);
        return info?.streamUrl || null;
    } catch (e) {
        warn('resolveStream failed:', e?.message);
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/* КОМАНДЫ UI                                                                 */
/* -------------------------------------------------------------------------- */

/** Повторить конкретную задачу (или запись истории, если задача уже удалена). */
export async function retry(id) {
    const task = await getTask(id);

    if (task) {
        await updateTask(id, { status: STATUS.QUEUED, attempts: 0, nextAttemptAt: 0, error: null });
        await updateHistory(id, { status: STATUS.QUEUED, error: null, progress: 0 });
        if (task.batchId) badge.openBatch(task.batchId, 1);
        schedulePump();
        emit('requeued', { id });
        return { ok: true, mode: 'task' };
    }

    // Задачи уже нет (готово/ошибка) — пересоздаём из истории, streamUrl сохраняется
    const hist = await getHistory(id);
    if (!hist) return { ok: false, reason: 'not_found' };

    const newId = uid('q');
    const batchId = uid('b');

    await addHistory({
        ...hist,
        id: newId,
        batchId,
        status: STATUS.QUEUED,
        progress: 0,
        error: null,
        warning: null,
        attempts: 0,
        createdAt: Date.now(),
        finishedAt: null,
    });

    await enqueueTasks([{
        id: newId,
        batchId,
        trackId: hist.trackId,
        position: 0,
        status: STATUS.QUEUED,
        payload: {
            tabId: hist.tabId ?? null,
            filename: hist.filename,
            pageType: hist.pageType,
            playlistName: hist.playlistName,
            meta: hist.meta || null,
            // Сохранённый streamUrl даёт повтор без повторного парсинга плейлиста
            streamUrl: hist.streamUrl || null,
        },
    }]);

    badge.openBatch(batchId, 1);
    schedulePump();
    emit('requeued_from_history', { id: newId, from: id });
    return { ok: true, mode: 'history', newId };
}

/** Повторить все ошибочные. */
export async function retryAll() {
    const rows = await listTasks();
    const errors = rows.filter((t) => t.status === STATUS.ERROR);
    for (const t of errors) {
        await updateTask(t.id, { status: STATUS.QUEUED, attempts: 0, nextAttemptAt: 0, error: null });
        await updateHistory(t.id, { status: STATUS.QUEUED, error: null });
        if (t.batchId) badge.openBatch(t.batchId, 1);
    }
    if (errors.length) schedulePump();
    emit('retry_all', { count: errors.length });
    return errors.length;
}

/** Поставить конкретную задачу на паузу (чанки остаются → докачка). */
export async function pauseTask(id) {
    state.controllers.get(id)?.abort();
    flushProgress(id);
    await updateTask(id, { status: STATUS.PAUSED });
    await updateHistory(id, { status: STATUS.PAUSED, error: 'пауза' });
    emit('paused', { id });
    return true;
}

/** Снять с паузы — продолжит с сохранённых чанков. */
export async function resumeTask(id) {
    await updateTask(id, { status: STATUS.QUEUED, nextAttemptAt: 0, attempts: 0 });
    await updateHistory(id, { status: STATUS.QUEUED, error: null });
    schedulePump();
    emit('resumed', { id });
    return true;
}

/** Отменить задачу и выбросить её чанки. */
export async function cancelTask(id) {
    cancelled.add(id);
    state.controllers.get(id)?.abort();
    flushProgress(id);

    const task = await getTask(id);
    await removeTask(id);
    await updateHistory(id, { status: STATUS.SKIPPED, error: 'отменено' });
    await deleteChunks(id);
    if (task) await finishTask(task, STATUS.SKIPPED);
    cancelled.delete(id);
    emit('cancelled', { id });
    return true;
}

/** Общая пауза/продолжение очереди. */
export async function setPaused(paused) {
    state.paused = !!paused;
    if (state.paused) {
        for (const [id, c] of state.controllers) {
            c.abort();
            flushProgress(id);
        }
    } else {
        // Глобальная пауза переводит активные задачи в PAUSED — возвращаем их в очередь
        const rows = await listTasks({ status: STATUS.PAUSED });
        for (const t of rows) {
            await updateTask(t.id, { status: STATUS.QUEUED, attempts: 0, nextAttemptAt: 0 });
            await updateHistory(t.id, { status: STATUS.QUEUED, error: null });
        }
        schedulePump();
    }
    emit('global_pause', { paused: state.paused });
    return state.paused;
}

/** Остановить всё и очистить очередь. */
export async function stopAll() {
    state.paused = true;
    for (const [id, c] of state.controllers) {
        cancelled.add(id);
        c.abort();
        flushProgress(id);
    }
    cancelAllWaiters('stopped');
    const rows = await listTasks();
    await removeTasks(rows.map((r) => r.id));
    for (const r of rows) {
        await updateHistory(r.id, { status: STATUS.PAUSED, error: 'остановлено пользователем' });
    }
    for (const b of new Set(rows.map((r) => r.batchId))) badge.closeBatch(b);
    state.running.clear();
    badge.reset();
    cancelled.clear();
    emit('stopped', {});
    state.paused = false;
    return rows.length;
}

/* -------------------------------------------------------------------------- */
/* ВОССТАНОВЛЕНИЕ ПОСЛЕ СНА SW                                                */
/* -------------------------------------------------------------------------- */

/**
 * Вызывается на onStartup / onInstalled / по alarm.
 * Задачи, зависшие в «downloading» (SW умер посреди загрузки), возвращаем в очередь:
 * скачанные чанки сохранены, поэтому продолжим с байта обрыва.
 */
export async function restore() {
    const rows = await listTasks();
    let revived = 0;

    for (const t of rows) {
        if (t.status === STATUS.DOWNLOADING || t.status === STATUS.TAGGING || t.status === STATUS.SAVING) {
            await updateTask(t.id, { status: STATUS.QUEUED, nextAttemptAt: 0 });
            await updateHistory(t.id, { status: STATUS.QUEUED, error: 'продолжаю после перезапуска' });
            revived++;
        }
    }

    badge.restore(rows);

    if (rows.some((t) => t.status === STATUS.QUEUED)) {
        schedulePump();
    }

    if (revived) emit('restored', { revived, total: rows.length });
    return { revived, total: rows.length };
}

/** Сводка для UI. */
export async function stats() {
    const rows = await listTasks();
    const now = Date.now();
    return {
        queued: rows.filter((t) => t.status === STATUS.QUEUED).length,
        active: state.running.size,
        waiting: rows.filter((t) => t.status === STATUS.QUEUED && t.nextAttemptAt > now).length,
        errors: rows.filter((t) => t.status === STATUS.ERROR).length,
        paused: state.paused,
        concurrency: state.concurrency,
        total: rows.length,
    };
}

export { state as _queueState };
