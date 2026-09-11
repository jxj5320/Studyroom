/*
 * 공부방_율 — 담임방/과목방이 함께 쓰는 공용 코드.
 * 같은 사이트(같은 origin) 안의 모든 페이지가 이 파일을 불러오면
 * localStorage(이 브라우저 안)를 통해 "오늘 어떤 과목을 하기로 했는지",
 * "과목별로 오늘 완료했는지"를 서로 공유할 수 있다.
 * 각 과목방의 세부 대화 기록은 과목마다 자기 localStorage 키에 따로 저장한다
 * (이 파일은 그 안까지는 들여다보지 않는다 — 가벼운 상태 요약만 공유).
 */
window.SB = (function () {
  "use strict";

  var DEFAULT_MODEL = "claude-sonnet-5";

  var LS = {
    today: "sb_today_v1",     // 담임방이 오늘 배정한 과목 목록
    status: "sb_status_v1",   // 과목방들이 쓰는 오늘/과거 완료 상태 요약
    apiKey: "sb_api_key_v1",  // Anthropic API 키 (모든 방이 공유)
    model: "sb_model_v1"
  };

  // 과목 마스터 목록. href는 같은 저장소 안 상대경로 파일명.
  // minutes: 지침 4항 기준 1회 학습시간 [최소, 최대]
  var SUBJECTS = [
    { key: "korean", label: "국어", emoji: "📖", href: "korean.html", minutes: [15, 15] },
    { key: "math", label: "수학", emoji: "➗", href: "math.html", minutes: [15, 20] },
    { key: "social", label: "사회", emoji: "🏛", href: "social.html", minutes: [10, 15] },
    { key: "science", label: "과학", emoji: "🔬", href: "science.html", minutes: [10, 15] },
    { key: "english", label: "영어", emoji: "🔤", href: "english.html", minutes: [15, 15] }
  ];

  var storageOk = true;
  try { localStorage.setItem("sb_probe", "1"); localStorage.removeItem("sb_probe"); } catch (e) { storageOk = false; }

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  // ---------- date helpers (Asia/Seoul) ----------
  function kstDateStr(d) {
    d = d || new Date();
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
  function kstLabel(d) {
    d = d || new Date();
    var wd = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "long" }).format(d);
    var md = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(d);
    return md + " " + wd;
  }
  function addDaysKST(dateStr, n) {
    var p = dateStr.split("-").map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }
  function fmtShortDate(dateStr) {
    var p = dateStr.split("-");
    return p[1] + "." + p[2];
  }

  // ---------- 오늘의 과목 배정 (담임방이 씀, 과목방은 읽기만) ----------
  function getTodayAssignment(date) {
    var all = lsGet(LS.today, {});
    return all[date] || null;
  }
  function setTodayAssignment(date, subjectKeys) {
    var all = lsGet(LS.today, {});
    all[date] = { subjects: subjectKeys, createdAt: Date.now() };
    lsSet(LS.today, all);
  }

  // ---------- 과목별 상태 요약 (과목방이 씀, 담임방이 읽음) ----------
  // status: "in_progress" | "done" | "paused"
  function getStatusForDate(date) {
    var all = lsGet(LS.status, {});
    return all[date] || {};
  }
  function setSubjectStatus(date, subjectKey, patch) {
    var all = lsGet(LS.status, {});
    var day = all[date] || {};
    var cur = day[subjectKey] || {};
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k];
    cur.updatedAt = Date.now();
    day[subjectKey] = cur;
    all[date] = day;
    lsSet(LS.status, all);
  }
  function getRecentStatusDates(n) {
    var all = lsGet(LS.status, {});
    return Object.keys(all).sort().reverse().slice(0, n).map(function (d) {
      return { date: d, subjects: all[d] || {} };
    });
  }

  // ---------- API 키 (모든 방이 공유) ----------
  function getApiKey() { return lsGet(LS.apiKey, "") || ""; }
  function setApiKey(v) { lsSet(LS.apiKey, v || ""); }
  function getModel() { return lsGet(LS.model, "") || ""; }
  function setModel(v) { lsSet(LS.model, v || ""); }

  // 과목방이 예전에 자기 이름으로 따로 저장해뒀던 키가 있으면(예: 사회방의 sr_api_key_v1)
  // 공용 키가 아직 비어있을 때 한 번만 끌어와 준다. 사용자가 키를 다시 입력할 필요 없게 하기 위함.
  function migrateLegacyKey(oldKeyName, oldModelName) {
    if (!getApiKey()) {
      var legacy = lsGet(oldKeyName, "");
      if (legacy) setApiKey(legacy);
    }
    if (oldModelName && !getModel()) {
      var legacyModel = lsGet(oldModelName, "");
      if (legacyModel) setModel(legacyModel);
    }
  }

  // ---------- Anthropic API (브라우저에서 직접, 사용자 본인 키) ----------
  function apiError(code, extra) {
    var e = new Error(code);
    e.code = code;
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  async function callClaude(messages, opts) {
    opts = opts || {};
    var apiKey = getApiKey();
    if (!apiKey) throw apiError("no_api_key");
    var body = {
      model: (getModel() && getModel().trim()) || DEFAULT_MODEL,
      max_tokens: opts.maxTokens || 700,
      messages: messages
    };
    var res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify(body),
        signal: opts.signal
      });
    } catch (err) {
      if (err && err.name === "AbortError") throw apiError("cancelled");
      throw apiError("network_error");
    }
    if (!res.ok) {
      var code = res.status === 401 ? "invalid_api_key" : res.status === 429 ? "rate_limited" : "upstream_error";
      var message = code;
      try { var j = await res.json(); if (j && j.error && j.error.message) message = j.error.message; } catch (e2) {}
      throw apiError(code, { status: res.status, message: message });
    }
    var data = await res.json();
    var text = (data.content || [])
      .filter(function (b) { return b && b.type === "text"; })
      .map(function (b) { return b.text; })
      .join("");
    if (!text || !text.trim()) throw apiError("empty_completion");
    return text;
  }

  async function callClaudeJson(messages, opts) {
    var text = await callClaude(messages, opts);
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) throw apiError("invalid_json", { text: text });
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch (e) {
      throw apiError("invalid_json", { text: text });
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  return {
    DEFAULT_MODEL: DEFAULT_MODEL, LS: LS, SUBJECTS: SUBJECTS, storageOk: storageOk,
    lsGet: lsGet, lsSet: lsSet,
    kstDateStr: kstDateStr, kstLabel: kstLabel, addDaysKST: addDaysKST, fmtShortDate: fmtShortDate,
    getTodayAssignment: getTodayAssignment, setTodayAssignment: setTodayAssignment,
    getStatusForDate: getStatusForDate, setSubjectStatus: setSubjectStatus, getRecentStatusDates: getRecentStatusDates,
    getApiKey: getApiKey, setApiKey: setApiKey, getModel: getModel, setModel: setModel, migrateLegacyKey: migrateLegacyKey,
    callClaude: callClaude, callClaudeJson: callClaudeJson, apiError: apiError, escapeHtml: escapeHtml
  };
})();
