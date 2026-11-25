/**
 * Yandex Music Fisher mod by vectorserver
 * parser.js — MAIN world (инжектируется в контекст страницы music.yandex.*).
 *
 * Что делает:
 *  - OAuth-токен из localStorage страницы, ссылка авторизации;
 *  - метаданные треков (tracks?trackIds=...) и прямой stream URL (/get-file-info
 *    с HMAC-подписью) — БЕЗ создания blob: URL (утечка памяти из v2);
 *  - разбор PAGE_STATE для popup (альбом/плейлист/артист/чарт);
 *  - плавающая кнопка скачивания и кнопки на карточках треков: они НЕ качают
 *    сами, а отправляют событие appYa:download-request → content.js → SW.
 *
 * @author vectorserver
 * @version 3.0.0
 */
(() => {
    'use strict';

    if (window.appYa && window.appYa.__v3) {
        // Повторная инъекция после SPA-перехода: только освежаем состояние
        try { window.appYa.init(); } catch (e) { console.warn('[appYa] init:', e); }
        return;
    }

    const BRAND = 'Yandex Music Fisher mod by vectorserver';
    const LOG = '[appYa v3]';
    const API_URL = 'https://api.music.yandex.ru/';
    const OAUTH_URL = 'https://oauth.yandex.ru/';
    const CLIENT_ID = '97fe03033fa34407ac9bcf91d5afed5b';
    const REDIRECT_URI = 'https://music.yandex.ru/oauth';
    const LOCATION_ORIGIN = 'https://music.yandex.ru/?yamusic=ok';
    const SIGN_SECRET = 'kzqU4XhfCaY6B6JTHODeq5';
    const MUSIC_CLIENT_HEADER = 'YandexMusicDesktopAppWindows/2';
    const QUERY_MARK = 'byVectorserver=1';
    const AUDIO_QUALITIES = ['lq', 'nq', 'lossless'];

    const log = (...a) => console.log(LOG, ...a);
    const warn = (...a) => console.warn(LOG, ...a);

    /** Событие в ISOLATED world: detail — JSON-строка (надёжно между мирами). */
    function dispatch(name, detail) {
        try {
            document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail || {}) }));
        } catch (e) {
            warn('dispatch failed:', e?.message);
        }
    }

    const appYa = {
        __v3: true,
        brand: BRAND,

        tokenData: {},
        currentAudioStreamUrl: '',
        currentTrackId: '',
        lastParsedHref: '',
        _inited: false,
        _observer: null,
        _urlTimer: null,
        _metaCache: new Map(),
        _networkHooked: false,
        _collectionRecoveryTried: false,
        _identityLoading: '',

        /* ------------------------------------------------------------------ */
        /* Инициализация                                                      */
        /* ------------------------------------------------------------------ */

        init() {
            if (this._inited) {
                this.refreshToken();
                return;
            }
            this._inited = true;

            this.refreshToken();
            this.monitorPlayer();
            this.startWatchers();
            this.drainNetworkQueue();
            this.processPlayButtons();
            this.publishLocation();
            this.resetStaleCollection();

            // Сначала пробуем уже отрисованное состояние страницы, затем —
            // сетевые ресурсы, загруженные до инъекции parser.js.
            this.scanPageStateFromDom();
            this.scanNextFlight();
            this.syncCurrentTrackFromDom();
            this.clearTrackIfNotPlaying();
            this.recoverCollectionFromPerformance()
                .then((found) => found || this.resolveCollectionFromApi())
                .catch(() => {});
            this.parsePage().catch((e) => warn('parsePage:', e?.message));

            // Сообщаем bridge, что parser готов и какие ключи есть
            dispatch('appYa:storage-changed', {
                keys: ['aYa_token', 'aYa_authorizationUrl', 'aYa_hosting', 'aYa_page', 'aYa_collection', 'aYa_location', 'aYa_cureitTrack'],
            });
        },

        /* ------------------------------------------------------------------ */
        /* Токен / авторизация                                                */
        /* ------------------------------------------------------------------ */

        refreshToken() {
            const raw = localStorage.getItem('aYa_token');
            if (!raw) {
                this.tokenData = {};
                // После OAuth-редиректа токен лежит в #access_token=... — разбираем его
                if (window.location.hash.includes('access_token=')) {
                    this.reToken();
                } else {
                    this.ensureAuthorizationUrl();
                }
                return;
            }
            try {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.access_token) {
                    this.tokenData = parsed;
                    localStorage.setItem('aYa_hosting', window.location.origin);
                    return;
                }
            } catch (e) {
                warn('aYa_token parse:', e?.message);
            }
            this.tokenData = {};
            this.ensureAuthorizationUrl();
        },

        ensureAuthorizationUrl() {
            if (localStorage.getItem('aYa_authorizationUrl')) return;
            const url = `${OAUTH_URL}authorize?response_type=token&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
            localStorage.setItem('aYa_authorizationUrl', url);
            dispatch('appYa:storage-changed', { keys: ['aYa_authorizationUrl'] });
        },

        /** Разбор #access_token=... после редиректа OAuth. */
        reToken() {
            const hash = window.location.hash ? window.location.hash.slice(1) : '';
            if (hash.includes('access_token=')) {
                const params = {};
                for (const pair of hash.split('&')) {
                    const [k, v] = pair.split('=');
                    if (k) params[k] = decodeURIComponent(v || '');
                }
                localStorage.setItem('aYa_token', JSON.stringify(params));
                this.tokenData = params;
                dispatch('appYa:storage-changed', { keys: ['aYa_token'] });
                setTimeout(() => { window.location.href = LOCATION_ORIGIN; }, 500);
                return params;
            }
            this.ensureAuthorizationUrl();
            return null;
        },

        get hasToken() {
            return !!this.tokenData?.access_token;
        },

        authHeaders() {
            const headers = new Headers();
            if (this.tokenData?.access_token) {
                headers.set('Authorization', `OAuth ${this.tokenData.access_token}`);
            }
            headers.set('X-Yandex-Music-Client', MUSIC_CLIENT_HEADER);
            headers.set('Accept', 'application/json');
            return headers;
        },

        async apiFetch(path) {
            if (!this.hasToken) throw new Error('Нет OAuth-токена — авторизуйтесь на music.yandex.ru');
            const url = `${API_URL}${path}${path.includes('?') ? '&' : '?'}${QUERY_MARK}`;
            const res = await fetch(url, { headers: this.authHeaders(), credentials: 'omit' });
            if (!res.ok) {
                const err = new Error(`HTTP ${res.status} ${res.statusText}`);
                err.status = res.status;
                throw err;
            }
            return res.json();
        },

        /** То же, но для абсолютного URL (например, из performance entries). */
        async apiFetchUrl(absUrl) {
            if (!this.hasToken) throw new Error('Нет OAuth-токена — авторизуйтесь на music.yandex.ru');
            const url = new URL(absUrl);
            if (!url.searchParams.has('byVectorserver')) url.searchParams.set('byVectorserver', '1');
            const res = await fetch(url.toString(), { headers: this.authHeaders(), credentials: 'omit' });
            if (!res.ok) {
                const err = new Error(`HTTP ${res.status} ${res.statusText}`);
                err.status = res.status;
                throw err;
            }
            return res.json();
        },

        /* ------------------------------------------------------------------ */
        /* Сбор данных страницы (альбом / плейлист / артист / чарт)           */
        /* ------------------------------------------------------------------ */

        /** Тип коллекции по текущему URL. */
        pathInfo() {
            const pathname = window.location.pathname;
            if (/^\/album\/\d+/.test(pathname)) return { pageType: 'album' };
            if (/^\/playlists?\//.test(pathname)) return { pageType: 'playlist' };
            if (/^\/artist\/\d+/.test(pathname)) return { pageType: 'artist' };
            if (/^\/chart(\/|$)/.test(pathname)) return { pageType: 'chart' };
            return null;
        },

        /** Сообщить popup актуальный URL страницы (защита от устаревшего снапшота). */
        publishLocation() {
            const loc = {
                href: window.location.href,
                pathname: window.location.pathname,
                updatedAt: Date.now(),
            };
            try {
                localStorage.setItem('aYa_location', JSON.stringify(loc));
                dispatch('appYa:storage-changed', { keys: ['aYa_location'] });
            } catch { /* кавычки не критичны */ }
        },

        /** Удалить коллекцию, оставшуюся от другой страницы. */
        resetStaleCollection() {
            let existing = null;
            try { existing = JSON.parse(localStorage.getItem('aYa_collection') || 'null'); } catch { /* noop */ }
            if (!existing) return;
            if (existing.pathname === window.location.pathname) return;

            try {
                localStorage.removeItem('aYa_collection');
                dispatch('appYa:storage-changed', { keys: ['aYa_collection'] });
            } catch { /* noop */ }
        },

        /** Общий merge патчей Яндекса (STATE_PATCHES / PAGE_STATE_PATCHES). */
        mergeStatePatches(merged) {
            const allPatches = merged.flat(Infinity);
            const tree = {};

            allPatches.forEach((patch) => {
                if (!patch || typeof patch !== 'object' || !patch.path) return;
                const keys = patch.path.split('/').filter(Boolean);
                let current = tree;

                for (let i = 0; i < keys.length - 1; i++) {
                    const key = keys[i];
                    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
                    current = current[key];
                }

                const lastKey = keys[keys.length - 1];
                if (lastKey === undefined) return;

                if (patch.op === 'replace' || !current[lastKey]) {
                    current[lastKey] = patch.value;
                } else if (patch.op === 'add') {
                    if (Array.isArray(current[lastKey])) current[lastKey].push(patch.value);
                    else current[lastKey] = [current[lastKey], patch.value];
                }
            });

            return tree;
        },

        /** Собрать патчи из уже загруженных <script> текущего документа. */
        scanPageStateFromDom() {
            const info = this.pathInfo();
            if (!info) return null;

            const pushRegex = /window\.__(?:PAGE_)?STATE_PATCHES__(?:\[['"][^'"]+['"]\])?(?:\s*=\s*.*?|\s*\|\|\s*.*?)*\.push\(([\s\S]*?)\);/g;
            const merged = [];

            document.querySelectorAll('script').forEach((script) => {
                const content = script.textContent;
                if (!content || !content.includes('STATE_PATCHES')) return;
                pushRegex.lastIndex = 0;
                for (const match of content.matchAll(pushRegex)) {
                    const pushData = match[1]?.trim();
                    if (!pushData) continue;
                    try {
                        merged.push(new Function(`return ${pushData};`)());
                    } catch { /* невалидный кусок — пропускаем */ }
                }
            });

            if (!merged.length) return null;

            const tree = this.mergeStatePatches(merged);
            if (!Object.keys(tree).length) return null;

            try {
                localStorage.setItem('aYa_page', JSON.stringify(tree));
                dispatch('appYa:storage-changed', { keys: ['aYa_page'] });
            } catch { /* квота — не критично */ }

            const col = this.extractCollectionFromState(tree);
            if (!col) this.fetchPlaylistFromState(tree).catch(() => {});
            return col || tree;
        },

        /** Собрать текст Next.js RSC flight (self.__next_f.push([1,"..."])) из скриптов. */
        collectFlightText(root = document) {
            let out = '';
            const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
            root.querySelectorAll('script').forEach((script) => {
                const text = script.textContent;
                if (!text || !text.includes('__next_f')) return;
                re.lastIndex = 0;
                for (const match of text.matchAll(re)) {
                    try { out += JSON.parse(match[1]); } catch { /* битый чанк */ }
                }
            });
            return out;
        },

        /** Конец сбалансированного JSON-объекта/массива с учётом строк. */
        findBalancedEnd(text, start, open, close) {
            let depth = 0;
            let inString = false;
            let escaped = false;

            for (let i = start; i < text.length; i++) {
                const ch = text[i];
                if (inString) {
                    if (escaped) escaped = false;
                    else if (ch === '\\') escaped = true;
                    else if (ch === '"') inString = false;
                    continue;
                }
                if (ch === '"') inString = true;
                else if (ch === open) depth++;
                else if (ch === close) {
                    depth--;
                    if (depth === 0) return i;
                }
            }
            return -1;
        },

        /** Найти и распарсить JSON-объект, содержащий указанную подстроку. */
        extractJsonObjectAround(text, needle) {
            const idx = text.indexOf(needle);
            if (idx < 0) return null;

            let start = text.lastIndexOf('{', idx);
            let guard = 0;
            while (start >= 0 && guard++ < 30) {
                const end = this.findBalancedEnd(text, start, '{', '}');
                if (end > idx) {
                    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* пробуем выше */ }
                }
                start = text.lastIndexOf('{', start - 1);
            }
            return null;
        },

        /** Найти и распарсить JSON-массив после ключа (например, "tracks"). */
        extractJsonArrayAfter(text, key) {
            let pos = 0;
            while (pos < text.length) {
                const idx = text.indexOf(key, pos);
                if (idx < 0) break;
                let start = text.indexOf('[', idx + key.length);
                if (start >= 0 && start - (idx + key.length) < 8) {
                    const end = this.findBalancedEnd(text, start, '[', ']');
                    if (end > start) {
                        try { return JSON.parse(text.slice(start, end + 1)); } catch { /* ищем дальше */ }
                    }
                }
                pos = idx + key.length;
            }
            return null;
        },

        /** Извлечь коллекцию из Next.js RSC flight. */
        extractCollectionFromFlight(flight) {
            const info = this.pathInfo();
            if (!info || !flight) return null;

            const anchor = info.pageType === 'album' ? '"volumes"' : '"tracks"';

            const metaObj = this.extractJsonObjectAround(flight, anchor);
            let tracks = metaObj?.tracks || metaObj?.volumes || metaObj?.items || null;

            if (!tracks) {
                for (const key of ['"tracks"', '"items"', '"volumes"']) {
                    const arr = this.extractJsonArrayAfter(flight, key);
                    if (Array.isArray(arr) && arr.length) { tracks = arr; break; }
                }
            }
            if (!Array.isArray(tracks) || !tracks.length) return null;

            const root = metaObj
                ? (info.pageType === 'playlist' ? { playlist: metaObj }
                    : info.pageType === 'album' ? { album: metaObj }
                        : info.pageType === 'artist' ? { artist: metaObj }
                            : { tracksSubPage: metaObj })
                : { items: tracks };

            const ids = this.findTrackIds(root);
            if (!ids.length) return null;

            return this.publishCollection({
                trackIds: ids,
                meta: this.findCollectionMeta(root, info),
                source: 'next-flight',
            });
        },

        /** Скан RSC flight в уже отрисованном документе или в fetched DOM. */
        scanNextFlight(root = document) {
            const flight = this.collectFlightText(root);
            if (!flight) return null;
            return this.extractCollectionFromFlight(flight);
        },

        /** Похож ли объект на трек. */
        isTrackObject(o) {
            return !!o && typeof o === 'object' && (o.id !== undefined || o.trackId !== undefined) &&
                !!(o.title || o.name) &&
                !!(o.albums || o.artists || o.durationMs || o.duration || o.trackSource || o.trackId);
        },

        /** Достать трек из элемента списка (иногда он обёрнут в { id, track }). */
        trackItem(o) {
            if (this.isTrackObject(o)) return o;
            if (o && typeof o === 'object') {
                if (this.isTrackObject(o.track)) return o.track;
                if (this.isTrackObject(o.data)) return o.data;
                // RSC/Next.js: элемент плейлиста = { id, albumId, originalIndex }
                if (o.id !== undefined &&
                    (o.albumId !== undefined || o.originalIndex !== undefined || o.originalShuffleIndex !== undefined)) {
                    return { id: o.id };
                }
            }
            return null;
        },

        /**
         * Найти самый вероятный массив треков в произвольном JSON/состоянии.
         * Приоритет — ключи tracks/items/volumes/vibeTracks; рекомендации штрафуются.
         */
        findTrackIds(root) {
            let best = { ids: [], score: -1 };
            const seen = new Set();

            const matches = (key, path) => {
                const goodKey = /^(tracks|items|volumes|vibeTracks|fullTracksList|ids|trackIds)$/i.test(key);
                const badPath = /(recommend|similar|related|also|carousel|footer|playlists|albums|artists|shelf|landing)/i.test(path);
                return { goodKey, badPath };
            };

            const visit = (value, path, depth) => {
                if (!value || depth > 8) return;
                if (typeof value !== 'object') return;
                if (seen.has(value)) return;
                seen.add(value);

                if (Array.isArray(value)) {
                    const key = path.split('.').pop() || '';
                    const { goodKey, badPath } = matches(key, path);

                    // volumes: [[track, track], [track, ...]] — склеиваем все тома
                    const nested = value.filter((v) => Array.isArray(v));
                    const nestedObjects = nested.flat().map((v) => this.trackItem(v)).filter(Boolean);
                    if (nestedObjects.length) {
                        const score = nestedObjects.length + (goodKey ? 10000 : 0) - (badPath ? 50000 : 0);
                        if (score > best.score) {
                            best = {
                                ids: [...new Set(nestedObjects.map((o) => String(o.trackId ?? o.id)).filter(Boolean))],
                                score,
                            };
                        }
                    }

                    const objects = value.map((v) => this.trackItem(v)).filter(Boolean);
                    if (objects.length) {
                        const score = objects.length + (goodKey ? 10000 : 0) - (badPath ? 50000 : 0);
                        if (score > best.score) {
                            const ids = [...new Set(objects.map((o) => String(o.trackId ?? o.id)).filter(Boolean))];
                            best = { ids, score };
                        }
                    } else if (!nested.length && value.length && value.every((v) => typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))) {
                        if (goodKey && !badPath && value.length > best.score) {
                            best = { ids: [...new Set(value.map(String))], score: value.length + 5000 };
                        }
                    }
                    for (const v of value) visit(v, path, depth + 1);
                    return;
                }

                for (const [k, v] of Object.entries(value)) {
                    visit(v, path ? `${path}.${k}` : k, depth + 1);
                }

                // PAGE_STATE с op:"add" и путями /items/0 превращает массив в
                // объект с числовыми ключами — поддерживаем и такой вид.
                const entries = Object.entries(value);
                if (entries.length && entries.every(([k]) => /^\d+$/.test(k))) {
                    const objects = entries.map(([, v]) => v).map((v) => this.trackItem(v)).filter(Boolean);
                    if (objects.length) {
                        const key = path.split('.').pop() || '';
                        const { goodKey, badPath } = matches(key, path);
                        const score = objects.length + (goodKey ? 10000 : 0) - (badPath ? 50000 : 0);
                        if (score > best.score) {
                            best = {
                                ids: [...new Set(objects.map((o) => String(o.trackId ?? o.id)).filter(Boolean))],
                                score,
                            };
                        }
                    }
                }
            };

            visit(root, '', 0);
            return best.ids;
        },

        /** Метаданные коллекции из состояния/API. */
        findCollectionMeta(root, info) {
            const candidates = [];
            const push = (o) => { if (o && typeof o === 'object') candidates.push(o); };

            if (info.pageType === 'playlist') {
                push(root?.playlist?.meta);
                push(root?.playlist);
                push(root?.playlistMeta);
                push(root?.result?.playlist?.meta);
                push(root?.result?.playlist);
                push(root?.result);
            } else if (info.pageType === 'album') {
                push(root?.album?.meta);
                push(root?.album);
                push(root?.result?.album?.meta);
                push(root?.result?.album);
                push(root?.result);
            } else if (info.pageType === 'artist') {
                push(root?.artist?.meta?.artist);
                push(root?.artist?.meta);
                push(root?.artist);
                push(root?.result?.artist);
                push(root?.result);
            } else if (info.pageType === 'chart') {
                push(root?.tracksSubPage);
                push(root?.chart);
                push(root?.result?.chart);
                push(root?.result);
            }

            // Умышленно не ищем метаданные «где попало»: на странице артиста или
            // в ответе API легко принять за коллекцию трек/альбом. Если явных
            // кандидатов нет — title возьмётся из <h1> в publishCollection.
            const meta = candidates.find((c) => (c.title || c.name)) || {};
            const artistNames = Array.isArray(meta.artists)
                ? meta.artists.map((a) => a?.name).filter(Boolean)
                : [];
            const owner = meta.owner?.name || meta.owner?.login || meta.user?.name || '';

            return {
                title: String(meta.title || meta.name || '').trim(),
                coverUri: meta.coverUri || meta.cover?.uri || '',
                year: meta.year || meta.albums?.[0]?.year || null,
                owner,
                artists: artistNames,
                trackCount: meta.trackCount ?? meta.track_count ?? null,
                uid: meta.uid ?? meta.owner?.uid ?? null,
                kind: meta.kind ?? null,
                uuid: meta.playlistUuid || meta.uuid || null,
            };
        },

        /** Найти identity плейлиста (uid/kind) в состоянии страницы. */
        extractPlaylistIdentity(root) {
            const direct = [
                root?.playlistMeta,
                root?.playlist?.meta,
                root?.playlist,
                root?.result?.playlist?.meta,
                root?.result?.playlist,
                root?.result,
            ];
            for (const c of direct) {
                if (c && c.uid !== undefined && c.kind !== undefined) {
                    return { uid: c.uid, kind: c.kind, uuid: c.playlistUuid || c.uuid || null };
                }
            }

            const stack = [root];
            let guard = 0;
            while (stack.length && guard++ < 2000) {
                const cur = stack.pop();
                if (!cur || typeof cur !== 'object') continue;
                if (!Array.isArray(cur) && cur.uid !== undefined && cur.kind !== undefined &&
                    (cur.playlistUuid || cur.uuid || cur.title)) {
                    return { uid: cur.uid, kind: cur.kind, uuid: cur.playlistUuid || cur.uuid || null };
                }
                for (const v of Object.values(cur)) {
                    if (v && typeof v === 'object') stack.push(v);
                }
            }
            return null;
        },

        /** Если в PAGE_STATE есть только метаданные — дотянуть треки через API. */
        async fetchPlaylistFromState(tree) {
            if (!this.hasToken) return null;
            const identity = this.extractPlaylistIdentity(tree);
            if (!identity) return null;
            const key = `${identity.uid}:${identity.kind}`;
            if (this._identityLoading === key) return null;
            this._identityLoading = key;

            try {
                const data = await this.apiFetch(`users/${identity.uid}/playlists/${identity.kind}`);
                return this.ingestApiPayload(data, `users/${identity.uid}/playlists/${identity.kind}`);
            } catch (e) {
                if (e?.status && e.status !== 404) warn('playlist identity fetch:', e.message);
                return null;
            } finally {
                if (this._identityLoading === key) this._identityLoading = '';
            }
        },

        /** Нормализовать и сохранить коллекцию для popup. */
        publishCollection({ trackIds, meta, source }) {
            const info = this.pathInfo();
            if (!info) return null;

            const ids = [...new Set((trackIds || []).map(String).filter(Boolean))];
            if (!ids.length) return null;

            const pathname = window.location.pathname;
            let existing = null;
            try { existing = JSON.parse(localStorage.getItem('aYa_collection') || 'null'); } catch { /* noop */ }

            // Не затираем полный список случайно загруженной частью (превью/
            // рекомендации) в пределах одной загрузки страницы. Старую коллекцию
            // с прошлой сессии (старше минуты) разрешаем обновить.
            const fresh = existing && (Date.now() - (existing.updatedAt || 0) < 60000);
            if (fresh && existing.pathname === pathname && Array.isArray(existing.trackIds) &&
                existing.trackIds.length > ids.length) {
                return existing;
            }

            const h1 = (document.querySelector('h1')?.textContent || '').trim();
            const docTitle = (document.title || '').replace(/\s*[—|-]\s*Яндекс\s*Музыка.*$/i, '').trim();
            const baseTitle = meta?.title || h1 || docTitle || {
                playlist: 'Плейлист',
                album: 'Альбом',
                artist: 'Исполнитель',
                chart: 'Чарт',
            }[info.pageType];

            const year = meta?.year ? String(meta.year) : '';
            const artists = (meta?.artists || []).join(', ');
            const count = ids.length;

            let displayTitle = baseTitle;
            let subtitle = '';
            let folder = '';

            if (info.pageType === 'album') {
                displayTitle = `Альбом: ${baseTitle}${year ? ` - ${year}` : ''}`;
                subtitle = [artists, year].filter(Boolean).join(' • ');
                folder = `album/${baseTitle}${year ? ` - ${year}` : ''}`;
            } else if (info.pageType === 'artist') {
                displayTitle = `Исполнитель: ${baseTitle}`;
                subtitle = `Треков: ${count}`;
                folder = `artist/${baseTitle}`;
            } else if (info.pageType === 'chart') {
                displayTitle = `Чарт: ${baseTitle}`;
                subtitle = `Треков: ${count}`;
                folder = 'chart';
            } else {
                displayTitle = `Плейлист: ${baseTitle}`;
                subtitle = [meta?.owner, `Треков: ${count}`].filter(Boolean).join(' • ');
                folder = `playlist/${baseTitle}`;
            }

            const collection = {
                pathname,
                href: window.location.href,
                pageType: info.pageType,
                title: displayTitle,
                baseTitle,
                subtitle,
                coverUri: meta?.coverUri || '',
                folder,
                trackIds: ids,
                source,
                updatedAt: Date.now(),
            };

            try {
                localStorage.setItem('aYa_collection', JSON.stringify(collection));
                dispatch('appYa:storage-changed', { keys: ['aYa_collection'] });
                log(`коллекция ${info.pageType}: ${ids.length} треков (${source})`);
            } catch (e) {
                warn('aYa_collection save:', e?.message);
            }
            return collection;
        },

        /** Извлечь коллекцию из PAGE_STATE (старый SSR-формат). */
        extractCollectionFromState(tree) {
            const info = this.pathInfo();
            if (!info || !tree) return null;
            const ids = this.findTrackIds(tree);
            if (!ids.length) return null;
            return this.publishCollection({
                trackIds: ids,
                meta: this.findCollectionMeta(tree, info),
                source: 'page-state',
            });
        },

        /** Извлечь коллекцию из JSON-ответа API Яндекс.Музыки. */
        ingestApiPayload(data, url) {
            const info = this.pathInfo();
            if (!info || !data) return null;
            const ids = this.findTrackIds(data);
            if (!ids.length) return null;
            return this.publishCollection({
                trackIds: ids,
                meta: this.findCollectionMeta(data, info),
                source: `api:${url ? new URL(url, window.location.origin).pathname : 'json'}`,
            });
        },

        /** Перехват fetch/XHR: страница загружает плейлисты/альбомы динамически. */
        monitorNetwork() {
            if (this._networkHooked) return;
            this._networkHooked = true;

            const relevant = (u) => {
                if (!u || u.includes('byVectorserver')) return false;
                if (!/music\.yandex\./.test(u)) return false;
                return /(?:^|\/)(?:playlists?|albums?|artists?)\//.test(u) || /\/(?:chart|landing)/.test(u);
            };

            try {
                const originalFetch = window.fetch;
                window.fetch = function patchedFetch(...args) {
                    const req = args[0];
                    const url = typeof req === 'string' ? req : (req?.url || '');
                    const promise = originalFetch.apply(this, args);
                    if (relevant(url)) {
                        promise.then((res) => {
                            try {
                                if (!res?.ok) return;
                                const ct = res.headers.get('content-type') || '';
                                if (ct.includes('application/json')) {
                                    res.clone().json()
                                        .then((data) => appYa.ingestApiPayload(data, url))
                                        .catch(() => {});
                                } else if (ct.includes('text/x-component') || ct.includes('text/plain') || ct.includes('text/html')) {
                                    // Next.js RSC-ответ (не JSON) тоже может содержать плейлист
                                    res.clone().text()
                                        .then((text) => {
                                            if (text && (text.includes('"tracks"') || text.includes('"volumes"'))) {
                                                appYa.extractCollectionFromFlight(text);
                                            }
                                        })
                                        .catch(() => {});
                                }
                            } catch { /* noop */ }
                        }).catch(() => {});
                    }
                    return promise;
                };
            } catch (e) {
                warn('fetch hook:', e?.message);
            }

            try {
                const XHR = window.XMLHttpRequest;
                if (XHR && !XHR.prototype.__appYaHooked) {
                    XHR.prototype.__appYaHooked = true;
                    const originalOpen = XHR.prototype.open;
                    const originalSend = XHR.prototype.send;
                    XHR.prototype.open = function patchedOpen(method, url, ...rest) {
                        this.__appYaUrl = url;
                        return originalOpen.call(this, method, url, ...rest);
                    };
                    XHR.prototype.send = function patchedSend(...args) {
                        this.addEventListener('load', () => {
                            try {
                                const url = String(this.__appYaUrl || '');
                                if (!relevant(url)) return;
                                const ct = this.getResponseHeader('content-type') || '';
                                if (ct.includes('application/json')) {
                                    const data = JSON.parse(this.responseText);
                                    appYa.ingestApiPayload(data, url);
                                } else if (ct.includes('text/x-component') || ct.includes('text/plain') || ct.includes('text/html')) {
                                    const text = this.responseText || '';
                                    if (text.includes('"tracks"') || text.includes('"volumes"')) {
                                        appYa.extractCollectionFromFlight(text);
                                    }
                                }
                            } catch { /* noop */ }
                        });
                        return originalSend.apply(this, args);
                    };
                }
            } catch (e) {
                warn('xhr hook:', e?.message);
            }
        },

        /** Забрать ответы API, которые поймал main_hook.js до инъекции parser. */
        drainNetworkQueue() {
            const q = window.__appYaNetworkQueue;
            if (!Array.isArray(q) || !q.length) return;
            while (q.length) {
                const item = q.shift();
                if (!item?.text) continue;
                try {
                    const ct = String(item.contentType || '');
                    const text = String(item.text);
                    if (ct.includes('json') || /^\s*[{[]/.test(text)) {
                        const data = JSON.parse(text);
                        this.ingestApiPayload(data, item.url);
                    } else if (text.includes('"tracks"') || text.includes('"volumes"')) {
                        this.extractCollectionFromFlight(text);
                    }
                } catch { /* не наш ответ — пропускаем */ }
            }
        },

        /**
         * Если parser внедрился после загрузки данных, забираем URL API из
         * performance entries и повторяем запрос со своим OAuth-токеном.
         */
        async recoverCollectionFromPerformance() {
            if (this._collectionRecoveryTried || !this.hasToken) return;
            this._collectionRecoveryTried = true;

            const info = this.pathInfo();
            if (!info) return;
            const existing = this.readCollection();
            if (existing?.pathname === window.location.pathname && existing.trackIds?.length) return;

            let urls = [];
            try {
                urls = performance.getEntriesByType('resource')
                    .map((e) => e.name)
                    .filter((u) => /music\.yandex\./.test(u))
                    .filter((u) => /(?:^|\/)(?:playlists?|albums?|artists?)\//.test(u))
                    .filter((u) => !u.includes('byVectorserver'))
                    .reverse()
                    .slice(0, 8);
            } catch { /* noop */ }

            for (const url of urls) {
                try {
                    const data = await this.apiFetchUrl(url);
                    const result = this.ingestApiPayload(data, url);
                    if (result?.trackIds?.length) return result;
                } catch { /* пробуем следующий */ }
            }
            return null;
        },

        /** Прямой fallback: запросить коллекцию по id из URL. */
        async resolveCollectionFromApi() {
            if (!this.hasToken) return null;
            const info = this.pathInfo();
            if (!info) return null;
            const existing = this.readCollection();
            if (existing?.pathname === window.location.pathname && existing.trackIds?.length) return existing;

            const parts = window.location.pathname.split('/').filter(Boolean);
            const rawId = decodeURIComponent(parts[1] || '');
            const numericId = (window.location.pathname.match(/\/(\d{2,})(?:\/|$)/) || [])[1];
            const attempts = [];

            if (info.pageType === 'playlist' && rawId) {
                let pageState = null;
                try { pageState = JSON.parse(localStorage.getItem('aYa_page') || 'null'); } catch { /* noop */ }
                const identity = this.extractPlaylistIdentity(pageState);
                if (identity) attempts.push(`users/${identity.uid}/playlists/${identity.kind}`);
                attempts.push(`playlists/${rawId}`);
                const uuid = rawId.replace(/^[a-z]+\./i, '');
                if (uuid !== rawId) attempts.push(`playlists/${uuid}`);
            } else if (info.pageType === 'album' && numericId) {
                attempts.push(`albums/${numericId}/with-tracks`, `albums/${numericId}`);
            } else if (info.pageType === 'artist' && numericId) {
                attempts.push(`artists/${numericId}/tracks?page=0&pageSize=1000`);
            } else if (info.pageType === 'chart') {
                attempts.push('landing3/chart');
            }

            for (const path of attempts) {
                try {
                    const data = await this.apiFetch(path);
                    const result = this.ingestApiPayload(data, path);
                    if (result?.trackIds?.length) return result;
                } catch (e) {
                    if (e?.status && e.status !== 404) warn(`collection ${path}:`, e.message);
                }
            }
            return null;
        },

        /* ------------------------------------------------------------------ */
        /* Метаданные треков                                                  */
        /* ------------------------------------------------------------------ */

        normalizeTrack(t) {
            if (!t) return null;
            const album = (Array.isArray(t.albums) ? t.albums[0] : null) || {};
            const position = album.trackPosition || {};
            return {
                trackId: String(t.id ?? t.trackId ?? ''),
                title: t.title || 'Unknown',
                artists: (Array.isArray(t.artists) ? t.artists : []).map((a) => ({ name: a?.name || 'Unknown Artist' })),
                album: album.title || '',
                albumId: album.id ?? null,
                year: album.year || null,
                genre: album.genre || '',
                coverUri: album.coverUri || t.coverUri || '',
                trackNumber: position.index ?? 1,
                trackTotal: album.trackCount ?? 1,
                discNumber: position.volume ?? 1,
                discTotal: album.volumes ?? 1,
                duration: t.durationMs ? Math.round(t.durationMs / 1000) : (t.duration || 0),
            };
        },

        /**
         * Пакетные метаданные. Один API-запрос на 50 треков вместо N запросов.
         * @param {Array<string|number>} trackIds
         */
        async getTracks(trackIds) {
            const ids = [...new Set((trackIds || []).map((x) => String(x)).filter(Boolean))];
            if (!ids.length) return [];

            const out = [];
            for (let i = 0; i < ids.length; i += 50) {
                const batch = ids.slice(i, i + 50);
                try {
                    const data = await this.apiFetch(`tracks?trackIds=${batch.join(',')}`);
                    const rows = Array.isArray(data?.result) ? data.result : [];
                    for (const row of rows) {
                        const meta = this.normalizeTrack(row);
                        if (meta?.trackId) {
                            out.push(meta);
                            this._metaCache.set(meta.trackId, meta);
                        }
                    }
                } catch (e) {
                    // Один битый/удалённый трек не должен ронять метаданные всей пачки,
                    // но ошибки авторизации пробрасываем — иначе качаем «Unknown».
                    if (e?.status === 401 || e?.status === 403) throw e;
                    warn(`getTracks(${batch.length}) failed:`, e?.message);
                }
            }
            return out;
        },

        async getCredits(trackId) {
            const data = await this.apiFetch(`tracks/${encodeURIComponent(trackId)}/credits/`);
            return data?.result?.credits || [];
        },

        /**
         * Прямой URL стрима из /get-file-info с HMAC-подписью.
         * @returns {Promise<{trackId: string, streamUrl: string, quality: string}>}
         */
        async getStream(trackId, quality) {
            if (!this.hasToken) throw new Error('Нет OAuth-токена — авторизуйтесь на music.yandex.ru');

            const id = String(trackId);
            const q = AUDIO_QUALITIES.includes(quality)
                ? quality
                : (localStorage.getItem('aYa_setting_audioQuality') || 'lossless');
            const ts = Math.floor(Date.now() / 1000);
            const codecs = 'flac';
            const transports = 'raw';

            const sign = await this.generateSign(SIGN_SECRET, `${ts}${id}${q}${codecs}${transports}`);
            const params = new URLSearchParams({
                ts: String(ts),
                trackId: id,
                quality: q,
                codecs,
                transports,
                sign,
            });

            const res = await fetch(`${API_URL}get-file-info?${params.toString()}&${QUERY_MARK}`, {
                headers: this.authHeaders(),
                credentials: 'omit',
            });
            if (!res.ok) {
                const err = new Error(`get-file-info HTTP ${res.status}`);
                err.status = res.status;
                throw err;
            }

            const data = await res.json();
            const url = data?.result?.downloadInfo?.url || data?.result?.downloadInfo?.[0]?.url;
            if (!url) throw new Error('В ответе /get-file-info нет downloadInfo.url');
            return { trackId: id, streamUrl: url, quality: q };
        },

        async generateSign(secretKey, data) {
            const encoder = new TextEncoder();
            const cryptoKey = await crypto.subtle.importKey(
                'raw', encoder.encode(secretKey),
                { name: 'HMAC', hash: { name: 'SHA-256' } },
                false, ['sign'],
            );
            const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
            return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/, '');
        },

        /* ------------------------------------------------------------------ */
        /* PAGE_STATE (альбом / плейлист / артист / чарт)                     */
        /* ------------------------------------------------------------------ */

        async parsePage() {
            const href = window.location.href;
            if (!/music\.yandex\./.test(href)) return;
            // Фиксируем URL сразу, чтобы наблюдатели не устраивали шторм повторных
            // запросов, если страница временно недоступна.
            this.lastParsedHref = href;

            try {
                let url = href;
                if (url.includes('/artist') && !url.endsWith('/tracks')) url = `${url}/tracks`;

                const response = await fetch(url, { credentials: 'same-origin' });
                if (!response.ok) return;

                const html = await response.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const scriptElements = doc.querySelectorAll('script');

                const pushRegex = /window\.__(?:PAGE_)?STATE_PATCHES__(?:\[['"][^'"]+['"]\])?(?:\s*=\s*.*?|\s*\|\|\s*.*?)*\.push\(([\s\S]*?)\);/g;
                const merged = [];

                scriptElements.forEach((script) => {
                    const content = script.textContent;
                    if (!content) return;
                    pushRegex.lastIndex = 0;
                    for (const match of content.matchAll(pushRegex)) {
                        const pushData = match[1]?.trim();
                        if (!pushData) continue;
                        try {
                            merged.push(new Function(`return ${pushData};`)());
                        } catch { /* кусок патча может быть невалидным — пропускаем */ }
                    }
                });

                const finalTree = this.mergeStatePatches(merged);

                if (Object.keys(finalTree).length) {
                    try {
                        localStorage.setItem('aYa_page', JSON.stringify(finalTree));
                        dispatch('appYa:storage-changed', { keys: ['aYa_page'] });
                    } catch { /* квота — не критично */ }
                    this.extractCollectionFromState(finalTree);
                    this.scanNextFlight(doc);
                    if (!this.readCollection()?.trackIds?.length) {
                        this.fetchPlaylistFromState(finalTree).catch(() => {});
                    }
                    log('PAGE_STATE обновлён', href);
                }
            } catch (e) {
                warn('parsePage failed:', e?.message);
            }
        },

        /* ------------------------------------------------------------------ */
        /* Плеер: текущий трек, обложка, ИИ-дизлайк                           */
        /* ------------------------------------------------------------------ */

        monitorPlayer() {
            if (HTMLMediaElement.prototype.__appYaPatched) return;
            HTMLMediaElement.prototype.__appYaPatched = true;
            const originalPlay = HTMLMediaElement.prototype.play;

            HTMLMediaElement.prototype.play = function patchedPlay(...args) {
                try {
                    if (!this.__appYaListeners) {
                        this.__appYaListeners = true;
                        this.addEventListener('loadstart', () => appYa.onMediaSrc(this));
                        this.addEventListener('play', () => appYa.onMediaSrc(this));
                    }
                    appYa.onMediaSrc(this);
                } catch (e) {
                    warn('media hook:', e?.message);
                }
                return originalPlay.apply(this, args);
            };
            log('ловушка HTMLMediaElement.play установлена');
        },

        onMediaSrc(media) {
            const src = media?.currentSrc || media?.src || '';
            if (!src || src === this.currentAudioStreamUrl) return;
            this.currentAudioStreamUrl = src;

            const match =
                src.match(/\.(\d+)\/(?:aac|mp3|mp4|flac)/) ||
                src.match(/\/track\/(\d+)/) ||
                src.match(/[?&](?:trackId|track_id)=(\d+)/) ||
                src.match(/\/(\d{5,})\/(?:aac|mp3|mp4|flac)/);

            if (!match || !match[1]) {
                // Новый фронтенд иногда прячет id в подписи URL иначе — берём из плеера
                this.syncCurrentTrackFromDom();
                return;
            }

            const trackId = match[1];
            if (trackId === this.currentTrackId) return;
            this.currentTrackId = trackId;

            this.loadCurrentTrack(trackId).catch((e) => warn('currentTrack:', e?.message));
        },

        /** id текущего трека из ссылки в баре плеера (устойчиво к формату стрима). */
        currentTrackIdFromDom() {
            const player = document.querySelector(
                '[class*="PlayerBar"], [class*="playerBar"], [class*="MainPlayer"], ' +
                '[class*="Player_root"], [class*="player-controls"], [data-testid*="player"], ' +
                'section[class*="Player"]'
            );
            if (!player) return null;
            const link = player.querySelector('a[href*="/track/"]');
            const match = (link?.getAttribute('href') || '').match(/\/track\/(\d+)/);
            return match ? match[1] : null;
        },

        /** Синхронизировать карточку текущего трека с баром плеера. */
        syncCurrentTrackFromDom() {
            const id = this.currentTrackIdFromDom();
            if (!id || id === this.currentTrackId) return;
            this.currentTrackId = id;
            this.loadCurrentTrack(id).catch((e) => warn('currentTrack(dom):', e?.message));
        },

        /** После перехода очистить карточку, если ничего не играет. */
        clearTrackIfNotPlaying() {
            const medias = [...document.querySelectorAll('audio, video')];
            const playing = medias.find((m) => !m.paused && (m.currentSrc || m.src));
            if (playing) return;
            if (!localStorage.getItem('aYa_cureitTrack')) return;
            try {
                localStorage.removeItem('aYa_cureitTrack');
                this.currentTrackId = '';
                this.currentAudioStreamUrl = '';
                dispatch('appYa:storage-changed', { keys: ['aYa_cureitTrack'] });
            } catch { /* noop */ }
        },

        async loadCurrentTrack(trackId) {
            const tracks = await this.getTracks([trackId]);
            const track = tracks[0];
            if (!track) return;

            let credits = [];
            try {
                credits = await this.getCredits(trackId);
            } catch { /* титры необязательны */ }

            localStorage.setItem('aYa_cureitTrack', JSON.stringify({ trackinfo: track, credits }));
            dispatch('appYa:storage-changed', { keys: ['aYa_cureitTrack'] });

            this.renderFloatingButton(trackId);
            this.handleAiTrack(credits);
        },

        handleAiTrack(credits) {
            const aiSetting = localStorage.getItem('aYa_setting_aiSuspicion');
            const isAI = (credits || []).some((c) =>
                c?.title === 'Использование ИИ' ||
                (c?.value && String(c.value).toLowerCase().includes('использование ии'))
            );
            if (!isAI) return;

            if (aiSetting !== 'true') {
                log('ИИ-трек найден, но дизлайк отключён настройкой aiSuspicion');
                return;
            }

            const dislike = document.querySelector('[aria-label="Не нравится"]:not([aria-pressed="true"])');
            const next = document.querySelector('[aria-label="Следующая песня"]');
            if (dislike) dislike.click();
            else if (next) next.click();
        },

        /* ------------------------------------------------------------------ */
        /* Кнопка скачивания на странице                                      */
        /* ------------------------------------------------------------------ */

        requestDownload(trackId, playlistName = 'music') {
            dispatch('appYa:download-request', { trackId: String(trackId), playlistName });
        },

        renderFloatingButton(trackId) {
            let btn = document.getElementById('appYa-floating-download-btn');

            if (!btn) {
                if (!document.getElementById('appYa-btn-animations')) {
                    const style = document.createElement('style');
                    style.id = 'appYa-btn-animations';
                    style.textContent = `
                        @keyframes appYaBounceAndPulse {
                            0%, 20%, 100% { transform: scale(1) translateY(0); box-shadow: 0 4px 14px rgba(0,0,0,.35), inset 0 2px 4px rgba(255,255,255,.2); }
                            5% { transform: scale(1.1) translateY(-8px); box-shadow: 0 12px 24px rgba(34,197,94,.5), inset 0 2px 4px rgba(255,255,255,.4); }
                            10% { transform: scale(.95) translateY(2px); }
                            15% { transform: scale(1.05) translateY(-2px); }
                        }`;
                    document.head.appendChild(style);
                }

                btn = document.createElement('div');
                btn.id = 'appYa-floating-download-btn';

                let savedCoords = { bottom: '95px', right: '25px' };
                try { savedCoords = JSON.parse(localStorage.getItem('aYa_btn_coords_pct')) || savedCoords; } catch { /* noop */ }

                Object.assign(btn.style, {
                    position: 'fixed',
                    bottom: savedCoords.bottom,
                    right: savedCoords.right,
                    top: 'auto',
                    left: 'auto',
                    width: '50px',
                    height: '50px',
                    borderRadius: '50%',
                    backgroundColor: '#22c55e',
                    boxShadow: '0 4px 14px rgba(0,0,0,.35), inset 0 2px 4px rgba(255,255,255,.2)',
                    cursor: 'grab',
                    zIndex: '999999',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    userSelect: 'none',
                    touchAction: 'none',
                    animation: 'appYaBounceAndPulse 5s infinite ease-in-out',
                    transition: 'transform .3s cubic-bezier(.175,.885,.32,1.275), background-color .2s ease, box-shadow .2s ease',
                });

                btn.onmouseenter = () => { if (!btn.dataset.dragging) { btn.style.animationPlayState = 'paused'; btn.style.transform = 'scale(1.12) translateY(-2px)'; } };
                btn.onmouseleave = () => { if (!btn.dataset.dragging) { btn.style.animationPlayState = 'running'; btn.style.transform = 'scale(1) translateY(0)'; } };

                let isDragging = false;
                let startX = 0, startY = 0, startRightPx = 0, startBottomPx = 0;

                const onMove = (e) => {
                    if (!isDragging) return;
                    const newRight = Math.max(0, Math.min(startRightPx + (startX - e.clientX), window.innerWidth - btn.offsetWidth));
                    const newBottom = Math.max(0, Math.min(startBottomPx + (startY - e.clientY), window.innerHeight - btn.offsetHeight));
                    btn.style.right = `${newRight}px`;
                    btn.style.bottom = `${newBottom}px`;
                };

                const onUp = () => {
                    if (!isDragging) return;
                    isDragging = false;
                    delete btn.dataset.dragging;
                    btn.style.cursor = 'grab';
                    btn.style.transition = 'transform .3s cubic-bezier(.175,.885,.32,1.275), background-color .2s ease, box-shadow .2s ease';
                    btn.style.transform = 'scale(1)';
                    btn.style.animation = 'appYaBounceAndPulse 5s infinite ease-in-out';

                    const rect = btn.getBoundingClientRect();
                    const coords = {
                        right: `${((window.innerWidth - rect.right) / window.innerWidth) * 100}%`,
                        bottom: `${((window.innerHeight - rect.bottom) / window.innerHeight) * 100}%`,
                    };
                    localStorage.setItem('aYa_btn_coords_pct', JSON.stringify(coords));
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };

                btn.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    isDragging = true;
                    btn.dataset.dragging = 'true';
                    btn.style.cursor = 'grabbing';
                    btn.style.animation = 'none';
                    btn.style.transition = 'none';

                    const rect = btn.getBoundingClientRect();
                    startRightPx = window.innerWidth - rect.right;
                    startBottomPx = window.innerHeight - rect.bottom;
                    startX = e.clientX;
                    startY = e.clientY;

                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });

                document.body.appendChild(btn);
            }

            btn.dataset.trackId = String(trackId);
            btn.style.backgroundColor = '#22c55e';
            btn.style.pointerEvents = 'auto';
            btn.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>`;

            btn.onclick = (event) => {
                if (btn.dataset.dragging) return;
                event.stopPropagation();
                const id = btn.dataset.trackId || trackId;
                btn.style.animation = 'none';
                btn.style.backgroundColor = '#3b82f6';
                btn.style.pointerEvents = 'none';
                btn.innerHTML = '<span style="color:#fff;font-weight:700;font-size:10px;">В очередь</span>';
                appYa.requestDownload(id, 'music');

                setTimeout(() => {
                    btn.style.pointerEvents = 'auto';
                    btn.style.backgroundColor = '#22c55e';
                    btn.style.animation = 'appYaBounceAndPulse 5s infinite ease-in-out';
                    btn.innerHTML = `
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>`;
                }, 1500);
            };
        },

        processPlayButtons() {
            const nodes = document.querySelectorAll('div[class*="Track_root__"],div[class*="TrackCard_root__"]');
            nodes.forEach((node) => {
                const link = node.querySelector('a[class*="Meta_albumLink__"],a[class*="TrackCard_titleLink__"],a[href*="/track/"]');
                const meta = node.querySelector('div[class*="Meta_titleContainer"],div[class*="TrackCard_titleContainer"]');
                if (!link || !meta || meta.querySelector('button.appYa-added')) return;

                const match = (link.getAttribute('href') || '').match(/\/track\/(\d+)/);
                if (!match) return;

                const trackId = match[1];
                const button = document.createElement('button');
                button.textContent = 'Скачать';
                button.className = 'appYa-added';
                button.setAttribute('style', 'background-color:#fc3;color:#000;border-radius:4px;display:flex;cursor:pointer;border:none;padding:4px 10px;position:absolute;left:40%;top:35px;z-index:9999;');
                meta.appendChild(button);

                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    button.textContent = 'В очередь…';
                    button.disabled = true;
                    appYa.requestDownload(trackId, 'music');
                    setTimeout(() => {
                        button.textContent = 'Скачать';
                        button.disabled = false;
                    }, 1200);
                });
            });
        },

        /* ------------------------------------------------------------------ */
        /* Наблюдатели                                                        */
        /* ------------------------------------------------------------------ */

        startWatchers() {
            document.addEventListener('appYa:url-changed', () => this.onUrlChanged());
            document.addEventListener('appYa:network', () => this.drainNetworkQueue());

            const debounced = (fn, wait = 400) => {
                let timer = null;
                return (...args) => {
                    clearTimeout(timer);
                    timer = setTimeout(() => fn(...args), wait);
                };
            };

            const onDomChanged = debounced(() => {
                this.processPlayButtons();
                this.syncCurrentTrackFromDom();

                if (window.location.href !== this.lastParsedHref) {
                    this.onUrlChanged();
                    return;
                }

                // Данные коллекции могли догрузиться после гидратации — сканируем
                // отрисованное состояние, пока не появится aYa_collection.
                const info = this.pathInfo();
                if (info && !this.readCollection()) {
                    clearTimeout(this._scanTimer);
                    this._scanTimer = setTimeout(() => {
                        this.scanPageStateFromDom();
                        this.scanNextFlight();
                        this.syncCurrentTrackFromDom();
                    }, 900);
                }
            }, 500);

            if (this._observer) this._observer.disconnect();
            this._observer = new MutationObserver(onDomChanged);
            this._observer.observe(document.documentElement, { childList: true, subtree: true });

            // SPA-переходы: pushState/replaceState + popstate + резервный опрос URL
            window.addEventListener('popstate', () => this.onUrlChanged());
            for (const method of ['pushState', 'replaceState']) {
                const original = history[method];
                if (!original || original.__appYa) continue;
                const wrapped = function wrappedHistory(...args) {
                    const result = original.apply(this, args);
                    appYa.onUrlChanged();
                    return result;
                };
                wrapped.__appYa = true;
                try { history[method] = wrapped; } catch { /* некоторые браузеры запрещают */ }
            }

            clearInterval(this._urlTimer);
            this._urlTimer = setInterval(() => {
                if (window.location.href !== this.lastParsedHref) this.onUrlChanged();
            }, 2000);
        },

        /** Прочитать текущую коллекцию из localStorage. */
        readCollection() {
            try { return JSON.parse(localStorage.getItem('aYa_collection') || 'null'); } catch { return null; }
        },

        /** Реакция на смену URL (SPA или полная навигация). */
        onUrlChanged() {
            const href = window.location.href;
            if (href === this.lastParsedHref) return;
            this.lastParsedHref = href;
            this.currentTrackId = '';
            this._collectionRecoveryTried = false;
            this.publishLocation();
            this.resetStaleCollection();

            setTimeout(() => {
                this.scanPageStateFromDom();
                this.scanNextFlight();
                this.syncCurrentTrackFromDom();
                this.clearTrackIfNotPlaying();
            }, 600);

            setTimeout(() => {
                this.scanPageStateFromDom();
                this.scanNextFlight();
                this.syncCurrentTrackFromDom();
                this.clearTrackIfNotPlaying();
                this.recoverCollectionFromPerformance()
                    .then((found) => found || this.resolveCollectionFromApi())
                    .catch(() => {});
                this.parsePage().catch(() => {});
            }, 2500);
        },

        /* ------------------------------------------------------------------ */
        /* API для service worker                                             */
        /* ------------------------------------------------------------------ */

        async handleOp(op, payload = {}) {
            switch (op) {
                case 'ping':
                    return { ok: true, hasToken: this.hasToken, href: window.location.href };
                case 'tracks':
                    return this.getTracks(payload.trackIds || []);
                case 'stream':
                    return this.getStream(String(payload.trackId || ''), payload.quality);
                case 'credits':
                    return this.getCredits(String(payload.trackId || ''));
                case 'page': {
                    const raw = localStorage.getItem('aYa_page');
                    return raw ? JSON.parse(raw) : null;
                }
                default:
                    throw new Error(`Неизвестная операция parser.js: ${op}`);
            }
        },
    };

    window.appYa = appYa;
    // Перехват сети ставим сразу, ещё до инициализации страницы: иначе первые
    // API-запросы (плейлисты/альбомы) пройдут мимо нас.
    appYa.monitorNetwork();
    log(`${BRAND} — parser.js загружен`);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => appYa.init(), { once: true });
    } else {
        appYa.init();
    }
})();
