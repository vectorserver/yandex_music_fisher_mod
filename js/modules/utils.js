/**
 * Yandex Music Fisher mod by vectorserver
 * utils.js — чистые функции-помощники: пути, имена файлов, таймауты, форматирование.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { LOG_PREFIX } from './constants.js';

/** Лог с единым префиксом. */
export const log = (...args) => console.log(LOG_PREFIX, ...args);
export const warn = (...args) => console.warn(LOG_PREFIX, ...args);
export const error = (...args) => console.error(LOG_PREFIX, ...args);

/** Промис-задержка. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Уникальный id задачи/записи. */
export const uid = (prefix = 't') =>
    `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/**
 * Превращает произвольный текст в безопасный сегмент пути.
 * В отличие от prod-версии: сохраняет '/', режет управляющие коды,
 * запрещённые в Windows/macOS символы, зарезервированные имена и пробелы на концах.
 */
export function sanitizePath(text, fallback = 'unnamed') {
    if (!text) return fallback;

    let out = String(text)
        // управляющие символы и BOM
        .replace(/[\u0000-\u001F\u007F-\u009F\uFEFF]/g, '')
        // запрещённые символы (кроме слэша) → подчёркивание
        .replace(/[\\:*?"<>|]/g, '_')
        // последовательности слэшей → один
        .replace(/\/+/g, '/')
        // точки только из символов «.» превращаем в _ (Windows не любит "..", "con.")
        .replace(/(^|\/)\.+(?=\/|$)/g, '$1_')
        .trim();

    // Windows: зарезервированные базовые имена
    out = out
        .split('/')
        .map((seg) => seg.replace(/\.+$/, ''))
        .map((seg) => (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(seg.split('.')[0]) ? `_${seg}` : seg))
        .join('/');

    // Ограничение длины сегмента (255) и общей длины пути
    out = out
        .split('/')
        .map((s) => s.slice(0, 120))
        .join('/')
        .slice(0, 200);

    out = out.replace(/^\/+|\/+$/g, '');
    return out || fallback;
}

/** Одинарный сегмент (без слэшей) — для имён файлов. */
export function sanitizeSegment(text, fallback = 'track', max = 150) {
    return sanitizePath(text, fallback).replace(/\//g, '_').slice(0, max);
}

/**
 * Подставляет переменные вида %genre% в шаблон папки.
 * @param {string} template  шаблон, напр. "music/%genre%/%year%/%artist%/%album%"
 * @param {Object} vars      словарь значений
 * @returns {string} очищенный путь без завершающего слэша
 */
export function applyTemplate(template, vars) {
    let out = String(template || '');

    for (const [key, value] of Object.entries(vars || {})) {
        const token = `%${key}%`;
        if (!out.includes(token)) continue;
        const clean = sanitizePath(String(value ?? ''), 'Unknown').replace(/\//g, '_');
        out = out.split(token).join(clean);
    }

    // Остатки неизвестных переменных вычищаем, чтобы не создавать папку "%foo%"
    out = out.replace(/%[a-z_]+%/gi, 'Unknown');

    return sanitizePath(out, 'music');
}

/**
 * Собирает полное имя файла для chrome.downloads.
 * @returns {{filename: string, folder: string, base: string}}
 */
export function buildTrackFilename({ folder, artists, title, trackIndex, numbering, extension = 'mp3' }) {
    const safeTitle = sanitizeSegment(title, 'track', 90);
    const safeArtists = sanitizeSegment(artists, 'Unknown Artist', 90);
    const prefix = numbering && trackIndex ? `${String(trackIndex).padStart(2, '0')}. ` : '';
    const ext = String(extension || 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3';
    const base = `${prefix}${safeArtists} - ${safeTitle}.${ext}`;
    const cleanFolder = sanitizePath(folder, 'music');
    return { filename: `${cleanFolder}/${base}`, folder: cleanFolder, base };
}

/** Есть ли в шаблоне переменные (%x%). */
export const hasTemplateVars = (str) => /%[a-zA-Z_]+%/.test(String(str || ''));

/* -------------------------------------------------------------------------- */
/* Сеть                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Оборачивает промис в таймаут. Работает и для fetch (через AbortController снаружи).
 * @template T
 */
export function withTimeout(promise, ms, message = 'Timeout') {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * fetch с таймаутом и поддержкой AbortSignal.
 * Бросает Error с понятным кодом при network/HTTP проблемах.
 */
export async function fetchSafe(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) {
            throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, response: res });
        }
        return res;
    } catch (e) {
        if (e.name === 'AbortError') throw new Error(`TIMEOUT: ${url}`);
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Exponential backoff с джиттером.
 * @param {number} attempt  номер попытки (0-based)
 */
export function backoffDelay(attempt, base = 1000, max = 60000) {
    const exp = base * Math.pow(2, clamp(attempt, 0, 6));
    const jitter = exp * 0.25 * Math.random();
    return Math.min(exp + jitter, max);
}

/* -------------------------------------------------------------------------- */
/* Форматирование                                                             */
/* -------------------------------------------------------------------------- */

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
    const units = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Относительная дата для компактных карточек истории. */
export function formatRelative(ts) {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'только что';
    if (min < 60) return `${min} мин назад`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} ч назад`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d} дн назад`;
    return formatDate(ts).split(' ')[0];
}

/** Дата истечения OAuth-токена по expires_in (сек). */
export function tokenExpiryLabel(tokenData) {
    if (!tokenData?.expires_in) return 'нет данных';
    const exp = new Date(Date.now() + tokenData.expires_in * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(exp.getDate())}.${p(exp.getMonth() + 1)}.${exp.getFullYear()}`;
}

/* -------------------------------------------------------------------------- */
/* Прочее                                                                     */
/* -------------------------------------------------------------------------- */

/** Безопасный JSON.parse: null вместо исключения. */
export function safeJson(text, fallback = null) {
    if (text === null || text === undefined) return fallback;
    if (typeof text === 'object') return text;
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

/** Debounce для «горячих» обработчиков (storage, input). */
export function debounce(fn, wait = 250) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

/** Разбор строки coverUri Яндекс.Музыки в абсолютный URL с размером. */
export function coverUrl(coverUri, size = 600) {
    if (!coverUri) return '';
    const qq = `${size}x${size}`;
    const path = String(coverUri).replace(/%%/g, qq);
    return path.startsWith('http') ? path : `https://${path}`;
}

/** Нормализация списка артистов объекта трека → строка. */
export function joinArtists(artists) {
    if (!Array.isArray(artists)) return 'Unknown Artist';
    const names = artists.map((a) => a?.name).filter(Boolean);
    return names.join(', ') || 'Unknown Artist';
}
