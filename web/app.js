// ===== 共用狀態與工具 =====
const C = window.ICELAND_APP_CONFIG || {};
let travel = [],
  expenses = [],
  activeSpotFilter = "全部",
  activeExpenseDateFilter = "all";
const $ = (id) => document.getElementById(id),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const show = (id, on) => $(id).classList.toggle("hidden", !on);
function status(message, error = false) {
  const indicator = $("status");
  if (!indicator) return;

  const busy = /正在/.test(message) && !error;
  indicator.textContent = error ? "!" : busy ? "…" : "✓";
  indicator.className = `status ${error ? "error" : busy ? "busy" : "ready"}`;
  indicator.title = message;
  indicator.setAttribute("aria-label", message);
}
// ===== Notion 同步 API =====
async function api(kind, method = "GET", body, params = {}) {
  const u = new URL(C.syncFunctionUrl);
  u.searchParams.set("kind", kind);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers = {
    apikey: C.supabasePublishableKey,
    "Content-Type": "application/json",
  };
  const r = await fetch(u, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok || j.ok === false)
    throw Error(j.error || `同步失敗（${r.status}）`);
  return j;
}
function p(r, n) {
  return (r.properties || {})[n];
}
function dateOf(r) {
  return p(r, "Time")?.start || "";
}
function endOf(r) {
  return p(r, "Time")?.end || "";
}
function dayOf(r) {
  return localInputValue(dateOf(r)).slice(0, 10);
}
function timeMinutes(value) {
  const local = localInputValue(value),
    m = local.match(/T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function timeLabel(value) {
  const local = localInputValue(value),
    m = local.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "未排時間";
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function datePlus(date, days) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function firstTravelDate() {
  return travel.map(dayOf).filter(Boolean).sort()[0] || "";
}
function createdDateOf(record) {
  return localInputValue(record.createdTime).slice(0, 10);
}
function dateText(value) {
  return value ? value.replaceAll("-", "/") : "未分類";
}
function twdValue(record) {
  return Number(p(record, "台幣估算") || 0);
}
function localInputValue(value) {
  const text = String(value || "");
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00`;
  const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(text);
  const d = new Date(hasZone ? text : `${text}+08:00`);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(d)
    .reduce((o, x) => ((o[x.type] = x.value), o), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function notionStamp(date, minutes) {
  return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00+08:00`;
}
function mapUrl(r) {
  const existing = p(r, "Google Maps 連結");
  if (existing) return existing;
  const place =
    p(r, "地點")?.address || p(r, "地點")?.name || p(r, "Name") || "";
  return place
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
    : "#";
}
// ===== 景點小卡與詳細內容 =====
function iconMarkup(record) {
  const icon = record.icon;
  if (!icon) return "";

  if (icon.type === "emoji" && icon.emoji) {
    return `<span class="spot-icon" aria-hidden="true">${esc(icon.emoji)}</span>`;
  }

  const imageUrl = icon.custom_emoji?.url || icon.external?.url;
  if (imageUrl && /^https?:\/\//.test(imageUrl)) {
    return `<img class="spot-icon-image" src="${esc(imageUrl)}" alt="" aria-hidden="true">`;
  }

  return "";
}

function spotCard(r, showDate = true) {
  return `<article class="card spot-card" data-spot-card data-spot-id="${esc(r.id)}"><div class="spot-summary"><h3>${iconMarkup(r)}${esc(p(r, "Name") || "未命名景點")}</h3><div class="spot-actions"><span class="tag">${esc(p(r, "標籤") || "未分類")}</span><a class="spot-map" href="${esc(mapUrl(r))}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">地圖</a></div></div></article>`;
}

function inlineMarkup(value) {
  return esc(value)
    .replace(
      /&lt;(b|strong)&gt;([\s\S]*?)&lt;\/(b|strong)&gt;/g,
      "<strong>$2</strong>",
    )
    .replace(/&lt;(i|em)&gt;([\s\S]*?)&lt;\/(i|em)&gt;/g, "<em>$2</em>")
    .replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, "<u>$1</u>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>");
}

function markdownToHtml(text) {
  const lines = String(text || "Notion 尚未填寫詳細內容。").split(/\r?\n/);

  return lines
    .map((rawLine) => {
      const line = inlineMarkup(rawLine);
      const trimmed = line.trim();

      if (/^### /.test(trimmed)) return `<h4>${trimmed.slice(4)}</h4>`;
      if (/^## /.test(trimmed)) return `<h3>${trimmed.slice(3)}</h3>`;
      if (/^# /.test(trimmed)) return `<h2>${trimmed.slice(2)}</h2>`;
      if (/^<strong>.*<\/strong>$/.test(trimmed)) {
        return `<h3>${trimmed.replace(/^<strong>|<\/strong>$/g, "")}</h3>`;
      }
      if (/^[-*] /.test(trimmed)) return `<p>• ${trimmed.slice(2)}</p>`;
      return trimmed ? `<p>${trimmed}</p>` : "<br>";
    })
    .join("");
}
function openSpotModal(id) {
  const r = travel.find((x) => x.id === id);
  if (!r) return;
  $("spotModalTitle").innerHTML =
    `${iconMarkup(r)}${esc(p(r, "Name") || "景點說明")}`;
  $("spotModalMeta").textContent = p(r, "標籤") || "未分類";
  $("spotModalBody").innerHTML = markdownToHtml(r.content);
  const link = $("spotModalMap");
  link.href = mapUrl(r);
  link.classList.toggle("hidden", mapUrl(r) === "#");
  $("spotModal").classList.remove("hidden");
}
function closeSpotModal() {
  $("spotModal").classList.add("hidden");
}
// ===== 頁面呈現：總覽、景點與待辦 =====
function renderOverview() {
  const groups = [
    ["航班", travel.filter((r) => p(r, "標籤") === "航班")],
    ["住宿", travel.filter((r) => p(r, "標籤") === "住宿")],
    [
      "所有旅行路線",
      travel.filter((r) => ["路線", "交通"].includes(p(r, "標籤"))),
    ],
  ];
  $("overviewGrid").innerHTML = groups
    .map(
      ([title, rows]) =>
        `<article class="card"><h3>${esc(title)}</h3><div class="overview-list">${rows.length ? rows.map((r) => `<div class="overview-item"><strong>${esc(p(r, "Name") || "未命名")}</strong><div class="small muted">${esc(dateOf(r) ? `${dayOf(r)} ${timeLabel(dateOf(r))}` : "待補充")}</div></div>`).join("") : '<div class="muted">尚未建立資料</div>'}</div></article>`,
    )
    .join("");
}
function renderSpecialLinks() {
  const rows = travel.filter((r) => p(r, "Google Maps 連結"));
  $("specialLinks").innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            `<a class="overview-item" href="${esc(mapUrl(r))}" target="_blank" rel="noreferrer"><strong>${esc(p(r, "Name") || "未命名")}</strong><div class="small muted">開啟連結</div></a>`,
        )
        .join("")
    : '<div class="muted">目前尚未有備用連結。</div>';
}
function todoKey(day) {
  return `iceland-todos-${day}`;
}
function renderTodoList(day) {
  const box = $(`day${day}Todo`);
  if (!box) return;
  let todos = [];
  try {
    todos = JSON.parse(localStorage.getItem(todoKey(day)) || "[]");
  } catch {}
  if (!todos.length)
    todos = [
      { done: false, text: "" },
      { done: false, text: "" },
      { done: false, text: "" },
    ];
  box.innerHTML = `<h3>當日待辦事項</h3>${todos.map((todo, i) => `<label class="todo-row"><input type="checkbox" data-todo-day="${day}" data-todo-index="${i}" ${todo.done ? "checked" : ""}><input type="text" placeholder="新增待辦事項" value="${esc(todo.text)}" data-todo-day="${day}" data-todo-index="${i}"></label>`).join("")}`;
  box.querySelectorAll("[data-todo-day]").forEach((input) =>
    input.addEventListener("input", () => {
      const items = [...box.querySelectorAll(".todo-row")].map((row) => ({
        done: row.querySelector("input[type=checkbox]").checked,
        text: row.querySelector("input[type=text]").value,
      }));
      localStorage.setItem(todoKey(day), JSON.stringify(items));
    }),
  );
}
function renderTravel() {
  const list = $("travelList");
  const rows =
    activeSpotFilter === "全部"
      ? travel
      : travel.filter((r) => p(r, "標籤") === activeSpotFilter);
  list.innerHTML = rows.length
    ? rows.map((r) => spotCard(r, true)).join("")
    : `<div class="muted">目前沒有「${esc(activeSpotFilter)}」資料。</div>`;
}
function renderDayCards(target, rows) {
  target.innerHTML = rows.length
    ? rows.map((r) => spotCard(r, false)).join("")
    : '<div class="muted">這天沒有已排定的景點。</div>';
}
// ===== 行事曆、拖曳與天氣 =====
function calendarHtml(rows, unscheduled = []) {
  const times = Array.from(
    { length: 25 },
    (_, i) => `<div class="calendar-time">${pad(i)}:00</div>`,
  ).join("");
  const slots = Array.from(
    { length: 24 },
    (_, i) =>
      `<div class="calendar-slot" data-time="${i * 60}" title="拖曳景點到 ${pad(i)}:00"></div>`,
  ).join("");
  const events = rows
    .map((r) => {
      const start = timeMinutes(dateOf(r));
      if (start === null) return "";
      const end = timeMinutes(endOf(r));
      const duration = Math.max(45, (end === null ? start + 60 : end) - start);
      const top = Math.max(0, start);
      const height = Math.min(1420 - top, Math.max(46, duration));
      return `<article class="calendar-event" draggable="true" data-record-id="${esc(r.id)}" data-start-minute="${start}" data-end-minute="${Math.min(1439, start + duration)}" style="top:${top}px;height:${height}px" title="拖曳移動；拖曳底部調整結束時間"><strong>${esc(p(r, "Name") || "未命名景點")}</strong><small>${esc(timeLabel(dateOf(r)))} · ${esc(p(r, "地點")?.name || p(r, "地點")?.address || "未填地點")}</small><span class="calendar-resize-handle" aria-label="調整結束時間"></span></article>`;
    })
    .join("");
  const loose = unscheduled
    .map(
      (r) =>
        `<article class="calendar-event unscheduled-event" draggable="true" data-record-id="${esc(r.id)}"><strong>${esc(p(r, "Name") || "未命名景點")}</strong><small>尚未排時間</small></article>`,
    )
    .join("");
  return `${loose ? `<div class="unscheduled"><strong>尚未排入時間</strong><div class="small muted">把下面的景點拖到時間格，就會更新 Notion。</div><div>${loose}</div></div>` : ""}<div class="calendar-body"><div class="calendar-times">${times}</div><div class="calendar-board">${slots}${events}</div></div>`;
}
function snapMinutes(value) {
  return Math.max(0, Math.min(1439, Math.round(value / 15) * 15));
}

function minutesFromPointer(event, board) {
  const rect = board.getBoundingClientRect();
  return snapMinutes(event.clientY - rect.top);
}

function bindCalendar(target, editable = true) {
  if (!editable) return;
  const board = target.querySelector(".calendar-board");

  target.querySelectorAll('.calendar-event[draggable="true"]').forEach((card) =>
    card.addEventListener("dragstart", (e) => {
      if (e.target.closest(".calendar-resize-handle")) return;
      e.dataTransfer.setData("text/plain", card.dataset.recordId);
      e.dataTransfer.effectAllowed = "move";
    }),
  );

  target.querySelectorAll(".calendar-slot").forEach((slot) => {
    slot.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    slot.addEventListener("drop", async (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      if (id) await moveEvent(id, minutesFromPointer(e, board));
    });
  });

  board?.addEventListener("dragover", (e) => e.preventDefault());
  board?.addEventListener("drop", async (e) => {
    if (e.target.closest(".calendar-event")) return;
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (id) await moveEvent(id, minutesFromPointer(e, board));
  });

  target.querySelectorAll(".calendar-resize-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (startEvent) => {
      startEvent.preventDefault();
      startEvent.stopPropagation();
      const card = handle.closest(".calendar-event");
      const id = card?.dataset.recordId;
      if (!card || !id || !board) return;
      handle.setPointerCapture?.(startEvent.pointerId);

      const onMove = (moveEvent) => {
        const start = Number(card.dataset.startMinute || 0);
        const end = Math.max(start + 45, minutesFromPointer(moveEvent, board));
        card.style.height = `${Math.max(46, end - start)}px`;
        card.dataset.previewEndMinute = String(end);
      };
      const onUp = async (endEvent) => {
        handle.releasePointerCapture?.(endEvent.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        const start = Number(card.dataset.startMinute || 0);
        const end = Math.max(
          start + 45,
          Number(
            card.dataset.previewEndMinute ||
              card.dataset.endMinute ||
              start + 60,
          ),
        );
        delete card.dataset.previewEndMinute;
        await resizeEvent(id, end);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  });
}
function renderCalendar(target, rows, unscheduled = [], editable = true) {
  target.innerHTML = calendarHtml(rows, unscheduled);
  bindCalendar(target, editable);
}
function renderSchedule() {
  const filter = $("dateFilter").value;
  const rows = travel
    .filter((r) => dayOf(r) === filter)
    .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const unscheduled = travel.filter((r) => !dateOf(r));
  renderCalendar($("calendar"), rows, unscheduled);
  loadWeather(rows, filter, "weather");
}
function renderDailyPages() {
  const first = firstTravelDate();
  for (let i = 1; i <= 10; i++) {
    const target = $(`day${i}List`),
      label = $(`day${i}Label`),
      weatherId = `day${i}Weather`;
    if (!target) continue;
    if (!first) {
      if (label) label.textContent = "";
      renderDayCards(target, []);
      renderTodoList(i);
      loadWeather([], "", weatherId);
      continue;
    }
    const date = datePlus(first, i - 1),
      rows = travel
        .filter((r) => dayOf(r) === date)
        .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    if (label) label.textContent = "";
    renderDayCards(target, rows);
    renderTodoList(i);
    loadWeather(rows, date, weatherId);
  }
}
async function loadWeather(rows, filter, boxId = "weather") {
  const box = $(boxId);
  const row = rows[0];
  const date = (filter || "").slice(0, 10);
  const place = row
    ? p(row, "地點")?.address || p(row, "地點")?.name || p(row, "Name") || ""
    : "";
  box.classList.remove("hidden");
  if (!date) {
    box.textContent =
      "尚未有可查詢的日期：請先在 Notion 行程規劃的 Time 欄位填入日期。";
    return;
  }
  if (!place) {
    box.textContent = `${date} 尚未有地點，請先在當日行程填入「地點」。`;
    return;
  }
  try {
    box.textContent = "正在查詢當地天氣…";
    const g = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=zh&format=json`,
    ).then((r) => r.json());
    const hit = g.results?.[0];
    if (!hit) throw Error("找不到地點座標");
    const f = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max&timezone=auto&start_date=${date}&end_date=${date}`,
    ).then((r) => r.json());
    if (f.error || !f.daily?.time?.length)
      throw Error("這個日期太遠，Open-Meteo 目前沒有預報資料");
    const max = Number(f.daily.temperature_2m_max?.[0]);
    const min = Number(f.daily.temperature_2m_min?.[0]);
    const rain = Number(f.daily.precipitation_probability_max?.[0]);
    const wind = Number(f.daily.windspeed_10m_max?.[0]);
    const outfit = wind >= 30 || rain >= 45 ? "防風防水外套、保暖中層、防滑鞋" : min <= 3 ? "保暖外套、帽子手套、防滑鞋" : "洋蔥式穿搭，備一件防風外套";
    box.innerHTML = `<strong>${esc(date)} 天氣</strong> · ${esc(hit.name || place)}<br>最高 ${esc(max)}°C／最低 ${esc(min)}°C · 降雨機率 ${esc(rain)}% · 最大風速 ${esc(wind)} km/h<br><strong>穿搭建議：</strong>${esc(outfit)}<br><span class="small">資料來源：Open-Meteo；遠期日期可能沒有預報，出發前請再次確認。</span>`;
  } catch (e) {
    box.textContent = `${date} 的天氣目前無法取得：${e.message}`;
  }
}
async function resizeEvent(id, targetEndMinutes) {
  const record = travel.find((item) => item.id === id);
  if (!record) return;
  const day = dayOf(record);
  const start = timeMinutes(dateOf(record));
  if (!day || start === null) return;

  const end = Math.max(
    start + 45,
    Math.min(1439, snapMinutes(targetEndMinutes)),
  );
  try {
    status("正在更新行程時間…");
    await api("travel", "PATCH", {
      id,
      properties: {
        Time: {
          start: notionStamp(day, start),
          end: notionStamp(day, end),
        },
      },
    });
    await syncTravel();
    status("行程時間已更新到 Notion");
  } catch (error) {
    status(error.message, true);
  }
}

async function moveEvent(id, targetMinutes) {
  const r = travel.find((x) => x.id === id);
  const day = $("dateFilter").value || dayOf(r);
  if (!r || !day) return;
  const oldStart = timeMinutes(dateOf(r));
  const oldEnd = timeMinutes(endOf(r));
  const duration =
    oldStart !== null && oldEnd !== null && oldEnd > oldStart
      ? oldEnd - oldStart
      : 60;
  const start = Number(targetMinutes);
  const newStart = notionStamp(day, start);
  const endMinute = Math.min(1439, start + duration);
  const newEnd = notionStamp(day, endMinute);
  try {
    status("正在更新行程時間…");
    await api("travel", "PATCH", {
      id,
      properties: { Time: { start: newStart, end: newEnd } },
    });
    await syncTravel();
    status("行程時間已更新到 Notion");
  } catch (e) {
    status(e.message, true);
  }
}
// ===== 記帳、匯率與匯出 =====
function expenseRowsForFilter() {
  const first = firstTravelDate();
  if (activeExpenseDateFilter === "all") return expenses;
  if (activeExpenseDateFilter === "before") {
    return expenses.filter((r) => createdDateOf(r) < "2027-11-01");
  }
  if (activeExpenseDateFilter.startsWith("day-")) {
    const day = Number(activeExpenseDateFilter.slice(4));
    const date = first ? datePlus(first, day - 1) : "";
    return expenses.filter((r) => createdDateOf(r) === date);
  }
  return expenses;
}

function expenseFilterButtons() {
  const first = firstTravelDate();
  const buttons = [
    { id: "all", label: "ALL", aria: "全部日期" },
    { id: "before", label: "行前", aria: "2027/11 月前" },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `day-${index + 1}`,
      label: `D${index + 1}`,
      date: first ? dateText(datePlus(first, index)) : "",
    })),
  ];

  $("expenseDateFilters").innerHTML = buttons
    .map(
      (button) =>
        `<button class="filter-button ${activeExpenseDateFilter === button.id ? "active" : ""}" type="button" data-expense-filter="${button.id}" aria-label="${button.aria || button.label}" title="${button.aria || button.label}">${button.label}</button>`,
    )
    .join("");
}

function renderExpenses() {
  expenseFilterButtons();
  const rows = expenseRowsForFilter().sort((a, b) =>
    String(b.createdTime || "").localeCompare(String(a.createdTime || "")),
  );
  const total = rows.reduce((sum, record) => sum + twdValue(record), 0);
  $("expenseSummary").textContent = `NT$ ${total.toLocaleString("zh-TW")}`;
  $("expenseList").innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            `<tr><td>${esc(p(r, "Name"))}</td><td>${esc(p(r, "類別"))}</td><td>${esc(p(r, "原幣別"))}</td><td>${esc(p(r, "原始金額") ?? "")}</td><td>${esc(p(r, "台幣估算") ?? "")}</td><td>${esc(createdDateOf(r) ? `${dateText(createdDateOf(r))}` : "")}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6" class="muted">目前沒有費用</td></tr>';
}
async function syncTravel() {
  try {
    travel =
      (await api("travel", "GET", undefined, { content: "true" })).records ||
      [];
    if (!$("dateFilter").value && firstTravelDate())
      $("dateFilter").value = firstTravelDate();
    renderTravel();
    renderOverview();
    renderSpecialLinks();
    renderSchedule();
    renderDailyPages();
  } catch (e) {
    status(e.message, true);
    throw e;
  }
}
async function syncExpenses() {
  try {
    expenses =
      (await api("expenses", "GET", undefined, { content: "false" })).records ||
      [];
    renderExpenses();
  } catch (e) {
    status(e.message, true);
  }
}
async function syncAll() {
  try {
    status("正在自動同步資料…");
    await syncTravel();
    await syncExpenses();
    status("同步完成");
  } catch (e) {
    status(e.message, true);
  }
}
async function addExpense(e) {
  e.preventDefault();
  try {
    status("正在寫入 Notion…");
    await convertToTwd();
    if (!$("expenseOriginal").value) throw Error("請輸入金額");
    await api("expenses", "POST", {
      properties: {
        Name: $("expenseName").value,
        類別: $("expenseCategory").value,
        原幣別: $("expenseCurrency").value,
        原始金額: Number($("expenseOriginal").value),
        台幣估算: Number($("expenseTwd").value || 0),
      },
    });
    $("expenseForm").reset();
    $("expenseCurrency").value = "ISK";
    document
      .querySelectorAll("[data-currency]")
      .forEach((x) =>
        x.classList.toggle("active", x.dataset.currency === "ISK"),
      );
    $("expenseTwd").value = "";
    await syncExpenses();
    status("記帳已儲存");
  } catch (e) {
    status(e.message, true);
  }
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 600);
}
function exportCsv() {
  const rows = [
    ["項目", "類別", "原幣別", "原始金額", "台幣估算", "記帳時間"],
    ...expenses.map((r) => [
      p(r, "Name"),
      p(r, "類別"),
      p(r, "原幣別"),
      p(r, "原始金額"),
      p(r, "台幣估算"),
      createdDateOf(r),
    ]),
  ];
  download(
    "冰島費用紀錄.csv",
    "\ufeff" +
      rows
        .map((x) =>
          x
            .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
            .join(","),
        )
        .join("\n"),
    "text/csv;charset=utf-8",
  );
}
function exportXls() {
  const rows = expenses
    .map(
      (r) =>
        `<tr><td>${esc(p(r, "Name"))}</td><td>${esc(p(r, "類別"))}</td><td>${esc(p(r, "原幣別"))}</td><td>${esc(p(r, "原始金額"))}</td><td>${esc(p(r, "台幣估算"))}</td><td>${esc(createdDateOf(r))}</td></tr>`,
    )
    .join("");
  download(
    "冰島費用紀錄.xls",
    '<meta charset="UTF-8"><table border="1"><tr><th>項目</th><th>類別</th><th>原幣別</th><th>原始金額</th><th>台幣估算</th><th>記帳時間</th></tr>' +
      rows +
      "</table>",
    "application/vnd.ms-excel;charset=utf-8",
  );
}
let rateTimer;
async function convertToTwd() {
  const currency = $("expenseCurrency").value;
  const amount = Number($("expenseOriginal").value);
  if (!amount) {
    $("expenseTwd").value = "";

    return;
  }
  if (currency === "TWD") {
    $("expenseTwd").value = amount;

    return;
  }
  try {
    const j = await fetch(
      `https://api.frankfurter.app/latest?from=${currency}&to=TWD`,
    ).then((r) => r.json());
    const rate = Number(j.rates?.TWD);
    if (!rate) throw Error("找不到匯率");
    $("expenseTwd").value = Math.round(amount * rate);
  } catch (e) {
    status("台幣換算失敗：" + e.message, true);
  }
}
$("expenseCurrency").onchange = convertToTwd;
document.querySelectorAll("[data-currency]").forEach(
  (button) =>
    (button.onclick = () => {
      document
        .querySelectorAll("[data-currency]")
        .forEach((x) => x.classList.toggle("active", x === button));
      $("expenseCurrency").value = button.dataset.currency;
      convertToTwd();
    }),
);
$("expenseOriginal").oninput = () => {
  clearTimeout(rateTimer);
  rateTimer = setTimeout(convertToTwd, 350);
};
// ===== 導航與事件綁定 =====
function showPage(id) {
  document
    .querySelectorAll(".section")
    .forEach((x) => x.classList.remove("active"));
  const page = $(id);
  if (page) page.classList.add("active");
  const itinerary = id === "schedule" || id.startsWith("day");
  $("itineraryNav").classList.toggle("hidden", !itinerary);
  document
    .querySelectorAll("[data-itinerary-tab]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.itineraryTab === id),
    );
  const main = id.startsWith("day") ? "schedule" : id;
  document
    .querySelectorAll("[data-main-tab]")
    .forEach((x) => x.classList.toggle("active", x.dataset.mainTab === main));
  if (id === "schedule") renderSchedule();
  if (id.startsWith("day")) renderDailyPages();
}
$("expenseForm").onsubmit = addExpense;
$("dateFilter").onchange = renderSchedule;
$("prevDay").onclick = () => {
  const d = $("dateFilter").value;
  if (d) {
    $("dateFilter").value = datePlus(d, -1);
    renderSchedule();
  }
};
$("nextDay").onclick = () => {
  const d = $("dateFilter").value;
  if (d) {
    $("dateFilter").value = datePlus(d, 1);
    renderSchedule();
  }
};
$("exportCsv").onclick = exportCsv;
$("exportXls").onclick = exportXls;
$("addExpenseJump").onclick = () => showPage("expenses");
document.addEventListener("click", async (e) => {
  const filter = e.target.closest("[data-spot-filter]");
  if (filter) {
    activeSpotFilter = filter.dataset.spotFilter;
    document
      .querySelectorAll("[data-spot-filter]")
      .forEach((x) => x.classList.toggle("active", x === filter));
    renderTravel();
    return;
  }
  const card = e.target.closest("[data-spot-card]");
  if (card && !e.target.closest("a,button,input,select,textarea")) {
    openSpotModal(card.dataset.spotId);
    return;
  }
  const expenseFilter = e.target.closest("[data-expense-filter]");
  if (expenseFilter) {
    activeExpenseDateFilter = expenseFilter.dataset.expenseFilter;
    renderExpenses();
    return;
  }
  const main = e.target.closest("[data-main-tab]");
  if (main) {
    showPage(main.dataset.mainTab);
    return;
  }
  const itinerary = e.target.closest("[data-itinerary-tab]");
  if (itinerary) {
    showPage(itinerary.dataset.itineraryTab);
    return;
  }
});
$("closeSpotModal").onclick = closeSpotModal;
$("spotModal").onclick = (e) => {
  if (e.target.id === "spotModal") closeSpotModal();
};
showPage("overview");
syncAll();
