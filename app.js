(() => {
  "use strict";

  const STORAGE_KEY = "ts.events.v1";
  const HOUR_HEIGHT = 64; // px, must match CSS .hour-row height
  const PX_PER_MIN = HOUR_HEIGHT / 60;
  const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

  // ---------- state ----------
  let events = loadEvents();
  let currentDate = startOfDay(new Date());
  let editingId = null;
  let notifyTimers = [];
  let lastScheduledDateKey = null;

  // ---------- storage ----------
  function loadEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
  function saveEvents() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }

  // ---------- date helpers ----------
  function startOfDay(d) {
    const n = new Date(d);
    n.setHours(0, 0, 0, 0);
    return n;
  }
  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function isSameDay(a, b) {
    return dateKey(a) === dateKey(b);
  }
  function addDays(d, n) {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + n);
    return nd;
  }
  function formatDateLabel(d) {
    return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY_LABELS[d.getDay()]})`;
  }
  function minutesFromTimeStr(t) {
    if (!t) return null;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const dateMain = $("dateMain");
  const todayBadge = $("todayBadge");
  const timeline = $("timeline");
  const timelineWrap = $("timelineWrap");
  const notifyBanner = $("notifyBanner");
  const toastEl = $("toast");

  const modalOverlay = $("modalOverlay");
  const modalTitle = $("modalTitle");
  const fieldTitle = $("fieldTitle");
  const typeSegmented = $("typeSegmented");
  const dateField = $("dateField");
  const fieldDate = $("fieldDate");
  const daysField = $("daysField");
  const weekdayPicker = $("weekdayPicker");
  const fieldStart = $("fieldStart");
  const fieldEnd = $("fieldEnd");
  const colorPicker = $("colorPicker");
  const fieldNotify = $("fieldNotify");
  const deleteBtn = $("deleteBtn");

  // ---------- toast ----------
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2400);
  }

  // ---------- rendering: timeline ----------
  function getEventsForDate(d) {
    const key = dateKey(d);
    const weekday = d.getDay();
    return events.filter((ev) => {
      if (ev.type === "once") return ev.date === key;
      if (ev.type === "recurring") return Array.isArray(ev.days) && ev.days.includes(weekday);
      return false;
    });
  }

  function layoutEvents(dayEvents) {
    // assign overlap columns
    const items = dayEvents
      .map((ev) => {
        const start = minutesFromTimeStr(ev.start) ?? 0;
        const rawEnd = minutesFromTimeStr(ev.end);
        const end = rawEnd != null && rawEnd > start ? rawEnd : start + 30;
        return { ev, start, end };
      })
      .sort((a, b) => a.start - b.start || a.end - b.end);

    // simple greedy column assignment among overlapping clusters
    const columnsEnd = []; // end time of last item in each column
    for (const item of items) {
      let placed = false;
      for (let c = 0; c < columnsEnd.length; c++) {
        if (columnsEnd[c] <= item.start) {
          item.col = c;
          columnsEnd[c] = item.end;
          placed = true;
          break;
        }
      }
      if (!placed) {
        item.col = columnsEnd.length;
        columnsEnd.push(item.end);
      }
    }

    // determine total columns per overlapping cluster (approx: use global max concurrent)
    // compute concurrency at each item's start to size width reasonably
    for (const item of items) {
      let concurrent = 1;
      for (const other of items) {
        if (other === item) continue;
        if (other.start < item.end && item.start < other.end) concurrent = Math.max(concurrent, Math.max(item.col, other.col) + 1);
      }
      item.totalCols = Math.max(concurrent, item.col + 1);
    }

    return items;
  }

  function renderTimeline() {
    timeline.innerHTML = "";
    dateMain.textContent = formatDateLabel(currentDate);
    todayBadge.hidden = !isSameDay(currentDate, new Date());

    const hoursFrag = document.createDocumentFragment();
    for (let h = 0; h < 24; h++) {
      const row = document.createElement("div");
      row.className = "hour-row";
      const label = document.createElement("div");
      label.className = "hour-label";
      label.textContent = `${h}:00`;
      row.appendChild(label);
      hoursFrag.appendChild(row);
    }
    timeline.appendChild(hoursFrag);

    const eventsLayer = document.createElement("div");
    eventsLayer.className = "events-layer";
    timeline.appendChild(eventsLayer);

    const dayEvents = getEventsForDate(currentDate);
    if (dayEvents.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.style.position = "absolute";
      empty.style.top = "8px";
      empty.style.left = "0";
      empty.style.right = "0";
      empty.textContent = "この日の予定はありません";
      eventsLayer.appendChild(empty);
    } else {
      const laidOut = layoutEvents(dayEvents);
      for (const item of laidOut) {
        const block = document.createElement("div");
        block.className = "event-block";
        block.style.setProperty("--c", item.ev.color || "#4F46E5");
        block.style.top = `${item.start * PX_PER_MIN}px`;
        block.style.height = `${Math.max((item.end - item.start) * PX_PER_MIN, 30)}px`;
        const widthPct = 100 / item.totalCols;
        block.style.width = `calc(${widthPct}% - 6px)`;
        block.style.left = `calc(${widthPct * item.col}% )`;

        const title = document.createElement("div");
        title.className = "event-title";
        title.textContent = item.ev.title;
        block.appendChild(title);

        const timeLabel = document.createElement("div");
        timeLabel.className = "event-time";
        timeLabel.textContent = item.ev.end ? `${item.ev.start} - ${item.ev.end}` : item.ev.start;
        if (item.ev.type === "recurring") {
          timeLabel.textContent += " ・繰り返し";
        }
        block.appendChild(timeLabel);

        block.addEventListener("click", () => openModal(item.ev));
        eventsLayer.appendChild(block);
      }
    }

    renderNowLine(eventsLayer);
  }

  let nowLineEl = null;
  function renderNowLine(eventsLayer) {
    if (!isSameDay(currentDate, new Date())) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    nowLineEl = document.createElement("div");
    nowLineEl.className = "now-line";
    nowLineEl.style.top = `${minutes * PX_PER_MIN}px`;
    eventsLayer.appendChild(nowLineEl);
  }

  function scrollToNow() {
    if (!isSameDay(currentDate, new Date())) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const target = Math.max(minutes * PX_PER_MIN - 160, 0);
    timelineWrap.scrollTop = target;
  }

  // ---------- modal ----------
  let selectedColor = "#4F46E5";
  let selectedDays = new Set();
  let currentType = "once";

  function setType(type) {
    currentType = type;
    typeSegmented.querySelectorAll(".seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.type === type);
    });
    dateField.hidden = type !== "once";
    daysField.hidden = type !== "recurring";
  }

  function openModal(ev) {
    editingId = ev ? ev.id : null;
    modalTitle.textContent = ev ? "予定を編集" : "予定を追加";
    deleteBtn.hidden = !ev;

    fieldTitle.value = ev ? ev.title : "";
    setType(ev ? ev.type : "once");
    fieldDate.value = ev && ev.type === "once" ? ev.date : dateKey(currentDate);
    fieldStart.value = ev ? ev.start : "09:00";
    fieldEnd.value = ev && ev.end ? ev.end : "";
    fieldNotify.checked = ev ? !!ev.notify : true;

    selectedDays = new Set(ev && ev.type === "recurring" ? ev.days : []);
    weekdayPicker.querySelectorAll(".day-chip").forEach((chip) => {
      chip.classList.toggle("active", selectedDays.has(Number(chip.dataset.day)));
    });

    selectedColor = ev && ev.color ? ev.color : "#4F46E5";
    colorPicker.querySelectorAll(".color-dot").forEach((dot) => {
      dot.classList.toggle("active", dot.dataset.color === selectedColor);
    });

    modalOverlay.hidden = false;
  }

  function closeModal() {
    modalOverlay.hidden = true;
    editingId = null;
  }

  function handleSave() {
    const title = fieldTitle.value.trim();
    if (!title) { showToast("タイトルを入力してください"); return; }
    if (!fieldStart.value) { showToast("開始時刻を入力してください"); return; }
    if (currentType === "once" && !fieldDate.value) { showToast("日付を選択してください"); return; }
    if (currentType === "recurring" && selectedDays.size === 0) { showToast("曜日を選択してください"); return; }
    if (fieldEnd.value && fieldEnd.value <= fieldStart.value) { showToast("終了時刻は開始時刻より後にしてください"); return; }

    const payload = {
      id: editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
      title,
      type: currentType,
      date: currentType === "once" ? fieldDate.value : null,
      days: currentType === "recurring" ? Array.from(selectedDays).sort() : null,
      start: fieldStart.value,
      end: fieldEnd.value || null,
      color: selectedColor,
      notify: fieldNotify.checked,
      notifiedKeys: [],
    };

    if (editingId) {
      const idx = events.findIndex((e) => e.id === editingId);
      if (idx >= 0) events[idx] = { ...events[idx], ...payload };
    } else {
      events.push(payload);
    }
    saveEvents();
    closeModal();
    renderTimeline();
    scheduleNotifications();
    showToast("保存しました");
  }

  function handleDelete() {
    if (!editingId) return;
    events = events.filter((e) => e.id !== editingId);
    saveEvents();
    closeModal();
    renderTimeline();
    scheduleNotifications();
    showToast("削除しました");
  }

  // ---------- notifications ----------
  function notificationSupported() {
    return "Notification" in window;
  }

  function updateNotifyBannerVisibility() {
    if (!notificationSupported()) { notifyBanner.hidden = true; return; }
    notifyBanner.hidden = Notification.permission !== "default";
  }

  async function requestNotifyPermission() {
    if (!notificationSupported()) { showToast("この環境は通知に対応していません"); return; }
    const perm = await Notification.requestPermission();
    updateNotifyBannerVisibility();
    if (perm === "granted") {
      showToast("通知を有効にしました");
      scheduleNotifications();
    } else {
      showToast("通知が許可されませんでした");
    }
  }

  function clearNotifyTimers() {
    notifyTimers.forEach((t) => clearTimeout(t));
    notifyTimers = [];
  }

  function scheduleNotifications() {
    clearNotifyTimers();
    if (!notificationSupported() || Notification.permission !== "granted") return;

    const now = new Date();
    const today = startOfDay(now);
    const todaysEvents = getEventsForDate(today).filter((e) => e.notify);

    for (const ev of todaysEvents) {
      const mins = minutesFromTimeStr(ev.start);
      if (mins == null) continue;
      const fireAt = new Date(today);
      fireAt.setMinutes(mins);
      const delay = fireAt.getTime() - now.getTime();
      if (delay <= 0 || delay > 24 * 60 * 60 * 1000) continue;

      const timer = setTimeout(() => {
        try {
          new Notification(ev.title, {
            body: ev.end ? `${ev.start} - ${ev.end}` : `${ev.start} の予定です`,
            tag: `ts-${ev.id}-${dateKey(today)}`,
          });
        } catch { /* notification blocked mid-session */ }
      }, delay);
      notifyTimers.push(timer);
    }
    lastScheduledDateKey = dateKey(today);
  }

  // reschedule when tab regains focus, and detect day rollover
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleNotifications();
      if (isSameDay(currentDate, new Date())) renderTimeline();
    }
  });

  setInterval(() => {
    const todayKey = dateKey(new Date());
    if (todayKey !== lastScheduledDateKey) {
      scheduleNotifications();
    }
    if (isSameDay(currentDate, new Date()) && nowLineEl) {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      nowLineEl.style.top = `${minutes * PX_PER_MIN}px`;
    }
  }, 30 * 1000);

  // ---------- event listeners ----------
  $("prevDay").addEventListener("click", () => { currentDate = addDays(currentDate, -1); renderTimeline(); });
  $("nextDay").addEventListener("click", () => { currentDate = addDays(currentDate, 1); renderTimeline(); });
  $("addBtn").addEventListener("click", () => openModal(null));
  $("modalClose").addEventListener("click", closeModal);
  $("cancelBtn").addEventListener("click", closeModal);
  $("saveBtn").addEventListener("click", handleSave);
  deleteBtn.addEventListener("click", handleDelete);
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

  $("notifyEnableBtn").addEventListener("click", requestNotifyPermission);
  $("notifyDismissBtn").addEventListener("click", () => { notifyBanner.hidden = true; });
  $("settingsBtn").addEventListener("click", () => {
    if (!notificationSupported()) { showToast("この環境は通知に対応していません"); return; }
    const status = { granted: "許可済み", denied: "拒否されています(端末設定から変更可)", default: "未設定" }[Notification.permission];
    showToast(`通知: ${status}`);
    if (Notification.permission === "default") notifyBanner.hidden = false;
  });

  typeSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (btn) setType(btn.dataset.type);
  });

  weekdayPicker.addEventListener("click", (e) => {
    const chip = e.target.closest(".day-chip");
    if (!chip) return;
    const day = Number(chip.dataset.day);
    if (selectedDays.has(day)) selectedDays.delete(day); else selectedDays.add(day);
    chip.classList.toggle("active");
  });

  colorPicker.addEventListener("click", (e) => {
    const dot = e.target.closest(".color-dot");
    if (!dot) return;
    selectedColor = dot.dataset.color;
    colorPicker.querySelectorAll(".color-dot").forEach((d) => d.classList.toggle("active", d === dot));
  });

  // ---------- init ----------
  function init() {
    updateNotifyBannerVisibility();
    renderTimeline();
    scrollToNow();
    scheduleNotifications();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline caching is best-effort */ });
    }
  }

  init();
})();
