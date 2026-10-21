/* y2be — vanilla SPA: лента, поиск, watch с очередью. Без сборки. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const app = $("#app");

let state = {
  sid: null,          // id сессии просмотра
  pollTimer: null,    // poll статуса очереди
  hbTimer: null,      // heartbeat
  currentVideo: null, // videoId на watch-странице
  hls: null,          // инстанс hls.js
};

/* ---------- утилиты ---------- */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const thumb = (id) => `/img/${id}.jpg`;

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

function fmtViews(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " млн просмотров";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + " тыс. просмотров";
  return n + " просмотров";
}

// ISO8601 PT1H2M3S -> "1:02:03"
function fmtDur(iso) {
  const m = iso?.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  const [, d, h, mi, s] = m.map(Number);
  const H = (d || 0) * 24 + (h || 0);
  const pad = (x) => String(x).padStart(2, "0");
  return H ? `${H}:${pad(mi || 0)}:${pad(s || 0)}` : `${mi || 0}:${pad(s || 0)}`;
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

/* ---------- лента / поиск ---------- */

function cardHTML(it) {
  const s = it.snippet, id = idOf(it);
  return `<a class="card" href="#/watch/${id}">
    <div class="thumb-wrap"><img loading="lazy" src="${thumb(id)}" alt="">
      ${it.contentDetails ? `<span class="dur">${fmtDur(it.contentDetails.duration)}</span>` : ""}
    </div>
    <h3>${esc(s.title)}</h3>
    <p class="meta">${esc(s.channelTitle)}<br>${fmtDate(s.publishedAt)}</p>
  </a>`;
}

const idOf = (it) => it.id?.videoId || it.id;

async function renderFeed(cat = "0", pageToken = "", replace = true) {
  if (replace) app.innerHTML = `<div class="loading">Загрузка…</div>`;
  const p = new URLSearchParams({ categoryId: cat });
  if (pageToken) p.set("pageToken", pageToken);
  let d;
  try { d = await api(`/api/videos?${p}`); }
  catch { app.innerHTML = `<div class="err">Не удалось загрузить ленту</div>`; return; }
  const html = (d.items || []).map(cardHTML).join("");
  if (replace) {
    app.innerHTML = `<div class="grid">${html}</div>`;
  } else {
    $(".grid", app).insertAdjacentHTML("beforeend", html);
  }
  if (d.nextPageToken) {
    const btn = document.createElement("button");
    btn.className = "btn ghost";
    btn.id = "more-btn";
    btn.textContent = "Ещё";
    btn.onclick = () => { btn.remove(); renderFeed(cat, d.nextPageToken, false); };
    app.insertAdjacentElement("beforeend", btn);
  }
}

async function renderSearch(q) {
  app.innerHTML = `<div class="loading">Поиск…</div>`;
  let d;
  try { d = await api(`/api/search?q=${encodeURIComponent(q)}`); }
  catch {
    app.innerHTML = `<div class="err">Ошибка поиска (возможно, исчерпана квота API — попробуйте позже)</div>`;
    return;
  }
  app.innerHTML = d.items?.length
    ? `<div class="grid">${d.items.map(cardHTML).join("")}</div>`
    : `<div class="empty">Ничего не найдено</div>`;
}

/* ---------- watch ---------- */

async function renderWatch(videoId) {
  stopPlayerSession(); // ушли со страницы — освобождаем слот
  state.currentVideo = videoId;
  app.innerHTML = `<div class="loading">Загрузка…</div>`;
  let d;
  try { d = await api(`/api/video/${videoId}`); }
  catch { app.innerHTML = `<div class="err">Видео не найдено</div>`; return; }
  const v = d.video, s = v.snippet;

  app.innerHTML = `
  <div class="watch">
    <div>
      <div class="player-box">
        <video id="player" controls playsinline preload="none" poster="${thumb(videoId)}"></video>
        <div class="player-overlay" id="p-overlay">
          <div class="spin"></div>
          <div id="p-status">Занимаем слот просмотра…</div>
          <button class="btn" id="p-cancel" hidden>Отмена</button>
        </div>
      </div>
      <h1>${esc(s.title)}</h1>
      <p class="sub">${esc(s.channelTitle)} · ${fmtViews(v.statistics?.viewCount)} · ${fmtDate(s.publishedAt)}</p>
      <div class="desc">${esc(s.description || "Без описания")}</div>
      <div class="comments" id="comments"><h3>Комментарии</h3><div class="loading">Загрузка…</div></div>
    </div>
    <div class="side">
      <h3>Похожие</h3>
      <div id="related"><div class="loading">Загрузка…</div></div>
    </div>
  </div>`;

  // плеер стартует немедленно; похожие и комментарии — параллельно, без блокировки
  acquireSlot(videoId);
  loadComments(videoId);
  loadRelated(videoId);
}

async function loadRelated(videoId) {
  const box = $("#related");
  if (!box) return;
  try {
    const d = await api(`/api/related/${videoId}`);
    if (!document.body.contains(box)) return;
    box.innerHTML = (d.items || []).map(cardHTML).join("") || `<div class="empty">Нет похожих</div>`;
  } catch {
    box.innerHTML = `<div class="empty">Недоступны</div>`;
  }
}

async function loadComments(videoId) {
  const box = $("#comments");
  try {
    const d = await api(`/api/comments/${videoId}`);
    const items = d.items || [];
    box.innerHTML = `<h3>Комментарии</h3>` + (items.length ? items.map((it) => {
      const c = it.snippet.topLevelComment.snippet;
      return `<div class="comment">
        <div class="avatar">${esc((c.authorDisplayName || "?")[0].toUpperCase())}</div>
        <div><div class="cauthor">${esc(c.authorDisplayName)} · ${fmtDate(c.publishedAt)}</div>
        <div class="cbody">${esc(c.textDisplay)}</div></div>
      </div>`;
    }).join("") : `<div class="empty">Комментарии отключены</div>`);
  } catch {
    box.innerHTML = `<h3>Комментарии</h3><div class="empty">Недоступны</div>`;
  }
}

/* ---------- очередь и плеер ---------- */

async function acquireSlot(videoId) {
  const statusEl = $("#p-status");
  try {
    const d = await api(`/api/queue/acquire/${videoId}`);
    state.sid = d.sid;
    if (d.status === "active") {
      statusEl.textContent = "Получаем поток…";
      startPlayback();
    } else {
      statusEl.textContent = `Вы в очереди: позиция ${d.position}. Ждём…`;
      $("#p-cancel").hidden = false;
      startPolling();
    }
  } catch (e) {
    statusEl.textContent = "Сервер просмотра перегружен, попробуйте позже";
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (!state.sid) return stopPolling();
    let d;
    try { d = await api("/api/queue/heartbeat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: state.sid }),
    }); } catch { return; }
    const statusEl = $("#p-status");
    if (!statusEl) return stopPolling();
    if (d.status === "active") {
      stopPolling();
      statusEl.textContent = "Слот получен, получаем поток…";
      startPlayback();
    } else if (d.status === "gone") {
      stopPolling();
      statusEl.textContent = "Сессия истекла, обновите страницу";
    } else {
      statusEl.textContent = `Вы в очереди: позиция ${d.position}. Ждём…`;
    }
  }, 4000);
}
const stopPolling = () => { if (state.pollTimer) clearInterval(state.pollTimer); state.pollTimer = null; };

function startPlayback() {
  const pl = $("#player");
  if (!pl || !state.sid) return;
  $("#p-overlay").hidden = true;
  const m3u8 = `/api/hls/${state.currentVideo}/playlist.m3u8?sid=${state.sid}`;
  const fail = (msg) => {
    const st = $("#p-status");
    if (!st) return;
    $("#p-overlay").hidden = false;
    st.textContent = msg;
  };
  // стрим = HLS; hls.js для MSE, нативный HLS для Safari/iOS
  if (pl.canPlayType("application/vnd.apple.mpegurl")) {
    pl.src = m3u8;
    pl.play().catch(() => {});
  } else if (window.Hls?.isSupported()) {
    state.hls = new Hls({ maxBufferLength: 30, backBufferLength: 30 });
    state.hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && d.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
        fail("Не удалось получить поток, попробуйте позже");
      } else if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // сегмент не пришёл (таймаут ffmpeg) — мягкий старт заново
        state.hls?.startLoad();
      } else {
        fail("Ошибка воспроизведения, попробуйте позже");
      }
    });
    state.hls.loadSource(m3u8);
    state.hls.attachMedia(pl);
    pl.play().catch(() => {});
  } else {
    fail("Браузер не поддерживает HLS");
  }
  pl.onerror = () => fail("Не удалось получить поток, попробуйте позже");
  // heartbeat каждые 10с с позицией плеера (для окна HLS на сервере)
  state.hbTimer = setInterval(() => {
    if (!state.sid || !document.body.contains(pl)) return stopHeartbeat();
    fetch("/api/queue/heartbeat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: state.sid, pos: Math.floor(pl.currentTime || 0) }),
    }).catch(() => {});
  }, 10000);
  // вкладка закрылась/уходим — отпустить слот
  window.onbeforeunload = () => releaseSlot();
}
const stopHeartbeat = () => { if (state.hbTimer) clearInterval(state.hbTimer); state.hbTimer = null; };

async function releaseSlot() {
  if (!state.sid) return;
  const sid = state.sid;
  state.sid = null;
  stopPolling(); stopHeartbeat();
  try {
    navigator.sendBeacon?.("/api/queue/release", new Blob([JSON.stringify({ sid })], { type: "application/json" }));
  } catch {}
}

function stopPlayerSession() {
  releaseSlot();
  state.hls?.destroy();
  state.hls = null;
  const pl = $("#player");
  if (pl) { pl.pause(); pl.removeAttribute("src"); pl.load(); }
}

/* ---------- маршрутизация ---------- */

const CATS = {
  "0": "Популярное", "1": "Кино", "10": "Музыка", "17": "Спорт", "20": "Игры",
  "22": "Люди", "23": "Комедии", "24": "Развлечения", "28": "Наука",
};

function route() {
  const h = location.hash;
  stopPlayerSession();
  if (h.startsWith("#/watch/")) return renderWatch(h.slice(8).slice(0, 11));
  if (h.startsWith("#/search/")) return renderSearch(decodeURIComponent(h.slice(9)));
  const m = h.match(/^#\/cat\/(\d+)/);
  if (m) return renderFeed(m[1]);
  return renderFeed("0");
}
window.addEventListener("hashchange", route);

/* ---------- категории ---------- */

function renderCats() {
  $("#cats").innerHTML = Object.entries(CATS).map(([id, name]) =>
    `<button data-cat="${id}" class="${location.hash === `#/cat/${id}` ? "on" : ""}">${name}</button>`
  ).join("");
  $("#cats").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    location.hash = b.dataset.cat === "0" ? "#/" : `#/cat/${b.dataset.cat}`;
  };
}

/* ---------- поиск + подсказки ---------- */

let sgTimer = null;
$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#search-input").value.trim();
  hideSuggest();
  if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
});

$("#search-input").addEventListener("input", () => {
  clearTimeout(sgTimer);
  const q = $("#search-input").value.trim();
  if (q.length < 2) return hideSuggest();
  sgTimer = setTimeout(async () => {
    try {
      const d = await api(`/api/suggest?q=${encodeURIComponent(q)}`);
      const list = (d[1] || []).slice(0, 8);
      const box = $("#suggest-box");
      if (!list.length) return hideSuggest();
      box.innerHTML = list.map((s) => `<div>${esc(s)}</div>`).join("");
      box.hidden = false;
      box.onclick = (e) => {
        if (e.target.tagName !== "DIV") return;
        $("#search-input").value = e.target.textContent;
        hideSuggest();
        location.hash = `#/search/${encodeURIComponent(e.target.textContent)}`;
      };
    } catch {}
  }, 250);
});
const hideSuggest = () => ($("#suggest-box").hidden = true);
document.addEventListener("click", (e) => {
  if (!e.target.closest("#search-form")) hideSuggest();
});

/* ---------- старт ---------- */

renderCats();
route();
