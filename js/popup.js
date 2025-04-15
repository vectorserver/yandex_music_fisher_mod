console.log('js/popup.js');

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
    updateUI(data, appYa_tabID,app) {
        const parsedData = parser.parseStorage(data);
        const cQ = app?.app_setting?.coverQuality??300;
        var cQR = `${cQ}x${cQ}`;
        console.log('coverQuality',cQR)

        const authorizationPanel = document.getElementById('authorization');
        const authorizationBtn = authorizationPanel.querySelector('#authorize');


        if (parsedData.appYa_token) {
            this.updateTrackInfo(parsedData, appYa_tabID,cQR);
            this.updatePlaylistInfo(parsedData, appYa_tabID,cQR);
            let checktokenData = uiUpdater.getTokenExpirationDate(parsedData.appYa_token);
            tokenEnd.innerText = checktokenData;
            tokenEndUrl.addEventListener('click', function () {
                //localStorage.clear()
                const dataToInject = `localStorage.clear();window.location.reload();`;
                chrome.scripting.executeScript({
                    target: {tabId: appYa_tabID},
                    func: (injectedData) => eval(injectedData),
                    args: [dataToInject],
                    world: "MAIN",
                }, (results) => {
                    window.close();
                });
            });
            //console.log('parsedData',parsedData)
            //console.log('appYa_page',parsedData.appYa_page)
        } else {
            authorizationPanel.style.display = 'flex';
            authorizationBtn.setAttribute('href', parsedData.appYa_authorizationUrl);

            setTimeout(() => {
                authorizationBtn.addEventListener('click', () => {
                    chrome.tabs.remove(appYa_tabID, (error) => {
                        if (chrome.runtime.lastError) {
                            console.error(chrome.runtime.lastError);
                        } else {
                            console.log('Вкладка закрыта.');
                        }
                    });
                });
            }, 1500);
        }
    },

    updateTrackInfo(parsedData, appYa_tabID,cQR) {
        if (!parsedData.appYa_cureitTrack) {
            document.querySelector('body .container-fluid').innerHTML =
                'Включите трек, Яндекс Музыки, потом вернитесь сюда)';
            return;
        }

        workPanel.style.display = 'flex';
        const track = parsedData.appYa_cureitTrack.trackinfo;
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
            eventHandlers.downloadTracks(appYa_tabID, [track.id], 'music');
        });
    },

    updatePlaylistInfo(parsedData, appYa_tabID,cQR) {
        const playlist = parsedData.appYa_page.playlist;
        const artist = parsedData.appYa_page.artist;
        const album = parsedData.appYa_page.album;
        const chart = parsedData.appYa_page.chart;

        //console.log('parsedData.appYa_page',parsedData.appYa_page)


        if (playlist && playlist.items && playlist.meta) {
            const title = playlist.meta.title.replace(':', '_');
            const trackIds = playlist.items.map(track => track.id);
            const coverUri = `https://${playlist.meta.coverUri.replace(/%%/g, cQR)}`;
            const meta = `Автор плейлиста: ${playlist.meta.owner.name}<br>Кол-во треков: ${playlist.items.length}`;

            playlistPanelTitle.innerText = `Плейлист: ${title}`;
            playlistPanelMeta.innerHTML = meta;
            playlistPanelImage.src = coverUri;


            playlistPanelMetaDownloadBtn.innerText = 'Скачать плейлист';
            playlistPanelMetaDownloadBtn.style.display = 'flex';
            playlistPanelMetaDownloadBtn.addEventListener('click', () => {
                eventHandlers.downloadTracks(appYa_tabID, trackIds, `playlist/${title}`);
            });
        } else if (artist && artist?.fullTracksListSubpage?.ids?.length) {
            console.log('artist', artist)
            const title = artist.meta.artist.name.replace(':', '_');
            const coverUri = `https://${artist.meta.artist.coverUri.replace(/%%/g, cQR)}`;
            const trackIds = artist.fullTracksListSubpage.ids;
            playlistPanelTitle.innerText = `Артист: ${title}`;
            playlistPanelImage.src = coverUri;

            playlistPanelMetaDownloadBtn.querySelector('.text').innerText = 'Скачать все треки артиста';
            playlistPanelMetaDownloadBtn.querySelector('.counter').innerText = `${trackIds.length}`;


            playlistPanelMetaDownloadBtn.style.display = 'flex';
            playlistPanelMetaDownloadBtn.addEventListener('click', () => {

                eventHandlers.downloadTracks(appYa_tabID, trackIds, `artist/${escapeFileName(title)}`);
            });

            //popularTracks

            //albums
            let tpl_albums = `<hr><div id="popularTracks">
                                <strong>Альбомы</strong>
                                <div class="list-group">
                                ${artist.albums.map(al => {
                let url = `${parsedData.appYa_hosting}/album/${al.id}`;
                return `<a  class="album-link list-group-item list-group-item-action" data-urlTab="${url}" href="#">${al.title} - ${al.year} <span class="badge bg-danger">${al.trackCount}</span></a>`;
            }).join('\n')}
                                </div>
                                </div>`
            playlistPanelMetaotherData.innerHTML += tpl_albums;
            document.addEventListener('click', function (event) {
                const url = event.target.getAttribute('data-urlTab');
                eventHandlers.changeTabUrl(appYa_tabID, url)
            });


        } else if (album && album?.items?.length) {

            const year = album.meta?.year ? ' - ' + album.meta.year : '';
            const title = album.meta.title.replace(':', '_') + year;
            const trackIds = album.items.map(track => track.id);
            const coverUri = `https://${album.meta.coverUri.replace(/%%/g, cQR)}`;

            playlistPanelTitle.innerText = `Альбом: ${title}`;
            playlistPanelImage.src = coverUri;

            playlistPanelMetaDownloadBtn.querySelector('.text').innerText = 'Скачать все треки альбома';
            playlistPanelMetaDownloadBtn.querySelector('.counter').innerText = `${trackIds.length}`;

            playlistPanelMetaDownloadBtn.style.display = 'flex';
            playlistPanelMetaDownloadBtn.addEventListener('click', () => {
                eventHandlers.downloadTracks(appYa_tabID, trackIds, `album/${escapeFileName(title)}`);
            });


        } else if (chart && chart?.tracksSubPage?.items?.length) {

            const trackIds = chart.tracksSubPage.items.map(track => track.id);
            //const coverUri = `https://${album.meta.coverUri.replace(/%%/g, cQR)}`;

            //playlistPanelTitle.innerText = `Чарт`;
            //playlistPanelImage.src = coverUri;

            playlistPanelMetaDownloadBtn.querySelector('.text').innerText = 'Скачать ЧАРТ';
            playlistPanelMetaDownloadBtn.querySelector('.counter').innerText = `${trackIds.length}`;

            playlistPanelMetaDownloadBtn.style.display = 'flex';
            playlistPanelMetaDownloadBtn.addEventListener('click', () => {
                eventHandlers.downloadTracks(appYa_tabID, trackIds, `chart`);
            });


        } else {
            col_one.classList.add('col-12');
            col_two.classList.add('d-none');
            section.style.width = '240px';

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
        storageService.getStorageData((result) => {
            //console.log('ss',result)
            if (result.appYa_db) {



                uiUpdater.updateUI(result.appYa_db, result.appYa_tabID,result);

                storageService.monitorStorageChanges((changes) => {
                    const { newValue, oldValue } = changes.appYa_db;
                    if (newValue?.appYa_cureitTrack !== oldValue?.appYa_cureitTrack || newValue?.appYa_page !== oldValue?.appYa_page) {
                        window.location.reload();
                    }
                });


            } else {
                console.log('Нет данных в chrome.storage.local');
                document.querySelector('body .container-fluid').innerHTML = 'Обновите страницу, Яндекс Музыки, потом вернитесь сюда)';
                window.location.reload();
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
                    console.log('URL успешно изменен на:', url);
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
