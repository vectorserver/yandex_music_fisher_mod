document.addEventListener('DOMContentLoaded', function () {
    var threadCount = localStorage.getItem('downloadThreadCount');
    if (threadCount) {
        document.getElementById('downloadThreadCount').value = threadCount;
    }
    var coverSize = localStorage.getItem('albumCoverSize');
    if (coverSize) {
        document.getElementById('albumCoverSize').value = coverSize;
    }
});

document.getElementById('downloadThreadCount').addEventListener('change', function (e) {
    if (e.target.value > 10) {
        e.target.value = 10;
    } else if (e.target.value < 1) {
        e.target.value = 1;
    }
    localStorage.setItem('downloadThreadCount', e.target.value);
});

document.getElementById('albumCoverSize').addEventListener('change', function (e) {
    localStorage.setItem('albumCoverSize', e.target.value);
});

document.getElementById('btn-log').addEventListener('click', function (e) {
    e.preventDefault();
    chrome.runtime.getBackgroundPage(function (backgroundPage) {
        backgroundPage.log.download();
    });
});
