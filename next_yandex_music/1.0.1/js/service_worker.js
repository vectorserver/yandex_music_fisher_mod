// Выводим в консоль информацию о запуске service_worker.js
console.log('service_worker.js loaded');


const appService = {
    saveToStorage(key, value) {
        return chrome.storage.local.set({ [key]: value });
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
    updateBadge(count,bg) {
        if (count === 0) {
            chrome.action.setBadgeText({ text: "" });
        } else {
            chrome.action.setBadgeText({ text: count.toString() });
            chrome.action.setBadgeBackgroundColor({ color: bg });
        }
    },
    getRandomColor() {
        let availableColors = badgeManager.colors.filter(color => !badgeManager.usedColors.includes(color));

        if (availableColors.length === 0) {
            //throw new Error('Все цвета уже использованы');
        }
        const randomIndex = Math.floor(Math.random() * availableColors.length);
        const randomColor = availableColors[randomIndex];
        badgeManager.usedColors.push(randomColor);
        return randomColor;
    }
};

const downloadManager = {
    async downloadTracks(message, globalCount) {
        let { tabId, playlistName, trackIds } = message;
        let batchSize = 4;
        globalCount += trackIds.length;
        let bg = badgeManager.getRandomColor();
        badgeManager.updateBadge(globalCount,bg);

        for (let i = 0; i < trackIds.length; i += batchSize) {
            const batch = trackIds.slice(i, i + batchSize);
            for (const trackId of batch) {
                await new Promise((resolve, reject) => {
                    const dataToInject = `appYa.fetchFileInfoOne(${trackId})`;

                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
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
                                badgeManager.updateBadge(globalCount,bg);

                                if (inputData !== null && inputData.download) {
                                    this.downloadFile(inputData, playlistName);
                                }
                                resolve(trackId);
                            } else {
                                reject("No result returned");
                            }
                        }, 250);
                    });
                });
            }
        }
    },
    downloadFile(inputData, playlistName) {
        const escapeFileName = (fileName) => fileName.replace(/[\\/:*?"<>|]/g, '_');
        let artists = inputData.trackinfo.artists.map((item) => item.name).join(', ');
        let title = inputData.trackinfo.title;
        let fileName = `${playlistName}/${escapeFileName(title)}-${escapeFileName(artists)}.mp3`;

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

            const onDownloadChanged = (delta) => {
                if (delta.id === downloadId && delta.state && delta.state.current === "complete") {
                    chrome.downloads.erase({ id: downloadId }, (removedIds) => {
                        if (chrome.runtime.lastError) {
                            console.error("Ошибка очистки истории:", chrome.runtime.lastError.message);
                        } else {
                            console.log("История загрузки успешно очищена для ID:", removedIds);
                        }
                    });

                    chrome.downloads.onChanged.removeListener(onDownloadChanged);
                }
            };
            chrome.downloads.onChanged.addListener(onDownloadChanged);
        });
    }
};

const worker = {
    globalCount: 0,
    onMessage(message, sender, sendResponse) {
        if (message.action === "inject_parser") {
            sendResponse({ success: true, message: 'parser.js OK', tabId: sender.tab.id });
            chrome.scripting.executeScript({
                target: { tabId: sender.tab.id },
                files: ["html/bs5/browser-id3-writer.6.0.0.mjs", "js/parser.js"],
                world: "MAIN"
            }).then(() => {
                chrome.scripting.executeScript({
                    target: { tabId: sender.tab.id },
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
            sendResponse({ success: true, data: message.data });
            if (message.data && !message.data.appYa_token) {
                appService.saveToStorage('appYa_db', { appYa_token: false });
            }
            appService.saveToStorage('appYa_db', message.data).then(() => {
                //console.log("Данные localStorage успешно сохранены:", { appYa_db: message.data });
            }).catch(console.error);
            return true;
        }

        if (message.action === "download_Tracks") {
            console.log('download_Tracks', message);
            sendResponse({ download_Tracks: message });
            downloadManager.downloadTracks(message, this.globalCount);
            return true;
        }
    }
};

// Слушатель сообщений
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return worker.onMessage(message, sender, sendResponse);
});
