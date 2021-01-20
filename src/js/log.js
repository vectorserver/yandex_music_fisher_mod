var log = {
    string: ''
};

log.addMessage = function (msg) {
    log.string += msg + "\r\n";
};

log.download = function () {
    log.addMessage(new Date());
    chrome.downloads.download({
        url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(log.string),
        filename: 'log.txt'
    });
};

chrome.runtime.getPlatformInfo(function (platformInfo) {
    log.addMessage('Yandex Music Fisher ' + chrome.runtime.getManifest().version);
    log.addMessage(new Date());
    log.addMessage('Operating system: ' + platformInfo.os);
    log.addMessage('Architecture: ' + platformInfo.arch);
});
