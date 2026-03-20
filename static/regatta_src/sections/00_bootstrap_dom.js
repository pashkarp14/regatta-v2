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
  const btnRandomCourse = document.getElementById("randomCourse");

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
  const turnRateInp = document.getElementById("turnRateDegPerSec");
  const luffingSpeedInp = document.getElementById("luffingSpeedPercent");
  const botDifficultySelect = document.getElementById("botDifficulty");
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
  const btnWindArrow = document.getElementById("toggleWindArrow");
  const btnGust      = document.getElementById("randomGust");
  const btnClearGust = document.getElementById("clearGust");
  const btnReset     = document.getElementById("resetGame");
  const btnOptimal   = document.getElementById("toggleOptimal");
  const optimalBoatTargetControl = document.getElementById("optimalBoatTargetControl");
  const optimalBoatTargetSelect = document.getElementById("optimalBoatTarget");
  const btnBestStart = document.getElementById("bestStart");
  const bestStartBoatTargetControl = document.getElementById("bestStartBoatTargetControl");
  const bestStartBoatTargetSelect = document.getElementById("bestStartBoatTarget");
  const btnLaylines  = document.getElementById("toggleLaylines");
  const btnTrails    = document.getElementById("toggleTrails");
  const btnFullscreen = document.getElementById("toggleFullscreen");
  const btnBoardStart = document.getElementById("boardStartAction");

