console.log('js/popup.js');
document.addEventListener('DOMContentLoaded', () => {

// Получаем данные из chrome.storage.local при загрузке
    chrome.storage.local.get((result) => {
        if (result.appYa_db) {
            // console.log('Полученные данные из chrome.storage.local:', result.appYa_db);
            updateUI(result.appYa_db, result.appYa_tabID);
        } else {
            console.log('Нет данных в chrome.storage.local');
            document.querySelector('body .container-fluid').innerHTML = 'Обновите страницу, Яндекс Музыки, потом вернитесь сюда)';
        }
    });
});

// Отслеживание изменений в chrome.storage.local


// Обновление интерфейса
async function updateUI(data, appYa_tabID) {
    const parsedData = parseStorage(data);

    let authorization_panel = document.getElementById('authorization');
    let authorization_btn = authorization_panel.querySelector('#authorize');

    let work_panel = document.getElementById('work_panel');
    let playlistPanel = document.getElementById('playlistPanel');

    if (parsedData.appYa_token) {
        console.log('data_panel', parsedData);

        if (!parsedData.appYa_cureitTrack) {
            document.querySelector('body .container-fluid').innerHTML = 'Включите трек, Яндекс Музыки, потом вернитесь сюда)';
            return false;
        }

        work_panel.style.display = 'flex';
        let appYa_cureitTrack = parsedData.appYa_cureitTrack;
        console.log('appYa_cureitTrack', appYa_cureitTrack)

        let imageURL = 'https://' + appYa_cureitTrack.trackinfo.coverUri.replace(/%%/g, '200x200');
        let title = appYa_cureitTrack.trackinfo.title;
        let artistsData = '';
        if (appYa_cureitTrack.trackinfo.artists) {
            artistsData += appYa_cureitTrack.trackinfo.artists.map((item) => item.name).join(', ');
        }

        if (appYa_cureitTrack.trackinfo.albums) {
            artistsData += '<br>' + appYa_cureitTrack.trackinfo.albums.map((item) => item.year).join(', ');
        }

        document.getElementById('trackName').innerHTML = title;
        document.getElementById('artistsList').innerHTML = artistsData;
        document.getElementById('trackImage').src = imageURL;


        //style

        document.querySelector('body').style.backgroundColor = appYa_cureitTrack.trackinfo.derivedColors.average;
        document.querySelector('body').style.color = appYa_cureitTrack.trackinfo.derivedColors.waveText;



        document.getElementById('downloadButton').addEventListener('click', async function () {
            // Отправляем данные в service_worker.js на загрузку
            chrome.runtime.sendMessage({
                action: "download_Tracks",
                tabId: appYa_tabID,
                trackIds: [appYa_cureitTrack.trackinfo.id],
                playlistName: `music`,

            }, (response) => {
                if (chrome.runtime.lastError) {
                    //console.error("Ошибка отправки данных в background.js:", chrome.runtime.lastError.message);
                } else {
                    //console.log("Ответ от background.js на send_localStorage:", response);
                }
            });

        });


        //pl
        if (parsedData.appYa_page.playlist && parsedData.appYa_page.playlist.items && parsedData.appYa_page.playlist.meta) {

            let playlist = parsedData.appYa_page.playlist;
            let pltitle = playlist.meta.title.replace(':', '_').toString();
            playlistPanel.querySelector('#title').innerText = pltitle;
            let coverUri = 'https://' + playlist.meta.coverUri.replace(/%%/g, '200x200');

            let meta = `Автор плейлиста: ${playlist.meta.owner.name}\n`;
            meta += `Кол-во треков: ${playlist.items.length}\n`
            playlistPanel.querySelector('#meta').innerText = meta;
            playlistPanel.querySelector('#playlistImage').src = coverUri;

            let downloadButtonPl = playlistPanel.querySelector('#downloadButtonPl');
            downloadButtonPl.innerText = 'Скачать плейлист';
            downloadButtonPl.style.display = 'flex';
            downloadButtonPl.addEventListener('click', function () {

                const trackIds = playlist.items.map(track => track.id);
                // Отправляем данные в service_worker.js на загрузку
                chrome.runtime.sendMessage({
                    action: "download_Tracks",
                    tabId: appYa_tabID,
                    trackIds: trackIds,
                    playlistName: `music/playlist_${pltitle}`,

                }, (response) => {
                    if (chrome.runtime.lastError) {
                        //console.error("Ошибка отправки данных в background.js:", chrome.runtime.lastError.message);
                    } else {
                        //console.log("Ответ от background.js на send_localStorage:", response);
                    }
                });


            });


        }
        if (parsedData.appYa_page.artist && parsedData.appYa_page.artist.meta) {
            let artist = parsedData.appYa_page.artist;
            console.log('artist', artist);
            let pltitle = artist.meta.artist.name;
            let trackIds = artist.fullTracksListSubpage.ids;
            let coverUri = 'https://' + artist.meta.artist.coverUri.replace(/%%/g, '200x200');

            let meta = `Кол-во треков: ${trackIds.length}\n`
            playlistPanel.querySelector('#meta').innerText = meta;
            playlistPanel.querySelector('#title').innerText = pltitle;
            playlistPanel.querySelector('#playlistImage').src = coverUri;

            let downloadButtonPl = playlistPanel.querySelector('#downloadButtonPl');
            downloadButtonPl.innerText = 'Скачать плейлист';
            downloadButtonPl.style.display = 'flex';
            downloadButtonPl.addEventListener('click', function () {


                // Отправляем данные в service_worker.js на загрузку
                chrome.runtime.sendMessage({
                    action: "download_Tracks",
                    tabId: appYa_tabID,
                    trackIds: trackIds,
                    playlistName: `music/artist_${pltitle}`,

                }, (response) => {
                    if (chrome.runtime.lastError) {
                        //console.error("Ошибка отправки данных в background.js:", chrome.runtime.lastError.message);
                    } else {
                        //console.log("Ответ от background.js на send_localStorage:", response);
                    }
                });


            });


        }


    } else {
        authorization_panel.style.display = 'flex';
        authorization_btn.setAttribute('href', parsedData.appYa_authorizationUrl);

        setTimeout(function () {
            authorization_btn.addEventListener('click', function () {
                // Закрываем вкладку
                chrome.tabs.remove(appYa_tabID, function () {
                    if (chrome.runtime.lastError) {
                        console.error(chrome.runtime.lastError);
                    } else {
                        console.log('Вкладка закрыта.');
                    }
                });
            });
        }, 1500)


        console.log('data_auth', parsedData)
    }


}


function parseStorage(data) {
    return Object.keys(data).reduce((acc, key) => {
        const value = data[key];
        try {
            // Проверяем, является ли строка JSON-строкой
            if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                acc[key] = JSON.parse(value);
            } else {
                acc[key] = value;
            }
        } catch (error) {
            console.error(`Error parsing JSON for key ${key}:`, error);
            acc[key] = value; // Оставляем значение как есть, если произошла ошибка
        }
        return acc;
    }, {});
}


