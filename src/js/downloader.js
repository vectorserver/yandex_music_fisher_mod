var downloader = {
    queue: [],
    activeThreadCount: 0
};

downloader.clearPath = function (path) {
    return path.replace(/[\\/:*?"<>|]/g, '_'); // Windows path illegals
};

downloader.getPrefix = function (i, max) {
    var prefix = '';
    max = max.toString();
    switch (max.length) {
        case 2:
            prefix = (i < 10) ? '0' + i : i;
            break;
        case 3:
            prefix = (i < 10) ? '00' + i : ((i < 100) ? '0' + i : i);
            break;
        case 4:
            // надеюсь 9999 хватит
            prefix = (i < 10) ? '000' + i : ((i < 100) ? '00' + i : ((i < 1000) ? '0' + i : i));
            break;
        default:
            prefix = i;
    }
    return prefix + ' - ';
};

downloader.download = function () {
    var track = downloader.queue.shift();
    if (!track) {
        return;
    }
    if (track.error) {
        var message = 'Ошибка: ' + track.error;
        console.error(message, track);
        log.addMessage(message);
        downloader.download();
        return;
    }
    downloader.activeThreadCount++;
    var artists = track.artists.map(function (artist) {
        return artist.name;
    }).join(', ');
    if (track.version) {
        track.title += ' (' + track.version + ')';
    }
    var savePath = downloader.clearPath(artists + ' - ' + track.title + '.mp3');
    if (track.namePrefix) {
        savePath = track.namePrefix + savePath;
    }
    if (track.saveDir) {
        savePath = track.saveDir + '/' + savePath;
    }
    yandex.getTrackLinks(track.storageDir, function (links) {
        if (links.length) {
            chrome.downloads.download({
                url: links[0],
                filename: savePath,
                saveAs: false,
                conflictAction: 'prompt'
            });
        } else {
            var message = 'Не удалось найти ссылки';
            console.error(message, track);
            log.addMessage(message);
            downloader.activeThreadCount--;
            downloader.download();
        }
    }, function () {
        // ajax transport fail или json не распарсили
        downloader.activeThreadCount--;
        downloader.download();
    });
};

downloader.add = function (tracks) {
    // todo: сделать страницу с обзором закачек
    downloader.queue = downloader.queue.concat(tracks);
    var newThreadCount = localStorage.getItem('downloadThreadCount') - downloader.activeThreadCount;
    for (var i = 0; i < newThreadCount; i++) {
        downloader.download();
    }
};

downloader.downloadAlbum = function (album) {
    var tracks = [];
    var artists = album.artists.map(function (artist) {
        return artist.name;
    }).join(', ');
    if (album.version) {
        album.title += ' (' + album.version + ')';
    }
    var saveDir = downloader.clearPath(artists + ' - ' + album.title);
    if (album.volumes.length > 1) {
        for (var i = 0; i < album.volumes.length; i++) {
            album.volumes[i].forEach(function (track, j) {
                track.saveDir = saveDir + '/CD' + (i + 1);
                track.namePrefix = downloader.getPrefix(j + 1, album.volumes[i].length);
            });
            tracks = tracks.concat(album.volumes[i]);
        }
    } else {
        album.volumes[0].forEach(function (track, i) {
            track.saveDir = saveDir;
            track.namePrefix = downloader.getPrefix(i + 1, album.volumes[0].length);
        });
        tracks = album.volumes[0];
    }
    downloader.add(tracks);
    chrome.downloads.download({
        url: 'https://' + album.coverUri.replace('%%', localStorage.getItem('albumCoverSize')),
        filename: saveDir + '/cover.jpg',
        saveAs: false,
        conflictAction: 'prompt'
    });
};

downloader.downloadPlaylist = function (playlist) {
    playlist.tracks.forEach(function (track, i) {
        track.saveDir = downloader.clearPath(playlist.title);
        track.namePrefix = downloader.getPrefix(i + 1, playlist.tracks.length);
    });
    downloader.add(playlist.tracks);
};
