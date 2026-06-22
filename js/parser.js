// @grant        GM_xmlhttpRequest
// @connect      api.music.yandex.ru

(() => {

    let appYa = {
        location_origin: 'https://music.yandex.ru/?yamusic=ok',
        redirect_uri: 'https://music.yandex.ru/oauth',
        apiUrl: 'https://api.music.yandex.ru/',
        oauthUrl: 'https://oauth.yandex.ru/',
        client_id: '97fe03033fa34407ac9bcf91d5afed5b',
        previousHref: window.location.href,
        previousTrackHref: null,
        previousTitleContainer: null,
        tokenData: {},

        init: function () {

            if (this.client_id !== '97fe03033fa34407ac9bcf91d5afed5b') {
                localStorage.clear();
            }

            let appYa_token = localStorage.getItem('appYa_token');
            if (!appYa_token) {
                appYa.reToken();
            } else {
                localStorage.setItem('appYa_hosting', window.location.origin);

                appYa_token = JSON.parse(appYa_token);
                appYa.tokenData = appYa_token;

                let previousHref = window.location.href;

                const observer = new MutationObserver(() => {
                    if (window.location.href !== previousHref) {
                        previousHref = window.location.href;
                        appYa.parsePage();
                    }

                    let plListcontent = ['MainPage', 'AlbumPage', 'PlaylistPage', 'ArtistTracksPage', 'MusicHistoryPage', 'CollectionPage', 'ArtistPage', 'TrackModal', 'SearchPage', 'ChartTracksPage',]
                    let seletors = plListcontent.map(sel => `div[class*="${sel}_content__"]`);

                    const playButtonsContent = document.querySelector(seletors.join(","));
                    if (playButtonsContent) {
                        appYa.processPlayButtons(playButtonsContent);
                    }

                });

                observer.observe(document, {childList: true, subtree: true});
            }

            appYa.monitorAudioConstructor();
            appYa.parsePage();
            appYa.monitorFetchRequests();
        },

        monitorAudioConstructor: function () {
            const OriginalAudio = window.Audio;
            window.Audio = function (...args) {
                const audioInstance = new OriginalAudio(...args);

                audioInstance.addEventListener('loadstart', () => {
                    const currentSrc = audioInstance.src || audioInstance.currentSrc;
                    if (currentSrc && (currentSrc.includes('strm.yandex.net') || currentSrc.includes('container=mp4'))) {
                        localStorage.setItem('appYa_last_stream_url', currentSrc);
                    }
                });

                return audioInstance;
            };
            window.Audio.prototype = OriginalAudio.prototype;

            const originalCreateElement = document.createElement;
            document.createElement = function (tagName, ...args) {
                const element = originalCreateElement.apply(this, [tagName, ...args]);

                if (tagName && tagName.toLowerCase() === 'audio') {
                    element.addEventListener('loadstart', () => {
                        const currentSrc = element.src || element.currentSrc;
                        if (currentSrc && (currentSrc.includes('strm.yandex.net') || currentSrc.includes('container=mp4'))) {

                            try {
                                const match = currentSrc.match(/[a-f0-9]{8}\.\d+\.\d+\.(\d+)\/[a-z0-9-]+/i);

                                if (match && match[1]) {
                                    const trackId = match[1];
                                    appYa.previousTrackHref = `/track/${trackId}`;

                                    appYa.fetchFileInfoOne(trackId).then(cureitTrack => {
                                        if (cureitTrack){
                                            localStorage.setItem('appYa_cureitTrack', cureitTrack);
                                            console.log('appYa_cureitTrack',trackId)
                                        }

                                    }).catch(() => {
                                    });


                                    appYa.renderFloatingDownloadButton(trackId);
                                }
                            } catch (e) {
                                // Silent catch
                            }
                        }
                    });
                }

                return element;
            };
        },


        renderFloatingDownloadButton: function (trackId) {
            let btn = document.getElementById('appYa-floating-download-btn');

            if (!btn) {
                if (!document.getElementById('appYa-btn-animations')) {
                    const style = document.createElement('style');
                    style.id = 'appYa-btn-animations';
                    style.innerHTML = `
                @keyframes appYaBounceAndPulse {
                    0%, 100%, 20% {
                        transform: scale(1) translateY(0);
                        box-shadow: 0 4px 14px rgba(0,0,0,0.35), inset 0 2px 4px rgba(255,255,255,0.2);
                    }
                    5% {
                        transform: scale(1.1) translateY(-8px);
                        box-shadow: 0 12px 24px rgba(34, 197, 94, 0.5), inset 0 2px 4px rgba(255,255,255,0.4);
                    }
                    10% {
                        transform: scale(0.95) translateY(2px);
                    }
                    12% {
                        transform: scale(1.05) translateY(-2px);
                    }
                    15% {
                        transform: scale(1) translateY(0);
                    }
                }
            `;
                    document.head.appendChild(style);
                }

                btn = document.createElement('div');
                btn.id = 'appYa-floating-download-btn';

                // Загружаем сохраненные ПРОЦЕНТНЫЕ координаты
                const savedCoords = JSON.parse(localStorage.getItem('appYa_btn_coords_pct')) || { bottom: '95px', right: '25px' };

                Object.assign(btn.style, {
                    position: 'fixed',
                    bottom: savedCoords.bottom,
                    right: savedCoords.right,
                    top: 'auto', // Всегда позиционируем снизу-справа для адаптивности
                    left: 'auto',
                    width: '50px',
                    height: '50px',
                    borderRadius: '50%',
                    backgroundColor: '#22c55e',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.35), inset 0 2px 4px rgba(255,255,255,0.2)',
                    cursor: 'grab',
                    zIndex: '999999',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    userSelect: 'none',
                    touchAction: 'none',
                    animation: 'appYaBounceAndPulse 5s infinite ease-in-out',
                    transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.2s ease, box-shadow 0.2s ease',
                });

                btn.onmouseenter = () => { if (!btn.dataset.dragging) { btn.style.animationPlayState = 'paused'; btn.style.transform = 'scale(1.12) translateY(-2px)'; } };
                btn.onmouseleave = () => { if (!btn.dataset.dragging) { btn.style.animationPlayState = 'running'; btn.style.transform = 'scale(1) translateY(0)'; } };
                btn.onmousedown = () => { if (!btn.dataset.dragging) { btn.style.animation = 'none'; btn.style.transform = 'scale(0.95)'; } };
                btn.onmouseup = () => { if (!btn.dataset.dragging) { btn.style.transform = 'scale(1.12) translateY(-2px)'; } };

                // ЛОГИКА АДАПТИВНОГО DRAG & DROP
                let isDragging = false;
                let startX, startY, startRightPx, startBottomPx;

                btn.addEventListener('mousedown', function (e) {
                    if (e.button !== 0) return;

                    isDragging = true;
                    btn.dataset.dragging = "true";
                    btn.style.cursor = 'grabbing';
                    btn.style.animation = 'none';
                    btn.style.transition = 'none';

                    // Вычисляем текущие отступы в пикселях от правого и нижнего края экрана
                    const rect = btn.getBoundingClientRect();
                    startRightPx = window.innerWidth - rect.right;
                    startBottomPx = window.innerHeight - rect.bottom;

                    startX = e.clientX;
                    startY = e.clientY;

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });

                function onMouseMove(e) {
                    if (!isDragging) return;

                    // Считаем смещение (при движении влево/вверх дельта для right/bottom увеличивается)
                    const deltaX = startX - e.clientX;
                    const deltaY = startY - e.clientY;

                    let newRight = startRightPx + deltaX;
                    let newBottom = startBottomPx + deltaY;

                    // Ограничиваем пиксельные рамки экрана
                    const maxRight = window.innerWidth - btn.offsetWidth;
                    const maxBottom = window.innerHeight - btn.offsetHeight;

                    newRight = Math.max(0, Math.min(newRight, maxRight));
                    newBottom = Math.max(0, Math.min(newBottom, maxBottom));

                    btn.style.right = newRight + 'px';
                    btn.style.bottom = newBottom + 'px';
                }

                function onMouseUp() {
                    if (!isDragging) return;
                    isDragging = false;
                    delete btn.dataset.dragging;
                    btn.style.cursor = 'grab';

                    btn.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.2s ease, box-shadow 0.2s ease';
                    btn.style.transform = 'scale(1)';
                    btn.style.animation = 'appYaBounceAndPulse 5s infinite ease-in-out';

                    // ПЕРЕВЕРТЫШ В ПРОЦЕНТЫ: берем текущие пиксели и делим на размер экрана
                    const rect = btn.getBoundingClientRect();
                    const rightPct = ((window.innerWidth - rect.right) / window.innerWidth) * 100;
                    const bottomPct = ((window.innerHeight - rect.bottom) / window.innerHeight) * 100;

                    // Задаем стили в процентах
                    btn.style.right = rightPct + '%';
                    btn.style.bottom = bottomPct + '%';

                    // Сохраняем проценты в localStorage
                    const coordsPct = {
                        right: rightPct + '%',
                        bottom: bottomPct + '%'
                    };
                    localStorage.setItem('appYa_btn_coords_pct', JSON.stringify(coordsPct));

                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                }

                document.body.appendChild(btn);
            }

            // Восстанавливаем процентные координаты при перерендере
            const savedCoords = JSON.parse(localStorage.getItem('appYa_btn_coords_pct'));
            if (savedCoords) {
                btn.style.right = savedCoords.right;
                btn.style.bottom = savedCoords.bottom;
                btn.style.top = 'auto';
                btn.style.left = 'auto';
            }

            btn.style.backgroundColor = '#22c55e';
            btn.style.pointerEvents = 'auto';
            btn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
    `;

            btn.onclick = function (event) {
                if (btn.style.cursor === 'grabbing') return;

                event.stopPropagation();
                btn.style.animation = 'none';
                btn.style.backgroundColor = '#f59e0b';
                btn.style.pointerEvents = 'none';
                btn.innerHTML = `<span style="color: white; font-weight: bold; font-size: 11px; text-align: center; line-height: 1;">Ждемс..</span>`;

                appYa.fetchFileInfoOne(trackId).then(result => {
                    let downloadData = JSON.parse(result);
                    let artist = downloadData.trackinfo.artists.map(art => art.name).join(", ");
                    let filename = `${artist} - ${downloadData.trackinfo.title}.mp3`;

                    btn.style.backgroundColor = '#3b82f6';
                    btn.innerHTML = `<span style="color: white; font-weight: bold; font-size: 11px;">MР3...</span>`;

                    const downloadLink = document.createElement('a');
                    downloadLink.href = downloadData.download;
                    downloadLink.download = filename;
                    downloadLink.style.display = 'none';
                    document.body.appendChild(downloadLink);

                    downloadLink.click();

                    if (document.body.removeChild(downloadLink)) {
                        setTimeout(function () {
                            btn.style.backgroundColor = '#22c55e';
                            btn.style.pointerEvents = 'auto';
                            btn.style.animation = 'appYaBounceAndPulse 5s infinite ease-in-out';
                            btn.innerHTML = `
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    `;
                        }, 1000);
                    }
                }).catch(error => {
                    btn.style.backgroundColor = '#ef4444';
                    btn.style.pointerEvents = 'auto';
                    btn.innerHTML = `<span style="color: white; font-weight: bold; font-size: 20px;">!</span>`;
                    console.error('Ошибка скачивания в красивой кнопке:', error);
                });
            };
        }
        ,
        processPlayButtons: function (playButtonsContent) {

            const playButtons = playButtonsContent.querySelectorAll('div[class*="Track_root__"],div[class*="TrackCard_root__"]');

            playButtons.forEach((playButton, index) => {
                const link = playButton.querySelector('a[class*="Meta_albumLink__"],a[class*="TrackCard_titleLink__"]');
                const meta = playButton.querySelector('div[class*="Meta_titleContainer"],div[class*="TrackCard_titleContainer"]');

                if (link) {
                    const regex = /\/track\/(\d+)/;
                    const match = link.href.match(regex);
                    const trackId = match ? match[1] : null;
                    if (trackId) {

                        if (!meta.querySelector('button.added')) {

                            const downloadButton = document.createElement('button');
                            let style = 'background-color: #fc3;color: black;border-radius: 4px;display: flex;cursor: pointer;border: none;padding: 4px 10px;position: absolute;left: 40%;top: 35px;z-index:9999;';
                            downloadButton.textContent = 'Скачать';
                            downloadButton.classList.add('added');
                            downloadButton.setAttribute('style', style);

                            meta.appendChild(downloadButton);

                            downloadButton.addEventListener('click', function (event) {
                                event.stopPropagation();
                                downloadButton.textContent = 'Собираю клубнику...)))';
                                downloadButton.setAttribute('disabled', 'disabled');

                                appYa.fetchFileInfoOne(trackId).then(result => {
                                    let downloadData = JSON.parse(result);
                                    let artist = downloadData.trackinfo.artists.map(art => art.name).join(", ");
                                    let filename = `${artist} - ${downloadData.trackinfo.title}.mp3`

                                    downloadButton.textContent = 'Загрузка...';
                                    downloadButton.setAttribute('disabled', 'disabled');

                                    const downloadLink = document.createElement('a');
                                    downloadLink.href = downloadData.download;
                                    downloadLink.download = filename;
                                    downloadLink.style.display = 'none';
                                    document.body.appendChild(downloadLink);

                                    downloadLink.click();

                                    if (document.body.removeChild(downloadLink)) {
                                        setTimeout(function () {
                                            downloadButton.textContent = 'Загрузка...';
                                            downloadButton.removeAttribute('disabled');
                                            downloadButton.textContent = 'Скачать';
                                        }, 1000)
                                    }
                                }).catch(error => {
                                    downloadButton.removeAttribute('disabled');
                                    downloadButton.textContent = error;
                                    downloadButton.remove();
                                });
                            });
                        }
                    }
                }
            });
        },

        reToken: function () {
            if (window.location.hash) {
                const cleanedString = window.location.hash.substring(1);
                const pairs = cleanedString.split('&');
                const params = {};

                pairs.forEach(pair => {
                    const [key, value] = pair.split('=');
                    params[key] = value;
                });

                localStorage.setItem('appYa_token', JSON.stringify(params));
                window.location.href = appYa.location_origin;

            } else {
                let appYa_authorizationUrl = (`${appYa.oauthUrl}authorize?response_type=token&client_id=${appYa.client_id}&redirect_uri=${appYa.redirect_uri}`);
                localStorage.setItem('appYa_authorizationUrl', appYa_authorizationUrl)
            }
        },

        generateSign: async function (secretKey, data) {
            const encoder = new TextEncoder();
            const keyData = encoder.encode(secretKey);

            const cryptoKey = await crypto.subtle.importKey('raw', keyData, {
                name: 'HMAC',
                hash: {name: 'SHA-256'}
            }, false, ['sign']);

            const dataEncoded = encoder.encode(data);

            const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataEncoded);

            return btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=+$/, '');
        },

        fetchFileInfoOne: async function (trackId) {
            const secretKey = 'kzqU4XhfCaY6B6JTHODeq5';
            const timestamp = Math.floor(Date.now() / 1000);

            const appYa_setting_audioQuality = localStorage.getItem('appYa_setting_audioQuality') ?? 'lossless';

            const dataToSign = `${timestamp}${trackId}${appYa_setting_audioQuality}flacraw`;

            const sign = await appYa.generateSign(secretKey, dataToSign);

            const params = new URLSearchParams({
                ts: timestamp,
                trackId: trackId,
                quality: appYa_setting_audioQuality,
                codecs: 'flac',
                transports: 'raw',
                sign: sign
            });

            const headers = new Headers({
                'Authorization': `OAuth ${appYa.tokenData.access_token}`,
                'X-Yandex-Music-Client': 'YandexMusicDesktopAppWindows/2'
            });

            const url = `${appYa.apiUrl}get-file-info?${params.toString()}&byVectorserver=1`;
            const urlInfo = `${appYa.apiUrl}tracks?trackIds=${trackId}&byVectorserver=1`;

            try {
                const [response1, response2] = await Promise.all([fetch(url, {headers}), fetch(urlInfo, {headers})]);

                if (!response1.ok) {
                    throw new Error(`HTTP error! status: ${response1.status}`);
                }
                if (!response2.ok) {
                    throw new Error(`HTTP error! status: ${response2.status}`);
                }

                const data1 = await response1.json();
                const data2 = await response2.json();

                const downloadUrl = data1.result.downloadInfo.url;
                const trackInfo = data2.result[0];

                const response = await fetch(downloadUrl);
                if (!response.ok) {
                    throw new Error(`Ошибка загрузки MP3: ${response.statusText}`);
                }
                const mp3Data = new Uint8Array(await response.arrayBuffer());

                const appYa_setting_coverQuality = localStorage.getItem('appYa_setting_coverQuality') ?? '400';
                let qq = `${appYa_setting_coverQuality}x${appYa_setting_coverQuality}`

                const coverUrl = trackInfo.albums[0].coverUri.replace('%%', qq) +"/?byVectorserver=1";
                const artistUrl = trackInfo.artists[0].cover?.uri?.replace('%%', qq) +"/?byVectorserver=1";

                const coverResponse = await fetch(`https://${coverUrl}`);
                //const artistcoverResponse = await fetch(`https://${artistUrl}`);

                if (!coverResponse.ok) {
                    throw new Error(`Ошибка загрузки обложки: ${coverResponse.statusText} - ${coverUrl}`);
                }

                const coverData = new Uint8Array(await coverResponse.arrayBuffer());
                //const artistcoverResponseData = new Uint8Array(await artistcoverResponse.arrayBuffer());

                const writer = new ID3Writer(mp3Data);
                const currentTrackNumber = trackInfo.albums[0].trackPosition.index || '1';
                const totalTracksInAlbum = trackInfo.albums[0].trackCount || '1';

                writer.setFrame('TIT2', trackInfo.title)
                    .setFrame('TPE1', [trackInfo.artists.map(a => a.name).join(', ')])
                    .setFrame('TALB', trackInfo.albums[0].title)
                    .setFrame('TYER', trackInfo.albums[0].year)
                    .setFrame('TCON', trackInfo.albums[0]?.genre?.split(',') || ['Unknown'])
                    .setFrame('TRCK', `${currentTrackNumber}/${totalTracksInAlbum}`)
                    .setFrame('APIC', {
                        type: 3, data: coverData, description: 'Cover (front)'
                    }).addTag();
                    /*.setFrame('APIC', {
                        type: 17, data: artistcoverResponseData, description: 'Band Logo'
                    })*/


                const updatedMp3 = writer.arrayBuffer;
                const blob = new Blob([updatedMp3], {type: 'audio/mpeg'});

                const blobUrl = URL.createObjectURL(blob);

                const allData = JSON.stringify({'download': blobUrl, 'trackinfo': trackInfo});
                return allData;
            } catch (error) {
                console.error('Error fetching file info:', error);
            }
        },

        parsePage: async function () {
            try {
                let url = window.location.href;
                if (url.includes('/artist') && !url.endsWith('/tracks')) {
                    url = `${url}/tracks`;
                }

                const response = await fetch(url);

                if (!response.ok) return;

                const html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const scriptElements = doc.querySelectorAll("body > script");

                const pushRegex = /\(window\.__STATE_PATCHES__\s*=\s*window\.__STATE_PATCHES__\s*\|\|\s*\[\]\)\.push\(([\s\S]*?)\);/g;
                const mergedObject = [];

                scriptElements.forEach((script) => {
                    const content = script.textContent;
                    const matches = content.matchAll(pushRegex);

                    for (const match of matches) {
                        const pushData = match[1];
                        try {
                            const parsedData = new Function(`return ${pushData};`)();
                            mergedObject.push(parsedData);
                        } catch (e) {
                            // Silent catch
                        }
                    }
                });

                const allPatches = mergedObject.flat();
                const finalTree = {};

                allPatches.forEach(patch => {
                    if (!patch || !patch.path) return;

                    const keys = patch.path.split('/').filter(Boolean);
                    let current = finalTree;

                    for (let i = 0; i < keys.length - 1; i++) {
                        const key = keys[i];
                        if (!current[key]) {
                            current[key] = {};
                        }
                        current = current[key];
                    }

                    const lastKey = keys[keys.length - 1];
                    if (lastKey !== undefined) {
                        current[lastKey] = patch.value;
                    }
                });

                localStorage.removeItem('appYa_page');
                const currentDataString = JSON.stringify(finalTree);
                localStorage.setItem('appYa_page', currentDataString);

            } catch (error) {
                // Silent catch
            }
        },

        extractFolderFromUrl(url) {
            try {
                const path = new URL(url).pathname;
                return path.split('/').filter(segment => segment !== '')[0] || 'root';
            } catch (error) {
                return 'unknown';
            }
        },

        monitorFetchRequests() {
            const originalFetch = window.fetch;

            window.fetch = async (url, options) => {
                let requestUrl = "";
                if (url instanceof Request) {
                    requestUrl = url.url;
                } else if (url) {
                    requestUrl = url.toString();
                }

                if (requestUrl.includes('byVectorserver')) {
                    return await originalFetch(url, options);
                }



                let response = await originalFetch(url, options);
                let clonedResponse = response.clone();

                if (response.status === 206) {
                    // Media request success
                }

                const contentType = clonedResponse.headers.get("content-type");
                if (contentType?.includes("application/json")) {
                    try {

                        const folder = this.extractFolderFromUrl(clonedResponse.url);
                        const data = await clonedResponse.json();
                        if (data && Object.keys(data).length > 0) {
                            localStorage.setItem(`appYa_${folder}`, JSON.stringify(data));
                        }
                    } catch (e) {
                    }
                }

                return response;
            };
        },

        addImageToAudio: async function (audioURL, imageURL) {
            return new Promise(async (resolve, reject) => {
                try {
                    const audioResponse = await fetch(audioURL);
                    const audioArrayBuffer = await audioResponse.arrayBuffer();

                    const imageResponse = await fetch(imageURL);
                    const imageArrayBuffer = await imageResponse.arrayBuffer();

                    if (imageResponse && audioResponse) {
                        var writer = new ID3Writer(audioArrayBuffer);
                        writer
                            .setFrame('APIC', {
                                type: 3, data: imageArrayBuffer, description: 'Super picture',
                            });
                        writer.addTag();

                        const newBlob = new Blob([writer.arrayBuffer], {type: 'audio/mpeg'});
                        const url = URL.createObjectURL(newBlob);
                        resolve(url);
                    }
                } catch (error) {
                    reject(new Error(`Ошибка при добавлении изображения: ${error.message}`));
                }
            });
        }
    }

    window.appYa = appYa;
})();