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
  let localPilotMode = "hotseat";
  const LOCAL_HUMAN_SEAT = 0;
  let botTurnTimer = 0;
  let botTurnInProgress = false;
  let realtimeCountdownEndsAt = 0;
  let realtimeCursorTarget = null;
  let realtimeCursorDirection = null;
  let realtimeCursorClient = null;
  let activeRealtimePointerId = null;
  let localRealtimeLastTickAt = 0;
  let realtimeBotDecisionCache = [];

  let prestartRoundsSetting = parseInt(prestartRoundsInp.value,10) || 0;
  let prestartRoundsLeft = prestartRoundsSetting;
  let phase = (prestartRoundsSetting > 0) ? "prestart" : "race"; // prestart | race
  let lastPhaseForFullscreen = phase;

  const BOAT_COLORS = ["#e53935","#1e88e5","#43a047","#fdd835","#8e24aa","#ff8f00","#00acc1","#6d4c41"];

  const STEP_RADIUS_BASE = 1.0;
  const BOAT_RULE_LENGTH = 0.85;
  const BOAT_FOOTPRINT_LENGTH = 1.55;
  const BOAT_FOOTPRINT_BEAM = 0.78;
  const BOAT_COLLISION_RADIUS = BOAT_FOOTPRINT_BEAM / 2;
  const BOAT_CAPSULE_HALF_SEGMENT = Math.max(0, (BOAT_FOOTPRINT_LENGTH - BOAT_FOOTPRINT_BEAM) / 2);
  const BOAT_SWEEP_RADIUS = BOAT_CAPSULE_HALF_SEGMENT + BOAT_COLLISION_RADIUS;
  const BOAT_PICK_PAD = 0.18;
  const BOAT_CLEARANCE_MARGIN = 0.16;
  const MARK_CLEARANCE_MARGIN = 0.16;
  const MARK_RADIUS = 0.28;                 // геометрический радиус знака
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
    boatTrails = boats.map((boat) => (
      boat && Number.isFinite(boat.x) && Number.isFinite(boat.y)
        ? [{ x: boat.x, y: boat.y }]
        : []
    ));
  }

  function appendBoatTrailPoint(index, point){
    if (!boats[index] || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    if (!boatTrails[index]) boatTrails[index] = [];
    const trail = boatTrails[index];
    const last = trail[trail.length - 1];
    if (!last || !Number.isFinite(last.x) || !Number.isFinite(last.y) || dist(last, point) >= 0.18){
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

  function spawnGust(nextRect=null, nowMs=currentRaceTimeMs()){
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

  function updateAutoGustState(nowMs=currentRaceTimeMs()){
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

  function normalizeDegrees(deg){
    const normalized = deg % 360;
    return normalized < 0 ? normalized + 360 : normalized;
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

  function randomCourseLayout(width=worldW, height=worldH){
    const startY = clamp(height * (0.13 + Math.random() * 0.05), 4, height - 8);
    const startInset = clamp(width * (0.16 + Math.random() * 0.08), 3, Math.max(3, width / 2 - 4));
    const startTilt = (Math.random() - 0.5) * Math.min(height * 0.04, 1.8);
    const startLeft = { x: startInset, y: clamp(startY + startTilt, 2, height - 2) };
    const startRight = { x: width - startInset, y: clamp(startY - startTilt, 2, height - 2) };
    const markTotal = clamp(parseInt(markCountSelect.value,10) || markCount, 1, MARK_MAX);
    const centerX = (startLeft.x + startRight.x) / 2;
    const courseSpanY = clamp(height * 0.58, 16, height - startY - 6);
    const firstMarkY = clamp(startY + courseSpanY, startY + 10, height - 4);
    const lowerMarkY = clamp(startY - height * (0.04 + Math.random() * 0.08), 2, startY - 1.4);
    const laneWidth = clamp(width * 0.26, 5, Math.max(5, width * 0.36));
    const side = Math.random() < 0.5 ? -1 : 1;

    const nextMark = [];
    for (let i=0; i<markTotal; i++){
      if (i === 0){
        nextMark.push({
          x: clamp(centerX + (Math.random() - 0.5) * width * 0.10, 2.5, width - 2.5),
          y: firstMarkY
        });
        continue;
      }

      if (i === markTotal - 1){
        nextMark.push({
          x: clamp(centerX + side * laneWidth * (0.75 + Math.random() * 0.25), 2.5, width - 2.5),
          y: lowerMarkY
        });
        continue;
      }

      const progress = i / Math.max(1, markTotal - 1);
      const laneSign = (i % 2 === 0 ? -side : side);
      nextMark.push({
        x: clamp(centerX + laneSign * laneWidth * (0.75 + Math.random() * 0.3), 2.5, width - 2.5),
        y: clamp(firstMarkY - progress * (firstMarkY - Math.max(startY + 8, height * 0.34)), startY + 8, height - 4)
      });
    }

    return {
      startA: startLeft,
      startB: startRight,
      finishA: { ...startLeft },
      finishB: { ...startRight },
      marks: nextMark
    };
  }

  function applyRandomCourse(){
    markCount = clamp(parseInt(markCountSelect.value,10) || markCount, 1, MARK_MAX);
    const layout = randomCourseLayout(worldW, worldH);
    startA = layout.startA;
    startB = layout.startB;
    finishA = finishSeparate ? { ...layout.finishA } : { ...layout.startA };
    finishB = finishSeparate ? { ...layout.finishB } : { ...layout.startB };
    marks = layout.marks;
    setWindAngle((Math.random() * 30) - 15);
    gustRect = null;
    gustExpiresAt = 0;
    nextAutoGustAt = 0;
    resetBoats({ randomizeBehindStart: true });
    ensureMarkOptions();
    ensureScenarioLegOptions();
    updateFinishButtonEnabled();
    updateWindInfo();
    invalidateSolutions();
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
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
    emitStateChanged();
  }

  function updateFinishButtonEnabled(){
    const enabled = finishSeparate;
    btnModeFinish.classList.toggle("mode-btn-disabled", !enabled);
    if (!enabled && mode === "finish") setMode("play");
  }

  function updateResetButtonLabel(){
    btnReset.textContent = "Начать гонку заново";
    updateBoardStartAction();
  }

  function clearBotTurnTimer(){
    if (botTurnTimer){
      window.clearTimeout(botTurnTimer);
      botTurnTimer = 0;
    }
  }

  function clearRealtimeBotDecisionCache(){
    realtimeBotDecisionCache = [];
  }

  function isLocalBotsMode(){
    return multiplayerSeatIndex === null && localPilotMode === "bots";
  }

  function isHumanControlledBoat(boatIdx){
    return !isLocalBotsMode() || boatIdx === LOCAL_HUMAN_SEAT;
  }

  function isBotControlledBoat(boatIdx){
    return isLocalBotsMode() && !isHumanControlledBoat(boatIdx);
  }

  function currentBotDifficultyProfile(){
    return BOT_DIFFICULTY_PROFILES[normalizeBotDifficultyValue(botDifficulty)] || BOT_DIFFICULTY_PROFILES.normal;
  }

  function botSkillProfile(boatIdx){
    const baseProfile = currentBotDifficultyProfile();
    const variance = (stableNoise01((boatIdx + 1) * 17.31) - 0.5) * 0.12;
    return {
      turnRateScale: clamp(baseProfile.turnRateScale + variance * 0.55, 0.7, 1.05),
      decisionMs: clamp(baseProfile.decisionMs * (1 - variance * 0.55), 280, 1400),
      aimJitterDeg: clamp(baseProfile.aimJitterDeg * (1 - variance * 0.55), 0, 22),
      scoreNoise: clamp(baseProfile.scoreNoise + Math.abs(variance) * 0.18, 0, 1.1),
      routeSlack: clamp(baseProfile.routeSlack + Math.abs(variance) * 0.12, 0, 0.28),
      favoredEndBias: clamp(baseProfile.favoredEndBias + variance * 0.8, 0.54, 0.92),
      clusterWidth: clamp(baseProfile.clusterWidth + Math.abs(variance) * 0.12, 0.10, 0.34),
      earlyDepth: clamp(baseProfile.earlyDepth + variance * 0.7, 0.9, PRESTART_DEPTH - 0.15),
      lateDepth: clamp(baseProfile.lateDepth + variance * 0.35, 0.18, PRESTART_DEPTH - 0.1),
      lineMargin: clamp(baseProfile.lineMargin + variance * 0.3, 0.18, 0.9)
    };
  }

  function setLocalPilotMode(nextMode="hotseat"){
    localPilotMode = nextMode === "bots" ? "bots" : "hotseat";
    clearBotTurnTimer();
    clearRealtimeBotDecisionCache();
    if (isLocalBotsMode() && boats[LOCAL_HUMAN_SEAT]){
      selectedBoatIndex = LOCAL_HUMAN_SEAT;
    }
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
    if (isLocalBotsMode() && !isRealtimePlayMode()){
      scheduleLocalBotTurn();
    }
  }

  function updateInteractionModeInfo(){
    if (!interactionModeInfoEl) return;

    const descriptions = {
      contact: "Режим со столкновениями: лодки упираются друг в друга и не проходят в узкие щели. Геометрия столкновений учитывается и в ходе, и в подсказках маршрута.",
      ghost: "Режим без столкновений: лодки полностью проходят друг сквозь друга и не влияют на движение соперников.",
      rules: "Без столкновений, но с правилами: корпуса не блокируют ход, но игра начисляет штрафы за нарушения при встречах. Учитываются левый и правый галс, наветренная и подветренная стороны, положение впереди и позади, задний ход и упрощенное место у знака."
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
        await armLocalRealtimeStart();
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

  async function handleResetAction(options = {}){
    if (mode !== "play") setMode("play");
    resetBoats({
      armRealtime: !!options.armRealtime,
      randomizeBehindStart: options.randomizeBehindStart ?? null,
    });
    invalidateSolutions();
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
  }

  async function armLocalRealtimeStart(){
    if (!isLocalRealtimeMode()) return false;
    if (mode !== "play") setMode("play");
    if (phase !== "countdown" || realtimeCountdownEndsAt > 0) return false;
    await requestBoardFullscreenIfAuto();
    realtimeCountdownEndsAt = currentRaceTimeMs() + Math.max(0, realtimePrepSeconds * 1000);
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
    updateResetButtonLabel();
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
    return true;
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

