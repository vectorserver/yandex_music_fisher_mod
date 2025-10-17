// Выводим в консоль информацию о запуске service_worker.js
console.log('service_worker.js loaded');


const appService = {
    saveToStorage(key, value) {
        return chrome.storage.local.set({[key]: value});
    },
    getFromStorage(key) {
        return chrome.storage.local.get(key);
    }
};

const badgeManager = {
    colors: [
        '#FF5733', // Красный
        '#33FF57', // Зеленый
        '#3357FF', // Синий
        '#FF33A1', // Розовый
        '#FFBD33', // Оранжевый
        '#33FFF4', // Голубой
        '#B333FF', // Фиолетовый
        '#33FFA1', // Бирюзовый
        '#FFA133', // Желтый
        '#A133FF', // Лиловый
        '#33A1FF', // Лазурный
        '#FFA1A1'  // Розовый
    ],
    usedColors: [], // Добавляем массив использованных цветов
    resetColors() {
        this.usedColors = [];
    },
    getRandomColor() {
        if (this.usedColors.length === this.colors.length) {
            this.resetColors();
        }
        const availableColors = this.colors.filter(color => !this.usedColors.includes(color));
        const randomColor = availableColors[Math.floor(Math.random() * availableColors.length)];
        this.usedColors.push(randomColor);
        return randomColor;
    },
    updateBadge(count, bg) {
        chrome.action.setBadgeText({text: count > 0 ? count.toString() : ""});
        chrome.action.setBadgeBackgroundColor({color: bg});
    }
};

const downloadManager = {
    async downloadTracks(message, globalCount) {
        let {tabId, playlistName, trackIds} = message;

        // Ждём результат get
        const settings = await chrome.storage.local.get('app_setting');

        // Получаем путь из результата
        const downloadFolder = settings?.app_setting?.downloadFolder || 'music';
        playlistName = downloadFolder + '/' + playlistName;

        // Проверяем, содержит ли downloadFolder переменные
        const hasVariables = /%[^%]+%/.test(downloadFolder);


        let batchSize = settings?.app_setting?.downlodadCount ?? 4;
        globalCount += trackIds.length;
        let bg = badgeManager.getRandomColor();
        badgeManager.updateBadge(globalCount, bg);

        for (let i = 0; i < trackIds.length; i += batchSize) {
            const batch = trackIds.slice(i, i + batchSize);

            await Promise.all(batch.map(trackId =>
                new Promise((resolve, reject) => {
                    const dataToInject = `appYa.fetchFileInfoOne(${trackId})`;

                    chrome.scripting.executeScript({
                        target: {tabId: tabId},
                        func: (injectedData) => eval(injectedData),
                        args: [dataToInject],
                        world: "MAIN",
                    }, (results) => {
                        if (chrome.runtime.lastError) {
                            console.error("Ошибка при выполнении скрипта:", chrome.runtime.lastError);
                            reject(chrome.runtime.lastError.message);
                            return;
                        }

                        setTimeout(async () => {
                            if (results && results.length > 0) {
                                let inputData = await JSON.parse(results[0].result);
                                globalCount -= 1;
                                badgeManager.updateBadge(globalCount, bg);

                                if (inputData !== null && inputData.download) {

                                    // Если есть переменные в downloadFolder, обрабатываем их
                                    if (hasVariables) {
                                        let artists = inputData.trackinfo.artists.map((item) => item.name).join(', ');

                                        // Если есть переменные в downloadFolder, обрабатываем их
                                        const defaultTrackInfo = {
                                            dir: playlistName,
                                            genre: inputData.trackinfo.albums[0].genre || 'Unknown',
                                            year: inputData.trackinfo.albums[0].year || new Date().getFullYear(),
                                            artist: artists || 'Unknown Artist',
                                            album: inputData.trackinfo.albums[0].title || 'Unknown Album'
                                        };

                                        // Словарь переменных
                                        const variables = {
                                            '%dir%': playlistName,
                                            '%genre%': defaultTrackInfo.genre,
                                            '%year%': defaultTrackInfo.year.toString(),
                                            '%artist%': defaultTrackInfo.artist,
                                            '%album%': defaultTrackInfo.album
                                        };

                                        // Заменяем переменные в downloadFolder
                                        let processedFolder = downloadFolder;

                                        for (const [variable, value] of Object.entries(variables)) {
                                            if (downloadFolder.includes(variable)) {
                                                // Очищаем значение от недопустимых символов
                                                const cleanValue = value.toString().replace(/[<>:"/\\|?*]/g, '_');
                                                processedFolder = processedFolder.replace(new RegExp(variable.replace(/%/g, '\\%'), 'gi'), cleanValue);
                                            }
                                        }

                                        playlistName = processedFolder;
                                    }


                                    downloadManager.downloadFile(inputData, playlistName, settings);
                                }
                                resolve(trackId);
                            } else {
                                reject("No result returned");
                            }
                        }, 250);
                    });
                })
            ));
        }
    },

    downloadFile(inputData, playlistName, settings) {

        console.log('downloadFile settings', settings?.app_setting)
        const escapeFileName = (fileName) => fileName.replace(/[\\/:*?"<>|]/g, '_');
        let artists = inputData.trackinfo.artists.map((item) => item.name).join(', ');
        let title = inputData.trackinfo.title;
        let fileName = `${playlistName}/${escapeFileName(artists)} - ${escapeFileName(title)}.mp3`;


        //Тут нужно еще проверка о том что файл существует settings?.app_setting.checkexists если есть то не качаем
        chrome.downloads.download({
            url: inputData.download,
            filename: fileName,
            saveAs: false,
            conflictAction: 'overwrite'
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Ошибка загрузки:", chrome.runtime.lastError.message);
                return;
            }


            // Отслеживаем завершение загрузки
            if (settings?.app_setting.savehistory === "0" || settings?.app_setting.savehistory === 0) {
                chrome.downloads.onChanged.addListener(function listener(delta) {
                    if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
                        // Удаляем запись из истории загрузок
                        chrome.downloads.erase({id: downloadId}, () => {
                            if (chrome.runtime.lastError) {
                                console.warn("Не удалось удалить запись о загрузке:", chrome.runtime.lastError.message);
                            } else {
                                console.log(`Загрузка ${downloadId} удалена из истории`);
                            }
                        });
                        // Отписываемся от слушателя, чтобы не ловить другие загрузки
                        chrome.downloads.onChanged.removeListener(listener);
                    }
                });
            }
        });
    }
};


const worker = {
    globalCount: 0,
    onMessage(message, sender, sendResponse) {
        if (message.action === "inject_parser") {
            sendResponse({success: true, message: 'parser.js OK', tabId: sender.tab.id});
            chrome.scripting.executeScript({
                target: {tabId: sender.tab.id},
                files: ["html/bs5/browser-id3-writer.6.0.0.mjs", "js/parser.js"],
                world: "MAIN"
            }).then(() => {
                chrome.scripting.executeScript({
                    target: {tabId: sender.tab.id},
                    func: () => {
                        if (typeof appYa !== 'undefined' && typeof appYa.init === 'function') {
                            appYa.init();
                        }
                    },
                    world: "MAIN"
                }).then(() => {
                    appService.saveToStorage('appYa_tabID', sender.tab.id);
                }).catch(console.error);
            }).catch(console.error);

            return true;
        }

        if (message.action === "send_localStorage") {
            sendResponse({success: true, data: message.data});
            if (message.data && !message.data.appYa_token) {
                appService.saveToStorage('appYa_db', {appYa_token: false});
            }
            appService.saveToStorage('appYa_db', message.data).then(() => {

                //console.log("Данные localStorage успешно сохранены:", { appYa_db: message.data });
            }).catch(console.error);
            return true;
        }

        if (message.action === "download_Tracks") {
            console.log('download_Tracks', message);
            sendResponse({download_Tracks: message});
            downloadManager.downloadTracks(message, this.globalCount);
            return true;
        }

        // Обработчик сообщения для загрузки через SHIFT+D или двойной клик
        if (message.action === "download_SFIFTD") {
            // Парсим информацию о файле из localStorage данных сообщения
            const trDinfo = JSON.parse(message.data["appYa_get-file-info"]);

            // Проверяем, есть ли ID трека для загрузки
            if (trDinfo.downloadInfo.trackId) {
                // Формируем данные для загрузки:
                // - tabId: ID вкладки отправителя (для контекста)
                // - trackIds: массив ID треков для загрузки (в данном случае один трек)
                // - playlistName: имя плейлиста (по умолчанию 'music')
                let downData = {
                    tabId: sender.tab.id,           // ID вкладки, откуда пришел запрос
                    trackIds: [trDinfo.downloadInfo.trackId], // Массив ID треков для загрузки
                    playlistName: 'music'           // Имя плейлиста для организации загрузок
                }

                // Логируем данные для отладки
                console.log('download_SFIFT+D', downData)

                // Вызываем менеджер загрузок для скачивания трека(ов)
                // this.globalCount - глобальный счетчик загрузок (для нумерации/отслеживания)
                downloadManager.downloadTracks(downData, this.globalCount);
            }
            return true; // Подтверждаем получение сообщения
        }


    }
};

// Слушатель сообщений
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return worker.onMessage(message, sender, sendResponse);
});
