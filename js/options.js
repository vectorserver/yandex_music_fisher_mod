document.addEventListener('DOMContentLoaded', async function () {
    const form = document.getElementById('settingsForm');
    const folderInput = document.getElementById('downloadFolder');
    const coverSelect = document.getElementById('coverResolution');
    const audioSelect = document.getElementById('audioQuality');
    const downlodadCount = document.getElementById('downlodadCount');
    const savehistory = document.getElementById('savehistory');
    const checkexists = document.getElementById('checkexists');

    // Восстановление сохраненных настроек
    const data = await chrome.storage.local.get('app_setting');
    if (data.app_setting) {
        folderInput.value = data.app_setting.downloadFolder || 'music/%genre%';
        coverSelect.value = data.app_setting.coverQuality || 600;
        audioSelect.value = data.app_setting.audioQuality || 'lossless-flac___aac,he-aac,mp3,flac-mp4,aac-mp4,he-aac-mp4___encraw';
        downlodadCount.value = data.app_setting.downlodadCount || 4;
        savehistory.value = data.app_setting.savehistory??0;
        checkexists.value = data.app_setting.checkexists??0;
    }

    const settings = {
        downloadFolder: folderInput.value??'music/%genre%',
        coverQuality: parseInt(coverSelect.value??'600'),
        audioQuality: audioSelect.value??'nq',
        downlodadCount: parseInt(downlodadCount.value??4),
        savehistory: savehistory.value??0,
        checkexists: checkexists.value??0,
    };
    await chrome.storage.local.set({ app_setting: settings });
    console.log('Настройки получены!',settings);

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const settings_submit = {
            downloadFolder: folderInput.value??'music/%genre%',
            coverQuality: parseInt(coverSelect.value??'600'),
            audioQuality: audioSelect.value??'nq',
            downlodadCount: parseInt(downlodadCount.value??4),
            savehistory: savehistory.value??'0',
            checkexists: checkexists.value??'0',
        };
        await chrome.storage.local.set({ app_setting: settings_submit });
        alert('Настройки сохранены!');
        console.log('Настройки сохранены!',settings_submit);
    });
});
