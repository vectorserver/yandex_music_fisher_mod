/**
 * Yandex Music Fisher mod by vectorserver
 * storage.js — промисифицированный доступ к chrome.storage.local + кэш настроек.
 *
 * Зачем кэш: service worker в MV3 читает настройки на каждый трек; in-memory кэш
 * снимает N обращений к storage, а подписка на storage.onChanged держит его валидным.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { DEFAULT_SETTINGS, STORAGE_KEYS, AUDIO_QUALITIES, COVER_SIZES, LOG_PREFIX } from './constants.js';
import { clamp, warn } from './utils.js';

/** in-memory кэш настроек (живёт, пока SW не выгружен). */
let settingsCache = null;
let listenersBound = false;

/** Минимизация/валидация пользовательских настроек. */
function normalize(raw = {}) {
    const s = { ...DEFAULT_SETTINGS, ...raw };

    s.downloadFolder = (typeof s.downloadFolder === 'string' && s.downloadFolder.trim())
        ? s.downloadFolder.trim().replace(/[/\\]+$/, '')
        : DEFAULT_SETTINGS.downloadFolder;

    if (!AUDIO_QUALITIES.includes(s.audioQuality)) s.audioQuality = DEFAULT_SETTINGS.audioQuality;

    // coverQuality в prod хранился как строка из <select> — приводим к числу
    s.coverQuality = COVER_SIZES.includes(Number(s.coverQuality))
        ? Number(s.coverQuality)
        : DEFAULT_SETTINGS.coverQuality;

    // Единовременная закачка (prod) и параллельность (v3) синхронизируются
    s.downlodadCount = clamp(parseInt(s.downlodadCount, 10) || DEFAULT_SETTINGS.downlodadCount, 1, 8);
    s.maxConcurrent = clamp(parseInt(s.maxConcurrent, 10) || s.downlodadCount, 1, 8);

    s.maxAttempts = clamp(parseInt(s.maxAttempts, 10) || DEFAULT_SETTINGS.maxAttempts, 1, 10);
    s.coverMaxBytes = clamp(parseInt(s.coverMaxBytes, 10) || DEFAULT_SETTINGS.coverMaxBytes, 50000, 2000000);

    s.savehistory = String(s.savehistory ?? '1');
    s.numberingTracks = !!s.numberingTracks;
    s.aiSuspicion = !!s.aiSuspicion;
    s.writeId3 = s.writeId3 !== false;
    s.resumeEnabled = s.resumeEnabled !== false;

    return s;
}

/** Подписка на внешние изменения настроек (один раз на жизнь SW). */
function bindChangeListeners() {
    if (listenersBound || typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    listenersBound = true;

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[STORAGE_KEYS.SETTINGS]) {
            settingsCache = normalize(changes[STORAGE_KEYS.SETTINGS].newValue || {});
        }
    });
}

/** Прочитать настройки (с кэшем). */
export async function getSettings({ force = false } = {}) {
    bindChangeListeners();

    if (settingsCache && !force) return settingsCache;

    try {
        const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
        settingsCache = normalize(data?.[STORAGE_KEYS.SETTINGS] || {});
    } catch (e) {
        warn('не удалось прочитать настройки, беру дефолт:', e?.message);
        settingsCache = normalize({});
    }
    return settingsCache;
}

/** Сохранить настройки целиком. */
export async function saveSettings(partial) {
    const next = normalize({ ...(await getSettings()), ...partial });
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
    settingsCache = next;
    return next;
}

/** Сброс кэша (после импорта/очистки). */
export function invalidateSettingsCache() {
    settingsCache = null;
}

/* -------------------------------------------------------------------------- */
/* Универсальные геттеры/сеттеры chrome.storage.local                         */
/* -------------------------------------------------------------------------- */

export async function getRaw(key) {
    try {
        const data = await chrome.storage.local.get(key);
        return data?.[key];
    } catch (e) {
        warn(`storage.get(${key}) failed:`, e?.message);
        return undefined;
    }
}

export async function setRaw(key, value) {
    try {
        await chrome.storage.local.set({ [key]: value });
        return true;
    } catch (e) {
        // Квота storage — частая проблема при больших aYa_db
        warn(`storage.set(${key}) failed:`, e?.message);
        return false;
    }
}

export async function removeRaw(...keys) {
    try {
        await chrome.storage.local.remove(keys);
        return true;
    } catch (e) {
        warn(`storage.remove failed:`, e?.message);
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/* Активная вкладка с музыкой                                                 */
/* -------------------------------------------------------------------------- */

export const getTabId = () => getRaw(STORAGE_KEYS.TAB_ID);
export const setTabId = (id) => setRaw(STORAGE_KEYS.TAB_ID, id);

/**
 * Найти живую вкладку с Яндекс.Музыкой.
 * Нужен потому, что сохранённый aYa_tabID протухает после закрытия/перезапуска браузера.
 */
export async function resolveMusicTab() {
    const saved = await getTabId();

    if (saved) {
        try {
            const tab = await chrome.tabs.get(saved);
            if (tab?.id && /music\.yandex\./.test(tab.url || '')) return tab;
        } catch {
            /* вкладки больше нет — ищем активную */
        }
    }

    try {
        // Не используем url-фильтр: шаблон music.yandex.* невалиден для tabs.query.
        const tabs = await chrome.tabs.query({ url: ['https://music.yandex.ru/*', 'https://music.yandex.com/*', 'https://music.yandex.kz/*', 'https://music.yandex.by/*', 'https://music.yandex.uz/*'] });
        const target = tabs.find((t) => t.active) || tabs[0];
        if (target?.id) {
            await setTabId(target.id);
            return target;
        }
    } catch {
        /* молча проходим дальше — вкладку найдём по сообщению от content.js */
    }

    return null;
}

/* -------------------------------------------------------------------------- */
/* Снапшот localStorage страницы (ключ aYa_db) + миграция из prod             */
/* -------------------------------------------------------------------------- */

/** Превращает «сырые» строки localStorage в типизированные значения. */
export function parseStorageSnapshot(data = {}) {
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
            try {
                out[key] = JSON.parse(value);
            } catch {
                out[key] = value;
            }
        } else {
            out[key] = value;
        }
    }
    return out;
}

/** Прочитать и распарсить снапшот страницы. */
export async function getPageSnapshot() {
    const raw = await getRaw(STORAGE_KEYS.DB);
    return parseStorageSnapshot(raw || {});
}

/**
 * Ключи, которые content.js синхронизирует из localStorage страницы.
 * Белый список экономит квоту storage (в prod писался весь localStorage целиком).
 */
export const SYNC_ALLOWLIST = [
    'aYa_token',
    'aYa_hosting',
    'aYa_page',
    'aYa_collection',
    'aYa_location',
    'aYa_cureitTrack',
    'aYa_authorizationUrl',
    'aYa_get-file-info',
];

/** Отфильтровать входящий снапшот до полезных ключей. */
export function filterSnapshot(data = {}) {
    const out = {};
    for (const key of SYNC_ALLOWLIST) {
        if (data[key] !== undefined) out[key] = data[key];
    }
    // Сервисные ключи страницы вида aYa_<folder> из monitorFetch не тащим в storage — они раздувают квоту.
    return out;
}

export { DEFAULT_SETTINGS, STORAGE_KEYS, LOG_PREFIX };
