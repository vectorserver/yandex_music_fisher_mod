var utils = {};

utils.ajax = function (url, success, fail) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://music.yandex.ru' + url, true);
    xhr.timeout = 10000;
    xhr.onload = function () {
        if (xhr.status === 200) {
            if (xhr.responseXML) {
                success(xhr.responseXML); // xml
            } else {
                var reply;
                try {
                    reply = JSON.parse(xhr.responseText); // json
                } catch (e) {
                    reply = xhr.responseText; // plain text
                }
                success(reply);
            }
        } else {
            var message = 'HTTP error code: ' + xhr.status;
            console.error(message);
            log.addMessage(message);
            fail();
        }
    };
    xhr.onerror = function () {
        var message = 'AJAX error: ' + url;
        console.error(message);
        log.addMessage(message);
        fail();
    };
    xhr.ontimeout = function () {
        var message = 'AJAX timeout: ' + url;
        console.error(message);
        log.addMessage(message);
        fail();
    };
    xhr.send();
};

utils.getUrlInfo = function (url) {
    var info = {};
    var parts = url.replace(/\?.*/, '').split('/');
    //["http:", "", "music.yandex.ru", "users", "furfurmusic", "playlists", "1000"]
    info.isYandexMusic = (parts[2] === 'music.yandex.ru');
    if (!info.isYandexMusic) {
        return info;
    }
    info.isPlaylist = (parts[3] === 'users' && parts[5] === 'playlists' && !!parts[6]);
    info.isTrack = (parts[3] === 'album' && parts[5] === 'track' && !!parts[6]);
    info.isAlbum = (parts[3] === 'album' && !!parts[4]);
    if (info.isPlaylist) {
        info.username = parts[4];
        info.playlistId = parts[6];
    } else if (info.isTrack) {
        info.trackId = parts[6];
    } else if (info.isAlbum) {
        info.albumId = parts[4];
    }
    return info;
};

utils.addIconToTab = function (tab) {
    chrome.pageAction.hide(tab.id);
    var page = utils.getUrlInfo(tab.url);
    if (!page.isYandexMusic) {
        return;
    } else if (page.isPlaylist) {
        chrome.pageAction.setIcon({
            tabId: tab.id,
            path: 'img/green.png'
        });
        chrome.pageAction.show(tab.id);
    } else if (page.isTrack) {
        chrome.pageAction.setIcon({
            tabId: tab.id,
            path: 'img/blue.png'
        });
        chrome.pageAction.show(tab.id);
    } else if (page.isAlbum) {
        chrome.pageAction.setIcon({
            tabId: tab.id,
            path: 'img/yellow.png'
        });
        chrome.pageAction.show(tab.id);
    }
};

// источник: http://jquerymy.com/js/md5.js
utils.md5 = (function () {
    function e(e, t) {
        var o = e[0], u = e[1], a = e[2], f = e[3];
        o = n(o, u, a, f, t[0], 7, -680876936);
        f = n(f, o, u, a, t[1], 12, -389564586);
        a = n(a, f, o, u, t[2], 17, 606105819);
        u = n(u, a, f, o, t[3], 22, -1044525330);
        o = n(o, u, a, f, t[4], 7, -176418897);
        f = n(f, o, u, a, t[5], 12, 1200080426);
        a = n(a, f, o, u, t[6], 17, -1473231341);
        u = n(u, a, f, o, t[7], 22, -45705983);
        o = n(o, u, a, f, t[8], 7, 1770035416);
        f = n(f, o, u, a, t[9], 12, -1958414417);
        a = n(a, f, o, u, t[10], 17, -42063);
        u = n(u, a, f, o, t[11], 22, -1990404162);
        o = n(o, u, a, f, t[12], 7, 1804603682);
        f = n(f, o, u, a, t[13], 12, -40341101);
        a = n(a, f, o, u, t[14], 17, -1502002290);
        u = n(u, a, f, o, t[15], 22, 1236535329);
        o = r(o, u, a, f, t[1], 5, -165796510);
        f = r(f, o, u, a, t[6], 9, -1069501632);
        a = r(a, f, o, u, t[11], 14, 643717713);
        u = r(u, a, f, o, t[0], 20, -373897302);
        o = r(o, u, a, f, t[5], 5, -701558691);
        f = r(f, o, u, a, t[10], 9, 38016083);
        a = r(a, f, o, u, t[15], 14, -660478335);
        u = r(u, a, f, o, t[4], 20, -405537848);
        o = r(o, u, a, f, t[9], 5, 568446438);
        f = r(f, o, u, a, t[14], 9, -1019803690);
        a = r(a, f, o, u, t[3], 14, -187363961);
        u = r(u, a, f, o, t[8], 20, 1163531501);
        o = r(o, u, a, f, t[13], 5, -1444681467);
        f = r(f, o, u, a, t[2], 9, -51403784);
        a = r(a, f, o, u, t[7], 14, 1735328473);
        u = r(u, a, f, o, t[12], 20, -1926607734);
        o = i(o, u, a, f, t[5], 4, -378558);
        f = i(f, o, u, a, t[8], 11, -2022574463);
        a = i(a, f, o, u, t[11], 16, 1839030562);
        u = i(u, a, f, o, t[14], 23, -35309556);
        o = i(o, u, a, f, t[1], 4, -1530992060);
        f = i(f, o, u, a, t[4], 11, 1272893353);
        a = i(a, f, o, u, t[7], 16, -155497632);
        u = i(u, a, f, o, t[10], 23, -1094730640);
        o = i(o, u, a, f, t[13], 4, 681279174);
        f = i(f, o, u, a, t[0], 11, -358537222);
        a = i(a, f, o, u, t[3], 16, -722521979);
        u = i(u, a, f, o, t[6], 23, 76029189);
        o = i(o, u, a, f, t[9], 4, -640364487);
        f = i(f, o, u, a, t[12], 11, -421815835);
        a = i(a, f, o, u, t[15], 16, 530742520);
        u = i(u, a, f, o, t[2], 23, -995338651);
        o = s(o, u, a, f, t[0], 6, -198630844);
        f = s(f, o, u, a, t[7], 10, 1126891415);
        a = s(a, f, o, u, t[14], 15, -1416354905);
        u = s(u, a, f, o, t[5], 21, -57434055);
        o = s(o, u, a, f, t[12], 6, 1700485571);
        f = s(f, o, u, a, t[3], 10, -1894986606);
        a = s(a, f, o, u, t[10], 15, -1051523);
        u = s(u, a, f, o, t[1], 21, -2054922799);
        o = s(o, u, a, f, t[8], 6, 1873313359);
        f = s(f, o, u, a, t[15], 10, -30611744);
        a = s(a, f, o, u, t[6], 15, -1560198380);
        u = s(u, a, f, o, t[13], 21, 1309151649);
        o = s(o, u, a, f, t[4], 6, -145523070);
        f = s(f, o, u, a, t[11], 10, -1120210379);
        a = s(a, f, o, u, t[2], 15, 718787259);
        u = s(u, a, f, o, t[9], 21, -343485551);
        e[0] = m(o, e[0]);
        e[1] = m(u, e[1]);
        e[2] = m(a, e[2]);
        e[3] = m(f, e[3]);
    }
    function t(e, t, n, r, i, s) {
        t = m(m(t, e), m(r, s));
        return m(t << i | t >>> 32 - i, n);
    }
    function n(e, n, r, i, s, o, u) {
        return t(n & r | ~n & i, e, n, s, o, u);
    }
    function r(e, n, r, i, s, o, u) {
        return t(n & i | r & ~i, e, n, s, o, u);
    }
    function i(e, n, r, i, s, o, u) {
        return t(n ^ r ^ i, e, n, s, o, u);
    }
    function s(e, n, r, i, s, o, u) {
        return t(r ^ (n | ~i), e, n, s, o, u);
    }
    function o(t) {
        var n = t.length, r = [1732584193, -271733879, -1732584194, 271733878], i;
        for (i = 64; i <= t.length; i += 64) {
            e(r, u(t.substring(i - 64, i)));
        }
        t = t.substring(i - 64);
        var s = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (i = 0; i < t.length; i++)
            s[i >> 2] |= t.charCodeAt(i) << (i % 4 << 3);
        s[i >> 2] |= 128 << (i % 4 << 3);
        if (i > 55) {
            e(r, s);
            for (i = 0; i < 16; i++)
                s[i] = 0;
        }
        s[14] = n * 8;
        e(r, s);
        return r;
    }
    function u(e) {
        var t = [], n;
        for (n = 0; n < 64; n += 4) {
            t[n >> 2] = e.charCodeAt(n) + (e.charCodeAt(n + 1) << 8) + (e.charCodeAt(n + 2) << 16) + (e.charCodeAt(n + 3) << 24);
        }
        return t;
    }
    function c(e) {
        var t = "", n = 0;
        for (; n < 4; n++)
            t += a[e >> n * 8 + 4 & 15] + a[e >> n * 8 & 15];
        return t;
    }
    function h(e) {
        for (var t = 0; t < e.length; t++)
            e[t] = c(e[t]);
        return e.join("");
    }
    function d(e) {
        return h(o(unescape(encodeURIComponent(e))));
    }
    function m(e, t) {
        return e + t & 4294967295;
    }
    var a = "0123456789abcdef".split("");
    return d;
})();