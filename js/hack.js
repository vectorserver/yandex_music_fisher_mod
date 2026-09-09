(function() {
    window.globalVolume = window.globalVolume || 1.0;
    window.currentPlayingTrack = null;

    // Перехват плеера
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
        window.currentPlayingTrack = this;
        this.volume = window.globalVolume;
        return originalPlay.apply(this, arguments);
    };

    // Функция для перевода секунд в формат ММ:СС
    function formatTime(seconds) {
        if (isNaN(seconds)) return "00:00";
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    // 🔥 СУПЕР-МЕТОД ОТЛАДКИ
    window.debugTrack = function() {
        const player = window.currentPlayingTrack;
        if (!player) {
            console.error("❌ Плеер еще не активен. Включите или переключите трек!");
            return;
        }

        // Вычисляем, сколько процентов трека загружено в буфер (память)
        let bufferedPercent = 0;
        if (player.buffered.length > 0 && player.duration) {
            bufferedPercent = ((player.buffered.end(player.buffered.length - 1) / player.duration) * 100).toFixed(1);
        }

        // Расшифровка статуса сети (Network State)
        const netStates = ["0: Пусто", "1: Ожидание (Idle)", "2: Загрузка данных", "3: Файл не найден/Ошибка"];

        // Сбор всех полезных данных в объект
        const report = {
            "🎵 Текущее время": `${formatTime(player.currentTime)} / ${formatTime(player.duration)} (${((player.currentTime / player.duration) * 100 || 0).toFixed(1)}%)`,
            "⏳ Забуферено (скачано в память)": `${bufferedPercent}%`,
            "🔊 Громкость (вкладки / системы)": `${(player.volume * 100).toFixed(0)}% (Muted: ${player.muted})`,
            "🔗 Тип источника (Поток)": player.currentSrc.startsWith('blob:') ? "📦 BLOB (Защищенный стриминг сегментами)" : "🌐 Прямая ссылка (MP3/MP4)",
            "📡 Статус сети браузера": netStates[player.networkState] || "Неизвестно",
            "🏃 Скорость воспроизведения": `${player.playbackRate}x`,
            "🛑 Состояние": player.paused ? "⏸️ Пауза" : "▶️ Играет",
            "📐 Разрешение (если это видео)": player.videoWidth ? `${player.videoWidth}x${player.videoHeight}` : "🔈 Только аудио"
        };

        // Красивый вывод в виде интерактивной таблицы
        console.clear();
        console.log("%c📊 МИНИ-ПУЛЬТ ОТЛАДКИ АУДИОПОТОКА:", "color: #ffdb4d; font-weight: bold; font-size: 14px; background: #222; padding: 5px 10px; border-radius: 4px;");
        console.table(report);

        // Выводим ссылку отдельно, чтобы её можно было удобно скопировать кликом
        console.log("%c🔗 ПРЯМАЯ ССЫЛКА НА ПОТОК:", "color: #00ffcc; font-weight: bold;");
        console.log(player.currentSrc || player.src);
        console.log("player");
        console.log(player);
    };

    // 🔄 АВТО-ОБНОВЛЕНИЕ (чтобы цифры бежали в реальном времени)
    window.startLiveDebug = function() {
        if (window.liveDebugInterval) clearInterval(window.liveDebugInterval);
        window.liveDebugInterval = setInterval(window.debugTrack, 1000);
        console.log("⏱️ Живой мониторинг запущен. Данные обновляются каждую секунду. Чтобы остановить, введите: stopLiveDebug()");
    };

    window.stopLiveDebug = function() {
        clearInterval(window.liveDebugInterval);
        console.log("🛑 Живой мониторинг остановлен.");
    };

    console.log("✅ Мощный отладчик готов! Команды в консоли:\n1️⃣ debugTrack() — разовый отчет\n2️⃣ startLiveDebug() — живой плеер в реальном времени");
})();
