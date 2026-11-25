/**
 * Yandex Music Fisher mod by vectorserver
 * constants.js — единая точка конфигурации расширения v3.
 *
 * Здесь собраны: брендинг, эндпоинты Яндекс.Музыки, имена/версии хранилищ,
 * значения настроек по умолчанию и лимиты очереди загрузок.
 *
 * @author vectorserver
 * @version 3.0.0
 */

/** Брендинг — должен присутствовать во всех файлах сборки. */
export const BRAND = 'Yandex Music Fisher mod by vectorserver';
export const LOG_PREFIX = '[appYa v3]';

/** Версия приложения берётся из манифеста при старте, это — фолбэк. */
export const APP_VERSION_FALLBACK = '3.0.0';

/* -------------------------------------------------------------------------- */
/* Яндекс.Музыка: API и авторизация                                           */
/* -------------------------------------------------------------------------- */

export const API_URL = 'https://api.music.yandex.ru/';
export const OAUTH_URL = 'https://oauth.yandex.ru/';
export const CLIENT_ID = '97fe03033fa34407ac9bcf91d5afed5b';
export const REDIRECT_URI = 'https://music.yandex.ru/oauth';
export const LOCATION_ORIGIN = 'https://music.yandex.ru/?yamusic=ok';

/** Соль для подписи /get-file-info (публичный ключ десктопного клиента). */
export const SIGN_SECRET = 'kzqU4XhfCaY6B6JTHODeq5';

/** Маркер запросов расширения — позволяет не перехватывать их собственным fetch-hook. */
export const QUERY_MARK = 'byVectorserver=1';

/** Заголовок клиента, под которым Яндекс отдаёт lossless. */
export const MUSIC_CLIENT_HEADER = 'YandexMusicDesktopAppWindows/2';

/* -------------------------------------------------------------------------- */
/* chrome.storage: ключи                                                      */
/* -------------------------------------------------------------------------- */

export const STORAGE_KEYS = {
    SETTINGS: 'app_setting',   // совместимость с prod (v2)
    DB: 'aYa_db',              // снапшот localStorage страницы (совместимость с prod)
    TAB_ID: 'aYa_tabID',       // id вкладки с открытой музыкой
    QUEUE_STATE: 'aYa_queue',  // лёгкий снимок состояния очереди
};

/** Префикс ключей настроек в localStorage страницы (читается parser.js). */
export const PAGE_SETTING_PREFIX = 'aYa_setting_';

/* -------------------------------------------------------------------------- */
/* IndexedDB: база истории / очереди / чанков                                 */
/* -------------------------------------------------------------------------- */

export const DB_NAME = 'YandexMusicFisherV3';
export const DB_VERSION = 1;

export const STORES = {
    HISTORY: 'history', // скачанные/попытанные треки
    QUEUE: 'queue',     // задачи очереди (ждущие, активные, ошибочные)
    CHUNKS: 'chunks',   // частично скачанные байты для докачки (Range)
    CACHE: 'cache',     // кэш метаданных треков/обложек
};

/** Максимум записей истории, после которого старые обрезаются. */
export const HISTORY_LIMIT = 2000;

/** Размер чанка при докачке (1 MiB) — компромисс между числом записей IDB и памятью. */
export const CHUNK_SIZE = 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Очередь загрузок                                                           */
/* -------------------------------------------------------------------------- */

export const QUEUE = {
    /** Сколько треков качаем параллельно (фолбэк, если не задано в настройках). */
    DEFAULT_CONCURRENCY: 2,
    /** Попыток автоповтора перед переводом в «ошибка». */
    MAX_ATTEMPTS: 4,
    /** База exponential backoff в мс: 1s, 2s, 4s, 8s... */
    BACKOFF_BASE_MS: 1000,
    /** Потолок задержки повтора. */
    BACKOFF_MAX_MS: 60000,
    /** Интервал keepalive-аларма, чтобы SW не выгружался во время работы (мин. 0.5 в Chrome). */
    KEEPALIVE_PERIOD_MIN: 0.5,
    /** Имена алармов. */
    ALARM_KEEPALIVE: 'aYa_keepalive',
    ALARM_SWEEP: 'aYa_queue_sweep',
};

/** Таймауты сетевых операций (мс). */
export const TIMEOUTS = {
    /** На один fetch-чанк. */
    CHUNK: 45000,
    /** На API-запрос к api.music.yandex.ru. */
    API: 20000,
    /** На загрузку обложки. */
    COVER: 15000,
};

/* -------------------------------------------------------------------------- */
/* Настройки по умолчанию (v3)                                                */
/* -------------------------------------------------------------------------- */

export const DEFAULT_SETTINGS = {
    downloadFolder: 'music/',
    coverQuality: 600,
    audioQuality: 'lossless',
    downlodadCount: 4,        // совместимость с prod (орфография сохранена намеренно)
    savehistory: '1',
    numberingTracks: false,
    aiSuspicion: false,
    // --- новые настройки v3 ---
    writeId3: true,           // писать ли ID3-теги (иначе — прямая загрузка stream URL)
    resumeEnabled: true,      // докачка через HTTP Range
    maxConcurrent: 2,         // параллельных загрузки
    maxAttempts: 4,           // автоповторов при ошибке
    coverMaxBytes: 250000,    // если обложка тяжелее — сжать через OffscreenCanvas
};

/** Варианты качества звука, валидируемые на входе. */
export const AUDIO_QUALITIES = ['lq', 'nq', 'lossless'];

/** Разрешения обложек, доступные в UI. */
export const COVER_SIZES = [200, 300, 400, 600, 800, 1000];

/* -------------------------------------------------------------------------- */
/* Статусы задач/истории                                                      */
/* -------------------------------------------------------------------------- */

export const STATUS = {
    QUEUED: 'queued',
    DOWNLOADING: 'downloading',
    TAGGING: 'tagging',
    SAVING: 'saving',
    DONE: 'done',
    ERROR: 'error',
    PAUSED: 'paused',
    SKIPPED: 'skipped',
};

export const STATUS_LABELS = {
    [STATUS.QUEUED]: 'В очереди',
    [STATUS.DOWNLOADING]: 'Загрузка',
    [STATUS.TAGGING]: 'ID3-теги',
    [STATUS.SAVING]: 'Сохранение',
    [STATUS.DONE]: 'Готово',
    [STATUS.ERROR]: 'Ошибка',
    [STATUS.PAUSED]: 'Пауза',
    [STATUS.SKIPPED]: 'Пропущен',
};

/** Цвета badge-счётчика (пул ограничен, без бесконечного роста массива). */
export const BADGE_COLORS = [
    '#FF5733', '#33FF57', '#3357FF', '#FF33A1',
    '#FFBD33', '#33FFF4', '#B333FF', '#33FFA1',
];

/** Соответствие разделов сайта → человекочитаемый тип для истории. */
export const PAGE_TYPES = {
    album: 'Альбом',
    playlist: 'Плейлист',
    artist: 'Артист',
    chart: 'Чарт',
    music: 'Мои данные',
};
