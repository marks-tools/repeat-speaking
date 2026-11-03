/* Repeat / Speaking（リピスラ）v0.1.0 - app.js（単一ファイル版）
   Phase 1 試作。元は js/ の8モジュールを仕様書15章の構成で分割実装し、
   取り回し用に1本へ統合したもの。問題データはこのファイル内に内蔵している。
   学習サイクル: 出題 → 発話 → 確認 → 判定 → お手本 → 再発話 → 次の問題 */

/* ===== storage.js: IndexedDB 保存 ===== */
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

/* ===== evaluator.js: 正規化と照合 ===== */
/* evaluator.js - 正規化と登録済み回答との照合（仕様書8章）
   原則: 模範と違うこと自体を誤答にしない。類似度で正誤を決めない。 */
(function (global) {
  'use strict';

  var CONTRACTIONS = {
    "i've": 'i have', "you've": 'you have', "we've": 'we have', "they've": 'they have',
    "he's": 'he has', "she's": 'she has',
    "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are',
    "i'll": 'i will', "you'll": 'you will', "we'll": 'we will', "they'll": 'they will',
    "haven't": 'have not', "hasn't": 'has not',
    "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
    "can't": 'can not', "cannot": 'can not', "won't": 'will not',
    "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not',
    "i'd": 'i would', "let's": 'let us'
  };

  function expandContractions(text) {
    return text.split(' ').map(function (word) {
      return Object.prototype.hasOwnProperty.call(CONTRACTIONS, word) ? CONTRACTIONS[word] : word;
    }).join(' ');
  }

  /* 比較前の正規化: 大小文字・句読点・余分な空白・短縮形。
     意味の違いが生じる変換は行わない。 */
  function normalize(text) {
    if (text == null) return '';
    var t = String(text)
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .toLowerCase()
      .replace(/[.,!?;:""]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    t = expandContractions(t);
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  /* 戻り値: 'accepted' | 'undetermined' （未判定。不正解ではない） */
  function evaluate(answerText, question, extraAccepted) {
    var target = normalize(answerText);
    if (!target) return 'undetermined';
    var accepted = (question.acceptedAnswers || []).slice();
    if (Array.isArray(extraAccepted)) accepted = accepted.concat(extraAccepted);
    if (accepted.indexOf(question.primaryAnswer) === -1 && question.primaryAnswer) {
      accepted.push(question.primaryAnswer);
    }
    for (var i = 0; i < accepted.length; i++) {
      if (normalize(accepted[i]) === target) return 'accepted';
    }
    return 'undetermined';
  }

  var api = { normalize: normalize, evaluate: evaluate, expandContractions: expandContractions };
  global.RSEvaluator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== speech.js: 音声認識と音声合成 ===== */
/* speech.js - 音声認識と音声合成（仕様書15.3）
   認識に失敗しても発音が悪いとは断定しない。状態はコールバックで画面へ返す。 */
(function (global) {
  'use strict';

  function recognitionCtor() {
    return global.SpeechRecognition || global.webkitSpeechRecognition || null;
  }
  function isRecognitionSupported() { return !!recognitionCtor(); }
  function isSynthesisSupported() { return 'speechSynthesis' in global; }

  var activeRecognition = null;

  /* callbacks: onResult(text), onFailure(reason), onState(state) */
  function startRecognition(lang, callbacks) {
    var Ctor = recognitionCtor();
    if (!Ctor) { callbacks.onFailure('unsupported'); return false; }
    stopRecognition();
    var rec = new Ctor();
    activeRecognition = rec;
    rec.lang = lang || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    var settled = false;

    callbacks.onState('recognizing');
    rec.onresult = function (event) {
      var text = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) text += event.results[i][0].transcript;
      }
      if (text && !settled) {
        settled = true;
        callbacks.onState('done');
        callbacks.onResult(text.trim());
      }
    };
    rec.onerror = function (event) {
      if (settled) return;
      settled = true;
      callbacks.onState('failed');
      /* not-allowed / service-not-allowed は許可の問題、それ以外も一括して再試行可能として扱う */
      callbacks.onFailure(event && event.error ? event.error : 'error');
    };
    rec.onend = function () {
      if (activeRecognition === rec) activeRecognition = null;
      if (!settled) {
        settled = true;
        callbacks.onState('failed');
        callbacks.onFailure('no-speech');
      }
    };
    try {
      rec.start();
      return true;
    } catch (e) {
      callbacks.onFailure('start-error');
      return false;
    }
  }

  function stopRecognition() {
    if (activeRecognition) {
      try { activeRecognition.abort(); } catch (e) { /* noop */ }
      activeRecognition = null;
    }
  }

  function pickVoice(lang) {
    if (!isSynthesisSupported()) return null;
    var voices = global.speechSynthesis.getVoices() || [];
    var exact = voices.filter(function (v) { return v.lang === lang; });
    if (exact.length) return exact[0];
    var prefix = lang.split('-')[0];
    var near = voices.filter(function (v) { return (v.lang || '').indexOf(prefix) === 0; });
    return near.length ? near[0] : null;
  }

  function speak(text, lang, onend) {
    if (!isSynthesisSupported() || !text) { if (onend) onend(); return false; }
    global.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang || 'en-US';
    var voice = pickVoice(utter.lang);
    if (voice) utter.voice = voice;
    utter.rate = 0.95;
    if (onend) {
      utter.onend = onend;
      utter.onerror = onend;
    }
    global.speechSynthesis.speak(utter);
    return true;
  }

  global.RSSpeech = {
    isRecognitionSupported: isRecognitionSupported,
    isSynthesisSupported: isSynthesisSupported,
    startRecognition: startRecognition,
    stopRecognition: stopRecognition,
    speak: speak
  };
})(window);

/* ===== questions.js: 問題データ（内蔵） ===== */
/* questions.js - 問題データの読み込み・検索（仕様書10章・15.2）
   標準問題は data/questions.json が正本。読み込めない環境向けに同一内容の退避コピーを持つ。 */
(function (global) {
  'use strict';

  var FALLBACK_QUESTIONS = [{"acceptedAnswers":["I've seen that movie before.","I have seen that movie before.","I've watched that movie before.","I have watched that movie before."],"chunks":[{"en":"I've seen that movie","ja":"その映画を見たことがあります"},{"en":"before.","ja":"以前に"}],"contextJa":"友達に映画を見た経験を話しています。","explanation":"過去の特定の日ではなく、これまでの経験を表します。","grammarTags":["present-perfect","experience"],"hints":{"full":"I've seen that movie / before.","pattern":"I've seen ... / before.","structure":"S + have + 過去分詞 + O"},"id":"RS-PP-001","level":1,"modeTags":["tense","shuffle"],"patternTags":["have-past-participle"],"primaryAnswer":"I've seen that movie before.","promptJa":"私はその映画を見たことがあります。","verbTags":["see"]},{"acceptedAnswers":["I've never been to Kyoto.","I have never been to Kyoto."],"chunks":[{"en":"I've never been","ja":"行ったことがありません"},{"en":"to Kyoto.","ja":"京都へ"}],"contextJa":"旅行の経験について話しています。","explanation":"never を使うと「一度も〜したことがない」という経験の否定になります。","grammarTags":["present-perfect","experience","negative"],"hints":{"full":"I've never been / to Kyoto.","pattern":"I've never been / to ... .","structure":"S + have never + 過去分詞"},"id":"RS-PP-002","level":1,"modeTags":["tense","shuffle"],"patternTags":["have-never"],"primaryAnswer":"I've never been to Kyoto.","promptJa":"私は京都へ行ったことがありません。","verbTags":["go","be"]},{"acceptedAnswers":["Have you ever eaten Japanese curry?","Have you ever had Japanese curry?"],"chunks":[{"en":"Have you ever eaten","ja":"食べたことがありますか"},{"en":"Japanese curry?","ja":"日本カレーを"}],"contextJa":"相手に食べた経験をたずねています。","explanation":"ever は疑問文で「これまでに」という経験をたずねるときに使います。","grammarTags":["present-perfect","experience","question"],"hints":{"full":"Have you ever eaten / Japanese curry?","pattern":"Have you ever eaten / ... ?","structure":"Have + S + ever + 過去分詞 + O ?"},"id":"RS-PP-003","level":1,"modeTags":["tense","shuffle"],"patternTags":["have-you-ever"],"primaryAnswer":"Have you ever eaten Japanese curry?","promptJa":"あなたは日本カレーを食べたことがありますか。","verbTags":["eat"]},{"acceptedAnswers":["I've just finished my homework.","I have just finished my homework.","I've just done my homework.","I have just done my homework."],"chunks":[{"en":"I've just finished","ja":"ちょうど終えたところです"},{"en":"my homework.","ja":"宿題を"}],"contextJa":"今まさに終わったことを伝えています。","explanation":"just は「ちょうど今終わった」という完了・結果を表します。","grammarTags":["present-perfect","completion"],"hints":{"full":"I've just finished / my homework.","pattern":"I've just finished / ... .","structure":"S + have just + 過去分詞 + O"},"id":"RS-PP-004","level":1,"modeTags":["tense","shuffle"],"patternTags":["have-just"],"primaryAnswer":"I've just finished my homework.","promptJa":"私はちょうど宿題を終えたところです。","verbTags":["finish"]},{"acceptedAnswers":["I've already eaten lunch.","I have already eaten lunch.","I've already had lunch.","I have already had lunch."],"chunks":[{"en":"I've already eaten","ja":"もう食べました"},{"en":"lunch.","ja":"昼ごはんを"}],"contextJa":"昼食に誘われて、すでに食べたことを伝えています。","explanation":"already は「もう済ませた」という完了を表します。","grammarTags":["present-perfect","completion"],"hints":{"full":"I've already eaten / lunch.","pattern":"I've already eaten / ... .","structure":"S + have already + 過去分詞 + O"},"id":"RS-PP-005","level":1,"modeTags":["tense","shuffle"],"patternTags":["have-already"],"primaryAnswer":"I've already eaten lunch.","promptJa":"私はもう昼ごはんを食べました。","verbTags":["eat","have"]},{"acceptedAnswers":["I haven't finished yet.","I have not finished yet.","I haven't finished it yet.","I have not finished it yet."],"chunks":[{"en":"I haven't finished","ja":"まだ終わっていません"},{"en":"yet.","ja":"まだ"}],"contextJa":"作業の進み具合を伝えています。","explanation":"yet は否定文の文末で「まだ〜していない」を表します。","grammarTags":["present-perfect","completion","negative"],"hints":{"full":"I haven't finished / yet.","pattern":"I haven't finished / yet.","structure":"S + have not + 過去分詞 + yet"},"id":"RS-PP-006","level":1,"modeTags":["tense","shuffle"],"patternTags":["have-not-yet"],"primaryAnswer":"I haven't finished yet.","promptJa":"私はまだ終わっていません。","verbTags":["finish"]},{"acceptedAnswers":["I watched a movie with my friends yesterday.","I saw a movie with my friends yesterday."],"chunks":[{"en":"I watched a movie","ja":"映画を見ました"},{"en":"with my friends","ja":"友達と"},{"en":"yesterday.","ja":"昨日"}],"contextJa":"昨日の出来事を話しています。","explanation":"yesterday のように過去の時点が決まっているときは過去形を使います。現在完了は使いません。","grammarTags":["past"],"hints":{"full":"I watched a movie / with my friends / yesterday.","pattern":"I watched a movie / with my friends / yesterday.","structure":"S + 過去形 + O"},"id":"RS-PT-001","level":1,"modeTags":["tense","shuffle"],"patternTags":["past-simple"],"primaryAnswer":"I watched a movie with my friends yesterday.","promptJa":"私は昨日、友達と映画を見ました。","verbTags":["watch"]},{"acceptedAnswers":["I went to Kyoto last year."],"chunks":[{"en":"I went","ja":"行きました"},{"en":"to Kyoto","ja":"京都へ"},{"en":"last year.","ja":"去年"}],"contextJa":"去年の旅行について話しています。","explanation":"last year と時点が決まっているので過去形です。行ったことがあるかという経験なら I've been to Kyoto. になります。","grammarTags":["past"],"hints":{"full":"I went / to Kyoto / last year.","pattern":"I went / to Kyoto / last year.","structure":"S + 過去形"},"id":"RS-PT-002","level":1,"modeTags":["tense","shuffle"],"patternTags":["past-simple"],"primaryAnswer":"I went to Kyoto last year.","promptJa":"私は去年、京都へ行きました。","verbTags":["go"]},{"acceptedAnswers":["I made a decision yesterday.","I decided yesterday."],"chunks":[{"en":"I made a decision","ja":"決断しました"},{"en":"yesterday.","ja":"昨日"}],"contextJa":"迷っていたことを昨日決めた、と伝えています。","explanation":"decide と make a decision はどちらも自然な表現です。どちらを使っても正解です。","grammarTags":["past"],"hints":{"full":"I made a decision / yesterday.","pattern":"I made a decision / yesterday.","structure":"S + made + O"},"id":"RS-PA-001","level":1,"modeTags":["tense","shuffle","verb"],"patternTags":["make-a-decision","past-simple"],"primaryAnswer":"I made a decision yesterday.","promptJa":"私は昨日、決断しました。","verbTags":["make","decide"]},{"acceptedAnswers":["I'm going to Kyoto next week.","I am going to Kyoto next week.","I'm going to go to Kyoto next week.","I am going to go to Kyoto next week."],"chunks":[{"en":"I'm going","ja":"行きます"},{"en":"to Kyoto","ja":"京都へ"},{"en":"next week.","ja":"来週"}],"contextJa":"来週の予定を話しています。","explanation":"決まっている予定は I'm going to ... で表すことが多いです。","grammarTags":["future"],"hints":{"full":"I'm going / to Kyoto / next week.","pattern":"I'm going / to Kyoto / next week.","structure":"S + be going + to + 場所"},"id":"RS-FU-001","level":1,"modeTags":["tense","shuffle"],"patternTags":["be-going-to"],"primaryAnswer":"I'm going to Kyoto next week.","promptJa":"私は来週、京都へ行きます。","verbTags":["go"]}];
  var cache = null;

  function loadQuestions() {
    if (cache) return Promise.resolve(cache);
    return fetch('data/questions.json', { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!Array.isArray(data) || data.length === 0) throw new Error('empty');
        cache = data;
        return cache;
      })
      .catch(function () {
        if (FALLBACK_QUESTIONS) {
          cache = FALLBACK_QUESTIONS;
          return cache;
        }
        throw new Error('問題データを読み込めませんでした。');
      });
  }

  function byId(id) {
    if (!cache) return null;
    for (var i = 0; i < cache.length; i++) if (cache[i].id === id) return cache[i];
    return null;
  }

  function filterByTags(tags) {
    if (!cache) return [];
    if (!tags || !tags.length) return cache.slice();
    return cache.filter(function (q) {
      var all = (q.modeTags || []).concat(q.grammarTags || [], q.verbTags || [], q.patternTags || []);
      return tags.some(function (t) { return all.indexOf(t) !== -1; });
    });
  }

  global.RSQuestions = { loadQuestions: loadQuestions, byId: byId, filterByTags: filterByTags };
})(window);

/* ===== learning.js: 出題順序と集計 ===== */
/* learning.js - 出題順序とセット集計（仕様書12章・13章）
   Phase 1: 10問を教材順（型の反復→比較）で出題する。初回回答だけを成績に数える。 */
(function (global) {
  'use strict';

  function buildSession(questions, count) {
    var list = (questions || []).slice(0, count || 10);
    return {
      questions: list,
      index: 0,
      firstResults: {}, /* questionId -> 'accepted' | 'undetermined' */
      attempts: {}      /* questionId -> attempt count */
    };
  }

  function current(session) {
    return session.questions[session.index] || null;
  }

  function recordAttempt(session, questionId, evaluationStatus, attemptNumber) {
    session.attempts[questionId] = attemptNumber;
    if (attemptNumber === 1 && !(questionId in session.firstResults)) {
      session.firstResults[questionId] = evaluationStatus;
    }
  }

  function summarize(session) {
    var accepted = 0, undetermined = 0, total = session.questions.length;
    Object.keys(session.firstResults).forEach(function (id) {
      if (session.firstResults[id] === 'accepted') accepted++;
      else if (session.firstResults[id] === 'undetermined') undetermined++;
    });
    return {
      total: total,
      answered: accepted + undetermined,
      accepted: accepted,
      undetermined: undetermined,
      skipped: total - accepted - undetermined
    };
  }

  function next(session) {
    if (session.index < session.questions.length - 1) {
      session.index++;
      return current(session);
    }
    return null;
  }

  global.RSLearning = {
    buildSession: buildSession,
    current: current,
    recordAttempt: recordAttempt,
    summarize: summarize,
    next: next
  };
})(window);

/* ===== ai-consult.js: 外部AI相談の質問文生成（Phase 3で画面接続） ===== */
/* ai-consult.js - 外部AI相談用の質問文生成（仕様書9章）
   Phase 1 では生成のみを用意し、画面への配置は Phase 3 で行う。
   外部AIへ情報を渡す操作は必ずユーザーのボタン操作を起点にする。 */
(function (global) {
  'use strict';

  var POLICY_LINES = [
    '1. 模範解答と異なっても、自然な英語なら正解としてください。',
    '2. 正しい英文を無理に書き換えないでください。',
    '3. 不自然な場合は、私が使った動詞・表現をできるだけ残して直してください。',
    '4. 私の表現を残すと意味が変わる場合は、そのことを説明してください。',
    '5. 語順・時制・動詞の使い方を簡潔に説明してください。',
    '6. 実際の会話で自然な表現を優先してください。',
    '7. 必要以上に難しい語彙へ置き換えないでください。'
  ];

  function buildPrompt(question, answerText) {
    var lines = [
      '英語のスピーキング練習で、次の日本語を英語で言いました。私の英文を添削してください。',
      '',
      '日本語のお題: ' + (question.promptJa || ''),
      '場面: ' + (question.contextJa || '特になし'),
      '私の回答: ' + (answerText || ''),
      '模範解答: ' + (question.primaryAnswer || ''),
      '',
      '添削方針:',
    ].concat(POLICY_LINES);
    return lines.join('\n');
  }

  global.RSAiConsult = { buildPrompt: buildPrompt };
})(window);

/* ===== screens.js: 画面表示と遷移 ===== */
/* screens.js - 画面表示と画面遷移（仕様書3章・15.2）
   S03 問題・発話と S04 回答確認は同一画面内の状態切り替えで実装する。 */
(function (global) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function show(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle('active', screens[i].id === 'screen-' + name);
    }
    window.scrollTo(0, 0);
  }

  function chunkSpansHtml(question) {
    return question.chunks.map(function (c, idx) {
      return '<button type="button" class="chunk" data-chunk-index="' + idx + '">' +
        escapeHtml(c.en) + '</button>';
    }).join('<span class="chunk-sep">/</span>');
  }

  function questionHtml(question, progress, opts) {
    var pct = Math.round((progress.current - 1) / progress.total * 100);
    var micNote = opts.recognitionSupported
      ? ''
      : '<p class="notice">このブラウザは音声認識に対応していないため、テキスト入力で回答してください。</p>';
    return '' +
      '<div class="practice-head">' +
        '<div class="practice-title">Repeat / Speaking</div>' +
        '<div class="practice-meta"><span>今日の10問</span><span>' + progress.current + ' / ' + progress.total + '</span></div>' +
        '<div class="progress"><div class="progress-bar" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="prompt-card">' +
        '<p class="prompt-ja">' + escapeHtml(question.promptJa) + '</p>' +
        (question.contextJa ? '<p class="prompt-context">場面：' + escapeHtml(question.contextJa) + '</p>' : '') +
      '</div>' +
      micNote +
      '<div class="answer-area" id="answer-area"></div>' +
      '<div class="mic-zone">' +
        '<button type="button" id="btn-mic" class="mic-btn" aria-label="話す">🎤</button>' +
        '<p class="mic-state" id="mic-state">ボタンを押して、英語で話してください。</p>' +
      '</div>' +
      '<div class="row-btns">' +
        '<button type="button" id="btn-hint" class="btn sub">ヒント</button>' +
        '<button type="button" id="btn-skip" class="btn sub">スキップ</button>' +
      '</div>' +
      '<div class="hint-area" id="hint-area"></div>' +
      '<div class="text-input-zone">' +
        '<button type="button" id="btn-text-toggle" class="btn linklike">テキストで入力する</button>' +
        '<div id="text-input-box" class="hidden">' +
          '<textarea id="text-answer" rows="2" placeholder="英語で入力してください" autocomplete="off"></textarea>' +
          '<button type="button" id="btn-text-submit" class="btn primary">この内容で回答する</button>' +
        '</div>' +
      '</div>' +
      '<div class="nav-row"><button type="button" id="btn-quit" class="btn sub">ホームに戻る</button></div>';
  }

  function resultHtml(question, answerText, status, opts) {
    var head = '';
    if (status === 'accepted') {
      head = '<div class="verdict ok">🟢 正解！</div><p class="verdict-note">自然な英語です。</p>';
    } else if (status === 'undetermined') {
      head = '<div class="verdict undetermined">模範解答とは異なります</div>' +
        '<p class="verdict-note">あなたの英文も正しい可能性があります。未判定は不正解ではありません。</p>';
    } else {
      head = '<div class="verdict failed">音声を認識できませんでした</div>' +
        '<p class="verdict-note">もう一度お試しください。マイクの許可や周りの音もご確認ください。</p>';
    }
    var model = '';
    if (status !== 'recognition-failed') {
      model =
        '<div class="model-card">' +
          '<div class="model-head"><span>お手本</span>' +
            '<span class="toggle-group">' +
              '<button type="button" class="toggle active" data-model-mode="normal">通常</button>' +
              '<button type="button" class="toggle" data-model-mode="chunk">チャンク</button>' +
            '</span></div>' +
          '<p class="model-normal" id="model-normal">' + escapeHtml(question.primaryAnswer) + '</p>' +
          '<p class="model-chunks hidden" id="model-chunks">' + chunkSpansHtml(question) + '</p>' +
          '<p class="chunk-ja hidden" id="chunk-ja"></p>' +
          (question.explanation ? '<p class="explanation">' + escapeHtml(question.explanation) + '</p>' : '') +
          '<button type="button" id="btn-speak" class="btn sub">🔊 お手本を聞く</button>' +
        '</div>';
    }
    var actions = '';
    if (status === 'recognition-failed') {
      actions =
        '<div class="row-btns">' +
          '<button type="button" id="btn-retry" class="btn primary">もう一度話す</button>' +
          '<button type="button" id="btn-use-text" class="btn sub">テキスト入力</button>' +
        '</div>';
    } else {
      actions =
        '<div class="row-btns">' +
          '<button type="button" id="btn-retry" class="btn sub">もう一度話す</button>' +
          '<button type="button" id="btn-next" class="btn primary">次の問題へ</button>' +
        '</div>' +
        (opts.isLast ? '<p class="note">これが最後の問題です。「次の問題へ」で結果が表示されます。</p>' : '');
      if (status === 'undetermined') {
        actions += '<p class="note">AIへの相談と、自分の回答を正解として登録する機能は Phase 3 で実装予定です。</p>';
      }
    }
    return '' +
      '<div class="practice-head">' +
        '<div class="practice-title">回答確認</div>' +
        '<div class="practice-meta"><span>' + escapeHtml(opts.progressLabel) + '</span></div>' +
        '<div class="progress"><div class="progress-bar" style="width:' + opts.progressPct + '%"></div></div>' +
      '</div>' +
      '<div class="answer-card">' +
        '<p class="answer-label">あなたの回答</p>' +
        '<p class="answer-text">' + (answerText ? escapeHtml(answerText) : '（音声が取れませんでした）') + '</p>' +
        head +
      '</div>' +
      model +
      actions +
      '<div class="nav-row"><button type="button" id="btn-quit" class="btn sub">ホームに戻る</button></div>';
  }

  global.RSScreens = { escapeHtml: escapeHtml, show: show, questionHtml: questionHtml, resultHtml: resultHtml };
})(window);

/* ===== app.js: 初期化と状態管理 ===== */
/* app.js - アプリ全体の初期化と状態管理（仕様書15.2）
   学習サイクル: 出題 → 発話 → 認識結果確認 → 判定 → お手本確認 → 必要なら再発話 → 次の問題 */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var state = {
    questions: [],
    session: null,
    settings: null,
    extraAccepted: {},
    attemptNumber: 0,
    hintLevel: 0,
    promptShownAt: 0,
    answerStartedAt: 0,
    recognitionStatus: 'success',
    lastAnswer: '',
    autoNextTimer: null
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.RSScreens.escapeHtml(s); }

  function isoNow() {
    var d = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var offsetMin = -d.getTimezoneOffset();
    var sign = offsetMin >= 0 ? '+' : '-';
    var abs = Math.abs(offsetMin);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }

  function currentQuestion() {
    return state.session ? window.RSLearning.current(state.session) : null;
  }

  /* ---------- 学習の進行 ---------- */

  function startSession() {
    var count = Math.min(state.settings.questionCount || 10, state.questions.length);
    state.session = window.RSLearning.buildSession(state.questions, count);
    window.RSScreens.show('practice');
    showQuestion();
  }

  function showQuestion() {
    var q = currentQuestion();
    if (!q) { showSummary(); return; }
    state.attemptNumber = (state.session.attempts[q.id] || 0) + 1;
    state.hintLevel = 0;
    state.lastAnswer = '';
    state.promptShownAt = Date.now();
    state.answerStartedAt = 0;
    var total = state.session.questions.length;
    $('practice-main').innerHTML = window.RSScreens.questionHtml(q, {
      current: state.session.index + 1, total: total
    }, { recognitionSupported: window.RSSpeech.isRecognitionSupported() });
    wireQuestion(q);
    if (!window.RSSpeech.isRecognitionSupported()) {
      $('text-input-box').classList.remove('hidden');
      var ta = $('text-answer'); if (ta) ta.focus();
    }
  }

  function wireQuestion(q) {
    $('btn-mic').addEventListener('click', function () { startSpeaking(q); });
    $('btn-skip').addEventListener('click', function () { goNext(); });
    $('btn-quit').addEventListener('click', function () { quitToHome(); });
    $('btn-hint').addEventListener('click', function () { showHint(q); });
    $('btn-text-toggle').addEventListener('click', function () {
      $('text-input-box').classList.toggle('hidden');
      var ta = $('text-answer'); if (ta) ta.focus();
    });
    $('btn-text-submit').addEventListener('click', function () {
      var text = $('text-answer').value.trim();
      if (!text) return;
      if (!state.answerStartedAt) state.answerStartedAt = Date.now();
      submitAnswer(q, text, 'text');
    });
  }

  function setMicState(text, listening) {
    var label = $('mic-state');
    if (label) label.textContent = text;
    var btn = $('btn-mic');
    if (btn) btn.classList.toggle('listening', !!listening);
  }

  function startSpeaking(q) {
    if (!window.RSSpeech.isRecognitionSupported()) {
      setMicState('このブラウザは音声認識に対応していません。テキスト入力をご利用ください。', false);
      $('text-input-box').classList.remove('hidden');
      return;
    }
    state.answerStartedAt = Date.now();
    setMicState('聞き取り中です。英語で話してください。', true);
    window.RSSpeech.startRecognition(state.settings.voiceLang, {
      onState: function (s) {
        if (s === 'recognizing') setMicState('聞き取り中です。英語で話してください。', true);
      },
      onResult: function (text) {
        setMicState('認識しました。', false);
        submitAnswer(q, text, 'success');
      },
      onFailure: function () {
        setMicState('音声を認識できませんでした。', false);
        submitRecognitionFailure(q);
      }
    });
  }

  function submitAnswer(q, text, recognitionStatus) {
    state.lastAnswer = text;
    state.recognitionStatus = recognitionStatus;
    var status = window.RSEvaluator.evaluate(text, q, state.extraAccepted[q.id]);
    recordHistory(q, text, recognitionStatus, status);
    window.RSLearning.recordAttempt(state.session, q.id, status, state.attemptNumber);
    showResult(q, text, status);
  }

  function submitRecognitionFailure(q) {
    recordHistory(q, '', 'failed', 'recognition-failed');
    showResult(q, '', 'recognition-failed');
  }

  function recordHistory(q, text, recognitionStatus, evaluationStatus) {
    var entry = {
      questionId: q.id,
      answeredAt: isoNow(),
      answerText: text,
      recognitionStatus: recognitionStatus,
      evaluationStatus: evaluationStatus,
      hintLevel: state.hintLevel,
      attemptNumber: state.attemptNumber,
      responseStartMs: state.answerStartedAt && state.promptShownAt ? state.answerStartedAt - state.promptShownAt : null,
      responseDurationMs: null
    };
    window.RSStorage.saveHistory(entry);
  }

  function showHint(q) {
    if (state.hintLevel >= 3) return;
    state.hintLevel++;
    var area = $('hint-area');
    var html = '';
    if (state.hintLevel >= 1) html += '<p class="hint-line"><span class="hint-tag">ヒント1</span>' + esc(q.hints.structure) + '</p>';
    if (state.hintLevel >= 2) html += '<p class="hint-line"><span class="hint-tag">ヒント2</span>' + esc(q.hints.pattern) + '</p>';
    if (state.hintLevel >= 3) html += '<p class="hint-line"><span class="hint-tag">ヒント3</span>' + esc(q.hints.full) + '</p>';
    area.innerHTML = html;
    if (state.hintLevel >= 3) $('btn-hint').disabled = true;
  }

  /* ---------- 回答確認 ---------- */

  function showResult(q, answerText, status) {
    var total = state.session.questions.length;
    var isLast = state.session.index >= total - 1;
    $('practice-main').innerHTML = window.RSScreens.resultHtml(q, answerText, status, {
      isLast: isLast,
      progressLabel: (state.session.index + 1) + ' / ' + total,
      progressPct: Math.round((state.session.index + 1) / total * 100)
    });
    wireResult(q, status);
    if (status === 'accepted' && state.settings.modelPlayback === 'auto') {
      window.RSSpeech.speak(q.primaryAnswer, state.settings.voiceLang);
    }
    if (status === 'accepted' && state.settings.afterCorrect === 'auto') {
      state.autoNextTimer = setTimeout(function () { goNext(); }, 1600);
    }
  }

  function wireResult(q, status) {
    var quit = $('btn-quit');
    if (quit) quit.addEventListener('click', quitToHome);
    var retry = $('btn-retry');
    if (retry) retry.addEventListener('click', function () {
      if (state.autoNextTimer) clearTimeout(state.autoNextTimer);
      showQuestion();
    });
    var next = $('btn-next');
    if (next) next.addEventListener('click', function () { goNext(); });
    var useText = $('btn-use-text');
    if (useText) useText.addEventListener('click', function () {
      showQuestion();
      setTimeout(function () {
        var box = $('text-input-box');
        if (box) box.classList.remove('hidden');
      }, 0);
    });
    var speak = $('btn-speak');
    if (speak) speak.addEventListener('click', function () {
      window.RSSpeech.speak(q.primaryAnswer, state.settings.voiceLang);
    });
    var toggles = document.querySelectorAll('[data-model-mode]');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].addEventListener('click', function (ev) {
        var mode = ev.currentTarget.getAttribute('data-model-mode');
        for (var j = 0; j < toggles.length; j++) {
          toggles[j].classList.toggle('active', toggles[j] === ev.currentTarget);
        }
        $('model-normal').classList.toggle('hidden', mode !== 'normal');
        $('model-chunks').classList.toggle('hidden', mode !== 'chunk');
        if (mode === 'normal') $('chunk-ja').classList.add('hidden');
      });
    }
    var chunks = document.querySelectorAll('.chunk');
    for (var k = 0; k < chunks.length; k++) {
      chunks[k].addEventListener('click', function (ev) {
        var idx = Number(ev.currentTarget.getAttribute('data-chunk-index'));
        var c = q.chunks[idx];
        if (!c) return;
        var ja = $('chunk-ja');
        ja.textContent = c.en + ' → ' + c.ja;
        ja.classList.remove('hidden');
        window.RSSpeech.speak(c.en.replace(/[.?]$/, ''), state.settings.voiceLang);
      });
    }
  }

  function goNext() {
    if (state.autoNextTimer) clearTimeout(state.autoNextTimer);
    var nxt = window.RSLearning.next(state.session);
    if (!nxt) showSummary();
    else showQuestion();
  }

  function quitToHome() {
    if (state.autoNextTimer) clearTimeout(state.autoNextTimer);
    window.RSSpeech.stopRecognition();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    window.RSScreens.show('home');
  }

  /* ---------- セット結果 ---------- */

  function showSummary() {
    var s = window.RSLearning.summarize(state.session);
    $('summary-body').innerHTML =
      '<p class="summary-total">' + s.total + '問が終わりました。お疲れさまでした。</p>' +
      '<ul class="summary-list">' +
      '<li>正解（初回の回答）: <strong>' + s.accepted + '問</strong></li>' +
      '<li>未判定（初回の回答）: <strong>' + s.undetermined + '問</strong></li>' +
      (s.skipped ? '<li>スキップ: <strong>' + s.skipped + '問</strong></li>' : '') +
      '</ul>' +
      '<p class="note">未判定は不正解ではありません。お手本と比べて、自分の英文も正しいかは Phase 3 の AI相談で確認できるようになります。</p>';
    window.RSScreens.show('summary');
  }

  /* ---------- 学習記録 ---------- */

  function showRecords() {
    window.RSScreens.show('records');
    $('records-body').innerHTML = '<p class="note">読み込み中です。</p>';
    window.RSStorage.loadHistory().then(function (list) {
      if (!list.length) {
        $('records-body').innerHTML = '<p class="note">まだ記録がありません。学習をはじめて回答すると、ここに残ります。</p>';
        return;
      }
      var recent = list.slice(-20).reverse();
      var html = '<p class="summary-total">これまでの回答: ' + list.length + '件</p><ul class="records-list">';
      recent.forEach(function (r) {
        var q = window.RSQuestions.byId(r.questionId);
        var mark = r.evaluationStatus === 'accepted' ? '🟢 正解' :
          r.evaluationStatus === 'undetermined' ? '未判定' : '認識失敗';
        html += '<li><div class="record-head"><span>' + esc(r.answeredAt.slice(0, 10)) + '</span><span>' + mark + '</span></div>' +
          '<div class="record-q">' + esc(q ? q.promptJa : r.questionId) + '</div>' +
          (r.answerText ? '<div class="record-a">' + esc(r.answerText) + '</div>' : '') +
          '<div class="record-meta">試行 ' + r.attemptNumber + '回目' + (r.hintLevel ? ' / ヒント ' + r.hintLevel : '') + '</div></li>';
      });
      html += '</ul>';
      $('records-body').innerHTML = html;
    });
  }

  /* ---------- 設定 ---------- */

  function fillSettings() {
    var s = state.settings;
    $('set-count').value = String(s.questionCount);
    $('set-level').value = s.level;
    $('set-method').value = s.answerMethod;
    $('set-hint').value = s.hintEnabled ? 'on' : 'off';
    $('set-playback').value = s.modelPlayback;
    $('set-after').value = s.afterCorrect;
    $('set-lang').value = s.voiceLang;
    $('app-version').textContent = 'バージョン ' + VERSION;
  }

  function readSettings() {
    state.settings = {
      questionCount: Number($('set-count').value),
      level: $('set-level').value,
      answerMethod: $('set-method').value,
      hintEnabled: $('set-hint').value === 'on',
      modelPlayback: $('set-playback').value,
      afterCorrect: $('set-after').value,
      voiceLang: $('set-lang').value
    };
    window.RSStorage.saveSettings(state.settings);
  }

  /* ---------- 初期化 ---------- */

  function init() {
    state.settings = window.RSStorage.loadSettings();
    $('home-version').textContent = 'バージョン ' + VERSION;

    $('btn-start').addEventListener('click', startSession);
    $('btn-open-settings').addEventListener('click', function () { fillSettings(); window.RSScreens.show('settings'); });
    $('btn-open-records').addEventListener('click', showRecords);
    $('btn-settings-back').addEventListener('click', function () { window.RSScreens.show('home'); });
    $('btn-records-back').addEventListener('click', function () { window.RSScreens.show('home'); });
    $('btn-summary-home').addEventListener('click', function () { window.RSScreens.show('home'); });
    $('btn-summary-retry').addEventListener('click', startSession);
    var settingIds = ['set-count', 'set-level', 'set-method', 'set-hint', 'set-playback', 'set-after', 'set-lang'];
    settingIds.forEach(function (id) { $(id).addEventListener('change', readSettings); });
    $('btn-reload').addEventListener('click', function () {
      $('reload-result').textContent = '最新版を確認しています。';
      var url = new URL(window.location.href);
      url.searchParams.set('v', VERSION + '-' + Date.now());
      window.location.replace(url.toString());
    });

    window.RSQuestions.loadQuestions()
      .then(function (qs) {
        state.questions = qs;
        $('home-status').textContent = '問題 ' + qs.length + '問の用意ができました。';
        $('btn-start').disabled = false;
      })
      .catch(function () {
        $('home-status').textContent = '問題データを読み込めませんでした。通信状態を確認して、開き直してください。';
      });
    window.RSStorage.loadExtraAccepted().then(function (map) { state.extraAccepted = map || {}; });
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
