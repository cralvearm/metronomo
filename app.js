"use strict";

/* ---------- Utilidades ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTiempo = (span) => span + " tiempo" + (span === 1 ? "" : "s");

/* ---------- Datos ---------- */
const LS_KEY = "metronomo-packs";
const THEME_KEY = "metronomo-theme";
const METER_OPTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Nombre de figura para el valor (en tiempos/negras) de cada nota de la capa base
const noteName = (v) => {
  const names = [
    [4, "redonda"], [3, "3 negras"], [2, "blanca"], [1.5, "negra y corchea"],
    [1, "negra"], [0.75, "negra con puntillo"], [0.5, "corchea"], [0.25, "semicorchea"],
  ];
  for (let i = 0; i < names.length; i++) if (Math.abs(v - names[i][0]) < 0.01) return names[i][1];
  return "≈" + v.toFixed(2) + " tiempos";
};

const mkSub = (span, base, tup) => ({
  id: uid(),
  span: span == null ? 2 : span,
  base: base == null ? 2 : base,
  tup: tup == null ? 3 : tup,
  on: true,
});

const mkStep = (name, bpm, meter, subs) => ({
  id: uid(),
  name: name,
  bpm: bpm,
  meter: meter || 4,
  subs: subs || [],
});

const cloneSteps = (list) =>
  (list || []).map((s) => ({ ...s, id: uid(), subs: (s.subs || []).map((x) => ({ ...x, id: uid() })) }));

const sanitizeSub = (r) => {
  if (!r || !Number(r.tup) || !Number(r.base) || !Number(r.span)) return null;
  return {
    id: uid(),
    on: r.on !== false,
    tup: clamp(Math.round(Number(r.tup)), 2, 16),
    base: clamp(Math.round(Number(r.base)), 1, 16),
    span: clamp(Math.round(Number(r.span) * 4) / 4, 0.25, 8),
  };
};

const sanitizeSteps = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      // Compatibilidad: una sola polirritmia antigua (campo «sub») o varias («subs»)
      const subsRaw = Array.isArray(r.subs) ? r.subs : (r.sub ? [r.sub] : []);
      const subs = subsRaw.map(sanitizeSub).filter(Boolean);
      return {
        id: uid(),
        name: String(r.name == null ? "Sección" : r.name).slice(0, 48),
        bpm: clamp(Number(r.bpm) || 90, 20, 300),
        meter: clamp(Math.round(Number(r.meter) || 4), 1, 16),
        subs: subs,
      };
    });
};

const defaultPacks = () => [
  {
    id: uid(),
    name: "Ejemplo: cambios de pulso",
    steps: [
      mkStep("Intro", 66),
      mkStep("Tema A", 92),
      mkStep("Puente 7/8", 138, 7),
      mkStep("Coda", 54, 3),
    ],
  },
  {
    id: uid(),
    name: "Poliritmos (ejemplos)",
    steps: [
      mkStep("Tresillo de negras 3:2", 60, 4, [mkSub(2, 2, 3)]),
      mkStep("Quintillo de negras 5:2", 40, 4, [mkSub(2, 2, 5)]),
      mkStep("Quintillo de corcheas 5:2", 52, 4, [mkSub(1, 2, 5)]),
      mkStep("Tresillo de corcheas 3:2", 116, 4, [mkSub(1, 2, 3)]),
      mkStep("Sietillo de semicorcheas 7:4", 92, 4, [mkSub(1, 4, 7)]),
      mkStep("Doble: tresillo + quintillo", 46, 4, [mkSub(2, 2, 3), mkSub(4, 4, 5)]),
    ],
  },
];

function loadPacks() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        const renames = { "Quintillos y poliritmos": "Poliritmos (ejemplos)" };
        const out = parsed
          .map((p) => {
            const rawName = String(p && p.name != null ? p.name : "Pieza").slice(0, 60);
            return { id: uid(), name: renames[rawName] || rawName, steps: sanitizeSteps(p && p.steps) };
          })
          .filter((p) => p.steps.length);
        if (out.length) return out;
      }
    }
  } catch (e) {}
  return defaultPacks();
}

/* ---------- Estado ---------- */
let packs = loadPacks();
let steps = cloneSteps(packs[0] && packs[0].steps || []);
let curIdx = 0;
let playing = false;
let vol = 0.85;

/* ---------- Motor de audio ---------- */
const audio = {
  ctx: null,
  master: null,
  next: 0,
  beat: 0,
  origin: 0,
  settings: { bpm: 90, meter: 4, subs: [] },
  timer: null,
  timers: new Set(),
};

function ensureCtx() {
  if (!audio.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio.ctx = new AC();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = vol;
    audio.master.connect(audio.ctx.destination);
  }
  return audio.ctx;
}

function synth(time, freq, v, dur, accent) {
  const ctx = audio.ctx;
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, time);
  const peak = accent ? Math.min(1, v * 1.3) : v;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), time + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  o.connect(g);
  g.connect(audio.master);
  o.start(time);
  o.stop(time + dur + 0.05);
}

function pushViz(time, fn) {
  const ctx = audio.ctx;
  if (!ctx) return;
  const ms = Math.max(0, (time - ctx.currentTime) * 1000);
  const id = window.setTimeout(() => { audio.timers.delete(id); fn(); }, ms);
  audio.timers.add(id);
}

function pulse(el) {
  if (!el) return;
  el.classList.remove("hit");
  void el.offsetWidth;
  el.classList.add("hit");
  window.setTimeout(() => el.classList.remove("hit"), 220);
}

const flashBeat = (b) => pulse(document.querySelector('#beatRow [data-b="' + b + '"]'));
const flashBase = (si, j) => pulse(document.querySelector('[data-sub="' + si + '"] [data-bd="' + j + '"]'));
const flashTup = (si, j) => pulse(document.querySelector('[data-sub="' + si + '"] [data-td="' + j + '"]'));

function scheduleBeat(time, i) {
  const s = audio.settings;
  if (!audio.ctx) return;
  const bd = 60 / s.bpm;
  const accent = i % s.meter === 0;
  synth(time, accent ? 1500 : 1050, 1, 0.055, accent);
  pushViz(time, () => flashBeat(i % s.meter));
  // Cada polirritmia suena a la vez, con sus capas ancladas al origen;
  // las desactivadas se saltan sin perder su numeración
  (s.subs || []).forEach((sub, si) => {
    if (!sub.on) return;
    const span = sub.span, base = sub.base, tup = sub.tup;
    const D = span * bd;
    const o = audio.origin;
    // Capa base: "base" notas repartidas con igualdad en el espacio
    const sb = D / base;
    for (let k = Math.ceil((time - o - 1e-6) / sb); o + k * sb < time + bd - 1e-6; k++) {
      const nt = o + k * sb;
      if (nt < time - 1e-6) continue;
      const j = ((k % base) + base) % base;
      synth(nt, 780, 0.5, 0.045, j === 0);
      pushViz(nt, () => flashBase(si, j));
    }
    // Capa del tuplet: "tup" notas repartidas con igualdad en el mismo espacio
    const sn = D / tup;
    for (let k = Math.ceil((time - o - 1e-6) / sn); o + k * sn < time + bd - 1e-6; k++) {
      const nt = o + k * sn;
      if (nt < time - 1e-6) continue;
      const j = ((k % tup) + tup) % tup;
      synth(nt, 1900, 0.55, 0.028, j === 0);
      pushViz(nt, () => flashTup(si, j));
    }
  });
}

function syncSettings() {
  const st = steps[curIdx];
  if (st) audio.settings = { bpm: st.bpm, meter: st.meter, subs: st.subs };
}

function startPlayback() {
  const ctx = ensureCtx();
  if (!ctx) return;
  ctx.resume();
  audio.next = ctx.currentTime + 0.08;
  audio.beat = 0;
  audio.origin = audio.next;
  syncSettings();
  playing = true;
  renderPlayBtn();
  audio.timer = window.setInterval(() => {
    const now = ctx.currentTime;
    while (audio.next < now + 0.12) {
      scheduleBeat(audio.next, audio.beat);
      audio.next += 60 / audio.settings.bpm;
      audio.beat += 1;
    }
  }, 25);
}

function stopPlayback() {
  playing = false;
  if (audio.timer) { window.clearInterval(audio.timer); audio.timer = null; }
  audio.timers.forEach((id) => window.clearTimeout(id));
  audio.timers.clear();
  document.querySelectorAll(".dot.hit").forEach((el) => el.classList.remove("hit"));
  try { if (audio.ctx) audio.ctx.suspend(); } catch (e) {}
  renderPlayBtn();
}

/* ---------- Navegación de secciones (ciclo en ambas direcciones) ---------- */
function advance(dir) {
  const n = steps.length;
  if (!n) return;
  curIdx = ((curIdx + dir) % n + n) % n;
  audio.beat = 0;
  audio.origin = audio.next;
  syncSettings();
  renderMain();
  renderSections();
}

function jumpTo(i) {
  if (i < 0 || i >= steps.length || i === curIdx) return;
  curIdx = i;
  audio.beat = 0;
  audio.origin = audio.next;
  syncSettings();
  renderMain();
  renderSections();
}

/* ---------- Edición de secciones y polirritmias ---------- */
function addStep() {
  steps.splice(curIdx + 1, 0, mkStep("Nueva sección", 90));
  renderMain();
  renderSections();
}

function delStep(i) {
  if (steps.length <= 1) return;
  steps.splice(i, 1);
  if (i < curIdx) curIdx -= 1;
  else curIdx = Math.min(curIdx, steps.length - 1);
  syncSettings();
  renderMain();
  renderSections();
}

function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= steps.length) return;
  const tmp = steps[i];
  steps[i] = steps[j];
  steps[j] = tmp;
  if (curIdx === i) curIdx = j;
  else if (curIdx === j) curIdx = i;
  renderMain();
  renderSections();
}

function addSub(i) {
  steps[i].subs.push(mkSub());
  syncSettings();
  if (i === curIdx) renderMain();
  renderSections();
}

function delSub(i, bi) {
  steps[i].subs.splice(bi, 1);
  syncSettings();
  if (i === curIdx) renderMain();
  renderSections();
}

/* ---------- Piezas ---------- */
function savePacksLS() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(packs)); } catch (e) {}
}

function savePack() {
  const nameEl = $("#packName");
  const name = (nameEl.value || "").trim() || "Sin nombre";
  const pack = { id: uid(), name: name, steps: cloneSteps(steps) };
  const idx = packs.findIndex((p) => p.name === name);
  if (idx >= 0) packs[idx] = pack;
  else packs.push(pack);
  savePacksLS();
  renderPacks();
  nameEl.value = "";
}

function loadPack(p) {
  steps = cloneSteps(p.steps);
  curIdx = 0;
  audio.beat = 0;
  audio.origin = audio.next;
  syncSettings();
  renderMain();
  renderSections();
  $("#packName").value = p.name;
}

function delPack(id) {
  packs = packs.filter((p) => p.id !== id);
  savePacksLS();
  renderPacks();
}

function exportAll() {
  const out = packs.map((p) => ({ name: p.name, steps: p.steps }));
  $("#ioText").value = JSON.stringify(out, null, 2);
  $("#ioPanel").hidden = false;
  $("#ioMsg").textContent = "";
}

function importIO() {
  try {
    const parsed = JSON.parse($("#ioText").value);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const incoming = arr
      .map((p) => ({
        id: uid(),
        name: String(p && p.name != null ? p.name : "Importado").slice(0, 60),
        steps: sanitizeSteps(p && p.steps),
      }))
      .filter((p) => p.steps.length);
    if (!incoming.length) { $("#ioMsg").textContent = "No se encontraron secciones válidas."; return; }
    incoming.forEach((inc) => {
      const i = packs.findIndex((p) => p.name === inc.name);
      if (i >= 0) packs[i] = inc;
      else packs.push(inc);
    });
    savePacksLS();
    renderPacks();
    $("#ioMsg").textContent = "Importadas: " + incoming.length + " pieza" + (incoming.length === 1 ? "" : "s") + ".";
  } catch (e) {
    $("#ioMsg").textContent = "El texto no es un JSON válido.";
  }
}

/* ---------- Interfaz ---------- */
function renderMain() {
  const el = $("#mainCard");
  const cur = steps[curIdx];
  if (!cur) { el.innerHTML = '<p class="empty">Agrega una sección para comenzar.</p>'; return; }
  const meter = cur.meter;
  const subs = cur.subs;

  const beatDots = [];
  for (let b = 0; b < meter; b++) beatDots.push('<span class="dot beat" data-b="' + b + '"></span>');

  let viz = "";
  subs.forEach((sb, si) => {
    if (!sb.on) return;
    let baseDots = "";
    let tupDots = "";
    for (let j = 0; j < sb.base; j++) baseDots += '<span class="dot base" data-bd="' + j + '"></span>';
    for (let j = 0; j < sb.tup; j++) tupDots += '<span class="dot tup" data-td="' + j + '"></span>';
    viz += '<div class="subviz" data-sub="' + si + '"><span class="viznum">' + (si + 1) + '</span><div class="subgroup"><div class="dotrow">' + baseDots + '</div><div class="dotrow">' + tupDots + '</div></div></div>';
  });

  let jump = "";
  steps.forEach((s, i) => {
    const act = s.subs.filter((x) => x.on).map((x) => x.tup + ":" + x.base).join(" · ");
    jump += '<button class="jumpbtn' + (i === curIdx ? " cur" : "") + '" data-i="' + i + '" title="Ir a: ' + esc(s.name || "sección " + (i + 1)) + '">'
      + '<span class="bpmv">' + esc(String(s.bpm)) + '</span>'
      + '<span class="jname">' + esc(s.name || "Sección " + (i + 1)) + '</span>'
      + (act ? '<span class="jsub">' + esc(act) + '</span>' : "")
      + "</button>";
  });

  let chips = "";
  subs.forEach((sb, si) => {
    chips += '<button class="chip' + (sb.on ? " on" : "") + '" data-si="' + si + '" title="' + (sb.on ? "Desactivar esta polirritmia" : "Activar esta polirritmia") + '">'
      + (si + 1) + " · " + sb.tup + " notas contra " + sb.base + " en " + fmtTiempo(sb.span) + "</button>";
  });

  el.innerHTML =
    '<div class="mhead">'
    + '<div class="mtitle"><span class="kicker">Sección ' + (curIdx + 1) + "/" + steps.length + '</span><span class="secname">' + esc(cur.name || "Sin nombre") + "</span></div>"
    + '<div class="chips"><span class="chip">' + meter + " tiempos/compás</span>" + chips + "</div></div>"
    + '<div class="bpmrow">'
    + '<button class="tick" data-d="-1" title="Bajar 1 BPM">−</button>'
    + '<span class="bpmnum">' + cur.bpm + '</span>'
    + '<button class="tick" data-d="1" title="Subir 1 BPM">+</button>'
    + '<span class="bpmlabel">BPM</span></div>'
    + '<div class="viz"><div class="dotrow" id="beatRow">' + beatDots.join("") + "</div>" + viz + "</div>"
    + '<div class="jump">' + jump + "</div>"
    + '<button class="advance" id="advanceBtn"' + (steps.length ? "" : " disabled") + '>Cambio de pulso</button>'
    + '<div class="backrow"><button id="backBtn" class="ghost">Pulso anterior</button></div>'
    + '<div class="volrow">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>'
    + '<input id="volInput" type="range" min="0" max="1" step="0.05" value="' + vol + '" aria-label="Volumen general">'
    + "</div>";

  el.querySelector("#advanceBtn").addEventListener("click", () => advance(1));
  el.querySelector("#backBtn").addEventListener("click", () => advance(-1));
  el.querySelector("#volInput").addEventListener("input", (e) => {
    vol = Number(e.target.value);
    if (audio.master) audio.master.gain.value = vol;
  });
  el.querySelectorAll(".tick").forEach((b) => b.addEventListener("click", () => {
    const d = Number(b.dataset.d);
    const s = steps[curIdx];
    s.bpm = clamp(s.bpm + d, 20, 300);
    syncSettings();
    renderMain();
    renderSections();
  }));
  el.querySelectorAll(".chip[data-si]").forEach((b) => b.addEventListener("click", () => {
    const sb = steps[curIdx].subs[Number(b.dataset.si)];
    sb.on = !sb.on;
    syncSettings();
    renderMain();
    renderSections();
  }));
  el.querySelectorAll(".jumpbtn").forEach((b) => b.addEventListener("click", () => jumpTo(Number(b.dataset.i))));
}

function renderSections() {
  const el = $("#sections");
  el.innerHTML = steps.map((s, i) => {
    const subs = s.subs.map((sb, bi) =>
      '<div class="subrow" data-bi="' + bi + '">'
      + '<button class="numbtn' + (sb.on ? " on" : "") + '" data-tgl="1" title="' + (sb.on ? "Desactivar esta polirritmia" : "Activar esta polirritmia") + '"><span class="minidot' + (sb.on ? " on" : "") + '"></span>' + (bi + 1) + "</button>"
      + '<label class="numlab">tuplet <input class="in num wS" data-sk="tup" type="number" min="2" max="16" value="' + sb.tup + '" title="Notas del tuplet repartidas con igualdad en el espacio"></label>'
      + '<span class="word">contra</span>'
      + '<label class="numlab"><input class="in num wS" data-sk="base" type="number" min="1" max="16" value="' + sb.base + '" title="Notas de la capa base repartidas en el mismo espacio"></label>'
      + '<span class="word">en</span>'
      + '<label class="numlab"><input class="in num wSp" data-sk="span" type="number" min="0.25" max="8" step="0.25" value="' + sb.span + '" title="Espacio, en tiempos (negras), donde se reparten ambas capas"> tiempo' + (sb.span === 1 ? "" : "s") + "</label>"
      + '<span class="notename">cada nota base ≈ ' + noteName(sb.span / sb.base) + "</span>"
      + '<button class="op" data-sdel="1" title="Quitar esta polirritmia">✕</button>'
      + "</div>"
    ).join("");
    return '<div class="seccard' + (i === curIdx ? " cur" : "") + '" data-i="' + i + '">'
      + '<div class="secrow">'
      + '<button class="navdot' + (i === curIdx ? " on" : "") + '" data-go="1" title="Ir a esta sección"></button>'
      + '<input class="in name" data-k="name" value="' + esc(s.name) + '" placeholder="Nombre">'
      + '<label class="numlab">BPM <input class="in num wBpm" data-k="bpm" type="number" min="20" max="300" value="' + s.bpm + '"></label>'
      + '<label class="numlab">Compás <select class="in" data-k="meter">' + METER_OPTS.map((m) => '<option value="' + m + '"' + (m === s.meter ? " selected" : "") + ">" + m + "</option>").join("") + "</select></label>"
      + '<div class="ops"><button data-mv="-1" title="Subir">↑</button><button data-mv="1" title="Bajar">↓</button><button data-del="1" title="Eliminar">✕</button></div>'
      + "</div>"
      + subs
      + '<div class="addsub"><button class="ghost xs" data-addsub="1">+ Polirritmia</button></div>'
      + "</div>";
  }).join("");
}

function renderPacks() {
  const el = $("#packs");
  if (!packs.length) { el.innerHTML = '<p class="fine">Sin piezas guardadas.</p>'; return; }
  el.innerHTML = packs.map((p, idx) =>
    '<div class="packcard">'
    + '<div class="packmin"><p class="packname">' + esc(p.name) + '</p><p class="packmeta">' + p.steps.length + " sección" + (p.steps.length === 1 ? "" : "es") + "</p></div>"
    + '<div class="packops"><button class="ghost xs" data-load="' + idx + '">Cargar</button><button class="op" data-delp="' + idx + '" title="Eliminar">✕</button></div>'
    + "</div>"
  ).join("");
  el.querySelectorAll("[data-load]").forEach((b) =>
    b.addEventListener("click", () => loadPack(packs[Number(b.dataset.load)])));
  el.querySelectorAll("[data-delp]").forEach((b) =>
    b.addEventListener("click", () => delPack(packs[Number(b.dataset.delp)].id)));
}

function renderPlayBtn() {
  const b = $("#playBtn");
  b.textContent = playing ? "▮▮ Pausar" : "▶ Iniciar";
  b.disabled = !steps.length;
  b.classList.toggle("playing", playing);
}

function renderThemeBtn() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  $("#themeBtn").textContent = dark ? "☀ Claro" : "☾ Oscuro";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0f0f0f" : "#ffffff");
}

function toggleTheme() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const t = dark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  renderThemeBtn();
}

/* ---------- Eventos delegados del editor ---------- */
function initSectionsEvents() {
  const host = $("#sections");

  host.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    const card = t.closest(".seccard");
    if (!card) return;
    const i = Number(card.dataset.i);
    const row = t.closest(".subrow");
    const bi = row ? Number(row.dataset.bi) : -1;
    if (t.hasAttribute("data-go")) jumpTo(i);
    else if (t.hasAttribute("data-mv")) moveStep(i, Number(t.dataset.mv));
    else if (t.hasAttribute("data-del")) delStep(i);
    else if (t.hasAttribute("data-tgl")) {
      steps[i].subs[bi].on = !steps[i].subs[bi].on;
      syncSettings();
      if (i === curIdx) renderMain();
      renderSections();
    }
    else if (t.hasAttribute("data-sdel")) delSub(i, bi);
    else if (t.hasAttribute("data-addsub")) addSub(i);
  });

  const onEdit = (e) => {
    const t = e.target;
    const card = t.closest && t.closest(".seccard");
    if (!card) return;
    const i = Number(card.dataset.i);
    const row = t.closest && t.closest(".subrow");
    if (row) {
      const bi = Number(row.dataset.bi);
      const sb = steps[i].subs[bi];
      if (t.dataset.sk === "tup") sb.tup = clamp(Math.round(Number(t.value) || 2), 2, 16);
      else if (t.dataset.sk === "base") sb.base = clamp(Math.round(Number(t.value) || 1), 1, 16);
      else if (t.dataset.sk === "span") sb.span = clamp(Math.round((Number(t.value) || 1) * 4) / 4, 0.25, 8);
      const note = row.querySelector(".notename");
      if (note) note.textContent = "cada nota base ≈ " + noteName(sb.span / sb.base);
      syncSettings();
      renderMain();
      return;
    }
    const s = steps[i];
    if (t.dataset.k === "name") s.name = t.value;
    else if (t.dataset.k === "bpm") s.bpm = clamp(Number(t.value) || 20, 20, 300);
    else if (t.dataset.k === "meter") s.meter = clamp(Math.round(Number(t.value) || 4), 1, 16);
    syncSettings();
    renderMain();
  };
  host.addEventListener("input", onEdit);
  host.addEventListener("change", onEdit);
}

/* ---------- Atajos de teclado ---------- */
function initKeys() {
  window.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.code === "Space" || e.code === "ArrowRight") { e.preventDefault(); advance(1); }
    else if (e.code === "ArrowLeft") { e.preventDefault(); advance(-1); }
    else if (e.code === "Enter") { e.preventDefault(); playing ? stopPlayback() : startPlayback(); }
    else if (/^Digit[1-9]$/.test(e.code) || /^Numpad[1-9]$/.test(e.code)) {
      e.preventDefault();
      jumpTo(Number(e.code.slice(-1)) - 1);
    }
  });
}

/* ---------- Inicio ---------- */
function init() {
  $("#addStepBtn").addEventListener("click", addStep);
  $("#savePackBtn").addEventListener("click", savePack);
  $("#ioBtn").addEventListener("click", exportAll);
  $("#ioImport").addEventListener("click", importIO);
  $("#ioClose").addEventListener("click", () => { $("#ioPanel").hidden = true; });
  $("#playBtn").addEventListener("click", () => (playing ? stopPlayback() : startPlayback()));
  $("#themeBtn").addEventListener("click", toggleTheme);
  initSectionsEvents();
  initKeys();
  syncSettings();
  renderMain();
  renderSections();
  renderPacks();
  renderPlayBtn();
  renderThemeBtn();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
