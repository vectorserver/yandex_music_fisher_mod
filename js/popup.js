/**
 * Yandex Music Fisher mod by vectorserver
 * popup.js — ESM-контроллер popup: табы «Активные» / «История».
 *
 * В UI нет тяжёлой работы: ни fetch к Яндекс.Музыке, ни ID3, ни сборки файлов.
 * Popup только читает снапшот страницы / IndexedDB и отправляет команды в SW.
 *
 * @author vectorserver
 * @version 3.0.0
 */

import { STATUS, STATUS_LABELS, PAGE_TYPES } from './modules/constants.js';
import { coverUrl, formatBytes, formatDate, joinArtists, debounce } from './modules/utils.js';
import { getPageSnapshot, getTabId, getSettings } from './modules/storage.js';
import { listHistory, historyStats } from './modules/historyDB.js';

const FALLBACK_ICON = '../icons/music_by_pancaza.png';
const TERMINAL = new Set([STATUS.DONE, STATUS.ERROR, STATUS.SKIPPED]);

const state = {
    settings: null,
    snapshot: {},
    tabId: null,
    paused: false,
    historyFilter: { search: '', status: '', pageType: '' },
    playlist: null,
    refreshingActive: false,
    refreshingHistory: false,
};

const $ = (id) => document.getElementById(id);

const els = {
    loading: $('loading'),
    authPanel: $('authPanel'),
    authorize: $('authorize'),
    authHint: $('authHint'),
    mainPanel: $('mainPanel'),
    version: $('appVersion'),
    openSettings: $('openSettings'),

    activeCount: $('activeCount'),
    historyCount: $('historyCount'),

    noTrack: $('noTrack'),
    topGrid: $('topGrid'),
    trackCard: $('trackCard'),
    trackImage: $('trackImage'),
    trackName: $('trackName'),
    artistsList: $('artistsList'),
    trackAlbum: $('trackAlbum'),
    downloadButton: $('downloadButton'),

    playlistPanel: $('playlistPanel'),
    playlistPanelImage: $('playlistPanelImage'),
    playlistPanelTitle: $('playlistPanelTitle'),
    playlistPanelMeta: $('playlistPanelMeta'),
    rangeWrapper: $('rangeWrapper'),
    rangeStart: $('rangeStart'),
    rangeEnd: $('rangeEnd'),
    rangeStartNum: $('rangeStartNum'),
    rangeEndNum: $('rangeEndNum'),
    rangeSliders: $('rangeSliders'),
    rangeAll: $('rangeAll'),
    rangeHint: $('rangeHint'),
    rangeValueDisplay: $('rangeValueDisplay'),
    playlistDownload: $('playlistPanelMetaDownloadBtn'),

    queueStats: $('queueStats'),
    pauseAll: $('pauseAll'),
    retryAll: $('retryAll'),
    stopAll: $('stopAll'),
    activeList: $('activeList'),

    historySearch: $('historySearch'),
    historyStatus: $('historyStatus'),
    historyType: $('historyType'),
    historyStats: $('historyStats'),
    clearHistory: $('clearHistory'),
    historyList: $('historyList'),

    tokenEndUrl: $('tokenEndUrl'),
    toast: $('toast'),
};

/* -------------------------------------------------------------------------- */
/* Утилиты                                                                    */
/* -------------------------------------------------------------------------- */

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

let toastTimer = null;
function toast(text, kind = '') {
    if (!els.toast) return;
    els.toast.textContent = text;
    els.toast.className = `show ${kind}`.trim();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.className = ''; }, 3200);
}

function send(type, payload = {}, timeoutMs = 12000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, error: 'Таймаут ответа service worker' }), timeoutMs);
        try {
            chrome.runtime.sendMessage({ type, payload }, (response) => {
                clearTimeout(timer);
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(response || { ok: false, error: 'Пустой ответ' });
                }
            });
        } catch (e) {
            clearTimeout(timer);
            resolve({ ok: false, error: String(e?.message || e) });
        }
    });
}

function imageFor(uri, size) {
    const url = coverUrl(uri, size || 300);
    return url || FALLBACK_ICON;
}

function statusLabel(status) {
    return STATUS_LABELS[status] || status || '—';
}

function statusClass(status) {
    if (status === STATUS.DONE) return 'done';
    if (status === STATUS.ERROR) return 'error';
    if (status === STATUS.PAUSED) return 'paused';
    if ([STATUS.DOWNLOADING, STATUS.TAGGING, STATUS.SAVING].includes(status)) return 'downloading';
    return '';
}

function progressPercent(rec) {
    if (rec.status === STATUS.DONE) return 100;
    if (rec.progress) return Math.max(0, Math.min(99, Math.round(rec.progress)));
    if (rec.totalBytes && rec.bytesReceived) {
        return Math.max(1, Math.min(99, Math.round((rec.bytesReceived / rec.totalBytes) * 100)));
    }
    return 0;
}

function typeLabel(type) {
    return PAGE_TYPES[type] || (type === 'track' ? 'Трек' : type || '');
}

function normPath(path) {
    return String(path || '').replace(/\/+$/, '');
}

function currentPagePath() {
    return normPath(state.snapshot?.aYa_location?.pathname || '');
}

function pathIsCollection(path) {
    return /^\/(album\/\d+|playlists?\/|artist\/\d+|chart)/.test(path || '');
}

/* -------------------------------------------------------------------------- */
/* Работа со снапшотом страницы                                               */
/* -------------------------------------------------------------------------- */

function currentTrack() {
    const raw = state.snapshot?.aYa_cureitTrack;
    if (!raw) return null;
    const info = raw.trackinfo || raw;
    return info?.trackId || info?.id ? info : null;
}

function trackArtists(track) {
    if (Array.isArray(track?.artists)) return joinArtists(track.artists);
    if (Array.isArray(track?.albums?.[0]?.artists)) return joinArtists(track.albums[0].artists);
    return 'Unknown Artist';
}

function trackCover(track) {
    return track?.coverUri || track?.albums?.[0]?.coverUri || '';
}

function trackAlbum(track) {
    const album = track?.album || track?.albums?.[0]?.title || '';
    const year = track?.year || track?.albums?.[0]?.year || '';
    return [album, year].filter(Boolean).join(' • ');
}

function extractIds(container) {
    if (!container) return [];
    const rows = Array.isArray(container) ? container : Object.values(container);
    return rows
        .map((row) => row?.id ?? row?.trackId ?? row?.track?.id)
        .filter((id) => id !== undefined && id !== null)
        .map(String);
}

function renderPage() {
    const hasToken = !!state.snapshot?.aYa_token;
    els.loading.classList.add('hidden');

    if (!hasToken) {
        els.authPanel.classList.remove('hidden');
        els.mainPanel.classList.add('hidden');
        const url = state.snapshot?.aYa_authorizationUrl || 'https://music.yandex.ru/';
        els.authorize.href = url;
        els.authHint.textContent = state.snapshot?.aYa_authorizationUrl
            ? 'После входа вернитесь в это окно.'
            : 'Откройте https://music.yandex.ru/ и обновите страницу.';
        return;
    }

    els.authPanel.classList.add('hidden');
    els.mainPanel.classList.remove('hidden');
    renderCurrentTrack();
    renderPlaylist();
    updatePanelsVisibility();

    if (!els.noTrack.classList.contains('hidden')) {
        els.noTrack.textContent = pathIsCollection(currentPagePath())
            ? 'Загружаю треки страницы… Подождите пару секунд и откройте popup снова.'
            : 'Включите трек в Яндекс.Музыке и вернитесь сюда.';
    }
}

/**
 * Две колонки показываем только когда есть и текущий трек, и пакетная загрузка.
 * Если одна из панелей скрыта — оставшаяся занимает всю ширину.
 */
function updatePanelsVisibility() {
    const hasTrack = !els.trackCard.classList.contains('hidden');
    const hasPlaylist = !els.playlistPanel.classList.contains('hidden');

    els.topGrid.classList.toggle('hidden', !hasTrack && !hasPlaylist);
    els.topGrid.classList.toggle('single', hasTrack !== hasPlaylist);
    els.noTrack.classList.toggle('hidden', hasTrack || hasPlaylist);
}

function renderCurrentTrack() {
    const track = currentTrack();
    if (!track) {
        els.trackCard.classList.add('hidden');
        return;
    }

    const size = state.settings?.coverQuality || 300;

    els.trackCard.classList.remove('hidden');
    els.trackImage.src = imageFor(trackCover(track), size);
    els.trackName.textContent = track.title || 'Unknown';
    els.artistsList.textContent = trackArtists(track);
    els.trackAlbum.textContent = trackAlbum(track);
}

function renderPlaylist() {
    const currentPath = currentPagePath();
    const size = state.settings?.coverQuality || 300;

    let title = '';
    let subtitle = '';
    let cover = '';
    let ids = [];
    let folder = '';
    let pageType = '';

    // 1. Нормализованная коллекция от parser.js (page-state или API) — самый
    //    надёжный источник для нового (Next.js) фронтенда Яндекс.Музыки.
    const collection = state.snapshot?.aYa_collection;
    if (collection && Array.isArray(collection.trackIds) && collection.trackIds.length &&
        (!currentPath || normPath(collection.pathname) === currentPath)) {
        title = collection.title || 'Коллекция';
        subtitle = collection.subtitle || `Треков: ${collection.trackIds.length}`;
        cover = collection.coverUri || '';
        ids = collection.trackIds.map(String);
        folder = collection.folder || collection.pageType || 'music';
        pageType = collection.pageType || '';
    } else {
        // 2. Старый формат PAGE_STATE. Используем его только если он относится
        //    к текущей странице — иначе на новой странице висели бы старые треки.
        const page = state.snapshot?.aYa_page;
        if (!page) {
            hidePlaylist();
            return;
        }

        const pagePath = normPath(page.location?.pathname || '');
        if (pagePath && currentPath && pagePath !== currentPath) {
            hidePlaylist();
            return;
        }

        const section = page?.location?.pathname?.split('/')[1] || '';

        if (section === 'chart') {
            const sub = page.tracksSubPage || {};
            title = `Чарт: ${sub.title || ''}`.trim();
            ids = extractIds(sub.items);
            folder = 'chart';
            pageType = 'chart';
            cover = sub.coverUri || '';
        } else if (section === 'album' && page.album) {
            const meta = page.album.meta || {};
            const year = meta.year ? ` - ${meta.year}` : '';
            title = `Альбом: ${meta.title || ''}${year}`;
            ids = extractIds(page.album.items);
            cover = meta.coverUri || '';
            subtitle = Array.isArray(meta.artists) ? meta.artists.map((a) => a?.name).filter(Boolean).join(', ') : '';
            pageType = 'album';
            folder = `album/${meta.title || 'album'}${year}`;
        } else if (section === 'artist' && page.artist) {
            const meta = page.artist.meta || {};
            const artist = meta.artist || {};
            const familiar = page.artist.familiarSubpage;
            title = `Исполнитель: ${artist.name || ''}`;
            ids = familiar ? extractIds(familiar.vibeTracks) : (page.artist.fullTracksListSubpage?.ids || []).map(String);
            if (familiar) title = `Знакомое вам от ${artist.name || ''}`;
            cover = artist.coverUri || '';
            subtitle = Array.isArray(meta.artists) ? meta.artists.map((a) => a?.name).filter(Boolean).join(', ') : (artist.name || '');
            pageType = 'artist';
            folder = `artist/${artist.name || 'artist'}`;
        } else if ((section === 'playlists' || section === 'playlist') && page.playlist) {
            const meta = page.playlist.meta || {};
            title = meta.title || 'Плейлист';
            ids = extractIds(page.playlist.items);
            cover = meta.coverUri || '';
            subtitle = `Автор: ${meta.owner?.name || '—'} • Треков: ${ids.length}`;
            pageType = 'playlist';
            folder = `playlist/${meta.title || 'playlist'}`;
        }
    }

    if (!ids.length) {
        hidePlaylist();
        return;
    }

    state.playlist = { ids, folder, pageType, title };

    els.playlistPanel.classList.remove('hidden');
    els.playlistPanelTitle.textContent = title || 'Плейлист';
    els.playlistPanelMeta.textContent = subtitle || `Треков: ${ids.length}`;
    els.playlistPanelImage.src = imageFor(cover, size);

    const total = ids.length;
    if (total > 1) {
        els.rangeWrapper.classList.remove('hidden');
        setRangeBounds(total);
        // Для очень больших коллекций ползунки бесполезны — оставляем точные поля.
        els.rangeSliders.classList.toggle('hidden', total > 1000);
        els.rangeHint.textContent = total > 1000
            ? `Треков больше 1000 — введите диапазон в поля «С/По».`
            : 'Можно выбрать диапазон.';
        applyRange(1, total);
    } else {
        els.rangeWrapper.classList.add('hidden');
    }

    els.playlistDownload.textContent = total > 1 ? 'Скачать выбранное' : 'Скачать трек';
}

function hidePlaylist() {
    state.playlist = null;
    els.playlistPanel.classList.add('hidden');
}

/** Общие ограничения для ползунков и числовых полей. */
function setRangeBounds(total) {
    for (const el of [els.rangeStart, els.rangeEnd, els.rangeStartNum, els.rangeEndNum]) {
        el.min = '1';
        el.max = String(total);
    }
}

/** Привести диапазон к валидному виду и обновить все контролы. */
function applyRange(start, end) {
    const total = state.playlist?.ids?.length || 1;
    let s = parseInt(start, 10);
    let e = parseInt(end, 10);

    if (!Number.isFinite(s)) s = 1;
    if (!Number.isFinite(e)) e = total;
    s = Math.max(1, Math.min(total, s));
    e = Math.max(1, Math.min(total, e));
    if (s > e) s = e;

    els.rangeStart.value = String(s);
    els.rangeEnd.value = String(e);
    els.rangeStartNum.value = String(s);
    els.rangeEndNum.value = String(e);

    els.rangeValueDisplay.textContent = (s === 1 && e === total)
        ? `Все (${total})`
        : `${s} — ${e} (шт: ${e - s + 1})`;
}

/** Обновление из ползунков или числовых полей. */
function updateRangeFrom(source) {
    if (source === 'numbers') {
        applyRange(els.rangeStartNum.value, els.rangeEndNum.value);
    } else {
        applyRange(els.rangeStart.value, els.rangeEnd.value);
    }
}

/** Выбранный пользователем диапазон (authoritative — числовые поля). */
function readSelectedRange() {
    const total = state.playlist?.ids?.length || 1;
    let start = parseInt(els.rangeStartNum.value, 10);
    let end = parseInt(els.rangeEndNum.value, 10);
    if (!Number.isFinite(start)) start = 1;
    if (!Number.isFinite(end)) end = total;
    start = Math.max(1, Math.min(total, start));
    end = Math.max(1, Math.min(total, end));
    if (start > end) [start, end] = [end, start];
    return { start, end, total };
}

async function enqueueTracks(trackIds, playlistName, pageType) {
    const ids = (trackIds || []).filter(Boolean);
    if (!ids.length) {
        toast('Нет треков для загрузки', 'err');
        return;
    }

    if (ids.length > 50) toast(`Добавляю треков: ${ids.length}…`);

    // Для больших плейлистов метаданные грузятся пачками — не обрываем по 12 с.
    const timeout = ids.length > 100 ? 120000 : 30000;
    const response = await send('queue:enqueue', {
        tabId: state.tabId,
        trackIds: ids,
        playlistName,
        pageType,
    }, timeout);

    if (response?.ok) {
        toast(`Добавлено в очередь: ${response.added ?? ids.length}`, 'ok');
        refreshActive();
    } else {
        toast(response?.error || 'Не удалось добавить в очередь', 'err');
    }
}

/* -------------------------------------------------------------------------- */
/* Активные загрузки                                                          */
/* -------------------------------------------------------------------------- */

async function refreshActive() {
    if (state.refreshingActive) return;
    state.refreshingActive = true;

    try {
        const [{ items }, statsResponse] = await Promise.all([
            listHistory({ limit: 600 }),
            send('queue:stats'),
        ]);

        const active = (items || []).filter((r) => !TERMINAL.has(r.status));
        els.activeCount.textContent = String(active.length);

        const stats = statsResponse?.ok ? statsResponse.stats : null;
        if (stats) {
            state.paused = !!stats.paused;
            els.pauseAll.textContent = state.paused ? '▶' : '⏸';
            els.pauseAll.title = state.paused ? 'Продолжить очередь' : 'Пауза очереди';
            els.queueStats.textContent = stats.total
                ? `В очереди: ${stats.queued} • Активно: ${stats.active} • Ошибки: ${stats.errors}`
                : 'Очередь пуста';
        } else {
            els.queueStats.textContent = active.length ? `Активных: ${active.length}` : 'Очередь пуста';
        }

        els.activeList.innerHTML = active.length
            ? active.map(renderActiveRow).join('')
            : '<div class="notice small">Нет активных загрузок</div>';
    } finally {
        state.refreshingActive = false;
    }
}

function renderActiveRow(rec) {
    const percent = progressPercent(rec);
    const cls = statusClass(rec.status);
    const canResume = rec.status === STATUS.PAUSED;
    const size = state.settings?.coverQuality || 300;
    const isError = rec.status === STATUS.ERROR;

    return `
        <div class="job" data-id="${esc(rec.id)}">
            <div style="display:flex;gap:8px;align-items:center;min-width:0;">
                <img src="${esc(imageFor(rec.coverUrl, size))}" alt="" style="width:34px;height:34px;border-radius:6px;object-fit:cover;background:#2e2e35;flex:0 0 34px;">
                <div style="min-width:0;">
                    <div class="job-title">${esc(rec.artists)} — ${esc(rec.title)}</div>
                    <div class="muted small">${esc(statusLabel(rec.status))}${rec.error ? ` • ${esc(rec.error)}` : ''}</div>
                </div>
            </div>
            <div class="job-actions">
                ${isError
                    ? `<button class="btn-ghost" data-action="retry" data-id="${esc(rec.id)}" title="Повторить">↻</button>`
                    : `<button class="btn-ghost" data-action="${canResume ? 'resume' : 'pause'}" data-id="${esc(rec.id)}" title="${canResume ? 'Продолжить' : 'Пауза'}">${canResume ? '▶' : '⏸'}</button>`}
                <button class="btn-ghost" data-action="cancel" data-id="${esc(rec.id)}" title="Отменить">✕</button>
            </div>
            <div class="progress ${cls}"><span style="width:${percent}%"></span></div>
        </div>`;
}

/* -------------------------------------------------------------------------- */
/* История                                                                    */
/* -------------------------------------------------------------------------- */

async function refreshHistory() {
    if (state.refreshingHistory) return;
    state.refreshingHistory = true;

    try {
        const { search, status, pageType } = state.historyFilter;
        const [list, stats] = await Promise.all([
            listHistory({ search, status, pageType, limit: 250 }),
            historyStats(),
        ]);

        els.historyCount.textContent = String(stats.total);
        els.historyStats.textContent = stats.total
            ? `Всего: ${stats.total} • Готово: ${stats.done} • Ошибки: ${stats.error} • Объём: ${formatBytes(stats.bytes)}`
            : 'История пуста';

        els.historyList.innerHTML = list.items.length
            ? list.items.map(renderHistoryCard).join('')
            : '<div class="notice small">Записей не найдено</div>';
    } finally {
        state.refreshingHistory = false;
    }
}

function renderHistoryCard(rec) {
    const percent = progressPercent(rec);
    const cls = statusClass(rec.status);
    const size = 200;
    const subtitle = [rec.artists, rec.album].filter(Boolean).join(' • ');
    const meta = [
        `<span class="badge-status ${cls}">${esc(statusLabel(rec.status))}</span>`,
        `<span>${esc(formatDate(rec.createdAt))}</span>`,
        rec.pageType ? `<span>${esc(typeLabel(rec.pageType))}</span>` : '',
        rec.totalBytes ? `<span>${formatBytes(rec.totalBytes)}</span>` : '',
        rec.resumed ? '<span title="Докачано">↻ resume</span>' : '',
    ].filter(Boolean).join('');

    return `
        <div class="hist-card" data-id="${esc(rec.id)}">
            <img src="${esc(imageFor(rec.coverUrl, size))}" alt="">
            <div class="hist-body">
                <div class="hist-title">${esc(rec.title)}</div>
                <div class="hist-sub">${esc(subtitle)}</div>
                ${rec.filename ? `<div class="hist-sub" title="${esc(rec.filename)}">${esc(rec.filename)}</div>` : ''}
                <div class="hist-meta">${meta}</div>
                ${rec.error ? `<div class="hist-meta" style="color:#ff5252;">${esc(rec.error)}</div>` : ''}
                ${rec.warning ? `<div class="hist-meta" style="color:#ffcc00;">${esc(rec.warning)}</div>` : ''}
                ${percent > 0 && rec.status !== STATUS.DONE ? `
                    <div class="progress ${cls}" style="margin-top:5px;"><span style="width:${percent}%"></span></div>` : ''}
            </div>
            <div class="hist-actions">
                <button class="btn-ghost" data-action="retry" data-id="${esc(rec.id)}" title="Повторить загрузку">↻</button>
                <button class="btn-ghost" data-action="delete" data-id="${esc(rec.id)}" title="Удалить из истории">✕</button>
            </div>
        </div>`;
}

/* -------------------------------------------------------------------------- */
/* События UI                                                                 */
/* -------------------------------------------------------------------------- */

function bindTabs() {
    document.querySelectorAll('.tab-link').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-link').forEach((b) => b.classList.toggle('active', b === btn));
            const target = btn.dataset.tab;
            $('tabActive').classList.toggle('active', target === 'active');
            $('tabHistory').classList.toggle('active', target === 'history');
            if (target === 'history') refreshHistory();
        });
    });
}

function bindQueueControls() {
    els.pauseAll.addEventListener('click', async () => {
        const response = await send('queue:setPaused', { paused: !state.paused });
        if (response?.ok) {
            state.paused = response.paused;
            els.pauseAll.textContent = state.paused ? '▶' : '⏸';
            toast(state.paused ? 'Очередь на паузе' : 'Очередь продолжена');
            refreshActive();
        }
    });

    els.retryAll.addEventListener('click', async () => {
        const response = await send('queue:retryAll');
        toast(response?.ok ? `Повторено: ${response.count}` : (response?.error || 'Ошибка'), response?.ok ? 'ok' : 'err');
        refreshActive();
        refreshHistory();
    });

    els.stopAll.addEventListener('click', async () => {
        if (!confirm('Остановить все загрузки и очистить очередь?')) return;
        const response = await send('queue:stopAll');
        toast(response?.ok ? `Остановлено: ${response.count}` : (response?.error || 'Ошибка'), response?.ok ? 'ok' : 'err');
        refreshActive();
        refreshHistory();
    });

    els.downloadButton.addEventListener('click', () => {
        const track = currentTrack();
        if (!track) return;
        enqueueTracks([String(track.trackId || track.id)], 'music', 'track');
    });

    els.playlistDownload.addEventListener('click', () => {
        if (!state.playlist) return;
        const { start, end } = readSelectedRange();
        applyRange(start, end);
        const ids = state.playlist.ids.slice(start - 1, end);
        enqueueTracks(ids, state.playlist.folder, state.playlist.pageType);
    });

    els.rangeStart.addEventListener('input', () => updateRangeFrom('sliders'));
    els.rangeEnd.addEventListener('input', () => updateRangeFrom('sliders'));
    els.rangeStartNum.addEventListener('change', () => updateRangeFrom('numbers'));
    els.rangeEndNum.addEventListener('change', () => updateRangeFrom('numbers'));
    els.rangeAll.addEventListener('click', () => {
        const total = state.playlist?.ids?.length || 1;
        applyRange(1, total);
    });

    els.activeList.addEventListener('click', async (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (!id) return;
        btn.disabled = true;

        let type = '';
        if (action === 'pause') type = 'queue:pause';
        else if (action === 'resume') type = 'queue:resume';
        else if (action === 'cancel') type = 'queue:cancel';
        else if (action === 'retry') type = 'queue:retry';

        if (type) await send(type, { id });
        btn.disabled = false;
        refreshActive();
    });

    els.historyList.addEventListener('click', async (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (!id) return;
        btn.disabled = true;

        if (action === 'retry') {
            const response = await send('queue:retry', { id });
            toast(response?.ok ? 'Задача возвращена в очередь' : (response?.error || 'Не удалось повторить'), response?.ok ? 'ok' : 'err');
        } else if (action === 'delete') {
            const response = await send('history:delete', { id });
            if (!response?.ok) toast(response?.error || 'Не удалось удалить', 'err');
        }

        btn.disabled = false;
        refreshActive();
        refreshHistory();
    });

    els.clearHistory.addEventListener('click', async () => {
        if (!confirm('Очистить завершённые и ошибочные записи истории?')) return;
        const response = await send('history:clear', {
            statuses: [STATUS.DONE, STATUS.ERROR, STATUS.SKIPPED],
        });
        toast(response?.ok ? 'История очищена' : (response?.error || 'Ошибка'), response?.ok ? 'ok' : 'err');
        refreshHistory();
        refreshActive();
    });

    const applyHistoryFilter = debounce(() => {
        state.historyFilter = {
            search: els.historySearch.value.trim(),
            status: els.historyStatus.value,
            pageType: els.historyType.value,
        };
        refreshHistory();
    }, 250);

    els.historySearch.addEventListener('input', applyHistoryFilter);
    els.historyStatus.addEventListener('change', applyHistoryFilter);
    els.historyType.addEventListener('change', applyHistoryFilter);
}

function bindHeader() {
    els.openSettings.addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    });

    els.tokenEndUrl.addEventListener('click', async (event) => {
        event.preventDefault();
        if (!confirm('Сбросить OAuth-токен и перезагрузить вкладку Яндекс.Музыки?')) return;

        const tabId = state.tabId || await getTabId();
        if (!tabId) {
            toast('Откройте вкладку music.yandex.ru', 'err');
            return;
        }

        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: () => {
                    localStorage.removeItem('aYa_token');
                    localStorage.removeItem('aYa_authorizationUrl');
                    localStorage.removeItem('aYa_cureitTrack');
                    localStorage.removeItem('aYa_page');
                },
            });
            await chrome.tabs.reload(tabId);
            window.close();
        } catch (e) {
            toast(`Не удалось сбросить токен: ${e?.message || e}`, 'err');
        }
    });
}

/* -------------------------------------------------------------------------- */
/* Загрузка состояния                                                         */
/* -------------------------------------------------------------------------- */

async function reloadSnapshot(force = false) {
    state.settings = await getSettings({ force });
    state.snapshot = await getPageSnapshot();
    state.tabId = await getTabId();
    renderPage();
}

async function bootstrap() {
    try {
        const manifest = chrome.runtime.getManifest();
        els.version.textContent = manifest.version || '3.0';
    } catch { /* noop */ }

    bindTabs();
    bindHeader();
    bindQueueControls();

    await reloadSnapshot();

    // Служебные события из SW (done/error/retry/…)
    if (chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((message) => {
            if (String(message?.type || '').startsWith('queue:')) {
                refreshActive();
                refreshHistory();
            }
            return false;
        });
    }

    // Изменение снапшота страницы или настроек
    if (chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            if (changes.app_setting || changes.aYa_db) {
                reloadSnapshot(changes.app_setting ? true : false);
            }
        });
    }

    refreshActive();
    refreshHistory();

    setInterval(refreshActive, 1500);
    setInterval(() => {
        if ($('tabHistory').classList.contains('active')) refreshHistory();
    }, 4000);
}

bootstrap().catch((e) => {
    console.error('[appYa v3] popup bootstrap:', e);
    if (els.loading) els.loading.textContent = `Ошибка popup: ${e?.message || e}`;
});
