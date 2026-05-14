/* ═══════════════════════════════════════════════════
   SMR LAB V2.1 — app.js
   Auth · Firestore · Misiones verificadas · UI · Canvas
═══════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  deleteUser
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

/* ══════════════════════════
   FIREBASE CONFIG (sin cambios)
══════════════════════════ */

const firebaseConfig = {
  apiKey: "AIzaSyCwhCOlTDTVDmUgqpmNb_QIgaB3soBUbDU",
  authDomain: "smr-lab-a71c6.firebaseapp.com",
  projectId: "smr-lab-a71c6",
  storageBucket: "smr-lab-a71c6.firebasestorage.app",
  messagingSenderId: "921445167226",
  appId: "1:921445167226:web:a6003674fa6cee94f9cbc3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ══════════════════════════
   STATE
══════════════════════════ */

let currentUser  = null;
let currentData  = null;
let authMode     = "login";
let canvasMode   = "move";
let nodes        = [];
let connections  = [];
let selectedNode = null;
let connectFrom  = null;
let hoveredNode  = null;

const sessionFlags = { ipconfig: false, analyze: false };

let hoursTimer     = null;
let lastHourTickMs = Date.now();

/* ══════════════════════════
   XP / LEVEL
══════════════════════════ */

const XP_PER_LEVEL = 100;

function computeLevelMeta(totalXP) {
  const xp = Math.max(0, Number(totalXP) || 0);
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpInLevel = xp % XP_PER_LEVEL;
  const xpToNextLevel = xpInLevel === 0 && xp > 0 ? XP_PER_LEVEL : XP_PER_LEVEL - xpInLevel;
  const pct = (xpInLevel / XP_PER_LEVEL) * 100;
  return { level, xpInLevel, xpToNextLevel, pct };
}

function normalizeUsername(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function displayUsername(data) {
  if (!data) return "—";
  if (data.username) return data.username;
  return "usuario";
}

function mergeRemoteUserData(data) {
  const d = { ...(data || {}) };
  const legacyXp = Number(d.xp ?? 0);
  const totalXP = Number(d.totalXP ?? legacyXp);
  d.totalXP = totalXP;
  d.xp = totalXP;
  d.hoursPlayed = Number(d.hoursPlayed ?? 0);
  d.missions = d.missions && typeof d.missions === "object" ? d.missions : {};
  if (Array.isArray(d.completedMissions)) {
    for (const id of d.completedMissions) {
      if (!d.missions[id]) {
        d.missions[id] = { status: "verified", migrated: true };
      }
    }
  }
  if (!d.username) {
    d.username = `smr_${(d.email || "user").split("@")[0].slice(0, 12)}`;
  }
  const meta = computeLevelMeta(d.totalXP);
  d.level = meta.level;
  d.xpToNextLevel = meta.xpToNextLevel;
  d.missionsCompleted = countVerifiedMissions(d.missions);
  return d;
}

function countVerifiedMissions(missions) {
  return Object.values(missions || {}).filter(m => m && m.status === "verified").length;
}

function getMissionState(id) {
  const m = currentData?.missions?.[id];
  return m?.status || "pending";
}

/* ══════════════════════════
   LOGIN PARTICLES
══════════════════════════ */

(function initParticles() {
  const canvas = document.getElementById("loginParticles");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let particles = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function createParticle() {
    return {
      x:    Math.random() * canvas.width,
      y:    Math.random() * canvas.height,
      vx:   (Math.random() - 0.5) * 0.4,
      vy:   (Math.random() - 0.5) * 0.4,
      size: Math.random() * 1.5 + 0.5,
      opacity: Math.random() * 0.5 + 0.1
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: 80 }, createParticle);
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx   = particles[i].x - particles[j].x;
        const dy   = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(74,240,196,${0.06 * (1 - dist / 120)})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(74,240,196,${p.opacity})`;
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
    });

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  init();
  draw();
})();

/* ══════════════════════════
   AUTH UI
══════════════════════════ */

window.switchAuthTab = function(mode) {
  authMode = mode;
  document.getElementById("tabLogin").classList.toggle("active", mode === "login");
  document.getElementById("tabRegister").classList.toggle("active", mode === "register");
  document.getElementById("authBtnText").textContent = mode === "login" ? "Iniciar sesión" : "Crear cuenta";
  document.getElementById("authError").textContent = "";
  document.getElementById("usernameField").classList.toggle("hidden", mode === "login");
};

window.handleAuth = async function() {
  const identifier = document.getElementById("identifier").value.trim();
  const password   = document.getElementById("password").value;
  const usernameRaw  = document.getElementById("username").value.trim();
  const errEl        = document.getElementById("authError");
  errEl.textContent = "";

  if (!identifier || !password) {
    errEl.textContent = "⚠ Rellena identificador y contraseña.";
    return;
  }

  if (authMode === "register") {
    if (!usernameRaw) {
      errEl.textContent = "⚠ El nombre de usuario es obligatorio.";
      return;
    }
    if (usernameRaw.length < 3) {
      errEl.textContent = "⚠ Usuario demasiado corto (mín. 3).";
      return;
    }
  }

  try {
    if (authMode === "register") {
      const username = normalizeUsername(usernameRaw);
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        errEl.textContent = "⚠ Usuario: 3–24 caracteres, solo a-z, 0-9 y _.";
        return;
      }

      const usernameRef = doc(db, "usernames", username);
      const reserved = await getDoc(usernameRef);
      if (reserved.exists()) {
        errEl.textContent = "⚠ Ese nombre de usuario ya está en uso.";
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, identifier, password);
      const userRef = doc(db, "users", cred.user.uid);
      const meta = computeLevelMeta(0);
      const userPayload = {
        email: identifier,
        username,
        totalXP: 0,
        xp: 0,
        level: meta.level,
        xpToNextLevel: meta.xpToNextLevel,
        hoursPlayed: 0,
        missionsCompleted: 0,
        missions: {},
        completedMissions: []
      };

      try {
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(usernameRef);
          if (snap.exists()) {
            throw new Error("USERNAME_TAKEN");
          }
          transaction.set(usernameRef, { uid: cred.user.uid });
          transaction.set(userRef, userPayload);
        });
      } catch (inner) {
        try {
          await deleteUser(cred.user);
        } catch (_) { /* noop */ }

        if (inner && inner.message === "USERNAME_TAKEN") {
          errEl.textContent = "⚠ Ese nombre de usuario acaba de ser registrado. Prueba otro.";
          return;
        }
        throw inner;
      }
    } else {
      await signInWithEmailAndPassword(auth, identifier, password);
    }
  } catch (err) {
    errEl.textContent = "⚠ " + friendlyError(err.code);
  }
};

function friendlyError(code) {
  if (!code) return "Error al cargar datos. Abre la consola (F12) para más detalle.";
  const map = {
    "auth/user-not-found":    "No existe ninguna cuenta con ese identificador.",
    "auth/wrong-password":    "Contraseña incorrecta.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese identificador.",
    "auth/weak-password":     "La contraseña debe tener al menos 6 caracteres.",
    "auth/invalid-email":     "El identificador no tiene un formato válido.",
    "auth/invalid-credential": "Credenciales incorrectas.",
    "permission-denied":      "Firestore bloqueó la operación. Publica las reglas del archivo firestore.rules (véase PASOS-FIREBASE.txt).",
    "firestore/permission-denied": "Firestore bloqueó la operación. Publica las reglas del archivo firestore.rules (véase PASOS-FIREBASE.txt)."
  };
  return map[code] || "Error desconocido: " + code;
}

/** Crea usernames/{usuario} para cuentas antiguas que aún no tienen reserva. */
async function ensureUsernameReservationDoc() {
  if (!currentUser || !currentData?.username) return;
  try {
    const key = normalizeUsername(currentData.username);
    const ref = doc(db, "usernames", key);
    const s = await getDoc(ref);
    if (!s.exists()) {
      await setDoc(ref, { uid: currentUser.uid });
    }
  } catch (_) {
    /* sin permiso o offline: no bloquear login */
  }
}

/** Referencia estable para poder quitar el listener al cerrar sesión */
function onHoursBeforeUnload() {
  void flushHoursPlayed();
}

/* ══════════════════════════
   SESSION
══════════════════════════ */

onAuthStateChanged(auth, async (user) => {
  if (hoursTimer) {
    clearInterval(hoursTimer);
    hoursTimer = null;
  }
  window.removeEventListener("beforeunload", onHoursBeforeUnload);

  if (user) {
    try {
      currentUser = user;

      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      let raw = snap.data() || {};

      if (!snap.exists()) {
        const email = user.email || "";
        const base = email.includes("@") ? email.split("@")[0] : `user_${user.uid.slice(0, 8)}`;
        let uname = normalizeUsername(base);
        if (!/^[a-z0-9_]{3,24}$/.test(uname)) {
          uname = `u_${user.uid.slice(0, 8)}`;
        }
        await setDoc(userRef, {
          email: email || "",
          username: uname,
          totalXP: 0,
          xp: 0,
          level: 1,
          xpToNextLevel: 100,
          hoursPlayed: 0,
          missionsCompleted: 0,
          missions: {},
          completedMissions: []
        }, { merge: true });
        const snap2 = await getDoc(userRef);
        raw = snap2.data() || {};
      }

      const patch = {};
      const legacyXp = Number(raw.xp ?? 0);
      if (raw.totalXP == null && raw.xp != null) {
        patch.totalXP = legacyXp;
      }
      if (!raw.username) {
        patch.username = `smr_${(raw.email || user.email || "user").toString().split("@")[0].slice(0, 12)}`;
      }
      const mergedMissions = { ...(raw.missions && typeof raw.missions === "object" ? raw.missions : {}) };
      let missionsTouched = false;
      if (!raw.missions || typeof raw.missions !== "object") {
        missionsTouched = true;
      }
      if (Array.isArray(raw.completedMissions) && raw.completedMissions.length) {
        for (const id of raw.completedMissions) {
          if (!mergedMissions[id]) {
            mergedMissions[id] = { status: "verified", migrated: true };
            missionsTouched = true;
          }
        }
      }
      if (missionsTouched) patch.missions = mergedMissions;
      if (raw.level == null || raw.xpToNextLevel == null || raw.missionsCompleted == null) {
        const tmp = mergeRemoteUserData({ ...raw, ...patch });
        patch.level = tmp.level;
        patch.xpToNextLevel = tmp.xpToNextLevel;
        patch.missionsCompleted = tmp.missionsCompleted;
        patch.xp = tmp.totalXP;
        if (raw.totalXP == null) patch.totalXP = tmp.totalXP;
      }

      if (Object.keys(patch).length) {
        await setDoc(userRef, patch, { merge: true });
        raw = { ...raw, ...patch };
      }

      currentData = mergeRemoteUserData(raw);

      await ensureUsernameReservationDoc();

      showApp();
      loadUserProfile();
      loadMissions();
      void loadLeaderboard();

      lastHourTickMs = Date.now();
      hoursTimer = setInterval(tickHoursPlayed, 60_000);
      window.addEventListener("beforeunload", onHoursBeforeUnload);

      setTimeout(() => {
        resizeCanvas();
        drawNetwork();
      }, 100);
    } catch (err) {
      console.error("onAuthStateChanged", err);
      const errEl = document.getElementById("authError");
      if (errEl) {
        const code = err && err.code;
        errEl.textContent = "⚠ " + (code ? friendlyError(code) : (err && err.message) || friendlyError());
      }
    }
  } else {
    currentUser = null;
    currentData = null;
    hideApp();
  }
});

function showApp() {
  document.getElementById("loginScreen").style.display = "none";
  const appEl = document.getElementById("app");
  appEl.style.display = "flex";
  requestAnimationFrame(() => appEl.classList.add("visible"));
}

function hideApp() {
  document.getElementById("loginScreen").style.display = "flex";
  const appEl = document.getElementById("app");
  appEl.style.display = "none";
  appEl.classList.remove("visible");
}

window.logout = async function() {
  await flushHoursPlayed();
  await signOut(auth);
};

async function tickHoursPlayed() {
  if (!currentUser || !currentData) return;
  const now = Date.now();
  const deltaH = (now - lastHourTickMs) / 3_600_000;
  lastHourTickMs = now;
  const next = Number(currentData.hoursPlayed || 0) + deltaH;
  currentData.hoursPlayed = next;
  try {
    await setDoc(doc(db, "users", currentUser.uid), { hoursPlayed: next }, { merge: true });
  } catch (_) { /* offline */ }
}

async function flushHoursPlayed() {
  if (!currentUser || !currentData) return;
  const now = Date.now();
  const deltaH = (now - lastHourTickMs) / 3_600_000;
  lastHourTickMs = now;
  if (deltaH <= 0) return;
  const next = Number(currentData.hoursPlayed || 0) + deltaH;
  currentData.hoursPlayed = next;
  try {
    await setDoc(doc(db, "users", currentUser.uid), { hoursPlayed: next }, { merge: true });
  } catch (_) { /* noop */ }
}

/* ══════════════════════════
   PROFILE / XP
══════════════════════════ */

function loadUserProfile() {
  const u = displayUsername(currentData);
  const initial = u.charAt(0).toUpperCase();
  const { level, xpInLevel, pct, xpToNextLevel } = computeLevelMeta(currentData.totalXP || 0);

  document.getElementById("profileName").textContent  = u;
  document.getElementById("profileLevel").textContent = `Nivel ${level}`;
  document.getElementById("profileAvatar").textContent = initial;
  document.getElementById("xpLabel").textContent      = `${xpInLevel} / ${XP_PER_LEVEL} · +${xpToNextLevel} para subir`;
  document.getElementById("totalXpDisplay").textContent = currentData.totalXP || 0;

  setTimeout(() => {
    document.getElementById("xpFill").style.width = pct + "%";
  }, 400);
}

async function persistUserXP(newTotalXP, missions, missionsCompleted) {
  if (!currentUser) return;
  const meta = computeLevelMeta(newTotalXP);
  currentData.totalXP = newTotalXP;
  currentData.xp = newTotalXP;
  currentData.level = meta.level;
  currentData.xpToNextLevel = meta.xpToNextLevel;
  currentData.missions = missions;
  currentData.missionsCompleted = missionsCompleted;

  await setDoc(doc(db, "users", currentUser.uid), {
    totalXP: newTotalXP,
    xp: newTotalXP,
    level: meta.level,
    xpToNextLevel: meta.xpToNextLevel,
    missions,
    missionsCompleted
  }, { merge: true });

  loadUserProfile();
}

/* ══════════════════════════
   NAVIGATION
══════════════════════════ */

window.switchTab = function(tab, btn) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));

  document.getElementById(`tab-${tab}`).classList.add("active");
  if (btn) btn.classList.add("active");

  if (tab === "redes") {
    setTimeout(() => { resizeCanvas(); drawNetwork(); }, 50);
  }
  if (tab === "leaderboard") {
    loadLeaderboard();
  }
  if (tab === "misiones") {
    loadMissions();
  }
};

/* ══════════════════════════
   CANVAS NETWORK
══════════════════════════ */

const canvas = document.getElementById("networkCanvas");
const ctx    = canvas.getContext("2d");

const DEVICE_COLORS = {
  router: "#5b8dee",
  switch: "#4af0c4",
  pc:     "#f0c44a",
  server: "#f06a4a"
};

const DEVICE_EMOJIS = {
  router: "🔀",
  switch: "⚡",
  pc:     "💻",
  server: "🖥"
};

function shortId(n) {
  return String(n.id).slice(-4);
}

function deviceHostname(node) {
  const t = node.type.toUpperCase();
  return `${t}-${shortId(node)}`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width;
  canvas.height = rect.height;
  drawNetwork();
}

window.addEventListener("resize", () => {
  resizeCanvas();
  drawNetwork();
});

window.addDevice = function(type) {
  const margin = 80;
  const id = Date.now();
  nodes.push({
    id,
    type,
    x:    Math.random() * (canvas.width  - margin * 2) + margin,
    y:    Math.random() * (canvas.height - margin * 2) + margin,
    ip:   randomIP(type),
    mac:  randomMAC(),
    size: 56
  });

  updateNetworkStats();
  drawNetwork();
  hideHint();
};

window.clearNetwork = function() {
  nodes       = [];
  connections = [];
  selectedNode = null;
  connectFrom  = null;
  updateNetworkStats();
  drawNetwork();
  showSelectedInfo(null);
  document.getElementById("analysisCard").style.display = "none";
};

window.setMode = function(mode) {
  canvasMode  = mode;
  connectFrom = null;

  document.getElementById("btnModeMove").classList.toggle("active", mode === "move");
  document.getElementById("btnModeConnect").classList.toggle("active", mode === "connect");

  canvas.style.cursor = mode === "connect" ? "crosshair" : "default";
  drawNetwork();
};

window.analyzeNetwork = function() {
  if (nodes.length === 0) {
    showToast("Añade dispositivos primero", "⚠");
    return;
  }

  sessionFlags.analyze = true;

  const routerCount = nodes.filter(n => n.type === "router").length;
  const switchCount = nodes.filter(n => n.type === "switch").length;
  const pcCount     = nodes.filter(n => n.type === "pc").length;
  const srvCount    = nodes.filter(n => n.type === "server").length;
  const linkCount   = connections.length;
  const isolated    = nodes.filter(n => !connections.some(c => c.from === n.id || c.to === n.id)).length;

  const card = document.getElementById("analysisCard");
  const body = document.getElementById("analysisContent");

  card.style.display = "block";

  const rows = [
    ["Dispositivos", nodes.length],
    ["Routers",  routerCount],
    ["Switches", switchCount],
    ["PCs",      pcCount],
    ["Servidores", srvCount],
    ["Conexiones", linkCount],
    ["Nodos aislados", isolated],
    ["Tipo de red", linkCount === 0 ? "Sin conectar" :
      routerCount > 0 && switchCount > 0 ? "Mixta (LAN + WAN)" :
      switchCount > 0 ? "LAN local" : "Ad-hoc"]
  ];

  body.innerHTML = rows.map(([k, v]) => `
    <div class="analysis-row">
      <span style="color:var(--text-dim); font-size:12px; font-family:'JetBrains Mono',monospace">${k}</span>
      <span style="font-size:12px; font-weight:700; color:var(--accent); font-family:'JetBrains Mono',monospace">${v}</span>
    </div>
  `).join("");
};

function randomIP(type) {
  const base = type === "router" ? "10.0" :
               type === "server" ? "192.168.0" : "192.168.1";
  return `${base}.${Math.floor(Math.random() * 200) + 2}`;
}

function randomMAC() {
  return Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join(":");
}

function updateNetworkStats() {
  document.getElementById("nodeCount").textContent = nodes.length;
  document.getElementById("linkCount").textContent = connections.length;
}

function hideHint() {
  const hint = document.getElementById("canvasHint");
  if (nodes.length > 0) hint.classList.add("hidden");
}

function neighborIds(nodeId) {
  const s = new Set();
  connections.forEach(c => {
    if (c.from === nodeId) s.add(c.to);
    if (c.to === nodeId) s.add(c.from);
  });
  return [...s];
}

function degree(nodeId) {
  return neighborIds(nodeId).length;
}

function drawNetwork() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  connections.forEach(conn => {
    const a = nodes.find(n => n.id === conn.from);
    const b = nodes.find(n => n.id === conn.to);
    if (!a || !b) return;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);

    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, `${DEVICE_COLORS[a.type]}99`);
    grad.addColorStop(1, `${DEVICE_COLORS[b.type]}99`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    ctx.beginPath();
    ctx.arc(mx, my, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(74,240,196,0.75)";
    ctx.fill();
  });

  if (connectFrom) {
    const n = nodes.find(n => n.id === connectFrom);
    if (n && hoveredNode && hoveredNode.id !== connectFrom) {
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(hoveredNode.x, hoveredNode.y);
      ctx.strokeStyle = "rgba(74,240,196,0.45)";
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  nodes.forEach(node => {
    const isSelected = selectedNode && selectedNode.id === node.id;
    const isConnFrom  = connectFrom === node.id;
    const color  = DEVICE_COLORS[node.type];
    const half   = node.size / 2;
    const rOuter = half * 0.78;
    const rInner = half * 0.58;

    if (isSelected || isConnFrom) {
      ctx.shadowColor = color;
      ctx.shadowBlur  = 22;
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, rOuter, 0, Math.PI * 2);
    ctx.strokeStyle = `${color}55`;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(node.x, node.y, rInner, 0, Math.PI * 2);
    ctx.fillStyle = `${color}22`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(node.x, node.y, rInner, 0, Math.PI * 2);
    ctx.strokeStyle = isSelected ? color : `${color}88`;
    ctx.lineWidth = isSelected ? 2.2 : 1.4;
    ctx.stroke();

    ctx.shadowBlur = 0;

    ctx.font = `${half * 0.72}px serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(DEVICE_EMOJIS[node.type], node.x, node.y - 2);

    ctx.fillStyle = color;
    ctx.font      = "bold 10px 'JetBrains Mono', monospace";
    ctx.textBaseline = "top";
    ctx.fillText(deviceHostname(node), node.x, node.y + rOuter + 2);

    ctx.fillStyle = "rgba(142,163,200,0.9)";
    ctx.font      = "9px 'JetBrains Mono', monospace";
    ctx.fillText(node.ip, node.x, node.y + rOuter + 16);
  });
}

canvas.addEventListener("mousedown", e => {
  const { x, y } = getCanvasPos(e);
  const hit = getNodeAt(x, y);

  if (canvasMode === "connect") {
    if (!hit) return;
    if (!connectFrom) {
      connectFrom = hit.id;
    } else {
      if (hit.id !== connectFrom) {
        const exists = connections.some(
          c => (c.from === connectFrom && c.to === hit.id) ||
               (c.from === hit.id && c.to === connectFrom)
        );
        if (!exists) {
          connections.push({ from: connectFrom, to: hit.id });
          updateNetworkStats();
        }
      }
      connectFrom = null;
    }
    drawNetwork();
    return;
  }

  selectedNode = hit || null;
  showSelectedInfo(selectedNode);
  drawNetwork();
});

canvas.addEventListener("mousemove", e => {
  const { x, y } = getCanvasPos(e);
  hoveredNode = getNodeAt(x, y) || null;

  if (canvasMode === "connect") {
    drawNetwork();
    return;
  }

  if (selectedNode && e.buttons === 1) {
    selectedNode.x = x;
    selectedNode.y = y;
    drawNetwork();
  }

  if (hoveredNode) {
    showTooltip(hoveredNode, e.clientX, e.clientY);
  } else {
    hideTooltip();
  }
});

canvas.addEventListener("mouseup", () => {
  if (canvasMode === "move") selectedNode = null;
});

canvas.addEventListener("mouseleave", () => {
  hideTooltip();
  hoveredNode = null;
});

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function getNodeAt(x, y) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n  = nodes[i];
    const dx = x - n.x;
    const dy = y - n.y;
    if (Math.sqrt(dx * dx + dy * dy) < n.size / 2) return n;
  }
  return null;
}

function showSelectedInfo(node) {
  const el = document.getElementById("selectedInfo");
  if (!node) {
    el.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:12px; text-align:center; padding:20px 0">Haz click en un nodo para ver detalles</p>`;
    return;
  }

  const color = DEVICE_COLORS[node.type];
  el.innerHTML = `
    <div class="selected-info__hero">
      <div class="selected-info__emoji">${DEVICE_EMOJIS[node.type]}</div>
      <div class="selected-info__meta">
        <div class="selected-info__label">Host</div>
        <div class="selected-info__hostname mono">${deviceHostname(node)}</div>
      </div>
    </div>
    <div class="selected-info-row">
      <span class="mono">Tipo</span>
      <span class="device-badge device-badge--${node.type}">${node.type.toUpperCase()}</span>
    </div>
    <div class="selected-info-row">
      <span class="mono">IP</span>
      <span class="mono" style="color:${color}">${node.ip}</span>
    </div>
    <div class="selected-info-row">
      <span class="mono">MAC</span>
      <span class="mono" style="color:var(--text-mid); font-size:11px">${node.mac}</span>
    </div>
    <div class="selected-info-row">
      <span class="mono">Conexiones</span>
      <span class="mono" style="color:var(--accent)">${connections.filter(c => c.from === node.id || c.to === node.id).length}</span>
    </div>
    <button
      type="button"
      onclick="removeNode(${node.id})"
      style="margin-top:8px; width:100%; padding:8px; background:rgba(240,106,74,0.1); border:1px solid rgba(240,106,74,0.2); border-radius:8px; color:var(--red); font-size:12px; cursor:pointer; font-family:'Syne',sans-serif; font-weight:600"
    >Eliminar dispositivo</button>
  `;
}

window.removeNode = function(id) {
  nodes       = nodes.filter(n => n.id !== id);
  connections = connections.filter(c => c.from !== id && c.to !== id);
  selectedNode = null;
  showSelectedInfo(null);
  updateNetworkStats();
  drawNetwork();
};

function showTooltip(node, cx, cy) {
  const t = document.getElementById("nodeTooltip");
  document.getElementById("ttTitle").textContent = `${DEVICE_EMOJIS[node.type]} ${deviceHostname(node)}`;
  document.getElementById("ttIp").textContent    = node.ip;
  document.getElementById("ttType").textContent  = node.type.toUpperCase();
  document.getElementById("ttMac").textContent   = node.mac;
  document.getElementById("ttShortId").textContent = shortId(node);
  t.style.left = (cx + 14) + "px";
  t.style.top  = (cy - 10) + "px";
  t.classList.add("visible");
}

function hideTooltip() {
  document.getElementById("nodeTooltip").classList.remove("visible");
}

window.toggleGlossary = function(el) {
  el.classList.toggle("open");
};

/* ══════════════════════════
   TERMINAL SIMULADA
══════════════════════════ */

const COMMANDS = {
  help: () => [
    "Comandos disponibles:",
    "  ipconfig     — Muestra configuración de red",
    "  ping [IP]    — Ping a una IP",
    "  ls / dir     — Lista ficheros",
    "  whoami       — Usuario actual (nombre público)",
    "  os           — Información del SO",
    "  clear        — Limpia la terminal",
    "  date         — Fecha y hora actual",
    "  cat motd     — Mensaje del día"
  ],
  ipconfig: () => {
    sessionFlags.ipconfig = true;
    return [
      "Adaptador Ethernet 0:",
      `  Dirección IPv4 . . . : 192.168.1.100`,
      `  Máscara de subred  . : 255.255.255.0`,
      `  Puerta de enlace . . : 192.168.1.1`,
      "",
      "Adaptador WiFi:",
      `  Dirección IPv4 . . . : 192.168.1.101`,
      `  Máscara de subred  . : 255.255.255.0`,
      `  Puerta de enlace . . : 192.168.1.1`,
      `  Servidor DNS . . . . : 8.8.8.8`
    ];
  },
  whoami: () => [currentData ? displayUsername(currentData) : "invitado"],
  os: () => [
    "SMR-LAB OS — versión 2.1",
    "Kernel: Linux 6.6.0-smr",
    "Arquitectura: x86_64",
    "Uptime: 99.9%",
    "RAM: 16 GB · Libre: 12 GB"
  ],
  ls: () => ["documentos/  descargas/  red/  sistemas/  misiones.txt"],
  dir: () => ["documentos/  descargas/  red/  sistemas/  misiones.txt"],
  date: () => [new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" })],
  "cat motd": () => [
    "╔══════════════════════════════╗",
    "║   Bienvenido a SMR LAB v2    ║",
    "║  Aprende · Practica · Sube   ║",
    "╚══════════════════════════════╝"
  ],
  clear: () => "__CLEAR__"
};

window.handleTerminal = function(e) {
  if (e.key !== "Enter") return;
  const input = document.getElementById("terminalInput");
  const cmd   = input.value.trim();
  input.value = "";

  if (!cmd) return;

  const body = document.getElementById("terminalBody");

  const inputLine = document.createElement("div");
  inputLine.className = "terminal-line";
  inputLine.innerHTML = `<span class="mono terminal-prompt">smr@lab:~$</span><span class="mono terminal-text"> ${cmd}</span>`;
  body.appendChild(inputLine);

  const key    = cmd.toLowerCase();
  const handler = COMMANDS[key] || (key.startsWith("ping")
    ? () => {
        const target = cmd.split(" ")[1] || "8.8.8.8";
        return [
          `Haciendo ping a ${target}...`,
          `64 bytes de ${target}: icmp_seq=1 ttl=64 tiempo=12 ms`,
          `64 bytes de ${target}: icmp_seq=2 ttl=64 tiempo=10 ms`,
          `64 bytes de ${target}: icmp_seq=3 ttl=64 tiempo=11 ms`,
          ``,
          `Estadísticas: 3 enviados, 3 recibidos, 0% pérdida`
        ];
      }
    : null);

  if (handler) {
    const output = handler();
    if (output === "__CLEAR__") {
      body.innerHTML = "";
    } else {
      output.forEach(line => {
        const outLine = document.createElement("div");
        outLine.className = "terminal-line";
        outLine.innerHTML = `<span class="mono terminal-output">${line}</span>`;
        body.appendChild(outLine);
      });
    }
  } else {
    const errLine = document.createElement("div");
    errLine.className = "terminal-line";
    errLine.innerHTML = `<span class="mono terminal-error">bash: ${cmd}: comando no encontrado. Escribe 'help'.</span>`;
    body.appendChild(errLine);
  }

  body.scrollTop = body.scrollHeight;
};

/* ══════════════════════════
   MISIONES
══════════════════════════ */

const MISSIONS_DATA = [
  { id: "m01", icon: "🌐", title: "Primera Conexión", desc: "Conecta dos dispositivos en el simulador de redes.", xp: 15, difficulty: "easy", color: "var(--accent)" },
  { id: "m02", icon: "🔀", title: "Topología Estrella", desc: "1 switch central y 4 PCs, cada uno conectado al switch.", xp: 30, difficulty: "medium", color: "var(--blue)" },
  { id: "m03", icon: "💻", title: "Comando ipconfig", desc: "Ejecuta ipconfig en el terminal simulado.", xp: 10, difficulty: "easy", color: "var(--yellow)" },
  { id: "m04", icon: "📡", title: "Red Mixta", desc: "Al menos 1 router, 2 switches y 4 PCs en el lienzo.", xp: 50, difficulty: "hard", color: "var(--red)" },
  { id: "m05", icon: "🖥", title: "Servidor en Red", desc: "Un servidor conectado a al menos 2 dispositivos.", xp: 25, difficulty: "medium", color: "var(--accent)" },
  { id: "m06", icon: "⚡", title: "Analista de Redes", desc: "Usa Analizar para obtener estadísticas de tu red.", xp: 10, difficulty: "easy", color: "var(--blue)" }
];

function verifyMissionLocally(id) {
  const switches = nodes.filter(n => n.type === "switch");
  const pcs        = nodes.filter(n => n.type === "pc");
  const routers    = nodes.filter(n => n.type === "router");
  const servers    = nodes.filter(n => n.type === "server");

  switch (id) {
    case "m01":
      return connections.length >= 1;
    case "m02": {
      const sw = switches[0];
      if (!sw || pcs.length < 4) return false;
      const pcNeighbors = pcs.filter(pc =>
        connections.some(c =>
          (c.from === sw.id && c.to === pc.id) || (c.to === sw.id && c.from === pc.id)
        )
      );
      return pcNeighbors.length >= 4;
    }
    case "m03":
      return sessionFlags.ipconfig === true;
    case "m04":
      return routers.length >= 1 && switches.length >= 2 && pcs.length >= 4;
    case "m05": {
      const srv = servers.find(s => degree(s.id) >= 2);
      return Boolean(srv);
    }
    case "m06":
      return sessionFlags.analyze === true;
    default:
      return false;
  }
}

function missionStatusLabel(status) {
  if (status === "verified") return "verificado";
  if (status === "rejected") return "rechazado";
  return "pendiente";
}

function loadMissions() {
  const grid = document.getElementById("missionsGrid");
  let pendingCount = 0;

  grid.innerHTML = MISSIONS_DATA.map(m => {
    const status = getMissionState(m.id);
    if (status !== "verified") pendingCount++;

    const cls =
      status === "verified" ? "mission-card--verified completed" :
      status === "rejected" ? "mission-card--rejected" : "";

    return `
    <div class="mission-card ${cls}" style="--mission-color:${m.color}" onclick="openMission('${m.id}')">
      <div class="mission-card__header">
        <span class="mission-card__icon">${m.icon}</span>
        <span class="mission-card__xp">+${m.xp} XP</span>
      </div>
      <h3 class="mission-card__title">${m.title}</h3>
      <p  class="mission-card__desc">${m.desc}</p>
      <div class="mission-card__footer">
        <span class="mission-card__difficulty diff--${m.difficulty}">${m.difficulty.toUpperCase()}</span>
        <span class="mission-status mission-status--${status === "verified" ? "verified" : status === "rejected" ? "rejected" : "pending"}">${missionStatusLabel(status)}</span>
      </div>
      ${status === "verified" ? '<div class="mission-progress"><div class="mission-progress__fill" style="width:100%"></div></div>' : ""}
    </div>
    `;
  }).join("");

  const badge = document.getElementById("misionBadge");
  badge.textContent = pendingCount;
  badge.style.display = pendingCount > 0 ? "" : "none";
}

window.openMission = function(id) {
  const m = MISSIONS_DATA.find(x => x.id === id);
  const status = getMissionState(id);

  let actions = "";
  if (status === "verified") {
    actions = `<div style="padding:12px; background:var(--accent-dim); border:1px solid rgba(74,240,196,0.25); border-radius:10px; color:var(--accent); font-size:13px; text-align:center">✓ Misión verificada · XP ya otorgado</div>`;
  } else if (status === "rejected") {
    actions = `<div style="padding:12px; background:rgba(240,106,74,0.1); border:1px solid rgba(240,106,74,0.25); border-radius:10px; color:var(--red); font-size:13px; text-align:center">✕ Rechazada · consulta con tu tutor</div>`;
  } else {
    actions = `
      <button type="button" class="btn btn--primary btn--full" onclick="verifyMission('${id}')">Verificar misión</button>
      <p class="mono" style="margin-top:10px; font-size:11px; color:var(--text-dim); text-align:center">No se puede reclamar XP manualmente: debe cumplirse la comprobación.</p>
    `;
  }

  document.getElementById("missionModalContent").innerHTML = `
    <div class="modal-mission__icon">${m.icon}</div>
    <h2 class="modal-mission__title">${m.title}</h2>
    <p  class="modal-mission__desc">${m.desc}</p>
    <div class="modal-mission__xp">
      <span class="mission-card__xp" style="font-size:14px">+${m.xp} XP</span>
      &nbsp;
      <span class="mission-card__difficulty diff--${m.difficulty}" style="font-size:12px">${m.difficulty.toUpperCase()}</span>
    </div>
    ${actions}
  `;

  document.getElementById("missionModal").classList.add("open");
};

window.verifyMission = async function(id) {
  if (!currentUser || !currentData) return;
  const status = getMissionState(id);
  if (status === "verified") return;

  const ok = verifyMissionLocally(id);
  if (!ok) {
    showToast("Aún no cumples los requisitos de la misión", "⚠");
    return;
  }

  const m = MISSIONS_DATA.find(x => x.id === id);
  const missions = { ...(currentData.missions || {}) };
  missions[id] = { status: "verified", ts: Date.now() };

  const prevXp = Number(currentData.totalXP || 0);
  const newXp = prevXp + m.xp;
  const completed = countVerifiedMissions(missions);
  const oldLevel = computeLevelMeta(prevXp).level;

  await persistUserXP(newXp, missions, completed);

  closeModal("missionModal");
  showToast(`+${m.xp} XP · Misión verificada: ${m.title}`, "✦");

  const newLevel = computeLevelMeta(newXp).level;
  if (newLevel > oldLevel) {
    setTimeout(() => showToast(`¡Subiste al nivel ${newLevel}!`, "⬆"), 900);
  }

  loadMissions();
  loadLeaderboard();
};

window.closeModal = function(id) {
  document.getElementById(id).classList.remove("open");
};

/* ══════════════════════════
   LEADERBOARD
══════════════════════════ */

async function loadLeaderboard() {
  try {
    const snap = await getDocs(collection(db, "users"));
    const users = [];
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));

    users.sort((a, b) => {
      const ax = Number(a.totalXP ?? a.xp ?? 0);
      const bx = Number(b.totalXP ?? b.xp ?? 0);
      return bx - ax;
    });

    const top = users.slice(0, 15);
    buildPodium(top.slice(0, 3));
    buildTable(top);
  } catch (e) {
    console.error("loadLeaderboard", e);
  }
}

function leaderboardName(u) {
  return u.username || "usuario";
}

function buildPodium(top) {
  const order = [1, 0, 2];
  const medals = ["🥇", "🥈", "🥉"];

  const podium = document.getElementById("podium");
  if (!podium || top.length === 0) return;

  podium.innerHTML = order.map(i => {
    const u = top[i];
    if (!u) return "";
    const pos   = i + 1;
    const name  = leaderboardName(u);
    const init  = name.charAt(0).toUpperCase();
    const xp    = Number(u.totalXP ?? u.xp ?? 0);
    const { level } = computeLevelMeta(xp);
    return `
      <div class="podium-slot podium-slot--${pos}" style="animation: fadeSlideUp 0.5s ${i * 0.1}s both">
        <div class="podium-slot__avatar">${init}</div>
        <div class="podium-slot__meta">
          <div class="podium-slot__name">${name}</div>
          <div class="podium-slot__level mono">Nv.${level}</div>
        </div>
        <div class="podium-slot__xp mono">${xp} XP</div>
        <div class="podium-slot__medal">${medals[i]}</div>
        <div class="podium-slot__bar"></div>
      </div>
    `;
  }).join("");
}

function buildTable(users) {
  const list = document.getElementById("leaderboardList");
  if (!list) return;

  list.innerHTML = users.map((u, idx) => {
    const pos  = idx + 1;
    const name = leaderboardName(u);
    const init = name.charAt(0).toUpperCase();
    const isMe = currentUser && u.id === currentUser.uid;
    const xp   = Number(u.totalXP ?? u.xp ?? 0);
    const { level } = computeLevelMeta(xp);

    return `
      <div class="lb-row lb-row--${pos} ${isMe ? "lb-row--me" : ""}" style="animation: fadeSlideRight 0.4s ${idx * 0.04}s both">
        <span class="lb-row__rank mono">${pos <= 3 ? ["🥇","🥈","🥉"][pos-1] : `#${pos}`}</span>
        <div class="lb-row__info">
          <div class="lb-row__avatar">${init}</div>
          <span class="lb-row__username">${name}${isMe ? " (tú)" : ""}</span>
        </div>
        <span class="lb-row__level mono">Nv.${level}</span>
        <span class="lb-row__xp mono">${xp}</span>
      </div>
    `;
  }).join("");
}

/* ══════════════════════════
   TOAST
══════════════════════════ */

let toastTimeout;

function showToast(msg, prefix = "") {
  const el  = document.getElementById("toast");
  const txt = document.getElementById("toastMsg");
  txt.textContent = prefix ? `${prefix} ${msg}` : msg;
  el.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove("show"), 3000);
}

switchAuthTab("login");
