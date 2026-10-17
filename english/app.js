(() => {
  "use strict";

  const STORAGE_KEY = "en.progress.v1";
  const CAT_KEY = "en.category.v1";
  const SESSION_SIZE = 10;
  // 正解するたびに次の出題までの日数が伸びる（box 0〜5）
  const INTERVALS = [0, 1, 3, 7, 14, 30];
  const LEARNED_BOX = 3;

  const { categories, words, sentences } = window.EN_DATA;
  const wordItems = words.map((w) => ({ ...w, id: "w:" + w.en }));
  const sentItems = sentences.map((s) => ({ ...s, id: "s:" + s.en }));

  const MODES = {
    wordRead: {
      title: "単語を読む",
      desc: "英単語を見て、意味を4つから選ぶ",
      icon: "👀",
      kind: "choice",
      pool: () => filterByCategory(wordItems),
    },
    wordType: {
      title: "単語を打つ",
      desc: "日本語を見て、英単語をキーボードで打つ",
      icon: "⌨️",
      kind: "wordType",
      pool: () => filterByCategory(wordItems),
    },
    sentRead: {
      title: "文を読む",
      desc: "短い英文を見て、意味を3つから選ぶ",
      icon: "📖",
      kind: "choice",
      pool: () => sentItems,
    },
    sentOrder: {
      title: "文を並べる",
      desc: "単語をタップして正しい順番に並べる",
      icon: "🧩",
      kind: "order",
      pool: () => sentItems,
    },
    sentCopy: {
      title: "文を写して打つ",
      desc: "お手本を見ながら英文を打つ（いちばんやさしい）",
      icon: "✍️",
      kind: "sentType",
      recall: false,
      pool: () => sentItems,
    },
    sentRecall: {
      title: "文を思い出して打つ",
      desc: "日本語だけを見て英文を打つ（上級）",
      icon: "🧠",
      kind: "sentType",
      recall: true,
      pool: () => sentItems,
    },
  };

  // ---------- storage ----------
  let progress = loadProgress();
  let selectedCat = loadCat();

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const p = raw ? JSON.parse(raw) : null;
      if (p && p.items) return p;
    } catch {}
    return { items: {}, days: [], answered: 0, correct: 0 };
  }
  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {}
  }
  function loadCat() {
    try {
      return localStorage.getItem(CAT_KEY) || "all";
    } catch {
      return "all";
    }
  }
  function saveCat() {
    try {
      localStorage.setItem(CAT_KEY, selectedCat);
    } catch {}
  }

  // ---------- date helpers ----------
  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function todayKey() {
    return dateKey(new Date());
  }
  function addDaysKey(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }

  // ---------- spaced repetition ----------
  function recKey(mode, item) {
    return mode + "|" + item.id;
  }
  function getRec(mode, item) {
    return progress.items[recKey(mode, item)] || null;
  }
  // grade: "good"（一発正解）/ "hard"（ヒントを使って正解）/ "again"（不正解）
  function grade(mode, item, g) {
    const key = recKey(mode, item);
    const rec = progress.items[key] || { box: 0, due: todayKey() };
    if (g === "good") {
      rec.box = Math.min(rec.box + 1, INTERVALS.length - 1);
      rec.due = addDaysKey(INTERVALS[rec.box]);
    } else if (g === "hard") {
      rec.due = addDaysKey(1);
    } else {
      rec.box = 0;
      rec.due = todayKey();
    }
    progress.items[key] = rec;
    progress.answered += 1;
    if (g !== "again") progress.correct += 1;
    const t = todayKey();
    if (!progress.days.includes(t)) progress.days.push(t);
    saveProgress();
  }

  function dueCount(modeId) {
    const t = todayKey();
    return MODES[modeId].pool().filter((it) => {
      const r = getRec(modeId, it);
      return r && r.due <= t;
    }).length;
  }

  // 復習期限が来たもの → まだ出ていないもの（データ順＝やさしい順）→ その他 の順で選ぶ
  function pickItems(modeId) {
    const pool = MODES[modeId].pool();
    const t = todayKey();
    const due = [];
    const fresh = [];
    const rest = [];
    for (const it of pool) {
      const r = getRec(modeId, it);
      if (!r) fresh.push(it);
      else if (r.due <= t) due.push({ it, due: r.due });
      else rest.push(it);
    }
    due.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    const picked = due.map((d) => d.it).slice(0, SESSION_SIZE);
    for (const it of fresh) {
      if (picked.length >= SESSION_SIZE) break;
      picked.push(it);
    }
    for (const it of shuffle(rest)) {
      if (picked.length >= SESSION_SIZE) break;
      picked.push(it);
    }
    return shuffle(picked);
  }

  function streak() {
    const set = new Set(progress.days);
    const d = new Date();
    if (!set.has(dateKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (set.has(dateKey(d))) {
      n += 1;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const main = $("main");
  const backBtn = $("backBtn");
  const topbarTitle = $("topbarTitle");
  const topbarProgress = $("topbarProgress");
  const canSpeak = "speechSynthesis" in window;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function filterByCategory(items) {
    return selectedCat === "all" ? items : items.filter((w) => w.cat === selectedCat);
  }
  // 大文字小文字・句読点・余分な空白は判定に含めない
  function normalize(s) {
    return s
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[.,!?"]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function tokens(s) {
    return normalize(s).split(" ").filter(Boolean);
  }
  function speak(text) {
    if (!canSpeak) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.85;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  function speakBtn(text) {
    return canSpeak
      ? `<button class="speak-btn" data-speak="${esc(text)}" aria-label="発音を聞く">🔊</button>`
      : "";
  }
  function showToast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => (t.hidden = true), 1800);
  }

  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-speak]");
    if (b) speak(b.dataset.speak);
  });

  // ---------- home ----------
  function renderHome() {
    session = null;
    backBtn.hidden = true;
    topbarTitle.textContent = "えいご練習";
    topbarProgress.textContent = "";

    const st = streak();
    const todayCount = progress.days.includes(todayKey()) ? "今日も練習済み ✓" : "今日はまだ練習していません";
    const catChips = [{ id: "all", label: "すべて" }, ...categories]
      .map((c) => `<button class="chip ${selectedCat === c.id ? "active" : ""}" data-cat="${c.id}">${esc(c.label)}</button>`)
      .join("");

    const card = (id) => {
      const m = MODES[id];
      const d = dueCount(id);
      return `<button class="mode-card" data-mode="${id}">
        <span class="mode-icon">${m.icon}</span>
        <span class="mode-text">
          <span class="mode-title">${m.title}</span>
          <span class="mode-desc">${m.desc}</span>
        </span>
        ${d ? `<span class="due-badge">復習 ${d}</span>` : ""}
      </button>`;
    };

    main.innerHTML = `
      <section class="summary">
        <div class="summary-main"><span class="streak-num">${st}</span><span>日連続</span></div>
        <div class="summary-sub">${todayCount}</div>
        <button class="link-btn" id="statsBtn">記録を見る</button>
      </section>

      <h2 class="section-title">単語</h2>
      <div class="chips" id="catChips">${catChips}</div>
      <div class="mode-list">${card("wordRead")}${card("wordType")}</div>

      <h2 class="section-title">短い文</h2>
      <div class="mode-list">${card("sentRead")}${card("sentOrder")}${card("sentCopy")}${card("sentRecall")}</div>

      <p class="tip">はじめての方は「単語を読む」→「単語を打つ」→「文を写して打つ」の順がおすすめです。<br>
      打つ練習のときは、キーボードを英語（ABC）に切り替えてください。大文字・小文字と「. , ? !」は判定に含めません。</p>
    `;

    $("catChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      selectedCat = b.dataset.cat;
      saveCat();
      renderHome();
    });
    main.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => startSession(b.dataset.mode))
    );
    $("statsBtn").addEventListener("click", renderStats);
  }

  // ---------- session ----------
  let session = null;

  function startSession(modeId) {
    const items = pickItems(modeId);
    if (!items.length) {
      showToast("このカテゴリには問題がありません");
      return;
    }
    session = {
      modeId,
      mode: MODES[modeId],
      queue: items.slice(),
      total: items.length,
      done: 0,
      results: new Map(), // item.id -> { item, grade }（最初の解答のみ記録）
    };
    backBtn.hidden = false;
    topbarTitle.textContent = session.mode.title;
    nextQuestion();
  }

  function record(item, g) {
    if (session.results.has(item.id)) return;
    session.results.set(item.id, { item, grade: g });
    grade(session.modeId, item, g);
    // 間違えた問題はセッションの最後にもう一度出す
    if (g === "again") session.queue.push(item);
  }

  function nextQuestion() {
    if (!session) return;
    if (!session.queue.length) return renderResult();
    const item = session.queue.shift();
    session.current = item;
    session.done = session.results.size;
    topbarProgress.textContent = `${Math.min(session.done + 1, session.total)} / ${session.total}`;
    const kind = session.mode.kind;
    if (kind === "choice") renderChoice(item);
    else if (kind === "wordType") renderWordType(item);
    else if (kind === "order") renderOrder(item);
    else renderSentType(item);
  }

  function isRetry(item) {
    return session.results.has(item.id);
  }
  function retryBadge(item) {
    return isRetry(item) ? `<div class="retry-badge">もう一度</div>` : "";
  }

  // ----- 選択問題（単語を読む / 文を読む） -----
  function renderChoice(item) {
    const isWord = session.modeId === "wordRead";
    const n = isWord ? 4 : 3;
    let candidates;
    if (isWord) {
      const same = wordItems.filter((w) => w.cat === item.cat && w.id !== item.id);
      const other = wordItems.filter((w) => w.cat !== item.cat);
      candidates = shuffle(same).slice(0, n - 1);
      if (candidates.length < n - 1) candidates = candidates.concat(shuffle(other).slice(0, n - 1 - candidates.length));
    } else {
      candidates = shuffle(sentItems.filter((s) => s.id !== item.id)).slice(0, n - 1);
    }
    const options = shuffle([item, ...candidates]);

    main.innerHTML = `
      <div class="q-card">
        ${retryBadge(item)}
        <div class="q-label">この英語の意味は？</div>
        <div class="q-en ${isWord ? "big" : ""}" lang="en">${esc(item.en)} ${speakBtn(item.en)}</div>
      </div>
      <div class="options">
        ${options.map((o, i) => `<button class="option" data-i="${i}">${esc(o.ja)}</button>`).join("")}
      </div>
      <div id="feedback"></div>
    `;

    const btns = main.querySelectorAll(".option");
    btns.forEach((b) =>
      b.addEventListener("click", () => {
        const chosen = options[Number(b.dataset.i)];
        const ok = chosen.id === item.id;
        btns.forEach((x) => {
          x.disabled = true;
          if (options[Number(x.dataset.i)].id === item.id) x.classList.add("correct");
        });
        if (!ok) b.classList.add("wrong");
        record(item, ok ? "good" : "again");
        showFeedback(ok, item);
      })
    );
  }

  // ----- 単語を打つ -----
  function renderWordType(item) {
    const answer = item.en;
    let revealed = 0;
    let phase = "answer"; // answer → (retype) → done
    let usedHint = false;

    main.innerHTML = `
      <div class="q-card">
        ${retryBadge(item)}
        <div class="q-label">英語で打ってみよう</div>
        <div class="q-ja big">${esc(item.ja)}</div>
        <div class="hint-line" id="hintLine" lang="en"></div>
      </div>
      <input id="typeInput" class="type-input" type="text" lang="en"
        autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done"
        placeholder="ここに英語を入力" />
      <div class="actions">
        <button class="btn" id="hintBtn">ヒント（1文字）</button>
        <button class="btn primary" id="checkBtn">答え合わせ</button>
      </div>
      <div id="feedback"></div>
    `;

    const input = $("typeInput");
    const hintLine = $("hintLine");
    const hintBtn = $("hintBtn");
    const checkBtn = $("checkBtn");

    function drawHint() {
      hintLine.innerHTML = answer
        .split("")
        .map((ch, i) => `<span class="hint-ch">${i < revealed ? esc(ch) : "_"}</span>`)
        .join("");
    }
    drawHint();

    hintBtn.addEventListener("click", () => {
      if (revealed < answer.length) revealed += 1;
      usedHint = true;
      drawHint();
      input.focus();
    });

    function check() {
      const ok = normalize(input.value) === normalize(answer);
      if (phase === "answer") {
        if (!input.value.trim()) return;
        if (ok) {
          phase = "done";
          record(item, usedHint ? "hard" : "good");
          finish(true);
        } else {
          phase = "retype";
          record(item, "again");
          revealed = answer.length;
          drawHint();
          input.value = "";
          input.placeholder = "正解を打ってみよう";
          input.classList.add("is-wrong");
          hintBtn.hidden = true;
          checkBtn.textContent = "確認";
          $("feedback").innerHTML = `
            <div class="feedback wrong">
              <div class="fb-head">✗ 正解は <b lang="en">${esc(answer)}</b> ${speakBtn(answer)}</div>
              <div class="fb-sub">同じように打って、手に覚えさせましょう。</div>
              <button class="link-btn" id="skipBtn">打たずに次へ</button>
            </div>`;
          $("skipBtn").addEventListener("click", nextQuestion);
          input.focus();
        }
      } else if (phase === "retype") {
        if (ok) {
          phase = "done";
          finish(false);
        } else {
          input.classList.remove("shake");
          void input.offsetWidth;
          input.classList.add("shake");
        }
      } else {
        nextQuestion();
      }
    }

    function finish(firstTry) {
      input.disabled = true;
      input.classList.remove("is-wrong");
      input.classList.add("is-correct");
      hintBtn.hidden = true;
      checkBtn.hidden = true;
      showFeedback(true, item, firstTry ? (usedHint ? "ヒントありで正解" : "") : "打てました");
      if (canSpeak) speak(answer);
    }

    checkBtn.addEventListener("click", check);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        check();
      }
    });
    input.focus();
  }

  // ----- 文を並べる -----
  function renderOrder(item) {
    const target = item.en.split(" ");
    let pool = target.map((w, i) => ({ w, i }));
    if (pool.length > 1) {
      let s;
      do s = shuffle(pool);
      while (s.every((x, k) => x.i === k));
      pool = s;
    }
    let placed = [];

    main.innerHTML = `
      <div class="q-card">
        ${retryBadge(item)}
        <div class="q-label">英語の順番に並べよう</div>
        <div class="q-ja">${esc(item.ja)}</div>
      </div>
      <div class="order-answer" id="orderAnswer" lang="en"></div>
      <div class="order-pool" id="orderPool" lang="en"></div>
      <div class="actions">
        <button class="btn" id="resetBtn">やり直す</button>
        <button class="btn primary" id="checkBtn" disabled>答え合わせ</button>
      </div>
      <div id="feedback"></div>
    `;
    const ansEl = $("orderAnswer");
    const poolEl = $("orderPool");
    const checkBtn = $("checkBtn");
    let locked = false;

    function draw() {
      ansEl.innerHTML = placed.length
        ? placed.map((p, k) => `<button class="word-chip" data-a="${k}">${esc(p.w)}</button>`).join("")
        : `<span class="placeholder">下の単語をタップ</span>`;
      poolEl.innerHTML = pool.map((p, k) => `<button class="word-chip" data-p="${k}">${esc(p.w)}</button>`).join("");
      checkBtn.disabled = pool.length > 0 || locked;
    }
    draw();

    poolEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-p]");
      if (!b || locked) return;
      placed.push(pool.splice(Number(b.dataset.p), 1)[0]);
      draw();
    });
    ansEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (!b || locked) return;
      pool.push(placed.splice(Number(b.dataset.a), 1)[0]);
      draw();
    });
    $("resetBtn").addEventListener("click", () => {
      if (locked) return;
      pool = pool.concat(placed);
      placed = [];
      draw();
    });
    checkBtn.addEventListener("click", () => {
      const ok = placed.map((p) => p.w).join(" ") === item.en;
      locked = true;
      draw();
      ansEl.classList.add(ok ? "is-correct" : "is-wrong");
      $("resetBtn").hidden = true;
      checkBtn.hidden = true;
      record(item, ok ? "good" : "again");
      showFeedback(ok, item);
      if (ok && canSpeak) speak(item.en);
    });
  }

  // ----- 文を打つ（写す / 思い出す） -----
  function renderSentType(item) {
    const recall = session.mode.recall;
    const target = item.en.split(" ");
    const targetNorm = target.map((w) => normalize(w));
    let revealedWords = 0;
    let usedHint = false;
    let phase = "answer";

    main.innerHTML = `
      <div class="q-card">
        ${retryBadge(item)}
        <div class="q-label">${recall ? "日本語を英語にして打とう" : "お手本と同じように打とう"}</div>
        ${recall ? `<div class="q-ja">${esc(item.ja)}</div>` : ""}
        <div class="sent-target" id="sentTarget" lang="en"></div>
        ${recall ? "" : `<div class="q-ja-sub">${esc(item.ja)} ${speakBtn(item.en)}</div>`}
      </div>
      <textarea id="typeInput" class="type-input sent-input" rows="2" lang="en"
        autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done"
        placeholder="ここに英文を入力"></textarea>
      <div class="actions">
        ${recall ? `<button class="btn" id="hintBtn">ヒント（1語）</button>` : ""}
        <button class="btn primary" id="checkBtn">答え合わせ</button>
      </div>
      <div id="feedback"></div>
    `;

    const input = $("typeInput");
    const targetEl = $("sentTarget");
    const checkBtn = $("checkBtn");
    const hintBtn = $("hintBtn");

    // 入力に合わせて、お手本の単語ごとに 正しい／間違い／入力中 を色で示す
    function draw() {
      const typed = tokens(input.value);
      const endsWithSpace = /\s$/.test(input.value);
      targetEl.innerHTML = target
        .map((w, i) => {
          let state = "pending";
          if (i < typed.length) {
            const isCurrent = phase !== "done" && i === typed.length - 1 && !endsWithSpace;
            if (typed[i] === targetNorm[i]) state = isCurrent ? "typing" : "ok";
            else if (isCurrent && targetNorm[i].startsWith(typed[i])) state = "typing";
            else state = "ng";
          }
          const show = !recall || state === "ok" || i < revealedWords || phase !== "answer";
          const text = show ? esc(w) : "_".repeat(w.length);
          return `<span class="tw ${state}">${text}</span>`;
        })
        .join(" ");
    }
    draw();
    input.addEventListener("input", draw);

    if (hintBtn) {
      hintBtn.addEventListener("click", () => {
        if (revealedWords < target.length) revealedWords += 1;
        usedHint = true;
        draw();
        input.focus();
      });
    }

    function check() {
      const ok = tokens(input.value).join(" ") === targetNorm.join(" ");
      if (phase === "answer") {
        if (!input.value.trim()) return;
        if (ok) {
          phase = "done";
          record(item, usedHint ? "hard" : "good");
          finish(true);
        } else {
          phase = "retype";
          record(item, "again");
          draw();
          input.classList.add("is-wrong");
          if (hintBtn) hintBtn.hidden = true;
          checkBtn.textContent = "確認";
          $("feedback").innerHTML = `
            <div class="feedback wrong">
              <div class="fb-head">✗ 正解は <b lang="en">${esc(item.en)}</b> ${speakBtn(item.en)}</div>
              <div class="fb-sub">赤い単語を直して、もう一度「確認」を押しましょう。</div>
              ${item.note ? `<div class="fb-note">💡 ${esc(item.note)}</div>` : ""}
              <button class="link-btn" id="skipBtn">直さずに次へ</button>
            </div>`;
          $("skipBtn").addEventListener("click", nextQuestion);
          input.focus();
        }
      } else if (phase === "retype") {
        if (ok) {
          phase = "done";
          finish(false);
        } else {
          input.classList.remove("shake");
          void input.offsetWidth;
          input.classList.add("shake");
        }
      } else {
        nextQuestion();
      }
    }

    function finish(firstTry) {
      draw();
      input.disabled = true;
      input.classList.remove("is-wrong");
      input.classList.add("is-correct");
      if (hintBtn) hintBtn.hidden = true;
      checkBtn.hidden = true;
      showFeedback(true, item, firstTry ? (usedHint ? "ヒントありで正解" : "") : "打てました");
      if (canSpeak) speak(item.en);
    }

    checkBtn.addEventListener("click", check);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        check();
      }
    });
    input.focus();
  }

  // ----- 共通フィードバック -----
  function showFeedback(ok, item, extra) {
    const head = ok ? `◯ 正解！${extra ? `（${esc(extra)}）` : ""}` : "✗ ざんねん";
    $("feedback").innerHTML = `
      <div class="feedback ${ok ? "ok" : "wrong"}">
        <div class="fb-head">${head}</div>
        <div class="fb-pair"><span lang="en">${esc(item.en)}</span> ${speakBtn(item.en)}</div>
        <div class="fb-sub">${esc(item.ja)}</div>
        ${item.note ? `<div class="fb-note">💡 ${esc(item.note)}</div>` : ""}
        <button class="btn primary wide" id="nextBtn">次へ</button>
      </div>`;
    const nextBtn = $("nextBtn");
    nextBtn.addEventListener("click", nextQuestion);
    // 入力欄が無効になった後も Enter で次へ進めるようにする
    nextBtn.focus({ preventScroll: true });
    $("feedback").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ---------- result ----------
  function renderResult() {
    const results = [...session.results.values()];
    const good = results.filter((r) => r.grade !== "again").length;
    const missed = results.filter((r) => r.grade === "again");
    const modeId = session.modeId;
    topbarProgress.textContent = "";

    main.innerHTML = `
      <section class="result">
        <div class="result-score">${good} <span>/ ${results.length}</span></div>
        <div class="result-label">1回目で正解した数</div>
      </section>
      ${
        missed.length
          ? `<h2 class="section-title">間違えた問題</h2>
             <ul class="missed">${missed
               .map((r) => `<li><span lang="en">${esc(r.item.en)}</span> ${speakBtn(r.item.en)}<small>${esc(r.item.ja)}</small></li>`)
               .join("")}</ul>
             <p class="tip">間違えた問題は、次の練習で優先して出題されます。</p>`
          : `<p class="tip center">全問正解です。次は別の練習にも挑戦してみましょう。</p>`
      }
      <div class="actions">
        <button class="btn" id="homeBtn">ホームへ</button>
        <button class="btn primary" id="againBtn">続けて練習</button>
      </div>
    `;
    $("homeBtn").addEventListener("click", renderHome);
    $("againBtn").addEventListener("click", () => startSession(modeId));
    session = null;
  }

  // ---------- stats ----------
  function renderStats() {
    backBtn.hidden = false;
    topbarTitle.textContent = "記録";
    topbarProgress.textContent = "";
    const acc = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0;

    const rows = Object.keys(MODES)
      .map((id) => {
        const all = id.startsWith("word") ? wordItems : sentItems;
        let seen = 0;
        let learned = 0;
        for (const it of all) {
          const r = getRec(id, it);
          if (r) {
            seen += 1;
            if (r.box >= LEARNED_BOX) learned += 1;
          }
        }
        const pct = Math.round((learned / all.length) * 100);
        return `<div class="stat-row">
          <div class="stat-head"><span>${MODES[id].icon} ${MODES[id].title}</span><span>${learned} / ${all.length}</span></div>
          <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="stat-sub">出題済み ${seen}・覚えた ${learned}</div>
        </div>`;
      })
      .join("");

    main.innerHTML = `
      <section class="stats-grid">
        <div class="stat-box"><div class="stat-num">${streak()}</div><div class="stat-cap">日連続</div></div>
        <div class="stat-box"><div class="stat-num">${progress.days.length}</div><div class="stat-cap">練習した日</div></div>
        <div class="stat-box"><div class="stat-num">${progress.answered}</div><div class="stat-cap">解いた数</div></div>
        <div class="stat-box"><div class="stat-num">${acc}%</div><div class="stat-cap">正解率</div></div>
      </section>
      <h2 class="section-title">練習ごとの進み具合</h2>
      ${rows}
      <p class="tip">「覚えた」＝間をあけて3回続けて正解した問題です。</p>
      <div class="actions">
        <button class="btn danger" id="resetBtn">記録をすべて消す</button>
      </div>
    `;
    $("resetBtn").addEventListener("click", () => {
      if (!confirm("学習の記録をすべて消します。よろしいですか？")) return;
      progress = { items: {}, days: [], answered: 0, correct: 0 };
      saveProgress();
      showToast("記録を消しました");
      renderStats();
    });
  }

  backBtn.addEventListener("click", renderHome);

  // ---------- boot ----------
  renderHome();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
