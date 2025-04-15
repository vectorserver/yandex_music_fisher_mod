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