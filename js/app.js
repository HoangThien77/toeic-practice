/* TOEIC Practice App */
(function () {
  const D = window.TOEIC_DATA;
  const $ = (sel) => document.querySelector(sel);
  const screen = $("#screen");
  const audioEl = $("#audio-el");

  const state = {
    view: "home",
    testId: null,
    mode: null,          // "exam" | "practice"
    answers: {},         // qnum -> letter
    revealed: {},        // qnum -> true (practice: checked)
    startedAt: null,
    timerSec: null,      // remaining seconds (reading exam)
    timerInt: null,
    segEnd: null,        // stop audio at this time
    finished: false,
    result: null,
    keyOnly: false,      // viewing the answer key without user answers
    rate: 1,             // playback speed (0.5/0.75/1) — practice & review only
    loop: false,         // auto-replay the current segment
    lastSeg: null,       // {start,end} of the segment last played
    outcomeLogged: {},   // source question id -> true during the current run
    similarDrill: null,  // generated practice from wrong answers
    similarAnswers: {},
  };

  /* ---------------- storage ---------------- */
  const LS_KEY = "toeic-practice-history-v1";
  const WRONG_LS = "toeic-wrong-bank-v1";
  const WRONG_IMPORT_LS = "toeic-wrong-history-imported-v1";
  const WRONG_MASTER_STREAK = 3;
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
  }
  function saveAttempt(a) {
    const h = loadHistory(); h.unshift(a);
    localStorage.setItem(LS_KEY, JSON.stringify(h.slice(0, 50)));
  }
  function loadWrongBank() {
    try { return JSON.parse(localStorage.getItem(WRONG_LS)) || []; } catch { return []; }
  }
  function saveWrongBank(list) {
    localStorage.setItem(WRONG_LS, JSON.stringify(list.slice(0, 500)));
  }
  function loadImportedHistory() {
    try { return JSON.parse(localStorage.getItem(WRONG_IMPORT_LS)) || []; } catch { return []; }
  }
  function saveImportedHistory(ids) {
    localStorage.setItem(WRONG_IMPORT_LS, JSON.stringify([...new Set(ids)].slice(-500)));
  }
  function markHistoryImported(date) {
    const ids = loadImportedHistory();
    ids.push(String(date));
    saveImportedHistory(ids);
  }

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    const m = Math.floor(s / 60), ss = s % 60;
    return m + ":" + String(ss).padStart(2, "0");
  }
  function test() { return state.session || D.tests[state.testId]; }
  function qLabel(q) { return q && q.originalN ? q.originalN : q.n; }

  const ERROR_PROFILES = {
    listen_photo: { label: "Part 1 · Mô tả tranh", short: "Mô tả tranh", advice: "Tập bắt danh từ chính, hành động đang diễn ra và bẫy trạng thái bị động trong ảnh." },
    listen_response: { label: "Part 2 · Hỏi đáp ngắn", short: "Hỏi đáp ngắn", advice: "Tập nghe từ hỏi, thì của câu hỏi và tránh chọn đáp án lặp lại từ nhưng sai ý." },
    listen_graphic: { label: "Part 3-4 · Câu có biểu đồ", short: "Nghe + biểu đồ", advice: "Nghe thông tin rồi đối chiếu ngay với bảng/biểu đồ, không chỉ dựa vào chữ trong đáp án." },
    listen_detail: { label: "Part 3-4 · Chi tiết", short: "Nghe chi tiết", advice: "Tập bắt tên riêng, thời gian, địa điểm, hành động tiếp theo và con số." },
    listen_inference: { label: "Part 3-4 · Suy luận", short: "Nghe suy luận", advice: "Tập nối ý giữa nhiều câu thoại, nhất là câu hỏi implied/most likely/mean." },
    read_grammar: { label: "Part 5-6 · Ngữ pháp/từ loại", short: "Ngữ pháp", advice: "Ôn cấu trúc câu quanh chỗ trống: dạng động từ, từ loại, liên từ, giới từ và mệnh đề." },
    read_vocab: { label: "Reading · Từ vựng/ngữ nghĩa", short: "Từ vựng", advice: "Ghi lại collocation và nghĩa trong ngữ cảnh, đừng chỉ học nghĩa đơn lẻ của từ." },
    read_sentence: { label: "Part 6-7 · Chèn câu/liên kết ý", short: "Liên kết ý", advice: "Đọc câu trước-sau vị trí trống để bắt đại từ, mốc thời gian và quan hệ nguyên nhân-kết quả." },
    read_detail: { label: "Part 7 · Chi tiết", short: "Đọc chi tiết", advice: "Tập scan từ khóa rồi đối chiếu paraphrase, đặc biệt câu NOT/indicated/according to." },
    read_inference: { label: "Part 7 · Suy luận", short: "Đọc suy luận", advice: "Tìm bằng chứng gián tiếp trong bài, tránh chọn đáp án đúng ngoài đời nhưng không được bài hỗ trợ." },
    read_purpose: { label: "Part 7 · Mục đích/ý chính", short: "Mục đích", advice: "Xác định loại văn bản, người gửi-người nhận và lý do đoạn văn được viết." },
    read_reference: { label: "Part 7 · Từ/cụm từ trong ngữ cảnh", short: "Từ trong ngữ cảnh", advice: "Thay đáp án vào câu gốc và kiểm tra sắc thái nghĩa thay vì chọn nghĩa quen thuộc nhất." },
  };

  function profileFallback(part) {
    if (part === 1) return "listen_photo";
    if (part === 2) return "listen_response";
    if (part <= 4) return "listen_detail";
    if (part === 5 || part === 6) return "read_grammar";
    return "read_detail";
  }

  function choiceValues(q) {
    return Object.keys(q.choices || q.spoken && q.spoken.choices || {}).map((L) => choiceText(q, L)).filter(Boolean);
  }

  function looksGrammarChoices(vals) {
    const txt = vals.map(normText).join(" | ");
    if (/\b(to [a-z]+|being [a-z]+|been [a-z]+|has|have|had|will|would|should|could|may|might)\b/.test(txt)) return true;
    if (/\b(is|are|was|were|be|being|been)\b/.test(txt)) return true;
    if (/\b(in|on|at|by|for|with|of|to|from|through|during|while|although|because|if|unless|despite)\b/.test(txt) && vals.every((v) => v.split(/\s+/).length <= 3)) return true;
    const endings = vals.map((v) => normText(v).split(" ").pop() || "");
    const suffixHits = endings.filter((w) => /(ly|tion|sion|ment|ness|ity|ive|al|ous|ing|ed|er|est|ize|ise)$/.test(w)).length;
    return suffixHits >= 2 && vals.every((v) => v.split(/\s+/).length <= 4);
  }

  function classifyQuestionRef(ref) {
    if (!ref) return ERROR_PROFILES.listen_detail;
    const q = ref.q || {};
    const part = ref.p ? ref.p.part : ref.part;
    const question = normText(q.question || "");
    const choices = choiceValues(q);
    const hay = normText([q.question, q.explanation, choices.join(" ")].join(" "));
    let id = profileFallback(part);
    if (part === 1) id = "listen_photo";
    else if (part === 2) id = "listen_response";
    else if (part === 3 || part === 4) {
      if (ref.item && ref.item.graphicImg) id = "listen_graphic";
      else if (/\b(imply|implied|infer|suggest|mean|probably|most likely|will .* next|offer to do|purpose of the call|why is|why does)\b/.test(question)) id = "listen_inference";
      else id = "listen_detail";
    } else if (part === 5) {
      id = looksGrammarChoices(choices) || /___|blank|complete/.test(question) ? "read_grammar" : "read_vocab";
    } else if (part === 6) {
      if (choices.some((v) => /[.!?]$/.test(v.trim()) || v.length > 55) || /sentence|position|best belong/.test(hay)) id = "read_sentence";
      else id = looksGrammarChoices(choices) ? "read_grammar" : "read_vocab";
    } else if (part === 7) {
      if (/\b(purpose|main purpose|why was|why did .* write|intended for)\b/.test(question)) id = "read_purpose";
      else if (/\b(closest in meaning|word|phrase|refer to)\b/.test(question)) id = "read_reference";
      else if (/\b(implied|inferred|suggested|most likely|probably|indicate about .*?\?)\b/.test(question)) id = "read_inference";
      else id = "read_detail";
    }
    return ERROR_PROFILES[id] || ERROR_PROFILES[profileFallback(part)];
  }

  function profileIdForRef(ref) {
    const profile = classifyQuestionRef(ref);
    return Object.keys(ERROR_PROFILES).find((id) => ERROR_PROFILES[id] === profile) || profileFallback(ref && ref.p ? ref.p.part : ref && ref.part);
  }

  function profileForEntry(entry, ref) {
    const src = ref || findSourceQuestion(entry.testId, entry.qn);
    const id = src ? profileIdForRef(src) : profileFallback(entry.part || 7);
    return { id, ...(ERROR_PROFILES[id] || ERROR_PROFILES.read_detail) };
  }

  /* ---------------- TOEIC score conversion (bảng quy đổi chuẩn, xấp xỉ ETS) ---------------- */
  const LISTENING_TABLE = [[0, 5], [5, 20], [10, 45], [15, 75], [20, 105], [25, 130], [30, 160], [35, 185], [40, 215], [45, 240], [50, 270], [55, 295], [60, 320], [65, 345], [70, 370], [75, 395], [80, 420], [85, 445], [90, 470], [95, 490], [100, 495]];
  const READING_TABLE = [[0, 5], [5, 5], [10, 15], [15, 30], [20, 50], [25, 75], [30, 100], [35, 125], [40, 155], [45, 180], [50, 210], [55, 235], [60, 265], [65, 290], [70, 320], [75, 350], [80, 375], [85, 405], [90, 435], [95, 465], [100, 495]];

  function toScaled(raw100, table) {
    const r = Math.max(0, Math.min(100, raw100));
    for (let i = 1; i < table.length; i++) {
      if (r <= table[i][0]) {
        const [r0, s0] = table[i - 1], [r1, s1] = table[i];
        const s = s0 + ((r - r0) / (r1 - r0)) * (s1 - s0);
        return Math.max(5, Math.min(495, Math.round(s / 5) * 5));
      }
    }
    return 495;
  }

  function computeSections(t) {
    const sec = { listening: { c: 0, t: 0 }, reading: { c: 0, t: 0 } };
    allQuestions(t).forEach(({ q, part }) => {
      const s = part <= 4 ? sec.listening : sec.reading;
      s.t++;
      if (state.answers[q.n] === q.answer) s.c++;
    });
    if (sec.listening.t) sec.listening.scaled = toScaled((sec.listening.c / sec.listening.t) * 100, LISTENING_TABLE);
    if (sec.reading.t) sec.reading.scaled = toScaled((sec.reading.c / sec.reading.t) * 100, READING_TABLE);
    return sec;
  }
  function allQuestions(t) {
    const out = [];
    t.parts.forEach((p) => {
      const sourceTestId = p.sourceTestId || (t && t.id !== "session" ? t.id : null);
      const sourceTitle = p.sourceTitle || (sourceTestId && D.tests[sourceTestId] ? D.tests[sourceTestId].title : t.title);
      p.items.forEach((it) => {
        if (it.questions) it.questions.forEach((q) => out.push({ q, part: p.part, item: it, sourceTestId, sourceTitle }));
        else out.push({ q: it, part: p.part, item: it, sourceTestId, sourceTitle });
      });
    });
    return out;
  }

  function wrongKey(testId, qn) { return `${testId}:${qn}`; }

  function findSourceQuestion(testId, qn) {
    const src = D.tests[testId];
    const n = Number(qn);
    if (!src) return null;
    for (const p of src.parts) {
      for (const it of p.items) {
        const qlist = it.questions || [it];
        for (const q of qlist) {
          if (q.n === n) return { test: src, p, item: it, q };
        }
      }
    }
    return null;
  }

  function questionSource(f) {
    if (!f) return null;
    const t = test();
    const testId = f.p.sourceTestId || f.q.sourceTestId || (t && t.id !== "session" ? t.id : null);
    if (!testId) return null;
    const qn = qLabel(f.q);
    const source = findSourceQuestion(testId, qn);
    return {
      id: wrongKey(testId, qn), testId, qn,
      testTitle: (source && source.test.title) || f.p.sourceTitle || (D.tests[testId] && D.tests[testId].title) || t.title,
      kind: (source && source.test.kind) || t.kind,
      part: f.p.part,
      q: (source && source.q) || f.q,
      item: (source && source.item) || f.item,
    };
  }

  function wrongPreview(src) {
    const q = src.q;
    return q.question || (src.part <= 2 ? "Nghe audio và chọn đáp án" : "Xem câu hỏi trong ảnh đề");
  }

  function applyWrongOutcome(list, src, user, isCorrect, when) {
    const idx = list.findIndex((x) => x.id === src.id);
    if (isCorrect) {
      if (idx >= 0) {
        const entry = list[idx];
        const streak = (entry.correctStreak || 0) + 1;
        list[idx] = {
          ...entry,
          attemptCount: (entry.attemptCount || 0) + 1,
          correctCount: (entry.correctCount || 0) + 1,
          correctStreak: streak,
          lastUser: user,
          lastCorrectAt: when,
          mastered: streak >= WRONG_MASTER_STREAK,
          dueAt: streak >= WRONG_MASTER_STREAK ? null : when + (streak === 1 ? 86400000 : 3 * 86400000),
        };
      }
      return list;
    }
    const base = idx >= 0 ? list[idx] : {
      id: src.id,
      firstWrongAt: when,
      wrongCount: 0,
      correctCount: 0,
      attemptCount: 0,
    };
    const q = src.q;
    const next = {
      ...base,
      testId: src.testId,
      testTitle: src.testTitle,
      kind: src.kind,
      part: src.part,
      qn: src.qn,
      question: wrongPreview(src),
      answer: q.answer,
      choices: q.choices || {},
      explanation: q.explanation || "",
      wrongCount: (base.wrongCount || 0) + 1,
      attemptCount: (base.attemptCount || 0) + 1,
      correctStreak: 0,
      mastered: false,
      lastUser: user,
      lastWrongAt: when,
      dueAt: when,
    };
    if (idx >= 0) list[idx] = next; else list.push(next);
    return list;
  }

  function recordQuestionOutcome(qn) {
    const f = findQ(qn);
    const src = questionSource(f);
    if (!f || !src || state.keyOnly || state.outcomeLogged[src.id]) return;
    const user = state.answers[qn] || null;
    const list = applyWrongOutcome(loadWrongBank(), src, user, user === f.q.answer, Date.now());
    saveWrongBank(sortWrongBank(list));
    state.outcomeLogged[src.id] = true;
  }

  function sourceFromQuestionRef(ref) {
    if (!ref || !ref.sourceTestId) return null;
    const source = findSourceQuestion(ref.sourceTestId, qLabel(ref.q));
    const srcTest = source && source.test ? source.test : D.tests[ref.sourceTestId];
    return {
      id: wrongKey(ref.sourceTestId, qLabel(ref.q)),
      testId: ref.sourceTestId,
      qn: qLabel(ref.q),
      testTitle: (srcTest && srcTest.title) || ref.sourceTitle,
      kind: (srcTest && srcTest.kind) || (ref.part <= 4 ? "listening" : "reading"),
      part: ref.part,
      q: (source && source.q) || ref.q,
      item: (source && source.item) || ref.item,
    };
  }

  function importWrongFromHistory() {
    const imported = new Set(loadImportedHistory().map(String));
    const pending = loadHistory()
      .filter((h) => h && h.answers && !imported.has(String(h.date)) && !(h.session && h.session.wrong))
      .sort((a, b) => (a.date || 0) - (b.date || 0));
    if (!pending.length) return 0;
    let list = loadWrongBank();
    let added = 0;
    pending.forEach((h) => {
      let t = null;
      try { t = h.session ? buildSession(h.session) : D.tests[h.testId]; } catch { t = null; }
      if (t && t.parts) {
        allQuestions(t).forEach((ref) => {
          const src = sourceFromQuestionRef(ref);
          if (!src) return;
          const user = h.answers[ref.q.n] || null;
          if (user === ref.q.answer) return;
          list = applyWrongOutcome(list, src, user, false, h.date || Date.now());
          added++;
        });
      }
      imported.add(String(h.date));
    });
    if (added) saveWrongBank(sortWrongBank(list));
    saveImportedHistory([...imported]);
    return added;
  }

  function sortWrongBank(list) {
    return [...list].sort((a, b) => {
      if (!!a.mastered !== !!b.mastered) return a.mastered ? 1 : -1;
      if ((b.wrongCount || 0) !== (a.wrongCount || 0)) return (b.wrongCount || 0) - (a.wrongCount || 0);
      return (b.lastWrongAt || b.firstWrongAt || 0) - (a.lastWrongAt || a.firstWrongAt || 0);
    });
  }

  function wrongEntries(filter) {
    const now = Date.now();
    const profileFilter = String(filter || "").startsWith("profile:") ? String(filter).slice(8) : null;
    return loadWrongBank().map((entry) => ({ entry, ref: findSourceQuestion(entry.testId, entry.qn) }))
      .filter(({ entry, ref }) => {
        if (filter === "all") return true;
        if (filter === "mastered") return !!entry.mastered;
        if (profileFilter) return !entry.mastered && profileForEntry(entry, ref).id === profileFilter;
        if (filter === "reading") return !entry.mastered && entry.kind === "reading";
        if (filter === "listening") return !entry.mastered && entry.kind === "listening";
        if (filter === "due") return !entry.mastered && (!entry.dueAt || entry.dueAt <= now);
        return !entry.mastered;
      })
      .sort((a, b) => sortWrongBank([a.entry, b.entry]).findIndex((x) => x.id === a.entry.id) === 0 ? -1 : 1);
  }

  function wrongProfileStats() {
    const rows = loadWrongBank().map((entry) => ({ entry, ref: findSourceQuestion(entry.testId, entry.qn) })).filter(({ entry }) => !entry.mastered);
    const map = {};
    rows.forEach(({ entry, ref }) => {
      const p = profileForEntry(entry, ref);
      if (!map[p.id]) map[p.id] = { ...p, count: 0, wrongs: 0, due: 0, reading: 0, listening: 0, examples: [] };
      const bucket = map[p.id];
      bucket.count++;
      bucket.wrongs += entry.wrongCount || 1;
      if (!entry.dueAt || entry.dueAt <= Date.now()) bucket.due++;
      if (entry.kind === "listening") bucket.listening++; else bucket.reading++;
      if (bucket.examples.length < 3) bucket.examples.push({ entry, ref });
    });
    return Object.values(map).sort((a, b) => (b.wrongs - a.wrongs) || (b.count - a.count));
  }

  function wrongStats() {
    const rows = loadWrongBank();
    const now = Date.now();
    return {
      total: rows.length,
      active: rows.filter((r) => !r.mastered).length,
      due: rows.filter((r) => !r.mastered && (!r.dueAt || r.dueAt <= now)).length,
      mastered: rows.filter((r) => r.mastered).length,
      listening: rows.filter((r) => !r.mastered && r.kind === "listening").length,
      reading: rows.filter((r) => !r.mastered && r.kind === "reading").length,
    };
  }

  function shortDate(ts) {
    return ts ? new Date(ts).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—";
  }

  function choiceText(q, L) {
    const txt = q.choices && q.choices[L] ? q.choices[L] : q.spoken && q.spoken.choices ? q.spoken.choices[L] : "";
    return txt || "(nghe audio)";
  }

  function playWrongAudio(testId, start, end) {
    const src = D.tests[testId];
    if (!src || !src.audioSrc) return;
    if (!decodeURIComponent(audioEl.src || "").endsWith(src.audioSrc)) audioEl.src = src.audioSrc;
    state.segEnd = end || null;
    state.lastSeg = { start, end: end || null };
    audioEl.currentTime = start;
    audioEl.playbackRate = state.rate;
    audioEl.play();
    showDock(true);
  }

  function wrongAudioRef(ref) {
    if (!ref) return null;
    return ref.q.audio || ref.item.audio || null;
  }

  function openWrongDictation(testId, qn) {
    const ref = findSourceQuestion(testId, qn);
    if (!ref) return;
    const audio = wrongAudioRef(ref);
    const dictRef = spokenText(ref.item) || spokenText(ref.q);
    if (!audio || !dictRef) return;
    dictState = { ref: dictRef, audio };
    openModal(`<h3>Chép chính tả — Câu ${qn}</h3>
      <p style="margin-bottom:10px">Nghe lại đoạn chứa câu sai rồi gõ những gì bạn nghe được. Không cần viết hoa hay dấu câu.</p>
      <div style="display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap">
        <button class="btn btn-sm" onclick="App.playWrongAudio('${testId}',${audio.start},${audio.end || "null"})">${ICONS.sound}<span>Nghe đoạn này</span></button>
        <button class="btn btn-sm" onclick="App.cycleSpeed()">Tốc độ chậm/nhanh</button>
        <button class="btn btn-sm" onclick="App.toggleLoop()">Lặp lại</button>
      </div>
      <textarea id="dict-input" class="dict-input" rows="5" placeholder="Gõ những gì bạn nghe được..."></textarea>
      <div id="dict-result"></div>
      <div class="modal-actions">
        <button class="btn" onclick="App.closeModal()">Đóng</button>
        <button class="btn" onclick="App.dictReveal()">Xem transcript</button>
        <button class="btn btn-primary" onclick="App.dictCheck()">Kiểm tra</button>
      </div>`, true);
  }

  function markWrongMastered(testId, qn) {
    const id = wrongKey(testId, qn);
    const list = loadWrongBank();
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return;
    list[idx] = {
      ...list[idx],
      mastered: true,
      correctStreak: Math.max(WRONG_MASTER_STREAK, list[idx].correctStreak || 0),
      dueAt: null,
      lastCorrectAt: Date.now(),
    };
    saveWrongBank(sortWrongBank(list));
    closeModal();
    if (state.view === "wrong") goWrong("active");
  }

  function normText(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
  }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < String(s).length; i++) {
      h ^= String(s).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seededShuffle(arr, seedText) {
    const out = [...arr];
    let seed = hashStr(seedText) || 1;
    for (let i = out.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function cleanOptionText(txt) {
    const s = String(txt || "").trim();
    if (!s || /^\(?nghe audio\)?$/i.test(s)) return "";
    if (/^Chọn [A-D] theo ảnh đề$/i.test(s)) return "";
    return s;
  }

  function optionTextForVariant(q, L) {
    return cleanOptionText(q.choices && q.choices[L]) || cleanOptionText(q.spoken && q.spoken.choices && q.spoken.choices[L]);
  }

  function variantOptions(q, seed) {
    const keys = Object.keys(q.choices || (q.spoken && q.spoken.choices) || {}).filter((L) => optionTextForVariant(q, L));
    const letters = ["A", "B", "C", "D", "E"];
    return seededShuffle(keys, seed).map((orig, i) => ({ letter: letters[i], orig, text: optionTextForVariant(q, orig), correct: orig === q.answer }));
  }

  function stemTokens(q) {
    return new Set(normText([q.question, ...choiceValues(q)].join(" ")).split(" ").filter((w) => w.length >= 4));
  }

  function overlapScore(a, b) {
    let n = 0;
    a.forEach((x) => { if (b.has(x)) n++; });
    return n;
  }

  function similarQuestionRefs(ref, limit) {
    if (!ref) return [];
    const baseOptions = variantOptions(ref.q, "base");
    const baseCorrect = normText(baseOptions.find((o) => o.correct)?.text || choiceText(ref.q, ref.q.answer));
    const baseTokens = stemTokens(ref.q);
    const baseProfile = profileIdForRef(ref);
    const all = [];
    Object.values(D.tests).forEach((t) => {
      allQuestions(t).forEach((candidate) => {
        if (t.id === ref.test.id && Number(qLabel(candidate.q)) === Number(qLabel(ref.q))) return;
        const cRef = { test: t, p: { part: candidate.part }, item: candidate.item, q: candidate.q };
        const cOpts = variantOptions(candidate.q, "candidate");
        if (!cOpts.length) return;
        const cCorrect = normText(cOpts.find((o) => o.correct)?.text || choiceText(candidate.q, candidate.q.answer));
        let score = 0;
        if (profileIdForRef(cRef) === baseProfile) score += 6;
        if (candidate.part === ref.p.part) score += 3;
        if ((candidate.part <= 4) === (ref.p.part <= 4)) score += 1;
        if (baseCorrect && cCorrect && baseCorrect === cCorrect) score += 8;
        score += Math.min(4, overlapScore(baseTokens, stemTokens(candidate.q)));
        if (String(ref.q.question || "").includes("___") && String(candidate.q.question || "").includes("___")) score += 2;
        if (score >= 5) all.push({ score, test: t, p: { part: candidate.part }, item: candidate.item, q: candidate.q });
      });
    });
    return all.sort((a, b) => b.score - a.score).slice(0, limit || 3);
  }

  function makeSimilarExercise(ref, variant, seed, note) {
    const opts = variantOptions(ref.q, seed);
    if (!opts.length) return null;
    const answer = opts.find((o) => o.correct)?.letter;
    if (!answer) return null;
    const audio = wrongAudioRef(ref);
    const isListening = ref.p.part <= 4;
    const fallbackPrompt = isListening ? "Nghe lại đoạn audio rồi chọn đáp án đúng." : "Chọn đáp án đúng nhất.";
    return {
      id: `${ref.test.id}:${ref.q.n}:${variant}:${seed}`,
      testId: ref.test.id,
      testTitle: ref.test.title,
      qn: ref.q.n,
      part: ref.p.part,
      kind: ref.test.kind,
      variant,
      note,
      prompt: ref.q.question || fallbackPrompt,
      options: opts,
      answer,
      explanation: ref.q.explanation || "",
      audio,
      source: ref,
    };
  }

  function makeTranscriptExercise(ref, seed) {
    const spoken = ref.q.spoken && ref.q.spoken.choices ? ref.q.spoken.choices[ref.q.answer] : "";
    if (!spoken) return null;
    const opts = variantOptions(ref.q, seed);
    const answer = opts.find((o) => o.correct)?.letter;
    if (!answer) return null;
    return {
      id: `${ref.test.id}:${ref.q.n}:transcript:${seed}`,
      testId: ref.test.id,
      testTitle: ref.test.title,
      qn: ref.q.n,
      part: ref.p.part,
      kind: ref.test.kind,
      variant: "Nghe + nhận diện câu đúng",
      note: "Biến thể từ audio/transcript của câu sai",
      prompt: "Nghe lại câu này, sau đó chọn câu khớp nhất với nội dung bạn nghe được.",
      options: opts,
      answer,
      explanation: ref.q.explanation || "",
      audio: wrongAudioRef(ref),
      source: ref,
    };
  }

  function buildSimilarExercisesFromRows(rows) {
    const exercises = [];
    rows.filter((x) => x.ref).slice(0, 12).forEach(({ entry, ref }) => {
      const profile = profileForEntry(entry, ref);
      const base = makeSimilarExercise(ref, "Tráo đáp án", `${entry.id}:shuffle:${entry.wrongCount || 0}`, `${profile.short}: cùng câu gốc nhưng đổi vị trí đáp án để tránh học thuộc letter.`);
      if (base) exercises.push(base);
      const focus = makeSimilarExercise(ref, "Nhắc lại lỗi", `${entry.id}:trap:${entry.lastUser || "x"}`, `Bạn từng chọn ${entry.lastUser || "sai"}; chọn lại dựa trên ngữ cảnh, không dựa vào letter cũ.`);
      if (focus) exercises.push(focus);
      const transcript = ref.p.part <= 4 ? makeTranscriptExercise(ref, `${entry.id}:listen`) : null;
      if (transcript) exercises.push(transcript);
      similarQuestionRefs(ref, 2).forEach((sim, i) => {
        const simProfile = ERROR_PROFILES[profileIdForRef(sim)] || profile;
        const ex = makeSimilarExercise(sim, `Câu thật tương tự ${i + 1}`, `${entry.id}:neighbor:${i}`, `${simProfile.short}: câu cùng dạng được lấy từ ${groupCardTitle(sim.test.title)}.`);
        if (ex) exercises.push(ex);
      });
    });
    return exercises.slice(0, 30);
  }

  function rowsForSimilarDrill(testId, filter, qn, profileId) {
    if (profileId) return wrongEntries("profile:" + profileId).filter((x) => x.ref);
    if (qn != null) {
      const entry = loadWrongBank().find((x) => x.id === wrongKey(testId, Number(qn)));
      return entry ? [{ entry, ref: findSourceQuestion(testId, Number(qn)) }] : [];
    }
    return wrongEntries(filter || "active").filter(({ entry, ref }) => entry.testId === testId && ref);
  }

  function buildSimilarExercises(testId, filter, qn, profileId) {
    return buildSimilarExercisesFromRows(rowsForSimilarDrill(testId, filter, qn, profileId));
  }

  function goSimilarDrill(testId, filter, qn) {
    const src = D.tests[testId];
    if (!src) return;
    state.view = "similar";
    state.similarDrill = { testId, filter: filter || "active", qn: qn == null ? null : Number(qn) };
    state.similarAnswers = {};
    stopTimer(); audioEl.pause(); state.segEnd = null; showDock(false);
    document.body.classList.remove("has-mbar");
    screen.classList.remove("wide");
    $("#btn-exit").classList.add("hidden");
    renderSimilarDrill();
    window.scrollTo(0, 0);
  }

  function goProfileDrill(profileId) {
    if (!ERROR_PROFILES[profileId]) return;
    state.view = "similar";
    state.similarDrill = { testId: null, filter: "profile:" + profileId, qn: null, profileId };
    state.similarAnswers = {};
    stopTimer(); audioEl.pause(); state.segEnd = null; showDock(false);
    document.body.classList.remove("has-mbar");
    screen.classList.remove("wide");
    $("#btn-exit").classList.add("hidden");
    renderSimilarDrill();
    window.scrollTo(0, 0);
  }

  function renderSimilarDrill() {
    const cfg = state.similarDrill;
    if (!cfg) return;
    const src = cfg.testId ? D.tests[cfg.testId] : null;
    const profile = cfg.profileId ? ERROR_PROFILES[cfg.profileId] : null;
    const exercises = buildSimilarExercises(cfg.testId, cfg.filter, cfg.qn, cfg.profileId);
    const answered = Object.keys(state.similarAnswers || {}).length;
    const correct = exercises.filter((ex, i) => state.similarAnswers[i] === ex.answer).length;
    const cards = exercises.map((ex, i) => renderSimilarCard(ex, i)).join("");
    const scopeTitle = profile ? profile.label : groupCardTitle(src && src.title);
    const scopeNote = profile ? profile.advice : "Bản này tạo offline từ dữ liệu đề hiện có, không cần API.";
    const backFilter = profile ? "profile:" + cfg.profileId : (cfg.filter || "active");
    const restart = profile
      ? `App.goProfileDrill('${cfg.profileId}')`
      : `App.goSimilarDrill('${cfg.testId}','${cfg.filter || "active"}'${cfg.qn == null ? "" : `,${cfg.qn}`})`;
    screen.innerHTML = `
      <div class="hero"><h1>Biến thể câu sai</h1>
        <p>${esc(scopeTitle)} · ${exercises.length} bài luyện nhỏ từ câu sai. ${esc(scopeNote)}</p>
      </div>
      <div class="similar-head">
        <div class="stat-box"><div class="v">${correct}/${answered}</div><div class="k">đúng / đã làm</div></div>
        <div class="stat-box"><div class="v">${exercises.length}</div><div class="k">bài luyện</div></div>
        <div class="similar-actions">
          <button class="btn" onclick="App.goWrong('${backFilter}')">Về sổ câu sai</button>
          <button class="btn btn-primary" onclick="${restart}">Làm lượt mới</button>
        </div>
      </div>
      ${cards ? `<div class="similar-grid">${cards}</div>` : '<div class="history-empty">Chưa tạo được biến thể cho nhóm này. Hãy làm sai một câu có dữ liệu đáp án/transcript trước.</div>'}
    `;
  }

  function similarContextHtml(ex) {
    const ref = ex.source;
    if (!ref) return "";
    const it = ref.item || {};
    const q = ref.q || {};
    const pieces = [];
    if (it.img || it.text != null) pieces.push(`<div class="sim-context-passage">${renderPassage(it)}</div>`);
    if (it.graphicImg) pieces.push(`<img class="qgraphic sim-context-img" src="${it.graphicImg}" alt="graphic">`);
    if (q.image) pieces.push(`<img class="qphoto sim-context-img" src="${q.image}" alt="Câu ${qLabel(q)}">`);
    if (!pieces.length) return "";
    return `<div class="sim-context">${pieces.join("")}<div class="zoom-hint">Bấm vào ảnh để phóng to</div></div>`;
  }

  function renderSimilarCard(ex, idx) {
    const picked = state.similarAnswers[idx];
    const done = !!picked;
    const qLine = `Part ${ex.part} · Câu ${ex.qn} · ${esc(groupCardTitle(ex.testTitle))}`;
    const audioBtn = ex.audio ? `<button class="btn btn-sm" onclick="App.playWrongAudio('${ex.testId}',${ex.audio.start},${ex.audio.end || "null"})">${ICONS.sound}<span>Nghe đoạn</span></button>` : "";
    const context = similarContextHtml(ex);
    const options = ex.options.map((o) => {
      let cls = "sim-choice";
      if (done) {
        if (o.letter === ex.answer) cls += " correct";
        else if (picked === o.letter) cls += " wrong";
        else cls += " dim";
      }
      return `<button type="button" class="${cls}" onclick="App.pickSimilar(${idx},'${o.letter}')"><span class="letter">${o.letter}</span><span>${esc(o.text)}</span></button>`;
    }).join("");
    const result = done ? `<div class="sim-result ${picked === ex.answer ? "ok" : "bad"}">
      <b>${picked === ex.answer ? "Đúng" : `Chưa đúng — đáp án: ${ex.answer}`}</b>${ex.explanation ? `<div>${esc(ex.explanation)}</div>` : ""}
    </div>` : "";
    return `<article class="similar-card">
      <div class="sim-meta"><span>${esc(ex.variant)}</span><small>${qLine}</small></div>
      <div class="sim-note">${esc(ex.note || "")}</div>
      ${context}
      <div class="sim-prompt">${esc(ex.prompt)}</div>
      ${audioBtn ? `<div class="sim-tools">${audioBtn}</div>` : ""}
      <div class="sim-options">${options}</div>
      ${result}
      <div class="sim-foot"><button class="btn btn-sm" onclick="App.startQuestionPractice('${ex.testId}',${ex.qn})">Làm câu gốc</button></div>
    </article>`;
  }

  function pickSimilar(idx, letter) {
    state.similarAnswers[idx] = letter;
    renderSimilarDrill();
  }

  function openWrongDrill(testId, qn) {
    const ref = findSourceQuestion(testId, qn);
    const entry = loadWrongBank().find((x) => x.id === wrongKey(testId, qn));
    if (!ref || !entry) return;
    const { test, p, item, q } = ref;
    const letters = Object.keys(q.choices || q.spoken && q.spoken.choices || {}).filter((L) => choiceText(q, L));
    const choiceRows = letters.map((L) => `<div class="drill-choice ${L === q.answer ? "correct" : entry.lastUser === L ? "wrong" : ""}">
      <span class="letter">${L}</span><span>${esc(choiceText(q, L))}</span>
    </div>`).join("");
    const audio = wrongAudioRef(ref);
    const transcript = spokenText(item) || spokenText(q);
    const audioTools = audio ? `<div class="drill-tools">
        <button class="btn btn-sm" onclick="App.playWrongAudio('${testId}',${audio.start},${audio.end || "null"})">${ICONS.sound}<span>Nghe lại đoạn lỗi</span></button>
        ${transcript ? `<button class="btn btn-sm" onclick="App.openWrongDictation('${testId}',${qn})">Chép chính tả</button>` : ""}
      </div>` : "";
    const sourceLine = `${esc(groupCardTitle(test.title))} · ${test.kind === "listening" ? "Listening" : "Reading"} · Part ${p.part} · Câu ${qn}`;
    const qLine = q.question || (p.part <= 2 ? "Nghe audio và chọn đáp án" : "Xem câu hỏi và lựa chọn trong ảnh đề");
    const profile = profileForEntry(entry, ref);
    openModal(`<h3>Drill lỗi — Câu ${qn}</h3>
      <div class="drill-modal">
        <div class="drill-source">${sourceLine}</div>
        <div class="drill-card">
          <b>1. Làm lại câu gốc</b>
          <p>Vào chế độ luyện đúng câu này, chọn lại đáp án rồi bấm kiểm tra. Nếu đúng liên tiếp ${WRONG_MASTER_STREAK} lần, câu sẽ tự rời sổ câu sai.</p>
          <div class="drill-tools">
            <button class="btn btn-primary" onclick="App.closeModal(); App.startWrongReview('${testId}','all',${qn})">Làm lại câu này</button>
            <button class="btn" onclick="App.closeModal(); App.goSimilarDrill('${testId}','all',${qn})">Tạo biến thể</button>
          </div>
        </div>
        <div class="drill-card">
          <b>2. Lỗi cần nhớ</b>
          <div class="wrong-profile-callout"><span>${esc(profile.label)}</span><p>${esc(profile.advice)}</p></div>
          <div class="drill-question">${esc(qLine)}</div>
          <div class="drill-choices">${choiceRows}</div>
          <div class="drill-note">${q.explanation ? esc(q.explanation) : "Chưa có giải thích riêng cho câu này."}</div>
          <button class="btn btn-sm" onclick="App.closeModal(); App.goProfileDrill('${profile.id}')">Luyện cả dạng lỗi này</button>
        </div>
        ${audioTools ? `<div class="drill-card"><b>3. Luyện nghe lại điểm sai</b>${audioTools}${transcript ? `<details class="drill-details"><summary>Xem transcript</summary><pre>${esc(transcript)}</pre></details>` : ""}</div>` : ""}
        <div class="drill-card compact">
          <b>Tiến độ</b>
          <p>Sai ${entry.wrongCount || 0} lần · đúng lại ${entry.correctStreak || 0}/${WRONG_MASTER_STREAK} · lần sai gần nhất ${shortDate(entry.lastWrongAt || entry.firstWrongAt)}.</p>
          <button class="btn" onclick="App.markWrongMastered('${testId}',${qn})">Đánh dấu đã thuộc</button>
        </div>
      </div>`, true);
  }

  /* ---------------- audio ---------------- */
  let dockTicker = null;
  function showDock(show) {
    $("#audio-dock").classList.toggle("hidden", !show);
    document.body.classList.toggle("has-dock", show);
  }
  function ensureAudio() {
    const t = test();
    if (t && t.audioSrc && !decodeURIComponent(audioEl.src).endsWith(t.audioSrc)) {
      audioEl.src = t.audioSrc;
    }
  }
  function strictExam() {
    // đang thi (chưa nộp): không đổi tốc độ, không lặp, không tua
    return state.mode === "exam" && !state.finished;
  }
  function playSegment(start, end) {
    ensureAudio();
    state.segEnd = end || null;
    state.lastSeg = { start, end: end || null };
    audioEl.currentTime = start;
    audioEl.playbackRate = strictExam() ? 1 : state.rate;
    audioEl.play();
    showDock(true);
  }
  function cycleSpeed() {
    if (strictExam()) return;
    state.rate = state.rate === 1 ? 0.75 : state.rate === 0.75 ? 0.5 : 1;
    audioEl.playbackRate = state.rate;
    $("#dock-speed").textContent = state.rate + "x";
    $("#dock-speed").classList.toggle("active", state.rate !== 1);
  }
  function toggleLoop() {
    if (strictExam()) return;
    state.loop = !state.loop;
    $("#dock-loop").classList.toggle("active", state.loop);
  }
  audioEl.addEventListener("timeupdate", () => {
    if (state.segEnd && audioEl.currentTime >= state.segEnd) {
      if (state.loop && !strictExam() && state.lastSeg) {
        audioEl.currentTime = state.lastSeg.start;
        return;
      }
      audioEl.pause(); state.segEnd = null;
      // pure-listening exam that plays a partial span: prompt submit when the span ends
      if (state.view === "runner" && state.mode === "exam" && !state.finished && test() && test().kind === "listening") {
        trySubmit();
      }
    }
  });
  audioEl.addEventListener("ended", () => {
    if (state.loop && !strictExam() && state.lastSeg) {
      audioEl.currentTime = state.lastSeg.start;
      audioEl.play();
    }
  });
  audioEl.addEventListener("play", () => {
    audioEl.playbackRate = strictExam() ? 1 : state.rate;
  });
  audioEl.addEventListener("ended", () => {
    if (state.view === "runner" && state.mode === "exam" && !state.finished && test().kind === "listening") {
      trySubmit();
    }
  });
  function audioToggle() {
    const t = test();
    // thi thật: không được tạm dừng audio
    if (t && t.sessionCfg && t.sessionCfg.real && state.mode === "exam" && !state.finished) return;
    if (audioEl.paused) audioEl.play(); else audioEl.pause();
  }
  function initDock() {
    setInterval(() => {
      $("#dock-play").textContent = audioEl.paused ? "▶" : "⏸";
      const dur = audioEl.duration || 0;
      $("#dock-progress").style.width = dur ? (audioEl.currentTime / dur) * 100 + "%" : "0%";
      $("#dock-time").textContent = fmtTime(audioEl.currentTime) + " / " + fmtTime(dur);
      document.querySelectorAll(".dock-tool").forEach((b) => { b.style.display = strictExam() ? "none" : ""; });
      // karaoke highlight on transcript lines
      if (!audioEl.paused) {
        const ct = audioEl.currentTime;
        let cur = null;
        document.querySelectorAll(".tl-line").forEach((el) => {
          el.classList.remove("cur");
          if (parseFloat(el.dataset.t) <= ct) cur = el;
        });
        if (cur && ct - parseFloat(cur.dataset.t) < 25) cur.classList.add("cur");
      }
      if (state.view === "runner" && state.mode === "exam" && test() && test().audioSrc && !state.finished) {
        highlightByAudio();
      }
    }, 400);
    $("#dock-track").addEventListener("click", (e) => {
      if (state.mode === "exam" && test() && test().audioSrc && !state.finished) return; // no seeking in exam
      const r = e.currentTarget.getBoundingClientRect();
      audioEl.currentTime = ((e.clientX - r.left) / r.width) * (audioEl.duration || 0);
    });
  }

  function highlightByAudio() {
    const tm = test() && test().timings;
    if (!tm) return;
    const t = audioEl.currentTime;
    let cur = null;
    for (const [qn, seg] of Object.entries(tm.questions || {})) {
      if (t >= seg.start && t < seg.end) { cur = qn; break; }
    }
    if (!cur) {
      for (const b of tm.blocks || []) {
        if (t >= b.start && t < b.end) { cur = String(b.questions[0]); break; }
      }
    }
    document.querySelectorAll(".qcard.current").forEach((el) => el.classList.remove("current"));
    if (cur) {
      const el = document.getElementById("qc-" + cur);
      if (el) {
        el.classList.add("current");
        if (!el.dataset.scrolled) {
          el.dataset.scrolled = "1";
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }
  }

  /* ---------------- timer (reading exam) ---------------- */
  function startTimer(sec) {
    state.timerSec = sec;
    $("#timer-display").classList.remove("hidden");
    state.timerInt = setInterval(() => {
      state.timerSec--;
      const td = $("#timer-display");
      td.textContent = fmtTime(state.timerSec);
      td.classList.toggle("low", state.timerSec < 300);
      if (state.timerSec <= 0) { stopTimer(); submit(true); }
    }, 1000);
    $("#timer-display").textContent = fmtTime(sec);
  }
  function stopTimer() {
    clearInterval(state.timerInt); state.timerInt = null;
    $("#timer-display").classList.add("hidden");
  }

  /* ---------------- views ---------------- */
  function goHome() {
    stopTimer(); audioEl.pause(); showDock(false);
    screen.classList.remove("wide");
    document.body.classList.remove("has-mbar");
    state.view = "home"; state.testId = null; state.session = null; state.finished = false;
    $("#btn-exit").classList.add("hidden");
    renderHome();
  }

  function groupCardTitle(title) {
    return String(title || "")
      .replace(/\s+\((Listening|Reading)\)$/i, "")
      .replace(/\s+[—-]\s*(Listening|Reading)$/i, "");
  }

  function testGroups() {
    // gộp các section cùng một đề (m5-listening + m5-reading → "Mock Test 5")
    const groups = {};
    Object.values(D.tests).forEach((t) => {
      const base = t.id.replace(/-(listening|reading)$/, "");
      if (!groups[base]) {
        groups[base] = { base, title: groupCardTitle(t.title), custom: !!t.custom, tests: [] };
      }
      groups[base].tests.push(t);
    });
    Object.values(groups).forEach((g) => g.tests.sort((a, b) => (a.kind === "listening" ? -1 : 1) - (b.kind === "listening" ? -1 : 1)));
    return Object.values(groups);
  }

  function realExamTimer(g) {
    const hasL = g.tests.some((t) => t.kind === "listening");
    const hasR = g.tests.some((t) => t.kind === "reading");
    if (hasL && hasR) return 120;
    if (hasR) return g.tests.find((t) => t.kind === "reading").timerMin || 75;
    return null; // listening-only: chạy theo audio
  }

  const ICONS = {
    phones: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a8 8 0 0 1 16 0"/><path d="M4 14v4a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H4z"/><path d="M20 14v4a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3z"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0 5 5m-5-5-5 5"/><path d="M4 20h16"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  };

  function mergeWrongBanks(current, incoming) {
    const byId = {};
    current.forEach((x) => { if (x && x.id) byId[x.id] = x; });
    incoming.forEach((raw) => {
      if (!raw || !raw.id || !raw.testId || raw.qn == null) return;
      const old = byId[raw.id];
      if (!old) { byId[raw.id] = raw; return; }
      const rawNewer = (raw.lastWrongAt || raw.lastCorrectAt || raw.firstWrongAt || 0) >= (old.lastWrongAt || old.lastCorrectAt || old.firstWrongAt || 0);
      byId[raw.id] = {
        ...(rawNewer ? old : raw),
        ...(rawNewer ? raw : old),
        firstWrongAt: Math.min(old.firstWrongAt || raw.firstWrongAt || Date.now(), raw.firstWrongAt || old.firstWrongAt || Date.now()),
        lastWrongAt: Math.max(old.lastWrongAt || 0, raw.lastWrongAt || 0) || null,
        lastCorrectAt: Math.max(old.lastCorrectAt || 0, raw.lastCorrectAt || 0) || null,
        wrongCount: Math.max(old.wrongCount || 0, raw.wrongCount || 0),
        correctCount: Math.max(old.correctCount || 0, raw.correctCount || 0),
        attemptCount: Math.max(old.attemptCount || 0, raw.attemptCount || 0),
        correctStreak: rawNewer ? (raw.correctStreak || 0) : (old.correctStreak || 0),
        mastered: !!old.mastered || !!raw.mastered,
        dueAt: old.mastered || raw.mastered ? null : Math.min(old.dueAt || Date.now(), raw.dueAt || Date.now()),
      };
    });
    return sortWrongBank(Object.values(byId));
  }

  function exportWrongBank() {
    const payload = { version: 1, exportedAt: Date.now(), wrongBank: loadWrongBank(), importedHistory: loadImportedHistory() };
    const text = JSON.stringify(payload, null, 2);
    try {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `toeic-wrong-bank-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {}
    openModal(`<h3>Xuất dữ liệu câu sai</h3>
      <p>File JSON đã được tạo. Nếu trình duyệt không tự tải xuống, bạn có thể copy nội dung bên dưới để backup hoặc chuyển sang thiết bị khác.</p>
      <textarea class="dict-input" rows="8" readonly>${esc(text)}</textarea>
      <div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>`, true);
  }

  function openWrongImport() {
    openModal(`<h3>Nhập dữ liệu câu sai</h3>
      <p>Dán nội dung file JSON đã xuất từ thiết bị khác. Dữ liệu sẽ được gộp theo từng câu, không xoá sổ hiện tại.</p>
      <textarea id="wrong-import-json" class="dict-input" rows="8" placeholder="Dán JSON backup vào đây..."></textarea>
      <div id="wrong-import-status"></div>
      <div class="modal-actions">
        <button class="btn" onclick="App.closeModal()">Huỷ</button>
        <button class="btn btn-primary" onclick="App.importWrongBankText()">Nhập dữ liệu</button>
      </div>`, true);
  }

  function importWrongBankText() {
    const box = document.getElementById("wrong-import-json");
    const status = document.getElementById("wrong-import-status");
    try {
      const parsed = JSON.parse((box && box.value || "").trim());
      const incoming = Array.isArray(parsed) ? parsed : parsed.wrongBank;
      if (!Array.isArray(incoming)) throw new Error("Không tìm thấy danh sách wrongBank trong JSON.");
      const merged = mergeWrongBanks(loadWrongBank(), incoming);
      saveWrongBank(merged);
      if (parsed.importedHistory) saveImportedHistory([...loadImportedHistory(), ...parsed.importedHistory]);
      if (status) status.innerHTML = `<div class="dict-score good">Đã nhập ${incoming.length} dòng, sổ hiện có ${merged.length} câu.</div>`;
      setTimeout(() => { closeModal(); if (state.view === "wrong") goWrong("active"); }, 500);
    } catch (e) {
      if (status) status.innerHTML = `<div class="dict-score low">Không nhập được: ${esc(e.message || String(e))}</div>`;
    }
  }

  function renderWrongInsights(profiles, currentFilter) {
    if (!profiles.length) return "";
    const cards = profiles.slice(0, 6).map((p, idx) => {
      const examples = p.examples.map(({ entry }) => `Part ${entry.part} câu ${entry.qn}`).join(" · ");
      return `<div class="wrong-insight-card ${currentFilter === "profile:" + p.id ? "active" : ""}">
        <div class="wic-rank">${idx + 1}</div>
        <div class="wic-body">
          <b>${esc(p.short)}</b>
          <div class="muted">${p.count} câu · ${p.wrongs} lần sai${p.due ? ` · ${p.due} đến hạn` : ""}</div>
          <p>${esc(p.advice)}</p>
          ${examples ? `<small>${esc(examples)}</small>` : ""}
        </div>
        <div class="wic-actions">
          <button class="btn btn-sm" onclick="App.goWrong('profile:${p.id}')">Xem lỗi</button>
          <button class="btn btn-sm btn-primary" onclick="App.goProfileDrill('${p.id}')">Luyện dạng này</button>
        </div>
      </div>`;
    }).join("");
    return `<section class="wrong-insights">
      <div class="sec-head"><h2>Dạng lỗi lặp lại</h2><span class="muted">Ưu tiên luyện các nhóm có tổng lần sai cao nhất</span></div>
      <div class="wrong-insight-grid">${cards}</div>
    </section>`;
  }

  function renderWrongHomePanel(stats) {
    const active = stats.active;
    const due = stats.due;
    const body = active
      ? `<div class="wrong-panel">
          <span class="tc-icon wp-icon">${ICONS.cards}</span>
          <div class="wp-body">
            <div class="wp-title"><b>${active}</b> câu sai đang cần ôn${due ? ` · <span>${due} câu đến hạn hôm nay</span>` : ""}</div>
            <div class="wp-meta">Reading ${stats.reading} · Listening ${stats.listening} · đã thuộc ${stats.mastered}</div>
          </div>
          <div class="wp-actions">
            <button class="btn btn-primary" onclick="App.goWrong('${due ? "due" : "active"}')">Ôn câu sai</button>
            <button class="btn" onclick="App.goWrong('all')">Mở sổ</button>
          </div>
        </div>`
      : `<div class="wrong-panel empty">
          <span class="tc-icon wp-icon">${ICONS.cards}</span>
          <div class="wp-body">
            <div class="wp-title"><b>Chưa có câu sai</b></div>
            <div class="wp-meta">Khi bạn kiểm tra đáp án hoặc nộp bài, câu sai sẽ tự được gom vào đây để ôn lại.</div>
          </div>
        </div>`;
    return `<section class="home-sec wrong-home">
      <div class="sec-head">
        <h2>Sổ câu sai</h2>
        <button class="link-btn" onclick="App.goWrong('active')">Mở sổ →</button>
      </div>
      ${body}
    </section>`;
  }

  function goWrong(filter) {
    importWrongFromHistory();
    filter = filter || "active";
    state.view = "wrong";
    stopTimer(); audioEl.pause(); showDock(false);
    document.body.classList.remove("has-mbar");
    screen.classList.remove("wide");
    $("#btn-exit").classList.add("hidden");

    const stats = wrongStats();
    const profileStats = wrongProfileStats();
    const profileFilterId = String(filter || "").startsWith("profile:") ? String(filter).slice(8) : null;
    const profileFilter = profileFilterId ? ERROR_PROFILES[profileFilterId] : null;
    const entries = wrongEntries(filter);
    const filters = [
      ["active", `Đang cần ôn (${stats.active})`],
      ["due", `Đến hạn (${stats.due})`],
      ["reading", `Reading (${stats.reading})`],
      ["listening", `Listening (${stats.listening})`],
      ["mastered", `Đã thuộc (${stats.mastered})`],
      ["all", `Tất cả (${stats.total})`],
    ].map(([k, label]) => `<button class="tchip ${filter === k ? "selected" : ""}" onclick="App.goWrong('${k}')">${label}</button>`).join("");

    const byTest = {};
    entries.forEach(({ entry, ref }) => {
      if (!ref) return;
      if (!byTest[entry.testId]) byTest[entry.testId] = { testId: entry.testId, title: entry.testTitle, kind: entry.kind, qns: [] };
      byTest[entry.testId].qns.push(entry.qn);
    });
    const groupCards = Object.values(byTest).map((g) => `<div class="wrong-test-card">
      <div>
        <b>${esc(groupCardTitle(g.title))}</b>
        <div class="muted">${g.kind === "listening" ? "Listening" : "Reading"} · ${g.qns.length} câu trong nhóm đang xem</div>
      </div>
      <div class="wrong-card-actions">
        <button class="btn" onclick="App.goSimilarDrill('${g.testId}','${filter}')">Biến thể</button>
        <button class="btn btn-primary" onclick="App.startWrongReview('${g.testId}','${filter}')">Ôn nhóm này</button>
      </div>
    </div>`).join("");

    const rows = entries.map(({ entry, ref }) => {
      const stale = !ref;
      const status = entry.mastered
        ? '<span class="badge badge-green">Đã thuộc</span>'
        : entry.dueAt && entry.dueAt > Date.now()
          ? '<span class="badge badge-blue">Đang giãn cách</span>'
          : '<span class="badge badge-amber">Cần ôn</span>';
      const preview = entry.question || (ref && ref.q.question) || "Xem trong ảnh đề";
      const profile = profileForEntry(entry, ref);
      const action = stale
        ? '<span class="muted">Đề gốc không còn trong dữ liệu</span>'
        : `<div class="wrong-row-actions"><button class="btn btn-sm" onclick="App.startWrongReview('${entry.testId}','all',${entry.qn})">Ôn câu này</button><button class="btn btn-sm" onclick="App.openWrongDrill('${entry.testId}',${entry.qn})">Drill lỗi</button><button class="btn btn-sm" onclick="App.goSimilarDrill('${entry.testId}','all',${entry.qn})">Biến thể</button></div>`;
      return `<tr>
        <td><b>${esc(groupCardTitle(entry.testTitle || entry.testId))}</b><div class="muted">Part ${entry.part} · câu ${entry.qn}</div><span class="wrong-mini-profile">${esc(profile.short)}</span></td>
        <td>${esc(preview)}</td>
        <td>${status}<div class="muted">Sai ${entry.wrongCount || 0} lần · đúng lại ${entry.correctStreak || 0}/${WRONG_MASTER_STREAK}</div></td>
        <td class="muted">${shortDate(entry.lastWrongAt || entry.firstWrongAt)}</td>
        <td>${action}</td>
      </tr>`;
    }).join("");

    screen.innerHTML = `
      <div class="hero"><h1>Sổ câu sai</h1>
        <p>${profileFilter ? `Đang xem riêng dạng ${esc(profileFilter.label)}. ${esc(profileFilter.advice)}` : `Các câu bạn làm sai được lưu tự động theo đề gốc. Ôn đúng ${WRONG_MASTER_STREAK} lần liên tiếp thì câu đó sẽ tự chuyển sang đã thuộc.`}</p>
      </div>
      <div class="wrong-summary">
        <div class="stat-box"><div class="v">${stats.active}</div><div class="k">đang cần ôn</div></div>
        <div class="stat-box"><div class="v">${stats.due}</div><div class="k">đến hạn hôm nay</div></div>
        <div class="stat-box"><div class="v">${stats.reading}</div><div class="k">Reading</div></div>
        <div class="stat-box"><div class="v">${stats.listening}</div><div class="k">Listening</div></div>
        <div class="stat-box"><div class="v">${stats.mastered}</div><div class="k">đã thuộc</div></div>
      </div>
      ${renderWrongInsights(profileStats, filter)}
      <div class="wrong-toolbar">
        <div class="time-chips">${filters}</div>
        <div class="wrong-toolbar-actions">
          <button class="btn" onclick="App.exportWrongBank()">Xuất dữ liệu</button>
          <button class="btn" onclick="App.openWrongImport()">Nhập dữ liệu</button>
          <button class="btn" onclick="App.goHome()">Trang chủ</button>
        </div>
      </div>
      ${groupCards ? `<div class="wrong-tests">${groupCards}</div>` : ""}
      ${rows ? `<div class="table-scroll"><table class="history-table wrong-table"><thead><tr><th>Nguồn</th><th>Câu hỏi</th><th>Trạng thái</th><th>Lần sai gần nhất</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="history-empty">Không có câu nào trong nhóm này.</div>'}
    `;
    window.scrollTo(0, 0);
  }

  function renderHome() {
    importWrongFromHistory();
    const hist = loadHistory();
    const vocab = D.vocab || [];
    const srs = vocabSrs();
    const learned = vocab.filter((v) => srs[v.id] && srs[v.id].lv >= 3).length;
    const due = vocabDue().length;
    const groups = testGroups();
    const last = hist.find((h) => h.scaled != null);
    const totalQ = Object.values(D.tests).reduce((n, t) => n + allQuestions(t).length, 0);
    const wstats = wrongStats();

    const testCards = groups.map((g) => {
      const hasL = g.tests.some((t) => t.kind === "listening");
      const tags = g.tests.map((t) => t.kind === "listening"
        ? '<span class="tag tag-listen">Listening</span>'
        : '<span class="tag tag-read">Reading</span>').join("")
        + (g.custom ? '<span class="tag tag-upload">Đề upload</span>' : "");
      const total = g.tests.reduce((n, t) => n + allQuestions(t).length, 0);
      const metas = g.tests.map((t) => `<li>${esc(t.desc)}</li>`).join("");
      const tm = realExamTimer(g);
      return `<div class="test-card">
        <div class="tc-top">
          <span class="tc-icon">${hasL ? ICONS.phones : ICONS.book}</span>
          <div>
            <h3>${esc(g.title)}</h3>
            <div class="tc-tags">${tags}</div>
          </div>
        </div>
        <ul class="tc-meta">${metas}</ul>
        <div class="tc-foot">
          <span class="tc-count">${total} câu</span>
          <div class="tc-actions">
            <button class="btn" onclick="App.goPracticeSetup('${g.base}')">Luyện thi</button>
            <button class="btn btn-primary" onclick="App.goRealExam('${g.base}')">Thi thật${tm ? ` · ${tm}′` : ""}</button>
          </div>
        </div>
      </div>`;
    }).join("");

    const histRows = hist.slice(0, 10).map((h) => {
      const t = D.tests[h.testId];
      if (!t && !h.session) return "";
      const full = !!h.answers;
      return `<tr class="hist-row" onclick="App.openHistory(${h.date})" title="Bấm để xem chi tiết bài làm này">
        <td>${esc((h.title || (t ? t.title : h.testId)).replace(/^[🎯🛠]+\s*/, ""))}</td>
        <td>${h.session && h.session.real ? "Thi thật" : h.mode === "exam" ? "Thi thử" : "Luyện tập"}</td>
        <td><b>${h.correct}/${h.total}</b> <span class="muted">(${Math.round((h.correct / h.total) * 100)}%)</span></td>
        <td>${h.scaled != null ? "~" + h.scaled : "—"}</td>
        <td class="muted">${new Date(h.date).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</td>
        <td><span class="hist-review-link">${full ? "Xem lại" : "Chi tiết"}</span></td>
      </tr>`;
    }).join("");

    const vocabPct = vocab.length ? Math.round((learned / vocab.length) * 100) : 0;
    screen.innerHTML = `
      <div class="home-head">
        <h1>Luyện thi TOEIC</h1>
        <p class="home-sub">Listening & Reading · chấm điểm quy đổi thang 990 · đáp án và giải thích tiếng Việt cho từng câu</p>
      </div>
      <div class="stats-strip">
        <div class="stat-tile"><span class="sv">${groups.length}</span><span class="sk">đề luyện</span></div>
        <div class="stat-tile"><span class="sv">${totalQ}</span><span class="sk">câu hỏi</span></div>
        <div class="stat-tile"><span class="sv">${hist.length}</span><span class="sk">bài đã làm</span></div>
        <div class="stat-tile"><span class="sv">${last ? "~" + last.scaled : "—"}</span><span class="sk">điểm gần nhất</span></div>
        <div class="stat-tile${due ? " stat-due" : ""}"><span class="sv">${due}</span><span class="sk">từ cần ôn</span></div>
        <div class="stat-tile${wstats.active ? " stat-wrong" : ""}"><span class="sv">${wstats.active}</span><span class="sk">câu sai cần ôn</span></div>
      </div>

      ${renderWrongHomePanel(wstats)}

      <section class="home-sec">
        <div class="sec-head"><h2>Đề luyện tập</h2></div>
        <div class="card-grid">${testCards}</div>
      </section>

      <section class="home-sec">
        <div class="sec-head">
          <h2>Sổ từ vựng</h2>
          <button class="link-btn" onclick="App.goVocab()">Mở sổ từ →</button>
        </div>
        <div class="vocab-panel">
          <span class="tc-icon vp-icon">${ICONS.cards}</span>
          <div class="vp-body">
            <div class="vp-line"><b>${learned}/${vocab.length}</b> từ đã thuộc${due ? ` · <span class="vp-due">${due} từ đến hạn ôn hôm nay</span>` : " · hôm nay không có từ đến hạn"}</div>
            <div class="vp-bar"><div class="vp-fill" style="width:${vocabPct}%"></div></div>
          </div>
          <button class="btn btn-primary" onclick="App.startFlashcards()">Ôn flashcard</button>
        </div>
      </section>

      <section class="home-sec">
        <div class="sec-head">
          <h2>Đề mới upload</h2>
          <button class="link-btn" onclick="App.goUpload()">+ Tải đề lên</button>
        </div>
        <div id="inbox-area"><div class="history-empty">Đang tải danh sách…</div></div>
      </section>

      <section class="home-sec">
        <div class="sec-head"><h2>Lịch sử làm bài</h2></div>
        ${hist.length ? `<div class="table-scroll"><table class="history-table"><thead><tr><th>Đề</th><th>Chế độ</th><th>Kết quả</th><th>Điểm quy đổi</th><th>Thời gian</th><th></th></tr></thead><tbody>${histRows}</tbody></table></div>`
        : '<div class="history-empty">Chưa có bài làm nào — chọn một đề phía trên để bắt đầu.</div>'}
      </section>
      <footer class="appfoot">Dữ liệu đề: Mock Test 3 & 5 (Benzen English TOEIC) + đề upload · đáp án & giải thích do AI biên soạn, câu chưa chắc chắn được đánh dấu riêng</footer>
    `;
    refreshInbox();
  }

  /* ---------------- vocab notebook + flashcards ---------------- */
  const VOCAB_LS = "toeic-vocab-srs-v1";
  function vocabSrs() {
    try { return JSON.parse(localStorage.getItem(VOCAB_LS)) || {}; } catch { return {}; }
  }
  function saveVocabSrs(s) { localStorage.setItem(VOCAB_LS, JSON.stringify(s)); }
  const SRS_STEPS_DAYS = [0.007, 1, 2, 4, 8, 16, 32]; // level 0 ≈ 10 phút

  function vocabDue() {
    const srs = vocabSrs();
    const now = Date.now();
    return (D.vocab || []).filter((v) => srs[v.id] && srs[v.id].due <= now);
  }

  function goVocab(tab, filter) {
    state.view = "vocab";
    document.body.classList.remove("has-mbar");
    screen.classList.remove("wide");
    $("#btn-exit").classList.add("hidden");
    const vocab = D.vocab || [];
    if (!vocab.length) {
      screen.innerHTML = `<div class="hero"><h1>Sổ từ vựng</h1><p>Chưa có dữ liệu từ vựng.</p></div><button class="btn" onclick="App.goHome()">Trang chủ</button>`;
      return;
    }
    tab = tab || "list"; filter = filter || "all";
    const srs = vocabSrs();
    const now = Date.now();
    const due = vocab.filter((v) => srs[v.id] && srs[v.id].due <= now);
    const learned = vocab.filter((v) => srs[v.id] && srs[v.id].lv >= 3).length;
    let list = vocab;
    if (filter === "listening") list = vocab.filter((v) => v.testId === "m5-listening");
    if (filter === "reading") list = vocab.filter((v) => v.testId !== "m5-listening");
    if (filter === "due") list = due;

    const filterChips = [["all", `Tất cả (${vocab.length})`], ["listening", "Listening"], ["reading", "Reading"], ["due", `Cần ôn (${due.length})`]]
      .map(([k, label]) => `<button class="tchip ${filter === k ? "selected" : ""}" onclick="App.goVocab('list','${k}')">${label}</button>`).join("");

    const rows = list.map((v) => {
      const lv = srs[v.id] ? srs[v.id].lv : null;
      const audioBtn = v.audio ? `<button class="btn btn-sm" onclick="App.playSeg(${v.audio.start},${v.audio.end})">${ICONS.sound}</button>` : "";
      return `<div class="vocab-row">
        <div class="vr-head">
          <b>${esc(v.word)}</b> <span class="vr-type">(${esc(v.type || "")})</span>
          ${lv != null ? `<span class="badge ${lv >= 3 ? "badge-green" : "badge-amber"}">${lv >= 3 ? "✓ thuộc" : "đang học"}</span>` : ""}
          ${audioBtn}
        </div>
        <div class="vr-meaning">${esc(v.meaning)}</div>
        <div class="vr-ex">"${esc(v.example || "")}"</div>
        ${v.exampleVi ? `<div class="vr-exvi">→ ${esc(v.exampleVi)}</div>` : ""}
      </div>`;
    }).join("");

    screen.innerHTML = `
      <div class="hero"><h1>Sổ từ vựng</h1>
        <p>${vocab.length} từ trích từ chính bộ đề của bạn · đã thuộc ${learned} · cần ôn hôm nay ${due.length}. Từ Listening có nút loa phát đúng đoạn audio chứa từ đó.</p>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px">
        <button class="btn btn-primary" onclick="App.startFlashcards()">Học flashcard${due.length ? ` · ${due.length} từ cần ôn` : ""}</button>
        <button class="btn" onclick="App.goHome()">Trang chủ</button>
      </div>
      <div class="time-chips" style="margin-bottom:14px">${filterChips}</div>
      <div class="vocab-list">${rows || '<div class="history-empty">Không có từ nào trong nhóm này.</div>'}</div>
    `;
    window.scrollTo(0, 0);
  }

  let fcQueue = [], fcIdx = 0, fcShown = false;

  function startFlashcards() {
    const vocab = D.vocab || [];
    const srs = vocabSrs();
    const now = Date.now();
    const due = vocab.filter((v) => srs[v.id] && srs[v.id].due <= now);
    const fresh = vocab.filter((v) => !srs[v.id]);
    const rest = vocab.filter((v) => srs[v.id] && srs[v.id].due > now);
    fcQueue = [...due, ...fresh, ...rest].slice(0, 20);
    fcIdx = 0;
    renderFlashcard();
  }

  function renderFlashcard() {
    if (fcIdx >= fcQueue.length) {
      screen.innerHTML = `<div class="hero" style="text-align:center"><h1>Hết lượt ôn 🎉</h1>
        <p>Bạn vừa ôn ${fcQueue.length} từ. Quay lại sau để ôn tiếp các từ đến hạn.</p></div>
        <div style="display:flex; gap:10px; justify-content:center">
          <button class="btn btn-primary" onclick="App.startFlashcards()">Lượt mới</button>
          <button class="btn" onclick="App.goVocab()">Sổ từ</button>
        </div>`;
      return;
    }
    fcShown = false;
    const v = fcQueue[fcIdx];
    const audioBtn = v.audio ? `<button class="btn btn-round" onclick="App.playSeg(${v.audio.start},${v.audio.end})">${ICONS.sound}</button>` : "";
    screen.innerHTML = `
      <div class="fc-wrap">
        <div class="fc-progress">${fcIdx + 1} / ${fcQueue.length}</div>
        <div class="fc-card" id="fc-card">
          <div class="fc-word">${esc(v.word)} ${audioBtn}</div>
          <div class="fc-type">(${esc(v.type || "")})</div>
          <div id="fc-back" class="hidden">
            <div class="fc-meaning">${esc(v.meaning)}</div>
            <div class="fc-ex">"${esc(v.example || "")}"</div>
            ${v.exampleVi ? `<div class="fc-exvi">→ ${esc(v.exampleVi)}</div>` : ""}
          </div>
        </div>
        <div class="fc-actions" id="fc-actions">
          <button class="btn btn-primary" onclick="App.fcFlip()">Hiện nghĩa</button>
        </div>
        <button class="btn btn-ghost" onclick="App.goVocab()" style="margin-top:14px">← Về sổ từ</button>
      </div>`;
    window.scrollTo(0, 0);
  }

  function fcFlip() {
    if (fcShown) return;
    fcShown = true;
    $("#fc-back").classList.remove("hidden");
    $("#fc-actions").innerHTML = `
      <button class="btn" style="border-color:var(--red);color:var(--red)" onclick="App.fcAnswer(false)">Chưa thuộc</button>
      <button class="btn" style="border-color:var(--green);color:var(--green)" onclick="App.fcAnswer(true)">Đã thuộc</button>`;
  }

  function fcAnswer(known) {
    const v = fcQueue[fcIdx];
    const srs = vocabSrs();
    const cur = srs[v.id] || { lv: 0, due: 0 };
    const lv = known ? Math.min(cur.lv + 1, SRS_STEPS_DAYS.length - 1) : 0;
    srs[v.id] = { lv, due: Date.now() + SRS_STEPS_DAYS[lv] * 86400000 };
    saveVocabSrs(srs);
    fcIdx++;
    renderFlashcard();
  }

  /* ---------------- uploads / inbox ---------------- */
  const STATUS_LABEL = {
    pending: '<span class="badge badge-amber">Chờ xử lý</span>',
    processing: '<span class="badge badge-blue"><span class="spin"></span> Đang số hóa…</span>',
    done: '<span class="badge badge-green">Hoàn tất</span>',
    error: '<span class="badge badge-red">Lỗi</span>',
  };
  let inboxTimer = null;
  let apiOk = null; // null = chưa biết; false = đang chạy trên hosting tĩnh (GitHub Pages...)

  // Hộp thư cloud (Cloudflare Worker): cho phép giáo viên upload đề ngay trên web deploy.
  // Máy Mac của học viên tự kéo về xử lý (poller.py) rồi tự đăng lên web.
  const CLOUD_INBOX = {
    url: "https://toeic-inbox.hoangthien77.workers.dev",
    token: "toeic-d55c1e1787c9c904",
  };

  async function probeApi() {
    if (apiOk !== null) return apiOk;
    try {
      const r = await fetch("/api/uploads");
      apiOk = r.ok && Array.isArray((await r.json()).uploads);
    } catch {
      apiOk = false;
    }
    return apiOk;
  }

  async function refreshInbox() {
    const area = $("#inbox-area");
    if (!area || state.view !== "home") return;
    let uploads = null;
    try {
      const r = await fetch("/api/uploads");
      uploads = (await r.json()).uploads || [];
      apiOk = true;
    } catch {
      apiOk = false;
      // hosting tĩnh: hiển thị hàng chờ từ hộp thư cloud (nếu đã cấu hình)
      if (CLOUD_INBOX.url) { renderCloudInbox(area); return; }
      area.innerHTML = '<div class="history-empty">Tính năng upload & xử lý đề mới chỉ hoạt động khi chạy app trên máy (mở bằng "Start TOEIC App.command"). Đề đã xử lý xong vẫn dùng đầy đủ trên web này.</div>';
      return;
    }
    if (!uploads.length) {
      area.innerHTML = '<div class="history-empty">Chưa có đề nào được upload. Bấm "+ Tải đề lên" khi cô giáo gửi đề.</div>';
      return;
    }
    const rows = uploads.map((u) => {
      const files = u.files.map((f) => esc(f.name)).join(", ");
      let action = "";
      if (u.status === "pending") action = `<button class="btn btn-sm btn-primary" onclick="App.processUpload('${u.id}')">Xử lý ngay</button>`;
      else if (u.status === "processing") action = '<span style="color:var(--muted);font-size:12.5px">~5–15 phút</span>';
      else if (u.status === "done") action = `<button class="btn btn-sm" onclick="location.reload()">Tải lại trang để thấy đề</button>`;
      else if (u.status === "error") action = `<button class="btn btn-sm" onclick="App.processUpload('${u.id}')">Thử lại</button>`;
      const doneIds = (u.resultTestIds || []).filter((id) => D.tests[id]);
      const doneNote = u.status === "done" && doneIds.length
        ? `<div style="font-size:12.5px;color:var(--green)">Đã có trong "Đề luyện tập" phía trên ✓</div>` : "";
      const errNote = u.status === "error" && u.error ? `<div style="font-size:12.5px;color:var(--red)">${esc(u.error)}</div>` : "";
      return `<tr>
        <td><b>${esc(u.name)}</b><div style="font-size:12px;color:var(--muted)">${files}</div>${doneNote}${errNote}</td>
        <td>${STATUS_LABEL[u.status] || esc(u.status)}</td>
        <td>${new Date(u.uploadedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</td>
        <td>${action}</td>
      </tr>`;
    }).join("");
    area.innerHTML = `<div class="table-scroll"><table class="history-table"><thead><tr><th>Đề</th><th>Trạng thái</th><th>Lúc tải lên</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    clearTimeout(inboxTimer);
    if (uploads.some((u) => u.status === "processing")) {
      inboxTimer = setTimeout(refreshInbox, 5000);
    }
  }

  async function processUpload(id) {
    try {
      const r = await fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const j = await r.json();
      if (j.error) openModal(`<h3>Không xử lý được</h3><p>${esc(j.error)}</p><div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>`);
    } catch {
      openModal('<h3>Lỗi kết nối</h3><p>Không gọi được server.</p><div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>');
    }
    refreshInbox();
  }

  const CLOUD_STATUS = {
    uploading: '<span class="badge badge-amber">Đang tải lên…</span>',
    pending: '<span class="badge badge-amber">Trong hàng chờ — máy xử lý sẽ nhận khi bật</span>',
    processing: '<span class="badge badge-blue"><span class="spin"></span> Đang số hóa trên máy…</span>',
    done: '<span class="badge badge-green">Đã lên web — tải lại trang để thấy đề</span>',
    error: '<span class="badge badge-red">Lỗi xử lý</span>',
  };

  async function renderCloudInbox(area) {
    try {
      const r = await fetch(CLOUD_INBOX.url + "/pending");
      const uploads = (await r.json()).uploads || [];
      if (!uploads.length) {
        area.innerHTML = '<div class="history-empty">Chưa có đề nào trong hàng chờ. Bấm "+ Tải đề lên" để gửi đề mới.</div>';
        return;
      }
      const rows = uploads.map((u) => {
        const errorNote = u.status === "error" && u.error
          ? `<div style="font-size:12.5px;color:var(--red);margin-top:4px">${esc(u.error)}</div>` : "";
        const action = u.status === "error"
          ? `<button class="btn btn-sm" onclick="App.retryCloudUpload('${esc(u.id)}')">Thử lại</button>`
          : u.status === "done" ? '<button class="btn btn-sm" onclick="location.reload()">Tải lại</button>' : "";
        return `<tr>
          <td><b>${esc(u.name)}</b><div style="font-size:12px;color:var(--muted)">${(u.files || []).map(esc).join(", ")}</div>${errorNote}</td>
          <td>${CLOUD_STATUS[u.status] || esc(u.status || "")}</td>
          <td>${u.uploadedAt ? new Date(u.uploadedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : ""}</td>
          <td>${action}</td>
        </tr>`;
      }).join("");
      area.innerHTML = `<div class="table-scroll"><table class="history-table"><thead><tr><th>Đề</th><th>Trạng thái</th><th>Lúc gửi</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
      clearTimeout(inboxTimer);
      if (uploads.some((u) => ["pending", "processing", "uploading"].includes(u.status)) && state.view === "home") {
        inboxTimer = setTimeout(() => { const a = $("#inbox-area"); if (a) renderCloudInbox(a); }, 30000);
      }
    } catch {
      area.innerHTML = '<div class="history-empty">Không kết nối được hộp thư đề — thử lại sau.</div>';
    }
  }

  async function retryCloudUpload(id) {
    try {
      const r = await fetch(`${CLOUD_INBOX.url}/retry?id=${encodeURIComponent(id)}`, {
        method: "POST", headers: { "X-Inbox-Token": CLOUD_INBOX.token },
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Không thử lại được");
      const area = $("#inbox-area");
      if (area) renderCloudInbox(area);
    } catch (e) {
      openModal(`<h3>Không thử lại được</h3><p>${esc(e.message || String(e))}</p><div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>`);
    }
  }

  function fmtBytes(n) {
    if (n > 1e6) return (n / 1e6).toFixed(1) + " MB";
    if (n > 1e3) return Math.round(n / 1e3) + " KB";
    return n + " B";
  }

  function uploadFormHtml(cloud) {
    const guide = `
      <aside class="guide-panel">
        <h3>Hướng dẫn nhanh <span>35 giây · tự lặp lại</span></h3>
        <video src="assets/img/guide-upload.mp4?v=3" autoplay muted loop playsinline></video>
        <ol>
          <li>Đặt tên đề — ví dụ "Đề tuần 3".</li>
          <li>Kéo thả (hoặc bấm chọn) file PDF đề; nếu đề có bài nghe thì thả thêm file MP3.</li>
          <li>${cloud
            ? 'Bấm "Gửi đề" — xong! Đề sẽ nằm trong hàng chờ và được xử lý khi máy cá nhân bật poller.'
            : 'Bấm "Tải lên & xử lý" — app sẽ lưu đề vào máy và bắt đầu xử lý ngay.'}</li>
        </ol>
      </aside>`;
    return `
      <div class="hero"><h1>${cloud ? "Gửi đề mới" : "Tải đề mới lên"}</h1>
        <p class="home-sub">${cloud
          ? "Chọn file đề PDF (kèm audio nếu có bài nghe) rồi gửi vào hàng chờ. Khi máy cá nhân bật poller, đề sẽ được kéo về, số hóa, tạo đáp án + giải thích tiếng Việt và tự cập nhật lên web này."
          : 'Chọn file đề PDF (kèm audio nếu có bài nghe). App sẽ lưu đề vào máy và tự bắt đầu xử lý ngay — Claude tự đọc đề, tạo đáp án + giải thích (~5–15 phút).'}</p>
      </div>
      <div class="upload-wrap has-guide">
      <div class="up-card">
        <div class="up-step">
          <span class="step-n">1</span>
          <div class="up-step-body">
            <label class="up-label">Tên đề</label>
            <input id="up-name" class="up-input" type="text" placeholder="VD: Đề cô Hoa tuần 3" maxlength="60">
            <label class="up-label">Loại đề</label>
            <select id="up-kind" class="up-input">
              <option value="auto">Tự nhận diện (mặc định)</option>
              <option value="reading">Chỉ Reading</option>
              <option value="listening">Chỉ Listening</option>
              <option value="both">Cả Listening + Reading</option>
            </select>
            <label class="up-check" style="display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-weight:500;cursor:pointer;line-height:1.35">
              <input type="checkbox" id="up-multi" style="width:16px;height:16px;flex:none;margin-top:2px">
              <span>📚 File gồm <b>nhiều đề</b> trong 1 (sách 5/10 đề, "RC1000"…) — tự động tách thành từng đề riêng, không gộp chung.</span>
            </label>
          </div>
        </div>
        <div class="up-step">
          <span class="step-n">2</span>
          <div class="up-step-body">
            <label class="up-label">File đề (PDF)</label>
            <div class="dropzone" id="dz-pdf">
              ${ICONS.up}
              <div class="dz-text"><b>Kéo thả file PDF vào đây</b><span>hoặc bấm để chọn — chọn được nhiều file</span></div>
            </div>
            <input id="up-pdf" type="file" accept=".pdf" multiple hidden>
            <div class="file-chips" id="chips-pdf"></div>
          </div>
        </div>
        <div class="up-step">
          <span class="step-n">3</span>
          <div class="up-step-body">
            <label class="up-label">File audio <span class="opt">— chỉ cần nếu đề có bài nghe</span></label>
            <div class="dropzone dz-slim" id="dz-audio">
              ${ICONS.sound}
              <div class="dz-text"><b>Kéo thả file MP3</b><span>hoặc bấm để chọn</span></div>
            </div>
            <input id="up-audio" type="file" accept=".mp3,.m4a,.wav" hidden>
            <div class="file-chips" id="chips-audio"></div>
          </div>
        </div>
        <div id="up-status"></div>
        <div class="up-actions">
          <button id="up-submit" class="btn btn-primary" onclick="App.${cloud ? "submitCloudUpload" : "submitUpload"}()">${cloud ? "Gửi đề" : "Tải lên & xử lý"}</button>
          <button class="btn" onclick="App.goHome()">Huỷ</button>
        </div>
      </div>
      ${guide}
      </div>`;
  }

  function renderChips(inputId, chipsId) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(chipsId);
    if (!input || !box) return;
    box.innerHTML = [...input.files].map((f, i) =>
      `<span class="file-chip">${esc(f.name)} <em>${fmtBytes(f.size)}</em><button type="button" onclick="App.upRemoveFile('${inputId}','${chipsId}',${i})" title="Bỏ file">×</button></span>`).join("");
  }

  function upRemoveFile(inputId, chipsId, idx) {
    const input = document.getElementById(inputId);
    const dt = new DataTransfer();
    [...input.files].forEach((f, i) => { if (i !== idx) dt.items.add(f); });
    input.files = dt.files;
    renderChips(inputId, chipsId);
  }

  function initDropzones() {
    [["dz-pdf", "up-pdf", "chips-pdf"], ["dz-audio", "up-audio", "chips-audio"]].forEach(([dz, inp, chips]) => {
      const zone = document.getElementById(dz);
      const input = document.getElementById(inp);
      if (!zone || !input) return;
      zone.addEventListener("click", () => input.click());
      input.addEventListener("change", () => renderChips(inp, chips));
      ["dragover", "dragenter"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
      ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
      zone.addEventListener("drop", (e) => {
        const ok = (f) => input.accept.split(",").some((ext) => f.name.toLowerCase().endsWith(ext.trim()));
        const dt = new DataTransfer();
        if (input.multiple) [...input.files].forEach((f) => dt.items.add(f));
        for (const f of e.dataTransfer.files) {
          if (!ok(f)) continue;
          if (!input.multiple) { while (dt.items.length) dt.items.remove(0); }
          dt.items.add(f);
        }
        input.files = dt.files;
        renderChips(inp, chips);
      });
    });
  }

  async function goUpload() {
    state.view = "upload";
    document.body.classList.remove("has-mbar");
    screen.classList.remove("wide");
    $("#btn-exit").classList.add("hidden");
    const localApi = await probeApi();
    if (!localApi && !CLOUD_INBOX.url) {
      screen.innerHTML = `
        <div class="hero"><h1>Upload đề mới</h1></div>
        <div class="notice">Bạn đang dùng <b>bản web online</b> — bản này chưa cấu hình hộp thư nhận đề. Hãy upload trên app chạy tại máy.</div>
        <div style="margin-top:14px"><button class="btn btn-primary" onclick="App.goHome()">Về trang chủ</button></div>`;
      window.scrollTo(0, 0);
      return;
    }
    screen.innerHTML = uploadFormHtml(!localApi);
    initDropzones();
    window.scrollTo(0, 0);
  }

  function fileToB64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] || "");
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }

  async function fetchJsonWithRetry(url, options, label) {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(url, options);
        const txt = await r.text();
        let j = {};
        try { j = txt ? JSON.parse(txt) : {}; } catch { j = { error: txt }; }
        if (r.ok && j.ok !== false) return j;
        lastErr = new Error(j.error || `${label} thất bại (HTTP ${r.status})`);
      } catch (e) {
        lastErr = e;
      }
      if (attempt < 3) await wait(1200 * attempt);
    }
    throw lastErr || new Error(label + " thất bại");
  }

  async function submitCloudUpload() {
    const name = $("#up-name").value.trim();
    const kind = $("#up-kind").value;
    const multi = !!($("#up-multi") && $("#up-multi").checked);
    const files = [...$("#up-pdf").files, ...$("#up-audio").files];
    const status = $("#up-status");
    if (!name) { status.textContent = "Hãy đặt tên cho đề."; return; }
    if (!$("#up-pdf").files.length) { status.textContent = "Hãy chọn ít nhất 1 file PDF đề."; return; }
    const btn = $("#up-submit");
    btn.disabled = true;
    const CHUNK = 8 * 1024 * 1024; // chunk nhỏ để GitHub không timeout khi nhận file nghe lớn
    const hdr = { "X-Inbox-Token": CLOUD_INBOX.token };
    try {
      const bj = await fetchJsonWithRetry(CLOUD_INBOX.url + "/begin", {
        method: "POST", headers: { ...hdr, "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, multi, files: files.map((f) => f.name) }),
      }, "Tạo hàng chờ");
      if (!bj.ok) throw new Error(bj.error || "Không tạo được hàng chờ");
      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi];
        const nChunks = Math.max(1, Math.ceil(f.size / CHUNK));
        for (let c = 0; c < nChunks; c++) {
          status.textContent = `Đang gửi ${f.name} — phần ${c + 1}/${nChunks} (file ${fi + 1}/${files.length})…`;
          const b64 = await fileToB64(f.slice(c * CHUNK, (c + 1) * CHUNK));
          const j = await fetchJsonWithRetry(`${CLOUD_INBOX.url}/put?id=${bj.id}&name=${encodeURIComponent(f.name)}&idx=${c}`, {
            method: "POST", headers: hdr, body: b64,
          }, `Gửi ${f.name} phần ${c + 1}`);
          if (!j.ok) throw new Error(j.error || `Gửi ${f.name} thất bại`);
        }
      }
      status.textContent = "Đang hoàn tất…";
      const fin = await fetchJsonWithRetry(`${CLOUD_INBOX.url}/finish?id=${bj.id}`, { method: "POST", headers: hdr }, "Chốt hàng chờ");
      if (!fin.ok) throw new Error("Không chốt được hàng chờ");
      goHome();
      openModal(`<h3>Đã gửi đề vào hàng chờ ✓</h3>
        <p>"${esc(name)}" đã được lưu vào hàng chờ cloud. Khi máy cá nhân bật poller, đề sẽ được kéo về xử lý và web này sẽ tự cập nhật sau khi xử lý xong.</p>
        <p>Bạn có thể tắt điện thoại ngay; file vẫn nằm trong hàng chờ ở mục "Đề mới upload".</p>
        <div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>`);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const hint = /GitHub 403|Timed out validating rule/i.test(msg)
        ? "GitHub bị timeout khi nhận file lớn. App đã tự thử lại 3 lần; hãy bấm Gửi đề lại sau vài phút, hoặc nén PDF/audio nhỏ hơn nếu vẫn lỗi."
        : msg;
      status.textContent = "Lỗi: " + hint;
      btn.disabled = false;
    }
  }

  async function submitUpload() {
    const name = $("#up-name").value.trim();
    const kind = $("#up-kind").value;
    const multi = !!($("#up-multi") && $("#up-multi").checked);
    const pdfs = [...$("#up-pdf").files];
    const audios = [...$("#up-audio").files];
    const status = $("#up-status");
    if (!name) { status.textContent = "Hãy đặt tên cho đề."; return; }
    if (!pdfs.length) { status.textContent = "Hãy chọn ít nhất 1 file PDF đề."; return; }
    const btn = $("#up-submit");
    btn.disabled = true;
    try {
      const all = [...pdfs, ...audios];
      const files = [];
      for (let i = 0; i < all.length; i++) {
        status.textContent = `Đang đọc file ${i + 1}/${all.length}: ${all[i].name}…`;
        files.push({ name: all[i].name, data: await fileToB64(all[i]) });
      }
      status.textContent = "Đang lưu đề vào máy…";
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 120000);
      const r = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind, multi, files }), signal: ctrl.signal });
      clearTimeout(timeout);
      if (!r.ok) { status.textContent = `Server từ chối (HTTP ${r.status}) — bạn có đang chạy app trên máy không?`; btn.disabled = false; return; }
      const j = await r.json();
      if (j.error) { status.textContent = "Lỗi: " + j.error; btn.disabled = false; return; }
      status.textContent = "Đang khởi động Claude xử lý đề…";
      const pr = await fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: j.id }) });
      const pj = await pr.json();
      goHome();
      if (!pr.ok || pj.error) {
        openModal(`<h3>Đã lưu đề, nhưng chưa xử lý được</h3><p>${esc(pj.error || "Không khởi động được Claude Code.")}</p>
        <p>Bạn có thể thử lại bằng nút <b>Thử lại</b> ở mục "Đề mới upload".</p>
        <div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>`);
        return;
      }
      openModal(`<h3>Đã lưu đề và bắt đầu xử lý ✓</h3><p>"${esc(name)}" đang được Claude số hóa trên máy. Khi xong, pipeline sẽ tự ghép dữ liệu, commit/push và web online sẽ cập nhật sau khoảng 1 phút.</p>
        <div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>`);
    } catch (e) {
      status.textContent = "Lỗi khi tải lên: " + e.message;
      btn.disabled = false;
    }
  }

  function startTest(testId, mode) {
    state.session = null;
    state.testId = testId; state.mode = mode; state.keyOnly = false;
    state.answers = {}; state.revealed = {}; state.outcomeLogged = {}; state.finished = false; state.result = null;
    state.startedAt = Date.now();
    state.view = "runner";
    $("#btn-exit").classList.remove("hidden");
    const t = test();
    renderRunner();
    if (t.kind === "listening" && mode === "exam") {
      playSegment(0, null);
    } else if (t.kind === "listening") {
      ensureAudio();
      showDock(true);
    } else if (t.kind === "reading" && mode === "exam") {
      startTimer(t.timerMin * 60);
    }
    window.scrollTo(0, 0);
  }

  /* ---------------- sessions: thi thật & luyện thi tuỳ chọn ---------------- */
  function buildSession(cfg) {
    if (cfg && cfg.wrong) return buildWrongSessionCfg(cfg);
    // cfg: {title, real, sections: [{testId, parts: [..]}], timerMin, mode}
    const parts = [];
    let audioSrc = null, timings = null, hasL = false, hasR = false;
    const descBits = [];
    for (const s of cfg.sections) {
      const src = D.tests[s.testId];
      if (!src) continue;
      const chosen = src.parts.filter((p) => s.parts.includes(p.part));
      const tagged = chosen.map((p) => ({ ...p, sourceTestId: src.id, sourceTitle: src.title }));
      parts.push(...tagged);
      if (chosen.some((p) => p.part <= 4)) {
        hasL = true; audioSrc = src.audioSrc; timings = src.timings;
      }
      if (chosen.some((p) => p.part >= 5)) hasR = true;
      descBits.push(`${src.title}: Part ${chosen.map((p) => p.part).join(", ")}`);
    }
    parts.sort((a, b) => a.part - b.part);
    return {
      id: "session", title: cfg.title,
      desc: descBits.join(" · "),
      kind: hasL && hasR ? "mixed" : hasL ? "listening" : "reading",
      audioSrc, timings, timerMin: cfg.timerMin, parts, sessionCfg: cfg,
    };
  }

  function buildWrongSessionCfg(cfg) {
    const src = D.tests[cfg.testId];
    if (!src) return null;
    const wanted = new Set((cfg.qns || []).map(Number));
    const parts = src.parts.map((p) => {
      const items = [];
      p.items.forEach((it) => {
        const qlist = it.questions || [it];
        const kept = qlist.filter((q) => wanted.has(q.n)).map((q) => ({ ...q, sourceTestId: src.id }));
        if (!kept.length) return;
        if (it.questions) items.push({ ...it, questions: kept });
        else items.push({ ...kept[0] });
      });
      return items.length ? { ...p, sourceTestId: src.id, sourceTitle: src.title, items } : null;
    }).filter(Boolean);
    const hasL = parts.some((p) => p.part <= 4);
    const hasR = parts.some((p) => p.part >= 5);
    const count = parts.reduce((n, p) => n + p.items.reduce((m, it) => m + (it.questions ? it.questions.length : 1), 0), 0);
    const sessionCfg = { wrong: true, testId: cfg.testId, qns: [...wanted].sort((a, b) => a - b), filter: cfg.filter || "active" };
    return {
      id: `wrong-${src.id}`,
      title: `Ôn câu sai — ${groupCardTitle(src.title)}`,
      desc: `${src.title} · ${count} câu cần làm lại · đúng ${WRONG_MASTER_STREAK} lần liên tiếp sẽ tự rời sổ câu sai`,
      kind: hasL && hasR ? "mixed" : hasL ? "listening" : "reading",
      audioSrc: hasL ? src.audioSrc : null,
      timings: hasL ? src.timings : null,
      timerMin: null,
      parts,
      sourceTestId: src.id,
      sessionCfg,
    };
  }

  function audioSpan(t) {
    // playable span covering the selected listening parts
    if (!t.timings) return null;
    const lparts = [...new Set(t.parts.filter((p) => p.part <= 4).map((p) => p.part))];
    if (!lparts.length) return null;
    if (lparts.length === 4) return { start: 0, end: null }; // full test: include intro
    const ranges = lparts.map((n) => t.timings.parts[String(n)]).filter(Boolean);
    if (!ranges.length) return null;
    return { start: Math.min(...ranges.map((r) => r.start)), end: Math.max(...ranges.map((r) => r.end)) };
  }

  function startWrongReview(testId, filter, qn) {
    filter = filter || "active";
    let selected = wrongEntries(filter).filter(({ entry, ref }) => entry.testId === testId && ref);
    if (qn != null) selected = loadWrongBank()
      .filter((entry) => entry.testId === testId && entry.qn === Number(qn))
      .map((entry) => ({ entry, ref: findSourceQuestion(entry.testId, entry.qn) }))
      .filter((x) => x.ref);
    if (!selected.length) {
      openModal('<h3>Chưa có câu để ôn</h3><p>Nhóm này hiện không có câu sai hợp lệ trong dữ liệu đề.</p><div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>');
      return;
    }
    startWrongSession({ wrong: true, testId, filter, qns: selected.map(({ entry }) => entry.qn) });
  }

  function startQuestionPractice(testId, qn) {
    const src = findSourceQuestion(testId, Number(qn));
    if (!src) {
      openModal('<h3>Không mở được câu gốc</h3><p>Câu này không còn trong dữ liệu đề hiện tại.</p><div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>');
      return;
    }
    startWrongSession({ wrong: true, testId, filter: "single", qns: [Number(qn)] });
  }

  function startWrongSession(cfg) {
    state.session = buildWrongSessionCfg(cfg);
    if (!state.session || !state.session.parts.length) { state.session = null; return; }
    state.testId = null;
    state.mode = "practice";
    state.keyOnly = false;
    state.answers = {}; state.revealed = {}; state.outcomeLogged = {};
    state.finished = false; state.result = null;
    state.startedAt = Date.now();
    state.view = "runner";
    stopTimer(); audioEl.pause(); state.segEnd = null;
    $("#btn-exit").classList.remove("hidden");
    renderRunner();
    if (state.session.audioSrc) { ensureAudio(); showDock(true); }
    window.scrollTo(0, 0);
  }

  function startSession(cfg) {
    state.session = buildSession(cfg);
    if (!state.session || !state.session.parts.length) { state.session = null; return; }
    state.testId = null; state.mode = cfg.mode; state.keyOnly = false;
    state.answers = {}; state.revealed = {}; state.outcomeLogged = {}; state.finished = false; state.result = null;
    state.startedAt = Date.now();
    state.view = "runner";
    $("#btn-exit").classList.remove("hidden");
    renderRunner();
    const t = state.session;
    if (t.audioSrc) {
      if (cfg.mode === "exam") {
        const span = audioSpan(t);
        playSegment(span ? span.start : 0, span ? span.end : null);
      } else {
        ensureAudio();
        showDock(true);
      }
    }
    if (cfg.mode === "exam" && cfg.timerMin) {
      startTimer(cfg.timerMin * 60);
    }
    window.scrollTo(0, 0);
  }

  function goRealExam(base) {
    const g = testGroups().find((x) => x.base === base);
    if (!g) return;
    const hasL = g.tests.some((t) => t.kind === "listening");
    const hasR = g.tests.some((t) => t.kind === "reading");
    const tm = realExamTimer(g);
    const what = hasL && hasR
      ? `<b>Listening (chạy theo audio)</b> rồi tiếp tục <b>Reading</b> trong tổng thời gian <b>${tm} phút</b>`
      : hasR ? `<b>Reading</b> trong <b>${tm} phút</b>`
      : `<b>Listening chạy theo audio</b> (hết audio là hết giờ)`;
    openModal(`<h3>Bắt đầu Thi thật — ${esc(g.title)}?</h3>
      <p>Bạn sẽ làm ${what} — đúng luật thi TOEIC:</p>
      <p>• Không tạm dừng, không chỉnh giờ${hasL ? ", không tua audio" : ""}.<br>• Hết giờ hệ thống <b>tự động nộp bài</b> và quy đổi điểm theo thang TOEIC thật${hasL && hasR ? " (10–990)" : " (tối đa 495)"}.</p>
      <div class="modal-actions">
        <button class="btn" onclick="App.closeModal()">Để sau</button>
        <button class="btn btn-primary" onclick="App.closeModal(); App.startRealExam('${base}')">Bắt đầu thi</button>
      </div>`);
  }

  function startRealExam(base) {
    const g = testGroups().find((x) => x.base === base);
    if (!g) return;
    startSession({
      title: `Thi thật — ${g.title}`,
      real: true, mode: "exam", timerMin: realExamTimer(g),
      sections: g.tests.map((t) => ({ testId: t.id, parts: t.parts.map((p) => p.part) })),
    });
  }

  function renderRunner() {
    const t = test();
    const needsSplitView = t.parts.some((p) =>
      p.part >= 6 || ((p.part === 3 || p.part === 4) && p.items.some((it) => it.img && it.questions)));
    screen.classList.toggle("wide", needsSplitView);
    const inReview = state.finished;
    const suffix = state.keyOnly ? "— Đáp án & giải thích"
      : inReview ? "— Xem lại bài" : state.mode === "exam" ? "— Thi thử" : "— Luyện tập";
    const scoreBanner = inReview && state.result && !state.keyOnly
      ? `<div class="review-score">Kết quả: <b>${state.result.correct}/${state.result.total}</b> câu đúng (${Math.round(state.result.pct * 100)}%) · điểm quy đổi ~${state.result.scaled} <button class="btn btn-sm" style="margin-left:8px" onclick="App.showResult()">Bảng điểm</button></div>`
      : "";
    const partsHtml = t.parts.map((p) => renderPart(t, p)).join("");
    const mobileActions = state.finished
      ? `<button class="btn btn-sm" onclick="App.openQnavSheet()">${ICONS.grid}<span>Câu hỏi</span></button>
         <button class="btn btn-sm btn-primary" onclick="App.goHome()">Trang chủ</button>`
      : `<button class="btn btn-sm" onclick="App.openQnavSheet()">${ICONS.grid}<span>Câu hỏi</span></button>
         <button class="btn btn-sm btn-primary" onclick="App.trySubmit()">Nộp bài</button>`;
    screen.innerHTML = `
      <div class="runner-head">
        <div>
          <h2>${esc(t.title)} ${suffix}</h2>
          <div class="sub">${esc(t.desc)}</div>
          ${scoreBanner}
        </div>
      </div>
      <div class="runner-grid">
        <div id="q-list">${partsHtml}</div>
        <div class="side-panel">${renderSidebar(t)}</div>
      </div>
      <div class="mobile-bar" id="mobile-bar">
        <span class="mb-stat" id="mb-stat"></span>
        <div class="mb-actions">${mobileActions}</div>
      </div>
    `;
    document.body.classList.add("has-mbar");
    updateSidebar();
  }

  function qnavCellsHtml(t) {
    return allQuestions(t).map(({ q }) =>
      `<div class="qnav-cell" data-q="${q.n}" onclick="App.jumpTo(${q.n}); App.closeModal();">${qLabel(q)}</div>`).join("");
  }

  function openQnavSheet() {
    const t = test();
    openModal(`<h3 style="margin-bottom:12px">Bảng câu hỏi</h3>
      <div class="qnav-grid sheet-grid">${qnavCellsHtml(t)}</div>
      <div class="modal-actions" style="margin-top:14px">
        <button class="btn" onclick="App.closeModal()">Đóng</button>
        ${state.finished ? "" : '<button class="btn btn-primary" onclick="App.closeModal(); App.trySubmit()">Nộp bài</button>'}
      </div>`);
    updateSidebar(); // paint answered/right/wrong colors onto the sheet cells
  }

  function renderPart(t, p) {
    const dir = p.directions ? `<div class="directions-box"><b>Part ${p.part}.</b> ${esc(p.directions)}</div>` : "";
    const items = p.items.map((it) => renderItem(t, p, it)).join("");
    return `<div class="part-block" id="part-${p.part}">
      <div class="section-label">Part ${p.part}</div>${dir}${items}
    </div>`;
  }

  function segButton(seg, label) {
    if (!seg) return "";
    return `<button class="btn btn-sm play-seg" onclick="App.playSeg(${seg.start},${seg.end})">${ICONS.sound}<span>${label || "Nghe lại đoạn này"}</span></button>`;
  }

  function renderItem(t, p, it) {
    // passage-based item (P6/P7) or listening group (P3/P4) or single question
    if (it.questions) {
      const isListening = p.part <= 4;
      const head = isListening
        ? `<div class="group-head"><span class="gh-label">Câu ${qLabel(it.questions[0])}–${qLabel(it.questions[it.questions.length - 1])}</span>
           ${(state.mode === "practice" || state.finished) ? segButton(it.audio, "Nghe hội thoại") : ""}</div>`
        : "";
      const passage = (it.img || it.text != null) ? renderPassage(it) : "";
      const graphic = it.graphicImg ? `<img class="qgraphic" src="${it.graphicImg}" alt="graphic">` : "";
      const revealed = state.finished || (state.mode === "practice" && (isListening
        ? it.questions.some((q) => state.revealed[q.n])
        : it.questions.every((q) => state.revealed[q.n])));
      const transcript = revealed ? renderTranscriptBox(it, true) : "";
      const qs = it.questions.map((q) => renderQuestion(t, p, q, it)).join("");
      if (passage && (!isListening || p.part === 3 || p.part === 4)) {
        // Reading P6/P7 and listening P3/P4 snapshots stay beside their question group.
        const hint = it.img ? '<div class="zoom-hint">Bấm vào ảnh để phóng to</div>' : "";
        return `<div class="qcard" id="qc-${it.questions[0].n}">
          ${head}
          <div class="passage-split ${isListening ? "listening-split" : ""}">
            <div class="ps-left">${passage}${hint}</div>
            <div class="ps-right">${graphic}${qs}${transcript}</div>
          </div></div>`;
      }
      return `<div class="qcard" id="qc-${it.questions[0].n}">${head}${passage}${graphic}${qs}${transcript}</div>`;
    }
    const soloRevealed = state.finished || state.revealed[it.n];
    const soloExtras = soloRevealed && p.part <= 4 ? renderTranscriptBox(it, true) : "";
    return `<div class="qcard" id="qc-${it.n}">${renderQuestion(t, p, it, null)}${soloExtras}</div>`;
  }

  /* ---------------- transcript box: per-line karaoke + bản dịch + chép chính tả ---------------- */
  function spokenText(it) {
    if (it.transcript) return it.transcript;
    if (!it.spoken) return "";
    const lines = [];
    if (it.spoken.question) lines.push(it.spoken.question);
    Object.entries(it.spoken.choices || {}).forEach(([L, txt]) => { if (txt) lines.push(`(${L}) ${txt}`); });
    return lines.join("\n");
  }

  function renderTranscriptBox(it, withLines) {
    const firstQ = it.questions ? it.questions[0].n : it.n;
    const hasAudio = !!it.audio;
    const dictRef = spokenText(it);
    const body = withLines && it.segs && it.segs.length
      ? `<div class="tl-lines">${it.segs.map((s) =>
          `<div class="tl-line" data-t="${s.t}" onclick="App.seekLine(${s.t}${it.audio ? "," + (it.audio.end || "null") : ""})">${esc(s.text)}</div>`).join("")}</div>`
      : (withLines && it.transcript ? esc(it.transcript) : (withLines && dictRef ? esc(dictRef) : ""));
    const viBtn = it.viText ? `<button class="btn btn-sm" onclick="App.toggleVi(this)">Bản dịch</button>` : "";
    const dictBtn = hasAudio && dictRef ? `<button class="btn btn-sm" onclick="App.openDictation(${firstQ})">Chép chính tả</button>` : "";
    const vi = it.viText ? `<div class="vi-text hidden">${esc(it.viText)}</div>` : "";
    if (!body && !viBtn && !dictBtn) return "";
    return `<div class="transcript-box">
      <div class="t-label">Transcript <span class="t-tools">${viBtn}${dictBtn}</span></div>
      ${body}${vi}
    </div>`;
  }

  function toggleVi(btn) {
    const box = btn.closest(".transcript-box");
    const vi = box && box.querySelector(".vi-text");
    if (vi) {
      vi.classList.toggle("hidden");
      btn.classList.toggle("active", !vi.classList.contains("hidden"));
    }
  }

  function seekLine(t, end) {
    if (strictExam()) return;
    playSegment(t, end || null);
  }

  /* ---------------- dictation (chép chính tả) ---------------- */
  let dictState = null;

  function openDictation(firstQ) {
    const f = findQ(firstQ);
    if (!f) return;
    const it = f.item;
    const ref = spokenText(it);
    if (!ref || !it.audio) return;
    dictState = { ref, audio: it.audio };
    openModal(`<h3>Chép chính tả — Câu ${firstQ}${it.questions && it.questions.length > 1 ? "–" + it.questions[it.questions.length - 1].n : ""}</h3>
      <p style="margin-bottom:10px">Nghe rồi gõ lại những gì bạn nghe được. Không cần viết hoa hay dấu câu. Nghe chậm bằng nút tốc độ ở thanh audio dưới cùng.</p>
      <div style="display:flex; gap:8px; margin-bottom:10px">
        <button class="btn btn-sm" onclick="App.playSeg(${it.audio.start},${it.audio.end || "null"})">${ICONS.sound}<span>Nghe đoạn này</span></button>
        <button class="btn btn-sm" onclick="App.cycleSpeed()">Tốc độ chậm/nhanh</button>
        <button class="btn btn-sm" onclick="App.toggleLoop()">Lặp lại</button>
      </div>
      <textarea id="dict-input" class="dict-input" rows="5" placeholder="Gõ những gì bạn nghe được..."></textarea>
      <div id="dict-result"></div>
      <div class="modal-actions">
        <button class="btn" onclick="App.closeModal()">Đóng</button>
        <button class="btn" onclick="App.dictReveal()">Xem đáp án</button>
        <button class="btn btn-primary" onclick="App.dictCheck()">Kiểm tra</button>
      </div>`, true);
  }

  function normWord(w) {
    return w.toLowerCase().replace(/[^a-z0-9']/g, "");
  }

  function dictCheck() {
    if (!dictState) return;
    const refTokens = dictState.ref.split(/\s+/).filter(Boolean);
    const refNorm = refTokens.map(normWord);
    const typedNorm = ($("#dict-input").value || "").split(/\s+/).map(normWord).filter(Boolean);
    // LCS alignment
    const n = refNorm.length, m = typedNorm.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = refNorm[i] && refNorm[i] === typedNorm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const matched = new Set();
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (refNorm[i] && refNorm[i] === typedNorm[j]) { matched.add(i); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    const contentIdx = refNorm.map((w, k) => (w ? k : -1)).filter((k) => k >= 0);
    const hit = contentIdx.filter((k) => matched.has(k)).length;
    const pct = contentIdx.length ? Math.round((hit / contentIdx.length) * 100) : 0;
    const html = refTokens.map((tok, k) =>
      !refNorm[k] ? esc(tok)
        : `<span class="${matched.has(k) ? "dw-ok" : "dw-miss"}">${esc(tok)}</span>`).join(" ");
    $("#dict-result").innerHTML = `
      <div class="dict-score ${pct >= 80 ? "good" : pct >= 50 ? "mid" : "low"}">Nghe đúng ${hit}/${contentIdx.length} từ (${pct}%) ${pct >= 80 ? "— tuyệt vời!" : pct >= 50 ? "— khá lắm, nghe lại lần nữa nhé." : "— thử nghe chậm 0.5x rồi gõ lại."}</div>
      <div class="dict-diff">${html.replace(/\n/g, "<br>")}</div>
      <div class="dict-legend"><span class="dw-ok">xanh = bạn đã nghe được</span> · <span class="dw-miss">đỏ = bạn bỏ sót/sai</span></div>`;
  }

  function dictReveal() {
    if (!dictState) return;
    $("#dict-result").innerHTML = `<div class="dict-diff">${esc(dictState.ref).replace(/\n/g, "<br>")}</div>`;
  }

  function renderPassage(it) {
    if (it.img) {
      // original or generated passage snapshot; text remains only as data fallback.
      return `<img class="passage-img" src="${it.img}" alt="${esc(it.ptype || "passage")}" loading="lazy">`;
    }
    return `<div class="passage-box missing-snapshot">
      <div class="ptype">Thiếu ảnh snapshot bài đọc</div>
      <div>Đề này cần được xử lý lại để tạo ảnh passage trước khi làm bài.</div>
    </div>`;
  }

  function renderQuestion(t, p, q, parent) {
    const reveal = state.finished || state.revealed[q.n];
    const user = state.answers[q.n];
    const letters = Object.keys(q.choices || {}).filter((L) => q.choices[L] != null);
    const choices = letters.map((L) => {
      let cls = "choice";
      if (!reveal) { if (user === L) cls += " selected"; }
      else {
        if (L === q.answer) cls += " correct";
        else if (user === L) cls += " wrong";
        else cls += " dim";
      }
      const spokenChoice = q.spoken && q.spoken.choices && q.spoken.choices[L];
      const label = q.choices[L]
        ? esc(q.choices[L])
        : reveal && spokenChoice
          ? esc(spokenChoice)
          : "<i style='color:var(--muted)'>(nghe audio)</i>";
      return `<div class="${cls}" onclick="App.pick(${q.n},'${L}')"><span class="letter">${L}</span><span>${label}</span></div>`;
    }).join("");

    const photo = q.image ? `<img class="qphoto" src="${q.image}" alt="Câu ${qLabel(q)}">` : "";
    const segBtn = (state.mode === "practice" || state.finished) && q.audio && !parent
      ? segButton(q.audio, "Nghe câu này") : "";

    let feedback = "";
    if (reveal) {
      const ok = user === q.answer;
      feedback = `<div class="explain ${ok ? "" : "was-wrong"}">
        <div class="ans-line">${ok ? "Chính xác" : user ? "Chưa đúng — bạn chọn " + user + ", đáp án: " + q.answer : "Đáp án đúng: " + q.answer}
        ${q.uncertain ? ' <span class="uncertain-flag">đáp án chưa chắc chắn 100%</span>' : ""}</div>
        ${q.explanation ? esc(q.explanation) : ""}
      </div>`;
    }
    const checkBtn = state.mode === "practice" && !reveal && user
      ? `<button class="btn btn-sm" style="margin-top:10px" onclick="App.check(${q.n})">Kiểm tra đáp án</button>` : "";

    return `<div class="q-block" data-q="${q.n}" style="margin-bottom:14px">
      <div class="qtext"><span class="qnum">${qLabel(q)}.</span>${q.question ? esc(q.question) : p.part <= 2 ? "<i style='color:var(--muted)'>Nghe audio và chọn đáp án</i>" : ""}</div>
      ${photo}${segBtn}
      <div class="choices">${choices}</div>
      ${checkBtn}${feedback}
    </div>`;
  }

  function renderSidebar(t) {
    const qs = allQuestions(t);
    const cells = qs.map(({ q }) => `<div class="qnav-cell" data-q="${q.n}" onclick="App.jumpTo(${q.n})">${qLabel(q)}</div>`).join("");
    const action = state.finished
      ? (state.keyOnly
        ? `<button class="btn btn-primary" onclick="App.goHome()">Về trang chủ</button>`
        : `<button class="btn" onclick="App.exportAnswers()">Xuất phiếu đáp án</button>
           <button class="btn btn-primary" onclick="App.goHome()">Về trang chủ</button>`)
      : `<button class="btn btn-primary" onclick="App.trySubmit()">Nộp bài</button>
         <button class="btn" onclick="App.goHome()">Huỷ</button>`;
    return `<div class="qnav">
      <div class="label">Bảng câu hỏi</div>
      <div class="qnav-grid">${cells}</div>
      <div class="side-actions">${action}</div>
      <div class="side-stat" id="side-stat"></div>
    </div>`;
  }

  function updateSidebar() {
    const t = test();
    const qs = allQuestions(t);
    let answered = 0;
    qs.forEach(({ q }) => {
      const user = state.answers[q.n];
      // paint every rendered copy of this cell (side panel + mobile sheet)
      document.querySelectorAll(`.qnav-cell[data-q="${q.n}"]`).forEach((cell) => {
        cell.className = "qnav-cell";
        if (state.finished || state.revealed[q.n]) {
          if (user === q.answer) cell.classList.add("right");
          else if (user) cell.classList.add("wrongc");
        } else if (user) cell.classList.add("answered");
      });
      if (user) answered++;
    });
    const statText = state.keyOnly ? "Chế độ xem đáp án đề"
      : state.finished && state.result ? `Đúng ${state.result.correct}/${state.result.total}`
      : `Đã trả lời ${answered}/${qs.length}`;
    const st = $("#side-stat");
    if (st) st.textContent = statText;
    const mb = $("#mb-stat");
    if (mb) mb.textContent = statText;
  }

  /* ---------------- interactions ---------------- */
  function pick(qn, L) {
    if (state.finished || state.revealed[qn]) return;
    state.answers[qn] = L;
    if (state.mode === "practice") {
      rerenderBlock(qn); // shows the "check answer" button
    } else {
      const block = document.querySelector(`.q-block[data-q="${qn}"]`);
      if (block) {
        const f = findQ(qn);
        const letters = Object.keys(f.q.choices).filter((k) => f.q.choices[k] != null);
        block.querySelectorAll(".choice").forEach((c, i) => c.classList.toggle("selected", letters[i] === L));
      }
    }
    updateSidebar();
  }

  function findQ(qn) {
    const t = test();
    for (const p of t.parts) {
      for (const it of p.items) {
        if (it.questions) { for (const q of it.questions) if (q.n === qn) return { q, p, item: it }; }
        else if (it.n === qn) return { q: it, p, item: it };
      }
    }
    return null;
  }

  function rerenderBlock(qn) {
    const f = findQ(qn);
    if (!f) return;
    // re-render the whole qcard containing this question
    const rootN = f.item.questions ? f.item.questions[0].n : f.q.n;
    const card = document.getElementById("qc-" + rootN);
    if (card) {
      const tmp = document.createElement("div");
      tmp.innerHTML = renderItem(test(), f.p, f.item);
      card.replaceWith(tmp.firstElementChild);
    }
    updateSidebar();
  }

  function check(qn) {
    if (state.revealed[qn]) return;
    recordQuestionOutcome(qn);
    state.revealed[qn] = true;
    rerenderBlock(qn);
  }

  function jumpTo(qn) {
    const f = findQ(qn);
    if (!f) return;
    const rootN = f.item.questions ? f.item.questions[0].n : qn;
    const el = document.getElementById("qc-" + rootN);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function trySubmit() {
    const t = test();
    const total = allQuestions(t).length;
    const answered = Object.keys(state.answers).length;
    openModal(`<h3>Nộp bài?</h3>
      <p>Bạn đã trả lời <b>${answered}/${total}</b> câu.${answered < total ? " Các câu bỏ trống sẽ tính là sai." : ""}</p>
      <div class="modal-actions">
        <button class="btn" onclick="App.closeModal()">Làm tiếp</button>
        <button class="btn btn-primary" onclick="App.closeModal(); App.submit()">Nộp bài</button>
      </div>`);
  }

  function submit(auto) {
    stopTimer(); audioEl.pause(); state.segEnd = null; showDock(false);
    const t = test();
    const qs = allQuestions(t);
    let correct = 0;
    qs.forEach(({ q }) => { if (state.answers[q.n] === q.answer) correct++; });
    const total = qs.length;
    const pct = correct / total;
    // quy đổi theo bảng điểm TOEIC chuẩn: từng section riêng, tổng 10-990 nếu có cả hai
    const sec = computeSections(t);
    const scaled = (sec.listening.scaled || 0) + (sec.reading.scaled || 0);
    const scaleMax = (sec.listening.t ? 495 : 0) + (sec.reading.t ? 495 : 0);
    const durationSec = Math.round((Date.now() - state.startedAt) / 1000);
    state.result = { correct, total, pct, scaled, scaleMax, sections: sec, durationSec };
    qs.forEach(({ q }) => recordQuestionOutcome(q.n));
    state.finished = true;
    const attemptDate = Date.now();
    saveAttempt({
      testId: state.session ? "session" : t.id,
      title: t.title,
      session: state.session ? state.session.sessionCfg : undefined,
      mode: state.mode, correct, total, scaled, scaleMax,
      date: attemptDate, durationSec,
      answers: { ...state.answers },
    });
    markHistoryImported(attemptDate);
    renderResult(auto);
    window.scrollTo(0, 0);
  }

  function renderResult(auto) {
    const t = test();
    screen.classList.remove("wide");
    document.body.classList.remove("has-mbar");
    const r = state.result;
    const wstats = wrongStats();
    // per-part breakdown
    const rows = t.parts.map((p) => {
      let c = 0, tot = 0;
      p.items.forEach((it) => {
        const qlist = it.questions || [it];
        qlist.forEach((q) => { tot++; if (state.answers[q.n] === q.answer) c++; });
      });
      return `<div class="stat-box"><div class="v">${c}/${tot}</div><div class="k">Part ${p.part}</div></div>`;
    }).join("");
    const sec = r.sections;
    let scoreLine;
    if (sec && sec.listening.t && sec.reading.t) {
      scoreLine = `Điểm TOEIC quy đổi: <b style="font-size:22px">~${r.scaled}/990</b>
        &nbsp;·&nbsp; Listening ${sec.listening.c}/${sec.listening.t} → ~${sec.listening.scaled}
        &nbsp;·&nbsp; Reading ${sec.reading.c}/${sec.reading.t} → ~${sec.reading.scaled}`;
    } else if (sec && (sec.listening.t || sec.reading.t)) {
      const s = sec.listening.t ? sec.listening : sec.reading;
      scoreLine = `Điểm quy đổi thang TOEIC (${sec.listening.t ? "Listening" : "Reading"}, tối đa 495): <b style="font-size:22px">~${s.scaled}</b>`;
    } else {
      scoreLine = `Điểm quy đổi ước tính: <b>~${r.scaled}</b>`;
    }
    const partialNote = (sec && ((sec.reading.t && sec.reading.t < 100) || (sec.listening.t && sec.listening.t < 100)))
      ? '<div class="sub" style="margin-top:4px">Phần làm không đủ 100 câu/section nên điểm được quy đổi theo tỷ lệ — mang tính ước lượng.</div>' : "";
    screen.innerHTML = `
      ${auto ? '<div class="notice">Hết giờ — bài đã tự động nộp.</div>' : ""}
      <div class="result-hero">
        <h2>${esc(t.title)}</h2>
        <div class="big">${r.correct}/${r.total} <span style="font-size:20px;font-weight:600">câu đúng (${Math.round(r.pct * 100)}%)</span></div>
        <div class="sub">${scoreLine}</div>
        ${partialNote}
      </div>
      <div class="result-stats">${rows}
        <div class="stat-box"><div class="v">${fmtTime(r.durationSec || 0)}</div><div class="k">Thời gian làm</div></div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn btn-primary" onclick="App.reviewAnswers()">Xem lại từng câu + giải thích</button>
        <button class="btn" onclick="App.exportAnswers()">Xuất phiếu đáp án</button>
        <button class="btn" onclick="${state.session ? "App.restartSession()" : `App.startTest('${t.id}','${state.mode}')`}">Làm lại</button>
        ${wstats.active ? `<button class="btn" onclick="App.goWrong('${wstats.due ? "due" : "active"}')">Ôn câu sai (${wstats.active})</button>` : ""}
        <button class="btn" onclick="App.goHome()">Trang chủ</button>
      </div>
    `;
  }

  /* ---------------- practice setup screen ---------------- */
  function goPracticeSetup(base) {
    state.view = "setup";
    document.body.classList.remove("has-mbar");
    screen.classList.remove("wide");
    $("#btn-exit").classList.add("hidden");
    const g = base ? testGroups().find((x) => x.base === base) : null;
    const tests = g ? g.tests : Object.values(D.tests);
    const rows = tests.map((t) => {
      const partNums = t.parts.map((p) => p.part);
      const boxes = partNums.map((n) =>
        `<label class="part-check"><input type="checkbox" data-test="${t.id}" data-kind="${t.kind}" value="${n}" checked onchange="App.setupPartChanged(this)"> P${n}</label>`).join("");
      return `<div class="setup-test">
        <div class="st-title">${esc(t.title)} ${t.kind === "listening" ? '<span class="tag tag-listen">Listening</span>' : '<span class="tag tag-read">Reading</span>'}</div>
        <div class="st-parts">${boxes}</div>
      </div>`;
    }).join("");
    screen.innerHTML = `
      <div class="hero"><h1>Luyện thi${g ? " — " + esc(g.title) : " tuỳ chọn"}</h1>
        <p>Chọn phần muốn luyện (Listening/Reading chung hoặc riêng, từng part tuỳ ý — bỏ tick phần không muốn làm), chọn thời gian — điểm vẫn quy đổi theo thang TOEIC thật.</p>
      </div>
      <div class="test-card" style="max-width:680px">
        <label class="up-label">Bước 1 · Chọn part muốn luyện <span style="color:var(--red)">*</span> <span style="font-weight:400;color:var(--muted)">(mỗi kỹ năng chỉ chọn từ 1 đề)</span></label>
        ${rows}
        <label class="up-label">Bước 2 · Thời gian làm bài</label>
        <div class="time-chips">
          <button type="button" class="tchip selected" data-val="standard" id="chip-standard" onclick="App.pickTimeChip(this)">Chuẩn TOEIC</button>
          <button type="button" class="tchip" data-val="none" onclick="App.pickTimeChip(this)">Không giới hạn</button>
          <button type="button" class="tchip" data-val="15" onclick="App.pickTimeChip(this)">15′</button>
          <button type="button" class="tchip" data-val="30" onclick="App.pickTimeChip(this)">30′</button>
          <button type="button" class="tchip" data-val="45" onclick="App.pickTimeChip(this)">45′</button>
          <button type="button" class="tchip" data-val="60" onclick="App.pickTimeChip(this)">60′</button>
          <button type="button" class="tchip" data-val="90" onclick="App.pickTimeChip(this)">90′</button>
          <button type="button" class="tchip" data-val="custom" onclick="App.pickTimeChip(this)">Tuỳ chỉnh…</button>
        </div>
        <div class="custom-time" id="custom-time" style="display:none">
          <button type="button" class="btn btn-round" onclick="App.bumpCustomTime(-5)">−</button>
          <input id="su-custom" type="number" min="5" max="240" value="30" step="5">
          <span class="ct-unit">phút</span>
          <button type="button" class="btn btn-round" onclick="App.bumpCustomTime(5)">+</button>
        </div>
        <div class="time-hint" id="time-hint"></div>
        <label class="up-label">Bước 3 · Chế độ</label>
        <select id="su-mode" class="up-input">
          <option value="exam">Làm bài — chấm điểm khi nộp</option>
          <option value="practice">Luyện từng câu — xem đáp án + giải thích ngay</option>
        </select>
        <div class="actions">
          <button class="btn btn-primary" onclick="App.startCustomSession()">Bắt đầu luyện</button>
          <button class="btn" onclick="App.goHome()">Huỷ</button>
        </div>
      </div>`;
    refreshTimeUI();
    window.scrollTo(0, 0);
  }

  function setupPartChanged(box) {
    // one source test per skill: checking a part unchecks other tests of the same kind
    if (box.checked) {
      document.querySelectorAll(`input[data-kind="${box.dataset.kind}"]`).forEach((el) => {
        if (el.dataset.test !== box.dataset.test) el.checked = false;
      });
    }
    refreshTimeUI();
  }

  function checkedSections() {
    const byTest = {};
    [...document.querySelectorAll(".part-check input:checked")].forEach((el) =>
      (byTest[el.dataset.test] = byTest[el.dataset.test] || []).push(Number(el.value)));
    return Object.entries(byTest).map(([testId, parts]) => ({ testId, parts: parts.sort((a, b) => a - b) }));
  }

  function standardMinutes(sections) {
    // chuẩn TOEIC: 45 giây/câu Reading + thời lượng audio phần nghe đã chọn
    if (!sections.length) return null;
    const probe = buildSession({ title: "", sections, timerMin: null, mode: "exam" });
    if (!probe || !probe.parts.length) return null;
    const readingQ = allQuestions(probe).filter((x) => x.part >= 5).length;
    const span = audioSpan(probe);
    const listenMin = span ? ((span.end || 2740) - span.start) / 60 : 0;
    const total = Math.round((readingQ * 0.75 + listenMin) / 5) * 5;
    return total >= 5 ? total : 5;
  }

  function selectedTimeChip() {
    const el = document.querySelector(".tchip.selected");
    return el ? el.dataset.val : "standard";
  }

  function refreshTimeUI() {
    const chipStd = $("#chip-standard");
    if (!chipStd) return;
    const std = standardMinutes(checkedSections());
    chipStd.textContent = std ? `Chuẩn TOEIC · ${std}′` : "Chuẩn TOEIC";
    const hint = $("#time-hint");
    const val = selectedTimeChip();
    if (val === "standard") {
      hint.textContent = std
        ? `Tự tính theo phần đã chọn: ${std} phút (45 giây/câu Reading + thời lượng audio phần nghe). Hết giờ tự nộp bài.`
        : "Hãy chọn part trước — thời gian chuẩn sẽ được tự tính.";
    } else if (val === "none") {
      hint.textContent = "Không có đồng hồ — làm thoải mái, tự bấm nộp khi xong.";
    } else if (val === "custom") {
      hint.textContent = "Chỉnh số phút bằng nút − / + (bước 5 phút). Hết giờ tự nộp bài.";
    } else {
      hint.textContent = `Đồng hồ đếm ngược ${val} phút, hết giờ tự động nộp bài.`;
    }
  }

  function pickTimeChip(el) {
    document.querySelectorAll(".tchip").forEach((c) => c.classList.remove("selected"));
    el.classList.add("selected");
    $("#custom-time").style.display = el.dataset.val === "custom" ? "flex" : "none";
    refreshTimeUI();
  }

  function bumpCustomTime(d) {
    const inp = $("#su-custom");
    inp.value = Math.max(5, Math.min(240, (parseInt(inp.value, 10) || 30) + d));
  }

  function startCustomSession() {
    const sections = checkedSections();
    if (!sections.length) {
      openModal('<h3>Chưa chọn phần luyện</h3><p>Hãy tick ít nhất một part.</p><div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>');
      return;
    }
    const mode = $("#su-mode").value;
    const timeSel = selectedTimeChip();
    let timerMin = null;
    if (timeSel === "standard") {
      timerMin = standardMinutes(sections);
    } else if (timeSel === "custom") {
      timerMin = Math.max(5, Math.min(240, parseInt($("#su-custom").value, 10) || 30));
    } else if (timeSel !== "none") {
      timerMin = parseInt(timeSel, 10);
    }
    const parts = sections.flatMap((s) => s.parts);
    startSession({
      title: "Luyện thi — Part " + [...new Set(parts)].sort((a, b) => a - b).join(", "),
      mode, timerMin: mode === "exam" ? timerMin : null,
      sections,
    });
  }

  /* ---------------- export answers ---------------- */
  function answerSheetText() {
    const t = test();
    const qs = allQuestions(t);
    const answered = qs.filter(({ q }) => state.answers[q.n]).length;
    const lines = [];
    lines.push("BẢNG ĐÁP ÁN ĐÃ CHỌN — " + t.title.toUpperCase());
    lines.push("Ngày làm: " + new Date(state.startedAt || Date.now()).toLocaleString("vi-VN"));
    lines.push(`Đã trả lời: ${answered}/${qs.length} câu (— = bỏ trống)`);
    t.parts.forEach((p) => {
      lines.push("");
      lines.push(`--- Part ${p.part} ---`);
      const nums = [];
      p.items.forEach((it) => (it.questions || [it]).forEach((q) => nums.push(q.n)));
      // 5 answers per line for compact printing
      for (let i = 0; i < nums.length; i += 5) {
        lines.push(nums.slice(i, i + 5)
          .map((n) => `${String(n).padStart(3)}. ${state.answers[n] || "—"}`)
          .join("    "));
      }
    });
    return lines.join("\n") + "\n";
  }

  function buildAnswerSheetCanvas() {
    // Phiếu đáp án kiểu bubble sheet TOEIC: tô đen đáp án đã chọn
    const t = test();
    const present = new Set(allQuestions(t).map((x) => x.q.n));
    const hasL = [...present].some((n) => n <= 100);
    const hasR = [...present].some((n) => n > 100);

    const SCALE = 2;
    const COL_W = 262, ROW_H = 31, COLS = 4, ROWS = 25;
    const SEC_W = COL_W * COLS;
    const M = 46;
    const secH = 64 + ROWS * ROW_H + 18;
    const headH = 118;
    const W = SEC_W + M * 2;
    const H = headH + (hasL ? secH : 0) + (hasR ? secH : 0) + 70;

    const cv = document.createElement("canvas");
    cv.width = W * SCALE; cv.height = H * SCALE;
    const c = cv.getContext("2d");
    c.scale(SCALE, SCALE);
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
    const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

    c.fillStyle = "#111827";
    c.font = "800 26px " + FONT;
    c.fillText("PHIẾU ĐÁP ÁN — " + t.title, M, 46);
    c.font = "400 15px " + FONT;
    c.fillStyle = "#4b5563";
    const answered = allQuestions(t).filter((x) => state.answers[x.q.n]).length;
    c.fillText("Ngày làm: " + new Date(state.startedAt || Date.now()).toLocaleString("vi-VN")
      + "   ·   Đã trả lời: " + answered + "/" + present.size + " câu   ·   TOEIC Practice", M, 74);
    c.strokeStyle = "#111827"; c.lineWidth = 2;
    c.strokeRect(M - 14, 20, SEC_W + 28, H - 40);

    function drawSection(title, startN, topY) {
      c.fillStyle = "#111827";
      c.fillRect(M, topY, SEC_W, 34);
      c.fillStyle = "#ffffff";
      c.font = "800 16px " + FONT;
      const tw = c.measureText(title).width;
      c.fillText(title, M + (SEC_W - tw) / 2, topY + 23);
      const gridY = topY + 46;
      for (let col = 0; col < COLS; col++) {
        const x0 = M + col * COL_W;
        if (col % 2 === 1) {
          c.fillStyle = "#eef1f6";
          c.fillRect(x0, gridY - 8, COL_W, ROWS * ROW_H + 12);
        }
        for (let row = 0; row < ROWS; row++) {
          const n = startN + col * ROWS + row;
          const y = gridY + row * ROW_H + 14;
          const inTest = present.has(n);
          const user = state.answers[n];
          c.font = "700 13.5px " + FONT;
          c.fillStyle = inTest ? "#111827" : "#c3c9d6";
          const numStr = String(n);
          c.fillText(numStr, x0 + 34 - c.measureText(numStr).width, y + 5);
          ["A", "B", "C", "D"].forEach((L, i) => {
            const bx = x0 + 56 + i * 47;
            const picked = user === L;
            c.beginPath();
            c.arc(bx, y, 9.5, 0, Math.PI * 2);
            if (picked) {
              c.fillStyle = "#111827"; c.fill();
            }
            c.lineWidth = 1.4;
            c.strokeStyle = inTest ? "#3b4256" : "#d5dae4";
            c.stroke();
            c.font = "700 10.5px " + FONT;
            c.fillStyle = picked ? "#ffffff" : (inTest ? "#3b4256" : "#d5dae4");
            c.fillText(L, bx - 3.8, y + 3.8);
          });
        }
      }
      return topY + secH;
    }

    let y = headH;
    if (hasL) y = drawSection("LISTENING SECTION (1–100)", 1, y);
    if (hasR) y = drawSection("READING SECTION (101–200)", 101, y);
    c.font = "400 12.5px " + FONT;
    c.fillStyle = "#9aa2b3";
    c.fillText("Ô mờ = câu không có trong phần đã làm · Ô tô đen = đáp án đã chọn", M, H - 26);
    return cv;
  }

  function exportAnswers() {
    const t = test();
    const d = new Date(state.startedAt || Date.now());
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0")
      + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
    const cv = buildAnswerSheetCanvas();
    cv.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `phieu-dap-an-${t.id}-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  function reviewAnswers() {
    renderRunner();
    if (test().audioSrc) showDock(true);
    window.scrollTo(0, 0);
  }

  function restartSession() {
    if (!state.session || !state.session.sessionCfg) return;
    if (state.session.sessionCfg.wrong) startWrongSession(state.session.sessionCfg);
    else startSession(state.session.sessionCfg);
  }

  function openHistory(date) {
    const h = loadHistory().find((x) => x.date === date);
    if (!h) return;
    if (h.session) {
      state.session = buildSession(h.session);
      if (!state.session || !state.session.parts.length) { state.session = null; return; }
      state.testId = null;
    } else {
      if (!D.tests[h.testId]) return;
      if (!h.answers) { renderLegacyDetail(h); return; }
      state.session = null;
      state.testId = h.testId;
    }
    if (!h.answers) return;
    stopTimer(); audioEl.pause(); state.segEnd = null;
    state.view = "runner";
    state.mode = h.mode;
    state.keyOnly = false;
    state.answers = { ...h.answers };
    state.revealed = {};
    state.outcomeLogged = {};
    state.finished = true;
    state.startedAt = h.date;
    const t = test();
    const qs = allQuestions(t);
    let correct = 0;
    qs.forEach(({ q }) => { if (state.answers[q.n] === q.answer) correct++; });
    const total = qs.length, pct = correct / total;
    const sec = computeSections(t);
    state.result = {
      correct, total, pct, sections: sec,
      scaled: h.scaled != null ? h.scaled : (sec.listening.scaled || 0) + (sec.reading.scaled || 0),
      scaleMax: (sec.listening.t ? 495 : 0) + (sec.reading.t ? 495 : 0),
      durationSec: h.durationSec || 0,
    };
    $("#btn-exit").classList.remove("hidden");
    reviewAnswers(); // go straight to the per-question review (user answer vs correct + explanation)
  }

  function showResult() {
    if (state.result) { renderResult(); window.scrollTo(0, 0); }
  }

  function openKeyView(testId) {
    if (!D.tests[testId]) return;
    stopTimer(); audioEl.pause(); state.segEnd = null;
    state.view = "runner";
    state.session = null;
    state.testId = testId;
    state.mode = "practice";
    state.keyOnly = true;
    state.answers = {};
    state.revealed = {};
    state.outcomeLogged = {};
    state.finished = true;
    state.result = null;
    state.startedAt = Date.now();
    $("#btn-exit").classList.remove("hidden");
    reviewAnswers();
  }

  function renderLegacyDetail(h) {
    const t = D.tests[h.testId];
    stopTimer(); audioEl.pause(); showDock(false);
    state.view = "home"; state.testId = null; state.finished = false;
    $("#btn-exit").classList.add("hidden");
    screen.innerHTML = `
      <div class="result-hero">
        <h2>${esc(t.title)} — ${h.mode === "exam" ? "Thi thử" : "Luyện tập"}</h2>
        <div class="big">${h.correct}/${h.total} <span style="font-size:20px;font-weight:600">câu đúng (${Math.round((h.correct / h.total) * 100)}%)</span></div>
        <div class="sub">Làm lúc ${new Date(h.date).toLocaleString("vi-VN")}</div>
      </div>
      <div class="result-stats">
        <div class="stat-box"><div class="v">~${h.scaled != null ? h.scaled : "?"}</div><div class="k">Điểm quy đổi ước tính</div></div>
        <div class="stat-box"><div class="v">${fmtTime(h.durationSec || 0)}</div><div class="k">Thời gian làm</div></div>
      </div>
      <div class="notice">Bài này được làm trước khi app có tính năng lưu đáp án từng câu, nên các đáp án bạn đã chọn hôm đó không còn dữ liệu để hiển thị. Bạn vẫn có thể xem toàn bộ đáp án đúng + giải thích của đề bằng nút bên dưới. Các bài làm mới sẽ luôn xem lại đầy đủ được.</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap">
        <button class="btn btn-primary" onclick="App.openKeyView('${t.id}')">Xem đáp án + giải thích của đề</button>
        <button class="btn" onclick="App.startTest('${t.id}','${h.mode}')">Làm lại đề này</button>
        <button class="btn" onclick="App.goHome()">Trang chủ</button>
      </div>
    `;
    window.scrollTo(0, 0);
  }

  /* ---------------- modal ---------------- */
  function openModal(html, wide) {
    $("#modal").innerHTML = html;
    $("#modal").classList.toggle("wide", !!wide);
    $("#modal-backdrop").classList.remove("hidden");
  }
  function closeModal(e) {
    if (e && e.target !== $("#modal-backdrop")) return;
    $("#modal-backdrop").classList.add("hidden");
  }
  function confirmExit() {
    if (state.finished) { goHome(); return; }
    openModal(`<h3>Thoát bài làm?</h3><p>Tiến độ bài đang làm sẽ không được lưu.</p>
      <div class="modal-actions">
        <button class="btn" onclick="App.closeModal()">Ở lại</button>
        <button class="btn btn-primary" onclick="App.closeModal(); App.goHome()">Thoát</button>
      </div>`);
  }

  /* ---------------- public API ---------------- */
  window.App = {
    goHome, goWrong, goSimilarDrill, goProfileDrill, pickSimilar, exportWrongBank, openWrongImport, importWrongBankText, startWrongReview, startQuestionPractice, openWrongDrill, openWrongDictation, playWrongAudio, markWrongMastered, startTest, pick, check, jumpTo, trySubmit, submit, reviewAnswers,
    exportAnswers, answerSheetText, buildAnswerSheetCanvas, openHistory, openKeyView, showResult,
    goUpload, submitUpload, submitCloudUpload, retryCloudUpload, processUpload, openQnavSheet, upRemoveFile,
    goRealExam, startRealExam, goPracticeSetup, startCustomSession, setupPartChanged, restartSession,
    pickTimeChip, bumpCustomTime,
    cycleSpeed, toggleLoop, seekLine, toggleVi, openDictation, dictCheck, dictReveal,
    goVocab, startFlashcards, fcFlip, fcAnswer,
    audioToggle, confirmExit,
    playSeg: (s, e) => playSegment(s, e),
    closeModal: (e) => { $("#modal-backdrop").classList.add("hidden"); },
  };

  // click any exam image (passage/photo/graphic) to zoom in a lightbox
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".passage-img, .qphoto, .qgraphic");
    if (img) {
      const lb = document.createElement("div");
      lb.className = "lightbox";
      lb.innerHTML = `<img src="${img.src}" alt="zoom">`;
      lb.addEventListener("click", () => lb.remove());
      document.body.appendChild(lb);
    }
  });

  initDock();
  goHome();
})();
