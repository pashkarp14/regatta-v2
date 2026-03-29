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
    subMovesLeft = 0;
    selectedBoatIndex = boats[currentPlayer]?.finished ? null : currentPlayer;
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
    playModeSelect.value = "realtime";
    playMode = "realtime";
    resetLocalRealtimePauseState();
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
    prestartRoundsSetting = 0;
    prestartRoundsInp.value = "0";
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
    movesPerTurn = 1;
    movesPerTurnInp.value = "1";
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

  luffingSpeedInp?.addEventListener("change", () => {
    const nextValue = parseFloat(luffingSpeedInp.value);
    luffingSpeedPercent = clamp(Number.isFinite(nextValue) ? nextValue : 25, 0, 80);
    luffingSpeedInp.value = String(luffingSpeedPercent);
    updateOptInfo();
    render();
    emitStateChanged();
  });

  botDifficultySelect?.addEventListener("change", () => {
    botDifficulty = normalizeBotDifficultyValue(botDifficultySelect.value);
    botDifficultySelect.value = botDifficulty;
    clearRealtimeBotDecisionCache();
    updateStatus();
    updateStats();
    render();
    emitStateChanged();
  });

  autoGustsSelect?.addEventListener("change", () => {
    autoGustsEnabled = autoGustsSelect.value === "on";
    if (autoGustsEnabled){
      if (!gustRect){
        scheduleNextAutoGust(currentRaceTimeMs());
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
      scheduleNextAutoGust(currentRaceTimeMs());
    }
    updateWindInfo();
    emitStateChanged();
  });

  autoGustDurationInp?.addEventListener("change", () => {
    autoGustDurationSec = clamp(parseFloat(autoGustDurationInp.value) || 6, 2, 30);
    autoGustDurationInp.value = String(autoGustDurationSec);
    if (gustRect){
      gustExpiresAt = currentRaceTimeMs() + autoGustDurationSec * 1000;
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
    setWindAngle(windAngleDeg - WIND_STEP);
    updateWindInfo();
    invalidateSolutions();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  btnWindRight.addEventListener("click", () => {
    setWindAngle(windAngleDeg + WIND_STEP);
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
      scheduleNextAutoGust(currentRaceTimeMs());
    }
    updateWindInfo();
    invalidateSolutions();
    updateOptInfo();
    render();
    emitStateChanged();
  });

  btnOptimal.addEventListener("click", () => {
    if (mode !== "play") setMode("play");
    const nextShowOptimal = !showOptimal;
    applySharedViewSettings({
      showOptimal: nextShowOptimal,
      optimalBoatIndex: multiplayerSessionActive
        ? (nextShowOptimal ? (optimalBoatTargetSelect?.value ?? optimalHintTargetBoatIndex()) : null)
        : optimalBoatIndex,
    }, { emit:true });
  });

  realtimePrepInp?.addEventListener("change", () => {
    realtimePrepSeconds = clamp(parseFloat(realtimePrepInp.value) || DEFAULT_REALTIME_PREP_SECONDS, 0, 120);
    realtimePrepInp.value = String(realtimePrepSeconds);
    emitStateChanged();
  });

  turnRateInp?.addEventListener("change", () => {
    turnRateDegPerSec = clamp(parseFloat(turnRateInp.value) || 120, 30, 360);
    turnRateInp.value = String(turnRateDegPerSec);
    emitStateChanged();
  });

  btnBestStart.addEventListener("click", () => {
    const nextShowBestStart = !showBestStart;
    applySharedViewSettings({
      showBestStart: nextShowBestStart,
      bestStartBoatIndex: multiplayerSessionActive
        ? (nextShowBestStart ? (bestStartBoatTargetSelect?.value ?? bestStartHintTargetBoatIndex()) : null)
        : bestStartBoatIndex,
    }, { emit:true });
  });

  optimalBoatTargetSelect?.addEventListener("change", () => {
    applySharedViewSettings({ optimalBoatIndex: optimalBoatTargetSelect.value }, { emit:true, renderView:true });
  });

  bestStartBoatTargetSelect?.addEventListener("change", () => {
    applySharedViewSettings({ bestStartBoatIndex: bestStartBoatTargetSelect.value }, { emit:true, renderView:true });
  });

  btnLaylines?.addEventListener("click", () => {
    applySharedViewSettings({ showLaylines: !showLaylines }, { emit:true });
  });

  btnTrails?.addEventListener("click", () => {
    applySharedViewSettings({ showTrails: !showTrails }, { emit:true });
  });

  btnWindArrow?.addEventListener("click", () => {
    applySharedViewSettings({ showWindArrow: !showWindArrow }, { emit:true });
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
    await handleResetAction({
      randomizeBehindStart: true,
      armRealtime: isLocalRealtimeMode(),
    });
  });

  btnRandomCourse?.addEventListener("click", () => {
    applyRandomCourse();
  });

  applyGridBtn.addEventListener("click", () => {
    applyWorldSize();
    invalidateSolutions();
    updateStatus();
    updateStats();
    updateOptInfo();
  });

  function renderGameToText(){
    const payload = {
      mode,
      phase,
      realtimePaused: isRealtimePaused(),
      playMode,
      localPilotMode,
      botDifficulty,
      world: { width: worldW, height: worldH, origin: "bottom-left" },
      race: {
        raceFinishedCount,
        realtimeCountdownEndsAt,
        realtimePaused: isRealtimePaused(),
      },
      view: sharedViewSettingsSnapshot(),
      boats: boats.map((boat, index) => ({
        trailPoints: Array.isArray(boatTrails[index]) ? boatTrails[index].length : 0,
        trailStart: Array.isArray(boatTrails[index]) && boatTrails[index][0]
          ? {
              x: Number(boatTrails[index][0].x.toFixed(3)),
              y: Number(boatTrails[index][0].y.toFixed(3)),
            }
          : null,
        trailEnd: Array.isArray(boatTrails[index]) && boatTrails[index][boatTrails[index].length - 1]
          ? {
              x: Number(boatTrails[index][boatTrails[index].length - 1].x.toFixed(3)),
              y: Number(boatTrails[index][boatTrails[index].length - 1].y.toFixed(3)),
            }
          : null,
        index,
        x: Number(boat.x.toFixed(3)),
        y: Number(boat.y.toFixed(3)),
        nextMark: boat.nextMark,
        finished: boat.finished,
        place: boat.place,
        selected: index === selectedBoatIndex,
        controller: isBotControlledBoat(index) ? "bot" : "human",
      })),
      course: {
        marks: marks.slice(0, markCount).map((mark, index) => ({
          index,
          x: Number(mark.x.toFixed(3)),
          y: Number(mark.y.toFixed(3)),
        })),
        startA: { x: Number(startA.x.toFixed(3)), y: Number(startA.y.toFixed(3)) },
        startB: { x: Number(startB.x.toFixed(3)), y: Number(startB.y.toFixed(3)) },
      },
    };
    return JSON.stringify(payload);
  }

  function advanceTime(ms){
    const totalMs = Math.max(0, Number(ms) || 0);
    const stepMs = 1000 / 60;
    const steps = Math.max(1, Math.round(totalMs / stepMs));
    for (let i=0; i<steps; i++){
      simulateLocalRealtimeTick(stepMs / 1000);
    }
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
  }

  function debugWorldToClient(point){
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const screenPoint = worldToScreen(point);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + screenPoint.x * (rect.width / canvas.width),
      y: rect.top + screenPoint.y * (rect.height / canvas.height)
    };
  }

  function debugMoveTargets(boatIdx=selectedBoatIndex ?? 0){
    const boat = boats[boatIdx];
    if (!boat || boat.finished) return [];

    const unique = new Map();
    for (const dir of DIRS){
      const probe = {
        x: boat.x + dir.ux * STEP_RADIUS_BASE * 2,
        y: boat.y + dir.uy * STEP_RADIUS_BASE * 2
      };
      const dest = proposeDestination(boatIdx, probe);
      if (!dest) continue;
      const key = `${dest.x.toFixed(3)},${dest.y.toFixed(3)}`;
      if (unique.has(key)) continue;
      unique.set(key, {
        x: Number(dest.x.toFixed(3)),
        y: Number(dest.y.toFixed(3)),
        client: debugWorldToClient(dest)
      });
    }

    return Array.from(unique.values());
  }

  window.render_game_to_text = renderGameToText;
  window.advanceTime = advanceTime;

  window.RegattaApp = {
    exportState: exportGameState,
    exportMapState,
    importState: importGameState,
    normalizeMapState,
    fingerprintState: fingerprintGameState,
    renderGameToText,
    advanceTime,
    debugWorldToClient,
    debugMoveTargets,
    render,
    setMode,
    setLocalPilotMode,
    getLocalPilotMode: () => localPilotMode,
    requestBoardFullscreenIfAuto,
    requestBoardFullscreen,
    exitBoardFullscreen,
    isBoardFullscreenActive: isFullscreenActive,
    armLocalRealtimeStart,
    canToggleLocalRealtimePause,
    isLocalRealtimePaused,
    isRealtimePaused,
    toggleLocalRealtimePause,
    resetRaceToReadyState: handleResetAction,
    clearRealtimeIntent,
    setServerClockOffset,
    setBoardStartActionOverride,
    triggerBoardStartAction,
    setMultiplayerContext: ({ active=false, seatIndex=null, observer=false, lobbyPreview=false, host=false } = {}) => {
      multiplayerSessionActive = !!active;
      multiplayerSeatIndex = multiplayerSessionActive && Number.isInteger(seatIndex) ? seatIndex : null;
      multiplayerObserverMode = multiplayerSessionActive && !!observer;
      multiplayerHostMode = multiplayerSessionActive && !!host;
      multiplayerLobbyPreview = multiplayerSessionActive && !!lobbyPreview;
      if (!multiplayerSessionActive){
        multiplayerRealtimePauseStartedAtMs = 0;
      }
      localRealtimeLastTickAt = 0;
      if (!isLocalRealtimeMode()){
        resetLocalRealtimePauseState();
      }
      clearBotTurnTimer();
      if (multiplayerObserverMode){
        selectedBoatIndex = null;
      }
      const candidateBoat = Number.isInteger(selectedBoatIndex) ? selectedBoatIndex : multiplayerSeatIndex;
      if (multiplayerSeatIndex !== null && !canSelectBoatForPlay(candidateBoat)){
        selectedBoatIndex = null;
      }
      if (multiplayerSeatIndex === null && isLocalBotsMode()){
        selectedBoatIndex = LOCAL_HUMAN_SEAT;
      }
      if (isCursorSteeringMode() && !Number.isInteger(realtimeControlledBoatIndex())){
        clearRealtimeIntent();
      }
      if (isLocalRealtimeMode() && phase === "race" && boats.every((boat) => !boat.hasHeading && !boat.finished)){
        setRealtimeReadyState();
      }
      refreshSharedViewSolutions();
      updateResetButtonLabel();
      updateStatus();
      updateStats();
      render();
      scheduleLocalBotTurn();
    },
    getRealtimeIntent: () => {
      if (!isCursorSteeringMode()) return null;
      refreshRealtimeIntentFromPointer({ emit:false });
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
      playMode,
      interactionMode,
      realtimeCountdownEndsAt,
      playerCount: boats.length,
      phase: isRealtimePaused() ? "paused" : phase,
      realtimePaused: isRealtimePaused(),
      markCount,
      localPilotMode,
      botDifficulty
    }),
    getSharedViewSettings: sharedViewSettingsSnapshot,
    setSharedViewSettings: (settings, options={}) => applySharedViewSettings(settings, options),
  };

  setInterval(() => {
    if (isRealtimeCountdown()){
      updateStatus();
      render();
    }
  }, 120);

  window.requestAnimationFrame(runLocalRealtimeLoop);

