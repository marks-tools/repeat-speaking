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
