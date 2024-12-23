// Выводим в консоль информацию о запуске service_worker.js
console.log('service_worker.js loaded');

let globalCount = 0;
// Слушатель сообщений от других частей расширения
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Обработка команды "inject_parser"
    let TabID = 0;
    if (message.action === "inject_parser") {
        // Ответ на запрос
        sendResponse({
            success: true, message: 'parser.js OK', tabId: sender.tab.id
        });

        // Инъекция скрипта parser.js в целевую вкладку
        chrome.scripting.executeScript({
            target: {tabId: sender.tab.id},
            files: ["html/bs5/browser-id3-writer.6.0.0.mjs", "js/parser.js"],
            world: "MAIN" // Указывает, что скрипт будет выполнен в основном контексте страницы
        }).then(() => {
            // После успешной инъекции скрипта, выполняем функцию appYa.init()
            chrome.scripting.executeScript({
                target: {tabId: sender.tab.id}, func: () => {
                    if (typeof appYa !== 'undefined' && typeof appYa.init === 'function') {
                        appYa.init();
                    } else {
                        //console.error('appYa or appYa.init is not defined');
                    }
                }, world: "MAIN"
            }).then(() => {
                //console.log("appYa.init() успешно выполнена в вкладке:", sender.tab.id);

                // Сохранение данных в хранилище Chrome
                chrome.storage.local.set({appYa_tabID: sender.tab.id}).then(() => {
                    //console.log("Данные localStorage успешно сохранены:");
                }).catch(error => {
                    //console.log("Ошибка при сохранении данных в chrome.storage.local:", error);
                });
            }).catch(error => {
                //console.error("Ошибка при выполнении appYa.init():", error);
            });
        }).catch(error => {
            //console.error("Ошибка при инъекции parser.js:", error);
        });
        return true;
    }

    // Обработка команды "send_localStorage"
    if (message.action === "send_localStorage") {
        // Ответ на запрос
        sendResponse({
            success: true, data: message.data
        });

        if (message.data && !message.data.appYa_token) {
            chrome.storage.local.set({appYa_db: {appYa_token: false}})
        }
        // Сохранение данных в хранилище Chrome
        chrome.storage.local.set({appYa_db: message.data}).then(() => {
            console.log("Данные localStorage успешно сохранены:", {appYa_db: message.data});

        }).catch(error => {
            //console.error("Ошибка при сохранении данных в chrome.storage.local:", error);
        });


        // Отслеживание изменений в chrome.storage.local
        /*chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.appYa_db) {

                const { newValue, oldValue } = changes.appYa_db;

                if (newValue.appYa_page !== oldValue.appYa_page || newValue.appYa_TrackInfo !== oldValue.appYa_TrackInfo) {
                    // Установить начальный текст счетчика
                    /!*chrome.action.setBadgeText({text: '0'});
                    chrome.action.setBadgeTextColor({ color: '#fffdfd' });
                    chrome.action.setBadgeBackgroundColor({ color: '#d31766' });*!/
                    window.location.reload();
                }
            }
        });*/


        return true;
    }

    if (message.action === "download_Tracks") {
        console.log('download_Tracks', message);
        sendResponse({download_Tracks: message});

        asDownload(message, globalCount);
        async function asDownload(message, globalCount) {
            let tabID = message.tabId;
            let playlistName = message.playlistName;
            let trackIds = message.trackIds;
            let batchSize = 4;
            globalCount += trackIds.length;

            updateBadge(globalCount);

            for (let i = 0; i < trackIds.length; i += batchSize) {
                const batch = trackIds.slice(i, i + batchSize);
                for (const trackId of batch) {
                    await new Promise((resolve, reject) => {
                        const dataToInject = `appYa.fetchFileInfoOne(${trackId})`;

                        chrome.scripting.executeScript({
                            target: {tabId: tabID}, func: (injectedData) => {
                                return eval(injectedData);
                            }, args: [dataToInject], world: "MAIN",
                        }, (results) => {
                            if (chrome.runtime.lastError) {
                                console.error("Ошибка при выполнении скрипта:", chrome.runtime.lastError);
                                sendResponse({status: "error", message: chrome.runtime.lastError.message});
                                reject(chrome.runtime.lastError.message);
                                return;
                            }

                            // Добавляем задержку в полсекунды перед проверкой результата
                            setTimeout(async () => {
                                if (results && results.length > 0) {
                                    let inputData = await JSON.parse(results[0].result);

                                    if (inputData !== null && inputData.download) {
                                        sendResponse({status: "success", result: JSON.parse(results[0].result)});

                                        downloadChrome(inputData, playlistName);
                                        let nCount = (globalCount -= 1);
                                        updateBadge(nCount);
                                    }
                                    resolve(trackId);
                                } else {
                                    sendResponse({status: "error", message: "No result returned"});
                                    reject("No result returned");
                                }
                            }, 250); // Задержка в 500 миллисекунд (0.5 секунды)
                        });
                    });
                }
            }
        }


        function downloadChrome(inputData, playlistName) {


            function escapeFileName(fileName) {
                return fileName.replace(/[\\/:*?"<>|]/g, '_');
            }

            console.log('inputData', inputData);

            let artists = inputData.trackinfo.artists.map((item) => item.name).join(', ');
            let title = inputData.trackinfo.title;
            let fileName = `${playlistName}/${escapeFileName(title)}-${escapeFileName(artists)}.mp3`;

            // Скачиваем файл
            chrome.downloads.download({
                url: inputData.download, filename: fileName,
            }, function (downloadId) {
                if (chrome.runtime.lastError) {
                    console.error("Ошибка загрузки:", chrome.runtime.lastError.message);
                    return;
                }

                console.log("Загрузка началась, ID:", downloadId);

                // Следим за статусом загрузки
                const onDownloadChanged = function (delta) {
                    if (delta.id === downloadId && delta.state && delta.state.current === "complete") {
                        // Удаляем историю загрузки после её завершения
                        chrome.downloads.erase({
                            id: downloadId
                        }, function (removedIds) {
                            if (chrome.runtime.lastError) {
                                console.error("Ошибка очистки истории:", chrome.runtime.lastError.message);
                            } else {
                                console.log("История загрузки успешно очищена для ID:", removedIds);
                            }
                        });

                        // Убираем слушатель, так как задача выполнена
                        chrome.downloads.onChanged.removeListener(onDownloadChanged);
                    }
                };

                // Добавляем слушатель для отслеживания статуса загрузки
                chrome.downloads.onChanged.addListener(onDownloadChanged);
            });

        }

    }

    return true; // Асинхронный sendResponse
});



function updateBadge(count) {
    if (count === 0) {
        // Убираем текст, если значение 0
        chrome.action.setBadgeText({text: ""});
    } else {
        // Устанавливаем текст с текущим значением
        chrome.action.setBadgeText({text: count.toString()});
    }
}
