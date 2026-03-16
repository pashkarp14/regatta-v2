  // -----------------------------
  // Старт приложения
  // -----------------------------
  function init(){
    gridColsInput.value = gridColsInput.value || String(DEFAULT_WORLD_W);
    gridRowsInput.value = gridRowsInput.value || String(DEFAULT_WORLD_H);

    ensurePlayerCountOptions();
    markCount = parseInt(markCountSelect.value,10);
    ensureMarkOptions();
    ensureScenarioLegOptions();

    deadZoneDeg = clamp(parseFloat(deadZoneInp.value)||40, 0, 180);
    snapThreshold = clamp(parseFloat(snapThresholdInp.value)||0.8, 0, 1);
    movesPerTurn = clamp(parseInt(movesPerTurnInp.value,10)||1, 1, 10);
    tackPenaltyFactor = clamp(parseFloat(tackPenaltyInp.value)||0.95, 0.5, 1.0);
    const initialLuffingSpeed = parseFloat(luffingSpeedInp?.value);
    luffingSpeedPercent = clamp(Number.isFinite(initialLuffingSpeed) ? initialLuffingSpeed : 25, 0, 80);
    botDifficulty = normalizeBotDifficultyValue(botDifficultySelect?.value);
    if (botDifficultySelect) botDifficultySelect.value = botDifficulty;
    autoGustsEnabled = autoGustsSelect?.value === "on";
    autoGustIntervalSec = clamp(parseFloat(autoGustIntervalInp?.value) || 10, 3, 60);
    autoGustDurationSec = clamp(parseFloat(autoGustDurationInp?.value) || 6, 2, 30);
    realtimePrepSeconds = clamp(parseFloat(realtimePrepInp?.value) || DEFAULT_REALTIME_PREP_SECONDS, 0, 120);
    turnRateDegPerSec = clamp(parseFloat(turnRateInp?.value) || 120, 30, 360);
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

    resizeBoardCanvas({ preserveView:false, resetView:true });

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
