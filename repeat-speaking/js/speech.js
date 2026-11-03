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
