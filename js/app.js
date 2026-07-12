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
  };

  /* ---------------- storage ---------------- */
  const LS_KEY = "toeic-practice-history-v1";
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
  }
  function saveAttempt(a) {
    const h = loadHistory(); h.unshift(a);
    localStorage.setItem(LS_KEY, JSON.stringify(h.slice(0, 50)));
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
      p.items.forEach((it) => {
        if (it.questions) it.questions.forEach((q) => out.push({ q, part: p.part, item: it }));
        else out.push({ q: it, part: p.part, item: it });
      });
    });
    return out;
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

  function testGroups() {
    // gộp các section cùng một đề (m5-listening + m5-reading → "Mock Test 5")
    const groups = {};
    Object.values(D.tests).forEach((t) => {
      const base = t.id.replace(/-(listening|reading)$/, "");
      if (!groups[base]) {
        groups[base] = { base, title: t.title.split(" — ")[0], custom: !!t.custom, tests: [] };
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

  function renderHome() {
    const hist = loadHistory();
    const vocab = D.vocab || [];
    const srs = vocabSrs();
    const learned = vocab.filter((v) => srs[v.id] && srs[v.id].lv >= 3).length;
    const due = vocabDue().length;
    const groups = testGroups();
    const last = hist.find((h) => h.scaled != null);
    const totalQ = Object.values(D.tests).reduce((n, t) => n + allQuestions(t).length, 0);

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
      </div>

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
      const rows = uploads.map((u) => `<tr>
        <td><b>${esc(u.name)}</b><div style="font-size:12px;color:var(--muted)">${(u.files || []).map(esc).join(", ")}</div></td>
        <td>${CLOUD_STATUS[u.status] || esc(u.status || "")}</td>
        <td>${u.uploadedAt ? new Date(u.uploadedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : ""}</td>
      </tr>`).join("");
      area.innerHTML = `<div class="table-scroll"><table class="history-table"><thead><tr><th>Đề</th><th>Trạng thái</th><th>Lúc gửi</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      clearTimeout(inboxTimer);
      if (uploads.some((u) => ["pending", "processing", "uploading"].includes(u.status)) && state.view === "home") {
        inboxTimer = setTimeout(() => { const a = $("#inbox-area"); if (a) renderCloudInbox(a); }, 30000);
      }
    } catch {
      area.innerHTML = '<div class="history-empty">Không kết nối được hộp thư đề — thử lại sau.</div>';
    }
  }

  function fmtBytes(n) {
    if (n > 1e6) return (n / 1e6).toFixed(1) + " MB";
    if (n > 1e3) return Math.round(n / 1e3) + " KB";
    return n + " B";
  }

  function uploadFormHtml(cloud) {
    const guide = cloud ? `
      <aside class="guide-panel">
        <h3>Hướng dẫn nhanh <span>35 giây · tự lặp lại</span></h3>
        <video src="assets/img/guide-upload.mp4?v=3" autoplay muted loop playsinline></video>
        <ol>
          <li>Đặt tên đề — ví dụ "Đề tuần 3".</li>
          <li>Kéo thả (hoặc bấm chọn) file PDF đề; nếu đề có bài nghe thì thả thêm file MP3.</li>
          <li>Bấm "Gửi đề" — xong! Đề sẽ nằm trong hàng chờ và được xử lý khi máy cá nhân bật poller.</li>
        </ol>
      </aside>` : "";
    return `
      <div class="hero"><h1>${cloud ? "Gửi đề mới" : "Tải đề mới lên"}</h1>
        <p class="home-sub">${cloud
          ? "Chọn file đề PDF (kèm audio nếu có bài nghe) rồi gửi vào hàng chờ. Khi máy cá nhân bật poller, đề sẽ được kéo về, số hóa, tạo đáp án + giải thích tiếng Việt và tự cập nhật lên web này."
          : 'Chọn file đề PDF (kèm audio nếu có bài nghe). App sẽ lưu đề vào máy và tự bắt đầu xử lý ngay — Claude tự đọc đề, tạo đáp án + giải thích (~5–15 phút).'}</p>
      </div>
      <div class="upload-wrap${cloud ? " has-guide" : ""}">
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
    const CHUNK = 30 * 1024 * 1024; // 30MB nhị phân/chunk
    const hdr = { "X-Inbox-Token": CLOUD_INBOX.token };
    try {
      const begin = await fetch(CLOUD_INBOX.url + "/begin", {
        method: "POST", headers: { ...hdr, "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, multi, files: files.map((f) => f.name) }),
      });
      const bj = await begin.json();
      if (!bj.ok) throw new Error(bj.error || "Không tạo được hàng chờ");
      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi];
        const nChunks = Math.max(1, Math.ceil(f.size / CHUNK));
        for (let c = 0; c < nChunks; c++) {
          status.textContent = `Đang gửi ${f.name} — phần ${c + 1}/${nChunks} (file ${fi + 1}/${files.length})…`;
          const b64 = await fileToB64(f.slice(c * CHUNK, (c + 1) * CHUNK));
          const r = await fetch(`${CLOUD_INBOX.url}/put?id=${bj.id}&name=${encodeURIComponent(f.name)}&idx=${c}`, {
            method: "POST", headers: hdr, body: b64,
          });
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || `Gửi ${f.name} thất bại`);
        }
      }
      status.textContent = "Đang hoàn tất…";
      const fin = await fetch(`${CLOUD_INBOX.url}/finish?id=${bj.id}`, { method: "POST", headers: hdr });
      if (!(await fin.json()).ok) throw new Error("Không chốt được hàng chờ");
      goHome();
      openModal(`<h3>Đã gửi đề vào hàng chờ ✓</h3>
        <p>"${esc(name)}" đã được lưu vào hàng chờ cloud. Khi máy cá nhân bật poller, đề sẽ được kéo về xử lý và web này sẽ tự cập nhật sau khi xử lý xong.</p>
        <p>Bạn có thể tắt điện thoại ngay; file vẫn nằm trong hàng chờ ở mục "Đề mới upload".</p>
        <div class="modal-actions"><button class="btn btn-primary" onclick="App.closeModal()">OK</button></div>`);
    } catch (e) {
      status.textContent = "Lỗi: " + e.message;
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
    state.answers = {}; state.revealed = {}; state.finished = false; state.result = null;
    state.startedAt = Date.now();
    state.view = "runner";
    $("#btn-exit").classList.remove("hidden");
    const t = test();
    renderRunner();
    if (t.kind === "listening" && mode === "exam") {
      playSegment(0, null);
    } else if (t.kind === "reading" && mode === "exam") {
      startTimer(t.timerMin * 60);
    }
    window.scrollTo(0, 0);
  }

  /* ---------------- sessions: thi thật & luyện thi tuỳ chọn ---------------- */
  function buildSession(cfg) {
    // cfg: {title, real, sections: [{testId, parts: [..]}], timerMin, mode}
    const parts = [];
    let audioSrc = null, timings = null, hasL = false, hasR = false;
    const descBits = [];
    for (const s of cfg.sections) {
      const src = D.tests[s.testId];
      if (!src) continue;
      const chosen = src.parts.filter((p) => s.parts.includes(p.part));
      parts.push(...chosen);
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

  function startSession(cfg) {
    state.session = buildSession(cfg);
    if (!state.session.parts.length) { state.session = null; return; }
    state.testId = null; state.mode = cfg.mode; state.keyOnly = false;
    state.answers = {}; state.revealed = {}; state.finished = false; state.result = null;
    state.startedAt = Date.now();
    state.view = "runner";
    $("#btn-exit").classList.remove("hidden");
    renderRunner();
    const t = state.session;
    if (cfg.mode === "exam" && t.audioSrc) {
      const span = audioSpan(t);
      if (span) playSegment(span.start, span.end);
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
    screen.classList.toggle("wide", t.parts.some((p) => p.part >= 6));
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
      `<div class="qnav-cell" data-q="${q.n}" onclick="App.jumpTo(${q.n}); App.closeModal();">${q.n}</div>`).join("");
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
        ? `<div class="group-head"><span class="gh-label">Câu ${it.questions[0].n}–${it.questions[it.questions.length - 1].n}</span>
           ${(state.mode === "practice" || state.finished) ? segButton(it.audio, "Nghe hội thoại") : ""}</div>`
        : "";
      const passage = (it.img || it.text != null) ? renderPassage(it) : "";
      const graphic = it.graphicImg ? `<img class="qgraphic" src="${it.graphicImg}" alt="graphic">` : "";
      const revealed = state.finished || (state.mode === "practice" && it.questions.every((q) => state.revealed[q.n]));
      const transcript = revealed ? renderTranscriptBox(it, true) : "";
      const qs = it.questions.map((q) => renderQuestion(t, p, q, it)).join("");
      if (!isListening && passage) {
        // reading P6/P7: passage pinned left, questions scroll on the right — no more scrolling back and forth
        const hint = it.img ? '<div class="zoom-hint">Bấm vào ảnh để phóng to</div>' : "";
        return `<div class="qcard" id="qc-${it.questions[0].n}">
          <div class="passage-split">
            <div class="ps-left">${passage}${hint}</div>
            <div class="ps-right">${qs}</div>
          </div></div>`;
      }
      return `<div class="qcard" id="qc-${it.questions[0].n}">${head}${passage}${graphic}${qs}${transcript}</div>`;
    }
    const soloRevealed = state.finished || state.revealed[it.n];
    const soloExtras = soloRevealed && p.part <= 4 ? renderTranscriptBox(it, false) : "";
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
      : (withLines && it.transcript ? esc(it.transcript) : "");
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
      // original scanned passage image (authentic exam look)
      return `<img class="passage-img" src="${it.img}" alt="${esc(it.ptype || "passage")}" loading="lazy">`;
    }
    const text = esc(it.text).replace(/\[(\d{3})\]/g, '<span class="blank-marker">[$1]</span>');
    return `<div class="passage-box">
      ${it.ptype ? `<div class="ptype">${esc(it.ptype)}</div>` : ""}
      ${it.title ? `<div class="ptitle">${esc(it.title)}</div>` : ""}${text}
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
      const label = q.choices[L] ? esc(q.choices[L]) : "<i style='color:var(--muted)'>(nghe audio)</i>";
      return `<div class="${cls}" onclick="App.pick(${q.n},'${L}')"><span class="letter">${L}</span><span>${label}</span></div>`;
    }).join("");

    const photo = q.image ? `<img class="qphoto" src="${q.image}" alt="Câu ${q.n}">` : "";
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
      if (q.spoken && (q.spoken.question || Object.keys(q.spoken.choices || {}).length)) {
        const sp = [];
        if (q.spoken.question) sp.push("Q: " + q.spoken.question);
        for (const [L, txt] of Object.entries(q.spoken.choices || {})) sp.push(`(${L}) ${txt}`);
        feedback += `<div class="transcript-box"><div class="t-label">Nội dung audio</div>${esc(sp.join("\n"))}</div>`;
      }
    }
    const checkBtn = state.mode === "practice" && !reveal && user
      ? `<button class="btn btn-sm" style="margin-top:10px" onclick="App.check(${q.n})">Kiểm tra đáp án</button>` : "";

    return `<div class="q-block" data-q="${q.n}" style="margin-bottom:14px">
      <div class="qtext"><span class="qnum">${q.n}.</span>${q.question ? esc(q.question) : p.part <= 2 ? "<i style='color:var(--muted)'>Nghe audio và chọn đáp án</i>" : ""}</div>
      ${photo}${segBtn}
      <div class="choices">${choices}</div>
      ${checkBtn}${feedback}
    </div>`;
  }

  function renderSidebar(t) {
    const qs = allQuestions(t);
    const cells = qs.map(({ q }) => `<div class="qnav-cell" data-q="${q.n}" onclick="App.jumpTo(${q.n})">${q.n}</div>`).join("");
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
    state.finished = true;
    saveAttempt({
      testId: state.session ? "session" : t.id,
      title: t.title,
      session: state.session ? state.session.sessionCfg : undefined,
      mode: state.mode, correct, total, scaled, scaleMax,
      date: Date.now(), durationSec,
      answers: { ...state.answers },
    });
    renderResult(auto);
    window.scrollTo(0, 0);
  }

  function renderResult(auto) {
    const t = test();
    screen.classList.remove("wide");
    document.body.classList.remove("has-mbar");
    const r = state.result;
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
    if (!probe.parts.length) return null;
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
    if (state.session) startSession(state.session.sessionCfg);
  }

  function openHistory(date) {
    const h = loadHistory().find((x) => x.date === date);
    if (!h) return;
    if (h.session) {
      state.session = buildSession(h.session);
      if (!state.session.parts.length) { state.session = null; return; }
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
    goHome, startTest, pick, check, jumpTo, trySubmit, submit, reviewAnswers,
    exportAnswers, answerSheetText, buildAnswerSheetCanvas, openHistory, openKeyView, showResult,
    goUpload, submitUpload, submitCloudUpload, processUpload, openQnavSheet, upRemoveFile,
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
