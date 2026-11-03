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
