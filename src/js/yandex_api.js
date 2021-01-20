var yandex = {};

yandex.getTrackLinks = function (storageDir, success, fail) {
    var url = '/api/v1.4/jsonp.xml?action=getTrackSrc&p=download-info/'
            + storageDir + '/2.mp3&r=' + Math.random();
    utils.ajax(url, function (jsonp) {
        // чистим jsonp до json
        var jsonStr = jsonp.replace(/^[^[]+/, '').replace(/\);$/, '');
        try {
            // json кривой, поэтому извлекаем через eval
            var json = eval(jsonStr)[0];
        } catch (e) {
            var message = 'Не удалось распарсить строку' + jsonp;
            console.error(message);
            log.addMessage(message);
            fail();
            return;
        }
        var hosts = json['regional-hosts'];
        hosts.push(json.host);

        var md5 = utils.md5('XGRlBW9FXlekgbPrRHuSiA' + json.path.substr(1) + json.s);
        var urlBody = '/get-mp3/' + md5 + '/' + json.ts + json.path;
        var links = hosts.map(function (host) {
            return 'http://' + host + urlBody;
        });
        success(links);
    }, fail);
};

yandex.getTrack = function (trackId, success, fail) {
    var url = '/handlers/track.jsx?track=' + trackId
            + '&r=' + Math.random();
    utils.ajax(url, success, fail);
};

yandex.getAlbum = function (albumId, success, fail) {
    var url = '/handlers/album.jsx?album=' + albumId
            + '&r=' + Math.random();
    utils.ajax(url, success, fail);
};

yandex.getPlaylist = function (username, playlistId, success, fail) {
    var url = '/handlers/playlist.jsx?owner=' + username
            + '&kinds=' + playlistId
            + '&r=' + Math.random();
    utils.ajax(url, function (json) {
        success(json.playlist);
    }, fail);
};
