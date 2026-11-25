/**
 * Yandex Music Fisher mod by vectorserver
 * options.js — настройки v3: пути, качество, ID3, докачка, ретраи, данные.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { STATUS, STORAGE_KEYS } from './modules/constants.js';
import { formatBytes } from './modules/utils.js';
import { getSettings, saveSettings } from './modules/storage.js';
import { clearHistory, wipeAll, estimateUsage } from './modules/historyDB.js';

const $ = (id) => document.getElementById(id);

const els = {
    form: $('settingsForm'),
    downloadFolder: $('downloadFolder'),
    coverResolution: $('coverResolution'),
    audioQuality: $('audioQuality'),
    maxConcurrent: $('maxConcurrent'),
    maxAttempts: $('maxAttempts'),
    coverMaxBytes: $('coverMaxBytes'),
    writeId3: $('writeId3'),
    resumeEnabled: $('resumeEnabled'),
    numberingTracks: $('numberingTracks'),
    savehistory: $('savehistory'),
    aiSuspicion: $('aiSuspicion'),
    trackExample: $('trackExample'),
    status: $('status'),
    clearHistoryBtn: $('clearHistoryBtn'),
    wipeBtn: $('wipeBtn'),
    usage: $('usage'),
};

const variableButtons = [...document.querySelectorAll('.btn-variable')];
const helperContainer = document.querySelector('.path-helper-btns');

let statusTimer = null;
function setStatus(text, kind = '') {
    els.status.textContent = text;
    els.status.className = kind;
    clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(() => { els.status.textContent = ''; }, 5000);
}

function updateExample() {
    els.trackExample.textContent = els.numberingTracks.checked
        ? '01. music_name.mp3'
        : 'music_name.mp3';
}

function updateButtonStates() {
    const value = els.downloadFolder.value;
    let hasActive = false;
    for (const button of variableButtons) {
        const variable = button.dataset.var;
        const active = value.includes(variable);
        button.classList.toggle('active', active);
        if (active) hasActive = true;
    }
    helperContainer?.classList.toggle('has-active', hasActive);
}

function fillForm(settings) {
    els.downloadFolder.value = settings.downloadFolder || 'music/';
    els.coverResolution.value = String(settings.coverQuality || 600);
    els.audioQuality.value = settings.audioQuality || 'lossless';
    els.maxConcurrent.value = String(settings.maxConcurrent || 2);
    els.maxAttempts.value = String(settings.maxAttempts || 4);
    els.coverMaxBytes.value = String(settings.coverMaxBytes || 250000);
    els.writeId3.checked = settings.writeId3 !== false;
    els.resumeEnabled.checked = settings.resumeEnabled !== false;
    els.numberingTracks.checked = !!settings.numberingTracks;
    els.savehistory.value = String(settings.savehistory ?? '1');
    els.aiSuspicion.checked = !!settings.aiSuspicion;
    updateExample();
    updateButtonStates();
}

async function refreshUsage() {
    try {
        const usage = await estimateUsage();
        const used = usage?.usage || 0;
        const quota = usage?.quota || 0;
        els.usage.textContent = quota
            ? `Занято: ${formatBytes(used)} из ${formatBytes(quota)}`
            : `Занято: ${formatBytes(used)}`;
    } catch {
        els.usage.textContent = 'Занято: —';
    }
}

function sendRuntime(message) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) resolve(null);
                else resolve(response ?? null);
            });
        } catch {
            resolve(null);
        }
    });
}

function bindForm() {
    variableButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const variable = button.dataset.var;
            let value = els.downloadFolder.value;

            if (value.includes(variable)) {
                els.downloadFolder.focus();
                return;
            }
            if (value && !value.endsWith('/')) value += '/';
            els.downloadFolder.value = `${value}${variable}/`;
            updateButtonStates();
            els.downloadFolder.focus();
        });
    });

    els.downloadFolder.addEventListener('input', updateButtonStates);
    els.numberingTracks.addEventListener('change', updateExample);

    els.form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const maxConcurrent = parseInt(els.maxConcurrent.value, 10) || 2;
        const patch = {
            downloadFolder: els.downloadFolder.value.trim() || 'music/',
            coverQuality: parseInt(els.coverResolution.value, 10) || 600,
            audioQuality: els.audioQuality.value || 'lossless',
            // downlodadCount оставлен для совместимости со старыми настройками v2
            downlodadCount: maxConcurrent,
            maxConcurrent,
            maxAttempts: parseInt(els.maxAttempts.value, 10) || 4,
            coverMaxBytes: parseInt(els.coverMaxBytes.value, 10) || 250000,
            writeId3: els.writeId3.checked,
            resumeEnabled: els.resumeEnabled.checked,
            numberingTracks: els.numberingTracks.checked,
            savehistory: els.savehistory.value || '1',
            aiSuspicion: els.aiSuspicion.checked,
        };

        try {
            const saved = await saveSettings(patch);
            fillForm(saved);
            setStatus('Настройки сохранены', 'ok');
        } catch (e) {
            setStatus(`Не удалось сохранить: ${e?.message || e}`, 'err');
        }
        refreshUsage();
    });
}

function bindDataActions() {
    els.clearHistoryBtn.addEventListener('click', async () => {
        if (!confirm('Очистить завершённые и ошибочные записи истории?')) return;
        try {
            await clearHistory([STATUS.DONE, STATUS.ERROR, STATUS.SKIPPED]);
            setStatus('Завершённая история очищена', 'ok');
        } catch (e) {
            setStatus(`Ошибка очистки: ${e?.message || e}`, 'err');
        }
        refreshUsage();
    });

    els.wipeBtn.addEventListener('click', async () => {
        if (!confirm('Удалить ВСЕ данные расширения: историю, очередь, чанки и кэш обложек?')) return;

        try {
            await sendRuntime({ type: 'queue:stopAll' });
            const ok = await wipeAll();
            await chrome.storage.local.remove([STORAGE_KEYS.DB, STORAGE_KEYS.QUEUE_STATE, STORAGE_KEYS.TAB_ID]);
            setStatus(ok ? 'Данные расширения удалены' : 'IndexedDB недоступна, удалены только настройки страницы', ok ? 'ok' : 'err');
        } catch (e) {
            setStatus(`Ошибка удаления: ${e?.message || e}`, 'err');
        }
        refreshUsage();
    });
}

async function bootstrap() {
    try {
        const settings = await getSettings({ force: true });
        fillForm(settings);
    } catch (e) {
        setStatus(`Не удалось загрузить настройки: ${e?.message || e}`, 'err');
    }

    bindForm();
    bindDataActions();
    refreshUsage();
}

bootstrap().catch((e) => {
    console.error('[appYa v3] options bootstrap:', e);
    setStatus(`Ошибка страницы настроек: ${e?.message || e}`, 'err');
});
