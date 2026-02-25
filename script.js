// WOW Level — smooth sensor bubble level (premium)
(() => {
  const $ = (id) => document.getElementById(id);

  const ui = {
    bubble: $("bubble"),
    badge: $("badge"),
    kGamma: $("kGamma"),
    kBeta: $("kBeta"),
    kStatus: $("kStatus"),
    btnStart: $("btnStart"),
    btnCal: $("btnCalibrate"),
    btnReset: $("btnReset"),
    btnFS: $("btnFullscreen"),
    btnHelp: $("btnHelp"),
    sens: $("sens"),
    smooth: $("smooth"),
    chipSens: $("chipSens"),
    chipSmooth: $("chipSmooth"),
    haptics: $("haptics"),
    demo: $("demo"),
    sound: $("sound"),
    autoCal: $("autoCal"),
    level: $("level"),
    pillOrient: $("pillOrient"),
    matrix: $("matrix"),
    hudAuth: $("hudAuth"),
    hudSig: $("hudSig"),
    hudMode: $("hudMode"),
    termBody: $("termBody"),
    bar: $("bar"),
    tState: $("tState"),
    modal: $("modal"),
    modalClose: $("modalClose"),
    modalX: $("modalX"),
    modalOk: $("modalOk"),
  };

  // State
  const state = {
    // raw angles
    gamma: 0,
    beta: 0,

    // calibration offsets
    offG: 0,
    offB: 0,

    // smoothed bubble position
    x: 0,
    y: 0,

    // target position
    tx: 0,
    ty: 0,

    // settings
    sensitivity: parseFloat(ui.sens.value),
    smooth: parseFloat(ui.smooth.value),
    maxAngle: 45,

    // status
    started: false,
    usingDemo: false,
    lastHapticAt: 0,
    lastSoundAt: 0,
    // auto-cal
    stableSince: 0,
    lastAngles: {g: 0, b: 0},
    autoCalDoneAt: 0
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // Matrix rain (cosmetic)
  const matrix = {
    ctx: null,
    w: 0,
    h: 0,
    cols: 0,
    drops: [],
    last: 0
  };

  function initMatrix() {
    const c = ui.matrix;
    if (!c) return;
    const ctx = c.getContext("2d");
    matrix.ctx = ctx;
    resizeMatrix();
    // seed
    for (let i = 0; i < matrix.cols; i++) matrix.drops[i] = Math.random() * 50;
  }

  function resizeMatrix() {
    const c = ui.matrix;
    if (!c || !matrix.ctx) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = c.getBoundingClientRect();
    matrix.w = Math.floor(rect.width * dpr);
    matrix.h = Math.floor(rect.height * dpr);
    c.width = matrix.w;
    c.height = matrix.h;
    c.style.width = rect.width + "px";
    c.style.height = rect.height + "px";
    const fontSize = 16 * dpr;
    matrix.ctx.font = `${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
    matrix.ctx.textBaseline = "top";
    matrix.cols = Math.max(10, Math.floor(matrix.w / (fontSize * 0.9)));
    matrix.drops = new Array(matrix.cols).fill(0).map(() => Math.random() * 60);
  }

  function drawMatrix(t) {
    if (!matrix.ctx) return;
    // ~30 fps
    if (t - matrix.last < 33) return;
    matrix.last = t;

    const ctx = matrix.ctx;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const fontSize = 16 * dpr;

    // fade
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.fillRect(0, 0, matrix.w, matrix.h);

    for (let i = 0; i < matrix.cols; i++) {
      const x = i * (fontSize * 0.9);
      const y = matrix.drops[i] * fontSize;
      const ch = String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96)); // katakana-ish
      ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
      ctx.fillText(ch, x, y);
      if (y > matrix.h && Math.random() > 0.975) matrix.drops[i] = 0;
      matrix.drops[i] += 1;
    }
  }


  function setStatus(text) {
    ui.kStatus.textContent = text;
    const allowBadge = ["idle","stopped","demo","requesting…","permission denied","no sensor","calibrated","auto-cal"].includes(text);
    if (allowBadge) ui.badge.textContent = text;
  }

  function setKPI() {
    const g = (state.gamma - state.offG);
    const b = (state.beta - state.offB);
    ui.kGamma.textContent = g.toFixed(1);
    ui.kBeta.textContent = b.toFixed(1);
    const sig = Math.hypot(g, b);
    if (ui.hudSig) ui.hudSig.textContent = sig.toFixed(2);
  }

  function updateChips() {
    ui.chipSens.textContent = `${state.sensitivity.toFixed(1)}×`;
    ui.chipSmooth.textContent = `${state.smooth.toFixed(2)}`;
  }

  function cssBubble(x, y, quality) {
    // base translate in px
    ui.bubble.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
    // color feedback
    const a = Math.hypot(x, y);
    // Terminal/progress logic
    const now = performance.now();
    const granted = a < 6;
    if (granted) {
      if (!term.unlocked) {
        // build progress while centered
        setProgress(term.progress + 2.6);
        if (now - term.lastLogAt > 320) {
          term.lastLogAt = now;
          addLine(`[+] lock alignment :: ${Math.max(0, 100 - term.progress).toFixed(0)}% remaining`);
        }
        if (term.progress >= 96) unlockStep();
      }
      setTermState(term.unlocked ? "GRANTED" : "ALIGN");
    } else {
      // decay progress
      if (!term.unlocked) setProgress(term.progress - 1.2);
      if (now - term.lastDeniedAt > 520) {
        term.lastDeniedAt = now;
        addLine("[-] <span class='bad'>AUTH</span> :: ACCESS DENIED", "bad");
        pulseAlarm();
        alarmBeep();
      }
      setTermState("DENIED");
    }
    if (a < 6) {
      ui.bubble.querySelector(".bubble-core").style.background =
        "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.10) 70%), linear-gradient(135deg, rgba(34,197,94,0.45), rgba(6,182,212,0.22))";
      ui.badge.style.borderColor = "rgba(34,197,94,0.35)";
      ui.badge.style.color = "rgba(255,255,255,0.88)";
      ui.badge.textContent = "ACCESS GRANTED";
      ui.badge.classList.add("granted");
      ui.badge.classList.remove("denied");
      if (ui.hudAuth) ui.hudAuth.textContent = "GRANTED";
      if (ui.haptics.checked) maybeHaptic();
      blip();
    } else if (a < 40) {
      ui.bubble.querySelector(".bubble-core").style.background =
        "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.10) 70%), linear-gradient(135deg, rgba(245,158,11,0.35), rgba(124,58,237,0.20))";
      ui.badge.style.borderColor = "rgba(245,158,11,0.30)";
      ui.badge.textContent = "ACCESS DENIED";
      ui.badge.classList.add("denied");
      ui.badge.classList.remove("granted");
      if (ui.hudAuth) ui.hudAuth.textContent = "DENIED";
    } else {
      ui.bubble.querySelector(".bubble-core").style.background =
        "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.10) 70%), linear-gradient(135deg, rgba(239,68,68,0.35), rgba(124,58,237,0.20))";
      ui.badge.style.borderColor = "rgba(239,68,68,0.28)";
      ui.badge.textContent = "ACCESS DENIED";
      ui.badge.classList.add("denied");
      ui.badge.classList.remove("granted");
      if (ui.hudAuth) ui.hudAuth.textContent = "DENIED";
    }
  }

  function maybeHaptic() {
    const now = performance.now();
    if (now - state.lastHapticAt < 650) return;
    state.lastHapticAt = now;
    try { navigator.vibrate?.(18); } catch {}
  }

  // Tiny sound blip (WebAudio) — plays only after user gesture (Start/Calibrate/Reset)
  let audioCtx = null;

  function ensureAudio() {
    if (!ui.sound?.checked) return null;
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    // resume if suspended
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function blip() {
    if (!ui.sound?.checked) return;
    const now = performance.now();
    if (now - state.lastSoundAt < 650) return;
    state.lastSoundAt = now;

    const ctx = ensureAudio();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, t0);
    o.frequency.exponentialRampToValueAtTime(660, t0 + 0.06);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.10);
  }

  // Alarm sound for DENIED bursts
  function alarmBeep() {
    if (!ui.sound?.checked) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(220, t0);
    o.frequency.exponentialRampToValueAtTime(140, t0 + 0.08);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.10, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.10);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.11);
  }

  // Terminal feed + unlock sequence (pure UI)
  const term = {
    lines: [],
    max: 9,
    progress: 0,
    unlocked: false,
    lastDeniedAt: 0,
    lastLogAt: 0
  };

  function addLine(text, cls="") {
    if (!ui.termBody) return;
    term.lines.push({ text, cls });
    if (term.lines.length > term.max) term.lines.shift();
    renderTerm();
  }

  function renderTerm() {
    if (!ui.termBody) return;
    ui.termBody.innerHTML = term.lines.map(l => {
      const c = l.cls ? `line ${l.cls}` : "line";
      return `<div class="${c}">${escapeHtml(l.text)}</div>`;
    }).join("") + `<span class="cursor"></span>`;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  function setProgress(p) {
    term.progress = Math.max(0, Math.min(100, p));
    if (ui.bar) ui.bar.style.width = term.progress.toFixed(0) + "%";
  }

  function setTermState(kind) {
    if (!ui.tState) return;
    ui.tState.textContent = kind;
    ui.tState.classList.remove("denied","granted");
    if (kind === "DENIED") ui.tState.classList.add("denied");
    if (kind === "GRANTED") ui.tState.classList.add("granted");
  }

  function pulseAlarm() {
    if (!ui.level) return;
    ui.level.classList.remove("alarm");
    // reflow to restart animation
    void ui.level.offsetWidth;
    ui.level.classList.add("alarm");
  }

  function unlockStep() {
    if (term.unlocked) return;
    term.unlocked = true;
    setProgress(100);
    setTermState("GRANTED");
    addLine("[+] <span class='k'>AUTH</span> :: ACCESS GRANTED", "good");
    addLine("[+] token صادر شد :: root_session=OK", "good");
    addLine("[+] channel secured :: AES-256-GCM", "good");
  }

  function computeTargetFromAngles(gamma, beta) {
    // normalize + clamp
    const g = clamp(gamma - state.offG, -state.maxAngle, state.maxAngle);
    const b = clamp(beta - state.offB, -state.maxAngle, state.maxAngle);

    // map degrees to px
    const scale = state.sensitivity;
    state.tx = g * scale;  // right/left
    state.ty = b * scale;  // up/down
    setKPI();

    // Auto-calibrate: hold still near stable position
    if (ui.autoCal?.checked && state.started && !state.usingDemo) {
      const now = performance.now();
      const dg = Math.abs(g - state.lastAngles.g);
      const db = Math.abs(b - state.lastAngles.b);
      state.lastAngles.g = g;
      state.lastAngles.b = b;

      const motionSmall = (dg < 0.35 && db < 0.35);
      const nearCenter = (Math.abs(g) < 8 && Math.abs(b) < 8);
      const cooldownOk = (now - state.autoCalDoneAt > 2500);

      if (motionSmall && nearCenter && cooldownOk) {
        if (!state.stableSince) state.stableSince = now;
        if (now - state.stableSince > 1400) {
          // set offsets so current becomes 0
          state.offG += g;
          state.offB += b;
          state.autoCalDoneAt = now;
          state.stableSince = 0;
          setStatus("auto-cal");
          try { navigator.vibrate?.([10, 30, 10]); } catch {}
          blip();
        }
      } else {
        state.stableSince = 0;
      }
    }
  }

  function animate() {
    // critically damped-ish lerp
    const k = state.smooth;
    state.x += (state.tx - state.x) * k;
    state.y += (state.ty - state.y) * k;

    cssBubble(state.x, state.y);

    // Matrix rain
    drawMatrix(performance.now());

    // Cinematic 3D tilt on the whole stage
    if (ui.level) {
      const rx = clamp(state.ty / 120, -0.35, 0.35); // up/down
      const ry = clamp(state.tx / 120, -0.35, 0.35); // left/right
      ui.level.style.transform = `rotateX(${-rx}rad) rotateY(${ry}rad)`;
    }

    requestAnimationFrame(animate);
  }

  function onOrientation(e) {
    if (!state.started) return;
    // Some devices provide nulls until permission
    const g = (typeof e.gamma === "number") ? e.gamma : 0;
    const b = (typeof e.beta === "number") ? e.beta : 0;

    state.gamma = g;
    state.beta = b;
    computeTargetFromAngles(g, b);
  }

  // Desktop demo (mouse move)
  function onMouseMove(e) {
    if (!state.usingDemo) return;
    const rect = document.body.getBoundingClientRect();
    const nx = (e.clientX / rect.width) * 2 - 1;
    const ny = (e.clientY / rect.height) * 2 - 1;
    // fake angles
    state.gamma = nx * 30;
    state.beta = ny * 30;
    computeTargetFromAngles(state.gamma, state.beta);
  }

  async function requestIOSPermissionIfNeeded() {
    // iOS 13+ requires explicit permission in a user gesture
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return { ok: false, reason: "DeviceOrientationEvent not supported" };

    // If requestPermission exists, we must call it
    if (typeof DOE.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        if (res !== "granted") return { ok: false, reason: "Permission not granted" };
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: "Permission error" };
      }
    }
    return { ok: true };
  }

  function startSensor() {
    if (!("DeviceOrientationEvent" in window)) {
      setStatus("no sensor");
      return;
    }
    window.addEventListener("deviceorientation", onOrientation, { passive: true });
    if (ui.hudMode) ui.hudMode.textContent = "SENSOR";
    state.started = true;
    setStatus("running");
    addLine("[+] sensor :: stream started");
    addLine("[~] auth :: align to center");
  }

  function stopSensor() {
    window.removeEventListener("deviceorientation", onOrientation);
    state.started = false;
    setStatus("stopped");
  }

  function resetAll() {
    ensureAudio();
    state.gamma = 0; state.beta = 0;
    state.offG = 0; state.offB = 0;
    state.x = 0; state.y = 0;
    state.tx = 0; state.ty = 0;
    setKPI();
    cssBubble(0,0);
    ui.badge.classList.remove("granted","denied");
    if (ui.hudAuth) ui.hudAuth.textContent = "PENDING";
    // reset terminal
    term.lines = [];
    term.progress = 0;
    term.unlocked = false;
    addLine("[+] boot :: re-initialized");
    addLine("[~] auth :: pending center lock");
    setProgress(0);
    setTermState("PENDING");
    setStatus("idle");
  }

  function calibrate() {
    ensureAudio();
    state.offG = state.gamma;
    state.offB = state.beta;
    setStatus("calibrated");
    // small haptic
    try { navigator.vibrate?.([12, 40, 12]); } catch {}
  }

  // UI wiring
  ui.sens.addEventListener("input", () => {
    state.sensitivity = parseFloat(ui.sens.value);
    updateChips();
  });
  ui.smooth.addEventListener("input", () => {
    state.smooth = parseFloat(ui.smooth.value);
    updateChips();
  });

  ui.demo.addEventListener("change", () => {
    state.usingDemo = ui.demo.checked;
    if (state.usingDemo) {
      stopSensor();
      if (ui.hudMode) ui.hudMode.textContent = "DEMO";
      addLine("[+] mode :: desktop demo");
      setStatus("demo");
    } else {
      if (ui.hudMode) ui.hudMode.textContent = "SENSOR";
      setStatus("idle");
    }
  });

  ui.btnStart.addEventListener("click", async () => {
    // If demo on, just set running-ish
    if (state.usingDemo) {
      if (ui.hudMode) ui.hudMode.textContent = "DEMO";
      addLine("[+] mode :: desktop demo");
      setStatus("demo");
      return;
    }
    setStatus("requesting…");
    addLine("[+] user_gesture :: permission request");

    ensureAudio();
    const perm = await requestIOSPermissionIfNeeded();
    if (!perm.ok) {
      setStatus("permission denied");
      addLine("[-] <span class=\"bad\">sensor</span> :: permission denied", "bad");
      // still try starting on Android/others without requestPermission
      // but if sensor doesn't fire, KPIs will remain 0
    }
    startSensor();
  });

  ui.btnCal.addEventListener("click", calibrate);
  ui.btnReset.addEventListener("click", resetAll);

  ui.btnFS.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {}
  });

  function openModal() { ui.modal.setAttribute("aria-hidden", "false"); }
  function closeModal() { ui.modal.setAttribute("aria-hidden", "true"); }

  ui.btnHelp.addEventListener("click", openModal);
  ui.modalClose.addEventListener("click", closeModal);
  ui.modalX.addEventListener("click", closeModal);
  ui.modalOk.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // demo mouse
  window.addEventListener("mousemove", onMouseMove, { passive: true });

  // Service worker for offline
  function updateOrientPill(){
    const isLand = window.matchMedia?.("(orientation: landscape)")?.matches;
    const label = isLand ? "landscape" : "portrait";
    if (ui.pillOrient) ui.pillOrient.textContent = label;
  }

  window.addEventListener("load", () => {
    updateChips();
    setKPI();
    cssBubble(0,0);
    ui.badge.classList.remove("granted","denied");
    if (ui.hudAuth) ui.hudAuth.textContent = "PENDING";
    // reset terminal
    term.lines = [];
    term.progress = 0;
    term.unlocked = false;
    addLine("[+] boot :: re-initialized");
    addLine("[~] auth :: pending center lock");
    setProgress(0);
    setTermState("PENDING");
    setStatus("idle");
    updateOrientPill();
    window.addEventListener("resize", updateOrientPill, { passive:true });
    window.addEventListener("orientationchange", updateOrientPill, { passive:true });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  });

  // Start animation loop
  requestAnimationFrame(animate);
})();
