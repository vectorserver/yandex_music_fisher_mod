/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};
/******/
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/
/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId]) {
/******/ 			return installedModules[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			i: moduleId,
/******/ 			l: false,
/******/ 			exports: {}
/******/ 		};
/******/
/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/
/******/ 		// Flag the module as loaded
/******/ 		module.l = true;
/******/
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/
/******/
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;
/******/
/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;
/******/
/******/ 	// define getter function for harmony exports
/******/ 	__webpack_require__.d = function(exports, name, getter) {
/******/ 		if(!__webpack_require__.o(exports, name)) {
/******/ 			Object.defineProperty(exports, name, {
/******/ 				configurable: false,
/******/ 				enumerable: true,
/******/ 				get: getter
/******/ 			});
/******/ 		}
/******/ 	};
/******/
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = function(module) {
/******/ 		var getter = module && module.__esModule ?
/******/ 			function getDefault() { return module['default']; } :
/******/ 			function getModuleExports() { return module; };
/******/ 		__webpack_require__.d(getter, 'a', getter);
/******/ 		return getter;
/******/ 	};
/******/
/******/ 	// Object.prototype.hasOwnProperty.call
/******/ 	__webpack_require__.o = function(object, property) { return Object.prototype.hasOwnProperty.call(object, property); };
/******/
/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";
/******/
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(__webpack_require__.s = 7);
/******/ })
/************************************************************************/
/******/ ({

/***/ 7:
/***/ (function(module, exports, __webpack_require__) {

if (false) {
    chrome = browser;
}

const $ = document.getElementById.bind(document);
const checkboxes = [
    'shouldDownloadCover',
    'enumerateAlbums',
    'enumeratePlaylists',
    'singleClickDownload',
    'shouldUseFolder'
];
const selects = [
    'downloadThreadCount',
    'albumCoverSize',
    'albumCoverSizeId3'
];
const texts = [
    'folder'
];

let background;

window.addEventListener('error', e => {
    background.console.warn(e.error.stack);
    e.returnValue = false;
});

window.addEventListener('unhandledrejection', e => {
    background.console.warn(e.reason);
    e.returnValue = false;
});

function afterCheckboxChanged(checkbox) { // изменение UI
    const checked = $(checkbox).checked;

    if (checkbox === 'shouldDownloadCover') {
        if (checked) {
            $('albumCoverSize').removeAttribute('disabled');
        } else {
            $('albumCoverSize').setAttribute('disabled', 'disabled');
        }
    } else if (checkbox === 'shouldUseFolder') {
        if (checked) {
            $('folder').removeAttribute('disabled');
        } else {
            $('folder').setAttribute('disabled', 'disabled');
        }
    }
}

checkboxes.forEach(checkbox => {
    $(checkbox).addEventListener('click', () => {
        const checked = $(checkbox).checked;

        background.fisher.storage.setItem(checkbox, checked);
        afterCheckboxChanged(checkbox);
    });
});

selects.forEach(select => {
    $(select).addEventListener('click', () => {
        let value = $(select).value;

        if (select === 'downloadThreadCount') {
            value = parseInt(value, 10);
        }
        background.fisher.storage.setItem(select, value);
    });
});

texts.forEach(text => {
    $(text).addEventListener('input', () => {
        let value = $(text).value;

        if (text === 'folder') {
            value = background.fisher.utils.clearPath(value, true);
            if (value === '') {
                return; // не сохраняем
            }
        }
        background.fisher.storage.setItem(text, value);
    });
});

$('btnReset').addEventListener('click', () => {
    background.fisher.storage.reset();
    loadOptions(background);
});

function loadOptions(backgroundPage) {
    background = backgroundPage;

    checkboxes.forEach(checkbox => {
        $(checkbox).checked = background.fisher.storage.getItem(checkbox);
        afterCheckboxChanged(checkbox);
    });

    selects.forEach(select => {
        $(select).value = background.fisher.storage.getItem(select);
    });

    texts.forEach(text => {
        $(text).value = background.fisher.storage.getItem(text);
    });
}

chrome.runtime.getBackgroundPage(loadOptions);


/***/ })

/******/ });