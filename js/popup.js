console.log('[appYa] js/popup.js');

const appVersion = document.getElementById('appv');
const appVersionLogin = document.getElementById('appvLogin');
const manifestData = chrome.runtime.getManifest();
if (appVersion && manifestData.version) {
    appVersion.textContent = manifestData.version;
    appVersionLogin.textContent = manifestData.version;
}
const section = document.querySelector('section');
const col_one = document.getElementById('col1');
const col_two = document.getElementById('col2');
const workPanel = document.getElementById('work_panel');
const playlistPanel = document.getElementById('playlistPanel');
const playlistPanelTitle = document.getElementById('playlistPanelTitle');
const playlistPanelImage = document.getElementById('playlistPanelImage');
const playlistPanelMeta = document.getElementById('playlistPanelMeta');
const playlistPanelMetaotherData = document.getElementById('playlistPanelMetaotherData');
const playlistPanelMetaDownloadBtn = document.getElementById('playlistPanelMetaDownloadBtn');
const tokenEnd = document.getElementById('tokenEnd');
const tokenEndUrl = document.getElementById('tokenEndUrl');
const escapeFileName = (fileName) => fileName.replace(/[\\/:*?"<>|]/g, '_');


document.getElementById('open-settings').addEventListener('click', function () {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('html/options.html'));
    }
});


// Сервис для работы с chrome.storage.local
const storageService = {
    getStorageData(callback) {
        chrome.storage.local.get((result) => callback(result));
    },
    saveStorageData(key, value) {
        chrome.storage.local.set({[key]: value});
    },
    monitorStorageChanges(callback) {
        chrome.storage.onChanged.addListener((changes, areaName) => {

            callback(changes);

        });
    }
};

// Обновление пользовательского интерфейса
const uiUpdater = {
    updateUI(data, aYa_tabID, app) {
        const parsedData = parser.parseStorage(data);
        const cQ = app?.app_setting?.coverQuality ?? 300;
        var cQR = `${cQ}x${cQ}`;
        console.log('[appYa] coverQuality', cQR)

        const authorizationPanel = document.getElementById('authorization');
        const authorizationBtn = authorizationPanel.querySelector('#authorize');


        if (parsedData.aYa_token) {
            this.updateTrackInfo(parsedData, aYa_tabID, cQR);
            this.updatePlaylistInfo(parsedData, aYa_tabID, cQR);
            let checktokenData = uiUpdater.getTokenExpirationDate(parsedData.aYa_token);
            tokenEnd.innerText = checktokenData;
            tokenEndUrl.addEventListener('click', function () {
                //localStorage.clear()
                const dataToInject = `localStorage.clear();window.location.reload();`;
                chrome.scripting.executeScript({
                    target: {tabId: aYa_tabID},
                    func: (injectedData) => eval(injectedData),
                    args: [dataToInject],
                    world: "MAIN",
                }, (results) => {
                    window.close();
                });
            });
            //console.log('[appYa] parsedData',parsedData)
            //console.log('[appYa] aYa_page',parsedData.aYa_page)
        } else {
            authorizationPanel.style.display = 'flex';
            authorizationBtn.setAttribute('href', parsedData.aYa_authorizationUrl);
            if (!parsedData.aYa_authorizationUrl){
                authorizationPanel.innerText='Для начала перейди на https://music.yandex.ru/';
            }

            setTimeout(() => {
                authorizationBtn.addEventListener('click', () => {
                    chrome.tabs.remove(aYa_tabID, (error) => {
                        if (chrome.runtime.lastError) {
                            console.error(chrome.runtime.lastError);
                        } else {
                            console.log('[appYa] Вкладка закрыта.');
                        }
                    });
                });
            }, 1500);
        }
    },

    updateTrackInfo(parsedData, aYa_tabID, cQR) {
        console.log('[appYa] updateTrackInfo', parsedData, aYa_tabID, cQR)
        if (!parsedData.aYa_cureitTrack) {
            document.querySelector('body .container-fluid').innerHTML =
                'Включите трек, Яндекс Музыки, потом вернитесь сюда)';
            return;
        }

        workPanel.style.display = 'flex';
        const track = parsedData.aYa_cureitTrack.trackinfo;
        const imageURL = `https://${track.coverUri.replace(/%%/g, cQR)}`;
        const artists = track.artists.map((item) => item.name).join(', ');
        const albums = track.albums.map((item) => item.year).join(', ');

        document.getElementById('trackName').innerText = track.title;
        document.getElementById('artistsList').innerHTML = `${artists}<br>${albums}`;
        document.getElementById('trackImage').src = imageURL;

        //section.style.backgroundColor = track.derivedColors.average;
        //section.style.color = track.derivedColors.waveText;
        //playlistPanelMetaDownloadBtn.style.backgroundColor = track.derivedColors.miniPlayer;
        document.querySelector('#trackPanel').style.backgroundColor = track.derivedColors.accent;

        document.getElementById('downloadButton').addEventListener('click', () => {
            eventHandlers.downloadTracks(aYa_tabID, [track.id], 'music');
        });
    },

    updatePlaylistInfo(parsedData, aYa_tabID, cQR) {
        const pageThis = parsedData.aYa_page?.location?.pathname?.split('/')[1] ?? '';
        const pageData = parsedData.aYa_page;
        console.log('[appYa] pageThis', pageThis, pageData);
        let year = '';
        let title = '';
        let trackIds = [];
        let coverUri = '';
        let artistnames = '';
        let totalTracks = 0;
        let type = '';

        switch (pageThis) {
            case 'chart':
                title = pageData.tracksSubPage.title
                trackIds = (Array.isArray(pageData.tracksSubPage.items) ? pageData.tracksSubPage.items : Object.values(pageData.tracksSubPage.items)).map(track => track?.id);

                playlistPanelTitle.innerText = `${title}`;

                playlistPanelMetaDownloadBtn.querySelector('.text').innerText = 'Скачать все треки Чарта';
                playlistPanelMetaDownloadBtn.querySelector('.counter').innerText = `${trackIds.length}`;

                playlistPanelMetaDownloadBtn.style.display = 'flex';
                playlistPanelMetaDownloadBtn.addEventListener('click', () => {
                    eventHandlers.downloadTracks(aYa_tabID, trackIds, `chart`);
                });

                break;
            case 'album':
                year = pageData.album.meta.year ? ` - ${pageData.album.meta.year}` : "";
                title = pageData.album.meta.title.replace(':', '_') + year;
                trackIds = (Array.isArray(pageData.album.items) ? pageData.album.items : Object.values(pageData.album.items)).map(track => track?.id);
                coverUri = `https://${pageData.album.meta.coverUri.replace(/%%/g, cQR)}`;
                type = 'album';
                if (pageData.album.meta.type) {
                    type = pageData.album.meta.type;
                }


                playlistPanelTitle.innerText = `Альбом: ${title}`;
                playlistPanelImage.src = coverUri;

                if (pageData.album.meta.artists) {
                    artistnames = pageData.album.meta.artists.map(name => name?.name).join(', ');
                    playlistPanelMeta.innerText = artistnames;
                }


                playlistPanelMetaDownloadBtn.querySelector('.text').innerText = 'Скачать все треки альбома';
                playlistPanelMetaDownloadBtn.querySelector('.counter').innerText = `${trackIds.length}`;

                playlistPanelMetaDownloadBtn.style.display = 'flex';
                playlistPanelMetaDownloadBtn.addEventListener('click', () => {
                    eventHandlers.downloadTracks(aYa_tabID, trackIds, `${type}/${escapeFileName(title)}`);
                });

                break;

            case 'artist':

                title = pageData.artist.meta.artist.name;

                coverUri = `https://${pageData.artist.meta.artist.coverUri.replace(/%%/g, cQR)}`;

                if (pageData.artist.familiarSubpage) {
                    trackIds = pageData.artist.familiarSubpage.vibeTracks.map(track => track?.id);
                    title = `Знакомое вам от - ${title}`;
                } else {
                    trackIds = pageData.artist.fullTracksListSubpage.ids;
                }

                playlistPanelTitle.innerText = `Исполнитель: ${title}`;
                playlistPanelImage.src = coverUri;

                if (pageData.artist.meta.artists) {
                    artistnames = pageData.artist.meta.artists.map(name => name?.name).join(', ');
                    playlistPanelMeta.innerText = artistnames;
                }

                playlistPanelMetaDownloadBtn.querySelector('.text').innerText = 'Скачать треки артиста';
                playlistPanelMetaDownloadBtn.querySelector('.counter').innerText = `${trackIds.length}`;

                playlistPanelMetaDownloadBtn.style.display = 'flex';
                playlistPanelMetaDownloadBtn.addEventListener('click', () => {
                    eventHandlers.downloadTracks(aYa_tabID, trackIds, `artist/${escapeFileName(title)}`);
                });
                break;
            case 'playlists':
            case 'playlist':

                title = pageData.playlist.meta.title;
                coverUri = `https://${pageData.playlist.meta.coverUri.replace(/%%/g, cQR)}`;
                trackIds = (Array.isArray(pageData.playlist.items) ? pageData.playlist.items : Object.values(pageData.playlist.items)).map(track => track?.id);
                totalTracks = trackIds.length;
                playlistPanelTitle.innerText = `${title}`;
                playlistPanelImage.src = coverUri;
                playlistPanelMeta.innerHTML = `Автор: ${pageData.playlist.meta.owner.name}<br>Кол-во: ${totalTracks}`;

                let rangeWrapper = document.getElementById('playlistDownloadWrapper');
                if (!rangeWrapper) {
                    rangeWrapper = document.createElement('div');
                    rangeWrapper.id = 'playlistDownloadWrapper';
                    rangeWrapper.style.marginBottom = '15px';

                    rangeWrapper.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 0.9rem;">
                <span id="rangeLabelText" class="text-muted">Выбрано треков:</span>
                <b id="rangeValueDisplay" class="text-primary">1 — ${totalTracks}</b>
            </div>
            <div class="range-controls px-1">
                <small class="text-muted" style="font-size: 0.7rem;">От:</small>
                <input type="range" class="form-range" id="rangeStart" min="1" step="1">
                <small class="text-muted" style="font-size: 0.7rem;">До:</small>
                <input type="range" class="form-range" id="rangeEnd" min="1" step="1">
            </div>
        `;
                    playlistPanelMetaDownloadBtn.parentNode.insertBefore(rangeWrapper, playlistPanelMetaDownloadBtn);
                }

                const rStart = document.getElementById('rangeStart');
                const rEnd = document.getElementById('rangeEnd');
                const rDisplay = document.getElementById('rangeValueDisplay');

                // Настройка параметров (показываем только если треков > 1)
                if (totalTracks > 1) {
                    rangeWrapper.style.display = 'block';
                    rStart.max = totalTracks;
                    rEnd.max = totalTracks;

                    // По умолчанию — ВСЕ
                    rStart.value = 1;
                    rEnd.value = totalTracks;

                    const updateRangeUI = () => {
                        let s = parseInt(rStart.value);
                        let e = parseInt(rEnd.value);

                        // Валидация: начало не может быть больше конца
                        if (s > e) {
                            rStart.value = e;
                            s = e;
                        }

                        rDisplay.innerText = (s === 1 && e === totalTracks)
                            ? `Все (${totalTracks})`
                            : `${s} — ${e} (шт: ${e - s + 1})`;
                    };

                    rStart.oninput = updateRangeUI;
                    rEnd.oninput = updateRangeUI;
                    updateRangeUI();
                } else {
                    rangeWrapper.style.display = 'none';
                }

                playlistPanelMetaDownloadBtn.innerText = 'Скачать выбранное';
                playlistPanelMetaDownloadBtn.style.display = 'flex';
                playlistPanelMetaDownloadBtn.style.width = '100%';

                playlistPanelMetaDownloadBtn.onclick = () => {
                    const startIdx = parseInt(rStart.value) - 1; // в индекс массива
                    const endIdx = parseInt(rEnd.value);

                    // Формируем массив согласно выбранному диапазону
                    const idsToDownload = trackIds.slice(startIdx, endIdx);

                    eventHandlers.downloadTracks(aYa_tabID, idsToDownload, `playlist/${title}`);
                };


                break;
            default:
                col_one.classList.add('col-12');
                col_two.classList.add('d-none');
                section.style.width = '280px';

        }


    },
    getTokenExpirationDate(tokenData) {
        // Получаем текущее время в миллисекундах
        const currentTime = Date.now();

        // Преобразуем expires_in из секунд в миллисекунды
        const expiresInMillis = tokenData.expires_in * 1000;

        // Рассчитываем дату истечения токена
        const expirationDate = new Date(currentTime + expiresInMillis);

        // Форматируем дату в формате "день.месяц.год"
        const day = String(expirationDate.getDate()).padStart(2, '0');
        const month = String(expirationDate.getMonth() + 1).padStart(2, '0'); // Месяцы в JavaScript начинаются с 0
        const year = expirationDate.getFullYear();

        return `${day}.${month}.${year}`;
    }
};

// Обработчики событий
const eventHandlers = {
    init() {
        document.addEventListener('DOMContentLoaded', this.onDOMContentLoaded);
    },

    onDOMContentLoaded() {
        //Первичный запрос данных при открытии popup
        storageService.getStorageData((result) => {
            if (result.aYa_db) {
                uiUpdater.updateUI(result.aYa_db, result.aYa_tabID, result);
            } else {
                console.log('[appYa] Нет данных в chrome.storage.local');
                document.querySelector('body .container-fluid').innerHTML = 'Обновите страницу Яндекс Музыки, потом вернитесь сюда)';
            }
        });

        //Постоянный мониторинг изменений (на одном уровне, а не внутри колбэка)
        storageService.monitorStorageChanges((changes) => {
            // Проверяем, затронули ли изменения именно ключ aYa_db
            if (changes.aYa_db) {
                const {newValue, oldValue} = changes.aYa_db;

                // Используем ?. на случай, если oldValue или newValue равны undefined
                if (newValue?.aYa_cureitTrack !== oldValue?.aYa_cureitTrack ||
                    newValue?.aYa_page !== oldValue?.aYa_page) {

                    window.location.reload();
                }
            }
        });
    },

    downloadTracks(tabId, trackIds, playlistName) {
        chrome.runtime.sendMessage({
            action: "download_Tracks",
            tabId: tabId,
            trackIds: trackIds,
            playlistName: playlistName
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Ошибка отправки данных в service_worker.js:", chrome.runtime.lastError.message);
            } else {
                console.log("Ответ от service_worker.js:", response);
            }
        });
    },
    changeTabUrl(tabId, url) {
        if (url) {
            window.close();
            chrome.tabs.update(tabId, {url: url}, function (tab) {
                if (chrome.runtime.lastError) {
                    console.error('Ошибка при изменении URL:', chrome.runtime.lastError);
                } else {
                    console.log('[appYa] URL успешно изменен на:', url);
                }
            });
        }


    }
};

// Парсинг данных
const parser = {
    parseStorage(data) {
        return Object.keys(data).reduce((acc, key) => {
            const value = data[key];
            try {
                if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                    acc[key] = JSON.parse(value);
                } else {
                    acc[key] = value;
                }
            } catch (error) {
                console.error(`Ошибка парсинга JSON для ключа ${key}:`, error);
                acc[key] = value;
            }
            return acc;
        }, {});
    }
};

// Инициализация событий
eventHandlers.init();
