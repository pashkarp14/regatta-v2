document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");

  const statusEl  = document.getElementById("status");
  const statsEl   = document.getElementById("stats");
  const optInfoEl = document.getElementById("optinfo");

  const playerCountSelect = document.getElementById("playerCount");
  const markCountSelect   = document.getElementById("markCount");
  const markToEditSelect  = document.getElementById("markToEdit");

  const roundingSideSelect = document.getElementById("roundingSide");
  const playModeSelect = document.getElementById("playMode");
  const interactionModeSelect = document.getElementById("interactionMode");
  const finishSeparateSelect = document.getElementById("finishSeparate");
  const prestartRoundsInp = document.getElementById("prestartRounds");
  const realtimePrepInp = document.getElementById("realtimePrepSeconds");

  const gridColsInput = document.getElementById("gridCols");
  const gridRowsInput = document.getElementById("gridRows");
  const applyGridBtn  = document.getElementById("applyGrid");

  const btnModePlay   = document.getElementById("modePlay");
  const btnModeMarks  = document.getElementById("modeMarks");
  const btnModeStart  = document.getElementById("modeStart");
  const btnModeFinish = document.getElementById("modeFinish");
  const btnModeBoats  = document.getElementById("modeBoats");
  const btnModeModel  = document.getElementById("modeModel");

  const scenarioLegSelect = document.getElementById("scenarioLeg");
  const nextPlayerSelect  = document.getElementById("nextPlayer");
  const btnResumeFromModel = document.getElementById("resumeFromModel");

  const windInfoEl   = document.getElementById("windInfo");
  const deadZoneInp  = document.getElementById("deadZone");
  const snapThresholdInp = document.getElementById("snapThreshold");
  const movesPerTurnInp  = document.getElementById("movesPerTurn");
  const tackPenaltyInp   = document.getElementById("tackPenalty");
  const autoGustsSelect = document.getElementById("autoGusts");
  const autoGustIntervalInp = document.getElementById("autoGustInterval");
  const autoGustDurationInp = document.getElementById("autoGustDuration");
  const autoFullscreenModeSelect = document.getElementById("autoFullscreenMode");
  const interactionModeInfoEl = document.getElementById("interactionModeInfo");
  const boatTuningEl = document.getElementById("boatTuning");
  const boardViewportEl = document.getElementById("boardViewport");

  const cameraPanel = document.getElementById("zoomSlider")?.closest(".panel");
  cameraPanel?.remove();

  const btnWindLeft  = document.getElementById("windLeft");
  const btnWindRight = document.getElementById("windRight");
  const btnGust      = document.getElementById("randomGust");
  const btnClearGust = document.getElementById("clearGust");
  const btnReset     = document.getElementById("resetGame");
  const btnOptimal   = document.getElementById("toggleOptimal");
  const btnBestStart = document.getElementById("bestStart");
  const btnLaylines  = document.getElementById("toggleLaylines");
  const btnTrails    = document.getElementById("toggleTrails");
  const btnFullscreen = document.getElementById("toggleFullscreen");
  const btnBoardStart = document.getElementById("boardStartAction");

  // -----------------------------
  // Мир: непрерывные координаты
  // -----------------------------
  const DEFAULT_WORLD_W = 54;
  const DEFAULT_WORLD_H = 72;
  const DEFAULT_CANVAS_WIDTH = canvas.width;
  const DEFAULT_CANVAS_HEIGHT = canvas.height;
  const WORLD_MAX = 360;
  const METERS_PER_WORLD_UNIT = 5;
  let worldW = parseFloat(gridColsInput.value);
  let worldH = parseFloat(gridRowsInput.value);

  const PX_PER_UNIT_BASE = 30;
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 3.0;
  const WHEEL_ZOOM_SENSITIVITY = 0.0015;
  let zoom = 1.0;
  let PX = PX_PER_UNIT_BASE * zoom;

  let panX = 0, panY = 0;

  function fieldPixelW(){ return worldW * PX; }
  function fieldPixelH(){ return worldH * PX; }

  function fieldCenter() { return { cx: canvas.width/2 + panX, cy: canvas.height/2 + panY }; }
  function fieldTopLeft() {
    const {cx,cy} = fieldCenter();
    return { x: cx - fieldPixelW()/2, y: cy - fieldPixelH()/2 };
  }

  function clampCameraPan(){
    const extraW = Math.max(0, fieldPixelW() - canvas.width);
    const extraH = Math.max(0, fieldPixelH() - canvas.height);
    panX = clamp(panX, -extraW/2, extraW/2);
    panY = clamp(panY, -extraH/2, extraH/2);
  }

  function clientToCanvas(clientX, clientY){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height)
    };
  }

  function fitZoomForWorld(){
    const zoomX = (canvas.width - 48) / Math.max(1, worldW * PX_PER_UNIT_BASE);
    const zoomY = (canvas.height - 48) / Math.max(1, worldH * PX_PER_UNIT_BASE);
    return clamp(Math.min(1, zoomX, zoomY), MIN_ZOOM, MAX_ZOOM);
  }

  function resetCamera({ keepZoom=false } = {}){
    if (!keepZoom){
      zoom = fitZoomForWorld();
    }
    PX = PX_PER_UNIT_BASE * zoom;
    panX = 0;
    panY = 0;
    clampCameraPan();
  }

  function setZoom(nextZoom, anchorClientX=null, anchorClientY=null){
    const targetZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const anchorCanvas = (Number.isFinite(anchorClientX) && Number.isFinite(anchorClientY))
      ? clientToCanvas(anchorClientX, anchorClientY)
      : { x: canvas.width/2, y: canvas.height/2 };
    const anchorWorld = (Number.isFinite(anchorClientX) && Number.isFinite(anchorClientY))
      ? (screenToWorld(anchorClientX, anchorClientY) || { x: worldW/2, y: worldH/2 })
      : { x: worldW/2, y: worldH/2 };

    zoom = targetZoom;
    PX = PX_PER_UNIT_BASE * zoom;
    panX = anchorCanvas.x - canvas.width/2 + fieldPixelW()/2 - anchorWorld.x * PX;
    panY = anchorCanvas.y - canvas.height/2 + fieldPixelH()/2 - (worldH - anchorWorld.y) * PX;
    clampCameraPan();
  }

  function panCameraBy(deltaX, deltaY){
    panX += deltaX;
    panY += deltaY;
    clampCameraPan();
  }

  function worldToScreen(p){
    const tl = fieldTopLeft();
    return { x: tl.x + p.x * PX, y: tl.y + (worldH - p.y) * PX };
  }

  function screenToWorld(clientX, clientY){
    const { x:sx, y:sy } = clientToCanvas(clientX, clientY);

    const tl = fieldTopLeft();
    const lx = sx - tl.x;
    const ly = sy - tl.y;

    if (lx < 0 || ly < 0 || lx > fieldPixelW() || ly > fieldPixelH()) return null;

    const wx = lx / PX;
    const wy = worldH - (ly / PX);
    return { x: wx, y: wy };
  }

  function canvasPixelToWorld(px, py){
    const tl = fieldTopLeft();
    return {
      x: clamp((px - tl.x) / PX, 0, worldW),
      y: clamp(worldH - ((py - tl.y) / PX), 0, worldH)
    };
  }

  function setCameraCenterWorld(centerWorld){
    if (!centerWorld) return;
    panX = fieldPixelW() / 2 - centerWorld.x * PX;
    panY = fieldPixelH() / 2 - (worldH - centerWorld.y) * PX;
    clampCameraPan();
  }

  function desiredBoardCanvasCssSize(){
    if (!boardViewportEl){
      return { width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT };
    }

    const styles = window.getComputedStyle(boardViewportEl);
    const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    const availableWidth = Math.max(360, boardViewportEl.clientWidth - padX);

    if (isFullscreenActive()){
      return {
        width: availableWidth,
        height: Math.max(260, boardViewportEl.clientHeight - padY)
      };
    }

    const width = Math.min(1080, availableWidth);
    return {
      width,
      height: Math.round(width * (DEFAULT_CANVAS_HEIGHT / DEFAULT_CANVAS_WIDTH))
    };
  }

  function resizeBoardCanvas({ preserveView=true, resetView=false } = {}){
    const prevCenter = preserveView ? canvasPixelToWorld(canvas.width / 2, canvas.height / 2) : null;
    const cssSize = desiredBoardCanvasCssSize();
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(cssSize.width * dpr));
    const nextHeight = Math.max(1, Math.round(cssSize.height * dpr));

    canvas.style.width = `${Math.round(cssSize.width)}px`;
    canvas.style.height = `${Math.round(cssSize.height)}px`;

    const changed = canvas.width !== nextWidth || canvas.height !== nextHeight;
    if (changed){
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    if (resetView){
      resetCamera();
    } else if (changed && prevCenter){
      setCameraCenterWorld(prevCenter);
    } else {
      clampCameraPan();
    }

    if (changed || resetView){
      render();
    }
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
  function norm(v){
    const L = Math.hypot(v.x,v.y) || 1;
    return { x: v.x/L, y: v.y/L, L };
  }
  function rotateVec(v, ang){
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  }
  function hexToRgb(color){
    if (typeof color !== "string") return null;
    const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;

    let hex = match[1];
    if (hex.length === 3){
      hex = hex.split("").map((ch) => ch + ch).join("");
    }

    const value = parseInt(hex, 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255
    };
  }
  function mixHexColor(color, target, amount){
    const rgb = hexToRgb(color);
    if (!rgb) return color;

    const mix = clamp(amount, 0, 1);
    const base = target === "white" ? 255 : 0;
    const r = Math.round(rgb.r + (base - rgb.r) * mix);
    const g = Math.round(rgb.g + (base - rgb.g) * mix);
    const b = Math.round(rgb.b + (base - rgb.b) * mix);
    return `rgb(${r}, ${g}, ${b})`;
  }
  function rgbaHex(color, alpha){
    const rgb = hexToRgb(color);
    if (!rgb) return `rgba(30, 136, 229, ${alpha})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  // -----------------------------
  // Ветер и настройки движения
  // -----------------------------
  let windAngleDeg = 0;
  const WIND_STEP = 5;
  let deadZoneDeg = parseFloat(deadZoneInp.value);

  function normalizePlayModeValue(rawMode){
    return (rawMode === "realtime" || rawMode === "hybrid") ? "realtime" : "turns";
  }

  function normalizeInteractionMode(rawMode){
    if (rawMode === "ghost" || rawMode === "rules") return rawMode;
    return "contact";
  }

  let snapThreshold = parseFloat(snapThresholdInp.value); // 0..1
  let movesPerTurn  = parseInt(movesPerTurnInp.value,10) || 1;
  let roundingSide  = roundingSideSelect.value; // "port" | "starboard"
  let playMode = normalizePlayModeValue(playModeSelect?.value);
  let interactionMode = normalizeInteractionMode(interactionModeSelect?.value);
  let tackPenaltyFactor = parseFloat(tackPenaltyInp.value); // 0.5..1
  let autoGustsEnabled = autoGustsSelect?.value === "on";
  let autoGustIntervalSec = parseFloat(autoGustIntervalInp?.value) || 10;
  let autoGustDurationSec = parseFloat(autoGustDurationInp?.value) || 6;
  let realtimePrepSeconds = clamp(parseFloat(realtimePrepInp?.value) || 12, 0, 120);
  let autoFullscreenMode = autoFullscreenModeSelect?.value === "race" ? "race" : "off";
  let showLaylines = false;
  let showTrails = false;
  let boardStartActionOverride = null;
  let serverClockOffsetMs = 0;

  function updateWindInfo(){
    const gustMode = autoGustsEnabled ? "авто" : (gustRect ? "порыв" : "штиль");
    windInfoEl.textContent = `Ветер: ${windAngleDeg.toFixed(0)}° · ${gustMode}`;
  }

  function currentRaceTimeMs(){
    return Date.now() + serverClockOffsetMs;
  }

  function setServerClockOffset(offsetMs=0){
    serverClockOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0;
  }

  // 0° = ветер вниз на экране => в мире это -Y
  function downwindVec(){
    const t = windAngleDeg * Math.PI / 180;
    return { x: Math.sin(t), y: -Math.cos(t) };
  }
  function upwindVec(){ const d = downwindVec(); return { x: -d.x, y: -d.y }; }
  function angleBetween(u, v){
    const du = Math.hypot(u.x,u.y) || 1;
    const dv = Math.hypot(v.x,v.y) || 1;
    const dot = (u.x/du)*(v.x/dv) + (u.y/du)*(v.y/dv);
    return Math.acos(clamp(dot,-1,1));
  }
  function isMoveInDeadZone(moveVec){
    if (deadZoneDeg <= 0) return false;
    const uw = upwindVec();
    const a = angleBetween(moveVec, uw);
    return a < (deadZoneDeg * Math.PI/180) / 2;
  }

  // -----------------------------
  // Игровые объекты
  // -----------------------------
  const MARK_MAX = 5;
  let markCount = parseInt(markCountSelect.value,10);
  let marks = []; // {x,y}

  let startA  = { x: 2, y: 2 };
  let startB  = { x: Math.max(3, worldW-2), y: 2 };

  let finishSeparate = (finishSeparateSelect.value === "yes");
  let finishA = { ...startA };
  let finishB = { ...startB };

  let gustRect = null; // {cx,cy,rx,ry,angle}
  const GUST_MULT = 2.0;
  let gustExpiresAt = 0;
  let nextAutoGustAt = 0;

  let boats = [];
  let boatTrails = [];
  let currentPlayer = 0;
  let selectedBoatIndex = null;
  let raceFinishedCount = 0;

  let subMovesLeft = 1;
  let hybridRound = 1;
  let hybridMovesLeft = [];
  let multiplayerSeatIndex = null;
  let realtimeCountdownEndsAt = 0;
  let realtimeCursorTarget = null;
  let realtimeCursorDirection = null;
  let activeRealtimePointerId = null;
  let localRealtimeLastTickAt = 0;

  let prestartRoundsSetting = parseInt(prestartRoundsInp.value,10) || 0;
  let prestartRoundsLeft = prestartRoundsSetting;
  let phase = (prestartRoundsSetting > 0) ? "prestart" : "race"; // prestart | race
  let lastPhaseForFullscreen = phase;

  const BOAT_COLORS = ["#e53935","#1e88e5","#43a047","#fdd835","#8e24aa","#ff8f00","#00acc1","#6d4c41"];

  const STEP_RADIUS_BASE = 1.0;
  const BOAT_RULE_LENGTH = 0.85;
  const BOAT_FOOTPRINT_LENGTH = 1.70;
  const BOAT_FOOTPRINT_BEAM = 0.90;
  const BOAT_COLLISION_RADIUS = BOAT_FOOTPRINT_BEAM / 2;
  const BOAT_CAPSULE_HALF_SEGMENT = Math.max(0, (BOAT_FOOTPRINT_LENGTH - BOAT_FOOTPRINT_BEAM) / 2);
  const BOAT_SWEEP_RADIUS = BOAT_CAPSULE_HALF_SEGMENT + BOAT_COLLISION_RADIUS;
  const BOAT_PICK_PAD = 0.18;
  const BOAT_CLEARANCE_MARGIN = 0.25;
  const MARK_CLEARANCE_MARGIN = 0.25;
  const MARK_RADIUS = 0.35;                 // геометрический радиус знака
  const ROUND_PASS_RADIUS = BOAT_RULE_LENGTH * 3; // огибание засчитывается в радиусе трех длин корпуса
  const ROUNDING_MIN_SWEEP = Math.PI / 3;
  const ROUNDING_SWEEP_BIN_RAD = Math.PI / 12;
  const REALTIME_SPEED_UNITS_PER_SEC = 2.4;
  const REALTIME_DEADZONE_SOFTNESS_DEG = 18;
  const REALTIME_TARGET_EPS = 0.04;
  const RULES_PENALTY_COOLDOWN_MS = 2200;
  const RULES_PENALTY_SLOW_MS = 4000;
  const RULES_PENALTY_SPEED_FACTOR = 0.72;
  const RULES_OVERLAP_EPS = 0.05;
  const RULES_LEEWAY_EPS = 0.05;
  const RULES_MARK_ROOM_EPS = 0.15;
  const BOAT_LENGTH_HALF = BOAT_FOOTPRINT_LENGTH / 2;
  const INTERACTION_MODE_LABEL = {
    contact: "контактный",
    ghost: "бесконтактный",
    rules: "бесконтактный + правила"
  };

  const START_PICK_TOL = 0.35;
  const PRESTART_DEPTH = 3.0;

  // --- оптимальные решения (маршрут/старт) ---
  let showOptimal = false;
  let optimalPath = [];
  let optimalStats = null;   // {distance, turns, moves}
  let optimalForBoat = null; // index

  let showBestStart = false;
  let bestStartSolution = null; // {start:{x,y}, path:[], stats:{...}}

  function invalidateSolutions(){
    showOptimal = false;
    optimalPath = [];
    optimalStats = null;
    optimalForBoat = null;

    showBestStart = false;
    bestStartSolution = null;
    updateOptInfo();
  }

  function resetBoatTrails(){
    boatTrails = boats.map((boat) => boat ? [{ x: boat.x, y: boat.y }] : []);
  }

  function appendBoatTrailPoint(index, point){
    if (!boats[index] || !point) return;
    if (!boatTrails[index]) boatTrails[index] = [];
    const trail = boatTrails[index];
    const last = trail[trail.length - 1];
    if (!last || dist(last, point) >= 0.18){
      trail.push({ x: point.x, y: point.y });
      if (trail.length > 600){
        trail.splice(0, trail.length - 600);
      }
    } else {
      last.x = point.x;
      last.y = point.y;
    }
  }

  function pointInField(p){ return p.x>=0 && p.x<=worldW && p.y>=0 && p.y<=worldH; }
  function normalizeGustZone(zone){
    if (!zone || typeof zone !== "object") return null;

    if (Number.isFinite(zone.cx) && Number.isFinite(zone.cy) && Number.isFinite(zone.rx) && Number.isFinite(zone.ry)){
      const rx = Math.max(0.8, zone.rx);
      const ry = Math.max(0.8, zone.ry);
      return {
        cx: clamp(zone.cx, rx, Math.max(rx, worldW - rx)),
        cy: clamp(zone.cy, ry, Math.max(ry, worldH - ry)),
        rx,
        ry,
        angle: Number.isFinite(zone.angle) ? zone.angle : 0
      };
    }

    if (Number.isFinite(zone.x) && Number.isFinite(zone.y) && Number.isFinite(zone.w) && Number.isFinite(zone.h)){
      const w = Math.max(1.6, zone.w);
      const h = Math.max(1.6, zone.h);
      return {
        cx: zone.x + w / 2,
        cy: zone.y + h / 2,
        rx: w / 2,
        ry: h / 2,
        angle: 0
      };
    }

    return null;
  }

  function pointInGust(p){
    const zone = normalizeGustZone(gustRect);
    if (!zone) return false;
    const cosA = Math.cos(-zone.angle);
    const sinA = Math.sin(-zone.angle);
    const dx = p.x - zone.cx;
    const dy = p.y - zone.cy;
    const localX = dx * cosA - dy * sinA;
    const localY = dx * sinA + dy * cosA;
    return ((localX / zone.rx) ** 2 + (localY / zone.ry) ** 2) <= 1;
  }

  function gustRectRandom(){
    const rx = clamp(worldW * (0.08 + Math.random() * 0.1), 1.4, Math.max(1.4, worldW * 0.2));
    const ry = clamp(worldH * (0.06 + Math.random() * 0.1), 1.2, Math.max(1.2, worldH * 0.18));
    return {
      cx: Math.random() * Math.max(0, worldW - rx * 2) + rx,
      cy: Math.random() * Math.max(0, worldH - ry * 2) + ry,
      rx,
      ry,
      angle: Math.random() * Math.PI
    };
  }

  function scheduleNextAutoGust(nowMs){
    if (!autoGustsEnabled){
      nextAutoGustAt = 0;
      return;
    }
    const intervalMs = clamp(autoGustIntervalSec, 3, 60) * 1000;
    const factor = 0.6 + Math.random() * 0.8;
    nextAutoGustAt = nowMs + intervalMs * factor;
  }

  function spawnGust(nextRect=null, nowMs=Date.now()){
    gustRect = normalizeGustZone(nextRect) || gustRectRandom();
    gustExpiresAt = nowMs + clamp(autoGustDurationSec, 2, 30) * 1000;
  }

  function clearGust({ keepSchedule=false } = {}){
    gustRect = null;
    gustExpiresAt = 0;
    if (!keepSchedule){
      nextAutoGustAt = 0;
    }
  }

  function updateAutoGustState(nowMs=Date.now()){
    let changed = false;
    if (gustRect && gustExpiresAt > 0 && nowMs >= gustExpiresAt){
      clearGust({ keepSchedule:true });
      changed = true;
      scheduleNextAutoGust(nowMs);
    }

    if (!gustRect && autoGustsEnabled && nextAutoGustAt > 0 && nowMs >= nextAutoGustAt){
      spawnGust(null, nowMs);
      nextAutoGustAt = 0;
      changed = true;
    }

    if (!autoGustsEnabled && (nextAutoGustAt !== 0 || gustExpiresAt !== 0) && !gustRect){
      nextAutoGustAt = 0;
      gustExpiresAt = 0;
    }

    return changed;
  }

  function boatSpeedCoeff(boat){
    return clamp(Number.isFinite(boat?.speedCoeff) ? boat.speedCoeff : 1, 0.5, 1.8);
  }

  function defaultCourseLayout(width=worldW, height=worldH){
    const startY = clamp(height * 0.14, 4, height - 6);
    const startInset = clamp(width * 0.18, 3, Math.max(3, width / 2 - 4));
    const startLeft = { x: startInset, y: startY };
    const startRight = { x: width - startInset, y: startY };
    const startMidX = (startLeft.x + startRight.x) / 2;

    const markOne = {
      x: startMidX,
      y: clamp(startY + height * 0.70, startY + 12, height - 4)
    };
    const markTwo = {
      x: clamp(markOne.x - width * 0.34, 2, width - 2),
      y: clamp(markOne.y - height * 0.30, startY + 10, height - 4)
    };
    const markThree = {
      x: markTwo.x,
      y: clamp(startY - height * 0.12, 2, startY - 2)
    };

    const fallbackMarks = [markOne, markTwo, markThree];
    while (fallbackMarks.length < MARK_MAX){
      const prev = fallbackMarks[fallbackMarks.length - 1];
      fallbackMarks.push({
        x: clamp(prev.x + width * 0.12, 2, width - 2),
        y: clamp(prev.y - height * 0.10, 2, height - 2)
      });
    }

    return {
      startA: startLeft,
      startB: startRight,
      finishA: { ...startLeft },
      finishB: { ...startRight },
      marks: fallbackMarks.slice(0, MARK_MAX)
    };
  }

  function cellLikeDefaultPlacement(){
    const layout = defaultCourseLayout(worldW, worldH);
    startA = layout.startA;
    startB = layout.startB;
    finishA = layout.finishA;
    finishB = layout.finishB;
    marks = layout.marks;
  }

  function ensureMarkOptions(){
    markToEditSelect.innerHTML = "";
    for (let i=0;i<markCount;i++){
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = String(i+1);
      markToEditSelect.appendChild(opt);
    }
  }

  function ensureScenarioLegOptions(){
    scenarioLegSelect.innerHTML = "";
    const add = (val, text) => {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = text;
      scenarioLegSelect.appendChild(o);
    };

    add("to0", "Старт → 1");
    for (let i=1;i<markCount;i++){
      add(`to${i}`, `${i} → ${i+1}`);
    }
    add(`to${markCount}`, `${markCount} → Финиш`);
    scenarioLegSelect.value = "to0";
  }

  function ensureNextPlayerOptions(){
    nextPlayerSelect.innerHTML = "";
    for (let i=0;i<boats.length;i++){
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = String(i+1);
      nextPlayerSelect.appendChild(o);
    }
    nextPlayerSelect.value = String(currentPlayer);
  }

  // режимы
  let mode = "play"; // play | marks | start | finish | boats | model
  let startAwaitSecond = false;
  let finishAwaitSecond = false;
  let placementSelectedBoat = null;

  function setMode(m){
    mode = m;
    btnModePlay.classList.toggle("mode-btn-active", m==="play");
    btnModeMarks.classList.toggle("mode-btn-active", m==="marks");
    btnModeStart.classList.toggle("mode-btn-active", m==="start");
    btnModeFinish.classList.toggle("mode-btn-active", m==="finish");
    btnModeBoats.classList.toggle("mode-btn-active", m==="boats");
    btnModeModel.classList.toggle("mode-btn-active", m==="model");

    selectedBoatIndex = null;
    if (m !== "boats" && m !== "model") placementSelectedBoat = null;

    updateStatus();
    render();
  }

  function updateFinishButtonEnabled(){
    const enabled = finishSeparate;
    btnModeFinish.classList.toggle("mode-btn-disabled", !enabled);
    if (!enabled && mode === "finish") setMode("play");
  }

  function updateResetButtonLabel(){
    btnReset.textContent = isLocalRealtimeMode() ? "Общий старт" : "Новая гонка";
    updateBoardStartAction();
  }

  function updateInteractionModeInfo(){
    if (!interactionModeInfoEl) return;

    const descriptions = {
      contact: "Контактный режим: лодки упираются друг в друга и в узкие щели не пролезают. Геометрия столкновений учитывается и в ходе, и в подсказках маршрута.",
      ghost: "Бесконтактный режим: лодки полностью проходят друг сквозь друга и не влияют на движение соперников.",
      rules: "Бесконтактный + правила: корпуса не блокируют ход, но игра начисляет штрафы за нарушение при встречах. Учитываются левый/правый галс, наветренная/подветренная, чисто впереди/позади, задний ход и упрощенное место у знака."
    };

    interactionModeInfoEl.textContent = descriptions[interactionMode] || descriptions.contact;
  }

  function normalizeBoardStartAction(action){
    if (!action || action.visible === false) return null;
    const handler = typeof action.onTrigger === "function" ? action.onTrigger : null;
    return {
      visible: true,
      label: typeof action.label === "string" && action.label.trim() ? action.label.trim() : "Старт",
      title: typeof action.title === "string" && action.title.trim() ? action.title.trim() : "",
      disabled: !!action.disabled || !handler,
      onTrigger: handler
    };
  }

  function localBoardStartAction(){
    if (!isLocalRealtimeMode() || phase !== "countdown" || realtimeCountdownEndsAt > 0 || isRaceComplete()){
      return null;
    }
    return normalizeBoardStartAction({
      label: "Старт гонки",
      title: "Запустить общий старт",
      onTrigger: async () => {
        setMode("play");
        await handleResetAction();
      }
    });
  }

  function activeBoardStartAction(){
    return boardStartActionOverride || localBoardStartAction();
  }

  function updateBoardStartAction(){
    if (!btnBoardStart) return;

    const action = activeBoardStartAction();
    if (!action){
      btnBoardStart.classList.add("hidden");
      btnBoardStart.disabled = true;
      btnBoardStart.textContent = "Старт";
      btnBoardStart.removeAttribute("title");
      btnBoardStart.setAttribute("aria-hidden", "true");
      return;
    }

    btnBoardStart.classList.remove("hidden");
    btnBoardStart.disabled = !!action.disabled;
    btnBoardStart.textContent = action.label;
    btnBoardStart.title = action.title || action.label;
    btnBoardStart.setAttribute("aria-label", action.title || action.label);
    btnBoardStart.setAttribute("aria-hidden", "false");
  }

  async function triggerBoardStartAction(){
    const action = activeBoardStartAction();
    if (!action || action.disabled || typeof action.onTrigger !== "function"){
      updateBoardStartAction();
      return false;
    }

    await action.onTrigger();
    updateBoardStartAction();
    return true;
  }

  function setBoardStartActionOverride(action){
    boardStartActionOverride = normalizeBoardStartAction(action);
    updateBoardStartAction();
  }

  function isFullscreenActive(){
    return document.fullscreenElement === boardViewportEl;
  }

  function updateViewButtons(){
    btnLaylines?.classList.toggle("mode-btn-active", showLaylines);
    btnTrails?.classList.toggle("mode-btn-active", showTrails);
    btnFullscreen?.classList.toggle("mode-btn-active", isFullscreenActive());
    if (btnFullscreen){
      btnFullscreen.textContent = isFullscreenActive() ? "×" : "⛶";
      btnFullscreen.title = isFullscreenActive() ? "Свернуть экран" : "На весь экран";
      btnFullscreen.setAttribute("aria-label", isFullscreenActive() ? "Свернуть экран" : "На весь экран");
    }
  }

  async function requestBoardFullscreen(){
    if (!boardViewportEl || isFullscreenActive()) return true;
    try {
      await boardViewportEl.requestFullscreen();
      return true;
    } catch (error){
      return false;
    }
  }

  async function exitBoardFullscreen(){
    if (!isFullscreenActive()) return true;
    try {
      await document.exitFullscreen();
      return true;
    } catch (error){
      return false;
    }
  }

  function shouldAutoFullscreen(){
    return autoFullscreenMode === "race";
  }

  function phaseIsRaceVisible(targetPhase){
    return targetPhase === "countdown" || targetPhase === "race";
  }

  function isRaceComplete(targetPhase = phase){
    return boats.length > 0
      && boats.every((boat) => boat.finished)
      && (targetPhase === "race" || targetPhase === "finished");
  }

  async function syncAutoFullscreenWithPhase(previousPhase, nextPhase, { preferEnter=false } = {}){
    if (!shouldAutoFullscreen()) return;

    if (isRaceComplete(nextPhase) || nextPhase === "finished"){
      await exitBoardFullscreen();
      return;
    }

    const enteringRace = !phaseIsRaceVisible(previousPhase) && phaseIsRaceVisible(nextPhase);
    if ((preferEnter || enteringRace) && !isFullscreenActive()){
      await requestBoardFullscreen();
    }
  }

  function syncFullscreenPhaseWatch({ preferEnter=false } = {}){
    const previousPhase = lastPhaseForFullscreen;
    const phaseChanged = previousPhase !== phase;
    lastPhaseForFullscreen = phase;
    if (!phaseChanged && !preferEnter && !isRaceComplete()){
      return;
    }
    void syncAutoFullscreenWithPhase(previousPhase, phase, { preferEnter });
  }

  async function requestBoardFullscreenIfAuto(){
    if (!shouldAutoFullscreen()) return false;
    return requestBoardFullscreen();
  }

  async function handleResetAction(){
    if (mode !== "play") setMode("play");
    await requestBoardFullscreenIfAuto();
    resetBoats({ armRealtime: isLocalRealtimeMode() });
    invalidateSolutions();
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
  }

  function renderBoatTuningControls(){
    if (!boatTuningEl) return;
    boatTuningEl.innerHTML = boats.map((boat, idx) => `
      <label class="boat-tuning-card control">
        <strong style="color:${boat.color};">Лодка ${idx + 1}</strong>
        <span class="meta">Коэффициент скорости</span>
        <input
          type="number"
          min="0.50"
          max="1.80"
          step="0.05"
          value="${boatSpeedCoeff(boat).toFixed(2)}"
          data-room-lock="setup"
          data-boat-speed="${idx}"
        />
      </label>
    `).join("");
  }

  // -----------------------------
  // Геометрия / пересечения
  // -----------------------------
  function pointToSegment(p, a, b){
    const abx = b.x-a.x, aby = b.y-a.y;
    const apx = p.x-a.x, apy = p.y-a.y;
    const ab2 = abx*abx + aby*aby;
    if (ab2 === 0){
      return { d: dist(p,a), proj:{x:a.x,y:a.y}, t:0 };
    }
    const t = clamp((apx*abx + apy*aby)/ab2, 0, 1);
    const proj = { x: a.x + t*abx, y: a.y + t*aby };
    return { d: dist(p,proj), proj, t };
  }

  function orient(a,b,c){ return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x); }
  function onSeg(a,b,c){
    return Math.min(a.x,b.x)-1e-9 <= c.x && c.x <= Math.max(a.x,b.x)+1e-9 &&
           Math.min(a.y,b.y)-1e-9 <= c.y && c.y <= Math.max(a.y,b.y)+1e-9;
  }
  function segmentsIntersect(p1,p2,q1,q2){
    const o1 = orient(p1,p2,q1);
    const o2 = orient(p1,p2,q2);
    const o3 = orient(q1,q2,p1);
    const o4 = orient(q1,q2,p2);

    if ((o1>0 && o2<0 || o1<0 && o2>0) &&
        (o3>0 && o4<0 || o3<0 && o4>0)) return true;

    if (Math.abs(o1) < 1e-9 && onSeg(p1,p2,q1)) return true;
    if (Math.abs(o2) < 1e-9 && onSeg(p1,p2,q2)) return true;
    if (Math.abs(o3) < 1e-9 && onSeg(q1,q2,p1)) return true;
    if (Math.abs(o4) < 1e-9 && onSeg(q1,q2,p2)) return true;
    return false;
  }

  function segDistToPoint(a,b,p){
    return pointToSegment(p,a,b).d;
  }

  function dot(a,b){
    return a.x*b.x + a.y*b.y;
  }

  function boatAxisUnit(heading, hasHeading){
    if (hasHeading && Number.isFinite(heading)){
      return { x: Math.cos(heading), y: Math.sin(heading) };
    }
    return { x: 0, y: 1 };
  }

  function boatCapsuleAt(pos, heading, hasHeading){
    const axis = boatAxisUnit(heading, hasHeading);
    return {
      a: {
        x: pos.x - axis.x * BOAT_CAPSULE_HALF_SEGMENT,
        y: pos.y - axis.y * BOAT_CAPSULE_HALF_SEGMENT
      },
      b: {
        x: pos.x + axis.x * BOAT_CAPSULE_HALF_SEGMENT,
        y: pos.y + axis.y * BOAT_CAPSULE_HALF_SEGMENT
      },
      r: BOAT_COLLISION_RADIUS
    };
  }

  function boatCapsuleForIndex(boatIdx, posOverride=null, headingOverride=null, hasHeadingOverride=null){
    const boat = boats[boatIdx];
    const pos = posOverride || { x: boat?.x || 0, y: boat?.y || 0 };
    const heading = Number.isFinite(headingOverride) ? headingOverride : (Number.isFinite(boat?.heading) ? boat.heading : 0);
    const hasHeading = (typeof hasHeadingOverride === "boolean") ? hasHeadingOverride : !!boat?.hasHeading;
    return boatCapsuleAt(pos, heading, hasHeading);
  }

  function capsuleDistanceToPoint(capsule, point){
    return pointToSegment(point, capsule.a, capsule.b).d - capsule.r;
  }

  function segmentSegmentDistance(a0, a1, b0, b1){
    const EPS = 1e-9;
    const u = { x: a1.x - a0.x, y: a1.y - a0.y };
    const v = { x: b1.x - b0.x, y: b1.y - b0.y };
    const w = { x: a0.x - b0.x, y: a0.y - b0.y };

    const a = dot(u, u);
    const b = dot(u, v);
    const c = dot(v, v);
    const d = dot(u, w);
    const e = dot(v, w);
    const D = a * c - b * b;

    let sN, sD = D;
    let tN, tD = D;

    if (D < EPS){
      sN = 0;
      sD = 1;
      tN = e;
      tD = c;
    } else {
      sN = b * e - c * d;
      tN = a * e - b * d;
      if (sN < 0){
        sN = 0;
        tN = e;
        tD = c;
      } else if (sN > sD){
        sN = sD;
        tN = e + b;
        tD = c;
      }
    }

    if (tN < 0){
      tN = 0;
      if (-d < 0){
        sN = 0;
      } else if (-d > a){
        sN = sD;
      } else {
        sN = -d;
        sD = a;
      }
    } else if (tN > tD){
      tN = tD;
      if ((-d + b) < 0){
        sN = 0;
      } else if ((-d + b) > a){
        sN = sD;
      } else {
        sN = -d + b;
        sD = a;
      }
    }

    const sc = Math.abs(sN) < EPS ? 0 : sN / sD;
    const tc = Math.abs(tN) < EPS ? 0 : tN / tD;
    const dx = w.x + sc * u.x - tc * v.x;
    const dy = w.y + sc * u.y - tc * v.y;
    return Math.hypot(dx, dy);
  }

  function capsulesOverlap(left, right, extra=0){
    return segmentSegmentDistance(left.a, left.b, right.a, right.b) < (left.r + right.r + extra - 1e-9);
  }

  function capsuleIntersectsMark(capsule, markPos, extra=0){
    return pointToSegment(markPos, capsule.a, capsule.b).d < (capsule.r + MARK_RADIUS + extra - 1e-9);
  }

  // -----------------------------
  // ОГИБАНИЕ (исправлено): "войти в зону → пройти нужным бортом → выйти из зоны"
  // -----------------------------
  function roundingZoneRelation(p, markPos){
    const d = dist(p, markPos);
    if (d < ROUND_PASS_RADIUS - 1e-9) return -1;
    if (d > ROUND_PASS_RADIUS + 1e-9) return 1;
    return 0;
  }

  function roundingSideOkAt(point, dirUnit, markPos){
    if (!point || !dirUnit) return false;

    const v = { x: markPos.x - point.x, y: markPos.y - point.y };
    const cross = dirUnit.x * v.y - dirUnit.y * v.x;
    if (roundingSide === "port") return (cross > 1e-9);
    return (cross < -1e-9);
  }

  function angleAroundMark(point, markPos){
    return Math.atan2(point.y - markPos.y, point.x - markPos.x);
  }

  function roundingSweepDelta(fromPoint, toPoint, markPos){
    return angleWrap(angleAroundMark(toPoint, markPos) - angleAroundMark(fromPoint, markPos));
  }

  function roundingSweepOk(sweep){
    if (roundingSide === "port") return sweep >= ROUNDING_MIN_SWEEP - 1e-9;
    return sweep <= -ROUNDING_MIN_SWEEP + 1e-9;
  }

  function roundingSweepKey(sweep){
    const clampedSweep = clamp(sweep, -Math.PI, Math.PI);
    return Math.round(clampedSweep / ROUNDING_SWEEP_BIN_RAD);
  }

  function segmentRoundingInfo(prevPos, curPos, dirUnit, markPos){
    const startRel = roundingZoneRelation(prevPos, markPos);
    const endRel = roundingZoneRelation(curPos, markPos);

    const startInside = (startRel < 0);
    const endInside = (endRel < 0);
    const endBoundary = (endRel === 0);
    const endOutside = (endRel > 0);
    const startBoundary = (startRel === 0);

    const seg = { x: curPos.x - prevPos.x, y: curPos.y - prevPos.y };
    const a = seg.x*seg.x + seg.y*seg.y;

    let enteredInterior = startInside || endInside;
    let exitPoint = null;

    if (a > 1e-12){
      const fx = prevPos.x - markPos.x;
      const fy = prevPos.y - markPos.y;
      const b = 2 * (fx*seg.x + fy*seg.y);
      const c = fx*fx + fy*fy - ROUND_PASS_RADIUS*ROUND_PASS_RADIUS;
      const disc = b*b - 4*a*c;

      if (disc > 1e-12){
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-b - sqrtDisc) / (2*a);
        const t2 = (-b + sqrtDisc) / (2*a);
        const interiorStart = Math.max(0, t1);
        const interiorEnd = Math.min(1, t2);

        if (interiorEnd - interiorStart > 1e-6){
          enteredInterior = true;

          if (endOutside){
            const tExit = Math.max(0, Math.min(1, t2));
            exitPoint = {
              x: prevPos.x + seg.x*tExit,
              y: prevPos.y + seg.y*tExit
            };
          }
        }
      }
    }

    return {
      startInside,
      startBoundary,
      endInside,
      endBoundary,
      endOutside,
      enteredInterior,
      exitPoint
    };
  }

  // Возвращает true только тогда, когда знак считается огибнутым "по-настоящему"
  function processRoundingRuntime(boat, prevPos, curPos, dirUnit, markPos){
    const info = segmentRoundingInfo(prevPos, curPos, dirUnit, markPos);
    const effectiveInZone = boat.roundInZone || info.startInside;

    // 1) Проход "сквозь зону" за один ход: старт и финиш хода снаружи, но сегмент прошёл рядом
    const curSweep = Number.isFinite(boat.roundSweep) ? boat.roundSweep : 0;

    if (!effectiveInZone){
      if (info.endInside){
        boat.roundInZone = true;
        boat.roundSweep = 0;
      } else {
        boat.roundInZone = false;
        boat.roundSweep = 0;
      }
      return false;
    }

    // 2) Мы оказались внутри зоны в конце хода → фиксируем "в зоне" и копим признак нужного борта
    if (!info.endOutside){
      boat.roundInZone = true;
      boat.roundSweep = curSweep + roundingSweepDelta(prevPos, curPos, markPos);
      return false;
    }

    // 3) Мы вышли из зоны (endIn=false). Если мы были в зоне раньше — засчитываем при выходе
    let exitPoint = info.exitPoint;
    if (!exitPoint && info.startBoundary){
      exitPoint = prevPos;
    }

    const totalSweep = exitPoint ? (curSweep + roundingSweepDelta(prevPos, exitPoint, markPos)) : curSweep;

    boat.roundInZone = false;
    boat.roundSweep = 0;
    return !!exitPoint && roundingSweepOk(totalSweep) && roundingSideOkAt(exitPoint, dirUnit, markPos);
  }

  // Версия для планировщика (A*): такие же правила, но состояние хранится в узле
  function processRoundingPlanner(prevPos, curPos, dirUnit, markPos, inZone, sweep){
    const info = segmentRoundingInfo(prevPos, curPos, dirUnit, markPos);
    const effectiveInZone = (inZone === true) || info.startInside;
    const curSweep = Number.isFinite(sweep) ? sweep : 0;

    if (!effectiveInZone){
      if (info.endInside){
        return { inZone:true, sweep:0, completed:false };
      }
      return { inZone:false, sweep:0, completed:false };
    }

    if (!info.endOutside){
      return {
        inZone:true,
        sweep:curSweep + roundingSweepDelta(prevPos, curPos, markPos),
        completed:false
      };
    }

    let exitPoint = info.exitPoint;
    if (!exitPoint && info.startBoundary){
      exitPoint = prevPos;
    }

    const totalSweep = exitPoint ? (curSweep + roundingSweepDelta(prevPos, exitPoint, markPos)) : curSweep;

    return {
      inZone:false,
      sweep:0,
      completed:!!exitPoint && roundingSweepOk(totalSweep) && roundingSideOkAt(exitPoint, dirUnit, markPos)
    };
  }

  // -----------------------------
  // Столкновения
  // -----------------------------
  function getBoatAtPoint(p){
    for (let i=0;i<boats.length;i++){
      const capsule = boatCapsuleForIndex(i);
      if (capsuleDistanceToPoint(capsule, p) <= BOAT_PICK_PAD + 1e-9) return i;
    }
    return -1;
  }

  function isTooCloseToMarks(p, boatIdx=-1, headingOverride=null, hasHeadingOverride=null){
    const capsule = boatIdx >= 0
      ? boatCapsuleForIndex(boatIdx, p, headingOverride, hasHeadingOverride)
      : boatCapsuleAt(p, headingOverride, hasHeadingOverride);
    for (let i=0;i<markCount;i++){
      if (capsuleIntersectsMark(capsule, marks[i], MARK_CLEARANCE_MARGIN)) return true;
    }
    return false;
  }

  function isTooCloseToBoats(p, exceptIdx, headingOverride=null, hasHeadingOverride=null){
    const candidate = boatCapsuleForIndex(exceptIdx, p, headingOverride, hasHeadingOverride);
    for (let i=0;i<boats.length;i++){
      if (i===exceptIdx) continue;
      if (capsulesOverlap(candidate, boatCapsuleForIndex(i), BOAT_CLEARANCE_MARGIN)) return true;
    }
    return false;
  }

  function pathIntersectsOtherBoat(prevPos, nextPos, movingIdx){
    for (let i=0;i<boats.length;i++){
      if (i===movingIdx) continue;
      const other = boatCapsuleForIndex(i);
      const d = segmentSegmentDistance(prevPos, nextPos, other.a, other.b);
      if (d < (BOAT_SWEEP_RADIUS + other.r + BOAT_CLEARANCE_MARGIN - 1e-9)) return true;
    }
    return false;
  }

  function pathIntersectsAnyMark(prevPos, nextPos){
    for (let i=0;i<markCount;i++){
      if (segDistToPoint(prevPos, nextPos, marks[i]) < (MARK_RADIUS + BOAT_SWEEP_RADIUS + MARK_CLEARANCE_MARGIN - 1e-9)) return true;
    }
    return false;
  }

  // -----------------------------
  // Галс / штраф
  // -----------------------------
  function tackSignFromHeadingVec(hv){
    const wf = upwindVec();
    const cross = wf.x*hv.y - wf.y*hv.x;
    if (Math.abs(cross) < 1e-9) return 0;
    return cross > 0 ? 1 : -1;
  }

  function wouldChangeTack(boat, headingVecUnit){
    if (!boat.hasHeading) return false;
    const newTack = tackSignFromHeadingVec(headingVecUnit);
    if (boat.tack === 0 || newTack === 0) return false;
    return newTack !== boat.tack;
  }

  function stepFactorForMove(boat, headingVecUnit){
    let factor = boatSpeedCoeff(boat);
    if (pointInGust({x:boat.x,y:boat.y})) factor *= GUST_MULT;
    if (tackPenaltyFactor < 1.0 && wouldChangeTack(boat, headingVecUnit)) factor *= tackPenaltyFactor;
    return factor;
  }

  function allowedRadiusForMove(boat, headingVecUnit){
    return STEP_RADIUS_BASE * stepFactorForMove(boat, headingVecUnit);
  }

  function interactionModeLabel(){
    return INTERACTION_MODE_LABEL[interactionMode] || INTERACTION_MODE_LABEL.contact;
  }

  function isContactInteractionMode(){
    return interactionMode === "contact";
  }

  function isGhostInteractionMode(){
    return interactionMode === "ghost";
  }

  function isRulesInteractionMode(){
    return interactionMode === "rules";
  }

  function boatsPhysicalCollisionsEnabled(){
    return isContactInteractionMode();
  }

  function realtimePenaltyFactorForBoat(boat, nowMs=currentRaceTimeMs()){
    if (!boat) return 1;
    const penaltySlowUntil = Number.isFinite(boat.penaltySlowUntil) ? boat.penaltySlowUntil : 0;
    return penaltySlowUntil > nowMs ? RULES_PENALTY_SPEED_FACTOR : 1;
  }

  function headingVectorFromBoatState(state){
    if (state?.direction && Number.isFinite(state.direction.x) && Number.isFinite(state.direction.y)){
      const normalized = norm(state.direction);
      if (normalized.L > 1e-6){
        return { x: normalized.x, y: normalized.y };
      }
    }
    return boatAxisUnit(state?.heading, !!state?.hasHeading);
  }

  function boatEncounterState(index, overrides={}){
    const boat = overrides.boat || boats[index];
    const pos = overrides.pos || { x: boat?.x || 0, y: boat?.y || 0 };
    const prev = overrides.prev || { x: pos.x, y: pos.y };
    const heading = Number.isFinite(overrides.heading) ? overrides.heading : (Number.isFinite(boat?.heading) ? boat.heading : 0);
    const hasHeading = (typeof overrides.hasHeading === "boolean") ? overrides.hasHeading : !!boat?.hasHeading;
    const direction = overrides.direction || boatAxisUnit(heading, hasHeading);
    const signedSpeedUnitsPerSec = Number.isFinite(overrides.signedSpeedUnitsPerSec)
      ? overrides.signedSpeedUnitsPerSec
      : (Number.isFinite(boat?.currentSpeedUnitsPerSec) ? boat.currentSpeedUnitsPerSec : 0);
    const tack = Number.isFinite(overrides.tack)
      ? overrides.tack
      : (Number.isFinite(boat?.tack) ? boat.tack : tackSignFromHeadingVec(direction));
    return {
      index,
      boat,
      pos,
      prev,
      heading,
      hasHeading,
      direction,
      tack,
      nextMark: Number.isFinite(overrides.nextMark) ? overrides.nextMark : (parseInt(boat?.nextMark, 10) || 0),
      finished: !!(typeof overrides.finished === "boolean" ? overrides.finished : boat?.finished),
      signedSpeedUnitsPerSec,
      reverse: signedSpeedUnitsPerSec < -1e-6
    };
  }

  function pairReferenceAxis(leftState, rightState){
    const leftDir = headingVectorFromBoatState(leftState);
    const rightDir = headingVectorFromBoatState(rightState);
    let axis = { x: leftDir.x + rightDir.x, y: leftDir.y + rightDir.y };
    if (Math.hypot(axis.x, axis.y) < 1e-6){
      axis = { x: leftDir.x, y: leftDir.y };
    }
    if (Math.hypot(axis.x, axis.y) < 1e-6){
      axis = { x: rightDir.x, y: rightDir.y };
    }
    if (Math.hypot(axis.x, axis.y) < 1e-6){
      axis = { x: rightState.pos.x - leftState.pos.x, y: rightState.pos.y - leftState.pos.y };
    }
    if (Math.hypot(axis.x, axis.y) < 1e-6){
      axis = { x: 1, y: 0 };
    }
    const normalized = norm(axis);
    return { x: normalized.x, y: normalized.y };
  }

  function pairLongitudinalInfo(leftState, rightState){
    const axis = pairReferenceAxis(leftState, rightState);
    const leftCenter = dot(leftState.pos, axis);
    const rightCenter = dot(rightState.pos, axis);
    const leftRange = { min: leftCenter - BOAT_LENGTH_HALF, max: leftCenter + BOAT_LENGTH_HALF };
    const rightRange = { min: rightCenter - BOAT_LENGTH_HALF, max: rightCenter + BOAT_LENGTH_HALF };
    const leftClearAstern = leftRange.max < rightRange.min - RULES_OVERLAP_EPS;
    const rightClearAstern = rightRange.max < leftRange.min - RULES_OVERLAP_EPS;
    return {
      axis,
      leftRange,
      rightRange,
      linked: !leftClearAstern && !rightClearAstern,
      leftClearAstern,
      rightClearAstern
    };
  }

  function pairLeewardInfo(leftState, rightState){
    const downwind = downwindVec();
    const leftProj = dot(leftState.pos, downwind);
    const rightProj = dot(rightState.pos, downwind);
    if (Math.abs(leftProj - rightProj) <= RULES_LEEWAY_EPS){
      return { leewardIndex: null, windwardIndex: null };
    }
    if (leftProj > rightProj){
      return { leewardIndex: leftState.index, windwardIndex: rightState.index };
    }
    return { leewardIndex: rightState.index, windwardIndex: leftState.index };
  }

  function pairMarkRoomInfo(leftState, rightState){
    if (leftState.finished || rightState.finished) return null;
    if (leftState.nextMark !== rightState.nextMark) return null;
    if (!Number.isInteger(leftState.nextMark) || leftState.nextMark < 0 || leftState.nextMark >= markCount) return null;

    const mark = marks[leftState.nextMark];
    if (!mark) return null;

    const leftDist = dist(leftState.pos, mark);
    const rightDist = dist(rightState.pos, mark);
    const inZone = leftDist <= ROUND_PASS_RADIUS + RULES_MARK_ROOM_EPS || rightDist <= ROUND_PASS_RADIUS + RULES_MARK_ROOM_EPS;
    if (!inZone) return null;

    const longitudinal = pairLongitudinalInfo(leftState, rightState);
    if (longitudinal.linked && Math.abs(leftDist - rightDist) > RULES_MARK_ROOM_EPS){
      const inner = leftDist < rightDist ? leftState : rightState;
      const outer = inner.index === leftState.index ? rightState : leftState;
      return {
        giveWayIndex: outer.index,
        rightOfWayIndex: inner.index,
        reason: "наружная лодка не дала место у знака"
      };
    }

    if (!longitudinal.linked){
      if (longitudinal.leftClearAstern){
        return {
          giveWayIndex: leftState.index,
          rightOfWayIndex: rightState.index,
          reason: "чисто позади не уступила у знака"
        };
      }
      if (longitudinal.rightClearAstern){
        return {
          giveWayIndex: rightState.index,
          rightOfWayIndex: leftState.index,
          reason: "чисто позади не уступила у знака"
        };
      }
    }

    return null;
  }

  function evaluateRightOfWayForPair(leftState, rightState){
    if (leftState.reverse !== rightState.reverse){
      const giveWay = leftState.reverse ? leftState : rightState;
      const rightOfWay = giveWay.index === leftState.index ? rightState : leftState;
      return {
        giveWayIndex: giveWay.index,
        rightOfWayIndex: rightOfWay.index,
        reason: "лодка на заднем ходу должна сторониться"
      };
    }

    const markRoom = pairMarkRoomInfo(leftState, rightState);
    if (markRoom) return markRoom;

    if (leftState.tack !== 0 && rightState.tack !== 0 && leftState.tack !== rightState.tack){
      const portBoat = leftState.tack < 0 ? leftState : rightState;
      const starboardBoat = portBoat.index === leftState.index ? rightState : leftState;
      return {
        giveWayIndex: portBoat.index,
        rightOfWayIndex: starboardBoat.index,
        reason: "левый галс уступает правому"
      };
    }

    if (leftState.tack !== 0 && leftState.tack === rightState.tack){
      const longitudinal = pairLongitudinalInfo(leftState, rightState);
      if (longitudinal.linked){
        const leeward = pairLeewardInfo(leftState, rightState);
        if (leeward.windwardIndex !== null){
          return {
            giveWayIndex: leeward.windwardIndex,
            rightOfWayIndex: leeward.leewardIndex,
            reason: "наветренная лодка не уступила подветренной"
          };
        }
      }

      if (longitudinal.leftClearAstern){
        return {
          giveWayIndex: leftState.index,
          rightOfWayIndex: rightState.index,
          reason: "чисто позади не уступила чисто впереди"
        };
      }
      if (longitudinal.rightClearAstern){
        return {
          giveWayIndex: rightState.index,
          rightOfWayIndex: leftState.index,
          reason: "чисто позади не уступила чисто впереди"
        };
      }
    }

    return null;
  }

  function pairMotionIncident(leftState, rightState){
    const leftCapsule = boatCapsuleAt(leftState.pos, leftState.heading, leftState.hasHeading);
    const rightCapsule = boatCapsuleAt(rightState.pos, rightState.heading, rightState.hasHeading);
    const hullContact = capsulesOverlap(leftCapsule, rightCapsule, BOAT_CLEARANCE_MARGIN);
    const sweepDistance = segmentSegmentDistance(leftState.prev, leftState.pos, rightState.prev, rightState.pos);
    const sweepContact = sweepDistance < (BOAT_SWEEP_RADIUS * 2 + BOAT_CLEARANCE_MARGIN - 1e-9);
    return {
      incident: hullContact || sweepContact,
      collision: hullContact || sweepDistance < (BOAT_SWEEP_RADIUS * 2 - 1e-9)
    };
  }

  function applyBoatRulePenalty(boatIdx, otherIdx, reason, nowMs, { collision=false, turnPenalty=false } = {}){
    const boat = boats[boatIdx];
    if (!boat) return false;

    const penaltyKey = `${otherIdx}:${reason}`;
    const lastAt = Number.isFinite(boat.lastPenaltyAt) ? boat.lastPenaltyAt : 0;
    if (boat.lastPenaltyKey === penaltyKey && nowMs - lastAt < RULES_PENALTY_COOLDOWN_MS){
      return false;
    }

    boat.penalties = (parseInt(boat.penalties, 10) || 0) + 1;
    if (collision){
      boat.collisions = (parseInt(boat.collisions, 10) || 0) + 1;
    }
    if (turnPenalty){
      boat.turns = (parseInt(boat.turns, 10) || 0) + 1;
    }
    boat.lastPenaltyAt = nowMs;
    boat.lastPenaltyKey = penaltyKey;
    boat.lastPenaltyReason = reason;
    boat.penaltySlowUntil = Math.max(Number.isFinite(boat.penaltySlowUntil) ? boat.penaltySlowUntil : 0, nowMs + RULES_PENALTY_SLOW_MS);
    return true;
  }

  function evaluatePairRulesPenalty(leftState, rightState, nowMs, { turnPenalty=false } = {}){
    const incident = pairMotionIncident(leftState, rightState);
    if (!incident.incident) return false;

    const ruling = evaluateRightOfWayForPair(leftState, rightState);
    if (!ruling){
      let changed = false;
      if (incident.collision){
        changed = applyBoatRulePenalty(leftState.index, rightState.index, "не избежал контакта", nowMs, { collision:true, turnPenalty }) || changed;
        changed = applyBoatRulePenalty(rightState.index, leftState.index, "не избежал контакта", nowMs, { collision:true, turnPenalty }) || changed;
      }
      return changed;
    }

    return applyBoatRulePenalty(ruling.giveWayIndex, ruling.rightOfWayIndex, ruling.reason, nowMs, {
      collision: incident.collision,
      turnPenalty
    });
  }

  function applyRealtimeRulesPenalties(proposals, invalidSet, nowMs){
    if (!isRulesInteractionMode()) return false;

    const encounterStates = proposals.map((proposal, index) => {
      const boat = boats[index];
      const proposalAllowed = proposal.accepted && !(invalidSet instanceof Set && invalidSet.has(index));
      return boatEncounterState(index, {
        boat,
        pos: proposalAllowed ? proposal.dest : { x: boat.x, y: boat.y },
        prev: proposal.prev || { x: boat.x, y: boat.y },
        heading: proposalAllowed ? proposal.heading : boat.heading,
        hasHeading: proposalAllowed ? proposal.hasHeading : !!boat.hasHeading,
        direction: proposalAllowed && proposal.direction ? proposal.direction : boatAxisUnit(boat.heading, boat.hasHeading),
        signedSpeedUnitsPerSec: proposalAllowed ? proposal.signedSpeedUnitsPerSec : 0
      });
    });

    let changed = false;
    for (let left=0; left<encounterStates.length; left++){
      if (encounterStates[left].finished) continue;
      const leftMoved = proposals[left]?.accepted && !(invalidSet instanceof Set && invalidSet.has(left)) && (proposals[left]?.distance || 0) > 1e-5;
      for (let right=left+1; right<encounterStates.length; right++){
        if (encounterStates[right].finished) continue;
        const rightMoved = proposals[right]?.accepted && !(invalidSet instanceof Set && invalidSet.has(right)) && (proposals[right]?.distance || 0) > 1e-5;
        if (!leftMoved && !rightMoved) continue;
        changed = evaluatePairRulesPenalty(encounterStates[left], encounterStates[right], nowMs) || changed;
      }
    }
    return changed;
  }

  // -----------------------------
  // "За стартовой линией" — сторона предстарт
  // -----------------------------
  function startLineDirUnit(){
    const v = { x:startB.x-startA.x, y:startB.y-startA.y };
    const n = norm(v);
    return { x:n.x, y:n.y };
  }

  function courseSideNormalUnit(){
    const d = startLineDirUnit();
    const n1 = { x:-d.y, y:d.x };
    const n2 = { x:d.y,  y:-d.x };

    const mid = { x:(startA.x+startB.x)/2, y:(startA.y+startB.y)/2 };
    const m = marks[0] || { x:mid.x, y:mid.y+1 };
    const vm = { x:m.x-mid.x, y:m.y-mid.y };

    const dot1 = n1.x*vm.x + n1.y*vm.y;
    const dot2 = n2.x*vm.x + n2.y*vm.y;

    return (dot1 >= dot2) ? n1 : n2;
  }

  function prestartNormalUnit(){
    const c = courseSideNormalUnit();
    return { x:-c.x, y:-c.y };
  }

  function pointInPrestartZone(p){
    const d = startLineDirUnit();
    const n = prestartNormalUnit();
    const A = startA;
    const AP = { x:p.x-A.x, y:p.y-A.y };

    const along = AP.x*d.x + AP.y*d.y;
    const across = AP.x*n.x + AP.y*n.y;

    const lineLen = Math.hypot(startB.x-startA.x, startB.y-startA.y);
    return along >= 0 && along <= lineLen && across >= 0 && across <= PRESTART_DEPTH;
  }

  // -----------------------------
  // Ход: клик → дотягивание
  // -----------------------------
  function clampAlongRayToField(startPos, dirUnit, maxLen){
    let tMax = maxLen;

    if (Math.abs(dirUnit.x) > 1e-9){
      const tx1 = (0 - startPos.x) / dirUnit.x;
      const tx2 = (worldW - startPos.x) / dirUnit.x;
      tMax = Math.min(tMax, Math.max(tx1,tx2));
      tMax = Math.max(0, tMax);
    } else {
      if (startPos.x < 0 || startPos.x > worldW) return { ...startPos };
    }

    if (Math.abs(dirUnit.y) > 1e-9){
      const ty1 = (0 - startPos.y) / dirUnit.y;
      const ty2 = (worldH - startPos.y) / dirUnit.y;
      tMax = Math.min(tMax, Math.max(ty1,ty2));
      tMax = Math.max(0, tMax);
    } else {
      if (startPos.y < 0 || startPos.y > worldH) return { ...startPos };
    }

    return { x: startPos.x + dirUnit.x*tMax, y: startPos.y + dirUnit.y*tMax };
  }

  function proposeDestination(boatIdx, clickP){
    const b = boats[boatIdx];
    if (!b || b.finished) return null;

    const v = { x: clickP.x - b.x, y: clickP.y - b.y };
    const n = norm(v);
    if (n.L < 1e-6) return null;

    const dir = { x: n.x, y: n.y };
    if (isMoveInDeadZone(v)) return null;

    const R = allowedRadiusForMove(b, dir);

    let dest = clickP;
    if (n.L >= snapThreshold * R){
      dest = clampAlongRayToField({x:b.x,y:b.y}, dir, R);
    }

    if (!pointInField(dest)) return null;
    const headingAng = Math.atan2(dir.y, dir.x);
    if (isTooCloseToMarks(dest, boatIdx, headingAng, true)) return null;
    if (boatsPhysicalCollisionsEnabled() && isTooCloseToBoats(dest, boatIdx, headingAng, true)) return null;

    const dd = dist(dest, {x:b.x,y:b.y});
    if (dd > R + 1e-6) return null;

    const prevPos = {x:b.x,y:b.y};
    if (pathIntersectsAnyMark(prevPos, dest)) return null;
    if (boatsPhysicalCollisionsEnabled() && pathIntersectsOtherBoat(prevPos, dest, boatIdx)) return null;

    return dest;
  }

  // -----------------------------
  // Прогресс/финиш/смена игрока
  // -----------------------------
  function updateBoatMarkAndFinish(boat, prevPos, curPos, dirUnit){
    if (phase !== "race") return;

    if (boat.nextMark < markCount){
      const m = marks[boat.nextMark];

      // ✅ Огибание: только при "войти → нужный борт → выйти"
      if (dirUnit && processRoundingRuntime(boat, prevPos, curPos, dirUnit, m)){
        boat.nextMark++;
        // на следующий знак — сброс состояния
        boat.roundInZone = false;
        boat.roundSweep = 0;
      }
    } else {
      // идём к финишу — сброс огибания
      boat.roundInZone = false;
      boat.roundSweep = 0;
    }

    if (!boat.finished && boat.nextMark >= markCount){
      const F1 = finishSeparate ? finishA : startA;
      const F2 = finishSeparate ? finishB : startB;

      if (segmentsIntersect(prevPos, curPos, F1, F2)){
        boat.finished = true;
        raceFinishedCount++;
        boat.place = raceFinishedCount;
      }
    }
  }

  function angleWrap(a){
    while (a > Math.PI) a -= 2*Math.PI;
    while (a < -Math.PI) a += 2*Math.PI;
    return a;
  }

  function maybeStartGunIfNeeded(){
    if (phase !== "prestart") return;
    if (prestartRoundsLeft > 0) return;

    phase = "race";
    raceFinishedCount = 0;

    for (const b of boats){
      b.distance = 0;
      b.turns = 0;
      b.penalties = 0;
      b.collisions = 0;
      b.nextMark = 0;
      b.finished = false;
      b.place = null;
      b.currentSpeedUnitsPerSec = 0;
      b.penaltySlowUntil = 0;
      b.lastPenaltyAt = 0;
      b.lastPenaltyKey = "";
      b.lastPenaltyReason = "";
      b.roundInZone = false;
      b.roundSweep = 0;
    }

    currentPlayer = 0;
    subMovesLeft = movesPerTurn;
    resetHybridState();

    statusEl.textContent = "СТАРТ! Продолжаем гонку с текущих позиций.";
  }

  function controlDirectionForLocalBoat(boatIdx){
    const controlledBoatIndex = realtimeControlledBoatIndex();
    if (!isLocalRealtimeMode() || controlledBoatIndex !== boatIdx){
      return null;
    }
    const boat = boats[boatIdx];
    if (!boat) return null;

    if (realtimeCursorTarget){
      const aim = norm({ x: realtimeCursorTarget.x - boat.x, y: realtimeCursorTarget.y - boat.y });
      if (aim.L > REALTIME_TARGET_EPS){
        return { x: aim.x, y: aim.y };
      }
    }

    if (!realtimeCursorDirection){
      return null;
    }

    return { x: realtimeCursorDirection.x, y: realtimeCursorDirection.y };
  }

  function simulateLocalRealtimeTick(dtSeconds){
    let changed = false;
    const now = Date.now();
    const tickStartMs = now - dtSeconds * 1000;
    const countdownActive = phase === "countdown" && realtimeCountdownEndsAt > now;

    if (phase === "countdown" && realtimeCountdownEndsAt > 0 && now >= realtimeCountdownEndsAt){
      phase = "race";
      changed = true;
    }

    if (!isLocalRealtimeMode() || (phase !== "race" && !countdownActive)){
      return changed;
    }

    const proposals = boats.map((boat, index) => {
      const proposal = {
        accepted: false,
        prev: { x: boat.x, y: boat.y },
        dest: { x: boat.x, y: boat.y },
        heading: Number.isFinite(boat.heading) ? boat.heading : 0,
        hasHeading: !!boat.hasHeading,
        direction: null,
        motionDirection: null,
        distance: 0,
        signedSpeedUnitsPerSec: 0,
        reverseMode: false
      };

      if (!boat || boat.finished){
        return proposal;
      }

      const direction = controlDirectionForLocalBoat(index);
      if (!direction){
        return proposal;
      }

      const upwind = upwindVec();
      const angle = angleBetween(direction, upwind);
      const halfDead = (deadZoneDeg * Math.PI / 180) / 2;
      const reverseThreshold = halfDead * 0.5;
      const softness = Math.max(2, REALTIME_DEADZONE_SOFTNESS_DEG) * Math.PI / 180;
      const heading = Math.atan2(direction.y, direction.x);
      const moveFactor = stepFactorForMove(boat, direction) * realtimePenaltyFactorForBoat(boat, now);
      const speedFactor = (angle <= halfDead)
        ? 0
        : clamp((angle - halfDead) / softness, 0, 1);
      const reverseSpeed = REALTIME_SPEED_UNITS_PER_SEC * dtSeconds * moveFactor * 0.10;
      const reverseMode = angle <= reverseThreshold;
      const stepLength = reverseMode
        ? reverseSpeed
        : (REALTIME_SPEED_UNITS_PER_SEC * dtSeconds * speedFactor * moveFactor);
      if (stepLength <= 1e-5){
        return proposal;
      }

      const motionDirection = reverseMode
        ? { x: -direction.x, y: -direction.y }
        : direction;

      proposal.accepted = true;
      proposal.dest = clampAlongRayToField({ x: boat.x, y: boat.y }, motionDirection, stepLength);
      proposal.heading = heading;
      proposal.hasHeading = true;
      proposal.direction = direction;
      proposal.motionDirection = motionDirection;
      proposal.distance = dist(proposal.prev, proposal.dest);
      proposal.signedSpeedUnitsPerSec = dtSeconds > 1e-6
        ? (reverseMode ? -1 : 1) * (proposal.distance / dtSeconds)
        : 0;
      proposal.reverseMode = reverseMode;
      return proposal;
    });

    const invalid = new Set();

    for (let i=0;i<proposals.length;i++){
      const proposal = proposals[i];
      if (!proposal.accepted) continue;

      const candidateCapsule = boatCapsuleAt(proposal.dest, proposal.heading, proposal.hasHeading);
      if (!pointInField(proposal.dest)){
        invalid.add(i);
        continue;
      }

      for (let m=0; m<markCount; m++){
        if (capsuleIntersectsMark(candidateCapsule, marks[m], MARK_CLEARANCE_MARGIN)){
          invalid.add(i);
          break;
        }
        if (segDistToPoint(proposal.prev, proposal.dest, marks[m]) < (MARK_RADIUS + BOAT_SWEEP_RADIUS + MARK_CLEARANCE_MARGIN - 1e-9)){
          invalid.add(i);
          break;
        }
      }
      if (invalid.has(i)) continue;

      if (boatsPhysicalCollisionsEnabled()){
        for (let j=0; j<boats.length; j++){
          if (j === i) continue;
          const otherCapsule = boatCapsuleForIndex(j);
          if (capsulesOverlap(candidateCapsule, otherCapsule, BOAT_CLEARANCE_MARGIN)){
            invalid.add(i);
            break;
          }
          if (segmentSegmentDistance(proposal.prev, proposal.dest, otherCapsule.a, otherCapsule.b) < (BOAT_SWEEP_RADIUS + otherCapsule.r + BOAT_CLEARANCE_MARGIN - 1e-9)){
            invalid.add(i);
            break;
          }
        }
      }
    }

    if (boatsPhysicalCollisionsEnabled()){
      for (let left=0; left<proposals.length; left++){
        const leftProposal = proposals[left];
        if (!leftProposal.accepted || invalid.has(left)) continue;
        const leftCapsule = boatCapsuleAt(leftProposal.dest, leftProposal.heading, leftProposal.hasHeading);

        for (let right=left+1; right<proposals.length; right++){
          const rightProposal = proposals[right];
          if (!rightProposal.accepted || invalid.has(right)) continue;
          const rightCapsule = boatCapsuleAt(rightProposal.dest, rightProposal.heading, rightProposal.hasHeading);

          if (capsulesOverlap(leftCapsule, rightCapsule, BOAT_CLEARANCE_MARGIN)){
            invalid.add(left);
            invalid.add(right);
            continue;
          }

          const minCenterDistance = segmentSegmentDistance(leftProposal.prev, leftProposal.dest, rightProposal.prev, rightProposal.dest);
          if (minCenterDistance < (BOAT_SWEEP_RADIUS * 2 + BOAT_CLEARANCE_MARGIN - 1e-9)){
            invalid.add(left);
            invalid.add(right);
          }
        }
      }
    }

    const rulesChanged = applyRealtimeRulesPenalties(proposals, invalid, now);
    changed = rulesChanged || changed;

    raceFinishedCount = boats.filter((boat) => boat.finished).length;
    let anyUnfinished = false;

    for (let i=0; i<boats.length; i++){
      const boat = boats[i];
      const proposal = proposals[i];
      boat.currentSpeedUnitsPerSec = 0;

      if (proposal.accepted && !invalid.has(i)){
        const dest = proposal.dest;
        if (Math.abs(dest.x - boat.x) > 1e-9 || Math.abs(dest.y - boat.y) > 1e-9){
          changed = true;
          if (boat.hasHeading && Math.abs(angleWrap(proposal.heading - boat.heading)) > (12 * Math.PI / 180)){
            boat.turns += 1;
          }
          boat.x = dest.x;
          boat.y = dest.y;
          boat.distance += proposal.distance;
          boat.heading = proposal.heading;
          boat.hasHeading = proposal.hasHeading;
          boat.tack = tackSignFromHeadingVec(proposal.direction);
          boat.currentSpeedUnitsPerSec = proposal.signedSpeedUnitsPerSec;
          appendBoatTrailPoint(i, dest);
          recordRealtimeStartCrossing(boat, proposal.prev, dest, tickStartMs, now);
          updateBoatMarkAndFinish(boat, proposal.prev, dest, proposal.direction);
        }
      }

      if (!boat.finished){
        anyUnfinished = true;
      }
    }

    currentPlayer = Math.max(0, boats.findIndex((boat) => !boat.finished));
    subMovesLeft = 0;

    if (!anyUnfinished && phase === "race"){
      phase = "finished";
      clearRealtimeIntent();
      changed = true;
    }

    return changed;
  }

  function runLocalRealtimeLoop(frameTime){
    let changed = false;

    if (multiplayerSeatIndex === null && phase !== "finished"){
      const weatherChanged = updateAutoGustState(Date.now());
      if (weatherChanged){
        changed = true;
      }
    }

    if (isLocalRealtimeMode()){
      const now = Number.isFinite(frameTime) ? frameTime : performance.now();
      const dtSeconds = localRealtimeLastTickAt > 0
        ? clamp((now - localRealtimeLastTickAt) / 1000, 0, 0.08)
        : 0;
      localRealtimeLastTickAt = now;

      changed = simulateLocalRealtimeTick(dtSeconds) || changed;
    } else {
      localRealtimeLastTickAt = 0;
    }

    if (changed){
      updateWindInfo();
      updateResetButtonLabel();
      updateStatus();
      updateStats();
      updateOptInfo();
      render();
      emitStateChanged();
    }

    window.requestAnimationFrame(runLocalRealtimeLoop);
  }

  function advanceTurnToNext(){
    subMovesLeft = movesPerTurn;

    let tries = 0;
    const prevPlayer = currentPlayer;

    do{
      currentPlayer = (currentPlayer + 1) % boats.length;
      tries++;
      if (tries > boats.length + 2) break;
    } while(boats[currentPlayer].finished);

    if (phase === "prestart"){
      if (prevPlayer === boats.length-1 && currentPlayer === 0){
        prestartRoundsLeft = Math.max(0, prestartRoundsLeft - 1);
        if (prestartRoundsLeft === 0) maybeStartGunIfNeeded();
      }
    }

    ensureNextPlayerOptions();
  }

  function applyMovesPerTurnSetting(nextValue){
    const previousMovesPerTurn = movesPerTurn;
    const nextMovesPerTurn = clamp(parseInt(nextValue,10) || 1, 1, 10);

    movesPerTurn = nextMovesPerTurn;
    movesPerTurnInp.value = String(movesPerTurn);

    if (!boats.length){
      subMovesLeft = movesPerTurn;
      hybridMovesLeft = [];
      return;
    }

    if (isHybridPlayMode()){
      hybridMovesLeft = boats.map((boat, idx) => {
        if (boat.finished) return 0;
        const prevLeft = clamp(parseInt(hybridMovesLeft[idx],10) || previousMovesPerTurn, 0, previousMovesPerTurn);
        const spent = Math.max(0, previousMovesPerTurn - prevLeft);
        return clamp(movesPerTurn - spent, 0, movesPerTurn);
      });
      if (phase === "race" && allHybridMovesSpent() && !boats.every((boat) => boat.finished)){
        advanceHybridRound();
      }
      emitStateChanged();
      return;
    }

    const spentThisTurn = Math.max(0, previousMovesPerTurn - subMovesLeft);
    if (spentThisTurn >= movesPerTurn && !boats.every((boat) => boat.finished)){
      subMovesLeft = 0;
      selectedBoatIndex = null;
      advanceTurnToNext();
      return;
    }

    subMovesLeft = clamp(movesPerTurn - spentThisTurn, 0, movesPerTurn);
    if (subMovesLeft === 0){
      selectedBoatIndex = null;
    }
    emitStateChanged();
  }

  function performMove(boatIdx, dest){
    const b = boats[boatIdx];
    if (!b || b.finished) return;

    const prev = {x:b.x,y:b.y};

    const mv = { x: dest.x - b.x, y: dest.y - b.y };
    const L = Math.hypot(mv.x,mv.y);
    if (L < 1e-9) return;
    const dir = { x: mv.x/L, y: mv.y/L };
    const headingAng = Math.atan2(dir.y, dir.x);

    if (isTooCloseToMarks(dest, boatIdx, headingAng, true)) return;
    if (boatsPhysicalCollisionsEnabled() && isTooCloseToBoats(dest, boatIdx, headingAng, true)) return;
    if (pathIntersectsAnyMark(prev, dest)) return;
    if (boatsPhysicalCollisionsEnabled() && pathIntersectsOtherBoat(prev, dest, boatIdx)) return;

    b.distance += L;

    const newTack = tackSignFromHeadingVec(dir);
    if (b.hasHeading){
      const da = Math.abs(angleWrap(headingAng - b.heading));
      const tackChanged = (b.tack !== 0 && newTack !== 0 && b.tack !== newTack);
      if (tackChanged || da >= (60*Math.PI/180)) b.turns += 1;
    }
    b.heading = headingAng;
    b.tack = newTack;
    b.hasHeading = true;
    b.currentSpeedUnitsPerSec = 0;

    b.x = dest.x; b.y = dest.y;

    const curPos = {x:b.x,y:b.y};
    updateBoatMarkAndFinish(b, prev, curPos, dir);
    if (isRulesInteractionMode()){
      const movingState = boatEncounterState(boatIdx, {
        pos: { x: dest.x, y: dest.y },
        prev,
        heading: headingAng,
        hasHeading: true,
        direction: dir,
        signedSpeedUnitsPerSec: 1
      });
      const nowMs = Date.now();
      for (let i=0; i<boats.length; i++){
        if (i === boatIdx) continue;
        evaluatePairRulesPenalty(movingState, boatEncounterState(i), nowMs, { turnPenalty:true });
      }
    }

    if (isHybridRaceMode()){
      hybridMovesLeft[boatIdx] = Math.max(0, (hybridMovesLeft[boatIdx] || 0) - 1);
      if (b.finished) hybridMovesLeft[boatIdx] = 0;
    } else {
      subMovesLeft = Math.max(0, subMovesLeft - 1);
      if (b.finished) subMovesLeft = 0;
    }

    if (boats.every(bb => bb.finished) && phase==="race"){
      selectedBoatIndex = null;
      updateStatus();
      updateStats();
      render();
      emitStateChanged();
      return;
    }

    if (isHybridRaceMode()){
      if (allHybridMovesSpent()){
        advanceHybridRound();
        selectedBoatIndex = null;
      } else if ((multiplayerSeatIndex !== null && boatIdx === multiplayerSeatIndex && (hybridMovesLeft[boatIdx] || 0) > 0) || (multiplayerSeatIndex === null && (hybridMovesLeft[boatIdx] || 0) > 0)){
        selectedBoatIndex = boatIdx;
      } else {
        selectedBoatIndex = null;
      }
    } else {
      if (subMovesLeft > 0){
        selectedBoatIndex = currentPlayer;
        updateStatus();
        updateStats();
        render();
        emitStateChanged();
        return;
      }

      advanceTurnToNext();
      selectedBoatIndex = null;
    }

    updateStatus();
    updateStats();
    render();
    emitStateChanged();
  }

  // -----------------------------
  // Постановка лодок: спавн
  // -----------------------------
  function randomSpawnBehindStart(){
    const d = startLineDirUnit();
    const n = prestartNormalUnit();
    const lineLen = Math.hypot(startB.x-startA.x, startB.y-startA.y);

    for (let attempt=0; attempt<200; attempt++){
      const t = Math.random();
      const depth = Math.random() * PRESTART_DEPTH;

      const p = {
        x: startA.x + d.x*(t*lineLen) + n.x*depth,
        y: startA.y + d.y*(t*lineLen) + n.y*depth
      };

      if (!pointInField(p)) continue;
      if (isTooCloseToMarks(p)) continue;
      if (isTooCloseToBoats(p, -1)) continue;
      return p;
    }
    return { x:startA.x, y:startA.y };
  }

  // -----------------------------
  // ОПТИМАЛЬНЫЙ МАРШРУТ: A* по дискретизации
  // -----------------------------
  class MinHeap {
    constructor(){ this.a=[]; }
    push(x){ this.a.push(x); this._up(this.a.length-1); }
    pop(){
      if (!this.a.length) return null;
      const top = this.a[0];
      const last = this.a.pop();
      if (this.a.length){ this.a[0]=last; this._down(0); }
      return top;
    }
    _up(i){
      while(i>0){
        const p=(i-1)>>1;
        if (this.a[p].f <= this.a[i].f) break;
        [this.a[p],this.a[i]]=[this.a[i],this.a[p]];
        i=p;
      }
    }
    _down(i){
      const n=this.a.length;
      while(true){
        let l=i*2+1,r=l+1,b=i;
        if (l<n && this.a[l].f < this.a[b].f) b=l;
        if (r<n && this.a[r].f < this.a[b].f) b=r;
        if (b===i) break;
        [this.a[b],this.a[i]]=[this.a[i],this.a[b]];
        i=b;
      }
    }
  }

  function finishLine(){ return finishSeparate ? [finishA, finishB] : [startA, startB]; }

  function pointToLineDist(p, a, b){
    return pointToSegment(p,a,b).d;
  }

  function plannerResolution(){
    const m = Math.max(worldW, worldH);
    if (m <= 25) return 0.5;
    if (m <= 60) return 0.75;
    return 1.0;
  }

  const PLANNER_DIR_STEP_DEG = 15;
  function plannerDirs(){
    const dirs = [];
    for (let deg=0; deg<360; deg+=PLANNER_DIR_STEP_DEG){
      const t = deg*Math.PI/180;
      dirs.push({ ux: Math.cos(t), uy: Math.sin(t), ang:t });
    }
    return dirs;
  }
  const DIRS = plannerDirs();

  function headingBinFor(ang){
    const stepRad = PLANNER_DIR_STEP_DEG*Math.PI/180;
    const bins = DIRS.length || Math.round(360/PLANNER_DIR_STEP_DEG);
    const normAng = (((ang%(2*Math.PI))+(2*Math.PI))%(2*Math.PI));
    return Math.round(normAng / stepRad) % bins;
  }

  function quantize(p, RES){
    const ix = Math.round(p.x/RES);
    const iy = Math.round(p.y/RES);
    return { ix, iy, x: ix*RES, y: iy*RES };
  }

  function plannerStepLenAt(pos, prevTack, dirUnit, boatSpeed=1){
    let factor = clamp(Number.isFinite(boatSpeed) ? boatSpeed : 1, 0.5, 1.8);
    if (pointInGust(pos)) factor *= GUST_MULT;

    if (tackPenaltyFactor < 1.0 && prevTack !== 0){
      const newTack = tackSignFromHeadingVec(dirUnit);
      if (newTack !== 0 && newTack !== prevTack) factor *= tackPenaltyFactor;
    }
    return STEP_RADIUS_BASE * factor;
  }

  function plannerTurnIncrement(prevHeadingAng, prevTack, newHeadingAng, newTack){
    if (prevHeadingAng === null) return 0;
    const da = Math.abs(angleWrap(newHeadingAng - prevHeadingAng));
    const tackChanged = (prevTack !== 0 && newTack !== 0 && prevTack !== newTack);
    return (tackChanged || da >= (60*Math.PI/180)) ? 1 : 0;
  }

  function isAllowedDir(dirUnit){
    if (deadZoneDeg <= 0) return true;
    const uw = upwindVec();
    const a = angleBetween(dirUnit, uw);
    return a >= (deadZoneDeg*Math.PI/180)/2;
  }

  // goalMode: "course" | "firstMark"
  function planOptimalFrom(startPos, startMarkIdx, prevHeadingAng, prevTack, goalMode, movingBoatIdx=null, movingBoatSpeed=1){
    const RES = plannerResolution();

    const sPos = { x: clamp(startPos.x,0,worldW), y: clamp(startPos.y,0,worldH) };
    const q0 = quantize(sPos, RES);

    if (isTooCloseToMarks(sPos, movingBoatIdx ?? -1)) return null;
    if (movingBoatIdx !== null && boatsPhysicalCollisionsEnabled() && isTooCloseToBoats(sPos, movingBoatIdx)) return null;

    const [fa, fb] = finishLine();
    const targetMark = marks[0];

    // ✅ добавили inZone/okFlag в ключ (для корректного "войти→выйти")
    const keyOf = (ix,iy,mark,hd,tack,iz,sw) => `${ix},${iy},${mark},${hd},${tack},${iz},${sw}`;

    const g = new Map();
    const tcnt = new Map();
    const parent = new Map();
    const parentPos = new Map();

    const pq = new MinHeap();

    const qStart = quantize(sPos, RES);
    const hdStart = (prevHeadingAng === null) ? -1 : headingBinFor(prevHeadingAng);

    // стартовое состояние "в зоне?" для текущей цели
    let startInZone = 0;
    if (goalMode === "firstMark") startInZone = (roundingZoneRelation(sPos, targetMark) < 0) ? 1 : 0;
    else if (startMarkIdx < markCount) startInZone = (roundingZoneRelation(sPos, marks[startMarkIdx]) < 0) ? 1 : 0;

    const startKey = keyOf(qStart.ix,qStart.iy,startMarkIdx,hdStart,prevTack,startInZone,0);

    g.set(startKey, 0);
    tcnt.set(startKey, 0);
    parent.set(startKey, null);
    parentPos.set(startKey, {x:sPos.x,y:sPos.y});

    function heuristic(p, markIdx){
      if (goalMode === "firstMark"){
        return dist(p, targetMark);
      }
      if (markIdx < markCount){
        return dist(p, marks[markIdx]);
      }
      return pointToLineDist(p, fa, fb);
    }

    pq.push({
      f: heuristic(sPos, startMarkIdx),
      key: startKey,
      ix:qStart.ix, iy:qStart.iy, x:sPos.x, y:sPos.y,
      mark:startMarkIdx, h:prevHeadingAng, tack:prevTack,
      iz:startInZone, sw:0
    });

    const MAX_EXPAND = (goalMode === "firstMark") ? 45000 : 250000;
    let expanded = 0;

    let bestGoalKey = null;
    let bestGoalCost = Infinity;

    while(true){
      const cur = pq.pop();
      if (!cur) break;

      if (bestGoalKey && cur.f >= bestGoalCost - 1e-9) break;

      const curG = g.get(cur.key);
      if (curG === undefined) continue;

      expanded++;
      if (expanded > MAX_EXPAND) break;

      const curPos = { x: cur.x, y: cur.y };

      for (const d of DIRS){
        const dirUnit = { x:d.ux, y:d.uy };
        if (!isAllowedDir(dirUnit)) continue;

        const stepLen = plannerStepLenAt(curPos, cur.tack, dirUnit, movingBoatSpeed);
        const nextRaw = clampAlongRayToField(curPos, dirUnit, stepLen);

        const nq = quantize(nextRaw, RES);
        const nextPos = { x: clamp(nq.x,0,worldW), y: clamp(nq.y,0,worldH) };

        if (!pointInField(nextPos)) continue;

        const moveVec = { x: nextPos.x - curPos.x, y: nextPos.y - curPos.y };
        const L = Math.hypot(moveVec.x, moveVec.y);
        if (L < 1e-6) continue;
        if (L > stepLen + 1e-6) continue;
        const headingAng = Math.atan2(moveVec.y, moveVec.x);
        if (isMoveInDeadZone(moveVec)) continue;
        if (isTooCloseToMarks(nextPos, movingBoatIdx ?? -1, headingAng, true)) continue;
        if (pathIntersectsAnyMark(curPos, nextPos)) continue;
        if (movingBoatIdx !== null){
          if (boatsPhysicalCollisionsEnabled() && isTooCloseToBoats(nextPos, movingBoatIdx, headingAng, true)) continue;
          if (boatsPhysicalCollisionsEnabled() && pathIntersectsOtherBoat(curPos, nextPos, movingBoatIdx)) continue;
        }

        const newTack = tackSignFromHeadingVec({x:moveVec.x/L,y:moveVec.y/L});
        const addTurns = plannerTurnIncrement(cur.h, cur.tack, headingAng, newTack);

        const dirForMark = {x:moveVec.x/L,y:moveVec.y/L};

        let nextMark = cur.mark;
        let nextIZ = cur.iz;
        let nextSweep = cur.sw;

        // ✅ Корректное огибание со "войти→выйти"
        if (goalMode === "firstMark"){
          if (nextMark < 1){
            const rr = processRoundingPlanner(curPos, nextPos, dirForMark, targetMark, cur.iz===1, cur.sw || 0);
            if (rr.completed){
              nextMark = 1;
              nextIZ = 0; nextSweep = 0;
            } else {
              nextIZ = rr.inZone ? 1 : 0;
              nextSweep = rr.sweep || 0;
            }
          } else {
            nextIZ = 0; nextSweep = 0;
          }
        } else {
          if (nextMark < markCount){
            const m = marks[nextMark];
            const rr = processRoundingPlanner(curPos, nextPos, dirForMark, m, cur.iz===1, cur.sw || 0);
            if (rr.completed){
              nextMark = nextMark + 1;
              nextIZ = 0; nextSweep = 0;
            } else {
              nextIZ = rr.inZone ? 1 : 0;
              nextSweep = rr.sweep || 0;
            }
          } else {
            nextIZ = 0; nextSweep = 0;
          }
        }

        let goalReached = false;

        if (goalMode === "firstMark"){
          if (nextMark >= 1) goalReached = true;
        } else {
          if (nextMark >= markCount){
            if (segmentsIntersect(curPos, nextPos, fa, fb)) goalReached = true;
          }
        }

        const hdBin = headingBinFor(headingAng);
        const k2 = keyOf(nq.ix,nq.iy,nextMark,hdBin,newTack,nextIZ,roundingSweepKey(nextSweep));

        const candG = curG + L;
        const candT = (tcnt.get(cur.key) || 0) + addTurns;

        const oldG = g.get(k2);
        const oldT = tcnt.get(k2);

        const better = (oldG === undefined) || (candG < oldG - 1e-6) || (Math.abs(candG-oldG) <= 1e-6 && candT < oldT);

        if (better){
          g.set(k2, candG);
          tcnt.set(k2, candT);
          parent.set(k2, cur.key);
          parentPos.set(k2, nextPos);

          const h = heuristic(nextPos, nextMark);
          pq.push({
            f: candG + h, key: k2,
            ix:nq.ix, iy:nq.iy, x: nextPos.x, y: nextPos.y,
            mark: nextMark, h: headingAng, tack: newTack,
            iz: nextIZ, sw: nextSweep
          });

          if (goalReached && candG < bestGoalCost){
            bestGoalCost = candG;
            bestGoalKey = k2;
          }
        }
      }
    }

    if (!bestGoalKey) return null;

    const path = [];
    let k = bestGoalKey;
    while(k){
      const p = parentPos.get(k);
      if (p) path.push({x:p.x,y:p.y});
      k = parent.get(k);
    }
    path.reverse();

    return {
      path,
      distance: bestGoalCost,
      turns: tcnt.get(bestGoalKey) || 0,
      moves: Math.max(0, path.length-1)
    };
  }

  function computeOptimalForBoat(idx){
    const b = boats[idx];
    if (!b) return;

    const startPos = {x:b.x,y:b.y};
    const markIdx = (phase==="race") ? b.nextMark : 0;

    const prevHeadingAng = b.hasHeading ? b.heading : null;
    const prevTack = b.hasHeading ? b.tack : 0;

    const res = planOptimalFrom(startPos, markIdx, prevHeadingAng, prevTack, "course", idx, boatSpeedCoeff(b));
    if (!res){
      optimalPath = [];
      optimalStats = null;
      optimalForBoat = idx;
      return;
    }

    optimalPath = res.path;
    optimalStats = { distance: res.distance, turns: res.turns, moves: res.moves };
    optimalForBoat = idx;
  }

  // Лучший старт считается только ДО 1-го знака (быстрее)
  function computeBestStart(){
    const line = { x:startB.x-startA.x, y:startB.y-startA.y };
    const len = Math.hypot(line.x,line.y) || 1;
    const ux = line.x/len, uy = line.y/len;
    const baseBoat = boats[
      Number.isInteger(selectedBoatIndex)
        ? selectedBoatIndex
        : (Number.isInteger(multiplayerSeatIndex) ? multiplayerSeatIndex : 0)
    ] || boats[0] || null;

    const n = clamp(Math.round(len / 1.2), 8, 16);
    let best = null;

    for (let i=1; i<=n; i++){
      const t = i/(n+1);
      const sp = { x: startA.x + ux*len*t, y: startA.y + uy*len*t };

      if (isTooCloseToMarks(sp)) continue;
      if (boatsPhysicalCollisionsEnabled() && isTooCloseToBoats(sp, -1)) continue;

      const res = planOptimalFrom(sp, 0, null, 0, "firstMark", -1, boatSpeedCoeff(baseBoat));
      if (!res) continue;

      if (!best || res.distance < best.stats.distance){
        best = { start: sp, path: res.path, stats: {distance:res.distance, turns:res.turns, moves:res.moves} };
      }
    }

    bestStartSolution = best;
  }

  // -----------------------------
  // UI / статус / статистика
  // -----------------------------
  function updateStatus(){
    syncFullscreenPhaseWatch();

    if (mode === "marks"){
      const idx = parseInt(markToEditSelect.value,10)+1;
      statusEl.textContent = `Режим: знаки. Клик по полю — поставить знак ${idx}.`;
      return;
    }
    if (mode === "start"){
      statusEl.textContent = startAwaitSecond
        ? "Режим: старт. Выбери второй конец стартовой линии."
        : "Режим: старт. Первый клик — первый конец, второй клик — второй конец.";
      return;
    }
    if (mode === "finish"){
      statusEl.textContent = finishAwaitSecond
        ? "Режим: финиш. Выбери второй конец финишной линии."
        : "Режим: финиш. Первый клик — первый конец, второй клик — второй конец.";
      return;
    }
    if (mode === "boats"){
      const zone = (prestartRoundsSetting > 0 && phase==="prestart")
        ? "зелёная зона за стартовой линией"
        : "зелёная зона на стартовой линии";
      statusEl.textContent = `Режим: лодки. Клик по лодке — выбрать. Клик в ${zone} — поставить (нельзя ставить на другие лодки/знаки).`;
      return;
    }
    if (mode === "model"){
      statusEl.textContent =
        "Режим: моделирование. Клик по лодке — выбрать. Клик по полю — поставить лодку (нельзя ставить на лодки/знаки). " +
        "Выбери лег и следующего игрока, затем нажми «Продолжить из ситуации».";
      return;
    }

    const allDone = isRaceComplete();
    if (allDone){
      statusEl.textContent = "Гонка завершена: все лодки финишировали.";
      return;
    }

    if (isRealtimePlayMode()){
      const controlledBoatIndex = realtimeControlledBoatIndex();
      const ownBoat = Number.isInteger(controlledBoatIndex) ? boats[controlledBoatIndex] : null;
      const ownLegInfo = ownBoat && !ownBoat.finished
        ? `Твоя лодка: ${controlledBoatIndex + 1}. Следующий знак: ${Math.min(ownBoat.nextMark + 1, markCount)} из ${markCount}.`
        : "";
      if (phase === "countdown"){
        const countdown = realtimeCountdownState();
        if (countdown.active){
          statusEl.textContent = `ПРЕДСТАРТ. До сигнала ${formatCountdownSeconds(countdown.totalMsLeft)} с. Фальстарт считается только в последние 3.0 с до старта. ${ownLegInfo}`;
        } else if (isLocalRealtimeMode()) {
          statusEl.textContent = `ЛОКАЛЬНЫЙ REALTIME ГОТОВ. Нажми «Общий старт», чтобы открыть предстарт. В соло курсором управляешь выбранной лодкой. ${ownLegInfo}`;
        } else {
          statusEl.textContent = `ОЖИДАНИЕ ОБЩЕГО СТАРТА. ${ownLegInfo}`;
        }
      } else if (phase === "finished"){
        statusEl.textContent = "Гонка завершена: все лодки финишировали.";
      } else {
        const controlHint = isLocalRealtimeMode()
          ? "Веди выбранную лодку курсором мыши или касанием по полю."
          : "Веди свою лодку курсором мыши или касанием по полю.";
        statusEl.textContent = `РЕАЛЬНОЕ ВРЕМЯ. Все лодки идут одновременно. ${controlHint} ${ownLegInfo}`;
      }
      return;
    }

    if (isHybridRaceMode()){
      const seat = (multiplayerSeatIndex !== null && boats[multiplayerSeatIndex]) ? multiplayerSeatIndex : selectedBoatIndex;
      const ownBoat = Number.isInteger(seat) ? boats[seat] : null;
      const ownInfo = ownBoat ? `Твоя лодка: ${seat+1}. Шагов в раунде: ${stepsLeftForBoat(seat)} / ${movesPerTurn}.` : "";
      statusEl.textContent = `ГОНКА. Гибридный раунд ${hybridRound}. Все экипажи ходят одновременно. ${ownInfo} Клик по своей лодке → клик в разрешенную область.`;
      return;
    }

    const b = boats[currentPlayer];
    const who = currentPlayer+1;

    const phaseText = (phase==="prestart")
      ? `ПРЕДСТАРТ: осталось кругов ${prestartRoundsLeft}`
      : "ГОНКА";

    const stepsInfo = `Шагов осталось: ${subMovesLeft} / ${movesPerTurn}`;
    const legInfo = (phase==="race" && b && !b.finished) ? `След. знак: ${Math.min(b.nextMark+1, markCount)} из ${markCount}` : "";

    statusEl.textContent = `${phaseText}. Ход лодки ${who}. ${stepsInfo}. ${legInfo}. Клик по своей лодке → клик в разрешённую область.`;
  }

  function updateStats(){
    const lines = [];
    const finishLinePoints = finishLine();
    const courseLegs = [];
    const startMid = midpoint(startA, startB);
    const finishMid = midpoint(finishLinePoints[0], finishLinePoints[1]);
    const visibleMarks = marks.slice(0, markCount);

    if (visibleMarks.length){
      courseLegs.push(`Старт → знак 1: <b>${formatMeters(dist(startMid, visibleMarks[0]))}</b>`);
      for (let i=1; i<visibleMarks.length; i++){
        courseLegs.push(`Знак ${i} → знак ${i+1}: <b>${formatMeters(dist(visibleMarks[i-1], visibleMarks[i]))}</b>`);
      }
      courseLegs.push(`Знак ${visibleMarks.length} → финиш: <b>${formatMeters(dist(visibleMarks[visibleMarks.length - 1], finishMid))}</b>`);
    }

    lines.push(`<b>Статистика</b>`);
    lines.push(`<div style="display:grid;gap:8px;margin-top:6px;">`);
    lines.push(`<div><b>Стартовая линия:</b> ${formatMeters(lineLengthUnits(startA, startB))}</div>`);
    lines.push(`<div><b>Финишная линия:</b> ${formatMeters(lineLengthUnits(finishLinePoints[0], finishLinePoints[1]))}</div>`);
    if (courseLegs.length){
      lines.push(`<div><b>Леги дистанции:</b> ${courseLegs.join(" · ")}</div>`);
    }
    lines.push(`</div>`);

    lines.push(`<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">`);

    for (let i=0;i<boats.length;i++){
      const b = boats[i];
      const fin = b.finished ? `✅ финиш: ${b.place}` : (phase==="race" || phase==="finished" ? "⏳ в гонке" : phase==="countdown" ? "⏳ стартовая процедура" : "⏳ предстарт");
      const controlledBoatIndex = realtimeControlledBoatIndex();
      const stepLine = isRealtimePlayMode()
        ? `Управление: <b>${controlledBoatIndex === i ? "курсор" : (isLocalRealtimeMode() ? "без управления" : "сервер")}</b>`
        : `Шагов: <b>${stepsLeftForBoat(i)}</b>${isHybridRaceMode() ? ` / ${movesPerTurn}` : ""}`;
      lines.push(`
        <div style="border:1px solid #eee;border-radius:10px;padding:8px 10px;min-width:220px;">
          <div><b style="color:${b.color};">Лодка ${i+1}</b> — ${fin}</div>
          <div>Скорость: <b>×${boatSpeedCoeff(b).toFixed(2)}</b></div>
          <div>Пройдено: <b>${formatMeters(b.distance)}</b></div>
          <div>Повороты: <b>${b.turns}</b></div>
          <div>Штрафы: <b>${parseInt(b.penalties,10) || 0}</b>${(parseInt(b.collisions,10) || 0) > 0 ? ` · контакты: <b>${parseInt(b.collisions,10) || 0}</b>` : ""}</div>
          <div>${stepLine}</div>
          <div>${boatStartSummary(b)}</div>
          <div>${b.lastPenaltyReason ? `Последний инцидент: <b>${b.lastPenaltyReason}</b>` : "Инциденты: нет"}</div>
          <div>Знаки: <b>${Math.min(b.nextMark, markCount)}</b> / ${markCount}</div>
        </div>
      `);
    }
    lines.push(`</div>`);
    statsEl.innerHTML = lines.join("");
  }

  function updateOptInfo(){
    const finTxt = finishSeparate ? "Финиш: отдельная линия" : "Финиш: по стартовой линии";
    const roundTxt = (roundingSide==="port") ? "Огибание: левая дистанция" : "Огибание: правая дистанция";
    const contactTxt = `Встречи: ${interactionModeLabel()}`;
    const gustTxt = autoGustsEnabled
      ? `Порывы: авто (${autoGustIntervalSec.toFixed(0)}с / ${autoGustDurationSec.toFixed(0)}с)`
      : (gustRect ? "Порывы: ручной" : "Порывы: выкл");

    let extra = "";

    if (showOptimal && optimalStats && optimalForBoat !== null){
      extra += `<div style="margin-top:6px;">🧭 <b>Оптимум для лодки ${optimalForBoat+1}</b>: расстояние <b>${formatMeters(optimalStats.distance)}</b>, повороты <b>${optimalStats.turns}</b>, ходов <b>${optimalStats.moves}</b></div>`;
    }
    if (showBestStart && bestStartSolution){
      extra += `<div style="margin-top:6px;">🏁 <b>Лучший старт (до 1-го знака)</b>: расстояние <b>${formatMeters(bestStartSolution.stats.distance)}</b>, повороты <b>${bestStartSolution.stats.turns}</b>, ходов <b>${bestStartSolution.stats.moves}</b></div>`;
    }
    if ((showBestStart && !bestStartSolution) || (showOptimal && !optimalStats)){
      extra += `<div style="margin-top:6px;">⚠️ Не удалось найти маршрут (попробуй уменьшить поле / мёртвую зону / сдвинуть знаки/финиш).</div>`;
    }

    const phaseLabel = phase === "prestart"
      ? "предстарт"
      : phase === "countdown"
        ? "отсчет"
        : phase === "finished"
          ? "финиш"
          : "гонка";
    optInfoEl.innerHTML = `<b>Состояние</b>: ${finTxt}. ${roundTxt}. ${contactTxt}. ${gustTxt}. Фаза: <b>${phaseLabel}</b>.${extra}`;
  }

  // -----------------------------
  // Инициализация / сброс
  // -----------------------------
  function resetBoats({ armRealtime=false } = {}){
    const n = parseInt(playerCountSelect.value,10) || 2;
    const previousBoats = boats.slice();
    const realtimeStartDepth = Math.min(PRESTART_DEPTH * 0.35, 1.25);
    const prestartNormal = prestartNormalUnit();

    boats = [];
    raceFinishedCount = 0;

    prestartRoundsSetting = parseInt(prestartRoundsInp.value,10) || 0;
    prestartRoundsLeft = isRealtimePlayMode() ? 0 : prestartRoundsSetting;
    phase = (!isRealtimePlayMode() && prestartRoundsSetting > 0)
      ? "prestart"
      : (isLocalRealtimeMode() ? "countdown" : "race");

    for (let i=0;i<n;i++){
      boats.push({
        x:0, y:0,
        distance:0,
        turns:0,
        penalties:0,
        collisions:0,
        nextMark:0,
        finished:false,
        place:null,
        hasHeading:false,
        heading:0,
        tack:0,
        color: BOAT_COLORS[i % BOAT_COLORS.length],
        speedCoeff: boatSpeedCoeff(previousBoats[i]),
        currentSpeedUnitsPerSec:0,
        penaltySlowUntil:0,
        lastPenaltyAt:0,
        lastPenaltyKey:"",
        lastPenaltyReason:"",

        // ✅ состояние огибания (важно!)
        roundInZone:false,
        roundSweep:0,
        startDeltaMs:null,
        falseStartDeltaMs:null
      });
    }

    if (phase === "prestart"){
      for (let i=0;i<n;i++){
        const p = randomSpawnBehindStart();
        boats[i].x = p.x;
        boats[i].y = p.y;
      }
    } else if (isRealtimePlayMode()){
      for (let i=0;i<n;i++){
        const t = (i+1)/(n+1);
        boats[i].x = startA.x + (startB.x-startA.x)*t + prestartNormal.x * realtimeStartDepth;
        boats[i].y = startA.y + (startB.y-startA.y)*t + prestartNormal.y * realtimeStartDepth;
      }
    } else {
      for (let i=0;i<n;i++){
        const t = (i+1)/(n+1);
        boats[i].x = startA.x + (startB.x-startA.x)*t;
        boats[i].y = startA.y + (startB.y-startA.y)*t;
      }
    }

    currentPlayer = 0;
    selectedBoatIndex = isLocalRealtimeMode() && n > 0 ? 0 : null;
    placementSelectedBoat = null;
    subMovesLeft = movesPerTurn;
    resetHybridState();
    realtimeCountdownEndsAt = (isLocalRealtimeMode() && armRealtime)
      ? (Date.now() + (realtimePrepSeconds * 1000))
      : 0;
    realtimeCursorTarget = null;
    realtimeCursorDirection = null;
    activeRealtimePointerId = null;
    localRealtimeLastTickAt = 0;
    resetBoatTrails();
    clearGust();
    if (autoGustsEnabled){
      scheduleNextAutoGust(Date.now());
    }

    ensureNextPlayerOptions();
    renderBoatTuningControls();
    invalidateSolutions();
    updateFinishButtonEnabled();
    updateResetButtonLabel();
    updateWindInfo();
    updateStatus();
    updateStats();
    updateOptInfo();
  }

  function emitStateChanged(){
    window.dispatchEvent(new CustomEvent("regatta:state-changed"));
  }

  function emitRealtimeIntentChanged(){
    window.dispatchEvent(new CustomEvent("regatta:realtime-intent"));
  }

  function isRealtimePlayMode(){
    return playMode === "realtime";
  }

  function isLocalRealtimeMode(){
    return isRealtimePlayMode() && multiplayerSeatIndex === null;
  }

  function isRealtimeCountdown(){
    return isRealtimePlayMode() && phase === "countdown" && realtimeCountdownEndsAt > currentRaceTimeMs();
  }

  function isRealtimeRaceMode(){
    return isRealtimePlayMode() && phase === "race";
  }

  function realtimeCountdownValue(){
    if (!isRealtimePlayMode() || phase !== "countdown") return 0;
    return Math.max(0, realtimeCountdownEndsAt - currentRaceTimeMs());
  }

  function realtimeCountdownState(nowMs = currentRaceTimeMs()){
    if (!isRealtimePlayMode() || phase !== "countdown") {
      return { active:false, totalMsLeft:0, prepMsLeft:0, finalMsLeft:0, inFinal:false };
    }

    const totalMsLeft = Math.max(0, realtimeCountdownEndsAt - nowMs);
    return {
      active: totalMsLeft > 0,
      totalMsLeft,
      prepMsLeft: totalMsLeft,
      finalMsLeft: 0,
      inFinal: false
    };
  }

  function formatCountdownSeconds(ms){
    if (!Number.isFinite(ms) || ms <= 0) return "0.0";
    const seconds = ms / 1000;
    return seconds >= 10 ? String(Math.ceil(seconds)) : seconds.toFixed(1);
  }

  function realtimeControlledBoatIndex(){
    if (multiplayerSeatIndex !== null) return multiplayerSeatIndex;
    if (Number.isInteger(selectedBoatIndex)) return selectedBoatIndex;
    return boats.length ? 0 : null;
  }

  function setRealtimeReadyState(){
    if (!isLocalRealtimeMode()) return;
    phase = "countdown";
    realtimeCountdownEndsAt = 0;
    prestartRoundsLeft = 0;
    localRealtimeLastTickAt = 0;
    for (const boat of boats){
      boat.startDeltaMs = null;
      boat.falseStartDeltaMs = null;
      boat.currentSpeedUnitsPerSec = 0;
      boat.penaltySlowUntil = 0;
      boat.lastPenaltyAt = 0;
      boat.lastPenaltyKey = "";
      boat.lastPenaltyReason = "";
    }
    if (!Number.isInteger(selectedBoatIndex) && boats.length){
      selectedBoatIndex = 0;
    } else if (Number.isInteger(selectedBoatIndex)) {
      selectedBoatIndex = clamp(selectedBoatIndex, 0, Math.max(0, boats.length - 1));
    }
    clearRealtimeIntent();
  }

  function clearRealtimeIntent(){
    if (realtimeCursorTarget === null && realtimeCursorDirection === null) return;
    realtimeCursorTarget = null;
    realtimeCursorDirection = null;
    emitRealtimeIntentChanged();
  }

  function setRealtimeIntent(nextTarget, nextDirection){
    if (!nextTarget || !nextDirection){
      clearRealtimeIntent();
      return;
    }

    const directionLength = Math.hypot(nextDirection.x, nextDirection.y);
    if (directionLength <= 1e-6){
      clearRealtimeIntent();
      return;
    }

    const target = {
      x: clamp(nextTarget.x, 0, worldW),
      y: clamp(nextTarget.y, 0, worldH)
    };
    const direction = {
      x: nextDirection.x / directionLength,
      y: nextDirection.y / directionLength
    };
    const same = realtimeCursorTarget
      && Math.abs(realtimeCursorTarget.x - target.x) < 1e-4
      && Math.abs(realtimeCursorTarget.y - target.y) < 1e-4
      && realtimeCursorDirection
      && Math.abs(realtimeCursorDirection.x - direction.x) < 1e-5
      && Math.abs(realtimeCursorDirection.y - direction.y) < 1e-5;
    realtimeCursorTarget = target;
    realtimeCursorDirection = direction;
    if (!same) emitRealtimeIntentChanged();
  }

  function isHybridPlayMode(){
    return playMode === "hybrid";
  }

  function isHybridRaceMode(){
    return phase === "race" && isHybridPlayMode();
  }

  function resetHybridState(){
    hybridRound = 1;
    hybridMovesLeft = boats.map((boat) => boat.finished ? 0 : movesPerTurn);
  }

  function allHybridMovesSpent(){
    return boats.every((boat, idx) => boat.finished || (hybridMovesLeft[idx] || 0) <= 0);
  }

  function advanceHybridRound(){
    hybridRound += 1;
    hybridMovesLeft = boats.map((boat) => boat.finished ? 0 : movesPerTurn);
  }

  function stepsLeftForBoat(boatIdx){
    if (boatIdx < 0 || boatIdx >= boats.length) return 0;
    if (isHybridRaceMode()) return hybridMovesLeft[boatIdx] || 0;
    return (boatIdx === currentPlayer) ? subMovesLeft : 0;
  }

  function canBoatMoveNow(boatIdx){
    if (boatIdx < 0 || boatIdx >= boats.length) return false;
    if (boats[boatIdx].finished) return false;
    if (isHybridRaceMode()) return stepsLeftForBoat(boatIdx) > 0;
    return boatIdx === currentPlayer && subMovesLeft > 0;
  }

  function canSelectBoatForPlay(boatIdx){
    if (!Number.isInteger(boatIdx)) return false;
    if (!canBoatMoveNow(boatIdx)) return false;
    if (!isHybridRaceMode()) return boatIdx === currentPlayer;
    if (multiplayerSeatIndex !== null) return boatIdx === multiplayerSeatIndex;
    return true;
  }

  function clonePoint(rawPoint, fallbackPoint){
    const fallback = fallbackPoint || { x:0, y:0 };
    const x = Number.isFinite(rawPoint?.x) ? rawPoint.x : fallback.x;
    const y = Number.isFinite(rawPoint?.y) ? rawPoint.y : fallback.y;
    return { x, y };
  }

  function toMeters(distanceUnits){
    return distanceUnits * METERS_PER_WORLD_UNIT;
  }

  function formatMeters(distanceUnits, decimals=0){
    return `${toMeters(distanceUnits).toFixed(decimals)} м`;
  }

  function lineLengthUnits(a, b){
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function midpoint(a, b){
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function startLineSideValue(point){
    const mid = midpoint(startA, startB);
    const normal = courseSideNormalUnit();
    return (point.x - mid.x) * normal.x + (point.y - mid.y) * normal.y;
  }

  function classifyStartLineCrossing(prevPos, curPos){
    if (!segmentsIntersect(prevPos, curPos, startA, startB)) return null;
    const prevSide = startLineSideValue(prevPos);
    const curSide = startLineSideValue(curPos);
    const eps = 1e-6;
    if (prevSide <= eps && curSide > eps) return "toCourse";
    if (prevSide >= -eps && curSide < -eps) return "toPrestart";
    return null;
  }

  function startLineCrossingTimeMs(prevPos, curPos, tickStartMs, tickEndMs){
    if (!Number.isFinite(tickStartMs) || !Number.isFinite(tickEndMs)) return tickEndMs;
    const prevSide = startLineSideValue(prevPos);
    const curSide = startLineSideValue(curPos);
    const denom = prevSide - curSide;
    if (Math.abs(denom) < 1e-9) return tickEndMs;
    const t = clamp(prevSide / denom, 0, 1);
    return tickStartMs + (tickEndMs - tickStartMs) * t;
  }

  function recordRealtimeStartCrossing(boat, prevPos, curPos, tickStartMs=Date.now(), tickEndMs=tickStartMs){
    if (!isRealtimePlayMode()) return;
    const crossing = classifyStartLineCrossing(prevPos, curPos);
    if (crossing !== "toCourse") return;
    const gunAt = Number.isFinite(realtimeCountdownEndsAt) ? realtimeCountdownEndsAt : 0;
    if (!gunAt) return;
    const eventTimeMs = startLineCrossingTimeMs(prevPos, curPos, tickStartMs, tickEndMs);
    const deltaMs = eventTimeMs - gunAt;
    if (deltaMs < 0){
      if (deltaMs >= -3000 && !Number.isFinite(boat.falseStartDeltaMs)){
        boat.falseStartDeltaMs = deltaMs;
      }
      return;
    }
    if (!Number.isFinite(boat.startDeltaMs)){
      boat.startDeltaMs = deltaMs;
    }
  }

  function formatStartDelta(deltaMs){
    if (!Number.isFinite(deltaMs)) return "ожидание";
    const deltaSeconds = Math.abs(deltaMs) / 1000;
    if (deltaSeconds < 0.05) return "ровно в сигнал";
    return `${deltaMs < 0 ? "раньше" : "позже"} на ${deltaSeconds.toFixed(1)} с`;
  }

  function boatStartSummary(boat){
    if (!isRealtimePlayMode()) return "Старт: по очереди";
    const hasEarly = Number.isFinite(boat.falseStartDeltaMs);
    const hasLegal = Number.isFinite(boat.startDeltaMs);
    if (hasEarly && hasLegal){
      return `Старт: фальстарт ${formatStartDelta(boat.falseStartDeltaMs)}, затем ${formatStartDelta(boat.startDeltaMs)}`;
    }
    if (hasEarly){
      return `Старт: фальстарт ${formatStartDelta(boat.falseStartDeltaMs)}`;
    }
    if (hasLegal){
      return `Старт: ${formatStartDelta(boat.startDeltaMs)}`;
    }
    if (phase === "finished" || phase === "race"){
      return "Старт: не пересек стартовую линию";
    }
    return "Старт: ожидание сигнала";
  }

  function boatRealtimeSpeedMps(boat){
    return Math.abs(Number.isFinite(boat?.currentSpeedUnitsPerSec) ? boat.currentSpeedUnitsPerSec : 0) * METERS_PER_WORLD_UNIT;
  }

  function boatCourseToWindDeg(boat){
    if (!boat?.hasHeading) return null;
    const headingVec = boatAxisUnit(boat.heading, boat.hasHeading);
    return angleBetween(headingVec, upwindVec()) * 180 / Math.PI;
  }

  function boatTackLabel(boat){
    if ((boat?.tack || 0) > 0) return "правый галс";
    if ((boat?.tack || 0) < 0) return "левый галс";
    return "левентик";
  }

  function normalizeBoatSnapshot(rawBoat, idx){
    const fallback = boats[idx] || { x:0, y:0 };
    return {
      x: clamp(Number.isFinite(rawBoat?.x) ? rawBoat.x : fallback.x, 0, worldW),
      y: clamp(Number.isFinite(rawBoat?.y) ? rawBoat.y : fallback.y, 0, worldH),
      distance: Number.isFinite(rawBoat?.distance) ? rawBoat.distance : 0,
      turns: Number.isFinite(rawBoat?.turns) ? rawBoat.turns : 0,
      penalties: Number.isFinite(rawBoat?.penalties) ? rawBoat.penalties : 0,
      collisions: Number.isFinite(rawBoat?.collisions) ? rawBoat.collisions : 0,
      nextMark: clamp(parseInt(rawBoat?.nextMark,10) || 0, 0, markCount),
      finished: !!rawBoat?.finished,
      place: Number.isFinite(rawBoat?.place) ? rawBoat.place : null,
      hasHeading: !!rawBoat?.hasHeading,
      heading: Number.isFinite(rawBoat?.heading) ? rawBoat.heading : 0,
      tack: Number.isFinite(rawBoat?.tack) ? rawBoat.tack : 0,
      color: typeof rawBoat?.color === "string" ? rawBoat.color : BOAT_COLORS[idx % BOAT_COLORS.length],
      speedCoeff: boatSpeedCoeff(rawBoat || fallback),
      currentSpeedUnitsPerSec: Number.isFinite(rawBoat?.currentSpeedUnitsPerSec) ? rawBoat.currentSpeedUnitsPerSec : 0,
      penaltySlowUntil: Number.isFinite(rawBoat?.penaltySlowUntil) ? rawBoat.penaltySlowUntil : 0,
      lastPenaltyAt: Number.isFinite(rawBoat?.lastPenaltyAt) ? rawBoat.lastPenaltyAt : 0,
      lastPenaltyKey: typeof rawBoat?.lastPenaltyKey === "string" ? rawBoat.lastPenaltyKey : "",
      lastPenaltyReason: typeof rawBoat?.lastPenaltyReason === "string" ? rawBoat.lastPenaltyReason : "",
      roundInZone: !!rawBoat?.roundInZone,
      roundSweep: Number.isFinite(rawBoat?.roundSweep) ? rawBoat.roundSweep : 0,
      startDeltaMs: Number.isFinite(rawBoat?.startDeltaMs) ? rawBoat.startDeltaMs : null,
      falseStartDeltaMs: Number.isFinite(rawBoat?.falseStartDeltaMs) ? rawBoat.falseStartDeltaMs : null
    };
  }

  function exportGameState(){
    return {
      version: 2,
      world: {
        width: worldW,
        height: worldH
      },
      settings: {
        windAngleDeg,
        deadZoneDeg,
        snapThreshold,
        movesPerTurn,
        roundingSide,
        playMode,
        interactionMode,
        tackPenaltyFactor,
        autoGustsEnabled,
        autoGustIntervalSec,
        autoGustDurationSec,
        realtimePrepSeconds,
        autoFullscreenMode,
        finishSeparate,
        prestartRoundsSetting
      },
      course: {
        markCount,
        marks: marks.slice(0, MARK_MAX).map((mark) => ({ x: mark.x, y: mark.y })),
        startA: { ...startA },
        startB: { ...startB },
        finishA: { ...finishA },
        finishB: { ...finishB },
        gustRect: gustRect ? { ...gustRect } : null
      },
      race: {
        currentPlayer,
        raceFinishedCount,
        subMovesLeft,
        hybridRound,
        hybridMovesLeft: hybridMovesLeft.slice(),
        realtimeCountdownEndsAt,
        gustExpiresAt,
        nextAutoGustAt,
        prestartRoundsLeft,
        phase
      },
      boats: boats.map((boat) => ({
        x: boat.x,
        y: boat.y,
        distance: boat.distance,
        turns: boat.turns,
        penalties: boat.penalties,
        collisions: boat.collisions,
        nextMark: boat.nextMark,
        finished: boat.finished,
        place: boat.place,
        hasHeading: boat.hasHeading,
        heading: boat.heading,
        tack: boat.tack,
        color: boat.color,
        speedCoeff: boat.speedCoeff,
        currentSpeedUnitsPerSec: boat.currentSpeedUnitsPerSec,
        penaltySlowUntil: boat.penaltySlowUntil,
        lastPenaltyAt: boat.lastPenaltyAt,
        lastPenaltyKey: boat.lastPenaltyKey,
        lastPenaltyReason: boat.lastPenaltyReason,
        roundInZone: boat.roundInZone,
        roundSweep: boat.roundSweep,
        startDeltaMs: boat.startDeltaMs,
        falseStartDeltaMs: boat.falseStartDeltaMs
      }))
    };
  }

  function importGameState(snapshot){
    if (!snapshot || typeof snapshot !== "object") return;

    const world = snapshot.world || {};
    const settings = snapshot.settings || {};
    const course = snapshot.course || {};
    const race = snapshot.race || {};

    worldW = clamp(parseFloat(world.width) || worldW, 8, WORLD_MAX);
    worldH = clamp(parseFloat(world.height) || worldH, 8, WORLD_MAX);
    gridColsInput.value = String(worldW);
    gridRowsInput.value = String(worldH);

    markCount = clamp(parseInt(course.markCount,10) || markCount, 1, MARK_MAX);
    markCountSelect.value = String(markCount);
    ensureMarkOptions();

    const defaultLayout = defaultCourseLayout(worldW, worldH);
    const defaultMarks = defaultLayout.marks;
    const incomingMarks = Array.isArray(course.marks) ? course.marks : [];
    marks = defaultMarks.map((fallbackMark, idx) => clonePoint(incomingMarks[idx], fallbackMark));

    startA = clonePoint(course.startA, defaultLayout.startA);
    startB = clonePoint(course.startB, defaultLayout.startB);

    finishSeparate = !!settings.finishSeparate;
    finishSeparateSelect.value = finishSeparate ? "yes" : "no";
    finishA = clonePoint(course.finishA, startA);
    finishB = clonePoint(course.finishB, startB);
    if (!finishSeparate){
      finishA = { ...startA };
      finishB = { ...startB };
    }

    gustRect = normalizeGustZone(course.gustRect);

    windAngleDeg = Number.isFinite(settings.windAngleDeg) ? settings.windAngleDeg : windAngleDeg;
    deadZoneDeg = clamp(parseFloat(settings.deadZoneDeg) || deadZoneDeg, 0, 180);
    snapThreshold = clamp(parseFloat(settings.snapThreshold) || snapThreshold, 0, 1);
    movesPerTurn = clamp(parseInt(settings.movesPerTurn,10) || movesPerTurn, 1, 10);
    roundingSide = (settings.roundingSide === "starboard") ? "starboard" : "port";
    playMode = normalizePlayModeValue(settings.playMode);
    interactionMode = normalizeInteractionMode(settings.interactionMode);
    tackPenaltyFactor = clamp(parseFloat(settings.tackPenaltyFactor) || tackPenaltyFactor, 0.5, 1.0);
    autoGustsEnabled = !!settings.autoGustsEnabled;
    autoGustIntervalSec = clamp(parseFloat(settings.autoGustIntervalSec) || autoGustIntervalSec, 3, 60);
    autoGustDurationSec = clamp(parseFloat(settings.autoGustDurationSec) || autoGustDurationSec, 2, 30);
    realtimePrepSeconds = clamp(parseFloat(settings.realtimePrepSeconds) || realtimePrepSeconds, 0, 120);
    autoFullscreenMode = settings.autoFullscreenMode === "race" ? "race" : "off";
    prestartRoundsSetting = Math.max(0, parseInt(settings.prestartRoundsSetting,10) || 0);

    deadZoneInp.value = String(deadZoneDeg);
    snapThresholdInp.value = String(snapThreshold);
    movesPerTurnInp.value = String(movesPerTurn);
    roundingSideSelect.value = roundingSide;
    playModeSelect.value = playMode;
    if (interactionModeSelect) interactionModeSelect.value = interactionMode;
    tackPenaltyInp.value = String(tackPenaltyFactor);
    if (autoGustsSelect) autoGustsSelect.value = autoGustsEnabled ? "on" : "off";
    if (autoGustIntervalInp) autoGustIntervalInp.value = String(autoGustIntervalSec);
    if (autoGustDurationInp) autoGustDurationInp.value = String(autoGustDurationSec);
    if (realtimePrepInp) realtimePrepInp.value = String(realtimePrepSeconds);
    if (autoFullscreenModeSelect) autoFullscreenModeSelect.value = autoFullscreenMode;
    prestartRoundsInp.value = String(prestartRoundsSetting);

    const incomingBoats = Array.isArray(snapshot.boats) ? snapshot.boats : [];
    const previousTrails = boatTrails.map((trail) => Array.isArray(trail) ? trail.map((point) => ({ ...point })) : []);
    const playerCount = clamp(incomingBoats.length || parseInt(playerCountSelect.value,10) || 2, 2, 8);
    playerCountSelect.value = String(playerCount);
    resetBoats();

    boats = [];
    for (let i=0;i<playerCount;i++){
      boats.push(normalizeBoatSnapshot(incomingBoats[i], i));
    }

    phase = (race.phase === "prestart" || race.phase === "countdown" || race.phase === "finished")
      ? race.phase
      : "race";
    prestartRoundsLeft = (phase === "prestart")
      ? Math.max(0, parseInt(race.prestartRoundsLeft,10) || prestartRoundsSetting)
      : 0;
    currentPlayer = clamp(parseInt(race.currentPlayer,10) || 0, 0, boats.length-1);
    raceFinishedCount = Math.max(0, parseInt(race.raceFinishedCount,10) || boats.filter((boat) => boat.finished).length);
    const importedSubMovesLeft = parseInt(race.subMovesLeft,10);
    subMovesLeft = clamp(Number.isFinite(importedSubMovesLeft) ? importedSubMovesLeft : movesPerTurn, 0, movesPerTurn);
    hybridRound = Math.max(1, parseInt(race.hybridRound,10) || 1);
    if (Array.isArray(race.hybridMovesLeft) && race.hybridMovesLeft.length === boats.length){
      hybridMovesLeft = race.hybridMovesLeft.map((value, idx) => {
        if (boats[idx]?.finished) return 0;
        return clamp(parseInt(value,10) || 0, 0, movesPerTurn);
      });
    } else {
      hybridMovesLeft = boats.map((boat) => boat.finished ? 0 : movesPerTurn);
    }
    realtimeCountdownEndsAt = Math.max(0, parseInt(race.realtimeCountdownEndsAt,10) || 0);
    gustExpiresAt = Math.max(0, parseInt(race.gustExpiresAt,10) || 0);
    nextAutoGustAt = Math.max(0, parseInt(race.nextAutoGustAt,10) || 0);
    if (autoGustsEnabled && !gustRect && nextAutoGustAt === 0){
      scheduleNextAutoGust(Date.now());
    }
    const resetTrails = previousTrails.length !== boats.length || phase === "countdown" || phase === "prestart";
    boatTrails = boats.map((boat, index) => {
      const trail = resetTrails ? [] : (previousTrails[index] || []);
      if (!trail.length){
        trail.push({ x: boat.x, y: boat.y });
      } else {
        const last = trail[trail.length - 1];
        if (dist(last, boat) >= 0.18){
          trail.push({ x: boat.x, y: boat.y });
        } else {
          last.x = boat.x;
          last.y = boat.y;
        }
      }
      if (trail.length > 600){
        trail.splice(0, trail.length - 600);
      }
      return trail;
    });

    selectedBoatIndex = null;
    placementSelectedBoat = null;
    startAwaitSecond = false;
    finishAwaitSecond = false;
    localRealtimeLastTickAt = 0;
    if (!isRealtimePlayMode()){
      realtimeCursorTarget = null;
      realtimeCursorDirection = null;
      activeRealtimePointerId = null;
    }

    ensureScenarioLegOptions();
    ensureNextPlayerOptions();
    renderBoatTuningControls();
    updateFinishButtonEnabled();
    updateInteractionModeInfo();
    updateResetButtonLabel();
    updateViewButtons();
    updateWindInfo();
    invalidateSolutions();
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
  }

  function fingerprintGameState(){
    return JSON.stringify(exportGameState());
  }

  function applyWorldSize(){
    const w = parseFloat(gridColsInput.value);
    const h = parseFloat(gridRowsInput.value);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    if (w < 8 || h < 8 || w > WORLD_MAX || h > WORLD_MAX) return;

    worldW = w;
    worldH = h;

    cellLikeDefaultPlacement();
    resizeBoardCanvas({ preserveView:false, resetView:true });

    resetBoats();
    ensureScenarioLegOptions();

    render();
  }

  // -----------------------------
  // Отрисовка
  // -----------------------------
  function drawField(){
    const tl = fieldTopLeft();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.strokeRect(tl.x, tl.y, fieldPixelW(), fieldPixelH());
  }

  function drawWindArrow(){
    const base = worldToScreen({ x: worldW/2, y: worldH - 0.6 });
    const len = 55;

    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.rotate(windAngleDeg * Math.PI/180);

    ctx.strokeStyle = "#d32f2f";
    ctx.fillStyle = "#d32f2f";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(0, -len/2);
    ctx.lineTo(0,  len/2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, len/2);
    ctx.lineTo(-9, len/2 - 14);
    ctx.lineTo( 9, len/2 - 14);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawLine(aW, bW, color, dash){
    const a = worldToScreen(aW);
    const b = worldToScreen(bW);
    ctx.save();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x,a.y);
    ctx.lineTo(b.x,b.y);
    ctx.stroke();
    ctx.restore();
  }

  function laylineCourseVectors(){
    const base = upwindVec();
    const half = Math.max(5, deadZoneDeg / 2) * Math.PI / 180;
    return [
      rotateVec(base, half),
      rotateVec(base, -half)
    ];
  }

  function drawLaylineRay(anchor, dirUnit, color){
    const far = clampAlongRayToField(anchor, dirUnit, Math.hypot(worldW, worldH) * 2);
    const back = clampAlongRayToField(anchor, { x:-dirUnit.x, y:-dirUnit.y }, Math.hypot(worldW, worldH) * 2);
    drawLine(back, far, color, [10, 8]);
  }

  function drawLaylineBundle(anchor, color){
    const laylines = laylineCourseVectors();
    for (const vec of laylines){
      drawLaylineRay(anchor, { x:-vec.x, y:-vec.y }, color);
    }
  }

  function drawLaylines(){
    if (!showLaylines) return;

    for (let i=0;i<markCount;i++){
      drawLaylineBundle(marks[i], "rgba(255, 112, 67, 0.58)");
      const p = worldToScreen(marks[i]);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 112, 67, 0.24)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, ROUND_PASS_RADIUS * PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawLaylineBundle(startA, "rgba(23, 48, 66, 0.42)");
    drawLaylineBundle(startB, "rgba(23, 48, 66, 0.42)");

    if (finishSeparate){
      drawLaylineBundle(finishA, "rgba(47, 125, 50, 0.42)");
      drawLaylineBundle(finishB, "rgba(47, 125, 50, 0.42)");
    }
  }

  function drawStartLine(){ drawLine(startA, startB, "#000", [8,8]); }
  function drawFinishLine(){ if (!finishSeparate) return; drawLine(finishA, finishB, "#1b5e20", [10,6]); }

  function drawCommitteeBoatAtScreen(x,y, lineAngleRad){
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lineAngleRad);

    const hullL = Math.max(30, PX*1.2);
    const hullH = Math.max(14, PX*0.55);

    ctx.fillStyle = "#455a64";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(0, -hullH/2);
    ctx.lineTo(hullL*0.75, -hullH/2);
    ctx.lineTo(hullL, 0);
    ctx.lineTo(hullL*0.75, hullH/2);
    ctx.lineTo(0, hullH/2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#90a4ae";
    ctx.beginPath();
    ctx.rect(hullL*0.20, -hullH*0.45, hullL*0.30, hullH*0.60);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hullL*0.35, -hullH*0.45);
    ctx.lineTo(hullL*0.35, -hullH*1.6);
    ctx.stroke();

    ctx.fillStyle = "#d32f2f";
    ctx.beginPath();
    ctx.moveTo(hullL*0.35, -hullH*1.6);
    ctx.lineTo(hullL*0.55, -hullH*1.45);
    ctx.lineTo(hullL*0.35, -hullH*1.30);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawCommitteeBoatsOnLine(aW,bW, drawLeft, drawRight){
    const a = worldToScreen(aW);
    const b = worldToScreen(bW);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ang = Math.atan2(dy, dx);

    let left = a, right = b;
    if (a.x > b.x){ left = b; right = a; }

    if (drawLeft)  drawCommitteeBoatAtScreen(left.x,  left.y,  ang);
    if (drawRight) drawCommitteeBoatAtScreen(right.x, right.y, ang);
  }

  function drawMarks(){
    for (let i=0;i<markCount;i++){
      const m = marks[i];
      const p = worldToScreen(m);
      ctx.fillStyle = "#ff7043";
      ctx.beginPath();
      ctx.arc(p.x,p.y, Math.max(8, PX*0.25), 0, Math.PI*2);
      ctx.fill();

      ctx.fillStyle="#fff";
      ctx.font = `bold ${Math.max(10, PX*0.35)}px system-ui`;
      ctx.textAlign="center";
      ctx.textBaseline="middle";
      ctx.fillText(String(i+1), p.x, p.y);
    }
  }

  function drawGust(){
    const zone = normalizeGustZone(gustRect);
    if (!zone) return;

    const center = worldToScreen({ x: zone.cx, y: zone.cy });
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(zone.angle);
    ctx.fillStyle = "rgba(100,150,255,0.22)";
    ctx.strokeStyle = "rgba(100,150,255,0.68)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, zone.rx * PX, zone.ry * PX, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(-zone.rx * PX * 0.75, 0);
    ctx.lineTo(zone.rx * PX * 0.75, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawTrails(){
    if (!showTrails) return;
    for (let i=0; i<boatTrails.length; i++){
      const trail = boatTrails[i];
      if (!Array.isArray(trail) || trail.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = rgbaHex(boats[i]?.color || BOAT_COLORS[i % BOAT_COLORS.length], 0.34);
      ctx.lineWidth = Math.max(2, PX * 0.08);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const start = worldToScreen(trail[0]);
      ctx.moveTo(start.x, start.y);
      for (let j=1; j<trail.length; j++){
        const point = worldToScreen(trail[j]);
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Large top-down yacht icon with a clear bow orientation.
  function drawYachtIcon(size, color, tack){
    const sailSide = (tack === -1) ? -1 : 1;
    const hullColor = mixHexColor(color, "black", 0.12);
    const deckColor = mixHexColor(color, "white", 0.55);
    const trimColor = mixHexColor(color, "white", 0.20);
    const sailShade = rgbaHex(color, 0.22);
    const wakeColor = rgbaHex(color, 0.14);
    const outlineColor = "#142133";

    ctx.save();
    ctx.scale(size / 24, size / 24);

    ctx.fillStyle = wakeColor;
    ctx.beginPath();
    ctx.moveTo(-5.8, 10.2);
    ctx.quadraticCurveTo(-2.6, 13.5, 0.0, 12.4);
    ctx.quadraticCurveTo(2.6, 13.5, 5.8, 10.2);
    ctx.quadraticCurveTo(2.5, 11.8, 0.0, 11.6);
    ctx.quadraticCurveTo(-2.5, 11.8, -5.8, 10.2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = hullColor;
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0.0, -11.1);
    ctx.bezierCurveTo(4.8, -8.8, 5.7, -2.0, 5.4, 6.8);
    ctx.quadraticCurveTo(4.4, 10.2, 0.0, 11.3);
    ctx.quadraticCurveTo(-4.4, 10.2, -5.4, 6.8);
    ctx.bezierCurveTo(-5.7, -2.0, -4.8, -8.8, 0.0, -11.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = deckColor;
    ctx.beginPath();
    ctx.moveTo(0.0, -8.2);
    ctx.bezierCurveTo(2.9, -6.7, 3.4, -1.4, 3.2, 5.1);
    ctx.quadraticCurveTo(2.5, 7.7, 0.0, 8.4);
    ctx.quadraticCurveTo(-2.5, 7.7, -3.2, 5.1);
    ctx.bezierCurveTo(-3.4, -1.4, -2.9, -6.7, 0.0, -8.2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = trimColor;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(0.0, -7.5);
    ctx.lineTo(0.0, 8.1);
    ctx.moveTo(-2.2, 4.2);
    ctx.lineTo(2.2, 4.2);
    ctx.stroke();

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0.0, -8.8);
    ctx.lineTo(0.0, 6.3);
    ctx.stroke();

    ctx.save();
    ctx.scale(sailSide, 1);

    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.strokeStyle = "rgba(15,23,42,0.20)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0.0, -8.2);
    ctx.lineTo(0.0, 3.0);
    ctx.quadraticCurveTo(7.6, 1.0, 5.3, -6.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = sailShade;
    ctx.beginPath();
    ctx.moveTo(-0.1, -5.1);
    ctx.lineTo(-0.1, 4.8);
    ctx.quadraticCurveTo(-4.3, 3.5, -3.0, -3.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.beginPath();
    ctx.moveTo(0.0, -8.8);
    ctx.lineTo(2.4, -8.0);
    ctx.lineTo(0.0, -7.2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    ctx.fillStyle = mixHexColor(color, "black", 0.24);
    ctx.beginPath();
    ctx.moveTo(-0.8, 7.5);
    ctx.lineTo(0.8, 7.5);
    ctx.lineTo(0.45, 10.2);
    ctx.lineTo(-0.45, 10.2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawBoats(){
    for (let i=0;i<boats.length;i++){
      const b = boats[i];
      const p = worldToScreen({x:b.x,y:b.y});

      ctx.save();
      ctx.translate(p.x,p.y);

      let ang = 0;
      if (b.hasHeading){
        const vx = Math.cos(b.heading);
        const vy = -Math.sin(b.heading);
        ang = Math.atan2(vy, vx) + Math.PI/2;
      }
      ctx.rotate(ang);

      const size = clamp(PX * 1.6, 10, 72);
      drawYachtIcon(size, b.color, b.tack);

      ctx.rotate(-ang);
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = Math.max(2, size*0.07);
      ctx.fillStyle = "#102033";
      ctx.font = `700 ${Math.max(11, size*0.28)}px system-ui`;
      ctx.textAlign="center";
      ctx.textBaseline="middle";
      ctx.strokeText(String(i+1), 0, size*0.05);
      ctx.fillText(String(i+1), 0, size*0.05);

      if (b.finished){
        ctx.strokeStyle = "#00c853";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0,0, Math.max(15, size*0.78), 0, Math.PI*2);
        ctx.stroke();
      }

      if ((mode === "boats" || mode === "model") && placementSelectedBoat === i){
        ctx.strokeStyle = "#1976d2";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0,0, Math.max(17, size*0.90), 0, Math.PI*2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  function drawCapsuleOverlay(capsule, fillStyle, strokeStyle, extraRadius=0){
    const a = worldToScreen(capsule.a);
    const b = worldToScreen(capsule.b);
    const r = (capsule.r + extraRadius) * PX;

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = fillStyle;
    ctx.lineWidth = Math.max(4, r * 2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoatPlacementOverlay(){
    if (mode !== "boats" && mode !== "model") return;

    ctx.save();

    ctx.fillStyle = "rgba(0, 200, 0, 0.10)";
    ctx.strokeStyle = "rgba(0, 200, 0, 0.30)";
    ctx.lineWidth = 2;

    const tl = fieldTopLeft();

    if (mode === "model"){
      ctx.fillRect(tl.x, tl.y, fieldPixelW(), fieldPixelH());
      ctx.strokeRect(tl.x, tl.y, fieldPixelW(), fieldPixelH());
    } else {
      const A = startA, B = startB;
      const a = worldToScreen(A);
      const b = worldToScreen(B);

      if (prestartRoundsSetting > 0 && phase === "prestart"){
        const n = prestartNormalUnit();
        const A2 = { x:A.x + n.x*PRESTART_DEPTH, y:A.y + n.y*PRESTART_DEPTH };
        const B2 = { x:B.x + n.x*PRESTART_DEPTH, y:B.y + n.y*PRESTART_DEPTH };

        const a2 = worldToScreen(A2);
        const b2 = worldToScreen(B2);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        const thickness = START_PICK_TOL * PX;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const L = Math.hypot(dx,dy) || 1;
        const nx = -dy/L;
        const ny = dx/L;

        const p1 = { x:a.x + nx*thickness, y:a.y + ny*thickness };
        const p2 = { x:b.x + nx*thickness, y:b.y + ny*thickness };
        const p3 = { x:b.x - nx*thickness, y:b.y - ny*thickness };
        const p4 = { x:a.x - nx*thickness, y:a.y - ny*thickness };

        ctx.beginPath();
        ctx.moveTo(p1.x,p1.y);
        ctx.lineTo(p2.x,p2.y);
        ctx.lineTo(p3.x,p3.y);
        ctx.lineTo(p4.x,p4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(255, 0, 0, 0.10)";
    ctx.strokeStyle = "rgba(255, 0, 0, 0.25)";
    ctx.lineWidth = 1.5;

    for (let i=0;i<boats.length;i++){
      if (placementSelectedBoat === i) continue;
      drawCapsuleOverlay(
        boatCapsuleForIndex(i),
        "rgba(255, 0, 0, 0.18)",
        "rgba(255, 0, 0, 0.30)",
        BOAT_CLEARANCE_MARGIN
      );
    }

    for (let i=0;i<markCount;i++){
      const p = worldToScreen(marks[i]);
      const r = (MARK_RADIUS + BOAT_COLLISION_RADIUS + MARK_CLEARANCE_MARGIN) * PX;
      ctx.beginPath();
      ctx.arc(p.x,p.y,r,0,Math.PI*2);
      ctx.fill(); ctx.stroke();
    }

    ctx.restore();
  }

  function drawMoveOverlay(){
    if (mode !== "play") return;
    if (selectedBoatIndex === null) return;
    const b = boats[selectedBoatIndex];
    if (!b || b.finished) return;

    const baseFactor = boatSpeedCoeff(b) * (pointInGust({x:b.x,y:b.y}) ? GUST_MULT : 1.0);
    const baseR = STEP_RADIUS_BASE * baseFactor;

    const center = worldToScreen({x:b.x,y:b.y});
    const Rp = baseR * PX;

    ctx.fillStyle = "rgba(0, 200, 0, 0.08)";
    ctx.strokeStyle = "rgba(0, 200, 0, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, Rp, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    const uw = upwindVec();
    const ux = uw.x;
    const uy = -uw.y;
    const baseAng = Math.atan2(uy, ux);
    const half = (deadZoneDeg * Math.PI/180)/2;

    if (deadZoneDeg > 0){
      ctx.fillStyle = "rgba(255, 0, 0, 0.14)";
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.arc(center.x, center.y, Rp, baseAng - half, baseAng + half, false);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.font = "12px system-ui";
    ctx.textAlign="center";
    ctx.textBaseline="bottom";
    const tips = [];
    tips.push(`Огибание: ${roundingSide==="port" ? "знак слева" : "знак справа"}, зона: ${ROUND_PASS_RADIUS.toFixed(2)}`);
    if (pointInGust({x:b.x,y:b.y})) tips.push("Порыв: +дальность");
    tips.push(`Скорость: ×${boatSpeedCoeff(b).toFixed(2)}`);
    if (tackPenaltyFactor < 1.0) tips.push(`Штраф смены галса: ×${tackPenaltyFactor.toFixed(2)}`);
    tips.push(`Дотягивание: ${snapThreshold.toFixed(2)}R`);
    tips.push(`Лодки: ${interactionModeLabel()}`);
    ctx.fillText(tips.join(" | "), center.x, center.y - Rp - 6);
  }

  function drawOptimalPath(){
    if (showOptimal && optimalPath && optimalPath.length >= 2){
      ctx.save();
      ctx.strokeStyle = "rgba(25, 118, 210, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      const p0 = worldToScreen(optimalPath[0]);
      ctx.moveTo(p0.x,p0.y);
      for (let i=1;i<optimalPath.length;i++){
        const p = worldToScreen(optimalPath[i]);
        ctx.lineTo(p.x,p.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (showBestStart && bestStartSolution){
      const path = bestStartSolution.path;
      if (path && path.length >= 2){
        ctx.save();
        ctx.strokeStyle = "rgba(46, 125, 50, 0.85)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        const p0 = worldToScreen(path[0]);
        ctx.moveTo(p0.x,p0.y);
        for (let i=1;i<path.length;i++){
          const p = worldToScreen(path[i]);
          ctx.lineTo(p.x,p.y);
        }
        ctx.stroke();
        ctx.restore();
      }

      const sp = worldToScreen(bestStartSolution.start);
      ctx.save();
      ctx.fillStyle = "rgba(46,125,50,0.90)";
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(6, PX*0.18), 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = "#0d3b14";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawRealtimeHudPanel(){
    if (!isRealtimePlayMode() || mode !== "play") return;

    const boatIdx = realtimeControlledBoatIndex();
    const boat = Number.isInteger(boatIdx) ? boats[boatIdx] : null;
    if (!boat) return;

    const courseDeg = boatCourseToWindDeg(boat);
    const speedMps = boatRealtimeSpeedMps(boat);
    const reverse = (Number.isFinite(boat.currentSpeedUnitsPerSec) ? boat.currentSpeedUnitsPerSec : 0) < -1e-6;
    const lines = [
      `Лодка ${boatIdx + 1}`,
      `Острота к ветру: ${courseDeg === null ? "—" : `${courseDeg.toFixed(0)}°`}`,
      `Скорость: ${speedMps.toFixed(1)} м/с`,
      `Галс: ${boatTackLabel(boat)}`,
      `Пройдено: ${formatMeters(boat.distance || 0)}`,
      `Знаки: ${Math.min(boat.nextMark || 0, markCount)} / ${markCount}`
    ];

    if (reverse){
      lines.push("Режим: задний ход 10%");
    } else if ((Number.isFinite(boat.penaltySlowUntil) ? boat.penaltySlowUntil : 0) > currentRaceTimeMs()){
      lines.push("Штраф: замедление");
    }

    ctx.save();
    const boxX = 18;
    const boxY = 18;
    const boxW = 320;
    const boxH = 30 + lines.length * 18;
    ctx.fillStyle = "rgba(255, 253, 248, 0.90)";
    ctx.strokeStyle = rgbaHex(boat.color, 0.55);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#173042";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "700 15px system-ui";
    ctx.fillText(lines[0], boxX + 14, boxY + 12);
    ctx.font = "600 13px system-ui";
    for (let i=1; i<lines.length; i++){
      ctx.fillText(lines[i], boxX + 14, boxY + 12 + i * 18);
    }
    ctx.restore();
  }

  function drawRealtimeOverlay(){
    if (isRealtimePlayMode() && mode === "play" && (realtimeCursorTarget || realtimeCursorDirection)){
      const boatIdx = realtimeControlledBoatIndex();
      const boat = Number.isInteger(boatIdx) ? boats[boatIdx] : null;
      if (boat){
        const start = worldToScreen({ x: boat.x, y: boat.y });
        const visualTarget = clampAlongRayToField(
          { x: boat.x, y: boat.y },
          realtimeCursorDirection || { x: 1, y: 0 },
          Math.max(worldW, worldH) * 2
        );
        const target = worldToScreen(visualTarget);
        ctx.save();
        ctx.strokeStyle = rgbaHex(boat.color, 0.45);
        ctx.fillStyle = rgbaHex(boat.color, 0.9);
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(target.x, target.y, Math.max(5, PX * 0.12), 0, Math.PI * 2);
        ctx.fill();
        if (realtimeCursorTarget){
          const pointerTarget = worldToScreen(realtimeCursorTarget);
          ctx.beginPath();
          ctx.arc(pointerTarget.x, pointerTarget.y, Math.max(4, PX * 0.09), 0, Math.PI * 2);
          ctx.fillStyle = rgbaHex(boat.color, 0.35);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    drawRealtimeHudPanel();

    const countdown = realtimeCountdownState();
    if (!countdown.active) return;

    const primary = `До старта ${formatCountdownSeconds(countdown.totalMsLeft)} с`;
    const secondary = "Фальстарт считается только в последние 3.0 с до старта";
    const boxW = 340;
    const boxH = 68;
    const boxX = (canvas.width - boxW) / 2;
    const boxY = 18;
    ctx.save();
    ctx.fillStyle = "rgba(255, 253, 248, 0.94)";
    ctx.strokeStyle = "rgba(23, 48, 66, 0.12)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#173042";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "700 24px Georgia, serif";
    ctx.fillText(primary, canvas.width / 2, boxY + 12);
    ctx.font = "600 14px system-ui";
    ctx.fillStyle = "rgba(23, 48, 66, 0.78)";
    ctx.fillText(secondary, canvas.width / 2, boxY + 42);
    ctx.restore();
  }

  function render(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);

    drawField();
    drawGust();
    drawLaylines();

    drawStartLine();
    drawCommitteeBoatsOnLine(startA, startB, false, true);

    drawFinishLine();
    if (finishSeparate){
      drawCommitteeBoatsOnLine(finishA, finishB, true, true);
    }

    drawMarks();
    drawWindArrow();

    drawBoatPlacementOverlay();
    drawMoveOverlay();

    drawOptimalPath();
    drawTrails();
    drawBoats();
    drawRealtimeOverlay();
  }

  // -----------------------------
  // Клики по canvas
  // -----------------------------
  function updateRealtimeIntentFromClient(clientX, clientY){
    if (mode !== "play" || !isRealtimePlayMode()) return;
    const boatIdx = realtimeControlledBoatIndex();
    if (!Number.isInteger(boatIdx) || !boats[boatIdx] || boats[boatIdx].finished || phase === "finished"){
      clearRealtimeIntent();
      return;
    }
    const point = screenToWorld(clientX, clientY);
    if (!point){
      clearRealtimeIntent();
      return;
    }
    const boat = boats[boatIdx];
    const aim = { x: point.x - boat.x, y: point.y - boat.y };
    const direction = norm(aim);
    if (direction.L <= 1e-6){
      clearRealtimeIntent();
      return;
    }
    setRealtimeIntent(point, { x: direction.x, y: direction.y });
  }

  function resetRealtimePointer(pointerId=null){
    if (pointerId === null || activeRealtimePointerId === pointerId){
      activeRealtimePointerId = null;
      clearRealtimeIntent();
    }
  }

  canvas.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey){
      e.preventDefault();
      const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      setZoom(zoom * zoomFactor, e.clientX, e.clientY);
      render();
      return;
    }

    if (e.deltaX === 0 && e.deltaY === 0) return;
    e.preventDefault();

    let deltaX = -e.deltaX;
    let deltaY = -e.deltaY;
    if (e.shiftKey && Math.abs(e.deltaX) < 0.01){
      deltaX = -e.deltaY;
      deltaY = 0;
    }

    panCameraBy(deltaX, deltaY);
    render();
  }, { passive:false });

  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "play" || !isRealtimePlayMode()) return;
    const point = screenToWorld(e.clientX, e.clientY);
    if (isLocalRealtimeMode() && point){
      const hitBoat = getBoatAtPoint(point);
      if (hitBoat >= 0 && !boats[hitBoat]?.finished){
        selectedBoatIndex = hitBoat;
        clearRealtimeIntent();
        updateStatus();
        updateStats();
        render();
        e.preventDefault();
        return;
      }
    }
    if (e.pointerType !== "mouse"){
      activeRealtimePointerId = e.pointerId;
      canvas.setPointerCapture?.(e.pointerId);
    }
    updateRealtimeIntentFromClient(e.clientX, e.clientY);
    render();
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (mode !== "play" || !isRealtimePlayMode()) return;
    if (e.pointerType === "mouse" || activeRealtimePointerId === e.pointerId){
      updateRealtimeIntentFromClient(e.clientX, e.clientY);
      render();
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!isRealtimePlayMode()) return;
    if (e.pointerType !== "mouse"){
      resetRealtimePointer(e.pointerId);
      render();
    }
  });

  canvas.addEventListener("pointercancel", (e) => {
    if (!isRealtimePlayMode()) return;
    resetRealtimePointer(e.pointerId);
    render();
  });

  canvas.addEventListener("mouseleave", () => {
    if (!isRealtimePlayMode()) return;
    resetRealtimePointer();
    render();
  });

  canvas.addEventListener("click", (e) => {
    if (mode === "play" && isRealtimePlayMode()) return;
    const p = screenToWorld(e.clientX, e.clientY);
    if (!p) return;

    if (mode === "marks"){
      const idx = parseInt(markToEditSelect.value,10);
      marks[idx] = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
      invalidateSolutions();
      updateStatus();
      updateOptInfo();
      render();
      return;
    }

    if (mode === "start"){
      if (!startAwaitSecond){
        startA = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
        startB = { ...startA };
        startAwaitSecond = true;
      } else {
        startB = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
        startAwaitSecond = false;

        if (!finishSeparate){
          finishA = { ...startA };
          finishB = { ...startB };
        }
        resetBoats();
      }
      ensureScenarioLegOptions();
      invalidateSolutions();
      updateStatus();
      updateStats();
      updateOptInfo();
      render();
      return;
    }

    if (mode === "finish"){
      if (!finishSeparate) return;

      if (!finishAwaitSecond){
        finishA = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
        finishB = { ...finishA };
        finishAwaitSecond = true;
      } else {
        finishB = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
        finishAwaitSecond = false;
      }
      invalidateSolutions();
      updateStatus();
      updateOptInfo();
      render();
      return;
    }

    if (mode === "boats"){
      const bi = getBoatAtPoint(p);
      if (bi >= 0){
        placementSelectedBoat = bi;
        render();
        return;
      }

      if (placementSelectedBoat !== null){
        let dest = null;

        if (prestartRoundsSetting > 0 && phase === "prestart"){
          if (pointInPrestartZone(p)) dest = p;
        } else {
          const info = pointToSegment(p, startA, startB);
          if (info.d <= START_PICK_TOL) dest = info.proj;
        }

        if (dest){
          if (!isTooCloseToMarks(dest) && !isTooCloseToBoats(dest, placementSelectedBoat)){
            const b = boats[placementSelectedBoat];
            b.x = dest.x;
            b.y = dest.y;
            b.hasHeading = false;
            b.heading = 0;
            b.tack = 0;
            b.roundInZone = false;
            b.roundSweep = 0;
          }
        }

        placementSelectedBoat = null;
        invalidateSolutions();
        updateStats();
        updateOptInfo();
        render();
      }
      return;
    }

    if (mode === "model"){
      const bi = getBoatAtPoint(p);
      if (bi >= 0){
        placementSelectedBoat = bi;
        render();
        return;
      }

      if (placementSelectedBoat !== null){
        const dest = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };

        if (!isTooCloseToMarks(dest) && !isTooCloseToBoats(dest, placementSelectedBoat)){
          const b = boats[placementSelectedBoat];
          b.x = dest.x;
          b.y = dest.y;
          b.hasHeading = false;
          b.heading = 0;
          b.tack = 0;
          b.roundInZone = false;
          b.roundSweep = 0;
        }

        placementSelectedBoat = null;
        invalidateSolutions();
        updateStats();
        updateOptInfo();
        render();
      }
      return;
    }

    // play
    const clickedBoat = getBoatAtPoint(p);

    if (clickedBoat >= 0 && canSelectBoatForPlay(clickedBoat)){
      selectedBoatIndex = clickedBoat;
      render();
      return;
    }

    if (selectedBoatIndex !== null && canSelectBoatForPlay(selectedBoatIndex)){
      const dest = proposeDestination(selectedBoatIndex, p);
      if (dest){
        performMove(selectedBoatIndex, dest);
        maybeStartGunIfNeeded();
        invalidateSolutions();
        updateStatus();
        updateStats();
        updateOptInfo();
      } else {
        render();
      }
    }
  });

  // -----------------------------
  // UI события
  // -----------------------------
  btnModePlay.addEventListener("click", () => setMode("play"));
  btnModeMarks.addEventListener("click", () => setMode("marks"));
  btnModeStart.addEventListener("click", () => { startAwaitSecond=false; setMode("start"); });
  btnModeFinish.addEventListener("click", () => { finishAwaitSecond=false; setMode("finish"); });
  btnModeBoats.addEventListener("click", () => setMode("boats"));
  btnModeModel.addEventListener("click", () => { ensureNextPlayerOptions(); setMode("model"); });

  btnResumeFromModel.addEventListener("click", async () => {
    await requestBoardFullscreenIfAuto();
    const v = scenarioLegSelect.value;
    let nm = 0;
    if (v.startsWith("to")) nm = parseInt(v.slice(2),10);
    nm = clamp(nm, 0, markCount);

    for (const b of boats){
      b.nextMark = nm;
      b.distance = 0;
      b.turns = 0;
      b.penalties = 0;
      b.collisions = 0;
      b.finished = false;
      b.place = null;
      b.hasHeading = false;
      b.heading = 0;
      b.tack = 0;
      b.currentSpeedUnitsPerSec = 0;
      b.penaltySlowUntil = 0;
      b.lastPenaltyAt = 0;
      b.lastPenaltyKey = "";
      b.lastPenaltyReason = "";

      b.roundInZone = false;
      b.roundSweep = 0;
    }
    raceFinishedCount = 0;

    phase = "race";
    prestartRoundsLeft = 0;

    currentPlayer = clamp(parseInt(nextPlayerSelect.value,10) || 0, 0, boats.length-1);
    subMovesLeft = movesPerTurn;
    ensureNextPlayerOptions();

    invalidateSolutions();
    setMode("play");
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
  });

  markCountSelect.addEventListener("change", () => {
    markCount = parseInt(markCountSelect.value,10);
    for (const b of boats){
      b.nextMark = clamp(b.nextMark, 0, markCount);
      b.roundInZone = false;
      b.roundSweep = 0;
    }
    ensureMarkOptions();
    ensureScenarioLegOptions();
    invalidateSolutions();
    updateOptInfo();
    render();
  });

  roundingSideSelect.addEventListener("change", () => {
    roundingSide = roundingSideSelect.value;
    invalidateSolutions();
    updateOptInfo();
    render();
  });

  playModeSelect.addEventListener("change", () => {
    playMode = normalizePlayModeValue(playModeSelect.value);
    resetHybridState();
    selectedBoatIndex = null;
    realtimeCountdownEndsAt = 0;
    localRealtimeLastTickAt = 0;
    clearRealtimeIntent();
    if (isLocalRealtimeMode()){
      setRealtimeReadyState();
    }
    updateResetButtonLabel();
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  interactionModeSelect?.addEventListener("change", () => {
    interactionMode = normalizeInteractionMode(interactionModeSelect.value);
    invalidateSolutions();
    updateInteractionModeInfo();
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  finishSeparateSelect.addEventListener("change", () => {
    finishSeparate = (finishSeparateSelect.value === "yes");
    if (!finishSeparate){
      finishA = { ...startA };
      finishB = { ...startB };
    }
    invalidateSolutions();
    updateFinishButtonEnabled();
    updateOptInfo();
    render();
  });

  prestartRoundsInp.addEventListener("change", () => {
    prestartRoundsSetting = Math.max(0, parseInt(prestartRoundsInp.value,10) || 0);
    resetBoats();
    invalidateSolutions();
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
  });

  playerCountSelect.addEventListener("change", () => {
    resetBoats();
    invalidateSolutions();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  deadZoneInp.addEventListener("change", () => {
    deadZoneDeg = clamp(parseFloat(deadZoneInp.value)||0, 0, 180);
    invalidateSolutions();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  snapThresholdInp.addEventListener("change", () => {
    snapThreshold = clamp(parseFloat(snapThresholdInp.value)||0.8, 0, 1);
    render();
    emitStateChanged();
  });

  movesPerTurnInp.addEventListener("change", () => {
    applyMovesPerTurnSetting(movesPerTurnInp.value);
    updateStatus();
    render();
  });

  tackPenaltyInp.addEventListener("change", () => {
    tackPenaltyFactor = clamp(parseFloat(tackPenaltyInp.value)||0.95, 0.5, 1.0);
    invalidateSolutions();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  autoGustsSelect?.addEventListener("change", () => {
    autoGustsEnabled = autoGustsSelect.value === "on";
    if (autoGustsEnabled){
      if (!gustRect){
        scheduleNextAutoGust(Date.now());
      }
    } else {
      nextAutoGustAt = 0;
      gustExpiresAt = gustRect ? gustExpiresAt : 0;
    }
    updateWindInfo();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  autoGustIntervalInp?.addEventListener("change", () => {
    autoGustIntervalSec = clamp(parseFloat(autoGustIntervalInp.value) || 10, 3, 60);
    autoGustIntervalInp.value = String(autoGustIntervalSec);
    if (autoGustsEnabled && !gustRect){
      scheduleNextAutoGust(Date.now());
    }
    updateWindInfo();
    emitStateChanged();
  });

  autoGustDurationInp?.addEventListener("change", () => {
    autoGustDurationSec = clamp(parseFloat(autoGustDurationInp.value) || 6, 2, 30);
    autoGustDurationInp.value = String(autoGustDurationSec);
    if (gustRect){
      gustExpiresAt = Date.now() + autoGustDurationSec * 1000;
    }
    updateWindInfo();
    emitStateChanged();
  });

  autoFullscreenModeSelect?.addEventListener("change", async () => {
    autoFullscreenMode = autoFullscreenModeSelect.value === "race" ? "race" : "off";
    if (!shouldAutoFullscreen()){
      await exitBoardFullscreen();
    } else if (phaseIsRaceVisible(phase)) {
      await requestBoardFullscreen();
    }
    updateViewButtons();
    render();
    emitStateChanged();
  });

  btnWindLeft.addEventListener("click", () => {
    windAngleDeg -= WIND_STEP;
    updateWindInfo();
    invalidateSolutions();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  btnWindRight.addEventListener("click", () => {
    windAngleDeg += WIND_STEP;
    updateWindInfo();
    invalidateSolutions();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  btnGust.addEventListener("click", () => {
    spawnGust();
    if (autoGustsEnabled){
      nextAutoGustAt = 0;
    }
    updateWindInfo();
    invalidateSolutions();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  btnClearGust.addEventListener("click", () => {
    clearGust({ keepSchedule:autoGustsEnabled });
    if (autoGustsEnabled){
      scheduleNextAutoGust(Date.now());
    }
    updateWindInfo();
    invalidateSolutions();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  btnOptimal.addEventListener("click", () => {
    if (mode !== "play") setMode("play");
    const targetBoat = (isHybridRaceMode() && multiplayerSeatIndex !== null)
      ? multiplayerSeatIndex
      : currentPlayer;

    if (showOptimal && optimalForBoat === targetBoat){
      showOptimal = false;
      optimalPath = [];
      optimalStats = null;
      optimalForBoat = null;
      updateOptInfo();
      render();
      return;
    }

    computeOptimalForBoat(targetBoat);
    showOptimal = true;
    updateOptInfo();
    render();
  });

  realtimePrepInp?.addEventListener("change", () => {
    realtimePrepSeconds = clamp(parseFloat(realtimePrepInp.value) || 12, 0, 120);
    realtimePrepInp.value = String(realtimePrepSeconds);
    emitStateChanged();
  });

  btnBestStart.addEventListener("click", () => {
    if (showBestStart){
      showBestStart = false;
      bestStartSolution = null;
      updateOptInfo();
      render();
      return;
    }
    computeBestStart();
    showBestStart = true;
    updateOptInfo();
    render();
  });

  btnLaylines?.addEventListener("click", () => {
    showLaylines = !showLaylines;
    updateViewButtons();
    render();
  });

  btnTrails?.addEventListener("click", () => {
    showTrails = !showTrails;
    if (showTrails && (!boatTrails.length || boatTrails.length !== boats.length)){
      resetBoatTrails();
    }
    updateViewButtons();
    render();
  });

  btnFullscreen?.addEventListener("click", async () => {
    try {
      if (isFullscreenActive()){
        await exitBoardFullscreen();
      } else {
        await requestBoardFullscreen();
      }
    } finally {
      updateViewButtons();
      render();
    }
  });

  btnBoardStart?.addEventListener("click", async () => {
    await triggerBoardStartAction();
  });

  document.addEventListener("fullscreenchange", () => {
    updateViewButtons();
    resizeBoardCanvas({ preserveView:true });
  });

  window.addEventListener("resize", () => {
    resizeBoardCanvas({ preserveView:true });
  });

  boatTuningEl?.addEventListener("change", (event) => {
    const input = event.target?.closest?.("[data-boat-speed]");
    if (!input) return;
    const idx = parseInt(input.dataset.boatSpeed, 10);
    if (!Number.isInteger(idx) || !boats[idx]) return;
    boats[idx].speedCoeff = clamp(parseFloat(input.value) || 1, 0.5, 1.8);
    input.value = boatSpeedCoeff(boats[idx]).toFixed(2);
    invalidateSolutions();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  // Новая гонка: не сбрасывает дистанцию — только лодки
  btnReset.addEventListener("click", async () => {
    await handleResetAction();
  });

  applyGridBtn.addEventListener("click", () => {
    applyWorldSize();
    invalidateSolutions();
    updateStatus();
    updateStats();
    updateOptInfo();
  });

  window.RegattaApp = {
    exportState: exportGameState,
    importState: importGameState,
    fingerprintState: fingerprintGameState,
    render,
    setMode,
    requestBoardFullscreenIfAuto,
    requestBoardFullscreen,
    exitBoardFullscreen,
    isBoardFullscreenActive: isFullscreenActive,
    setServerClockOffset,
    setBoardStartActionOverride,
    triggerBoardStartAction,
    setMultiplayerContext: ({ seatIndex=null } = {}) => {
      multiplayerSeatIndex = Number.isInteger(seatIndex) ? seatIndex : null;
      localRealtimeLastTickAt = 0;
      const candidateBoat = Number.isInteger(selectedBoatIndex) ? selectedBoatIndex : multiplayerSeatIndex;
      if (multiplayerSeatIndex !== null && isHybridRaceMode() && !canSelectBoatForPlay(candidateBoat)){
        selectedBoatIndex = null;
      }
      if (isRealtimePlayMode() && !Number.isInteger(realtimeControlledBoatIndex())){
        clearRealtimeIntent();
      }
      if (isLocalRealtimeMode() && phase === "race" && boats.every((boat) => !boat.hasHeading && !boat.finished)){
        setRealtimeReadyState();
      }
      updateResetButtonLabel();
      updateStatus();
      updateStats();
      render();
    },
    getRealtimeIntent: () => {
      if (!isRealtimePlayMode()) return null;
      const boatIdx = realtimeControlledBoatIndex();
      if (!Number.isInteger(boatIdx) || !boats[boatIdx] || boats[boatIdx].finished) return null;
      return {
        boatIndex: boatIdx,
        active: realtimeCursorDirection !== null,
        target: realtimeCursorTarget ? { ...realtimeCursorTarget } : null,
        direction: realtimeCursorDirection ? { ...realtimeCursorDirection } : null,
        phase,
        countdownEndsAt: realtimeCountdownEndsAt
      };
    },
    getMeta: () => ({
      mode,
      currentPlayer,
      playMode,
      interactionMode,
      hybridRound,
      hybridMovesLeft: hybridMovesLeft.slice(),
      realtimeCountdownEndsAt,
      playerCount: boats.length,
      phase,
      markCount
    })
  };

  setInterval(() => {
    if (isRealtimeCountdown()){
      updateStatus();
      render();
    }
  }, 120);

  window.requestAnimationFrame(runLocalRealtimeLoop);

  // -----------------------------
  // Старт приложения
  // -----------------------------
  function init(){
    gridColsInput.value = gridColsInput.value || String(DEFAULT_WORLD_W);
    gridRowsInput.value = gridRowsInput.value || String(DEFAULT_WORLD_H);
    resizeBoardCanvas({ preserveView:false, resetView:true });

    markCount = parseInt(markCountSelect.value,10);
    ensureMarkOptions();
    ensureScenarioLegOptions();

    deadZoneDeg = clamp(parseFloat(deadZoneInp.value)||40, 0, 180);
    snapThreshold = clamp(parseFloat(snapThresholdInp.value)||0.8, 0, 1);
    movesPerTurn = clamp(parseInt(movesPerTurnInp.value,10)||1, 1, 10);
    tackPenaltyFactor = clamp(parseFloat(tackPenaltyInp.value)||0.95, 0.5, 1.0);
    autoGustsEnabled = autoGustsSelect?.value === "on";
    autoGustIntervalSec = clamp(parseFloat(autoGustIntervalInp?.value) || 10, 3, 60);
    autoGustDurationSec = clamp(parseFloat(autoGustDurationInp?.value) || 6, 2, 30);
    realtimePrepSeconds = clamp(parseFloat(realtimePrepInp?.value) || 12, 0, 120);
    autoFullscreenMode = autoFullscreenModeSelect?.value === "race" ? "race" : "off";

    roundingSide = roundingSideSelect.value;
    playMode = normalizePlayModeValue(playModeSelect.value);
    interactionMode = normalizeInteractionMode(interactionModeSelect?.value);
    finishSeparate = (finishSeparateSelect.value === "yes");
    prestartRoundsSetting = Math.max(0, parseInt(prestartRoundsInp.value,10) || 0);

    cellLikeDefaultPlacement();
    if (!finishSeparate){
      finishA = { ...startA };
      finishB = { ...startB };
    }

    updateFinishButtonEnabled();
    updateInteractionModeInfo();
    updateResetButtonLabel();
    updateViewButtons();
    updateWindInfo();
    resetBoats();
    setMode("play");
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
  }

  init();
});
