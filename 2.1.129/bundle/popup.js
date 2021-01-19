/******/
(function (modules) { // webpackBootstrap
    /******/ 	// The module cache
    /******/
    var installedModules = {};
    /******/
    /******/ 	// The require function
    /******/
    function __webpack_require__(moduleId) {
        /******/
        /******/ 		// Check if module is in cache
        /******/
        if (installedModules[moduleId]) {
            /******/
            return installedModules[moduleId].exports;
            /******/
        }
        /******/ 		// Create a new module (and put it into the cache)
        /******/
        var module = installedModules[moduleId] = {
            /******/            i: moduleId,
            /******/            l: false,
            /******/            exports: {}
            /******/
        };
        /******/
        /******/ 		// Execute the module function
        /******/
        modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
        /******/
        /******/ 		// Flag the module as loaded
        /******/
        module.l = true;
        /******/
        /******/ 		// Return the exports of the module
        /******/
        return module.exports;
        /******/
    }

    /******/
    /******/
    /******/ 	// expose the modules object (__webpack_modules__)
    /******/
    __webpack_require__.m = modules;
    /******/
    /******/ 	// expose the module cache
    /******/
    __webpack_require__.c = installedModules;
    /******/
    /******/ 	// define getter function for harmony exports
    /******/
    __webpack_require__.d = function (exports, name, getter) {
        /******/
        if (!__webpack_require__.o(exports, name)) {
            /******/
            Object.defineProperty(exports, name, {
                /******/                configurable: false,
                /******/                enumerable: true,
                /******/                get: getter
                /******/
            });
            /******/
        }
        /******/
    };
    /******/
    /******/ 	// getDefaultExport function for compatibility with non-harmony modules
    /******/
    __webpack_require__.n = function (module) {
        /******/
        var getter = module && module.__esModule ?
            /******/            function getDefault() {
                return module['default'];
            } :
            /******/            function getModuleExports() {
                return module;
            };
        /******/
        __webpack_require__.d(getter, 'a', getter);
        /******/
        return getter;
        /******/
    };
    /******/
    /******/ 	// Object.prototype.hasOwnProperty.call
    /******/
    __webpack_require__.o = function (object, property) {
        return Object.prototype.hasOwnProperty.call(object, property);
    };
    /******/
    /******/ 	// __webpack_public_path__
    /******/
    __webpack_require__.p = "";
    /******/
    /******/ 	// Load entry module and return exports
    /******/
    return __webpack_require__(__webpack_require__.s = 8);
    /******/
})
    /************************************************************************/
    /******/ ({

    /***/ 8:
    /***/ (function (module, exports, __webpack_require__) {

        if (false) {
            chrome = browser;
        }

        const $ = document.getElementById.bind(document);

        let background;
        let updateIntervalId;

        window.addEventListener('error', (e) => {
            background.console.warn(e.error.stack);
            e.returnValue = false;
        });

        window.addEventListener('unhandledrejection', (e) => {
            background.console.warn(e.reason);
            e.returnValue = false;
        });

        function generateListView(entity) {
            const totalTrackCount = entity.tracks.length;
            const totalStatus = {
                waiting: 0,
                loading: 0,
                finished: 0,
                interrupted: 0
            };
            const isAlbum = entity.type === background.fisher.downloader.TYPE.ALBUM;
            const isPlaylist = entity.type === background.fisher.downloader.TYPE.PLAYLIST;

            let totalTrackDuration = 0;
            let loadedTrackSize = 0;
            let loadedTrackCount = 0;

            entity.tracks.forEach((track) => {
                loadedTrackSize += track.loadedBytes;
                totalStatus[track.status]++;
                if (track.status === background.fisher.downloader.STATUS.FINISHED) {
                    loadedTrackCount++;
                }
                totalTrackDuration += track.track.durationMs / 1000;
            });

            const totalTrackMinSize = background.fisher.downloader.minBitrate * totalTrackDuration;
            const totalTrackMaxSize = background.fisher.downloader.maxBitrate * totalTrackDuration;
            const isLoading = totalStatus.loading > 0;
            const isInterrupted = !isLoading && totalStatus.interrupted > 0;
            const isFinished = !isInterrupted && totalStatus.finished === totalTrackCount;
            const isWaiting = !isFinished && totalStatus.waiting > 0;

            let name = '';
            let status = '';

            if (isAlbum) {
                name = `Альбом <strong>${entity.artists} - ${entity.title}</strong>`;
            } else if (isPlaylist) {
                name = `Плейлист <strong>${entity.title}</strong>`;
            }

            const loadedTrackSizeStr = background.fisher.utils.bytesToStr(loadedTrackSize);
            const totalTrackMinSizeStr = background.fisher.utils.bytesToStr(totalTrackMinSize);
            const totalTrackMaxSizeStr = background.fisher.utils.bytesToStr(totalTrackMaxSize);

            if (isLoading) {
                status = `<span class="text-primary">Загрузка: ${loadedTrackSizeStr} из [${totalTrackMinSizeStr} - ${totalTrackMaxSizeStr}]</span>`;
            } else if (isInterrupted) {
                status = '<span class="text-danger">Опаньки... Попробуйте нажать голубую кнопку справа &rarr;</span>';
            } else if (isFinished) {
                status = `<span class="text-success">Сохранён [${loadedTrackSizeStr}]</span>`;
            } else if (isWaiting) {
                status = `<span class="text-muted">В очереди [${totalTrackMinSizeStr} - ${totalTrackMaxSizeStr}]</span>`;
            }

            const loadedSizePercent = Math.floor(loadedTrackCount / totalTrackCount * 100);

            let view = '<div class="panel panel-default">';

            view += '<div class="panel-heading">';
            view += `${name}<br>`;
            view += `Скачано треков ${loadedTrackCount} из ${totalTrackCount} (${loadedSizePercent}%)`;
            view += '</div>';
            view += '<div class="panel-body">';
            view += status;
            view += `<button type="button" class="btn btn-xs btn-danger remove-btn" data-id="${entity.index}">`;
            view += `<i class="glyphicon glyphicon-remove" data-id="${entity.index}"></i>`;
            view += '</button>';

            if (isInterrupted) {
                view += `<button type="button" class="btn btn-info btn-xs restore-btn" data-id="${entity.index}">`;
                view += `<i class="glyphicon glyphicon-repeat" data-id="${entity.index}"></i></button>`;
            }

            view += '</div>';
            view += '</div>';

            return view;
        }

        function generateTrackView(entity) {
            const duration = entity.track.durationMs / 1000;
            const minSize = background.fisher.downloader.minBitrate * duration;
            const maxSize = background.fisher.downloader.maxBitrate * duration;
            const minSizeStr = background.fisher.utils.bytesToStr(minSize);
            const maxSizeStr = background.fisher.utils.bytesToStr(maxSize);
            const loadedSizeStr = background.fisher.utils.bytesToStr(entity.loadedBytes);
            const isWaiting = entity.status === background.fisher.downloader.STATUS.WAITING;
            const isLoading = entity.status === background.fisher.downloader.STATUS.LOADING;
            const isFinished = entity.status === background.fisher.downloader.STATUS.FINISHED;
            const isInterrupted = entity.status === background.fisher.downloader.STATUS.INTERRUPTED;

            let status = '';

            if (isWaiting) {
                status = `<span class="text-muted">В очереди [${minSizeStr} - ${maxSizeStr}]</span>`;
            } else if (isLoading) {
                status = `<span class="text-primary">Загрузка: ${loadedSizeStr} из [${minSizeStr} - ${maxSizeStr}]</span>`;
            } else if (isFinished) {
                status = `<span class="text-success">Сохранён [${loadedSizeStr}]</span>`;
            } else if (isInterrupted) {
                status = '<span class="text-danger">Опаньки... Попробуйте нажать голубую кнопку справа &rarr;</span>';
            }

            let view = '<div class="panel panel-default">';

            view += '<div class="panel-heading">';
            view += `Трек <strong>${entity.artists} - ${entity.title}</strong>`;
            view += '</div>';
            view += '<div class="panel-body">';
            view += status;
            view += `<button type="button" class="btn btn-danger btn-xs remove-btn" data-id="${entity.index}">`;
            view += `<i class="glyphicon glyphicon-remove" data-id="${entity.index}"></i></button>`;

            if (isInterrupted) {
                view += `<button type="button" class="btn btn-info btn-xs restore-btn" data-id="${entity.index}">`;
                view += `<i class="glyphicon glyphicon-repeat" data-id="${entity.index}"></i></button>`;
            }

            view += '</div>';
            view += '</div>';
            return view;
        }

        function updateDownloader() {
            const downloads = background.fisher.downloader.downloads;

            let content = '';

            if (!downloads.size) {
                /*content += '<div class="alert alert-info">';
                content += '<strong>Загрузок нет</strong>';
                content += '<br /><br />';
                content += '<p>Чтобы скачать музыку перейдите на сервис Яндекс.Музыка или Яндекс.Радио</p>';
                content += '</div>';*/
            }
            downloads.forEach((entity) => {
                const isAlbum = entity.type === background.fisher.downloader.TYPE.ALBUM;
                const isPlaylist = entity.type === background.fisher.downloader.TYPE.PLAYLIST;
                const isTrack = entity.type === background.fisher.downloader.TYPE.TRACK;

                if (isTrack) {
                    content = generateTrackView(entity) + content;
                } else if (isAlbum || isPlaylist) {
                    content = generateListView(entity) + content;
                }
            });
            $('downloadContainer').innerHTML = content;
        }

        function startUpdater() {
            if (typeof updateIntervalId !== 'undefined') {
                return; // уже запущено обновление загрузчика
            }
            updateDownloader();
            updateIntervalId = setInterval(updateDownloader, 250);
        }

        $('addBtn').addEventListener('click', () => {
            $('downloadBtn').classList.remove('active');
            $('addBtn').classList.add('active');
            $('addContainer').classList.remove('hidden');
            $('downloadContainer').classList.add('hidden');
        });

        $('downloadBtn').addEventListener('click', () => {
            $('addBtn').classList.remove('active');
            $('downloadBtn').classList.add('active');
            $('addContainer').classList.add('hidden');
            $('downloadContainer').classList.remove('hidden');
            $('errorContainer').classList.add('hidden');
            startUpdater();
        });

        $('downloadFolderBtn').addEventListener('click', () => chrome.downloads.showDefaultFolder());
        $('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

        $('downloadContainer').addEventListener('mousedown', (e) => {
            const downloads = background.fisher.downloader.downloads;
            const isRemoveBtnClick = e.target.classList.contains('remove-btn') || e.target.parentNode.classList.contains('remove-btn');
            const isRestoreBtnClick = e.target.classList.contains('restore-btn') || e.target.parentNode.classList.contains('restore-btn');

            if (!isRemoveBtnClick && !isRestoreBtnClick) {
                return;
            }

            const downloadId = parseInt(e.target.getAttribute('data-id'), 10);

            if (!downloads.has(downloadId)) {
                return;
            }

            const entity = downloads.get(downloadId);
            const isAlbum = entity.type === background.fisher.downloader.TYPE.ALBUM;
            const isCover = isAlbum && entity.cover;
            const isPlaylist = entity.type === background.fisher.downloader.TYPE.PLAYLIST;
            const isTrack = entity.type === background.fisher.downloader.TYPE.TRACK;

            if (isRemoveBtnClick) {
                if (isCover && entity.cover.status === background.fisher.downloader.STATUS.LOADING) {
                    background.fisher.downloader.activeThreadCount--;
                }
                if (isTrack) {
                    if (entity.status === background.fisher.downloader.STATUS.LOADING) {
                        background.fisher.downloader.activeThreadCount--;
                    }
                } else if (isAlbum || isPlaylist) {
                    entity.tracks.forEach((track) => {
                        if (track.status === background.fisher.downloader.STATUS.LOADING) {
                            background.fisher.downloader.activeThreadCount--;
                        }
                    });
                }
                downloads.delete(downloadId);
                background.fisher.downloader.runAllThreads();
            } else if (isRestoreBtnClick) {
                if (isCover && entity.cover.status === background.fisher.downloader.STATUS.INTERRUPTED) {
                    entity.cover.status = background.fisher.downloader.STATUS.WAITING;
                    background.fisher.downloader.download();
                }
                if (isTrack) {
                    entity.status = background.fisher.downloader.STATUS.WAITING;
                    background.fisher.downloader.download();
                } else if (isAlbum || isPlaylist) {
                    entity.tracks.forEach((track) => {
                        if (track.status === background.fisher.downloader.STATUS.INTERRUPTED) {
                            track.status = background.fisher.downloader.STATUS.WAITING;
                            background.fisher.downloader.download();
                        }
                    });
                }
            }
        });

        $('startDownloadBtn').addEventListener('click', () => {
            const downloadType = $('startDownloadBtn').getAttribute('data-type');

            $('downloadBtn').click();
            switch (downloadType) {
                case 'track': {
                    const trackId = $('startDownloadBtn').getAttribute('data-trackId');
                    const albumId = $('startDownloadBtn').getAttribute('data-albumId');

                    background.fisher.downloader.downloadTrack(trackId, albumId);
                    break;
                }
                case 'album': {
                    const albumId = $('startDownloadBtn').getAttribute('data-albumId');

                    background.fisher.downloader.downloadAlbum(albumId, null);
                    break;
                }
                case 'playlist': {
                    const username = $('startDownloadBtn').getAttribute('data-username');
                    const playlistId = $('startDownloadBtn').getAttribute('data-playlistId');

                    background.fisher.downloader.downloadPlaylist(username, playlistId);
                    break;
                }
                case 'artistOrLabel': {
                    const name = $('startDownloadBtn').getAttribute('data-name');
                    const albumElems = document.getElementsByClassName('album');
                    const compilationElems = document.getElementsByClassName('compilation');
                    const allElems = [].slice.call(albumElems).concat([].slice.call(compilationElems));

                    allElems.forEach((albumElem) => {
                        if (albumElem.checked) {
                            background.fisher.downloader.downloadAlbum(albumElem.value, name);
                        }
                    });
                    break;
                }
            }
            startUpdater();
        });

        function hidePreloader() {
            $('preloader').classList.add('hidden');
            $('addContainer').classList.remove('hidden');
            $('addBtn').disabled = false;
            $('downloadBtn').disabled = false;
        }

        function generateDownloadArtist(artist) {
            if (artist.tracks.length) {
                $('downloadTopTracks').parentNode.parentNode.classList.remove('hidden');
                $('downloadTopTracks').addEventListener('click', () => {
                    artist.tracks.slice(0, parseInt($('numOfTopTracks').value)).forEach((track) => {
                        background.fisher.downloader.downloadTrack(track.id, track.albums[0].id, artist.artist.name);
                    });
                    $('downloadBtn').click();
                });
            }
            let albumContent = '';
            let compilationContent = '';

            artist.albums.forEach((album, i) => {
                if (!('year' in album)) {
                    artist.albums[i].year = 0;
                }
            });
            const sortedAlbums = artist.albums.sort((a, b) => b.year - a.year);

            if (sortedAlbums.length) {
                const name = `<b>Альбомы <span class="badge">${sortedAlbums.length}</span></b>`;

                albumContent += `<h4 class="albums"><label><input type="checkbox" id="albumCheckbox" checked>${name}</label></h4>`;
            }
            let year = 0;

            albumContent += '<div class="panel panel-default panel-albums">';
            sortedAlbums.forEach((album) => {
                if (album.year !== year) {
                    year = album.year;
                    albumContent += '<div class="panel-heading">';
                    albumContent += `<label class="label-year">${year === 0 ? 'Год не указан' : year}</label>`;
                    albumContent += '</div>';
                }
                let title = `<span class="badge">${album.trackCount}</span> <strong>${album.title}</strong>`;

                if ('version' in album) {
                    title += ` (${album.version})`;
                }

                const coverUrl = album.coverUri
                    ? `https://${album.coverUri.replace('%%', '70x70')}`
                    : 'img/default_cover.png';

                albumContent += '<div class="panel-body">';
                albumContent += '   <label>';
                albumContent += `       <input type="checkbox" class="album media-checkbox" checked value="${album.id}">`;
                albumContent += '       <div class="media">';
                albumContent += '           <div class="media-left">';
                albumContent += `               <img class="media-object" width="35" height="35" src="${coverUrl}">`;
                albumContent += '           </div>';
                albumContent += `           <div class="media-body">${title}</div>`;
                albumContent += '       </div>';
                albumContent += '   </label>';
                albumContent += '</div>';
            });
            albumContent += '</div>';

            artist.alsoAlbums.forEach((album, i) => {
                if (!('year' in album)) { // пример https://music.yandex.ru/artist/64248
                    artist.alsoAlbums[i].year = 0;
                }
            });
            const sortedCompilations = artist.alsoAlbums.sort((a, b) => b.year - a.year);

            compilationContent += '<div class="panel panel-default panel-compilations">';
            if (sortedCompilations.length) {
                const name = `<b>Сборники <span class="badge">${sortedCompilations.length}</span></b>`;

                compilationContent += `<h4 class="compilations"><label><input type="checkbox" id="compilationCheckbox">${name}</label></h4>`;
            }
            year = 0;
            sortedCompilations.forEach((album) => {
                if (album.year !== year) {
                    year = album.year;
                    compilationContent += '<div class="panel-heading">';
                    compilationContent += `     <label class="label-year">${year === 0 ? 'Год не указан' : year}</label>`;
                    compilationContent += '</div>';
                }

                let title = `<span class="badge">${album.trackCount}</span> <strong>${album.title}</strong>`;

                if ('version' in album) {
                    title += `&nbsp;(${album.version})`;
                }

                const coverUrl = album.coverUri
                    ? `https://${album.coverUri.replace('%%', '70x70')}`
                    : 'img/default_cover.png';

                compilationContent += '<div class="panel-body">';
                compilationContent += '   <label>';
                compilationContent += `       <input type="checkbox" class="compilation media-checkbox" value="${album.id}">`;
                compilationContent += '       <div class="media">';
                compilationContent += '           <div class="media-left">';
                compilationContent += `               <img class="media-object" width="35" height="35" src="${coverUrl}">`;
                compilationContent += '           </div>';
                compilationContent += `           <div class="media-body">${title}</div>`;
                compilationContent += '       </div>';
                compilationContent += '   </label>';
                compilationContent += '</div>';

            });
            compilationContent += '</div>';

            $('name').innerHTML = `${artist.artist.name} <span class="label label-default">Дискография</span>`;
            // $('info').innerHTML = 'Сдаётся рекламное место';
            $('albums').innerHTML = albumContent;
            $('compilations').innerHTML = compilationContent;

            if (sortedAlbums.length) {
                $('albumCheckbox').addEventListener('click', () => {
                    const toggle = $('albumCheckbox');
                    const albums = document.getElementsByClassName('album');

                    for (let i = 0; i < albums.length; i++) {
                        albums[i].checked = toggle.checked;
                    }
                });
            }
            if (sortedCompilations.length) {
                $('compilationCheckbox').addEventListener('click', () => {
                    const toggle = $('compilationCheckbox');
                    const compilations = document.getElementsByClassName('compilation');

                    for (let i = 0; i < compilations.length; i++) {
                        compilations[i].checked = toggle.checked;
                    }
                });
            }
        }

        function generateDownloadLabel(label) {
            let albumContent = '';

            label.albums.forEach((album, i) => {
                if (!('year' in album)) {
                    label.albums[i].year = 0;
                }
            });
            const sortedAlbums = label.albums.sort((a, b) => b.year - a.year);

            if (sortedAlbums.length) {
                const name = `<b>Альбомы <span class="badge">${sortedAlbums.length}</span></b>`;

                albumContent += `<h4 class="albums"><label><input type="checkbox" id="albumCheckbox" checked>${name}</label></h4>`;
            }
            let year = 0;

            albumContent += '<div class="panel panel-default panel-albums">';
            sortedAlbums.forEach((album) => {
                if (album.year !== year) {
                    year = album.year;
                    albumContent += '<div class="panel-heading">';
                    albumContent += `<label class="label-year">${year === 0 ? 'Год не указан' : year}</label>`;
                    albumContent += '</div>';
                }
                const artists = background.fisher.utils.parseArtists(album.artists).artists.join(', ');

                let title = `<strong>${album.title}</strong>`;

                if ('version' in album) {
                    title += `&nbsp;(${album.version})`;
                }

                const coverUrl = album.coverUri
                    ? `https://${album.coverUri.replace('%%', '70x70')}`
                    : 'img/default_cover.png';

                const name = `<span class="badge">${album.trackCount}</span> ${artists} - ${title}`;

                albumContent += '<div class="panel-body">';
                albumContent += '   <label>';
                albumContent += `       <input type="checkbox" class="album media-checkbox" checked value="${album.id}">`;
                albumContent += '       <div class="media">';
                albumContent += '           <div class="media-left">';
                albumContent += `               <img class="media-object" width="35" height="35" src="${coverUrl}">`;
                albumContent += '           </div>';
                albumContent += `           <div class="media-body">${name}</div>`;
                albumContent += '       </div>';
                albumContent += '   </label>';
                albumContent += '</div>';
            });
            albumContent += '</div>';

            $('name').innerHTML = `${label.label.name} <span class="label label-default">Лейбл</span>`;
            // $('info').innerHTML = 'Продам гараж';
            $('albums').innerHTML = albumContent;

            if (sortedAlbums.length) {
                $('albumCheckbox').addEventListener('click', () => {
                    const toggle = $('albumCheckbox');
                    const albums = document.getElementsByClassName('album');

                    for (let i = 0; i < albums.length; i++) {
                        albums[i].checked = toggle.checked;
                    }
                });
            }
        }

        function generateDownloadTrack(track) {
            const duration = track.durationMs / 1000;
            const sizeMin = background.fisher.downloader.minBitrate * duration;
            const sizeMax = background.fisher.downloader.maxBitrate * duration;
            const artists = background.fisher.utils.parseArtists(track.artists).artists.join(', ');
            const sizeStrMin = background.fisher.utils.bytesToStr(sizeMin);
            const sizeStrMax = background.fisher.utils.bytesToStr(sizeMax);
            const durationStr = background.fisher.utils.durationToStr(duration);
            const label = '<span class="label label-default">Трек</span>';
            const sizeBadge = `<span class="badge">${sizeStrMin} - ${sizeStrMax}</span>`;
            const durationBadge = `<span class="badge">${durationStr}</span>`;

            $('name').innerHTML = `${artists} - ${track.title} ${label}`;
            $('info').innerHTML = `${sizeBadge} ${durationBadge}`;
        }

        function generateDownloadAlbum(album) {
            const artists = background.fisher.utils.parseArtists(album.artists).artists.join(', ');
            const label = '<span class="label label-default">Альбом</span>';

            $('name').innerHTML = `${artists} - ${album.title} ${label}`;
            if (!album.trackCount) {
                $('info').innerText = 'Пустой альбом';
                $('startDownloadBtn').style.display = 'none';
                background.console.info(`Empty album: ${album.id}`);
                return;
            }
            let duration = 0;

            album.volumes.forEach((volume) => {
                volume.forEach((track) => {
                    if ('error' in track) {
                        return;
                    }
                    duration += track.durationMs / 1000;
                });
            });
            const minSize = background.fisher.downloader.minBitrate * duration;
            const maxSize = background.fisher.downloader.maxBitrate * duration;
            const minSizeStr = background.fisher.utils.bytesToStr(minSize);
            const maxSizeStr = background.fisher.utils.bytesToStr(maxSize);
            const durationStr = background.fisher.utils.durationToStr(duration);
            const trackCountBadge = `<span class="badge">${album.trackCount}</span>`;
            const sizeBadge = `<span class="badge">${minSizeStr} - ${maxSizeStr}</span>`;
            const durationBadge = `<span class="badge">${durationStr}</span>`;

            $('info').innerHTML = `${trackCountBadge} ${sizeBadge} ${durationBadge}`;
        }

        function generateDownloadPlaylist(playlist) {
            const label = '<span class="label label-default">Плейлист</span>';

            $('name').innerHTML = `${playlist.title} ${label}`;
            if (!playlist.trackCount) {
                $('info').innerText = 'Пустой плейлист';
                $('startDownloadBtn').style.display = 'none';
                background.console.info(`Empty playlist: ${playlist.owner.login}#${playlist.kind}`);
                return;
            }
            let duration = 0;

            playlist.tracks.forEach((track) => {
                if ('error' in track) {
                    return;
                }
                duration += track.durationMs / 1000;
            });

            const minSize = background.fisher.downloader.minBitrate * duration;
            const maxSize = background.fisher.downloader.maxBitrate * duration;
            const minSizeStr = background.fisher.utils.bytesToStr(minSize);
            const maxSizeStr = background.fisher.utils.bytesToStr(maxSize);
            const durationStr = background.fisher.utils.durationToStr(duration);
            const trackCountBadge = `<span class="badge">${playlist.trackCount}</span>`;
            const sizeBadge = `<span class="badge">${minSizeStr} - ${maxSizeStr}</span>`;
            const durationBadge = `<span class="badge">${durationStr}</span>`;

            $('info').innerHTML = `${trackCountBadge} ${sizeBadge} ${durationBadge}`;
        }

        function onAjaxFail(error) {
            background.console.error(error);
            hidePreloader();
            $('addContainer').classList.add('hidden');
            $('errorContainer').classList.remove('hidden');
            $('addBtn').disabled = true;
        }

        function getBackgroundPage() {
            return new Promise((resolve) => {
                chrome.runtime.getBackgroundPage(resolve);
            });
        }

        chrome.runtime.onMessage.addListener(async (request) => {
            if (!request || request.action !== 'getCurrentTrackUrl' || !request.link) {
                hidePreloader();
                $('downloadBtn').click();
                $('addBtn').disabled = true;
                return;
            }
            const url = background.fisher.yandex.baseUrl + request.link;
            const page = background.fisher.utils.getUrlInfo(url);
            const downloadBtn = $('startDownloadBtn');

            if (!page.isTrack || page.albumId === 'undefined') {
                // временный патч, пока не пофиксят на яндекс.музыке externalAPI.getCurrentTrack().link
                hidePreloader();
                $('downloadBtn').click();
                $('addBtn').disabled = true;
                return;
            }

            downloadBtn.setAttribute('data-type', 'track');
            downloadBtn.setAttribute('data-trackId', page.trackId);
            downloadBtn.setAttribute('data-albumId', page.albumId);
            if (background.fisher.storage.getItem('singleClickDownload')) {
                hidePreloader();
                downloadBtn.click();
                return;
            }
            let json;

            try {
                json = await background.fisher.yandex.getTrack(page.trackId, page.albumId);
            } catch (e) {
                onAjaxFail(e);
                return;
            }
            hidePreloader();
            generateDownloadTrack(json.track);
        });

        async function loadPopup() {
            background = await getBackgroundPage();
            let activeTab;

            try {
                activeTab = await background.fisher.utils.getActiveTab();
            } catch (e) {
                onAjaxFail(e);
                return;
            }

            const page = background.fisher.utils.getUrlInfo(activeTab.url);
            const downloadBtn = $('startDownloadBtn');

            if (page.isPlaylist) {
                downloadBtn.setAttribute('data-type', 'playlist');
                downloadBtn.setAttribute('data-username', page.username);
                downloadBtn.setAttribute('data-playlistId', page.playlistId);
                if (background.fisher.storage.getItem('singleClickDownload')) {
                    hidePreloader();
                    downloadBtn.click();
                    return;
                }
                let playlist;

                try {
                    playlist = await background.fisher.yandex.getPlaylist(page.username, page.playlistId);
                } catch (e) {
                    onAjaxFail(e);
                    return;
                }
                hidePreloader();
                generateDownloadPlaylist(playlist);
            } else if (page.isTrack) {
                downloadBtn.setAttribute('data-type', 'track');
                downloadBtn.setAttribute('data-trackId', page.trackId);
                downloadBtn.setAttribute('data-albumId', page.albumId);
                if (background.fisher.storage.getItem('singleClickDownload')) {
                    hidePreloader();
                    downloadBtn.click();
                    return;
                }
                let json;

                try {
                    json = await background.fisher.yandex.getTrack(page.trackId, page.albumId);
                } catch (e) {
                    onAjaxFail(e);
                    return;
                }
                hidePreloader();
                generateDownloadTrack(json.track);
            } else if (page.isAlbum) {
                downloadBtn.setAttribute('data-type', 'album');
                downloadBtn.setAttribute('data-albumId', page.albumId);
                if (background.fisher.storage.getItem('singleClickDownload')) {
                    hidePreloader();
                    downloadBtn.click();
                    return;
                }
                let album;

                try {
                    album = await background.fisher.yandex.getAlbum(page.albumId);
                } catch (e) {
                    onAjaxFail(e);
                    return;
                }
                hidePreloader();
                generateDownloadAlbum(album);
            } else if (page.isArtist) {
                downloadBtn.setAttribute('data-type', 'artistOrLabel');
                let artist;

                try {
                    artist = await background.fisher.yandex.getArtist(page.artistId);
                } catch (e) {
                    onAjaxFail(e);
                    return;
                }
                hidePreloader();
                generateDownloadArtist(artist);
                downloadBtn.setAttribute('data-name', artist.artist.name);
            } else if (page.isLabel) {
                downloadBtn.setAttribute('data-type', 'artistOrLabel');
                let label;

                try {
                    label = await background.fisher.yandex.getLabel(page.labelId, page.page);
                } catch (e) {
                    onAjaxFail(e);
                    return;
                }
                hidePreloader();
                generateDownloadLabel(label);
                downloadBtn.setAttribute('data-name', label.label.name);
            } else if (page.isMusic || page.isRadio) {
                chrome.tabs.sendMessage(activeTab.id, 'getCurrentTrackUrl');
            } else {
                hidePreloader();
                $('downloadBtn').click();
                $('addBtn').disabled = true;
            }
        }

        if (false) {
            const container = document.getElementsByClassName('container')[0];
            container.style.marginRight = '17px';
        }

        loadPopup();


        /***/
    })

    /******/
});