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

  function normalizeBotDifficultyValue(rawValue){
    return (rawValue === "easy" || rawValue === "hard") ? rawValue : "normal";
  }

  const BOT_DIFFICULTY_PROFILES = {
    easy: {
      turnRateScale: 0.78,
      decisionMs: 980,
      aimJitterDeg: 7,
      scoreNoise: 0.18,
      routeSlack: 0.03,
      favoredEndBias: 0.62,
      clusterWidth: 0.28,
      earlyDepth: 1.7,
      lateDepth: 0.72,
      lineMargin: 0.62
    },
    normal: {
      turnRateScale: 0.84,
      decisionMs: 700,
      aimJitterDeg: 5,
      scoreNoise: 0.12,
      routeSlack: 0.01,
      favoredEndBias: 0.76,
      clusterWidth: 0.20,
      earlyDepth: 1.45,
      lateDepth: 0.48,
      lineMargin: 0.46
    },
    hard: {
      turnRateScale: 0.92,
      decisionMs: 480,
      aimJitterDeg: 4,
      scoreNoise: 0.05,
      routeSlack: 0,
      favoredEndBias: 0.76,
      clusterWidth: 0.2,
      earlyDepth: 1.35,
      lateDepth: 0.36,
      lineMargin: 0.38
    }
  };

  let snapThreshold = parseFloat(snapThresholdInp.value); // 0..1
  let movesPerTurn  = parseInt(movesPerTurnInp.value,10) || 1;
  let roundingSide  = roundingSideSelect.value; // "port" | "starboard"
  let playMode = normalizePlayModeValue(playModeSelect?.value);
  let interactionMode = normalizeInteractionMode(interactionModeSelect?.value);
  let tackPenaltyFactor = parseFloat(tackPenaltyInp.value); // 0.5..1
  let autoGustsEnabled = autoGustsSelect?.value === "on";
  let autoGustIntervalSec = parseFloat(autoGustIntervalInp?.value) || 10;
  let autoGustDurationSec = parseFloat(autoGustDurationInp?.value) || 6;
  const DEFAULT_REALTIME_PREP_SECONDS = 18;
  let realtimePrepSeconds = clamp(parseFloat(realtimePrepInp?.value) || DEFAULT_REALTIME_PREP_SECONDS, 0, 120);
  let turnRateDegPerSec = clamp(parseFloat(turnRateInp?.value) || 120, 30, 360);
  let luffingSpeedPercent = clamp(parseFloat(luffingSpeedInp?.value) || 25, 0, 80);
  let botDifficulty = normalizeBotDifficultyValue(botDifficultySelect?.value);
  let autoFullscreenMode = autoFullscreenModeSelect?.value === "race" ? "race" : "off";
  let showLaylines = false;
  let showTrails = false;
  let boardStartActionOverride = null;
  let serverClockOffsetMs = 0;

  function updateWindInfo(){
    const gustMode = autoGustsEnabled ? "авто" : (gustRect ? "порыв" : "штиль");
    windInfoEl.textContent = `Ветер: ${normalizedWindAngleDeg().toFixed(0)}° откуда дует · ${gustMode}`;
  }

  function currentRaceTimeMs(){
    return Date.now() + serverClockOffsetMs;
  }

  function setServerClockOffset(offsetMs=0){
    serverClockOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0;
  }

  function normalizedWindAngleDeg(rawDeg=windAngleDeg){
    return normalizeDegrees(Number.isFinite(rawDeg) ? rawDeg : 0);
  }

  function setWindAngle(nextAngleDeg){
    windAngleDeg = normalizedWindAngleDeg(nextAngleDeg);
    return windAngleDeg;
  }

  // 0° = ветер приходит с верхней кромки поля и дует вниз по экрану.
  function windFromVec(){
    const t = normalizedWindAngleDeg() * Math.PI / 180;
    return { x: -Math.sin(t), y: Math.cos(t) };
  }

  function downwindVec(){
    const windFrom = windFromVec();
    return { x: -windFrom.x, y: -windFrom.y };
  }
  function upwindVec(){ return windFromVec(); }
  function deadZoneHalfAngleRad(){
    return (clamp(deadZoneDeg, 0, 180) * Math.PI / 180) / 2;
  }
  function realtimeLuffingSpeedFactor(){
    return clamp(luffingSpeedPercent / 100, 0, 0.95);
  }
  function realtimeSpeedFactorForAngle(angleRad){
    const halfDead = deadZoneHalfAngleRad();
    if (halfDead <= 1e-6) return 1;
    const softness = Math.max(2, REALTIME_DEADZONE_SOFTNESS_DEG) * Math.PI / 180;
    const luffFactor = realtimeLuffingSpeedFactor();
    if (angleRad <= halfDead){
      const insideRatio = clamp(angleRad / halfDead, 0, 1);
      return clamp(luffFactor * (0.45 + insideRatio * 0.55), 0, 1);
    }
    return clamp(
      luffFactor + ((angleRad - halfDead) / softness) * (1 - luffFactor),
      luffFactor,
      1
    );
  }
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
    return a < deadZoneHalfAngleRad();
  }

