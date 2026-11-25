/**
 * Yandex Music Fisher mod by vectorserver
 * service_worker.js — ESM entry-point расширения v3 (Manifest V3).
 *
 * Ответственности:
 *  - роутер сообщений popup / options / content.js;
 *  - мост к parser.js в MAIN world (метаданные треков и прямой stream URL);
 *  - запуск и восстановление очереди после выгрузки service worker;
 *  - единый слушатель chrome.downloads.onChanged (без накопления подписок);
 *  - keepalive через chrome.alarms, пока очередь не пуста.
 *
 * Попытка сети, ID3 и запись файлов живут ЗДЕСЬ, а не в popup — UI не блокируется.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { BRAND, LOG_PREFIX, STORAGE_KEYS, QUEUE, APP_VERSION_FALLBACK, STATUS } from './modules/constants.js';
import { log, warn, error as logError } from './modules/utils.js';
import {
    getSettings, saveSettings, setRaw, filterSnapshot,
    resolveMusicTab, setTabId, invalidateSettingsCache,
} from './modules/storage.js';
import {
    setResolvers, enqueue, pump, restore, retry, retryAll,
    pauseTask, resumeTask, cancelTask, setPaused, stopAll, stats,
} from './modules/downloadQueue.js';
import { handleDownloadsChanged } from './modules/downloader.js';
import {
    deleteHistory, clearHistory, wipeAll, estimateUsage, listHistory,
    listTasks, removeTasks,
} from './modules/historyDB.js';

log(`${BRAND} — service worker v3`);

/* -------------------------------------------------------------------------- */
/* Мост в MAIN world: parser.js                                               */
/* -------------------------------------------------------------------------- */

/** Инжектировать parser.js в MAIN world и инициализировать его. */
async function injectParser(tabId) {
    await chrome.scripting.executeScript({
        target: { tabId },
        files: ['js/parser.js'],
        world: 'MAIN',
    });
    // parser.js сам инициализируется на DOMContentLoaded, но при повторной
    // инъекции после SPA-перехода вызовём init идемпотентно.
    await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
            try {
                window.appYa?.init?.();
                return true;
            } catch (e) {
                return String(e?.message || e);
            }
        },
    });
}

/**
 * Выполнить операцию parser.js в MAIN world.
 * При отсутствии parser — инжектировать и повторить один раз.
 *
 * @param {number} tabId
 * @param {'tracks'|'stream'|'credits'|'ping'|'page'} op
 * @param {object} payload
 */
async function execInPage(tabId, op, payload = {}) {
    if (!tabId) {
        const tab = await resolveMusicTab();
        if (!tab?.id) throw new Error('Нет активной вкладки Яндекс.Музыки');
        tabId = tab.id;
    }

    const run = async (targetId) => {
        const results = await chrome.scripting.executeScript({
            target: { tabId: targetId },
            world: 'MAIN',
            func: (a) => {
                try {
                    if (!window.appYa || typeof window.appYa.handleOp !== 'function') {
                        return { __noParser: true };
                    }
                    return window.appYa.handleOp(a.op, a.payload);
                } catch (e) {
                    return { __error: String(e?.message || e) };
                }
            },
            args: [{ op, payload }],
        });
        return results?.[0]?.result;
    };

    let result;
    try {
        result = await run(tabId);
    } catch (e) {
        // Вкладка могла быть закрыта/перезагружена — пробуем актуальную вкладку музыки
        const tab = await resolveMusicTab();
        if (!tab?.id || tab.id === tabId) {
            throw new Error(`Нет доступа к вкладке: ${e?.message || e}`);
        }
        tabId = tab.id;
        result = await run(tabId);
    }

    if (result && result.__noParser) {
        await injectParser(tabId);
        result = await run(tabId);
    }

    if (result && result.__error) throw new Error(result.__error);
    if (result && result.__noParser) throw new Error('parser.js не инициализировался на странице');
    return result;
}

/** Резолверы, которые downloadQueue использует для метаданных и stream URL. */
setResolvers({
    meta: async (tabId, trackIds) => {
        const rows = await execInPage(tabId, 'tracks', { trackIds });
        return Array.isArray(rows) ? rows : [];
    },
    stream: async (tabId, trackId, quality) => {
        const info = await execInPage(tabId, 'stream', { trackId, quality });
        return info?.streamUrl ? info : null;
    },
});

/** Вкладка музыки: сохранённая или активная. */
async function requireMusicTab(tabId = null) {
    if (tabId) return tabId;
    const tab = await resolveMusicTab();
    if (!tab?.id) throw new Error('Откройте вкладку music.yandex.ru и включите трек');
    return tab.id;
}

/* -------------------------------------------------------------------------- */
/* Keepalive очереди                                                          */
/* -------------------------------------------------------------------------- */

async function ensureKeepalive(active) {
    try {
        if (active) {
            await chrome.alarms.create(QUEUE.ALARM_KEEPALIVE, {
                periodInMinutes: QUEUE.KEEPALIVE_PERIOD_MIN,
            });
        } else {
            await chrome.alarms.clear(QUEUE.ALARM_KEEPALIVE);
        }
    } catch (e) {
        warn('alarms:', e?.message);
    }
}

/* -------------------------------------------------------------------------- */
/* Обработчики сообщений                                                      */
/* -------------------------------------------------------------------------- */

/** @returns {Promise<object>} */
async function handleMessage(message, sender) {
    const type = String(message?.type || '');
    const payload = message?.payload || {};

    switch (type) {
        /* ---- мост страницы ---- */
        case 'parser:ensure': {
            const tabId = message.tabId || sender?.tab?.id;
            if (!tabId) return { ok: false, error: 'no tab' };
            await injectParser(tabId);
            await setTabId(tabId);
            return { ok: true, tabId };
        }

        case 'page:sync': {
            const filtered = filterSnapshot(payload.data || {});
            await setRaw(STORAGE_KEYS.DB, filtered);
            if (sender?.tab?.id) await setTabId(sender.tab.id);
            return { ok: true, keys: Object.keys(filtered) };
        }

        case 'page:tab': {
            const tabId = sender?.tab?.id || payload.tabId;
            if (tabId) await setTabId(tabId);
            return { ok: true, tabId: tabId || null };
        }

        /* ---- очередь ---- */
        case 'queue:enqueue': {
            const settings = await getSettings();
            const tabId = await requireMusicTab(payload.tabId || sender?.tab?.id);
            const trackIds = payload.trackIds || (payload.trackId ? [payload.trackId] : []);
            if (!trackIds.length) return { ok: false, error: 'no trackIds' };

            const result = await enqueue({
                tabId,
                trackIds,
                playlistName: payload.playlistName || 'music',
                pageType: payload.pageType || 'track',
                settings,
            });
            await ensureKeepalive(true);
            return { ok: true, ...result };
        }

        case 'queue:retry':
            return { ok: true, result: await retry(payload.id) };

        case 'queue:pause':
            return { ok: await pauseTask(payload.id) };

        case 'queue:resume':
            return { ok: await resumeTask(payload.id) };

        case 'queue:cancel':
            return { ok: await cancelTask(payload.id) };

        case 'queue:retryAll': {
            const count = await retryAll();
            await ensureKeepalive(true);
            return { ok: true, count };
        }

        case 'queue:setPaused': {
            const paused = await setPaused(!!payload.paused);
            return { ok: true, paused };
        }

        case 'queue:stopAll': {
            const count = await stopAll();
            await ensureKeepalive(false);
            return { ok: true, count };
        }

        case 'queue:stats':
            return { ok: true, stats: await stats() };

        case 'queue:pump':
            await pump();
            return { ok: true, stats: await stats() };

        /* ---- история ---- */
        case 'history:list': {
            const list = await listHistory(payload);
            return { ok: true, ...list };
        }

        case 'history:delete': {
            // Если задача ещё в очереди — сначала отменяем её и чистим чанки
            await cancelTask(payload.id).catch(() => {});
            return { ok: await deleteHistory(payload.id) };
        }

        case 'history:clear': {
            const statuses = Array.isArray(payload.statuses) ? payload.statuses : null;
            const cleared = await clearHistory(statuses);

            // Синхронизируем очередь: завершённые/ошибочные задачи не должны
            // оставаться в ней после очистки истории.
            const stopStatuses = statuses || [STATUS.DONE, STATUS.ERROR, STATUS.SKIPPED];
            const rows = await listTasks();
            const ids = rows.filter((t) => stopStatuses.includes(t.status)).map((t) => t.id);
            if (ids.length) await removeTasks(ids);

            return { ok: cleared, removedTasks: ids.length };
        }

        case 'history:wipe': {
            const wipe = await wipeAll();
            invalidateSettingsCache();
            await ensureKeepalive(false);
            return { ok: wipe };
        }

        case 'history:usage':
            return { ok: true, usage: await estimateUsage() };

        /* ---- настройки / диагностика ---- */
        case 'settings:get':
            return { ok: true, settings: await getSettings({ force: !!payload.force }) };

        case 'settings:save': {
            const settings = await saveSettings(payload.settings || {});
            return { ok: true, settings };
        }

        case 'app:info': {
            const manifest = chrome.runtime.getManifest();
            return {
                ok: true,
                brand: BRAND,
                version: manifest.version || APP_VERSION_FALLBACK,
                logPrefix: LOG_PREFIX,
            };
        }

        case 'app:openOptions':
            chrome.runtime.openOptionsPage?.();
            return { ok: true };

        default:
            return { ok: false, error: `unknown message: ${type}` };
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
        .then((res) => sendResponse(res))
        .catch((e) => {
            logError(`message ${message?.type} failed:`, e?.message || e);
            sendResponse({ ok: false, error: String(e?.message || e) });
        });

    return true; // асинхронный ответ
});

/* -------------------------------------------------------------------------- */
/* Загрузки: единый слушатель на весь цикл жизни SW                           */
/* -------------------------------------------------------------------------- */

chrome.downloads.onChanged.addListener((delta) => {
    handleDownloadsChanged(delta);

    if (delta?.state?.current === 'complete') {
        // Настройка prod «Сохранять историю в менеджере загрузок»
        getSettings()
            .then((s) => {
                if (s.savehistory === '0') chrome.downloads.erase({ id: delta.id })?.catch?.(() => {});
            })
            .catch(() => {});
    }
});

/* -------------------------------------------------------------------------- */
/* Алармы и восстановление                                                    */
/* -------------------------------------------------------------------------- */

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== QUEUE.ALARM_KEEPALIVE) return;
    try {
        const s = await stats();
        if (s.queued + s.active > 0) {
            await pump();
        } else {
            await ensureKeepalive(false);
        }
    } catch (e) {
        warn('alarm keepalive:', e?.message);
    }
});

chrome.runtime.onStartup.addListener(() => {
    restore().catch((e) => warn('restore onStartup:', e?.message));
});

chrome.runtime.onInstalled.addListener(() => {
    restore().catch((e) => warn('restore onInstalled:', e?.message));
});

/* Восстановление при старте самого SW (в т.ч. после выгрузки по таймауту).
 * На этом этапе в памяти нет активных загрузок — «downloading» из БД заведомо
 * осиротевшие, их безопасно вернуть в очередь. */
restore()
    .then(async (r) => {
        log('restore:', r);
        const s = await stats().catch(() => ({ queued: 0, active: 0 }));
        if (s.queued + s.active > 0) ensureKeepalive(true);
    })
    .catch((e) => warn('restore on load:', e?.message));

/* Гарантируем, что интерфейс не получит необработанную ошибку при закрытии popup */
self.addEventListener?.('unhandledrejection', (e) => {
    warn('unhandled rejection:', e?.reason?.message || e?.reason);
});
