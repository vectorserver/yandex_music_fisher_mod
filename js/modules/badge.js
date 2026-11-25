/**
 * Yandex Music Fisher mod by vectorserver
 * badge.js — счётчик активных загрузок на иконке расширения.
 *
 * Отличие от prod: пул цветов больше не растёт бесконечно (в prod usedColors
 * сбрасывался только при полном исчерпании, а цвет закреплялся за партией
 * загрузок и утекал при длинной серии). Здесь цвета выдаются по свободным
 * «слотам» и освобождаются вместе с задачей.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { BADGE_COLORS, STATUS } from './constants.js';

/** Активные партии: batchId -> { color, count } */
const batches = new Map();

/** Все цвета заняты? (обычно параллельных партий не больше 8) */
function freeColor() {
    const used = new Set([...batches.values()].map((b) => b.color));
    return BADGE_COLORS.find((c) => !used.has(c)) || BADGE_COLORS[batches.size % BADGE_COLORS.length];
}

let lastText = '';
let lastColor = '';

/** Отрисовать итог по всем активным партиям. */
function paint() {
    let total = 0;
    let color = BADGE_COLORS[0];

    for (const b of batches.values()) {
        total += b.count;
        color = b.color;
    }

    const text = total > 0 ? String(total > 999 ? '999+' : total) : '';

    // Не дёргаем API без изменения — setBadgeText вызывается на каждый прогресс
    if (text !== lastText) {
        lastText = text;
        chrome.action.setBadgeText({ text }).catch?.(() => {});
    }
    if (total > 0 && color !== lastColor) {
        lastColor = color;
        chrome.action.setBadgeBackgroundColor({ color }).catch?.(() => {});
    }
}

export const badge = {
    /** Зарегистрировать партию из `count` задач. Возвращает цвет партии. */
    openBatch(batchId, count) {
        const existing = batches.get(batchId);
        if (existing) {
            existing.count += count;
        } else {
            batches.set(batchId, { color: freeColor(), count });
        }
        paint();
        return batches.get(batchId).color;
    },

    /** Изменить остаток партии (по мере завершения задач). */
    setBatch(batchId, count) {
        const b = batches.get(batchId);
        if (!b) return;
        b.count = Math.max(0, count);
        if (b.count === 0) batches.delete(batchId);
        paint();
    },

    /** Закрыть партию целиком (завершена/отменена). */
    closeBatch(batchId) {
        if (batches.delete(batchId)) paint();
    },

    /** Принудительно сбросить (например, на startup или при остановке очереди). */
    reset() {
        batches.clear();
        lastText = '0'; // заставляем repaint выполнить
        paint();
    },

    /** Служебная установка без учёта партий. */
    setRaw(text, color = '#FF5733') {
        chrome.action.setBadgeText({ text: String(text || '') }).catch?.(() => {});
        if (text) chrome.action.setBadgeBackgroundColor({ color }).catch?.(() => {});
    },

    /** Сколько задач сейчас «на счету» бейджа. */
    total() {
        let n = 0;
        for (const b of batches.values()) n += b.count;
        return n;
    },

    /**
     * Восстановить бейдж из состояния очереди после выгрузки/перезапуска SW.
     * @param {Array<{batchId: string, status: string}>} tasks
     */
    restore(tasks = []) {
        batches.clear();
        for (const t of tasks) {
            if (t.status === STATUS.DONE || t.status === STATUS.SKIPPED || t.status === STATUS.ERROR) continue;
            const b = batches.get(t.batchId) || { color: freeColor(), count: 0 };
            b.count += 1;
            batches.set(t.batchId, b);
        }
        paint();
    },
};

export default badge;
