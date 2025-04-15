document.addEventListener('DOMContentLoaded', async function () {
    const form = document.getElementById('settingsForm');
    const folderInput = document.getElementById('downloadFolder');
    const coverSelect = document.getElementById('coverResolution');
    const audioSelect = document.getElementById('audioQuality');

    // Восстановление сохраненных настроек
    const data = await chrome.storage.local.get('app_setting');
    if (data.app_setting) {
        folderInput.value = data.app_setting.downloadFolder || 'music';
        coverSelect.value = data.app_setting.coverQuality || '400';
        audioSelect.value = data.app_setting.audioQuality || 'lossless-flac___aac,he-aac,mp3,flac-mp4,aac-mp4,he-aac-mp4___encraw';
    }

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const settings = {
            downloadFolder: folderInput.value,
            coverQuality: coverSelect.value,
            audioQuality: audioSelect.value,
        };
        await chrome.storage.local.set({ app_setting: settings });
        alert('Настройки сохранены!');
    });
});
