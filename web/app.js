// ===== 共用狀態與工具 =====
const C = window.ICELAND_APP_CONFIG || {};
let travel = [],
  expenses = [],
  activeSpotFilter = "全部";
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
function status(t, error = false) {
  $("status").textContent = t;
  $("status").className = "status" + (error ? " error" : "");
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
function spotCard(r, showDate = true) {
  return `<article class="card spot-card" data-spot-card data-spot-id="${esc(r.id)}"><div class="spot-summary"><h3>${esc(p(r, "Name") || "未命名景點")}</h3><span class="tag">${esc(p(r, "標籤") || "未分類")}</span><a class="spot-map" href="${esc(mapUrl(r))}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">開啟地標導航</a></div></article>`;
}
function markdownToHtml(text) {
  const lines = esc(text || "Notion 尚未填寫詳細內容。").split("\n");
  return lines
    .map((line) => {
      if (/^### /.test(line)) return `<h4>${line.slice(4)}</h4>`;
      if (/^## /.test(line)) return `<h3>${line.slice(3)}</h3>`;
      if (/^# /.test(line)) return `<h2>${line.slice(2)}</h2>`;
      if (/^[-*] /.test(line)) return `<p>• ${line.slice(2)}</p>`;
      return line ? `<p>${line}</p>` : "<br>";
    })
    .join("");
}
function openSpotModal(id) {
  const r = travel.find((x) => x.id === id);
  if (!r) return;
  $("spotModalTitle").textContent = p(r, "Name") || "景點說明";
  $("spotModalMeta").textContent =
    `${p(r, "標籤") || "未分類"}${dateOf(r) ? ` · ${dayOf(r)} ${timeLabel(dateOf(r))}` : ""}`;
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
      return `<article class="calendar-event" draggable="true" data-record-id="${esc(r.id)}" style="top:${top}px;height:${height}px" title="拖曳到其他時間格"><strong>${esc(p(r, "Name") || "未命名景點")}</strong><small>${esc(timeLabel(dateOf(r)))} · ${esc(p(r, "地點")?.name || p(r, "地點")?.address || "未填地點")}</small></article>`;
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
function bindCalendar(target, editable = true) {
  if (!editable) return;
  target.querySelectorAll('.calendar-event[draggable="true"]').forEach((card) =>
    card.addEventListener("dragstart", (e) => {
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
      if (id) await moveEvent(id, slot.dataset.time);
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
      label.textContent = "尚未有日期資料";
      renderDayCards(target, []);
      renderTodoList(i);
      loadWeather([], "", weatherId);
      continue;
    }
    const date = datePlus(first, i - 1),
      rows = travel
        .filter((r) => dayOf(r) === date)
        .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    label.textContent = `${date} · ${rows.length} 筆行程`;
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
    box.innerHTML = `<strong>${esc(date)} 天氣</strong> · ${esc(hit.name || place)}<br>最高 ${esc(f.daily.temperature_2m_max?.[0])}°C／最低 ${esc(f.daily.temperature_2m_min?.[0])}°C · 降雨機率 ${esc(f.daily.precipitation_probability_max?.[0])}% · 最大風速 ${esc(f.daily.windspeed_10m_max?.[0])} km/h<br><span class="small">資料來源：Open-Meteo；遠期日期可能沒有預報，出發前請再次確認。</span>`;
  } catch (e) {
    box.textContent = `${date} 的天氣目前無法取得：${e.message}`;
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
function renderExpenses() {
  const b = $("expenseList");
  b.innerHTML = expenses.length
    ? expenses
        .map(
          (r) =>
            `<tr><td>${esc(p(r, "Name"))}</td><td>${esc(p(r, "類別"))}</td><td>${esc(p(r, "原幣別"))}</td><td>${esc(p(r, "原始金額") ?? "")}</td><td>${esc(p(r, "台幣估算") ?? "")}</td><td>${esc(p(r, "付款方式"))}</td><td>${esc(p(r, "記帳時間") || "")}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7" class="muted">目前沒有費用資料。</td></tr>';
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
    status(`同步完成：${travel.length} 筆景點、${expenses.length} 筆費用`);
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
    $("expenseCurrency").value = "TWD";
    document
      .querySelectorAll("[data-currency]")
      .forEach((x) =>
        x.classList.toggle("active", x.dataset.currency === "TWD"),
      );
    $("expenseTwd").value = "";
    $("exchangeHint").textContent = "NTD 會直接記錄；ISK 會自動換算台幣。";
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
    ["項目", "類別", "原幣別", "原始金額", "台幣估算", "付款方式", "記帳時間"],
    ...expenses.map((r) => [
      p(r, "Name"),
      p(r, "類別"),
      p(r, "原幣別"),
      p(r, "原始金額"),
      p(r, "台幣估算"),
      p(r, "付款方式"),
      p(r, "記帳時間") || "",
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
        `<tr><td>${esc(p(r, "Name"))}</td><td>${esc(p(r, "類別"))}</td><td>${esc(p(r, "原幣別"))}</td><td>${esc(p(r, "原始金額"))}</td><td>${esc(p(r, "台幣估算"))}</td><td>${esc(p(r, "付款方式"))}</td><td>${esc(p(r, "記帳時間") || "")}</td></tr>`,
    )
    .join("");
  download(
    "冰島費用紀錄.xls",
    '<meta charset="UTF-8"><table border="1"><tr><th>項目</th><th>類別</th><th>原幣別</th><th>原始金額</th><th>台幣估算</th><th>付款方式</th><th>記帳時間</th></tr>' +
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
    $("exchangeHint").textContent = "輸入原始金額後自動換算";
    return;
  }
  if (currency === "TWD") {
    $("expenseTwd").value = amount;
    $("exchangeHint").textContent = "TWD 直接採用原始金額";
    return;
  }
  try {
    $("exchangeHint").textContent = "正在取得最新匯率…";
    const j = await fetch(
      `https://api.frankfurter.app/latest?from=${currency}&to=TWD`,
    ).then((r) => r.json());
    const rate = Number(j.rates?.TWD);
    if (!rate) throw Error("找不到匯率");
    $("expenseTwd").value = Math.round(amount * rate);
    $("exchangeHint").textContent =
      `1 ${currency} ≈ ${rate.toFixed(4)} TWD；匯率來源：Frankfurter`;
  } catch (e) {
    $("exchangeHint").textContent = "匯率取得失敗，請稍後再試";
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
showPage("spots");
syncAll();
