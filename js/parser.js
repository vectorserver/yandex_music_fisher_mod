(() => {


    console.log('parser.js loaded:', window.location.href);

    let appYa = {
        location_origin: 'https://music.yandex.ru/',
        apiUrl: 'https://api.music.yandex.net/',
        oauthUrl: 'https://oauth.yandex.ru/',
        client_id: '5c3ec0672830434a8855b036dac2b8a9',
        tokenData: {},

        /**
         * Инициализация приложения.
         */
        init: function () {

            // Получаем токен из localStorage
            let appYa_token = localStorage.getItem('appYa_token');
            if (!appYa_token) {
                // Если токена нет, запрашиваем новый
                appYa.reToken();
            } else {
                localStorage.setItem('appYa_hosting', window.location.origin);

                // Если токен есть, парсим его и сохраняем в tokenData
                appYa_token = JSON.parse(appYa_token);
                appYa.tokenData = appYa_token;
                //console.log('appYa_token', appYa_token);

                // Сохраняем текущий URL
                let previousHref = window.location.href;

                // Создаем наблюдатель за изменениями в DOM
                const observer = new MutationObserver(() => {
                    if (window.location.href !== previousHref) {
                        //console.log("URL has changed to:", window.location.href);
                        previousHref = window.location.href;
                        // Вызов функции обработки нового URL
                        appYa.parsePage();
                    }

                    let plListcontent =[
                        'MainPage',
                        'AlbumPage',
                        'PlaylistPage',
                        'ArtistTracksPage',
                        'MusicHistoryPage',
                        'CollectionPage',
                        'ArtistPage',
                        'TrackModal',
                        'SearchPage',
                        'ChartTracksPage',
                    ]
                    let seletors = plListcontent.map(sel=>`div[class*="${sel}_content__"]`);


                    const playButtonsContent = document.querySelector(seletors.join(","));
                    if (playButtonsContent) {
                        // Ваши действия при обнаружении изменений


                        appYa.processPlayButtons(playButtonsContent);
                    }

                });

                // Начинаем наблюдение за изменениями в DOM
                observer.observe(document, {childList: true, subtree: true});
            }

            // Парсим текущую страницу
            appYa.parsePage();

            // Начинаем мониторинг fetch-запросов
            appYa.monitorFetchRequests();
        },

        processPlayButtons: function (playButtonsContent) {


            const playButtons = playButtonsContent.querySelectorAll('div[class*="Track_root__"],div[class*="TrackCard_root__"]');
            //console.log('playButtons',playButtons)


            playButtons.forEach((playButton) => {
                const link = playButton.querySelector('a[class*="Meta_albumLink__"],a[class*="TrackCard_titleLink__"]');
                //console.log('link',link)
                const meta = playButton.querySelector('div[class*="Meta_titleContainer"],div[class*="TrackCard_titleContainer"]');

                if (link) {
                    const regex = /\/track\/(\d+)/;
                    const match = link.href.match(regex);
                    const trackId = match ? match[1] : null;
                    if (trackId) {


                        // Проверяем, была ли уже добавлена кнопка
                        if (!meta.querySelector('button.added')) {

                            //console.log('trackId', trackId);

                            const downloadButton = document.createElement('button');
                            let style = 'background-color: #fc3;color: black;border-radius: 4px;display: flex;cursor: pointer;border: none;padding: 4px 10px;position: absolute;left: 40%;top: 15px;z-index:9999;';
                            downloadButton.textContent = 'Скачать';
                            downloadButton.classList.add('added');
                            downloadButton.setAttribute('style', style);



                            meta.appendChild(downloadButton);


                            downloadButton.addEventListener('click', function () {
                                appYa.fetchFileInfoOne(trackId).then(result => {
                                    let downloadData = JSON.parse(result);
                                    let artist = downloadData.trackinfo.artists.map(art => art.name).join(", ");
                                    let filename = `${artist} - ${downloadData.trackinfo.title}.mp3`

                                    downloadButton.textContent = 'Загрузка...';
                                    downloadButton.setAttribute('disabled','disabled');

                                    // Создание скрытого элемента <a> для загрузки файла
                                    const downloadLink = document.createElement('a');
                                    downloadLink.href = downloadData.download;
                                    downloadLink.download = filename; // Установите имя файла по вашему усмотрению
                                    downloadLink.style.display = 'none';
                                    document.body.appendChild(downloadLink);

                                    // Программно вызываем клик на скрытом элементе <a>
                                    downloadLink.click();

                                    // Удаляем скрытый элемент <a> после загрузки
                                    if (document.body.removeChild(downloadLink)){
                                        setTimeout(function (){
                                            downloadButton.textContent = 'Загрузка...';
                                            downloadButton.removeAttribute('disabled');
                                            downloadButton.textContent = 'Скачать';
                                        },1000)
                                    }
                                });
                            });


                        }


                    }
                }
                // Ваши действия с найденными кнопками playButtons
            });
            // Поиск всех div с классом, содержащим PlayButtonWithCover

            /*playButtons.forEach(playButton => {
                // Проверка наличия кнопки с классом download-button
                let meta = playButton.querySelector('div[class*="Meta_titleContainer"]');
                const link = playButton.querySelector('a[class*="Meta_albumLink__"]');

                if (link) {
                    const regex = /\/track\/(\d+)/;
                    const match = link.href.match(regex);
                    const trackId = match ? match[1] : null;
                    if (trackId) {
                        console.log('trackId', trackId);

                        // Создание кнопки загрузки
                        const downloadButton = document.createElement('button');
                        downloadButton.textContent = 'Download';
                        downloadButton.classList.add('download-button'); // Добавляем класс для стилизации

                        meta.appendChild(downloadButton);

                        downloadButton.addEventListener('click', function () {
                            appYa.fetchFileInfoOne(trackId).then(result => {
                                let download = JSON.parse(result.download);

                                // Создание скрытого элемента <a> для загрузки файла
                                const downloadLink = document.createElement('a');
                                downloadLink.href = download;
                                downloadLink.download = 'track.mp3'; // Установите имя файла по вашему усмотрению
                                downloadLink.style.display = 'none';
                                document.body.appendChild(downloadLink);

                                // Программно вызываем клик на скрытом элементе <a>
                                downloadLink.click();

                                // Удаляем скрытый элемент <a> после загрузки
                                document.body.removeChild(downloadLink);
                            });
                        });
                    }
                }
            });*/
        },

        /**
         * Обновление токена.
         */
        reToken: function () {
            if (window.location.hash) {
                // Удаляем символ '#' в начале строки
                const cleanedString = window.location.hash.substring(1);

                // Разбиваем строку на массив пар "ключ=значение"
                const pairs = cleanedString.split('&');

                // Создаем объект для хранения пар "ключ=значение"
                const params = {};

                // Проходим по каждой паре и добавляем в объект
                pairs.forEach(pair => {
                    const [key, value] = pair.split('=');
                    params[key] = value;
                });

                // Сохраняем объект в localStorage
                localStorage.setItem('appYa_token', JSON.stringify(params));
                window.location.href = appYa.location_origin;

                // Выводим объект в консоль для проверки
                //console.log(params);
            } else {
                // Перенаправляем на страницу авторизации Яндекса
                let appYa_authorizationUrl = (`${appYa.oauthUrl}authorize?response_type=token&client_id=${appYa.client_id}&redirect_uri=${appYa.location_origin}`);
                localStorage.setItem('appYa_authorizationUrl', appYa_authorizationUrl)

            }
        },

        /**
         * Генерация подписи для запроса.
         * @param {string} secretKey - Секретный ключ.
         * @param {string} data - Данные для подписи.
         * @returns {Promise<string>} - Подпись.
         */
        generateSign: async function (secretKey, data) {
            // Создаем кодировщик
            const encoder = new TextEncoder();

            // Кодируем секретный ключ
            const keyData = encoder.encode(secretKey);

            // Импортируем ключ для HMAC
            const cryptoKey = await crypto.subtle.importKey(
                'raw',
                keyData,
                {name: 'HMAC', hash: {name: 'SHA-256'}},
                false,
                ['sign']
            );

            // Кодируем данные
            const dataEncoded = encoder.encode(data);

            // Генерируем подпись
            const signature = await crypto.subtle.sign(
                'HMAC',
                cryptoKey,
                dataEncoded
            );

            // Возвращаем подпись в формате base64
            return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/, '');
        },

        /**
         * Получение информации о файле трека.
         * @param {string} trackId - Идентификатор трека.
         * @returns {Promise<string>} - Информация о файле трека.
         */

        fetchFileInfoOne: async function (trackId) {
            // Секретный ключ
            const secretKey = 'kzqU4XhfCaY6B6JTHODeq5';

            // Текущее время в секундах
            const timestamp = Math.floor(Date.now() / 1000);

            // Данные для подписи
            const appYa_setting_audioQuality = localStorage.getItem('appYa_setting_audioQuality')??'lossless';
            console.log('appYa_setting_audioQuality',appYa_setting_audioQuality)

            const dataToSign = `${timestamp}${trackId}${appYa_setting_audioQuality}mp3raw`;

            // Генерируем подпись
            const sign = await appYa.generateSign(secretKey, dataToSign);

            // Создаем параметры запроса
            //Добавлен lossless
            const params = new URLSearchParams({
                ts: timestamp,
                trackId: trackId,
                quality: appYa_setting_audioQuality,
                codecs: 'mp3',
                transports: 'raw',
                sign: sign
            });

            // Создаем заголовки запроса
            const headers = new Headers({
                'Authorization': `OAuth ${appYa.tokenData.access_token}`,
                'X-Yandex-Music-Client': 'YandexMusicDesktopAppWindows/1'
            });

            // Формируем URL запроса
            const url = `${appYa.apiUrl}get-file-info?${params.toString()}&byVectorserver=1`;
            const urlInfo = `${appYa.apiUrl}/tracks?trackIds=${trackId}&byVectorserver=1`;

            try {
                // Выполняем оба запроса параллельно
                const [response1, response2] = await Promise.all([
                    fetch(url, {headers}),
                    fetch(urlInfo, {headers})
                ]);

                // Проверяем статусы ответов
                if (!response1.ok) {
                    throw new Error(`HTTP error! status: ${response1.status}`);
                }
                if (!response2.ok) {
                    throw new Error(`HTTP error! status: ${response2.status}`);
                }

                // Получаем данные из ответов
                const data1 = await response1.json();
                const data2 = await response2.json();

                const downloadUrl = data1.result.downloadInfo.url;
                const trackInfo = data2.result[0];

                // Загружаем MP3-файл
                const response = await fetch(downloadUrl);
                if (!response.ok) {
                    throw new Error(`Ошибка загрузки MP3: ${response.statusText}`);
                }
                const mp3Data = new Uint8Array(await response.arrayBuffer());

                // Загружаем обложку
                const coverUrl = trackInfo.albums[0].coverUri.replace('%%', '400x400'); // Подставляем размер
                const coverResponse = await fetch(`https://${coverUrl}`);
                if (!coverResponse.ok) {
                    throw new Error(`Ошибка загрузки обложки: ${coverResponse.statusText}`);
                }
                const coverData = new Uint8Array(await coverResponse.arrayBuffer());

                // Обновляем метаданные
                const writer = new ID3Writer(mp3Data);
                writer.setFrame('TIT2', trackInfo.title) // Название трека
                    .setFrame('TPE1', [trackInfo.artists.map(a => a.name).join(', ')]) // Исполнители
                    .setFrame('TALB', trackInfo.albums[0].title) // Альбом
                    .setFrame('TYER', trackInfo.albums[0].year) // Год выпуска
                    .setFrame('APIC', { // Обложка
                        type: 3,
                        data: coverData,
                        description: 'Cover (front)'
                    })
                    .addTag();

                // Создаем Blob с обновленными данными
                const updatedMp3 = writer.arrayBuffer;
                const blob = new Blob([updatedMp3], {type: 'audio/mpeg'});

                // Генерируем URL и загружаем через chrome.downloads.download
                const blobUrl = URL.createObjectURL(blob);
                // Устанавливаем тайм-аут для загрузки

                const allData = JSON.stringify({'download': blobUrl, 'trackinfo': trackInfo});
                // Объединяем данные и возвращаем их
                return allData;
            } catch (error) {
                console.error('Error fetching file info:', error);
            }
        },

        /**
         * Парсинг текущей страницы.
         */
        parsePage: async function () {
            try {
                // Получаем текущий URL
                let url = window.location.href;
                //Если стрница Артиста
                if (url.includes('/artist')&& !url.endsWith('/tracks')) {
                    url = `${url}/tracks`;
                }

                // Выполняем запрос на текущий URL
                const response = await fetch(url);

                // Проверяем статус ответа
                if (!response.ok) {
                    //console.error(`Error loading page: ${response.status}`);
                    return;
                }

                // Получаем HTML-код страницы
                const html = await response.text();

                // Создаем парсер
                const parser = new DOMParser();

                // Парсим HTML-код в документ
                const doc = parser.parseFromString(html, 'text/html');

                // Получаем все скрипты в теле документа
                const scriptElements = doc.querySelectorAll("body > script");

                // Регулярное выражение для поиска данных
                const pushRegex = /\(window\.__STATE_SNAPSHOT__\s*=\s*window\.__STATE_SNAPSHOT__\s*\|\|\s*\[\]\)\.push\(([\s\S]*?)\);/g;

                // Массив для хранения объединенных данных
                const mergedObject = [];

                // Проходим по каждому скрипту
                scriptElements.forEach((script) => {
                    const content = script.textContent;
                    const matches = content.matchAll(pushRegex);

                    // Проходим по каждому совпадению
                    for (const match of matches) {
                        const pushData = match[1];

                        try {
                            // Парсим данные и добавляем в массив
                            const parsedData = JSON.parse(pushData);
                            mergedObject.push(parsedData);
                        } catch (e) {
                            //console.warn('Ошибка парсинга JSON:', e, pushData);
                        }
                    }
                });

                // Получаем последний элемент массива
                const last = mergedObject.at(-1);

                // Получаем данные из localStorage
                const storedData = localStorage.getItem('appYa_page');

                // Проверяем, изменились ли данные
                if (JSON.stringify(last) !== storedData) {
                    // Сохраняем данные в localStorage, если они изменились
                    localStorage.setItem('appYa_page', JSON.stringify(last));
                }

            } catch (error) {
                //console.error('Error in parsePage:', error);
            }
        },

        /**
         * Извлечение папки из URL.
         * @param {string} url - URL.
         * @returns {string} - Название папки.
         */
        extractFolderFromUrl(url) {
            try {
                // Получаем путь из URL
                const path = new URL(url).pathname;

                // Разбиваем путь на сегменты и фильтруем пустые сегменты
                return path.split('/').filter(segment => segment !== '')[0] || 'root';
            } catch (error) {
                //console.error('Error extracting folder from URL:', error);
                return 'unknown';
            }
        },

        /**
         * Получение информации о треке.
         * @param {string} trackId - Идентификатор трека.
         */
        fetchTrackInfo: async function (trackId) {
            // Формируем URL запроса
            const newUrl = `https://api.music.yandex.ru/tracks?trackIds=${trackId}`;

            try {
                // Выполняем запрос
                const response = await fetch(newUrl);

                // Проверяем статус ответа
                if (!response.ok) {
                    //console.error(`Error fetching track with ID: ${trackId}`);
                    return;
                }

                // Получаем данные в формате JSON
                const data = await response.json();
                //console.log('appYa_TrackInfo:', data.result[0]);

                // Сохраняем данные в localStorage
                //localStorage.setItem('appYa_TrackInfo', JSON.stringify(data.result[0]));
            } catch (error) {
                //console.error('Error in fetchTrackInfo:', error);
            }
        },

        /**
         * Мониторинг fetch-запросов.
         */
        monitorFetchRequests() {
            const originalFetch = window.fetch;
            window.fetch = async (url, options) => {
                try {


                    const response = await originalFetch(url, options);
                    const clonedResponse = response.clone();
                    const contentType = clonedResponse.headers.get("content-type");

                    const folder = this.extractFolderFromUrl(response.url);

                    // Добавляем проверку download=1
                    const parsedUrl = new URL(response.url);
                    const byVectorserver = parsedUrl.searchParams.get('byVectorserver') === '1';
                    if (!byVectorserver) {
                        if (contentType?.includes("application/json")) {
                            const data = await clonedResponse.json();
                            if (data && Object.entries(data).length) {
                                let setParamNAme = `appYa_${folder}`;
                                localStorage.setItem(`appYa_${folder}`, JSON.stringify(data));
                                const trackId = new URL(response.url).searchParams.get('trackId');
                                if (trackId) {
                                    await appYa.fetchFileInfoOne(trackId).then(cureitTrack => {
                                        if (cureitTrack) {
                                            localStorage.setItem('appYa_cureitTrack', cureitTrack);
                                        } else {
                                            console.error('Failed to fetch file info');
                                        }
                                    });

                                }

                            }

                        }


                    }


                    return response;
                } catch (error) {
                    //console.error('Error in fetch interception:', error);
                    throw error;
                }
            };

            //console.log('Fetch monitoring with trackId handling enabled.');
        },
        addImageToAudio: async function (audioURL, imageURL) {
            return new Promise(async (resolve, reject) => {
                try {
                    // Скачиваем аудиофайл
                    const audioResponse = await fetch(audioURL);
                    const audioArrayBuffer = await audioResponse.arrayBuffer();

                    // Скачиваем изображение
                    const imageResponse = await fetch(imageURL);
                    const imageArrayBuffer = await imageResponse.arrayBuffer();
                    //const imageData = new Uint8Array(imageArrayBuffer);


                    if (imageResponse && audioResponse) {

                        var writer = new ID3Writer(audioArrayBuffer);
                        writer
                            .setFrame('APIC', {
                                type: 3,
                                data: imageArrayBuffer,
                                description: 'Super picture',
                            });
                        writer.addTag();


                        const newBlob = new Blob([writer.arrayBuffer], {type: 'audio/mpeg'});
                        const url = URL.createObjectURL(newBlob);
                        resolve(url);
                    }
                } catch (error) {
                    reject(new Error(`Ошибка при добавлении изображения: ${error.message}`));
                }
            });
        }
    }

    window.appYa = appYa;
})();