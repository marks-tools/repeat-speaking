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
