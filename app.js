/* ══════════════════════════════════════════════════
   SMR LAB v3.0 — app.js
   Auth · Firestore · Canvas · Terminal · Misiones
   Profile Panel · Level-Up Overlay · OS Terminals
══════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, deleteUser
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc,
  collection, getDocs, runTransaction
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

/* ── Firebase config ── */
const firebaseConfig = {
  apiKey: "AIzaSyCwhCOlTDTVDmUgqpmNb_QIgaB3soBUbDU",
  authDomain: "smr-lab-a71c6.firebaseapp.com",
  projectId: "smr-lab-a71c6",
  storageBucket: "smr-lab-a71c6.firebasestorage.app",
  messagingSenderId: "921445167226",
  appId: "1:921445167226:web:a6003674fa6cee94f9cbc3"
};
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ══════════════════════
   CONSTANTS & STATE
══════════════════════ */
const XP_PER_LEVEL = 100;

let currentUser  = null;
let currentData  = null;
let authMode     = "login";
let canvasMode   = "move";
let nodes        = [];
let connections  = [];
let selectedNode = null;
let connectFrom  = null;
let hoveredNode  = null;
let currentOS    = "linux";
let hoursTimer   = null;
let lastTickMs   = Date.now();

const sessionFlags = { ipconfig: false, analyze: false };

/* ══════════════════════
   XP / LEVEL HELPERS
══════════════════════ */
function lvlMeta(totalXP) {
  const xp  = Math.max(0, Number(totalXP) || 0);
  const lvl = Math.floor(xp / XP_PER_LEVEL) + 1;
  const inLvl = xp % XP_PER_LEVEL;
  const toNext = XP_PER_LEVEL - inLvl;
  return { lvl, inLvl, toNext, pct: (inLvl / XP_PER_LEVEL) * 100 };
}
function countVerified(missions) {
  return Object.values(missions || {}).filter(m => m?.status === "verified").length;
}
function getMissionState(id) {
  return currentData?.missions?.[id]?.status || "pending";
}
function displayName(data) {
  return data?.username || "usuario";
}
function normalizeUN(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
}
function mergeData(raw) {
  const d = { ...(raw || {}) };
  const xp = Math.max(Number(d.totalXP ?? d.xp ?? 0), 0);
  d.totalXP = xp; d.xp = xp;
  d.hoursPlayed = Number(d.hoursPlayed ?? 0);
  d.missions = (d.missions && typeof d.missions === "object") ? d.missions : {};
  if (Array.isArray(d.completedMissions)) {
    for (const id of d.completedMissions) {
      if (!d.missions[id]) d.missions[id] = { status: "verified", migrated: true };
    }
  }
  if (!d.username) d.username = `smr_${(d.email || "user").split("@")[0].slice(0, 12)}`;
  const m = lvlMeta(xp);
  d.level = m.lvl; d.xpToNextLevel = m.toNext;
  d.missionsCompleted = countVerified(d.missions);
  return d;
}

/* ══════════════════════
   LOGIN PARTICLES
══════════════════════ */
(function() {
  const c = document.getElementById("loginParticles");
  if (!c) return;
  const x = c.getContext("2d");
  let pts = [];
  function resize() { c.width = innerWidth; c.height = innerHeight; }
  function mkPt() {
    return { x: Math.random()*c.width, y: Math.random()*c.height,
             vx:(Math.random()-.5)*.4, vy:(Math.random()-.5)*.4,
             r: Math.random()*1.5+.5, o: Math.random()*.5+.1 };
  }
  function tick() {
    x.clearRect(0,0,c.width,c.height);
    for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++) {
      const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.hypot(dx,dy);
      if (d<120) {
        x.beginPath(); x.moveTo(pts[i].x,pts[i].y); x.lineTo(pts[j].x,pts[j].y);
        x.strokeStyle=`rgba(74,240,196,${.06*(1-d/120)})`; x.lineWidth=.8; x.stroke();
      }
    }
    pts.forEach(p => {
      x.beginPath(); x.arc(p.x,p.y,p.r,0,Math.PI*2);
      x.fillStyle=`rgba(74,240,196,${p.o})`; x.fill();
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0||p.x>c.width) p.vx*=-1;
      if(p.y<0||p.y>c.height) p.vy*=-1;
    });
    requestAnimationFrame(tick);
  }
  addEventListener("resize", resize);
  resize(); pts = Array.from({length:80}, mkPt); tick();
})();

/* ══════════════════════
   AUTH UI
══════════════════════ */
window.switchAuthTab = function(mode) {
  authMode = mode;
  document.getElementById("tabLogin").classList.toggle("active", mode==="login");
  document.getElementById("tabRegister").classList.toggle("active", mode==="register");
  document.getElementById("authBtnText").textContent = mode==="login" ? "Iniciar sesión" : "Crear cuenta";
  document.getElementById("authError").textContent = "";
  document.getElementById("usernameField").classList.toggle("hidden", mode==="login");
};

window.handleAuth = async function() {
  const ident = document.getElementById("identifier").value.trim();
  const pass  = document.getElementById("password").value;
  const uRaw  = document.getElementById("username").value.trim();
  const err   = document.getElementById("authError");
  err.textContent = "";

  if (!ident || !pass) { err.textContent = "⚠ Rellena todos los campos."; return; }

  if (authMode === "register") {
    if (!uRaw || uRaw.length < 3) { err.textContent = "⚠ Nombre de usuario: mín. 3 caracteres."; return; }
    const un = normalizeUN(uRaw);
    if (!/^[a-z0-9_]{3,24}$/.test(un)) { err.textContent = "⚠ Solo letras a-z, números y _. Longitud 3–24."; return; }

    try {
      const unRef = doc(db, "usernames", un);
      const taken = await getDoc(unRef);
      if (taken.exists()) { err.textContent = "⚠ Ese nombre de usuario ya está en uso."; return; }

      const cred = await createUserWithEmailAndPassword(auth, ident, pass);
      const uRef = doc(db, "users", cred.user.uid);
      const m = lvlMeta(0);
      const payload = {
        email: ident, username: un,
        totalXP: 0, xp: 0, level: 1, xpToNextLevel: 100,
        hoursPlayed: 0, missionsCompleted: 0,
        missions: {}, completedMissions: [],
        createdAt: Date.now()
      };
      try {
        await runTransaction(db, async tx => {
          if ((await tx.get(unRef)).exists()) throw new Error("TAKEN");
          tx.set(unRef, { uid: cred.user.uid });
          tx.set(uRef, payload);
        });
      } catch (inner) {
        try { await deleteUser(cred.user); } catch(_) {}
        if (inner.message === "TAKEN") { err.textContent = "⚠ Nombre ya registrado. Prueba otro."; return; }
        throw inner;
      }
    } catch(e) { err.textContent = "⚠ " + friendlyErr(e.code); }
  } else {
    try { await signInWithEmailAndPassword(auth, ident, pass); }
    catch(e) { err.textContent = "⚠ " + friendlyErr(e.code); }
  }
};

function friendlyErr(code) {
  const m = {
    "auth/user-not-found":    "No existe cuenta con ese correo.",
    "auth/wrong-password":    "Contraseña incorrecta.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
    "auth/weak-password":     "Contraseña demasiado corta (mín. 6).",
    "auth/invalid-email":     "Formato de correo inválido.",
    "auth/invalid-credential":"Credenciales incorrectas.",
    "permission-denied":      "Firestore bloqueó la operación. Revisa las reglas."
  };
  return m[code] || ("Error: " + code);
}

/* ══════════════════════
   SESSION
══════════════════════ */
onAuthStateChanged(auth, async user => {
  if (hoursTimer) { clearInterval(hoursTimer); hoursTimer = null; }
  removeEventListener("beforeunload", onUnload);

  if (user) {
    currentUser = user;
    try {
      const ref  = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      let raw    = snap.data() || {};

      if (!snap.exists()) {
        const email = user.email || "";
        const uname = normalizeUN(email.split("@")[0]) || `u_${user.uid.slice(0,8)}`;
        const pd = {
          email, username: uname, totalXP:0, xp:0, level:1,
          xpToNextLevel:100, hoursPlayed:0, missionsCompleted:0,
          missions:{}, completedMissions:[], createdAt: Date.now()
        };
        await setDoc(ref, pd, {merge:true});
        raw = (await getDoc(ref)).data() || {};
      }

      /* patch missing fields */
      const patch = {};
      if (raw.totalXP == null) patch.totalXP = Number(raw.xp ?? 0);
      if (!raw.username) patch.username = `smr_${(raw.email||"").split("@")[0].slice(0,12)}`;
      if (!raw.createdAt) patch.createdAt = Date.now();
      if (Object.keys(patch).length) {
        await setDoc(ref, patch, {merge:true});
        raw = {...raw, ...patch};
      }

      currentData = mergeData(raw);

      /* ensure username doc */
      try {
        const unRef = doc(db, "usernames", currentData.username);
        const us    = await getDoc(unRef);
        if (!us.exists()) await setDoc(unRef, {uid: user.uid});
      } catch(_) {}

      showApp();
      renderProfile();
      loadMissions();
      void loadLeaderboard();
      initOS(currentOS);

      lastTickMs = Date.now();
      hoursTimer = setInterval(tickHours, 60_000);
      addEventListener("beforeunload", onUnload);

      setTimeout(() => { resizeCanvas(); drawNetwork(); }, 120);
    } catch(e) {
      console.error(e);
      document.getElementById("authError").textContent = "⚠ Error al cargar datos: " + (e.message || e.code);
    }
  } else {
    currentUser = currentData = null;
    hideApp();
  }
});

function showApp() {
  document.getElementById("loginScreen").style.display = "none";
  const el = document.getElementById("app");
  el.style.display = "flex";
  requestAnimationFrame(() => el.classList.add("visible"));
}
function hideApp() {
  document.getElementById("loginScreen").style.display = "flex";
  const el = document.getElementById("app");
  el.style.display = "none";
  el.classList.remove("visible");
}
function onUnload() { void flushHours(); }

window.logout = async function() {
  await flushHours();
  await signOut(auth);
};

async function tickHours() {
  if (!currentUser || !currentData) return;
  const now = Date.now(), dh = (now - lastTickMs) / 3_600_000;
  lastTickMs = now;
  currentData.hoursPlayed = (currentData.hoursPlayed||0) + dh;
  try { await setDoc(doc(db,"users",currentUser.uid), {hoursPlayed:currentData.hoursPlayed}, {merge:true}); } catch(_){}
}
async function flushHours() {
  if (!currentUser || !currentData) return;
  const now = Date.now(), dh = (now - lastTickMs) / 3_600_000;
  lastTickMs = now;
  if (dh <= 0) return;
  currentData.hoursPlayed = (currentData.hoursPlayed||0) + dh;
  try { await setDoc(doc(db,"users",currentUser.uid), {hoursPlayed:currentData.hoursPlayed}, {merge:true}); } catch(_){}
}

/* ══════════════════════
   PROFILE / XP
══════════════════════ */
function renderProfile() {
  if (!currentData) return;
  const name = displayName(currentData);
  const init = name.charAt(0).toUpperCase();
  const { lvl, inLvl, toNext, pct } = lvlMeta(currentData.totalXP || 0);

  document.getElementById("profileName").textContent   = name;
  document.getElementById("profileLevel").textContent  = `Nivel ${lvl}`;
  document.getElementById("profileAvatar").textContent = init;
  document.getElementById("xpLabel").textContent       = `${inLvl} / ${XP_PER_LEVEL}`;
  document.getElementById("totalXpDisplay").textContent = currentData.totalXP || 0;
  setTimeout(() => { document.getElementById("xpFill").style.width = pct + "%"; }, 350);
}

async function grantXP(amount, reason) {
  if (!currentUser || !currentData) return;
  const oldXP  = currentData.totalXP || 0;
  const newXP  = oldXP + amount;
  const oldLvl = lvlMeta(oldXP).lvl;
  const newLvl = lvlMeta(newXP).lvl;

  currentData.totalXP = newXP; currentData.xp = newXP;
  const m = lvlMeta(newXP);
  currentData.level = m.lvl; currentData.xpToNextLevel = m.toNext;

  renderProfile();
  showToast(`+${amount} XP · ${reason}`, "✦");

  if (newLvl > oldLvl) setTimeout(() => triggerLevelUp(newLvl), 600);
}

async function persistXP(newXP, missions, missionsCompleted) {
  if (!currentUser) return;
  const m = lvlMeta(newXP);
  currentData.totalXP = newXP; currentData.xp = newXP;
  currentData.level = m.lvl; currentData.xpToNextLevel = m.toNext;
  currentData.missions = missions; currentData.missionsCompleted = missionsCompleted;

  await setDoc(doc(db,"users",currentUser.uid), {
    totalXP: newXP, xp: newXP, level: m.lvl,
    xpToNextLevel: m.toNext, missions, missionsCompleted
  }, {merge:true});

  renderProfile();
}

/* ══════════════════════
   LEVEL-UP ANIMATION
══════════════════════ */
function triggerLevelUp(newLevel) {
  const overlay = document.getElementById("levelUpOverlay");
  const numEl   = document.getElementById("levelUpNum");
  const subEl   = document.getElementById("levelUpSub");
  const cvs     = document.getElementById("levelUpCanvas");

  numEl.textContent = newLevel;
  subEl.textContent = `¡Nivel ${newLevel} desbloqueado!`;
  overlay.classList.add("show");

  /* burst particles */
  cvs.width = innerWidth; cvs.height = innerHeight;
  const ctx = cvs.getContext("2d");
  const particles = Array.from({length: 120}, () => ({
    x: innerWidth/2, y: innerHeight/2,
    vx: (Math.random()-0.5)*18,
    vy: (Math.random()-0.5)*18,
    size: Math.random()*6+2,
    color: ["#4af0c4","#5b8dee","#f0c44a","#f06a4a"][Math.floor(Math.random()*4)],
    life: 1, decay: Math.random()*.02+.012
  }));

  function drawBurst() {
    ctx.clearRect(0,0,cvs.width,cvs.height);
    let alive = false;
    particles.forEach(p => {
      if (p.life <= 0) return;
      alive = true;
      p.x += p.vx; p.y += p.vy; p.vy += 0.3;
      p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (alive) requestAnimationFrame(drawBurst);
  }
  requestAnimationFrame(drawBurst);

  setTimeout(() => overlay.classList.remove("show"), 3200);
}

/* ══════════════════════
   NAVIGATION
══════════════════════ */
window.switchTab = function(tab, btn) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.add("active");
  if (btn) btn.classList.add("active");
  if (tab === "redes") setTimeout(() => { resizeCanvas(); drawNetwork(); }, 50);
  if (tab === "leaderboard") loadLeaderboard();
  if (tab === "misiones") loadMissions();
};

/* ══════════════════════
   PROFILE PANEL
══════════════════════ */
window.openProfilePanel = function() {
  document.getElementById("ppOverlay").classList.add("open");
  document.getElementById("ppPanel").classList.add("open");
  fillProfilePanel();
};
window.closeProfilePanel = function() {
  document.getElementById("ppOverlay").classList.remove("open");
  document.getElementById("ppPanel").classList.remove("open");
};

function fillProfilePanel() {
  if (!currentData) return;
  const name = displayName(currentData);
  const init = name.charAt(0).toUpperCase();
  const { lvl, inLvl, toNext, pct } = lvlMeta(currentData.totalXP || 0);
  const hours = currentData.hoursPlayed || 0;
  const hDisplay = `${Math.floor(hours)}h ${Math.round((hours%1)*60)}m`;

  /* days since created */
  let daysStr = "—";
  if (currentData.createdAt) {
    const days = Math.floor((Date.now() - currentData.createdAt) / 86_400_000);
    daysStr = days === 0 ? "hoy" : `${days}d`;
  }

  document.getElementById("ppAvatar").textContent    = init;
  document.getElementById("ppName").textContent      = name;
  document.getElementById("ppEmail").textContent     = currentData.email || "—";
  document.getElementById("ppSince").textContent     = currentData.createdAt
    ? `Miembro desde ${new Date(currentData.createdAt).toLocaleDateString("es-ES")}`
    : "";
  document.getElementById("ppLevel").textContent     = lvl;
  document.getElementById("ppXpTotal").textContent   = currentData.totalXP || 0;
  document.getElementById("ppXpInLevel").textContent = `${inLvl} XP en este nivel`;
  document.getElementById("ppXpToNext").textContent  = `faltan ${toNext} XP`;
  document.getElementById("ppHours").textContent     = hDisplay;
  document.getElementById("ppMissions").textContent  = countVerified(currentData.missions);
  document.getElementById("ppXpNext").textContent    = toNext;
  document.getElementById("ppDays").textContent      = daysStr;

  setTimeout(() => { document.getElementById("ppXpFill").style.width = pct + "%"; }, 120);

  /* mission list */
  const completed = MISSIONS_DATA.filter(m => getMissionState(m.id) === "verified");
  const listEl = document.getElementById("ppMissionsList");
  if (!completed.length) {
    listEl.innerHTML = `<p class="mono" style="color:var(--text-dim);font-size:12px;text-align:center;padding:14px 0">Aún no has completado ninguna misión</p>`;
  } else {
    listEl.innerHTML = completed.map((m,i) => `
      <div class="pp-mission-row" style="animation-delay:${i*.04}s">
        <span class="pp-mission-row__icon">${m.icon}</span>
        <div class="pp-mission-row__info">
          <div class="pp-mission-row__title">${m.title}</div>
          <div class="pp-mission-row__xp">+${m.xp} XP</div>
        </div>
        <span class="pp-mission-row__check">✓</span>
      </div>
    `).join("");
  }
}

/* ══════════════════════
   CANVAS
══════════════════════ */
const canvas = document.getElementById("networkCanvas");
const ctx    = canvas.getContext("2d");

const NODE_COLOR = { router:"#5b8dee", switch:"#4af0c4", pc:"#f0c44a", server:"#f06a4a" };

/* Draw each device type as a clean SVG-style shape on canvas */
function drawDeviceShape(ctx, node) {
  const c = NODE_COLOR[node.type];
  const x = node.x, y = node.y, s = node.size;
  const r = s * 0.38;

  ctx.save();
  ctx.translate(x, y);

  if (node.type === "router") {
    /* Hexagon */
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI/3)*i - Math.PI/6;
      i===0 ? ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r) : ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
    }
    ctx.closePath();
    ctx.fillStyle = c + "22"; ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
    /* center dot */
    ctx.beginPath(); ctx.arc(0,0,r*.3,0,Math.PI*2);
    ctx.fillStyle = c; ctx.fill();
  } else if (node.type === "switch") {
    /* Rectangle with port dots */
    const w = r*1.8, h = r*.9;
    ctx.beginPath(); ctx.roundRect(-w/2,-h/2,w,h,4);
    ctx.fillStyle = c+"22"; ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
    /* port dots */
    for (let i=0;i<4;i++) {
      ctx.beginPath(); ctx.arc(-w*.3+i*(w*.2),0,r*.12,0,Math.PI*2);
      ctx.fillStyle = c; ctx.fill();
    }
  } else if (node.type === "pc") {
    /* Monitor shape */
    const w = r*1.7, h = r*1.1;
    ctx.beginPath(); ctx.roundRect(-w/2,-h/2,w,h,4);
    ctx.fillStyle = c+"22"; ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
    /* stand */
    ctx.beginPath(); ctx.moveTo(-w*.2,h/2); ctx.lineTo(w*.2,h/2);
    ctx.moveTo(0,h/2); ctx.lineTo(0,h/2+r*.4);
    ctx.moveTo(-w*.3,h/2+r*.4); ctx.lineTo(w*.3,h/2+r*.4);
    ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.stroke();
  } else if (node.type === "server") {
    /* Stack of rectangles */
    const w = r*1.6, rh = r*.45;
    [- rh*.7, rh*.7].forEach((oy, i) => {
      ctx.beginPath(); ctx.roundRect(-w/2, oy - rh/2, w, rh, 3);
      ctx.fillStyle = c+"22"; ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
      /* status dot */
      ctx.beginPath(); ctx.arc(w/2 - r*.25, oy, r*.12, 0, Math.PI*2);
      ctx.fillStyle = "#4af0c4"; ctx.fill();
    });
  }

  ctx.restore();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width; canvas.height = rect.height;
  drawNetwork();
}
window.addEventListener("resize", () => { resizeCanvas(); drawNetwork(); });

window.addDevice = function(type) {
  const mg = 80;
  nodes.push({
    id: Date.now(), type,
    x: Math.random()*(canvas.width-mg*2)+mg,
    y: Math.random()*(canvas.height-mg*2)+mg,
    ip: randomIP(type), mac: randomMAC(), size: 60
  });
  updateStats(); drawNetwork(); hideHint();
};

window.clearNetwork = function() {
  nodes=[]; connections=[]; selectedNode=null; connectFrom=null;
  updateStats(); drawNetwork(); showNodeInfo(null);
  document.getElementById("analysisCard").style.display="none";
};

window.setMode = function(mode) {
  canvasMode = mode; connectFrom = null;
  document.getElementById("btnModeMove").classList.toggle("tool-btn--active", mode==="move");
  document.getElementById("btnModeConnect").classList.toggle("tool-btn--active", mode==="connect");
  canvas.style.cursor = mode==="connect" ? "crosshair" : "default";
  drawNetwork();
};

window.analyzeNetwork = function() {
  if (!nodes.length) { showToast("Añade dispositivos primero","⚠"); return; }
  sessionFlags.analyze = true;
  const r=nodes.filter(n=>n.type==="router").length,
        sw=nodes.filter(n=>n.type==="switch").length,
        pc=nodes.filter(n=>n.type==="pc").length,
        sv=nodes.filter(n=>n.type==="server").length;
  document.getElementById("analysisCard").style.display="block";
  document.getElementById("analysisContent").innerHTML = [
    ["Dispositivos",nodes.length],["Routers",r],["Switches",sw],
    ["PCs",pc],["Servidores",sv],["Conexiones",connections.length],
    ["Nodos aislados",nodes.filter(n=>!connections.some(c=>c.from===n.id||c.to===n.id)).length],
    ["Topología", connections.length===0?"Sin conectar":r>0&&sw>0?"Mixta LAN+WAN":sw>0?"LAN local":"Ad-hoc"]
  ].map(([k,v])=>`
    <div class="analysis-row">
      <span style="color:var(--text-dim);font-size:12px;font-family:'JetBrains Mono',monospace">${k}</span>
      <span style="font-size:12px;font-weight:700;color:var(--accent);font-family:'JetBrains Mono',monospace">${v}</span>
    </div>`).join("");
};

function randomIP(t) {
  const b = t==="router"?"10.0":t==="server"?"192.168.0":"192.168.1";
  return `${b}.${Math.floor(Math.random()*200)+2}`;
}
function randomMAC() {
  return Array.from({length:6},()=>Math.floor(Math.random()*256).toString(16).padStart(2,"0")).join(":");
}
function updateStats() {
  document.getElementById("nodeCount").textContent = nodes.length;
  document.getElementById("linkCount").textContent = connections.length;
}
function hideHint() {
  if (nodes.length > 0) document.getElementById("canvasHint").classList.add("hidden");
}
function degree(id) {
  return connections.filter(c=>c.from===id||c.to===id).length;
}
function hostname(n) { return `${n.type.toUpperCase()}-${String(n.id).slice(-4)}`; }

function drawNetwork() {
  ctx.clearRect(0,0,canvas.width,canvas.height);

  /* connections */
  connections.forEach(conn => {
    const a=nodes.find(n=>n.id===conn.from), b=nodes.find(n=>n.id===conn.to);
    if (!a||!b) return;
    const grad = ctx.createLinearGradient(a.x,a.y,b.x,b.y);
    grad.addColorStop(0, NODE_COLOR[a.type]+"88");
    grad.addColorStop(1, NODE_COLOR[b.type]+"88");
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
    ctx.strokeStyle=grad; ctx.lineWidth=2.2; ctx.stroke();
    /* midpoint dot */
    ctx.beginPath(); ctx.arc((a.x+b.x)/2,(a.y+b.y)/2,3.5,0,Math.PI*2);
    ctx.fillStyle="rgba(74,240,196,.7)"; ctx.fill();
  });

  /* dashed preview line in connect mode */
  if (connectFrom) {
    const n=nodes.find(n=>n.id===connectFrom);
    if (n&&hoveredNode&&hoveredNode.id!==connectFrom) {
      ctx.beginPath(); ctx.moveTo(n.x,n.y); ctx.lineTo(hoveredNode.x,hoveredNode.y);
      ctx.strokeStyle="rgba(74,240,196,.4)"; ctx.lineWidth=1.8;
      ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /* nodes */
  nodes.forEach(node => {
    const isSelected = selectedNode?.id===node.id;
    const isConnFrom = connectFrom===node.id;
    const c = NODE_COLOR[node.type];

    if (isSelected||isConnFrom) { ctx.shadowColor=c; ctx.shadowBlur=20; }
    drawDeviceShape(ctx, node);
    ctx.shadowBlur=0;

    /* hostname */
    ctx.fillStyle=c; ctx.font="bold 10px 'JetBrains Mono',monospace";
    ctx.textAlign="center"; ctx.textBaseline="top";
    ctx.fillText(hostname(node), node.x, node.y+node.size*.4+3);
    /* ip */
    ctx.fillStyle="rgba(142,163,200,.85)"; ctx.font="9px 'JetBrains Mono',monospace";
    ctx.fillText(node.ip, node.x, node.y+node.size*.4+16);
  });
}

canvas.addEventListener("mousedown", e => {
  const {x,y}=canvasXY(e), hit=nodeAt(x,y);
  if (canvasMode==="connect") {
    if (!hit) return;
    if (!connectFrom) { connectFrom=hit.id; }
    else {
      if (hit.id!==connectFrom && !connections.some(c=>(c.from===connectFrom&&c.to===hit.id)||(c.to===connectFrom&&c.from===hit.id))) {
        connections.push({from:connectFrom,to:hit.id});
        updateStats();
      }
      connectFrom=null;
    }
    drawNetwork(); return;
  }
  selectedNode=hit||null; showNodeInfo(selectedNode); drawNetwork();
});

canvas.addEventListener("mousemove", e => {
  const {x,y}=canvasXY(e);
  hoveredNode=nodeAt(x,y)||null;
  if (canvasMode==="connect") { drawNetwork(); return; }
  if (selectedNode&&e.buttons===1) { selectedNode.x=x; selectedNode.y=y; drawNetwork(); }
  hoveredNode ? showTooltip(hoveredNode,e.clientX,e.clientY) : hideTooltip();
});

canvas.addEventListener("mouseup",   ()=>{ if(canvasMode==="move") selectedNode=null; });
canvas.addEventListener("mouseleave",()=>{ hideTooltip(); hoveredNode=null; });

function canvasXY(e) { const r=canvas.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top}; }
function nodeAt(x,y) {
  for (let i=nodes.length-1;i>=0;i--) {
    const n=nodes[i],dx=x-n.x,dy=y-n.y;
    if (Math.hypot(dx,dy)<n.size/2) return n;
  }
  return null;
}

function showNodeInfo(node) {
  const el=document.getElementById("selectedInfo");
  if (!node) { el.innerHTML=`<p class="mono" style="color:var(--text-dim);font-size:12px;text-align:center;padding:16px 0">Haz click en un nodo</p>`; return; }
  const c=NODE_COLOR[node.type];
  el.innerHTML=`
    <div class="selected-info__hero">
      <div style="width:36px;height:36px;border-radius:8px;background:${c}22;border:1px solid ${c}55;display:flex;align-items:center;justify-content:center">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">${deviceMiniSVG(node.type,c)}</svg>
      </div>
      <div class="selected-info__meta">
        <div class="selected-info__label">Host</div>
        <div class="selected-info__hostname mono">${hostname(node)}</div>
      </div>
    </div>
    <div class="selected-info-row"><span class="mono">Tipo</span><span class="device-badge device-badge--${node.type}">${node.type.toUpperCase()}</span></div>
    <div class="selected-info-row"><span class="mono">IP</span><span class="mono" style="color:${c}">${node.ip}</span></div>
    <div class="selected-info-row"><span class="mono">MAC</span><span class="mono" style="color:var(--text-mid);font-size:11px">${node.mac}</span></div>
    <div class="selected-info-row"><span class="mono">Conexiones</span><span class="mono" style="color:var(--accent)">${degree(node.id)}</span></div>
    <button type="button" onclick="removeNode(${node.id})"
      style="margin-top:8px;width:100%;padding:8px;background:rgba(240,106,74,.1);border:1px solid rgba(240,106,74,.2);border-radius:8px;color:var(--red);font-size:12px;cursor:pointer;font-family:'Syne',sans-serif;font-weight:600">
      Eliminar dispositivo
    </button>`;
}

function deviceMiniSVG(type, c) {
  if (type==="router") return `<path d="M9 2L16 5.5V12.5L9 16L2 12.5V5.5L9 2Z" stroke="${c}" stroke-width="1.2" fill="none"/><circle cx="9" cy="9" r="2.5" fill="${c}"/>`;
  if (type==="switch") return `<rect x="1" y="6" width="16" height="6" rx="1.5" stroke="${c}" stroke-width="1.2" fill="none"/><circle cx="5" cy="9" r="1" fill="${c}"/><circle cx="9" cy="9" r="1" fill="${c}"/><circle cx="13" cy="9" r="1" fill="${c}"/>`;
  if (type==="pc")     return `<rect x="1" y="2" width="13" height="10" rx="1.5" stroke="${c}" stroke-width="1.2" fill="none"/><line x1="6" y1="16" x2="12" y2="16" stroke="${c}" stroke-width="1.2" stroke-linecap="round"/><line x1="9" y1="12" x2="9" y2="16" stroke="${c}" stroke-width="1.2"/>`;
  if (type==="server") return `<rect x="2" y="2" width="14" height="6" rx="1" stroke="${c}" stroke-width="1.2" fill="none"/><rect x="2" y="10" width="14" height="6" rx="1" stroke="${c}" stroke-width="1.2" fill="none"/><circle cx="13" cy="5" r="1" fill="#4af0c4"/><circle cx="13" cy="13" r="1" fill="#4af0c4"/>`;
  return "";
}

window.removeNode = function(id) {
  nodes=nodes.filter(n=>n.id!==id);
  connections=connections.filter(c=>c.from!==id&&c.to!==id);
  selectedNode=null; showNodeInfo(null); updateStats(); drawNetwork();
};

function showTooltip(node,cx,cy) {
  const t=document.getElementById("nodeTooltip");
  document.getElementById("ttTitle").textContent = `${hostname(node)}`;
  document.getElementById("ttIp").textContent    = node.ip;
  document.getElementById("ttType").textContent  = node.type.toUpperCase();
  document.getElementById("ttMac").textContent   = node.mac;
  document.getElementById("ttShortId").textContent = String(node.id).slice(-4);
  t.style.left=(cx+14)+"px"; t.style.top=(cy-10)+"px";
  t.classList.add("visible");
}
function hideTooltip() { document.getElementById("nodeTooltip").classList.remove("visible"); }

window.toggleGlossary = function(el) { el.classList.toggle("open"); };

/* ══════════════════════
   OS TERMINALS
══════════════════════ */
const OS_META = {
  linux: {
    name:"Linux", distro:"Ubuntu 22.04 LTS", kernel:"6.6.0-smr",
    color:"var(--accent)", prompt:"smr@ubuntu:~$", promptClass:"terminal-prompt",
    info:[
      {label:"KERNEL",val:"6.6.0-smr",cls:"accent"},
      {label:"SHELL",val:"bash 5.2",cls:"accent"},
      {label:"UPTIME",val:"14d 6h 22m",cls:"accent"}
    ],
    commands:{
      help:()=>["Comandos disponibles (Linux/bash):","  ls          Lista el directorio","  pwd         Ruta actual","  whoami      Usuario actual","  uname -a    Info del sistema","  ifconfig    Configuración de red","  ipconfig    (alias) Configuración de red","  ping [IP]   Ping a una IP","  ps aux      Lista procesos","  df -h       Uso del disco","  top         Procesos en tiempo real","  cat /etc/os-release   Info del SO","  clear       Limpia la terminal"],
      ls:()=>["total 48","drwxr-xr-x  2 smr  smr  4096 may 14 09:12 documentos","drwxr-xr-x  3 smr  smr  4096 may 14 09:08 descargas","drwxr-xr-x  2 smr  smr  4096 may 14 10:33 red","-rw-r--r--  1 smr  smr   128 may 14 08:00 misiones.txt"],
      pwd:()=>["/home/smr"],
      whoami:()=>[()=>currentData?displayName(currentData):"smr"],
      "uname -a":()=>["Linux smr-lab 6.6.0-smr #1 SMP x86_64 x86_64 x86_64 GNU/Linux"],
      ifconfig: ipconfigOutput,
      ipconfig: ipconfigOutput,
      "ps aux":()=>["USER       PID %CPU %MEM COMMAND","smr       1234  0.2  1.1 bash","smr       5678  0.5  2.3 node app.js","root      0001  0.0  0.0 systemd"],
      "df -h":()=>["Filesystem      Size  Used Avail Use% Mounted on","/dev/sda1        50G   18G   32G  36% /","tmpfs           7.8G  512M  7.3G   7% /tmp"],
      top:()=>["top - 10:45:12 up 14 days","Tasks: 142 total, 1 running","%Cpu(s): 4.2 us, 1.1 sy","MiB Mem : 15842.6 total, 8122.3 free","MiB Swap: 2048.0 total, 2048.0 free"],
      "cat /etc/os-release":()=>['NAME="Ubuntu"','VERSION="22.04.4 LTS (Jammy Jellyfish)"','ID=ubuntu','ID_LIKE=debian','PRETTY_NAME="Ubuntu 22.04.4 LTS"'],
      clear:()=>"__CLEAR__"
    }
  },
  windows: {
    name:"Windows Server", distro:"Windows Server 2022", kernel:"NT 10.0.20348",
    color:"var(--blue)", prompt:"C:\\Users\\smr>", promptClass:"terminal-prompt--win",
    info:[
      {label:"BUILD",val:"20348.2340",cls:"blue"},
      {label:"SHELL",val:"PowerShell 7.4",cls:"blue"},
      {label:"UPTIME",val:"3d 14h 05m",cls:"blue"}
    ],
    commands:{
      help:()=>["Comandos disponibles (Windows/cmd):","  dir         Lista directorio","  cd          Directorio actual","  whoami      Usuario actual","  ver         Versión de Windows","  ipconfig    Configuración de red","  ping [IP]   Ping a una IP","  tasklist    Lista procesos","  systeminfo  Info del sistema","  cls         Limpia la terminal"],
      dir:()=>["Directorio de C:\\Users\\smr","","14/05/2026  09:12    <DIR>          Documentos","14/05/2026  09:08    <DIR>          Descargas","14/05/2026  10:33    <DIR>          Red","14/05/2026  08:00              128 misiones.txt","               1 archivos            128 bytes"],
      cd:()=>["C:\\Users\\smr"],
      whoami:()=>[()=>`SMR-LAB\\${currentData?displayName(currentData):"smr"}`],
      ver:()=>["Microsoft Windows [Versión 10.0.20348.2340]"],
      ipconfig: ipconfigOutput,
      tasklist:()=>["Nombre de imagen         PID Sesión       Mem. uso","========================= === =========== ============","System Idle Process         0 Services      8 KB","svchost.exe              1234 Services    42.580 KB","powershell.exe           5678 Console     98.432 KB"],
      systeminfo:()=>["Nombre de host:              SMR-LAB","Nombre del sistema operativo:  Microsoft Windows Server 2022","Versión del sistema operativo: 10.0.20348","Memoria física total:          16.384 MB","Memoria física disponible:      8.192 MB"],
      cls:()=>"__CLEAR__"
    }
  },
  mac: {
    name:"macOS", distro:"macOS Ventura 13.6", kernel:"Darwin 22.6.0",
    color:"var(--yellow)", prompt:"smr@MacBook-Pro ~ %", promptClass:"terminal-prompt--mac",
    info:[
      {label:"VERSIÓN",val:"Ventura 13.6",cls:"yellow"},
      {label:"SHELL",val:"zsh 5.9",cls:"yellow"},
      {label:"CHIP",val:"Apple M2 Pro",cls:"yellow"}
    ],
    commands:{
      help:()=>["Comandos disponibles (macOS/zsh):","  ls -la      Lista con detalles","  pwd         Directorio actual","  whoami      Usuario actual","  sw_vers     Versión de macOS","  ifconfig    Configuración de red","  ipconfig    (getifaddr en1) IP","  ping [IP]   Ping a una IP","  ps aux      Lista procesos","  diskutil list  Discos","  brew list   Paquetes instalados","  clear       Limpia la terminal"],
      "ls -la":()=>["total 48","drwxr-xr-x   8 smr  staff   256 May 14 09:12 .","drwxr-xr-x  22 smr  staff   704 May 14 08:00 ..","drwxr-xr-x   2 smr  staff    64 May 14 09:12 Documents","drwxr-xr-x   3 smr  staff    96 May 14 09:08 Downloads","-rw-r--r--   1 smr  staff   128 May 14 08:00 misiones.txt"],
      ls:()=>["Documents  Downloads  Desktop  red  misiones.txt"],
      pwd:()=>["/Users/smr"],
      whoami:()=>[()=>currentData?displayName(currentData):"smr"],
      "sw_vers":()=>["ProductName:    macOS","ProductVersion: 13.6.7","BuildVersion:   22G720"],
      ifconfig: ipconfigOutput,
      ipconfig:()=>["192.168.1.101"],
      "ps aux":()=>["USER       PID  %CPU %MEM COMMAND","smr       1234   0.1  0.8 zsh","smr       5678   1.2  3.4 node","_windowserver 222  3.4  5.6 WindowServer"],
      "diskutil list":()=>["/dev/disk0 (internal):","   #:  TYPE NAME       SIZE       IDENTIFIER","   0:  GUID_partition_scheme *512.1 GB  disk0","   1:  Apple_APFS_ISC       524.3 MB  disk0s1","   2:  Apple_APFS Container  511.0 GB  disk0s2"],
      "brew list":()=>["curl  git  node  python  wget  zsh  vim  htop  nmap"],
      clear:()=>"__CLEAR__"
    }
  }
};

function ipconfigOutput() {
  sessionFlags.ipconfig = true;
  return [
    "Adaptador Ethernet 0:",
    "  Dirección IPv4 . . . : 192.168.1.100",
    "  Máscara de subred  . : 255.255.255.0",
    "  Puerta de enlace . . : 192.168.1.1",
    "",
    "Adaptador WiFi:",
    "  Dirección IPv4 . . . : 192.168.1.101",
    "  Máscara de subred  . : 255.255.255.0",
    "  Puerta de enlace . . : 192.168.1.1",
    "  Servidor DNS . . . . : 8.8.8.8"
  ];
}

window.selectOS = function(os) {
  currentOS = os;
  document.querySelectorAll(".os-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(`osBtn${os.charAt(0).toUpperCase()+os.slice(1)}`).classList.add("active");
  initOS(os);
};

function initOS(os) {
  const meta = OS_META[os];
  /* info cards */
  document.getElementById("osInfo").innerHTML = meta.info.map(c=>`
    <div class="os-info-card">
      <div class="os-info-card__label">${c.label}</div>
      <div class="os-info-card__val ${c.cls}">${c.val}</div>
    </div>`).join("");
  /* terminal */
  document.getElementById("terminalTitle").textContent = `${meta.name.toLowerCase()} — smr-lab`;
  document.getElementById("termPrompt").className = "mono terminal-prompt " + meta.promptClass;
  document.getElementById("termPrompt").textContent = meta.prompt;
  /* clear and greet */
  const body = document.getElementById("terminalBody");
  body.innerHTML = "";
  addTermLine(body,`${meta.name} — ${meta.distro}`, "terminal-output", meta.promptClass);
  addTermLine(body,`Escribe <span style="color:var(--accent)">help</span> para ver los comandos disponibles.`,"terminal-text",null,true);
}

function addTermLine(body, text, cls, promptCls, raw=false) {
  const line = document.createElement("div");
  line.className = "terminal-line";
  if (promptCls) {
    line.innerHTML = `<span class="mono ${promptCls}">${OS_META[currentOS].prompt}</span><span class="mono ${cls}"> ${raw?text:escHtml(text)}</span>`;
  } else {
    line.innerHTML = `<span class="mono ${cls}">${raw?text:escHtml(text)}</span>`;
  }
  body.appendChild(line);
}

function escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

window.clearTerminal = function() {
  document.getElementById("terminalBody").innerHTML = "";
};

window.handleTerminal = function(e) {
  if (e.key !== "Enter") return;
  const input = document.getElementById("terminalInput");
  const cmd   = input.value.trim();
  input.value = "";
  if (!cmd) return;

  const body   = document.getElementById("terminalBody");
  const meta   = OS_META[currentOS];

  /* echo input */
  const inLine = document.createElement("div");
  inLine.className = "terminal-line";
  inLine.innerHTML = `<span class="mono ${meta.promptClass}">${meta.prompt}</span><span class="mono terminal-text"> ${escHtml(cmd)}</span>`;
  body.appendChild(inLine);

  const key     = cmd.toLowerCase().trim();
  const cmds    = meta.commands;
  let handler   = cmds[key] || null;

  /* ping */
  if (!handler && key.startsWith("ping")) {
    handler = () => {
      const target = cmd.split(" ")[1] || "8.8.8.8";
      return [`Haciendo ping a ${target}...`,
              `64 bytes de ${target}: icmp_seq=1 ttl=64 tiempo=12 ms`,
              `64 bytes de ${target}: icmp_seq=2 ttl=64 tiempo=10 ms`,
              `64 bytes de ${target}: icmp_seq=3 ttl=64 tiempo=11 ms`,
              ``, `Estadísticas: 3 enviados, 3 recibidos, 0% pérdida`];
    };
  }

  if (handler) {
    const out = handler();
    if (out === "__CLEAR__") {
      body.innerHTML = "";
    } else {
      out.forEach(line => {
        const val = typeof line === "function" ? line() : line;
        const outLine = document.createElement("div");
        outLine.className = "terminal-line";
        outLine.innerHTML = `<span class="mono terminal-output">${escHtml(String(val))}</span>`;
        body.appendChild(outLine);
      });
    }
  } else {
    const errLine = document.createElement("div");
    errLine.className = "terminal-line";
    errLine.innerHTML = `<span class="mono terminal-error">${escHtml(meta.name)}: '${escHtml(cmd)}' no encontrado. Escribe 'help'.</span>`;
    body.appendChild(errLine);
  }

  body.scrollTop = body.scrollHeight;
};

/* ══════════════════════
   MISSIONS
══════════════════════ */
const MISSIONS_DATA = [
  { id:"m01", icon:"🌐", title:"Primera Conexión",   desc:"Conecta dos dispositivos en el simulador.",                      xp:15, difficulty:"easy",   color:"var(--accent)" },
  { id:"m02", icon:"🔀", title:"Topología Estrella",  desc:"1 switch central con 4 PCs conectados a él.",                   xp:30, difficulty:"medium", color:"var(--blue)"   },
  { id:"m03", icon:"💻", title:"Comando ipconfig",    desc:"Ejecuta ipconfig en cualquier terminal simulada.",               xp:10, difficulty:"easy",   color:"var(--yellow)" },
  { id:"m04", icon:"📡", title:"Red Mixta",           desc:"Al menos 1 router, 2 switches y 4 PCs en el lienzo.",           xp:50, difficulty:"hard",   color:"var(--red)"    },
  { id:"m05", icon:"🖥",  title:"Servidor en Red",     desc:"Un servidor conectado a al menos 2 dispositivos.",              xp:25, difficulty:"medium", color:"var(--accent)" },
  { id:"m06", icon:"⚡", title:"Analista de Redes",   desc:"Usa el botón Analizar para obtener estadísticas de tu red.",    xp:10, difficulty:"easy",   color:"var(--blue)"   }
];

function verifyLocally(id) {
  const sw=nodes.filter(n=>n.type==="switch");
  const pc=nodes.filter(n=>n.type==="pc");
  const ro=nodes.filter(n=>n.type==="router");
  const sv=nodes.filter(n=>n.type==="server");
  switch(id) {
    case "m01": return connections.length>=1;
    case "m02": {
      const s=sw[0]; if(!s||pc.length<4) return false;
      return pc.filter(p=>connections.some(c=>(c.from===s.id&&c.to===p.id)||(c.to===s.id&&c.from===p.id))).length>=4;
    }
    case "m03": return sessionFlags.ipconfig;
    case "m04": return ro.length>=1&&sw.length>=2&&pc.length>=4;
    case "m05": return Boolean(sv.find(s=>degree(s.id)>=2));
    case "m06": return sessionFlags.analyze;
    default:    return false;
  }
}

function loadMissions() {
  const grid=document.getElementById("missionsGrid");
  let pending=0;
  grid.innerHTML = MISSIONS_DATA.map(m=>{
    const s=getMissionState(m.id);
    if(s!=="verified") pending++;
    const cls=s==="verified"?"mission-card--verified completed":s==="rejected"?"mission-card--rejected":"";
    const statusLbl=s==="verified"?"verificado":s==="rejected"?"rechazado":"pendiente";
    return `
    <div class="mission-card ${cls}" style="--mission-color:${m.color}" onclick="openMission('${m.id}')">
      <div class="mission-card__header">
        <span class="mission-card__icon">${m.icon}</span>
        <span class="mission-card__xp">+${m.xp} XP</span>
      </div>
      <h3 class="mission-card__title">${m.title}</h3>
      <p class="mission-card__desc">${m.desc}</p>
      <div class="mission-card__footer">
        <span class="mission-card__difficulty diff--${m.difficulty}">${m.difficulty.toUpperCase()}</span>
        <span class="mission-status mission-status--${s==="verified"?"verified":s==="rejected"?"rejected":"pending"}">${statusLbl}</span>
      </div>
      ${s==="verified"?'<div class="mission-progress"><div class="mission-progress__fill" style="width:100%"></div></div>':""}
    </div>`;
  }).join("");

  const badge=document.getElementById("misionBadge");
  badge.textContent=pending;
  badge.style.display=pending>0?"":"none";
}

window.openMission = function(id) {
  const m=MISSIONS_DATA.find(x=>x.id===id), s=getMissionState(id);
  let actions="";
  if(s==="verified") {
    actions=`<div style="padding:12px;background:var(--accent-d);border:1px solid rgba(74,240,196,.25);border-radius:10px;color:var(--accent);font-size:13px;text-align:center">✓ Misión verificada · XP ya otorgado</div>`;
  } else if(s==="rejected") {
    actions=`<div style="padding:12px;background:rgba(240,106,74,.1);border:1px solid rgba(240,106,74,.25);border-radius:10px;color:var(--red);font-size:13px;text-align:center">✕ Rechazada — consulta con tu tutor</div>`;
  } else {
    actions=`
      <button type="button" class="btn btn--primary btn--full" onclick="verifyMission('${id}')">Verificar misión</button>
      <p class="mono" style="margin-top:10px;font-size:11px;color:var(--text-dim);text-align:center">
        La XP solo se otorga si se cumplen los requisitos automáticamente.
      </p>`;
  }
  document.getElementById("missionModalContent").innerHTML=`
    <div class="modal-mission__icon">${m.icon}</div>
    <h2 class="modal-mission__title">${m.title}</h2>
    <p class="modal-mission__desc">${m.desc}</p>
    <div class="modal-mission__xp">
      <span class="mission-card__xp" style="font-size:14px">+${m.xp} XP</span> &nbsp;
      <span class="mission-card__difficulty diff--${m.difficulty}" style="font-size:12px">${m.difficulty.toUpperCase()}</span>
    </div>
    ${actions}`;
  document.getElementById("missionModal").classList.add("open");
};

window.verifyMission = async function(id) {
  if(!currentUser||!currentData) return;
  if(getMissionState(id)==="verified") return;
  if(!verifyLocally(id)) { showToast("Aún no cumples los requisitos","⚠"); return; }

  const m=MISSIONS_DATA.find(x=>x.id===id);
  const missions={...(currentData.missions||{})};
  missions[id]={status:"verified",ts:Date.now()};
  const prevXP=currentData.totalXP||0, newXP=prevXP+m.xp;
  const oldLvl=lvlMeta(prevXP).lvl, newLvl=lvlMeta(newXP).lvl;
  const completed=countVerified(missions);

  await persistXP(newXP, missions, completed);
  closeModal("missionModal");
  showToast(`+${m.xp} XP · ${m.title}`,"✦");
  if(newLvl>oldLvl) setTimeout(()=>triggerLevelUp(newLvl),700);
  loadMissions();
  void loadLeaderboard();
};

window.closeModal = function(id) { document.getElementById(id).classList.remove("open"); };

/* ══════════════════════
   LEADERBOARD
══════════════════════ */
async function loadLeaderboard() {
  try {
    const snap=await getDocs(collection(db,"users"));
    const users=[]; snap.forEach(d=>users.push({id:d.id,...d.data()}));
    users.sort((a,b)=>(Number(b.totalXP??b.xp??0))-(Number(a.totalXP??a.xp??0)));
    const top=users.slice(0,15);
    buildPodium(top.slice(0,3));
    buildTable(top);
  } catch(e){ console.error("loadLeaderboard",e); }
}

function lbName(u) { return u.username||"usuario"; }

function buildPodium(top) {
  const order=[1,0,2], medals=["🥇","🥈","🥉"];
  const el=document.getElementById("podium");
  if(!el||!top.length) return;
  el.innerHTML=order.map(i=>{
    const u=top[i]; if(!u) return "";
    const pos=i+1, name=lbName(u), xp=Number(u.totalXP??u.xp??0);
    const {lvl}=lvlMeta(xp);
    return `<div class="podium-slot podium-slot--${pos}" style="animation:fadeUp .5s ${i*.1}s both">
      <div class="podium-slot__avatar">${name.charAt(0).toUpperCase()}</div>
      <div class="podium-slot__meta">
        <div class="podium-slot__name">${name}</div>
        <div class="podium-slot__level mono">Nv.${lvl}</div>
      </div>
      <div class="podium-slot__xp mono">${xp} XP</div>
      <div class="podium-slot__medal">${medals[i]}</div>
      <div class="podium-slot__bar"></div>
    </div>`;
  }).join("");
}

function buildTable(users) {
  const el=document.getElementById("leaderboardList"); if(!el) return;
  el.innerHTML=users.map((u,idx)=>{
    const pos=idx+1, name=lbName(u), xp=Number(u.totalXP??u.xp??0);
    const {lvl}=lvlMeta(xp), isMe=currentUser&&u.id===currentUser.uid;
    return `<div class="lb-row lb-row--${pos} ${isMe?"lb-row--me":""}" style="animation:slideRight .4s ${idx*.04}s both">
      <span class="lb-row__rank mono">${pos<=3?["🥇","🥈","🥉"][pos-1]:`#${pos}`}</span>
      <div class="lb-row__info">
        <div class="lb-row__avatar">${name.charAt(0).toUpperCase()}</div>
        <span class="lb-row__username">${name}${isMe?" (tú)":""}</span>
      </div>
      <span class="lb-row__level mono">Nv.${lvl}</span>
      <span class="lb-row__xp mono">${xp}</span>
    </div>`;
  }).join("");
}

/* ══════════════════════
   TOAST
══════════════════════ */
let toastTm;
function showToast(msg, prefix="") {
  const el=document.getElementById("toast");
  document.getElementById("toastMsg").textContent = prefix?`${prefix} ${msg}`:msg;
  el.classList.add("show"); clearTimeout(toastTm);
  toastTm=setTimeout(()=>el.classList.remove("show"),3000);
}

/* init auth tab */
switchAuthTab("login");