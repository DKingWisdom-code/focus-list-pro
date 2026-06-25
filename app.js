(function () {
  "use strict";

  /* ---------------- helpers ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, "0");
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn("Could not read", key, e);
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("Could not save", key, e);
    }
  }

  /* ---------------- state ---------------- */
  let tasks = load("flp:tasks", []);
  let settings = load(
    "flp:settings",
    {
      username: "Productivity Pro",
      goalDaily: 5,
      goalWeekly: 25,
      theme: "dark",
      wallpaper: true,
      lenFocus: 25,
      lenShort: 5,
      lenLong: 15,
      autoStart: false,
    }
  );
  let focusLog = load("flp:focusLog", {}); // { "2026-06-25": minutes }
  let completedDays = load("flp:completedDays", []); // list of date strings

  let filter = "all";
  let sortBy = "created";
  let searchTerm = "";
  let selected = new Set();
  let lastDeleted = null;

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function showToast(message, actionLabel, actionFn) {
    const el = $("#toast");
    if (!el) return;
    el.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = message;
    el.appendChild(span);
    if (actionLabel && actionFn) {
      const btn = document.createElement("button");
      btn.className = "ghost";
      btn.textContent = actionLabel;
      btn.type = "button";
      btn.addEventListener("click", () => {
        actionFn();
        el.classList.remove("show");
      });
      el.appendChild(btn);
    }
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 5000);
  }

  /* ---------------- nav ---------------- */
  function setView(name) {
    $all(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
    $all(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  }

  /* ---------------- clock ---------------- */
  function tickClock() {
    const el = $("#clock");
    if (!el) return;
    const d = new Date();
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ---------------- tasks: derived data ---------------- */
  function isOverdue(t) {
    if (t.completed || !t.dueDate) return false;
    const due = new Date(t.dueDate + "T" + (t.dueTime || "23:59"));
    return due.getTime() < Date.now();
  }
  function isToday(t) {
    return t.dueDate === todayStr();
  }
  function isUpcoming(t) {
    if (t.completed || !t.dueDate) return false;
    return t.dueDate > todayStr();
  }

  function priorityRank(p) {
    return p === "high" ? 0 : p === "medium" ? 1 : 2;
  }

  function getFilteredTasks() {
    let list = tasks.slice();
    if (filter === "active") list = list.filter((t) => !t.completed);
    else if (filter === "completed") list = list.filter((t) => t.completed);
    else if (filter === "overdue") list = list.filter(isOverdue);

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.desc || "").toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
      );
    }

    if (sortBy === "due") {
      list.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    } else if (sortBy === "priority") {
      list.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
    } else if (sortBy === "az") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      list.sort((a, b) => b.createdAt - a.createdAt);
    }
    return list;
  }

  /* ---------------- rendering ---------------- */
  function fmtDue(t) {
    if (!t.dueDate) return "";
    const d = new Date(t.dueDate + "T00:00:00");
    const opts = { month: "short", day: "numeric" };
    let s = d.toLocaleDateString(undefined, opts);
    if (t.dueTime) s += " · " + t.dueTime;
    return s;
  }

  function renderTaskItem(t) {
    const li = document.createElement("li");
    li.className =
      "task-item" +
      (t.completed ? " completed" : "") +
      (isOverdue(t) ? " overdue" : "");
    li.dataset.id = t.id;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-check";
    check.checked = !!t.completed;
    check.setAttribute("aria-label", "Mark task complete");
    check.addEventListener("change", () => toggleComplete(t.id));

    const dot = document.createElement("span");
    dot.className = "priority-dot " + t.priority;

    const body = document.createElement("div");
    const title = document.createElement("p");
    title.className = "task-title";
    title.textContent = t.title;
    body.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "task-meta";
    const catBadge = document.createElement("span");
    catBadge.className = "badge";
    catBadge.textContent = t.category;
    meta.appendChild(catBadge);
    if (t.dueDate) {
      const dueBadge = document.createElement("span");
      dueBadge.className = "badge";
      dueBadge.textContent = (isOverdue(t) ? "Overdue · " : "Due ") + fmtDue(t);
      meta.appendChild(dueBadge);
    }
    if (t.desc) {
      const descEl = document.createElement("span");
      descEl.className = "badge";
      descEl.textContent = t.desc.length > 40 ? t.desc.slice(0, 40) + "…" : t.desc;
      meta.appendChild(descEl);
    }
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "task-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "icon";
    editBtn.type = "button";
    editBtn.title = "Edit";
    editBtn.textContent = "✎";
    editBtn.addEventListener("click", () => openEditModal(t.id));
    const delBtn = document.createElement("button");
    delBtn.className = "icon";
    delBtn.type = "button";
    delBtn.title = "Delete";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => deleteTask(t.id));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    const selectWrap = document.createElement("input");
    selectWrap.type = "checkbox";
    selectWrap.className = "task-check";
    selectWrap.title = "Select for bulk action";
    selectWrap.style.opacity = ".55";
    selectWrap.style.width = "16px";
    selectWrap.style.height = "16px";
    selectWrap.checked = selected.has(t.id);
    selectWrap.addEventListener("change", (e) => {
      if (e.target.checked) selected.add(t.id);
      else selected.delete(t.id);
      updateBulkBar();
    });
    actions.prepend(selectWrap);

    li.appendChild(check);
    li.appendChild(dot);
    li.appendChild(body);
    li.appendChild(actions);
    return li;
  }

  function renderTaskList() {
    const listEl = $("#task-list");
    const emptyEl = $("#empty-state");
    if (!listEl) return;
    const list = getFilteredTasks();
    listEl.innerHTML = "";
    list.forEach((t) => listEl.appendChild(renderTaskItem(t)));
    if (emptyEl) emptyEl.classList.toggle("hidden", list.length > 0);
    updateBulkBar();
  }

  function updateBulkBar() {
    const countEl = $("#selected-count");
    if (countEl) countEl.textContent = `${selected.size} selected`;
  }

  function renderMiniList(elId, list) {
    const el = $(elId);
    if (!el) return;
    el.innerHTML = "";
    list.slice(0, 4).forEach((t) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="dot"></span>${t.title}`;
      el.appendChild(li);
    });
  }

  function computeStreak() {
    let streak = 0;
    let cursor = new Date();
    while (true) {
      const ds = cursor.toISOString().slice(0, 10);
      if (completedDays.includes(ds)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  function startOfWeek() {
    const d = new Date();
    const day = d.getDay(); // 0 sun
    const diff = (day === 0 ? -6 : 1) - day; // monday start
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function renderDashboard() {
    const todayList = tasks.filter((t) => isToday(t) && !t.completed);
    const overdueList = tasks.filter(isOverdue);
    const upcomingList = tasks.filter(isUpcoming).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    setText("#stat-today", todayList.length);
    setText("#stat-overdue", overdueList.length);
    setText("#stat-upcoming", upcomingList.length);
    renderMiniList("#list-today", todayList);
    renderMiniList("#list-overdue", overdueList);
    renderMiniList("#list-upcoming", upcomingList);

    const total = tasks.length;
    const done = tasks.filter((t) => t.completed).length;
    setText("#m-total", total);
    setText("#m-done", done);
    setText("#m-streak", computeStreak());
    setText("#m-focus", focusLog[todayStr()] || 0);

    const weekStart = startOfWeek();
    const weekDone = tasks.filter(
      (t) => t.completed && t.completedAt && new Date(t.completedAt) >= weekStart
    ).length;
    const goal = settings.goalWeekly || 1;
    const pct = Math.min(100, Math.round((weekDone / goal) * 100));
    const fill = $("#progress-fill");
    if (fill) fill.style.width = pct + "%";
    setText("#progress-label", `${weekDone} / ${goal}`);
  }

  function setText(sel, value) {
    const el = $(sel);
    if (el) el.textContent = value;
  }

  function renderAll() {
    renderTaskList();
    renderDashboard();
  }

  /* ---------------- task mutations ---------------- */
  function addTask(title, opts) {
    if (!title || !title.trim()) return;
    const t = {
      id: uid(),
      title: title.trim(),
      desc: (opts && opts.desc) || "",
      priority: (opts && opts.priority) || "medium",
      category: (opts && opts.category) || "personal",
      dueDate: (opts && opts.dueDate) || "",
      dueTime: (opts && opts.dueTime) || "",
      completed: false,
      completedAt: null,
      createdAt: Date.now(),
    };
    tasks.push(t);
    save("flp:tasks", tasks);
    renderAll();
  }

  function toggleComplete(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    t.completed = !t.completed;
    t.completedAt = t.completed ? Date.now() : null;
    if (t.completed) {
      const ds = todayStr();
      if (!completedDays.includes(ds)) {
        completedDays.push(ds);
        save("flp:completedDays", completedDays);
      }
    }
    save("flp:tasks", tasks);
    renderAll();
  }

  function deleteTask(id) {
    const idx = tasks.findIndex((x) => x.id === id);
    if (idx === -1) return;
    lastDeleted = { task: tasks[idx], index: idx };
    tasks.splice(idx, 1);
    save("flp:tasks", tasks);
    selected.delete(id);
    renderAll();
    showToast("Task deleted", "Undo", () => {
      if (!lastDeleted) return;
      tasks.splice(Math.min(lastDeleted.index, tasks.length), 0, lastDeleted.task);
      save("flp:tasks", tasks);
      lastDeleted = null;
      renderAll();
    });
  }

  function bulkComplete() {
    tasks.forEach((t) => {
      if (selected.has(t.id)) {
        t.completed = true;
        t.completedAt = Date.now();
      }
    });
    const ds = todayStr();
    if (!completedDays.includes(ds)) {
      completedDays.push(ds);
      save("flp:completedDays", completedDays);
    }
    save("flp:tasks", tasks);
    selected.clear();
    renderAll();
  }

  function bulkDelete() {
    if (selected.size === 0) return;
    tasks = tasks.filter((t) => !selected.has(t.id));
    save("flp:tasks", tasks);
    selected.clear();
    renderAll();
    showToast("Selected tasks deleted");
  }

  /* ---------------- edit modal ---------------- */
  function openEditModal(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    $("#edit-title").value = t.title;
    $("#edit-desc").value = t.desc || "";
    $("#edit-priority").value = t.priority;
    $("#edit-category").value = t.category;
    $("#edit-date").value = t.dueDate || "";
    $("#edit-time").value = t.dueTime || "";
    const modal = $("#edit-modal");
    modal.dataset.editingId = id;
    if (typeof modal.showModal === "function") modal.showModal();
  }

  function saveEditModal() {
    const id = $("#edit-modal").dataset.editingId;
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    t.title = $("#edit-title").value.trim() || t.title;
    t.desc = $("#edit-desc").value;
    t.priority = $("#edit-priority").value;
    t.category = $("#edit-category").value;
    t.dueDate = $("#edit-date").value;
    t.dueTime = $("#edit-time").value;
    save("flp:tasks", tasks);
    renderAll();
  }

  /* ---------------- confirm modal ---------------- */
  let confirmHandler = null;
  function confirmAction(title, message, onConfirm) {
    const modal = $("#confirm-modal");
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    const okBtn = $("#confirm-ok");
    if (confirmHandler) okBtn.removeEventListener("click", confirmHandler);
    confirmHandler = () => {
      onConfirm();
      modal.close();
    };
    okBtn.addEventListener("click", confirmHandler);
    if (typeof modal.showModal === "function") modal.showModal();
  }

  /* ---------------- pomodoro / focus timer ---------------- */
  const RING_CIRC = 565.5;
  let timerState = {
    mode: "focus",
    remaining: settings.lenFocus * 60,
    total: settings.lenFocus * 60,
    running: false,
    handle: null,
  };

  function modeMinutes(mode) {
    if (mode === "short") return settings.lenShort;
    if (mode === "long") return settings.lenLong;
    return settings.lenFocus;
  }

  function setMode(mode) {
    pauseTimer();
    timerState.mode = mode;
    const mins = modeMinutes(mode);
    timerState.remaining = mins * 60;
    timerState.total = mins * 60;
    $all(".mode-row .chip").forEach((c) => c.classList.toggle("active", c.dataset.mode === mode));
    setText("#aperture-mode", mode === "focus" ? "Focus" : mode === "short" ? "Short break" : "Long break");
    renderTimer();
  }

  function renderTimer() {
    const mins = Math.floor(timerState.remaining / 60);
    const secs = timerState.remaining % 60;
    setText("#aperture-time", `${pad(mins)}:${pad(secs)}`);
    const ring = $("#aperture-ring");
    if (ring) {
      const frac = timerState.total > 0 ? timerState.remaining / timerState.total : 0;
      ring.setAttribute("stroke-dashoffset", String(RING_CIRC * (1 - frac)));
    }
  }

  function startTimer() {
    if (timerState.running) return;
    timerState.running = true;
    timerState.handle = setInterval(() => {
      timerState.remaining--;
      if (timerState.remaining <= 0) {
        clearInterval(timerState.handle);
        timerState.running = false;
        onTimerComplete();
        return;
      }
      renderTimer();
    }, 1000);
  }

  function pauseTimer() {
    timerState.running = false;
    clearInterval(timerState.handle);
  }

  function resetTimer() {
    pauseTimer();
    const mins = modeMinutes(timerState.mode);
    timerState.remaining = mins * 60;
    timerState.total = mins * 60;
    renderTimer();
  }
const timerSound = document.getElementById("timerSound");
const customTimerSound = document.getElementById("customTimerSound");

if (customTimerSound && timerSound) {
  customTimerSound.addEventListener("change", function () {
    const file = customTimerSound.files[0];

    if (!file) return;

    const soundUrl = URL.createObjectURL(file);
    timerSound.src = soundUrl;
    timerSound.load();
  });
}

function playTimerSound() {
  if (!timerSound) return;

  timerSound.currentTime = 0;
  timerSound.play().catch(function () {
    console.log("Timer sound could not play yet. The user may need to click the page first.");
  });
}
  function onTimerComplete() {
  playTimerSound();

  if (timerState.mode === "focus") {
      const ds = todayStr();
      focusLog[ds] = (focusLog[ds] || 0) + modeMinutes("focus");
      save("flp:focusLog", focusLog);
      logSession(modeMinutes("focus"));
      renderDashboard();
      showToast("Focus session complete. Nice work.");
    } else {
      showToast("Break's over.");
    }
    renderTimer();
    if (settings.autoStart) {
      const next = timerState.mode === "focus" ? "short" : "focus";
      setMode(next);
      startTimer();
    }
  }

  function logSession(minutes) {
    const el = $("#session-log");
    if (!el) return;
    if (el.dataset.count === undefined) el.dataset.count = "0";
    const count = parseInt(el.dataset.count, 10) + 1;
    el.dataset.count = String(count);
    const time = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const line = document.createElement("p");
    line.textContent = `${time} · ${minutes} min focus session`;
    if (count === 1) el.innerHTML = "";
    el.appendChild(line);
  }

  /* ---------------- settings ---------------- */
  function applySettingsToUI() {
    $("#username-input").value = settings.username;
    $("#goal-daily").value = settings.goalDaily;
    $("#goal-weekly").value = settings.goalWeekly;
    $("#len-focus").value = settings.lenFocus;
    $("#len-short").value = settings.lenShort;
    $("#len-long").value = settings.lenLong;
    $("#auto-start").checked = settings.autoStart;
    $("#light-switch").classList.toggle("on", settings.theme === "light");
    $("#wallpaper-switch").classList.toggle("on", settings.wallpaper !== false);
    document.documentElement.setAttribute("data-theme", settings.theme);
    document.body.classList.toggle("no-wallpaper", settings.wallpaper === false);
  }

  function bindSettings() {
    $("#username-input").addEventListener("change", (e) => {
      settings.username = e.target.value;
      save("flp:settings", settings);
    });
    $("#goal-daily").addEventListener("change", (e) => {
      settings.goalDaily = parseInt(e.target.value, 10) || 1;
      save("flp:settings", settings);
      renderDashboard();
    });
    $("#goal-weekly").addEventListener("change", (e) => {
      settings.goalWeekly = parseInt(e.target.value, 10) || 1;
      save("flp:settings", settings);
      renderDashboard();
    });
    ["len-focus", "len-short", "len-long"].forEach((id) => {
      $("#" + id).addEventListener("change", (e) => {
        const key = id === "len-focus" ? "lenFocus" : id === "len-short" ? "lenShort" : "lenLong";
        settings[key] = parseInt(e.target.value, 10) || 1;
        save("flp:settings", settings);
        if (timerState.mode === (key === "lenFocus" ? "focus" : key === "lenShort" ? "short" : "long")) {
          resetTimer();
        }
      });
    });
    $("#auto-start").addEventListener("change", (e) => {
      settings.autoStart = e.target.checked;
      save("flp:settings", settings);
    });
    $("#light-switch").addEventListener("click", () => {
      settings.theme = settings.theme === "light" ? "dark" : "light";
      save("flp:settings", settings);
      applySettingsToUI();
    });
    $("#wallpaper-switch").addEventListener("click", () => {
      settings.wallpaper = !(settings.wallpaper !== false);
      save("flp:settings", settings);
      applySettingsToUI();
    });
    $("#theme-toggle").addEventListener("click", () => $("#light-switch").click());

    $("#export-btn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ tasks, settings, focusLog, completedDays }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "focus-list-pro-backup.json";
      a.click();
      URL.revokeObjectURL(url);
    });
    $("#import-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (Array.isArray(data.tasks)) tasks = data.tasks;
          if (data.settings) settings = Object.assign(settings, data.settings);
          if (data.focusLog) focusLog = data.focusLog;
          if (Array.isArray(data.completedDays)) completedDays = data.completedDays;
          save("flp:tasks", tasks);
          save("flp:settings", settings);
          save("flp:focusLog", focusLog);
          save("flp:completedDays", completedDays);
          applySettingsToUI();
          renderAll();
          showToast("Backup imported.");
        } catch (err) {
          showToast("That file couldn't be read as a backup.");
        }
      };
      reader.readAsText(file);
    });
    $("#reset-btn").addEventListener("click", () => {
      confirmAction("Reset all data?", "This clears every task and setting on this device. This can't be undone.", () => {
        tasks = [];
        focusLog = {};
        completedDays = [];
        save("flp:tasks", tasks);
        save("flp:focusLog", focusLog);
        save("flp:completedDays", completedDays);
        renderAll();
        showToast("All data reset.");
      });
    });
  }

  /* ---------------- wiring ---------------- */
  function bindNav() {
    $all(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.dataset.nav));
    });
  }

  function bindTasksUI() {
    $("#add-btn").addEventListener("click", submitComposer);
    $("#task-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitComposer();
    });
    function submitComposer() {
      const title = $("#task-input").value;
      addTask(title, {
        priority: $("#priority-select").value,
        category: $("#category-select").value,
        dueDate: $("#due-date-input").value,
        dueTime: $("#due-time-input").value,
      });
      $("#task-input").value = "";
      $("#due-date-input").value = "";
      $("#due-time-input").value = "";
    }

    $("#search-input").addEventListener("input", (e) => {
      searchTerm = e.target.value;
      renderTaskList();
    });
    $all("#filter-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        filter = chip.dataset.filter;
        $all("#filter-chips .chip").forEach((c) => c.classList.toggle("active", c === chip));
        renderTaskList();
      });
    });
    $("#sort-select").addEventListener("change", (e) => {
      sortBy = e.target.value;
      renderTaskList();
    });
    $("#bulk-complete").addEventListener("click", bulkComplete);
    $("#bulk-delete").addEventListener("click", () => {
      if (selected.size === 0) return;
      confirmAction("Delete selected tasks?", `This removes ${selected.size} task(s).`, bulkDelete);
    });

    $("#edit-form").addEventListener("submit", (e) => {
      e.preventDefault();
      saveEditModal();
      $("#edit-modal").close();
    });
    $("#edit-cancel").addEventListener("click", () => $("#edit-modal").close());
    $("#confirm-cancel").addEventListener("click", () => $("#confirm-modal").close());
    $("#confirm-modal").addEventListener("close", () => {
      if (confirmHandler) {
        $("#confirm-ok").removeEventListener("click", confirmHandler);
        confirmHandler = null;
      }
    });
  }

  function bindFocusUI() {
    $all(".mode-row .chip").forEach((chip) => {
      chip.addEventListener("click", () => setMode(chip.dataset.mode));
    });
    $("#timer-start").addEventListener("click", startTimer);
    $("#timer-pause").addEventListener("click", pauseTimer);
    $("#timer-reset").addEventListener("click", resetTimer);
  }

  function bindGlobal() {
    $("#focus-mode-toggle").addEventListener("click", () => {
      document.body.classList.toggle("focus-mode");
    });
    $("#fab").addEventListener("click", () => {
      const modal = $("#quick-add-modal");
      if (typeof modal.showModal === "function") modal.showModal();
      $("#quick-text").value = "";
      setTimeout(() => $("#quick-text").focus(), 50);
    });
    $("#quick-add-form").addEventListener("submit", (e) => {
      e.preventDefault();
      addTask($("#quick-text").value, {});
      $("#quick-add-modal").close();
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setView("tasks");
        $("#search-input").focus();
      } else if ((e.key === "n" || e.key === "N") && !typing) {
        e.preventDefault();
        $("#fab").click();
      } else if (e.key === "Escape") {
        $all("dialog[open]").forEach((d) => d.close());
      }
    });
  }

  /* ---------------- init ---------------- */
  function init() {
    try {
      applySettingsToUI();
      bindNav();
      bindTasksUI();
      bindFocusUI();
      bindSettings();
      bindGlobal();
      setMode("focus");
      renderAll();
      tickClock();
      setInterval(tickClock, 15000);
    } catch (err) {
      console.error("Focus List Pro failed to initialize:", err);
      showToast("Something didn't load right. Check the console for details.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
