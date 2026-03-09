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
  const finishSeparateSelect = document.getElementById("finishSeparate");
  const prestartRoundsInp = document.getElementById("prestartRounds");

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

  const zoomSlider = document.getElementById("zoomSlider");
  const zoomLabel  = document.getElementById("zoomLabel");
  const panXSlider = document.getElementById("panXSlider");
  const panYSlider = document.getElementById("panYSlider");

  const btnWindLeft  = document.getElementById("windLeft");
  const btnWindRight = document.getElementById("windRight");
  const btnGust      = document.getElementById("randomGust");
  const btnClearGust = document.getElementById("clearGust");
  const btnReset     = document.getElementById("resetGame");
  const btnOptimal   = document.getElementById("toggleOptimal");
  const btnBestStart = document.getElementById("bestStart");

  // -----------------------------
  // Мир: непрерывные координаты
  // -----------------------------
  let worldW = parseFloat(gridColsInput.value);
  let worldH = parseFloat(gridRowsInput.value);

  const PX_PER_UNIT_BASE = 30;
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

  function updateZoomFromSlider(){
    zoom = parseInt(zoomSlider.value,10)/100;
    PX = PX_PER_UNIT_BASE * zoom;
    zoomLabel.textContent = `${Math.round(zoom*100)}%`;
  }

  function updatePanFromSliders(){
    const extraW = Math.max(0, fieldPixelW() - canvas.width);
    const extraH = Math.max(0, fieldPixelH() - canvas.height);

    const fx = parseInt(panXSlider.value,10)/100;
    const fy = parseInt(panYSlider.value,10)/100;

    panX = (fx - 0.5) * extraW;
    panY = (fy - 0.5) * extraH;
  }

  function worldToScreen(p){
    const tl = fieldTopLeft();
    return { x: tl.x + p.x * PX, y: tl.y + (worldH - p.y) * PX };
  }

  function screenToWorld(clientX, clientY){
    const rect = canvas.getBoundingClientRect();
    const sx = (clientX - rect.left) * (canvas.width / rect.width);
    const sy = (clientY - rect.top)  * (canvas.height/ rect.height);

    const tl = fieldTopLeft();
    const lx = sx - tl.x;
    const ly = sy - tl.y;

    if (lx < 0 || ly < 0 || lx > fieldPixelW() || ly > fieldPixelH()) return null;

    const wx = lx / PX;
    const wy = worldH - (ly / PX);
    return { x: wx, y: wy };
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
  function norm(v){
    const L = Math.hypot(v.x,v.y) || 1;
    return { x: v.x/L, y: v.y/L, L };
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

  let snapThreshold = parseFloat(snapThresholdInp.value); // 0..1
  let movesPerTurn  = parseInt(movesPerTurnInp.value,10) || 1;
  let roundingSide  = roundingSideSelect.value; // "port" | "starboard"
  let tackPenaltyFactor = parseFloat(tackPenaltyInp.value); // 0.5..1

  function updateWindInfo(){ windInfoEl.textContent = `Ветер: ${windAngleDeg.toFixed(0)}°`; }

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

  let gustRect = null; // {x,y,w,h}
  const GUST_MULT = 2.0;

  let boats = [];
  let currentPlayer = 0;
  let selectedBoatIndex = null;
  let raceFinishedCount = 0;

  let subMovesLeft = 1;

  let prestartRoundsSetting = parseInt(prestartRoundsInp.value,10) || 0;
  let prestartRoundsLeft = prestartRoundsSetting;
  let phase = (prestartRoundsSetting > 0) ? "prestart" : "race"; // prestart | race

  const BOAT_COLORS = ["#e53935","#1e88e5","#43a047","#fdd835","#8e24aa","#ff8f00","#00acc1","#6d4c41"];

  const STEP_RADIUS_BASE = 1.0;
  const BOAT_RADIUS = 0.25;
  const BOAT_PICK_RADIUS = 0.7;
  const MARK_RADIUS = 0.35;                 // "столкновение"/запрет встать в знак
  const ROUND_PASS_RADIUS = MARK_RADIUS * 2; // зона огибания (как просил — 2×)
  const ROUNDING_MIN_SWEEP = Math.PI / 3;
  const ROUNDING_SWEEP_BIN_RAD = Math.PI / 12;

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

  function pointInField(p){ return p.x>=0 && p.x<=worldW && p.y>=0 && p.y<=worldH; }
  function pointInGust(p){
    if (!gustRect) return false;
    return (p.x >= gustRect.x && p.x <= gustRect.x + gustRect.w &&
            p.y >= gustRect.y && p.y <= gustRect.y + gustRect.h);
  }

  function cellLikeDefaultPlacement(){
    startA = { x: 2, y: 2 };
    startB = { x: Math.max(3, worldW - 2), y: 2 };
    finishA = { ...startA };
    finishB = { ...startB };

    marks = [];
    for (let i=0;i<MARK_MAX;i++){
      const offset = i - Math.floor(MARK_MAX/2);
      marks.push({
        x: clamp(worldW/2 + offset*2, 1, worldW-1),
        y: clamp(worldH - 4 - i*3, 1, worldH-1)
      });
    }
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
      if (dist(p, {x:boats[i].x,y:boats[i].y}) <= BOAT_PICK_RADIUS) return i;
    }
    return -1;
  }

  function isTooCloseToMarks(p){
    for (let i=0;i<markCount;i++){
      if (dist(p, marks[i]) < MARK_RADIUS) return true;
    }
    return false;
  }

  function isTooCloseToBoats(p, exceptIdx){
    for (let i=0;i<boats.length;i++){
      if (i===exceptIdx) continue;
      if (dist(p, {x:boats[i].x,y:boats[i].y}) < BOAT_RADIUS*2) return true;
    }
    return false;
  }

  function pathIntersectsOtherBoat(prevPos, nextPos, movingIdx){
    const minD = BOAT_RADIUS*2;
    for (let i=0;i<boats.length;i++){
      if (i===movingIdx) continue;
      const c = {x:boats[i].x,y:boats[i].y};
      const d = segDistToPoint(prevPos, nextPos, c);
      if (d < minD - 1e-9) return true;
    }
    return false;
  }

  function pathIntersectsAnyMark(prevPos, nextPos){
    for (let i=0;i<markCount;i++){
      if (segDistToPoint(prevPos, nextPos, marks[i]) < MARK_RADIUS - 1e-9) return true;
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
    let factor = 1.0;
    if (pointInGust({x:boat.x,y:boat.y})) factor *= GUST_MULT;
    if (tackPenaltyFactor < 1.0 && wouldChangeTack(boat, headingVecUnit)) factor *= tackPenaltyFactor;
    return factor;
  }

  function allowedRadiusForMove(boat, headingVecUnit){
    return STEP_RADIUS_BASE * stepFactorForMove(boat, headingVecUnit);
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
    if (isTooCloseToMarks(dest)) return null;
    if (isTooCloseToBoats(dest, boatIdx)) return null;

    const dd = dist(dest, {x:b.x,y:b.y});
    if (dd > R + 1e-6) return null;

    const prevPos = {x:b.x,y:b.y};
    if (pathIntersectsAnyMark(prevPos, dest)) return null;
    if (pathIntersectsOtherBoat(prevPos, dest, boatIdx)) return null;

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
      b.nextMark = 0;
      b.finished = false;
      b.place = null;
      b.roundInZone = false;
      b.roundSweep = 0;
    }

    currentPlayer = 0;
    subMovesLeft = movesPerTurn;

    statusEl.textContent = "СТАРТ! Продолжаем гонку с текущих позиций.";
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
  }

  function performMove(boatIdx, dest){
    const b = boats[boatIdx];
    if (!b || b.finished) return;

    const prev = {x:b.x,y:b.y};

    const mv = { x: dest.x - b.x, y: dest.y - b.y };
    const L = Math.hypot(mv.x,mv.y);
    if (L < 1e-9) return;
    const dir = { x: mv.x/L, y: mv.y/L };

    if (pathIntersectsAnyMark(prev, dest)) return;
    if (pathIntersectsOtherBoat(prev, dest, boatIdx)) return;

    b.distance += L;

    const heading = Math.atan2(dir.y, dir.x);
    const newTack = tackSignFromHeadingVec(dir);
    if (b.hasHeading){
      const da = Math.abs(angleWrap(heading - b.heading));
      const tackChanged = (b.tack !== 0 && newTack !== 0 && b.tack !== newTack);
      if (tackChanged || da >= (60*Math.PI/180)) b.turns += 1;
    }
    b.heading = heading;
    b.tack = newTack;
    b.hasHeading = true;

    b.x = dest.x; b.y = dest.y;

    const curPos = {x:b.x,y:b.y};
    updateBoatMarkAndFinish(b, prev, curPos, dir);

    subMovesLeft = Math.max(0, subMovesLeft - 1);
    if (b.finished) subMovesLeft = 0;

    if (boats.every(bb => bb.finished) && phase==="race"){
      selectedBoatIndex = null;
      updateStatus();
      updateStats();
      render();
      return;
    }

    if (subMovesLeft > 0){
      selectedBoatIndex = currentPlayer;
      updateStatus();
      updateStats();
      render();
      return;
    }

    advanceTurnToNext();
    selectedBoatIndex = null;

    updateStatus();
    updateStats();
    render();
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

  function plannerStepLenAt(pos, prevTack, dirUnit){
    let factor = 1.0;
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
  function planOptimalFrom(startPos, startMarkIdx, prevHeadingAng, prevTack, goalMode, movingBoatIdx=null){
    const RES = plannerResolution();

    const sPos = { x: clamp(startPos.x,0,worldW), y: clamp(startPos.y,0,worldH) };
    const q0 = quantize(sPos, RES);

    if (isTooCloseToMarks(sPos)) return null;
    if (movingBoatIdx !== null && isTooCloseToBoats(sPos, movingBoatIdx)) return null;

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

        const stepLen = plannerStepLenAt(curPos, cur.tack, dirUnit);
        const nextRaw = clampAlongRayToField(curPos, dirUnit, stepLen);

        const nq = quantize(nextRaw, RES);
        const nextPos = { x: clamp(nq.x,0,worldW), y: clamp(nq.y,0,worldH) };

        if (!pointInField(nextPos)) continue;

        const moveVec = { x: nextPos.x - curPos.x, y: nextPos.y - curPos.y };
        const L = Math.hypot(moveVec.x, moveVec.y);
        if (L < 1e-6) continue;
        if (L > stepLen + 1e-6) continue;
        if (isMoveInDeadZone(moveVec)) continue;
        if (isTooCloseToMarks(nextPos)) continue;
        if (pathIntersectsAnyMark(curPos, nextPos)) continue;
        if (movingBoatIdx !== null){
          if (isTooCloseToBoats(nextPos, movingBoatIdx)) continue;
          if (pathIntersectsOtherBoat(curPos, nextPos, movingBoatIdx)) continue;
        }

        const headingAng = Math.atan2(moveVec.y, moveVec.x);
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

    const res = planOptimalFrom(startPos, markIdx, prevHeadingAng, prevTack, "course", idx);
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

    const n = clamp(Math.round(len / 1.2), 8, 16);
    let best = null;

    for (let i=1; i<=n; i++){
      const t = i/(n+1);
      const sp = { x: startA.x + ux*len*t, y: startA.y + uy*len*t };

      if (isTooCloseToMarks(sp)) continue;
      if (isTooCloseToBoats(sp, -1)) continue;

      const res = planOptimalFrom(sp, 0, null, 0, "firstMark", -1);
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

    const allDone = boats.length>0 && boats.every(b=>b.finished) && phase==="race";
    if (allDone){
      statusEl.textContent = "Гонка завершена: все лодки финишировали.";
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
    lines.push(`<b>Статистика</b> (номера лодок):`);
    lines.push(`<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px;">`);

    for (let i=0;i<boats.length;i++){
      const b = boats[i];
      const fin = b.finished ? `✅ финиш: ${b.place}` : (phase==="race" ? "⏳ в гонке" : "⏳ предстарт");
      lines.push(`
        <div style="border:1px solid #eee;border-radius:10px;padding:8px 10px;min-width:190px;">
          <div><b style="color:${b.color};">Лодка ${i+1}</b> — ${fin}</div>
          <div>Дистанция: <b>${b.distance.toFixed(2)}</b></div>
          <div>Повороты: <b>${b.turns}</b></div>
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

    let extra = "";

    if (showOptimal && optimalStats && optimalForBoat !== null){
      extra += `<div style="margin-top:6px;">🧭 <b>Оптимум для лодки ${optimalForBoat+1}</b>: расстояние <b>${optimalStats.distance.toFixed(2)}</b>, повороты <b>${optimalStats.turns}</b>, ходов <b>${optimalStats.moves}</b></div>`;
    }
    if (showBestStart && bestStartSolution){
      extra += `<div style="margin-top:6px;">🏁 <b>Лучший старт (до 1-го знака)</b>: расстояние <b>${bestStartSolution.stats.distance.toFixed(2)}</b>, повороты <b>${bestStartSolution.stats.turns}</b>, ходов <b>${bestStartSolution.stats.moves}</b></div>`;
    }
    if ((showBestStart && !bestStartSolution) || (showOptimal && !optimalStats)){
      extra += `<div style="margin-top:6px;">⚠️ Не удалось найти маршрут (попробуй уменьшить поле / мёртвую зону / сдвинуть знаки/финиш).</div>`;
    }

    optInfoEl.innerHTML = `<b>Состояние</b>: ${finTxt}. ${roundTxt}. Фаза: <b>${phase === "prestart" ? "предстарт" : "гонка"}</b>.${extra}`;
  }

  // -----------------------------
  // Инициализация / сброс
  // -----------------------------
  function resetBoats(){
    const n = parseInt(playerCountSelect.value,10) || 2;

    boats = [];
    raceFinishedCount = 0;

    prestartRoundsSetting = parseInt(prestartRoundsInp.value,10) || 0;
    prestartRoundsLeft = prestartRoundsSetting;
    phase = (prestartRoundsSetting > 0) ? "prestart" : "race";

    for (let i=0;i<n;i++){
      boats.push({
        x:0, y:0,
        distance:0,
        turns:0,
        nextMark:0,
        finished:false,
        place:null,
        hasHeading:false,
        heading:0,
        tack:0,
        color: BOAT_COLORS[i % BOAT_COLORS.length],

        // ✅ состояние огибания (важно!)
        roundInZone:false,
        roundSweep:0
      });
    }

    if (phase === "prestart"){
      for (let i=0;i<n;i++){
        const p = randomSpawnBehindStart();
        boats[i].x = p.x;
        boats[i].y = p.y;
      }
    } else {
      for (let i=0;i<n;i++){
        const t = (i+1)/(n+1);
        boats[i].x = startA.x + (startB.x-startA.x)*t;
        boats[i].y = startA.y + (startB.y-startA.y)*t;
      }
    }

    currentPlayer = 0;
    selectedBoatIndex = null;
    placementSelectedBoat = null;
    subMovesLeft = movesPerTurn;

    ensureNextPlayerOptions();
    invalidateSolutions();
    updateFinishButtonEnabled();
    updateStatus();
    updateStats();
    updateOptInfo();
  }

  function clonePoint(rawPoint, fallbackPoint){
    const fallback = fallbackPoint || { x:0, y:0 };
    const x = Number.isFinite(rawPoint?.x) ? rawPoint.x : fallback.x;
    const y = Number.isFinite(rawPoint?.y) ? rawPoint.y : fallback.y;
    return { x, y };
  }

  function normalizeBoatSnapshot(rawBoat, idx){
    const fallback = boats[idx] || { x:0, y:0 };
    return {
      x: clamp(Number.isFinite(rawBoat?.x) ? rawBoat.x : fallback.x, 0, worldW),
      y: clamp(Number.isFinite(rawBoat?.y) ? rawBoat.y : fallback.y, 0, worldH),
      distance: Number.isFinite(rawBoat?.distance) ? rawBoat.distance : 0,
      turns: Number.isFinite(rawBoat?.turns) ? rawBoat.turns : 0,
      nextMark: clamp(parseInt(rawBoat?.nextMark,10) || 0, 0, markCount),
      finished: !!rawBoat?.finished,
      place: Number.isFinite(rawBoat?.place) ? rawBoat.place : null,
      hasHeading: !!rawBoat?.hasHeading,
      heading: Number.isFinite(rawBoat?.heading) ? rawBoat.heading : 0,
      tack: Number.isFinite(rawBoat?.tack) ? rawBoat.tack : 0,
      color: typeof rawBoat?.color === "string" ? rawBoat.color : BOAT_COLORS[idx % BOAT_COLORS.length],
      roundInZone: !!rawBoat?.roundInZone,
      roundSweep: Number.isFinite(rawBoat?.roundSweep) ? rawBoat.roundSweep : 0
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
        tackPenaltyFactor,
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
        prestartRoundsLeft,
        phase
      },
      boats: boats.map((boat) => ({
        x: boat.x,
        y: boat.y,
        distance: boat.distance,
        turns: boat.turns,
        nextMark: boat.nextMark,
        finished: boat.finished,
        place: boat.place,
        hasHeading: boat.hasHeading,
        heading: boat.heading,
        tack: boat.tack,
        color: boat.color,
        roundInZone: boat.roundInZone,
        roundSweep: boat.roundSweep
      }))
    };
  }

  function importGameState(snapshot){
    if (!snapshot || typeof snapshot !== "object") return;

    const world = snapshot.world || {};
    const settings = snapshot.settings || {};
    const course = snapshot.course || {};
    const race = snapshot.race || {};

    worldW = clamp(parseFloat(world.width) || worldW, 8, 120);
    worldH = clamp(parseFloat(world.height) || worldH, 8, 120);
    gridColsInput.value = String(worldW);
    gridRowsInput.value = String(worldH);

    markCount = clamp(parseInt(course.markCount,10) || markCount, 1, MARK_MAX);
    markCountSelect.value = String(markCount);
    ensureMarkOptions();

    const defaultMarks = [];
    for (let i=0;i<MARK_MAX;i++){
      const offset = i - Math.floor(MARK_MAX/2);
      defaultMarks.push({
        x: clamp(worldW/2 + offset*2, 1, worldW-1),
        y: clamp(worldH - 4 - i*3, 1, worldH-1)
      });
    }
    const incomingMarks = Array.isArray(course.marks) ? course.marks : [];
    marks = defaultMarks.map((fallbackMark, idx) => clonePoint(incomingMarks[idx], fallbackMark));

    startA = clonePoint(course.startA, { x:2, y:2 });
    startB = clonePoint(course.startB, { x:Math.max(3, worldW-2), y:2 });

    finishSeparate = !!settings.finishSeparate;
    finishSeparateSelect.value = finishSeparate ? "yes" : "no";
    finishA = clonePoint(course.finishA, startA);
    finishB = clonePoint(course.finishB, startB);
    if (!finishSeparate){
      finishA = { ...startA };
      finishB = { ...startB };
    }

    gustRect = course.gustRect
      ? {
          x: Number.isFinite(course.gustRect.x) ? course.gustRect.x : 0,
          y: Number.isFinite(course.gustRect.y) ? course.gustRect.y : 0,
          w: Number.isFinite(course.gustRect.w) ? course.gustRect.w : 0,
          h: Number.isFinite(course.gustRect.h) ? course.gustRect.h : 0
        }
      : null;

    windAngleDeg = Number.isFinite(settings.windAngleDeg) ? settings.windAngleDeg : windAngleDeg;
    deadZoneDeg = clamp(parseFloat(settings.deadZoneDeg) || deadZoneDeg, 0, 180);
    snapThreshold = clamp(parseFloat(settings.snapThreshold) || snapThreshold, 0, 1);
    movesPerTurn = clamp(parseInt(settings.movesPerTurn,10) || movesPerTurn, 1, 10);
    roundingSide = (settings.roundingSide === "starboard") ? "starboard" : "port";
    tackPenaltyFactor = clamp(parseFloat(settings.tackPenaltyFactor) || tackPenaltyFactor, 0.5, 1.0);
    prestartRoundsSetting = Math.max(0, parseInt(settings.prestartRoundsSetting,10) || 0);

    deadZoneInp.value = String(deadZoneDeg);
    snapThresholdInp.value = String(snapThreshold);
    movesPerTurnInp.value = String(movesPerTurn);
    roundingSideSelect.value = roundingSide;
    tackPenaltyInp.value = String(tackPenaltyFactor);
    prestartRoundsInp.value = String(prestartRoundsSetting);

    const incomingBoats = Array.isArray(snapshot.boats) ? snapshot.boats : [];
    const playerCount = clamp(incomingBoats.length || parseInt(playerCountSelect.value,10) || 2, 2, 8);
    playerCountSelect.value = String(playerCount);
    resetBoats();

    boats = [];
    for (let i=0;i<playerCount;i++){
      boats.push(normalizeBoatSnapshot(incomingBoats[i], i));
    }

    phase = (race.phase === "prestart") ? "prestart" : "race";
    prestartRoundsLeft = (phase === "prestart")
      ? Math.max(0, parseInt(race.prestartRoundsLeft,10) || prestartRoundsSetting)
      : 0;
    currentPlayer = clamp(parseInt(race.currentPlayer,10) || 0, 0, boats.length-1);
    raceFinishedCount = Math.max(0, parseInt(race.raceFinishedCount,10) || boats.filter((boat) => boat.finished).length);
    const importedSubMovesLeft = parseInt(race.subMovesLeft,10);
    subMovesLeft = clamp(Number.isFinite(importedSubMovesLeft) ? importedSubMovesLeft : movesPerTurn, 0, movesPerTurn);

    selectedBoatIndex = null;
    placementSelectedBoat = null;
    startAwaitSecond = false;
    finishAwaitSecond = false;

    ensureScenarioLegOptions();
    ensureNextPlayerOptions();
    updateFinishButtonEnabled();
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
    if (w < 8 || h < 8 || w > 120 || h > 120) return;

    worldW = w;
    worldH = h;

    cellLikeDefaultPlacement();

    panXSlider.value = 50;
    panYSlider.value = 50;
    updatePanFromSliders();

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
    if (!gustRect) return;

    const p1 = worldToScreen({x:gustRect.x, y:gustRect.y});
    const p2 = worldToScreen({x:gustRect.x+gustRect.w, y:gustRect.y+gustRect.h});

    const x = Math.min(p1.x,p2.x);
    const y = Math.min(p1.y,p2.y);
    const w = Math.abs(p2.x-p1.x);
    const h = Math.abs(p2.y-p1.y);

    ctx.fillStyle = "rgba(100,150,255,0.25)";
    ctx.fillRect(x,y,w,h);
    ctx.strokeStyle = "rgba(100,150,255,0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x,y,w,h);
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

      const size = Math.max(44, PX*2.0);
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
      const p = worldToScreen({x:boats[i].x,y:boats[i].y});
      const r = (BOAT_RADIUS*2) * PX;
      ctx.beginPath();
      ctx.arc(p.x,p.y,r,0,Math.PI*2);
      ctx.fill(); ctx.stroke();
    }

    for (let i=0;i<markCount;i++){
      const p = worldToScreen(marks[i]);
      const r = MARK_RADIUS * PX;
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

    const baseFactor = pointInGust({x:b.x,y:b.y}) ? GUST_MULT : 1.0;
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
    if (tackPenaltyFactor < 1.0) tips.push(`Штраф смены галса: ×${tackPenaltyFactor.toFixed(2)}`);
    tips.push(`Дотягивание: ${snapThreshold.toFixed(2)}R`);
    tips.push("Столкновения: запрещены");
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

  function render(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);

    drawField();
    drawGust();

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
    drawBoats();
  }

  // -----------------------------
  // Клики по canvas
  // -----------------------------
  canvas.addEventListener("click", (e) => {
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

    if (clickedBoat === currentPlayer && !boats[currentPlayer].finished){
      selectedBoatIndex = currentPlayer;
      render();
      return;
    }

    if (selectedBoatIndex === currentPlayer && selectedBoatIndex !== null){
      const dest = proposeDestination(currentPlayer, p);
      if (dest){
        performMove(currentPlayer, dest);
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

  btnResumeFromModel.addEventListener("click", () => {
    const v = scenarioLegSelect.value;
    let nm = 0;
    if (v.startsWith("to")) nm = parseInt(v.slice(2),10);
    nm = clamp(nm, 0, markCount);

    for (const b of boats){
      b.nextMark = nm;
      b.distance = 0;
      b.turns = 0;
      b.finished = false;
      b.place = null;
      b.hasHeading = false;
      b.heading = 0;
      b.tack = 0;

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
  });

  deadZoneInp.addEventListener("change", () => {
    deadZoneDeg = clamp(parseFloat(deadZoneInp.value)||0, 0, 180);
    invalidateSolutions();
    updateOptInfo();
    render();
  });

  snapThresholdInp.addEventListener("change", () => {
    snapThreshold = clamp(parseFloat(snapThresholdInp.value)||0.8, 0, 1);
    render();
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
  });

  btnWindLeft.addEventListener("click", () => {
    windAngleDeg -= WIND_STEP;
    updateWindInfo();
    invalidateSolutions();
    updateOptInfo();
    render();
  });

  btnWindRight.addEventListener("click", () => {
    windAngleDeg += WIND_STEP;
    updateWindInfo();
    invalidateSolutions();
    updateOptInfo();
    render();
  });

  btnGust.addEventListener("click", () => {
    const w = Math.max(2, worldW/6);
    const h = Math.max(2, worldH/6);
    const x = Math.random() * (worldW - w);
    const y = Math.random() * (worldH - h);
    gustRect = { x, y, w, h };
    invalidateSolutions();
    updateOptInfo();
    render();
  });

  btnClearGust.addEventListener("click", () => {
    gustRect = null;
    invalidateSolutions();
    updateOptInfo();
    render();
  });

  btnOptimal.addEventListener("click", () => {
    if (mode !== "play") setMode("play");

    if (showOptimal && optimalForBoat === currentPlayer){
      showOptimal = false;
      optimalPath = [];
      optimalStats = null;
      optimalForBoat = null;
      updateOptInfo();
      render();
      return;
    }

    computeOptimalForBoat(currentPlayer);
    showOptimal = true;
    updateOptInfo();
    render();
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

  // Новая гонка: не сбрасывает дистанцию — только лодки
  btnReset.addEventListener("click", () => {
    resetBoats();
    invalidateSolutions();
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
  });

  applyGridBtn.addEventListener("click", () => {
    applyWorldSize();
    invalidateSolutions();
    updateStatus();
    updateStats();
    updateOptInfo();
  });

  zoomSlider.addEventListener("input", () => {
    updateZoomFromSlider();
    updatePanFromSliders();
    render();
  });
  panXSlider.addEventListener("input", () => { updatePanFromSliders(); render(); });
  panYSlider.addEventListener("input", () => { updatePanFromSliders(); render(); });

  window.RegattaApp = {
    exportState: exportGameState,
    importState: importGameState,
    fingerprintState: fingerprintGameState,
    render,
    setMode,
    getMeta: () => ({
      mode,
      currentPlayer,
      playerCount: boats.length,
      phase,
      markCount
    })
  };

  // -----------------------------
  // Старт приложения
  // -----------------------------
  function init(){
    updateZoomFromSlider();
    updatePanFromSliders();

    markCount = parseInt(markCountSelect.value,10);
    ensureMarkOptions();
    ensureScenarioLegOptions();

    deadZoneDeg = clamp(parseFloat(deadZoneInp.value)||40, 0, 180);
    snapThreshold = clamp(parseFloat(snapThresholdInp.value)||0.8, 0, 1);
    movesPerTurn = clamp(parseInt(movesPerTurnInp.value,10)||1, 1, 10);
    tackPenaltyFactor = clamp(parseFloat(tackPenaltyInp.value)||0.95, 0.5, 1.0);

    roundingSide = roundingSideSelect.value;
    finishSeparate = (finishSeparateSelect.value === "yes");
    prestartRoundsSetting = Math.max(0, parseInt(prestartRoundsInp.value,10) || 0);

    cellLikeDefaultPlacement();
    if (!finishSeparate){
      finishA = { ...startA };
      finishB = { ...startB };
    }

    updateFinishButtonEnabled();
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
