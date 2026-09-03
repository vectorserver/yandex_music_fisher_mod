document.addEventListener('DOMContentLoaded', async function () {
    const form = document.getElementById('settingsForm');
    const folderInput = document.getElementById('downloadFolder');
    const coverSelect = document.getElementById('coverResolution');
    const audioSelect = document.getElementById('audioQuality');
    const downlodadCount = document.getElementById('downlodadCount');
    const savehistory = document.getElementById('savehistory');
    const numberingCheckbox = document.getElementById('numberingTracks');
    const trackExample = document.getElementById('trackExample');
    // Добавляем DOM-элемент для нового чекбокса ИИ
    const aiCheckbox = document.getElementById('aiSuspicion');

    // Функция для скрытия/показа текста
    const updateExample = () => {
        if (numberingCheckbox.checked) {
            trackExample.textContent = '01. music_name.mp3';
        } else {
            trackExample.textContent = 'music_name.mp3';
        }
    };

    // Восстановление сохраненных настроек
    const data = await chrome.storage.local.get('app_setting');
    if (data.app_setting) {
        folderInput.value = data.app_setting.downloadFolder || 'music/';
        coverSelect.value = data.app_setting.coverQuality || 600;
        audioSelect.value = data.app_setting.audioQuality || 'lossless';
        downlodadCount.value = data.app_setting.downlodadCount || 4;
        savehistory.value = data.app_setting.savehistory || 0;
        numberingCheckbox.checked = data.app_setting.numberingTracks || false;
        // Восстанавливаем состояние чекбокса ИИ (по умолчанию false)
        if (aiCheckbox) {
            aiCheckbox.checked = data.app_setting.aiSuspicion || false;
        }
        updateExample();
    }

    // Слушатель клика по галке
    numberingCheckbox.addEventListener('change', updateExample);

    // Обработчик сохранения
    form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const settings_submit = {
            downloadFolder: folderInput.value || 'music/',
            coverQuality: parseInt(coverSelect.value || '600'),
            audioQuality: audioSelect.value || 'nq',
            downlodadCount: parseInt(downlodadCount.value || 4),
            savehistory: savehistory.value || '0',
            numberingTracks: numberingCheckbox.checked,
            // Добавляем значение чекбокса ИИ в объект настроек
            aiSuspicion: aiCheckbox ? aiCheckbox.checked : false
        };

        await chrome.storage.local.set({ app_setting: settings_submit });
        alert('Настройки сохранены!');
        console.log('[appYa] Настройки сохранены!', settings_submit);
    });
});
