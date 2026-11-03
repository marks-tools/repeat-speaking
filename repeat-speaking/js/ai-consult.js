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
