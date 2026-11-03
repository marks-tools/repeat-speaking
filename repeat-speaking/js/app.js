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
