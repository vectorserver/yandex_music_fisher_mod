// Выводим в консоль информацию о запуске content.js
console.log('content.js loaded');

// Отправляем сообщение в background.js с командой "inject_parser"
chrome.runtime.sendMessage({ action: "inject_parser" }, (data) => {
    if (chrome.runtime.lastError) {
        //console.error("Ошибка при отправке inject_parser:", chrome.runtime.lastError.message);
    } else {
        //console.log('inject_parser выполнен успешно:', data);
    }
});


// Загружаем настройки из chrome.storage.local и сохраняем в localStorage
chrome.storage.local.get('app_setting', (result) => {
    if (result.app_setting) {
        // Копируем каждую настройку в localStorage
        for (const [key, value] of Object.entries(result.app_setting)) {
            console.log('appYa_setting_'+key, value)
            localStorage.setItem('appYa_setting_'+key, value);
        }

    }
});




// Сохраняем начальное состояние localStorage для отслеживания изменений
let previousState = JSON.stringify(localStorage);
// Функция для проверки изменений в localStorage
const checkLocalStorageUpdates = () => {
    try {
        // Получаем текущее состояние localStorage
        let currentState = JSON.stringify(localStorage);

        // Сравниваем текущее и предыдущее состояние
        if (currentState !== previousState) {

            // Обновляем предыдущее состояние
            previousState = currentState;


            // Отправляем обновленные данные в background.js
            chrome.runtime.sendMessage({
                action: "send_localStorage",
                data: { ...window.localStorage } // Передаем копию localStorage
            }, (response) => {
                if (chrome.runtime.lastError) {
                    //console.error("Ошибка отправки данных в background.js:", chrome.runtime.lastError.message);
                } else {
                    //console.log("Ответ от background.js на send_localStorage:", response);
                }
            });
        }
    } catch (error) {
        //console.error("Ошибка при проверке localStorage:", error);
    }
};

// Устанавливаем интервал проверки localStorage каждые 1000 мс (1 секунда)
setInterval(checkLocalStorageUpdates, 1000);


// Для SHIFT + D и SHIFT + В
document.addEventListener('keydown', function(event) {
    // event.code 'KeyD' срабатывает для физической клавиши D/В независимо от раскладки
    if (event.shiftKey && event.code === 'KeyD') {
        event.preventDefault();

        try {
            chrome.runtime.sendMessage({
                action: "download_SFIFTD",
                data: { ...window.localStorage }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("Ошибка связи: скорее всего, расширение было обновлено. Перезагрузите страницу.");
                }
            });
        } catch (e) {
            console.error("Контекст расширения недействителен. Пожалуйста, обновите страницу.");
        }
    }
}, true);


// Для двойного клика мыши
document.addEventListener('dblclick', function(event) {
    // Не срабатывать, если кликнули по полю ввода или кнопке
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;

    try {
        // Проверяем, что расширение все еще "живо"
        if (chrome.runtime && chrome.runtime.id) {
            chrome.runtime.sendMessage({
                action: "download_SFIFTD",
                data: { ...window.localStorage }
            }, (response) => {
                // Обработка ответа, если нужно
                if (chrome.runtime.lastError) { /* игнорируем */ }
            });
        }
    } catch (e) {
        console.warn("Контекст расширения потерян. Перезагрузите страницу.");
    }
}, true);