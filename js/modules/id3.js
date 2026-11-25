/**
 * Yandex Music Fisher mod by vectorserver
 * id3.js — запись ID3-тегов и подготовка байтов к сохранению.
 *
 * Оптимизации против prod-версии:
 *  1. Убрано лишнее копирование: `new Uint8Array(await r.arrayBuffer())` в prod
 *     создавало второй живой буфер; здесь работаем одним Uint8Array-view.
 *  2. Обложка сжимается/ресайзится через OffscreenCanvas, если она тяжелее
 *     лимита — иначе APIC раздувал файл на десятки мегабайт.
 *  3. Base64 собирается блоками: prod-выражение
 *     `btoa(String.fromCharCode(...bytes))` падало со «Maximum call stack size
 *     exceeded» на файлах больше ~1 МБ.
 *  4. Ссылки на ArrayBuffer/Bitmap явно обнуляются, canvas/OffscreenCanvas
 *     закрываются, Object URL отзываются вызывающей стороной (downloader.js).
 *
 * Кириллица: browser-id3-writer кодирует текстовые фреймы в UTF-16 (BOM +
 * little-endian), что корректно читается Яндекс.Музыкой, VLC и AIMP.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { ID3Writer } from '../vendor/id3-writer.mjs';
import { LOG_PREFIX } from './constants.js';
import { warn } from './utils.js';

/** Порог, выше который base64-сохранение считаем опасным для памяти. */
const DATA_URL_SOFT_LIMIT = 24 * 1024 * 1024;

/**
 * Ресайз/сжатие обложки. Возвращает Uint8Array JPEG (или исходные байты,
 * если сжатие не требуется либо браузер не потянул декодирование).
 *
 * @param {ArrayBuffer|Uint8Array} source  байты обложки
 * @param {{maxSide?: number, maxBytes?: number}} opts
 * @returns {Promise<{data: Uint8Array, mime: string, resized: boolean}>}
 */
export async function shrinkCover(source, opts = {}) {
    const { maxSide = 600, maxBytes = 250000 } = opts;

    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    const original = { data: bytes, mime: detectMime(bytes), resized: false };

    if (!bytes.byteLength) return original;
    // Уже вписываемся в лимиты — не трогаем (избегаем потерь качества)
    if (bytes.byteLength <= maxBytes) return original;

    let bitmap = null;
    let canvas = null;

    try {
        const blob = new Blob([bytes], { type: original.mime || 'image/jpeg' });
        bitmap = await createImageBitmap(blob);

        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));

        canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, w, h);

        // Подбираем качество, пока не уложимся в maxBytes
        let out = null;
        for (const q of [0.9, 0.82, 0.72, 0.6]) {
            const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: q });
            const buf = new Uint8Array(await outBlob.arrayBuffer());
            out = { data: buf, mime: 'image/jpeg', resized: true };
            if (buf.byteLength <= maxBytes) break;
        }

        return out || original;
    } catch (e) {
        warn(`${LOG_PREFIX} shrinkCover fallback:`, e?.message);
        return original;
    } finally {
        // Освобождаем нативные ресурсы как можно раньше
        try { bitmap?.close?.(); } catch { /* noop */ }
        try {
            if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
            }
        } catch { /* noop */ }
        bitmap = null;
        canvas = null;
    }
}

/** Определить MIME обложки по сигнатуре (нужен для APIC). */
function detectMime(bytes) {
    const b = bytes;
    if (b.length > 10 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50) return 'image/png';
    if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return 'image/jpeg';
}

/**
 * Записать ID3v2-теги в тело MP3.
 *
 * @param {Uint8Array} mp3Bytes   тело файла (без лишних копий)
 * @param {object} meta
 * @param {Uint8Array|null} coverBytes  уже сжатая обложка
 * @returns {Uint8Array} файл с тегами
 */
export function writeId3Tags(mp3Bytes, meta, coverBytes) {
    if (!mp3Bytes?.byteLength) throw new Error('Пустое тело аудиофайла');

    const writer = new ID3Writer(mp3Bytes);

    const title = String(meta.title || 'Unknown');
    const artists = String(meta.artists || 'Unknown Artist');
    const album = String(meta.album || title);
    const year = parseInt(meta.year, 10);
    const genres = (meta.genre ? String(meta.genre).split(',') : ['Unknown'])
        .map((g) => g.trim())
        .filter(Boolean);

    const trackNumber = meta.trackNumber ?? 1;
    const trackTotal = meta.trackTotal ?? 1;

    try {
        writer
            .setFrame('TIT2', title)
            .setFrame('TPE1', [artists])
            .setFrame('TPE2', [artists])            // Album Artist — группирует сборники
            .setFrame('TALB', album)
            .setFrame('TRCK', `${trackNumber}/${trackTotal}`)
            .setFrame('TPOS', `${meta.discNumber || 1}/${meta.discTotal || 1}`)
            .setFrame('TCON', genres);

        if (Number.isFinite(year) && year > 0) {
            writer.setFrame('TYER', year);
        }

        if (coverBytes?.byteLength) {
            writer.setFrame('APIC', {
                type: 3, // Cover (front)
                data: coverBytes,
                description: 'Cover (front)',
            });
        }

        // Служебная метка авторства (п.5 ТЗ — копирайт внутри файла)
        writer.setFrame('TXXX', {
            description: 'Source',
            value: 'Yandex Music Fisher mod by vectorserver',
        });

        writer.addTag();

        const result = new Uint8Array(writer.arrayBuffer);

        // Обнуляем ссылки, чтобы GC забрал исходный буфер
        writer.frames.length = 0;
        try { writer.arrayBuffer = null; } catch { /* noop */ }

        return result;
    } catch (e) {
        // ID3Writer бросает на неизвестном MIME картинки — повторяем без обложки
        warn('ID3 с обложкой не удался, пробую без неё:', e?.message);
        try {
            const retry = new ID3Writer(mp3Bytes);
            retry
                .setFrame('TIT2', title)
                .setFrame('TPE1', [artists])
                .setFrame('TALB', album)
                .setFrame('TRCK', `${trackNumber}/${trackTotal}`)
                .setFrame('TCON', genres);
            if (Number.isFinite(year) && year > 0) retry.setFrame('TYER', year);
            retry.addTag();
            const out = new Uint8Array(retry.arrayBuffer);
            retry.frames.length = 0;
            return out;
        } catch (e2) {
            warn('ID3 полностью не удался, отдаю оригинал:', e2?.message);
            return mp3Bytes;
        }
    }
}

/**
 * FLAC: есть ли в начале файла сигнатура fLaC.
 */
export function isFlac(bytes) {
    return !!bytes && bytes.length > 4 &&
        bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43;
}

/** Размеры JPEG/PNG для FLAC PICTURE (0,0 если не распознали). */
function imageSize(bytes) {
    if (!bytes || bytes.length < 24) return { width: 0, height: 0 };

    // PNG: IHDR width/height big-endian
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return {
            width: ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0,
            height: ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0,
        };
    }

    // JPEG: ищем SOF-маркер
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
        let i = 2;
        while (i + 9 < bytes.length) {
            if (bytes[i] !== 0xff) { i++; continue; }
            const marker = bytes[i + 1];
            i += 2;
            if (marker === 0xd8 || marker === 0xd9) continue;
            if (i + 2 > bytes.length) break;
            const length = (bytes[i] << 8) | bytes[i + 1];
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return {
                    height: (bytes[i + 3] << 8) | bytes[i + 4],
                    width: (bytes[i + 5] << 8) | bytes[i + 6],
                };
            }
            if (length < 2) break;
            i += length;
        }
    }
    return { width: 0, height: 0 };
}

/** Vorbis Comment (FLAC type 4). */
function buildVorbisComment(meta) {
    const enc = new TextEncoder();
    const vendor = enc.encode('Yandex Music Fisher mod by vectorserver');
    const fields = [];

    const add = (key, value) => {
        if (value === undefined || value === null) return;
        const s = String(value).trim();
        if (s) fields.push([key, s]);
    };

    add('TITLE', meta.title);
    add('ARTIST', meta.artists);
    add('ALBUM', meta.album);
    add('ALBUMARTIST', meta.artists);
    add('DATE', meta.year);
    if (meta.trackNumber) add('TRACKNUMBER', meta.trackNumber);
    if (meta.trackTotal) add('TRACKTOTAL', meta.trackTotal);
    if (meta.discNumber) add('DISCNUMBER', meta.discNumber);
    if (meta.discTotal) add('DISCTOTAL', meta.discTotal);
    add('GENRE', meta.genre);
    add('SOURCE', 'Yandex Music Fisher mod by vectorserver');

    const comments = fields
        .map(([k, v]) => enc.encode(`${k}=${v}`))
        .filter((c) => c.length > 0);

    const size = 4 + vendor.length + 4 + comments.reduce((acc, c) => acc + 4 + c.length, 0);
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    let pos = 0;

    dv.setUint32(pos, vendor.length, true); pos += 4;
    out.set(vendor, pos); pos += vendor.length;
    dv.setUint32(pos, comments.length, true); pos += 4;
    for (const c of comments) {
        dv.setUint32(pos, c.length, true); pos += 4;
        out.set(c, pos); pos += c.length;
    }
    return out;
}

/** FLAC Picture (type 6), type=3 (front cover). */
function buildPictureBlock(coverBytes) {
    const enc = new TextEncoder();
    const mimeBytes = enc.encode(detectMime(coverBytes));
    const { width, height } = imageSize(coverBytes);
    const size = 4 + 4 + mimeBytes.length + 4 + 4 + 4 + 4 + 4 + 4 + coverBytes.length;
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    let pos = 0;

    dv.setUint32(pos, 3); pos += 4; // front cover
    dv.setUint32(pos, mimeBytes.length); pos += 4;
    out.set(mimeBytes, pos); pos += mimeBytes.length;
    dv.setUint32(pos, 0); pos += 4; // empty description
    dv.setUint32(pos, width); pos += 4;
    dv.setUint32(pos, height); pos += 4;
    dv.setUint32(pos, 24); pos += 4; // depth
    dv.setUint32(pos, 0); pos += 4; // colors
    dv.setUint32(pos, coverBytes.length); pos += 4;
    out.set(coverBytes, pos);
    return out;
}

/**
 * Записать метаданные в FLAC (Vorbis Comment + Picture).
 * ID3 в FLAC многие плееры игнорируют — поэтому здесь нативный формат.
 *
 * @param {Uint8Array} flacBytes
 * @param {object} meta
 * @param {Uint8Array|null} coverBytes
 * @returns {Uint8Array}
 */
export function writeFlacTags(flacBytes, meta, coverBytes) {
    if (!isFlac(flacBytes)) throw new Error('Не FLAC-файл');

    const blocks = [];
    let pos = 4;
    let lastSeen = false;
    let guard = 0;

    while (pos + 4 <= flacBytes.length && guard++ < 256) {
        const header = flacBytes[pos];
        const type = header & 0x7f;
        const length = (flacBytes[pos + 1] << 16) | (flacBytes[pos + 2] << 8) | flacBytes[pos + 3];
        const start = pos + 4;
        const end = start + length;
        if (end > flacBytes.length) throw new Error('Повреждён FLAC (metadata block)');
        blocks.push({ type, data: flacBytes.subarray(start, end) });
        pos = end;
        if (header & 0x80) { lastSeen = true; break; }
    }

    if (!lastSeen) throw new Error('Повреждён FLAC (нет last-block)');
    if (!blocks.some((b) => b.type === 0)) throw new Error('Повреждён FLAC (нет STREAMINFO)');

    const audio = flacBytes.subarray(pos);
    const kept = blocks.filter((b) => b.type !== 4 && b.type !== 6);
    const extra = [{ type: 4, data: buildVorbisComment(meta) }];
    if (coverBytes?.byteLength) extra.push({ type: 6, data: buildPictureBlock(coverBytes) });

    const all = [...kept, ...extra];

    let total = 4 + audio.length;
    for (const b of all) total += 4 + b.data.length;

    const out = new Uint8Array(total);
    out.set([0x66, 0x4c, 0x61, 0x43], 0); // fLaC
    let p = 4;

    all.forEach((b, index) => {
        const isLast = index === all.length - 1;
        out[p++] = (b.type & 0x7f) | (isLast ? 0x80 : 0);
        out[p++] = (b.data.length >> 16) & 0xff;
        out[p++] = (b.data.length >> 8) & 0xff;
        out[p++] = b.data.length & 0xff;
        out.set(b.data, p);
        p += b.data.length;
    });

    out.set(audio, p);
    return out;
}

/** Универсальная запись тегов: FLAC → Vorbis Comment, иначе → ID3v2. */
export function writeAudioTags(bytes, meta, coverBytes) {
    if (isFlac(bytes)) {
        try {
            return writeFlacTags(bytes, meta, coverBytes);
        } catch (e) {
            warn('FLAC-теги не записались:', e?.message);
            return bytes;
        }
    }
    return writeId3Tags(bytes, meta, coverBytes);
}

/**
 * ArrayBuffer → data: URL поблочно (без переполнения стека).
 * Используется как единственный надёжный способ отдать готовый файл
 * в chrome.downloads.download из MV3: blob: URL этот API не принимает.
 */
export function bufferToDataUrl(bytes, mime = 'audio/mpeg') {
    const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const CHUNK = 0x8000; // 32 KiB на итерацию
    const parts = [];
    const len = bytes.length;

    for (let i = 0; i < len; i += CHUNK) {
        let str = '';
        const end = Math.min(i + CHUNK, len);
        for (let j = i; j < end; j += 3) {
            const b0 = bytes[j];
            const b1 = j + 1 < end ? bytes[j + 1] : undefined;
            const b2 = j + 2 < end ? bytes[j + 2] : undefined;

            str += BASE64_ALPHABET[b0 >> 2];
            str += b1 === undefined
                ? BASE64_ALPHABET[(b0 & 3) << 4]
                : BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
            str += b1 === undefined
                ? '='
                : b2 === undefined
                    ? BASE64_ALPHABET[(b1 & 15) << 2]
                    : BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)];
            str += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 63];
        }
        parts.push(str);
    }

    return `data:${mime};base64,${parts.join('')}`;
}

/** Стоит ли тащить файл через data URL, или безопаснее прямая загрузка. */
export function canUseDataUrl(byteLength, softLimit = DATA_URL_SOFT_LIMIT) {
    return byteLength > 0 && byteLength <= softLimit;
}

export { DATA_URL_SOFT_LIMIT };
