  // -----------------------------
  // Инициализация / сброс
  // -----------------------------
  function resetBoats({ armRealtime=false, randomizeBehindStart=null } = {}){
    const n = clamp(parseInt(playerCountSelect.value,10) || PLAYER_COUNT_MIN, PLAYER_COUNT_MIN, PLAYER_COUNT_MAX);
    playerCountSelect.value = String(n);
    const previousBoats = boats.slice();
    const realtimeStartDepth = Math.min(PRESTART_DEPTH * 0.35, 1.25);
    const prestartNormal = prestartNormalUnit();
    const shouldRandomizeBehindStart = (randomizeBehindStart === null)
      ? isRealtimePlayMode()
      : !!randomizeBehindStart;

    boats = [];
    clearRealtimeBotDecisionCache();
    raceFinishedCount = 0;

    prestartRoundsSetting = 0;
    prestartRoundsLeft = 0;
    phase = isLocalRealtimeMode() ? "countdown" : "race";

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

    if (phase === "prestart" || shouldRandomizeBehindStart){
      placeBoatsBehindStartRandomly({
        minDepth: isRealtimePlayMode() ? 1.0 : 0.55,
        maxDepth: isRealtimePlayMode() ? Math.max(1.4, PRESTART_DEPTH * 0.9) : Math.max(0.9, PRESTART_DEPTH * 0.7),
      });
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
    subMovesLeft = 0;
    hybridRound = 1;
    hybridMovesLeft = [];
    resetLocalRealtimePauseState();
    multiplayerRealtimePauseStartedAtMs = 0;
    realtimeCountdownEndsAt = (isLocalRealtimeMode() && armRealtime)
      ? (currentRaceTimeMs() + (realtimePrepSeconds * 1000))
      : 0;
    realtimeCursorTarget = null;
    realtimeCursorDirection = null;
    realtimeCursorClient = null;
    activeRealtimePointerId = null;
    localRealtimeLastTickAt = 0;
    clearBotTurnTimer();
    botTurnInProgress = false;
    resetBoatTrails();
    clearGust();
    if (autoGustsEnabled){
      scheduleNextAutoGust(currentRaceTimeMs());
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
    return isRealtimePlayMode() && !isMultiplayerRoomActive();
  }

  function isRealtimeCountdown(){
    return isRealtimePlayMode() && phase === "countdown" && realtimeCountdownEndsAt > currentRaceTimeMs();
  }

  function isRealtimeRaceMode(){
    return isRealtimePlayMode() && phase === "race";
  }

  function canToggleLocalRealtimePause(){
    return isLocalRealtimeMode()
      && mode === "play"
      && (phase === "countdown" || phase === "race")
      && phase !== "finished"
      && !isRaceComplete();
  }

  function isLocalRealtimePaused(){
    return localRealtimePauseStartedAtMs > 0;
  }

  function setLocalRealtimePaused(nextPaused){
    if (nextPaused){
      if (!canToggleLocalRealtimePause() || isLocalRealtimePaused()) return false;
      localRealtimePauseStartedAtMs = Date.now();
      localRealtimeLastTickAt = 0;
      clearRealtimeIntent();
      clearRealtimeBotDecisionCache();
      for (const boat of boats){
        if (!boat) continue;
        boat.currentSpeedUnitsPerSec = 0;
      }
    } else {
      if (!isLocalRealtimePaused()) return false;
      localRealtimePausedDurationMs += Math.max(0, Date.now() - localRealtimePauseStartedAtMs);
      localRealtimePauseStartedAtMs = 0;
      localRealtimeLastTickAt = 0;
      clearRealtimeBotDecisionCache();
    }

    updateStatus();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
    return true;
  }

  function toggleLocalRealtimePause(){
    return setLocalRealtimePaused(!isLocalRealtimePaused());
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
    const finalMsLeft = Math.min(totalMsLeft, 3000);
    return {
      active: totalMsLeft > 0,
      totalMsLeft,
      prepMsLeft: Math.max(0, totalMsLeft - finalMsLeft),
      finalMsLeft,
      inFinal: finalMsLeft > 0 && totalMsLeft <= 3000
    };
  }

  function formatCountdownSeconds(ms){
    if (!Number.isFinite(ms) || ms <= 0) return "0.0";
    const seconds = ms / 1000;
    return seconds >= 10 ? String(Math.ceil(seconds)) : seconds.toFixed(1);
  }

  function realtimeControlledBoatIndex(){
    if (isMultiplayerObserver()) return null;
    if (isLocalBotsMode() && boats[LOCAL_HUMAN_SEAT]){
      return LOCAL_HUMAN_SEAT;
    }
    if (Number.isInteger(multiplayerSeatIndex)) return multiplayerSeatIndex;
    if (Number.isInteger(selectedBoatIndex)) return selectedBoatIndex;
    return boats.length ? 0 : null;
  }

  function setRealtimeReadyState(){
    if (!isLocalRealtimeMode()) return;
    resetLocalRealtimePauseState();
    phase = "countdown";
    realtimeCountdownEndsAt = 0;
    prestartRoundsLeft = 0;
    localRealtimeLastTickAt = 0;
    clearRealtimeBotDecisionCache();
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
    if (realtimeCursorTarget === null && realtimeCursorDirection === null && realtimeCursorClient === null) return;
    realtimeCursorTarget = null;
    realtimeCursorDirection = null;
    realtimeCursorClient = null;
    emitRealtimeIntentChanged();
  }

  function setRealtimeIntent(nextTarget, nextDirection, { emit=true } = {}){
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
    if (!same && emit) emitRealtimeIntentChanged();
  }

  function refreshRealtimeIntentFromPointer({ emit=false } = {}){
    if (!realtimeCursorClient || mode !== "play" || !isCursorSteeringMode()) return;
    const boatIdx = realtimeControlledBoatIndex();
    if (!Number.isInteger(boatIdx) || !boats[boatIdx] || boats[boatIdx].finished || phase === "finished"){
      return;
    }
    const point = screenToWorld(realtimeCursorClient.clientX, realtimeCursorClient.clientY);
    if (!point){
      return;
    }
    const boat = boats[boatIdx];
    const aim = { x: point.x - boat.x, y: point.y - boat.y };
    const direction = norm(aim);
    if (direction.L <= 1e-6){
      return;
    }
    setRealtimeIntent(point, { x: direction.x, y: direction.y }, { emit });
  }

  function isHybridPlayMode(){
    return false;
  }

  function isHybridRaceMode(){
    return phase === "race" && isHybridPlayMode();
  }

  function resetHybridState(){
    hybridRound = 1;
    hybridMovesLeft = [];
  }

  function allHybridMovesSpent(){
    return true;
  }

  function advanceHybridRound(){
    hybridRound = 1;
    hybridMovesLeft = [];
  }

  function stepsLeftForBoat(boatIdx){
    return 0;
  }

  function canBoatMoveNow(boatIdx){
    return false;
  }

  function canSelectBoatForPlay(boatIdx){
    if (!Number.isInteger(boatIdx)) return false;
    if (isMultiplayerObserver()) return false;
    if (isRealtimePlayMode()) {
      if (!boats[boatIdx] || boats[boatIdx].finished) return false;
      if (multiplayerSeatIndex !== null) return boatIdx === multiplayerSeatIndex;
      if (isLocalBotsMode()) return boatIdx === LOCAL_HUMAN_SEAT;
      return true;
    }
    if (!canBoatMoveNow(boatIdx)) return false;
    if (isLocalBotsMode()) {
      if (isRealtimePlayMode()) return boatIdx === LOCAL_HUMAN_SEAT;
      return boatIdx === LOCAL_HUMAN_SEAT && boatIdx === currentPlayer;
    }
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
        windAngleDeg: normalizedWindAngleDeg(),
        deadZoneDeg,
        snapThreshold,
        roundingSide,
        playMode,
        interactionMode,
        tackPenaltyFactor,
        turnRateDegPerSec,
        luffingSpeedPercent,
        botDifficulty,
        autoGustsEnabled,
        autoGustIntervalSec,
        autoGustDurationSec,
        realtimePrepSeconds,
        autoFullscreenMode,
        showWindArrow,
        showOptimal,
        showBestStart,
        showLaylines,
        showTrails,
        optimalBoatIndex,
        bestStartBoatIndex,
        finishSeparate,
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
        raceFinishedCount,
        realtimeCountdownEndsAt,
        gustExpiresAt,
        nextAutoGustAt,
        phase,
        realtimePaused: isMultiplayerRealtimePaused(),
        realtimePauseStartedAt: isMultiplayerRealtimePaused() ? multiplayerRealtimePauseStartedAtMs : 0,
        isLobbyPreview: false
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

  function normalizeMapBoatSnapshot(rawBoat, idx, maxWorld){
    const safeWorld = maxWorld || { width: worldW, height: worldH };
    return {
      x: clamp(Number.isFinite(rawBoat?.x) ? rawBoat.x : 0, 0, safeWorld.width),
      y: clamp(Number.isFinite(rawBoat?.y) ? rawBoat.y : 0, 0, safeWorld.height),
      distance: 0,
      turns: 0,
      penalties: 0,
      collisions: 0,
      nextMark: 0,
      finished: false,
      place: null,
      hasHeading: false,
      heading: 0,
      tack: 0,
      color: typeof rawBoat?.color === "string" ? rawBoat.color : BOAT_COLORS[idx % BOAT_COLORS.length],
      speedCoeff: boatSpeedCoeff(rawBoat || {}),
      currentSpeedUnitsPerSec: 0,
      penaltySlowUntil: 0,
      lastPenaltyAt: 0,
      lastPenaltyKey: "",
      lastPenaltyReason: "",
      roundInZone: false,
      roundSweep: 0,
      startDeltaMs: null,
      falseStartDeltaMs: null
    };
  }

  function normalizeMapState(snapshot){
    const exportedState = snapshot && typeof snapshot === "object"
      ? JSON.parse(JSON.stringify(snapshot))
      : exportGameState();
    const world = exportedState.world || {};
    const settings = exportedState.settings || {};
    const worldSnapshot = {
      width: clamp(parseFloat(world.width) || worldW, 8, WORLD_MAX),
      height: clamp(parseFloat(world.height) || worldH, 8, WORLD_MAX)
    };
    const moveBudget = 1;
    const prestartBudget = 0;
    const normalizedPlayMode = "realtime";
    const scenarioPhase = "countdown";
    const incomingBoats = Array.isArray(exportedState.boats) && exportedState.boats.length
      ? exportedState.boats.slice(0, PLAYER_COUNT_MAX)
      : exportGameState().boats;
    const normalizedBoats = incomingBoats.map((boat, idx) => normalizeMapBoatSnapshot(boat, idx, worldSnapshot));

    exportedState.version = 2;
    exportedState.world = worldSnapshot;
    exportedState.settings = {
      ...settings,
      playMode: normalizedPlayMode,
      movesPerTurn: moveBudget,
      prestartRoundsSetting: prestartBudget
    };
    exportedState.race = {
      raceFinishedCount: 0,
      realtimeCountdownEndsAt: 0,
      gustExpiresAt: 0,
      nextAutoGustAt: 0,
      phase: scenarioPhase
    };
    exportedState.boats = normalizedBoats;
    return exportedState;
  }

  function exportMapState(){
    return normalizeMapState(exportGameState());
  }

  function importGameState(snapshot){
    if (!snapshot || typeof snapshot !== "object") return;
    clearRealtimeBotDecisionCache();
    const previousPhase = phase;
    const preservedRealtimeIntent = (realtimeCursorClient || realtimeCursorTarget || realtimeCursorDirection)
      ? {
          client: realtimeCursorClient ? { ...realtimeCursorClient } : null,
          target: realtimeCursorTarget ? { ...realtimeCursorTarget } : null,
          direction: realtimeCursorDirection ? { ...realtimeCursorDirection } : null,
          pointerId: activeRealtimePointerId,
        }
      : null;

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

    setWindAngle(Number.isFinite(settings.windAngleDeg) ? settings.windAngleDeg : windAngleDeg);
    deadZoneDeg = clamp(parseFloat(settings.deadZoneDeg) || deadZoneDeg, 0, 180);
    snapThreshold = clamp(parseFloat(settings.snapThreshold) || snapThreshold, 0, 1);
    movesPerTurn = 1;
    roundingSide = (settings.roundingSide === "starboard") ? "starboard" : "port";
    playMode = "realtime";
    interactionMode = normalizeInteractionMode(settings.interactionMode);
    tackPenaltyFactor = clamp(parseFloat(settings.tackPenaltyFactor) || tackPenaltyFactor, 0.5, 1.0);
    const incomingLuffingSpeed = parseFloat(settings.luffingSpeedPercent);
    luffingSpeedPercent = clamp(
      Number.isFinite(incomingLuffingSpeed) ? incomingLuffingSpeed : luffingSpeedPercent,
      0,
      80
    );
    botDifficulty = normalizeBotDifficultyValue(settings.botDifficulty);
    autoGustsEnabled = !!settings.autoGustsEnabled;
    autoGustIntervalSec = clamp(parseFloat(settings.autoGustIntervalSec) || autoGustIntervalSec, 3, 60);
    autoGustDurationSec = clamp(parseFloat(settings.autoGustDurationSec) || autoGustDurationSec, 2, 30);
    realtimePrepSeconds = clamp(parseFloat(settings.realtimePrepSeconds) || realtimePrepSeconds, 0, 120);
    turnRateDegPerSec = clamp(parseFloat(settings.turnRateDegPerSec) || turnRateDegPerSec, 30, 360);
    autoFullscreenMode = settings.autoFullscreenMode === "race" ? "race" : "off";
    prestartRoundsSetting = 0;
    const importedViewSettings = {
      showWindArrow: settings.showWindArrow,
      showOptimal: settings.showOptimal,
      showBestStart: settings.showBestStart,
      showLaylines: settings.showLaylines,
      showTrails: settings.showTrails,
      optimalBoatIndex: settings.optimalBoatIndex,
      bestStartBoatIndex: settings.bestStartBoatIndex,
    };

    deadZoneInp.value = String(deadZoneDeg);
    snapThresholdInp.value = String(snapThreshold);
    movesPerTurnInp.value = String(movesPerTurn);
    roundingSideSelect.value = roundingSide;
    playModeSelect.value = playMode;
    if (interactionModeSelect) interactionModeSelect.value = interactionMode;
    tackPenaltyInp.value = String(tackPenaltyFactor);
    if (luffingSpeedInp) luffingSpeedInp.value = String(luffingSpeedPercent);
    if (botDifficultySelect) botDifficultySelect.value = botDifficulty;
    if (autoGustsSelect) autoGustsSelect.value = autoGustsEnabled ? "on" : "off";
    if (autoGustIntervalInp) autoGustIntervalInp.value = String(autoGustIntervalSec);
    if (autoGustDurationInp) autoGustDurationInp.value = String(autoGustDurationSec);
    if (realtimePrepInp) realtimePrepInp.value = String(realtimePrepSeconds);
    if (turnRateInp) turnRateInp.value = String(turnRateDegPerSec);
    if (autoFullscreenModeSelect) autoFullscreenModeSelect.value = autoFullscreenMode;
    prestartRoundsInp.value = "0";

    const hasExplicitBoatList = Array.isArray(snapshot.boats);
    const incomingBoats = hasExplicitBoatList ? snapshot.boats.slice(0, PLAYER_COUNT_MAX) : [];
    const previousTrails = boatTrails.map((trail) => Array.isArray(trail) ? trail.map((point) => ({ ...point })) : []);
    ensurePlayerCountOptions();
    const playerCount = hasExplicitBoatList
      ? clamp(incomingBoats.length, 0, PLAYER_COUNT_MAX)
      : clamp(
          parseInt(playerCountSelect.value,10) || PLAYER_COUNT_MIN,
          PLAYER_COUNT_MIN,
          PLAYER_COUNT_MAX
        );
    playerCountSelect.value = String(playerCount);
    resetBoats();

    boats = [];
    for (let i=0;i<playerCount;i++){
      boats.push(normalizeBoatSnapshot(incomingBoats[i], i));
    }

    phase = (race.phase === "countdown" || race.phase === "finished")
      ? race.phase
      : "race";
    const lobbyPreviewState = !!race.isLobbyPreview;
    const enteringOfficialRace = (previousPhase !== "race" || multiplayerLobbyPreview) && phase === "race" && !lobbyPreviewState;
    prestartRoundsLeft = 0;
    currentPlayer = Math.max(0, boats.findIndex((boat) => !boat.finished));
    raceFinishedCount = Math.max(0, parseInt(race.raceFinishedCount,10) || boats.filter((boat) => boat.finished).length);
    subMovesLeft = 0;
    hybridRound = 1;
    hybridMovesLeft = [];
    resetLocalRealtimePauseState();
    const importedPauseStartedAt = Math.max(0, parseInt(race.realtimePauseStartedAt,10) || 0);
    const importedMultiplayerPause = !!race.realtimePaused && importedPauseStartedAt > 0;
    multiplayerRealtimePauseStartedAtMs = importedMultiplayerPause ? importedPauseStartedAt : 0;
    realtimeCountdownEndsAt = Math.max(0, parseInt(race.realtimeCountdownEndsAt,10) || 0);
    gustExpiresAt = Math.max(0, parseInt(race.gustExpiresAt,10) || 0);
    nextAutoGustAt = Math.max(0, parseInt(race.nextAutoGustAt,10) || 0);
    if (autoGustsEnabled && !gustRect && nextAutoGustAt === 0){
      scheduleNextAutoGust(currentRaceTimeMs());
    }
    const resetTrails = (
      previousTrails.length !== boats.length
      || phase === "countdown"
      || phase === "prestart"
      || lobbyPreviewState
      || enteringOfficialRace
    );
    boatTrails = boats.map((boat, index) => {
      const trail = resetTrails
        ? []
        : (previousTrails[index] || [])
          .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
          .map((point) => ({ x: point.x, y: point.y }));
      if (!trail.length){
        trail.push({ x: boat.x, y: boat.y });
      } else {
        const last = trail[trail.length - 1];
        if (!last || !Number.isFinite(last.x) || !Number.isFinite(last.y)){
          trail.push({ x: boat.x, y: boat.y });
        } else if (dist(last, boat) >= BOAT_TRAIL_MIN_POINT_DISTANCE){
          trail.push({ x: boat.x, y: boat.y });
        }
      }
      return trimBoatTrail(trail);
    });
    if (importedMultiplayerPause){
      realtimeCursorTarget = null;
      realtimeCursorDirection = null;
      realtimeCursorClient = null;
      activeRealtimePointerId = null;
      for (const boat of boats){
        boat.currentSpeedUnitsPerSec = 0;
      }
    }
    applySharedViewSettings(importedViewSettings, { renderView:false });

    selectedBoatIndex = (isLocalBotsMode() && boats[LOCAL_HUMAN_SEAT]) ? LOCAL_HUMAN_SEAT : null;
    placementSelectedBoat = null;
    startAwaitSecond = false;
    finishAwaitSecond = false;
    localRealtimeLastTickAt = 0;
    clearBotTurnTimer();
    botTurnInProgress = false;
    if (!isCursorSteeringMode() || importedMultiplayerPause){
      realtimeCursorTarget = null;
      realtimeCursorDirection = null;
      realtimeCursorClient = null;
      activeRealtimePointerId = null;
    } else {
      realtimeCursorClient = preservedRealtimeIntent?.client ? { ...preservedRealtimeIntent.client } : null;
      realtimeCursorTarget = preservedRealtimeIntent?.target ? { ...preservedRealtimeIntent.target } : null;
      realtimeCursorDirection = preservedRealtimeIntent?.direction ? { ...preservedRealtimeIntent.direction } : null;
      activeRealtimePointerId = Number.isInteger(preservedRealtimeIntent?.pointerId)
        ? preservedRealtimeIntent.pointerId
        : null;
      if (realtimeCursorClient){
        refreshRealtimeIntentFromPointer({ emit:false });
      }
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
    scheduleLocalBotTurn();
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

