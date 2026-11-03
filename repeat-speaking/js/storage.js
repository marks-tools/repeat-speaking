/* storage.js - IndexedDB 保存（仕様書14章。Phase 1 は履歴の簡易記録）
   保存対象: 学習履歴 / ユーザー追加の許容回答。設定は localStorage にも保持する。 */
(function (global) {
  'use strict';

  var DB_NAME = 'repeat-speaking';
  var DB_VERSION = 1;
  var SETTINGS_KEY = 'rs-settings-v1';
  var LS_HISTORY_KEY = 'rs-history-fallback-v1';
  var LS_EXTRA_KEY = 'rs-extra-accepted-v1';
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) { reject(new Error('no-idb')); return; }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('history')) {
          db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('extraAccepted')) {
          db.createObjectStore('extraAccepted', { keyPath: 'questionId' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function idbAdd(store, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).add(value);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGetAll(store) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function lsRead(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function lsWrite(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できなくても学習は続行する */ }
  }

  /* 履歴を1件保存する。IndexedDB が使えない環境では localStorage に退避する。 */
  function saveHistory(entry) {
    return idbAdd('history', entry).catch(function () {
      var list = lsRead(LS_HISTORY_KEY, []);
      list.push(entry);
      lsWrite(LS_HISTORY_KEY, list);
      return false;
    });
  }

  function loadHistory() {
    return idbGetAll('history').catch(function () { return lsRead(LS_HISTORY_KEY, []); });
  }

  /* ユーザーが追加した許容回答（端末内のみ。Phase 3 の UI から使う） */
  function saveExtraAccepted(questionId, answers) {
    var record = { questionId: questionId, answers: answers, updatedAt: new Date().toISOString() };
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('extraAccepted', 'readwrite');
        tx.objectStore('extraAccepted').put(record);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () {
      var map = lsRead(LS_EXTRA_KEY, {});
      map[questionId] = answers;
      lsWrite(LS_EXTRA_KEY, map);
      return false;
    });
  }

  function loadExtraAccepted() {
    return idbGetAll('extraAccepted').then(function (rows) {
      var map = {};
      rows.forEach(function (r) { map[r.questionId] = r.answers || []; });
      return map;
    }).catch(function () { return lsRead(LS_EXTRA_KEY, {}); });
  }

  function loadSettings() {
    return lsRead(SETTINGS_KEY, null) || {
      questionCount: 10,
      level: 'beginner',
      answerMethod: 'voice',
      hintEnabled: false,
      modelPlayback: 'manual',
      afterCorrect: 'manual',
      voiceLang: 'en-US'
    };
  }
  function saveSettings(settings) { lsWrite(SETTINGS_KEY, settings); }

  global.RSStorage = {
    saveHistory: saveHistory,
    loadHistory: loadHistory,
    saveExtraAccepted: saveExtraAccepted,
    loadExtraAccepted: loadExtraAccepted,
    loadSettings: loadSettings,
    saveSettings: saveSettings
  };
})(window);
