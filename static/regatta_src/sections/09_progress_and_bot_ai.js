  // -----------------------------
  // Прогресс/финиш/смена игрока
  // -----------------------------
  function botGoalPointForBoat(boat){
    if (!boat) return null;
    if (boat.nextMark < markCount){
      return marks[boat.nextMark] || null;
    }
    const [finishLeft, finishRight] = finishLine();
    return midpoint(finishLeft, finishRight);
  }

  function roundingSideSign(){
    return roundingSide === "port" ? 1 : -1;
  }

  function roundingProgressForBoat(boat){
    const sweep = Number.isFinite(boat?.roundSweep) ? boat.roundSweep : 0;
    return roundingSide === "port" ? sweep : -sweep;
  }

  function botGoalPointAfterMark(markIdx){
    if (markIdx + 1 < markCount){
      return marks[markIdx + 1] || null;
    }
    const [finishLeft, finishRight] = finishLine();
    return midpoint(finishLeft, finishRight);
  }

  function pointAroundMark(markPos, angle, radius){
    return {
      x: clamp(markPos.x + Math.cos(angle) * radius, 0, worldW),
      y: clamp(markPos.y + Math.sin(angle) * radius, 0, worldH)
    };
  }

  function botControlledBoatIndices(){
    const controlled = [];
    for (let i=0; i<boats.length; i++){
      if (isBotControlledBoat(i) && !boats[i]?.finished){
        controlled.push(i);
      }
    }
    return controlled;
  }

  function favoredStartEndIsB(){
    const wind = upwindVec();
    const scoreA = startA.x * wind.x + startA.y * wind.y;
    const scoreB = startB.x * wind.x + startB.y * wind.y;
    return scoreB >= scoreA;
  }

  function realtimeBotCountdownGuideTarget(boat, boatIdx, now=currentRaceTimeMs()){
    if (!boat || boat.finished || phase !== "countdown" || realtimeCountdownEndsAt <= now){
      return null;
    }

    const profile = botSkillProfile(boatIdx);
    const d = startLineDirUnit();
    const n = prestartNormalUnit();
    const lineLen = lineLengthUnits(startA, startB);
    if (lineLen <= 1e-6){
      return null;
    }

    const controlled = botControlledBoatIndices();
    const rank = Math.max(0, controlled.indexOf(boatIdx));
    const count = Math.max(1, controlled.length);
    const slotCenter = favoredStartEndIsB() ? profile.favoredEndBias : (1 - profile.favoredEndBias);
    const slotSpread = count > 1 ? profile.clusterWidth : 0;
    const slotOffset = count > 1 ? ((rank / (count - 1)) - 0.5) * slotSpread : 0;
    const driftNoise = (stableNoise01((boatIdx + 1) * 43.77) - 0.5) * Math.min(1.4, lineLen * 0.04);
    const jockey = Math.sin(now / 1100 + boatIdx * 0.9) * Math.min(0.42, lineLen * 0.015);
    const alongFraction = clamp(slotCenter + slotOffset, 0.06, 0.94);
    const along = clamp(lineLen * alongFraction + driftNoise + jockey, lineLen * 0.05, lineLen * 0.95);

    const totalMs = Math.max(1000, realtimePrepSeconds * 1000);
    const msLeft = Math.max(0, realtimeCountdownEndsAt - now);
    const urgency = 1 - clamp(msLeft / totalMs, 0, 1);
    let depth = clamp(mix(profile.earlyDepth, profile.lateDepth, urgency), 0.2, PRESTART_DEPTH - 0.08);
    const currentMargin = Math.max(0, -startLineSideValue(boat));
    if (msLeft <= 4200 && currentMargin < profile.lineMargin){
      depth = Math.max(depth, profile.lineMargin + 0.12);
    }
    if (startLineSideValue(boat) > -0.04){
      depth = Math.max(depth, profile.lineMargin + 0.32);
    }

    return {
      x: clamp(startA.x + d.x * along + n.x * depth, 0, worldW),
      y: clamp(startA.y + d.y * along + n.y * depth, 0, worldH)
    };
  }

  function applyBotDirectionBias(direction, boatIdx, now, scale=1){
    const profile = botSkillProfile(boatIdx);
    const jitterDeg = clamp(profile.aimJitterDeg * scale, 0, 24);
    if (jitterDeg <= 0.01){
      return direction;
    }
    const jitterSeed = Math.floor(now / 850) + (boatIdx + 1) * 19;
    const jitterAngle = ((stableNoise01(jitterSeed) * 2) - 1) * (jitterDeg * Math.PI / 180);
    return rotateVec(direction, jitterAngle);
  }

  function realtimeBotRoundingGuideTarget(boat){
    if (!boat || boat.finished || boat.nextMark >= markCount) return null;
    const markPos = marks[boat.nextMark];
    if (!markPos) return null;

    const fromMark = norm({ x: boat.x - markPos.x, y: boat.y - markPos.y });
    if (fromMark.L <= 1e-6) return null;

    const distanceToMark = fromMark.L;
    const activationRadius = ROUND_PASS_RADIUS + 12;
    if (!boat.roundInZone && distanceToMark > activationRadius){
      return null;
    }

    const sideSign = roundingSideSign();
    const baseAngle = Math.atan2(boat.y - markPos.y, boat.x - markPos.x);
    const safeInnerRadius = MARK_RADIUS + BOAT_SWEEP_RADIUS + MARK_CLEARANCE_MARGIN + 0.5;
    const orbitRadius = clamp(ROUND_PASS_RADIUS - 0.28, safeInnerRadius, ROUND_PASS_RADIUS - 0.05);
    const exitRadius = ROUND_PASS_RADIUS + 1.15;
    const progress = roundingProgressForBoat(boat);

    if (!boat.roundInZone){
      const leadAngle = baseAngle + sideSign * Math.PI / 3;
      return pointAroundMark(markPos, leadAngle, orbitRadius);
    }

    if (progress < ROUNDING_MIN_SWEEP + Math.PI / 10){
      const orbitAngle = baseAngle + sideSign * Math.PI / 3;
      return pointAroundMark(markPos, orbitAngle, orbitRadius);
    }

    const nextGoal = botGoalPointAfterMark(boat.nextMark) || botGoalPointForBoat(boat);
    const nextGoalAngle = nextGoal
      ? Math.atan2(nextGoal.y - markPos.y, nextGoal.x - markPos.x)
      : baseAngle;
    const exitAngle = baseAngle + sideSign * Math.PI / 4;
    const blendedAngle = angleWrap(exitAngle * 0.65 + nextGoalAngle * 0.35);
    return pointAroundMark(markPos, blendedAngle, exitRadius);
  }

  function chooseBotDestination(boatIdx){
    const boat = boats[boatIdx];
    if (!boat || boat.finished) return null;
    const profile = botSkillProfile(boatIdx);

    const planned = planOptimalFrom(
      { x: boat.x, y: boat.y },
      clamp(boat.nextMark, 0, markCount),
      boat.hasHeading ? boat.heading : null,
      boat.tack,
      "course",
      boatIdx,
      boatSpeedCoeff(boat),
    );
    if (planned?.path?.length >= 2){
      const plannedDest = proposeDestination(boatIdx, planned.path[1]);
      const skipOptimal = stableNoise01((boatIdx + 1) * 31.7 + (boat.turns + 1) * 2.1 + boat.nextMark * 7.3) < profile.routeSlack;
      if (plannedDest && !skipOptimal){
        return plannedDest;
      }
    }

    const goal = botGoalPointForBoat(boat);
    if (!goal) return null;

    const toGoal = norm({ x: goal.x - boat.x, y: goal.y - boat.y });
    const baseDirection = toGoal.L > 1e-6 ? { x: toGoal.x, y: toGoal.y } : boatAxisUnit(boat.heading, boat.hasHeading);
    const searchAngles = [
      0,
      Math.PI / 18,
      -Math.PI / 18,
      Math.PI / 9,
      -Math.PI / 9,
      Math.PI / 6,
      -Math.PI / 6,
      Math.PI / 4,
      -Math.PI / 4,
      Math.PI / 3,
      -Math.PI / 3,
      Math.PI / 2,
      -Math.PI / 2,
      Math.PI,
    ];

    let bestDest = null;
    let bestScore = Infinity;
    for (const angle of searchAngles){
      const dir = rotateVec(baseDirection, angle);
      const testPoint = {
        x: boat.x + dir.x * STEP_RADIUS_BASE * 2,
        y: boat.y + dir.y * STEP_RADIUS_BASE * 2,
      };
      const dest = proposeDestination(boatIdx, testPoint);
      if (!dest){
        continue;
      }

      const remaining = dist(dest, goal);
      const heading = Math.atan2(dest.y - boat.y, dest.x - boat.x);
      const route = planOptimalFrom(
        { x: dest.x, y: dest.y },
        clamp(boat.nextMark, 0, markCount),
        heading,
        tackSignFromHeadingVec({ x: dest.x - boat.x, y: dest.y - boat.y }),
        "course",
        boatIdx,
        boatSpeedCoeff(boat),
      );
      const routePenalty = route?.distance ?? remaining;
      const decisionNoise = ((stableNoise01((boatIdx + 1) * 9.7 + angle * 13 + boat.nextMark * 5.1) * 2) - 1) * profile.scoreNoise;
      const score = remaining + routePenalty * 0.45 + Math.abs(angle) * 0.12 + decisionNoise;
      if (score < bestScore){
        bestScore = score;
        bestDest = dest;
      }
    }

    return bestDest;
  }

  function addRealtimeDirectionCandidate(candidates, candidate){
    if (!candidate) return;
    const normalized = norm(candidate);
    if (normalized.L <= 1e-6) return;
    const direction = { x: normalized.x, y: normalized.y };
    if (candidates.some((existing) => existing.x * direction.x + existing.y * direction.y > 0.999)){
      return;
    }
    candidates.push(direction);
  }

  function realtimeSuperbotPlannerGuideTarget(boat, boatIdx){
    if (!boat || boat.finished) return null;
    const planned = planOptimalFrom(
      { x: boat.x, y: boat.y },
      clamp(boat.nextMark, 0, markCount),
      boat.hasHeading ? boat.heading : null,
      boat.tack,
      "course",
      boatIdx,
      boatSpeedCoeff(boat),
    );
    if (!planned?.path?.length) return null;

    const guidePoint = planned.path.find((point, index) => (
      index > 0
      && point
      && Number.isFinite(point.x)
      && Number.isFinite(point.y)
      && dist(point, boat) >= 1.05
    )) || planned.path[Math.min(2, planned.path.length - 1)] || planned.path[planned.path.length - 1];
    if (!guidePoint || !Number.isFinite(guidePoint.x) || !Number.isFinite(guidePoint.y)) return null;
    return {
      x: clamp(guidePoint.x, 0, worldW),
      y: clamp(guidePoint.y, 0, worldH)
    };
  }

  function scoreRealtimeBotDirection(boat, direction, directToTarget, target, options={}){
    const position = { x: boat.x, y: boat.y };
    const boatIdx = Number.isInteger(options.boatIdx) ? options.boatIdx : -1;
    const profile = boatIdx >= 0 ? botSkillProfile(boatIdx) : currentBotDifficultyProfile();
    const countdownTarget = !!options.countdownTarget;
    const roundingGuide = !!options.roundingGuide;
    const noiseScale = (countdownTarget || roundingGuide) ? profile.scoreNoise * 0.22 : profile.scoreNoise;
    const angleToWind = angleBetween(direction, upwindVec());
    const halfDead = deadZoneHalfAngleRad();
    const reverseMode = angleToWind <= halfDead * 0.5;
    const stallMargin = 8 * Math.PI / 180;
    const speedFactor = reverseMode ? 0.08 : realtimeSpeedFactorForAngle(angleToWind);
    const motionDirection = reverseMode
      ? { x: -direction.x, y: -direction.y }
      : direction;
    const lookaheadDistance = clamp(
      Math.max(2.8, REALTIME_SPEED_UNITS_PER_SEC * 2.4, dist(position, target) * 0.35),
      2.8,
      7.2
    );
    const intendedTravel = lookaheadDistance * Math.max(reverseMode ? 0.16 : speedFactor, 0.18);
    const projected = clampAlongRayToField(position, motionDirection, intendedTravel);
    const progress = dist(position, target) - dist(projected, target);
    const targetPenalty = angleBetween(direction, directToTarget) * 0.85;
    const headingPenalty = boat.hasHeading
      ? Math.abs(angleWrap(Math.atan2(direction.y, direction.x) - boat.heading)) * 0.08
      : 0;
    const nextTack = tackSignFromHeadingVec(direction);
    const tackPenalty = (boat.hasHeading && boat.tack !== 0 && nextTack !== 0 && nextTack !== boat.tack)
      ? 0.45
      : 0;
    const boundaryPenalty = dist(position, projected) < intendedTravel * 0.6 ? 1.4 : 0;
    const reversePenalty = reverseMode ? 5.5 : 0;
    const luffPenalty = Math.max(0, halfDead - angleToWind) * 14;
    const stallPenalty = angleToWind < (halfDead + stallMargin)
      ? ((halfDead + stallMargin - angleToWind) / stallMargin) * 5
      : 0;
    const lowSpeedPenalty = (1 - speedFactor) * 1.8;
    const startLineMargin = Math.max(0, -startLineSideValue(projected));
    const countdownCrossing = countdownTarget ? classifyStartLineCrossing(position, projected) : null;
    const countdownPenalty = !countdownTarget
      ? 0
      : (
        (countdownCrossing === "toCourse" || startLineSideValue(projected) > -0.04)
          ? 9
          : (Math.max(0, profile.lineMargin - startLineMargin) * 5.5) + (pointInPrestartZone(projected) ? 0 : 1.8)
      );
    const decisionNoise = boatIdx < 0
      ? 0
      : (((stableNoise01((boatIdx + 1) * 11.37 + projected.x * 0.91 + projected.y * 0.53 + Math.floor((options.nowMs || currentRaceTimeMs()) / 700)) * 2) - 1) * noiseScale);
    return dist(projected, target)
      - progress * 0.35
      + targetPenalty
      + headingPenalty
      + tackPenalty
      + boundaryPenalty
      + reversePenalty
      + luffPenalty
      + stallPenalty
      + lowSpeedPenalty
      + countdownPenalty
      + decisionNoise;
  }

  function scheduleLocalBotTurn({ delayMs=420 } = {}){
    clearBotTurnTimer();
    if (!isLocalBotsMode() || phase === "finished" || isRealtimePlayMode() || botTurnInProgress){
      return;
    }
    if (!boats.length || boats.every((boat) => boat.finished)){
      return;
    }
    if (!isBotControlledBoat(currentPlayer) || subMovesLeft <= 0){
      return;
    }
    botTurnTimer = window.setTimeout(runLocalBotTurn, delayMs);
  }

  function finalizeBotTurnNoMove(){
    subMovesLeft = 0;
    advanceTurnToNext();
    selectedBoatIndex = null;
    updateStatus();
    updateStats();
    updateOptInfo();
    render();
    emitStateChanged();
  }

  async function runLocalBotTurn(){
    botTurnTimer = 0;
    if (!isLocalBotsMode() || !isBotControlledBoat(currentPlayer) || subMovesLeft <= 0 || phase === "finished"){
      return;
    }

    botTurnInProgress = true;
    try {
      let guard = 0;
      while (isLocalBotsMode() && isBotControlledBoat(currentPlayer) && subMovesLeft > 0 && phase !== "finished" && guard < 32){
        const boatIdx = currentPlayer;
        const dest = chooseBotDestination(boatIdx);
        if (!dest){
          finalizeBotTurnNoMove();
          guard += 1;
          continue;
        }

        performMove(boatIdx, dest);
        invalidateSolutions();
        updateOptInfo();
        guard += 1;
      }
    } finally {
      botTurnInProgress = false;
      scheduleLocalBotTurn({ delayMs: 560 });
    }
  }

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

  function turnRateRadPerSecond(turnRateScale=1){
    return clamp(turnRateDegPerSec, 30, 360) * Math.max(0.45, turnRateScale || 1) * Math.PI / 180;
  }

  function steerHeadingToward(boat, desiredHeading, dtSeconds, turnRateScale=1){
    if (!Number.isFinite(desiredHeading)) return 0;
    if (!boat?.hasHeading || !Number.isFinite(boat.heading) || !Number.isFinite(dtSeconds) || dtSeconds <= 0){
      return desiredHeading;
    }
    const maxDelta = turnRateRadPerSecond(turnRateScale) * dtSeconds;
    const delta = angleWrap(desiredHeading - boat.heading);
    return angleWrap(boat.heading + clamp(delta, -maxDelta, maxDelta));
  }

  function steerDirectionToward(boat, desiredDirection, dtSeconds, turnRateScale=1){
    if (!desiredDirection) return null;
    const desiredHeading = Math.atan2(desiredDirection.y, desiredDirection.x);
    const heading = steerHeadingToward(boat, desiredHeading, dtSeconds, turnRateScale);
    return {
      heading,
      direction: { x: Math.cos(heading), y: Math.sin(heading) },
      desiredHeading
    };
  }

  function maybeStartGunIfNeeded(){
    if (phase !== "prestart") return;
    if (prestartRoundsLeft > 0) return;

    phase = "race";
    raceFinishedCount = 0;
    resetBoatTrails();

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

  function chooseRealtimeBotDirection(boatIdx){
    const boat = boats[boatIdx];
    if (!boat || boat.finished) return null;

    const now = currentRaceTimeMs();
    const profile = botSkillProfile(boatIdx);
    const superbot = isMultiplayerBotBoat(boatIdx);
    const countdownGuideTarget = realtimeBotCountdownGuideTarget(boat, boatIdx, now);
    const roundingGuideTarget = realtimeBotRoundingGuideTarget(boat);
    const plannerGuideTarget = superbot ? realtimeSuperbotPlannerGuideTarget(boat, boatIdx) : null;
    const roundingProgressKey = Math.round(roundingProgressForBoat(boat) * 4) / 4;
    const countdownBucket = phase === "countdown"
      ? Math.ceil(Math.max(0, realtimeCountdownEndsAt - now) / 1000)
      : -1;
    const cachedDecision = realtimeBotDecisionCache[boatIdx];
    if (
      cachedDecision?.direction &&
      cachedDecision.phase === phase &&
      cachedDecision.nextMark === boat.nextMark &&
      cachedDecision.countdownBucket === countdownBucket &&
      cachedDecision.countdownGuideActive === !!countdownGuideTarget &&
      cachedDecision.guideActive === !!roundingGuideTarget &&
      cachedDecision.plannerGuideActive === !!plannerGuideTarget &&
      cachedDecision.roundInZone === !!boat.roundInZone &&
      cachedDecision.roundingProgressKey === roundingProgressKey &&
      cachedDecision.refreshAt > now &&
      dist(cachedDecision.position, { x: boat.x, y: boat.y }) < 2.4
    ){
      return { ...cachedDecision.direction };
    }

    const target = countdownGuideTarget || roundingGuideTarget || plannerGuideTarget || botGoalPointForBoat(boat);
    if (!target) return null;

    const direct = norm({ x: target.x - boat.x, y: target.y - boat.y });
    if (direct.L <= 1e-6){
      return boat.hasHeading ? boatAxisUnit(boat.heading, boat.hasHeading) : null;
    }

    const directDirection = superbot
      ? { x: direct.x, y: direct.y }
      : applyBotDirectionBias(
        { x: direct.x, y: direct.y },
        boatIdx,
        now,
        countdownGuideTarget ? 0.22 : (roundingGuideTarget ? 0.35 : 1)
      );
    const candidates = [];
    const upwind = upwindVec();
    const halfDead = deadZoneHalfAngleRad();
    const beatAngle = clamp(
      halfDead + (14 * Math.PI / 180),
      35 * Math.PI / 180,
      85 * Math.PI / 180
    );
    const currentHeading = boatAxisUnit(boat.heading, boat.hasHeading);
    const needsBeat = angleBetween(directDirection, upwind) < (halfDead + 12 * Math.PI / 180);
    const beatVariants = superbot ? [0, 4, -4, 8, -8] : [0, 8, -8, 16, -16];
    const addBeatFamily = (baseDirection) => {
      for (const deg of beatVariants){
        addRealtimeDirectionCandidate(candidates, rotateVec(baseDirection, deg * Math.PI / 180));
      }
    };
    const beatA = rotateVec(upwind, beatAngle);
    const beatB = rotateVec(upwind, -beatAngle);
    const beatATack = tackSignFromHeadingVec(beatA);
    const beatBTack = tackSignFromHeadingVec(beatB);

    if (needsBeat){
      if (boat.tack !== 0){
        if (beatATack === boat.tack){
          addBeatFamily(beatA);
          addBeatFamily(beatB);
        } else {
          addBeatFamily(beatB);
          addBeatFamily(beatA);
        }
      } else {
        addBeatFamily(beatA);
        addBeatFamily(beatB);
      }
      if (boat.hasHeading && angleBetween(currentHeading, upwind) >= (halfDead + 6 * Math.PI / 180)){
        addRealtimeDirectionCandidate(candidates, currentHeading);
      }
    } else {
      const courseTweaks = superbot ? [0, 4, -4, 8, -8, 14, -14, 22, -22, 32, -32] : [0, 8, -8, 16, -16, 28, -28, 40, -40];
      addRealtimeDirectionCandidate(candidates, directDirection);
      for (const deg of courseTweaks){
        if (!deg) continue;
        addRealtimeDirectionCandidate(candidates, rotateVec(directDirection, deg * Math.PI / 180));
      }
      addRealtimeDirectionCandidate(candidates, currentHeading);
      if (boat.hasHeading){
        addRealtimeDirectionCandidate(candidates, rotateVec(currentHeading, 12 * Math.PI / 180));
        addRealtimeDirectionCandidate(candidates, rotateVec(currentHeading, -12 * Math.PI / 180));
      }
      addBeatFamily(beatA);
      addBeatFamily(beatB);
    }

    let bestDirection = candidates[0] || directDirection;
    let bestScore = Infinity;
    for (const candidate of candidates){
      const score = scoreRealtimeBotDirection(boat, candidate, directDirection, target, {
        boatIdx,
        nowMs: now,
        countdownTarget: !!countdownGuideTarget,
        roundingGuide: !!roundingGuideTarget
      });
      if (score < bestScore){
        bestScore = score;
        bestDirection = candidate;
      }
    }

    realtimeBotDecisionCache[boatIdx] = {
      direction: { ...bestDirection },
      position: { x: boat.x, y: boat.y },
      nextMark: boat.nextMark,
      countdownBucket,
      countdownGuideActive: !!countdownGuideTarget,
      guideActive: !!roundingGuideTarget,
      plannerGuideActive: !!plannerGuideTarget,
      roundInZone: !!boat.roundInZone,
      roundingProgressKey,
      phase,
      refreshAt: now + profile.decisionMs
    };
    return bestDirection;
  }

  function controlDirectionForLocalBoat(boatIdx){
    if (!isLocalRealtimeMode()) return null;

    const boat = boats[boatIdx];
    if (!boat) return null;

    if (isLocalBotsMode() && isBotControlledBoat(boatIdx)){
      return chooseRealtimeBotDirection(boatIdx);
    }

    const controlledBoatIndex = realtimeControlledBoatIndex();
    if (controlledBoatIndex !== boatIdx){
      return null;
    }
    refreshRealtimeIntentFromPointer({ emit:false });

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

  function appendUniqueSeparationDirection(directions, seenKeys, vector){
    const normalized = norm(vector);
    if (normalized.L <= 1e-6) return;
    const candidate = { x: normalized.x, y: normalized.y };
    const key = `${candidate.x.toFixed(4)},${candidate.y.toFixed(4)}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    directions.push(candidate);
  }

  function separationDirectionCandidates(primary, fallback, heading=0, hasHeading=false, extraVectors=[]){
    const directions = [];
    const seenKeys = new Set();
    const axis = boatAxisUnit(heading, hasHeading);
    const perpendicular = { x: -axis.y, y: axis.x };
    appendUniqueSeparationDirection(directions, seenKeys, primary);
    appendUniqueSeparationDirection(directions, seenKeys, fallback);
    appendUniqueSeparationDirection(directions, seenKeys, axis);
    appendUniqueSeparationDirection(directions, seenKeys, { x: -axis.x, y: -axis.y });
    appendUniqueSeparationDirection(directions, seenKeys, perpendicular);
    appendUniqueSeparationDirection(directions, seenKeys, { x: -perpendicular.x, y: -perpendicular.y });
    for (const vector of extraVectors){
      appendUniqueSeparationDirection(directions, seenKeys, vector);
    }
    if (!directions.length){
      appendUniqueSeparationDirection(directions, seenKeys, { x: 1, y: 0 });
    }
    return directions;
  }

  function bestMarkUnstickPosition(position, mark, heading, hasHeading, pushDistance, primary, fallback){
    const directions = separationDirectionCandidates(primary, fallback, heading, hasHeading);
    let bestPosition = null;
    let bestClearance = -Infinity;
    let bestMovement = 0;

    for (const direction of directions){
      const nextPosition = clampPositionToCapsuleField(
        {
          x: position.x + direction.x * pushDistance,
          y: position.y + direction.y * pushDistance
        },
        heading,
        hasHeading,
        BOAT_CLEARANCE_MARGIN
      );
      const moved = dist(position, nextPosition);
      if (moved <= 1e-6) continue;

      const nextCapsule = boatCapsuleAt(nextPosition, heading, hasHeading);
      const nextClearance = pointToSegment(mark, nextCapsule.a, nextCapsule.b).d;
      if (
        bestPosition === null
        || nextClearance > bestClearance + 1e-6
        || (Math.abs(nextClearance - bestClearance) <= 1e-6 && moved > bestMovement + 1e-6)
      ){
        bestPosition = nextPosition;
        bestClearance = nextClearance;
        bestMovement = moved;
      }
    }

    return bestPosition;
  }

  function bestBoatUnstickPair(leftPosition, rightPosition, leftHeading, leftHasHeading, rightHeading, rightHasHeading, pushDistance, primary, fallback){
    const rightAxis = boatAxisUnit(rightHeading, rightHasHeading);
    const rightPerpendicular = { x: -rightAxis.y, y: rightAxis.x };
    const directions = separationDirectionCandidates(primary, fallback, leftHeading, leftHasHeading, [
      rightAxis,
      { x: -rightAxis.x, y: -rightAxis.y },
      rightPerpendicular,
      { x: -rightPerpendicular.x, y: -rightPerpendicular.y }
    ]);
    let bestPair = null;
    let bestClearance = -Infinity;
    let bestMovement = 0;

    for (const direction of directions){
      const nextLeft = clampPositionToCapsuleField(
        {
          x: leftPosition.x + direction.x * pushDistance,
          y: leftPosition.y + direction.y * pushDistance
        },
        leftHeading,
        leftHasHeading,
        BOAT_CLEARANCE_MARGIN
      );
      const nextRight = clampPositionToCapsuleField(
        {
          x: rightPosition.x - direction.x * pushDistance,
          y: rightPosition.y - direction.y * pushDistance
        },
        rightHeading,
        rightHasHeading,
        BOAT_CLEARANCE_MARGIN
      );
      const moved = dist(leftPosition, nextLeft) + dist(rightPosition, nextRight);
      if (moved <= 1e-6) continue;

      const nextLeftCapsule = boatCapsuleAt(nextLeft, leftHeading, leftHasHeading);
      const nextRightCapsule = boatCapsuleAt(nextRight, rightHeading, rightHasHeading);
      const nextClearance = segmentSegmentClosestPoints(
        nextLeftCapsule.a,
        nextLeftCapsule.b,
        nextRightCapsule.a,
        nextRightCapsule.b
      ).distance;
      if (
        bestPair === null
        || nextClearance > bestClearance + 1e-6
        || (Math.abs(nextClearance - bestClearance) <= 1e-6 && moved > bestMovement + 1e-6)
      ){
        bestPair = { left: nextLeft, right: nextRight };
        bestClearance = nextClearance;
        bestMovement = moved;
      }
    }

    return bestPair;
  }

  function resolveLocalRealtimeOverlaps(){
    let changed = false;
    const activeMarks = marks.slice(0, Math.max(0, Math.min(markCount, marks.length)));

    for (let pass = 0; pass < UNSTICK_MAX_PASSES; pass++){
      let passChanged = false;

      for (const boat of boats){
        if (!boat) continue;

        let position = { x: boat.x, y: boat.y };
        const heading = Number.isFinite(boat.heading) ? boat.heading : 0;
        const hasHeading = !!boat.hasHeading;
        const clampedPosition = clampPositionToCapsuleField(position, heading, hasHeading, BOAT_CLEARANCE_MARGIN);
        if (dist(position, clampedPosition) > 1e-6){
          boat.x = clampedPosition.x;
          boat.y = clampedPosition.y;
          boat.currentSpeedUnitsPerSec = 0;
          position = clampedPosition;
          passChanged = true;
        }

        let capsule = boatCapsuleAt(position, heading, hasHeading);
        for (const mark of activeMarks){
          const info = pointToSegment(mark, capsule.a, capsule.b);
          const requiredDistance = capsule.r + MARK_RADIUS + MARK_CLEARANCE_MARGIN;
          if (info.d >= requiredDistance - 1e-9) continue;

          const primary = { x: info.proj.x - mark.x, y: info.proj.y - mark.y };
          const fallback = { x: position.x - mark.x, y: position.y - mark.y };
          const pushDistance = requiredDistance - info.d + UNSTICK_PUSH_EPS;
          const nextPosition = bestMarkUnstickPosition(
            position,
            mark,
            heading,
            hasHeading,
            pushDistance,
            primary,
            fallback
          );
          if (!nextPosition) continue;

          boat.x = nextPosition.x;
          boat.y = nextPosition.y;
          boat.currentSpeedUnitsPerSec = 0;
          position = nextPosition;
          capsule = boatCapsuleAt(position, heading, hasHeading);
          passChanged = true;
        }
      }

      if (boatsPhysicalCollisionsEnabled()){
        for (let leftIndex = 0; leftIndex < boats.length; leftIndex++){
          const leftBoat = boats[leftIndex];
          if (!leftBoat) continue;
          let leftPosition = { x: leftBoat.x, y: leftBoat.y };
          const leftHeading = Number.isFinite(leftBoat.heading) ? leftBoat.heading : 0;
          const leftHasHeading = !!leftBoat.hasHeading;
          let leftCapsule = boatCapsuleAt(leftPosition, leftHeading, leftHasHeading);

          for (let rightIndex = leftIndex + 1; rightIndex < boats.length; rightIndex++){
            const rightBoat = boats[rightIndex];
            if (!rightBoat) continue;
            let rightPosition = { x: rightBoat.x, y: rightBoat.y };
            const rightHeading = Number.isFinite(rightBoat.heading) ? rightBoat.heading : 0;
            const rightHasHeading = !!rightBoat.hasHeading;
            let rightCapsule = boatCapsuleAt(rightPosition, rightHeading, rightHasHeading);
            const closest = segmentSegmentClosestPoints(leftCapsule.a, leftCapsule.b, rightCapsule.a, rightCapsule.b);
            const requiredDistance = leftCapsule.r + rightCapsule.r + BOAT_CLEARANCE_MARGIN;
            if (closest.distance >= requiredDistance - 1e-9) continue;

            const primary = { x: closest.left.x - closest.right.x, y: closest.left.y - closest.right.y };
            const fallback = { x: leftPosition.x - rightPosition.x, y: leftPosition.y - rightPosition.y };
            const pushDistance = (requiredDistance - closest.distance + UNSTICK_PUSH_EPS) / 2;
            const nextPair = bestBoatUnstickPair(
              leftPosition,
              rightPosition,
              leftHeading,
              leftHasHeading,
              rightHeading,
              rightHasHeading,
              pushDistance,
              primary,
              fallback
            );
            if (!nextPair) continue;

            const nextLeft = nextPair.left;
            const nextRight = nextPair.right;

            let moved = false;
            if (dist(leftPosition, nextLeft) > 1e-6){
              leftBoat.x = nextLeft.x;
              leftBoat.y = nextLeft.y;
              leftBoat.currentSpeedUnitsPerSec = 0;
              leftPosition = nextLeft;
              leftCapsule = boatCapsuleAt(leftPosition, leftHeading, leftHasHeading);
              moved = true;
            }
            if (dist(rightPosition, nextRight) > 1e-6){
              rightBoat.x = nextRight.x;
              rightBoat.y = nextRight.y;
              rightBoat.currentSpeedUnitsPerSec = 0;
              rightPosition = nextRight;
              rightCapsule = boatCapsuleAt(rightPosition, rightHeading, rightHasHeading);
              moved = true;
            }
            if (moved){
              passChanged = true;
            }
          }
        }
      }

      changed = passChanged || changed;
      if (!passChanged){
        break;
      }
    }

    return changed;
  }

  function simulateLocalRealtimeTick(dtSeconds){
    let changed = false;
    if (isLocalRealtimePaused()){
      let zeroedAnySpeed = false;
      for (const boat of boats){
        if (!boat) continue;
        if (boat.currentSpeedUnitsPerSec !== 0){
          boat.currentSpeedUnitsPerSec = 0;
          zeroedAnySpeed = true;
        }
      }
      return zeroedAnySpeed;
    }
    const now = currentRaceTimeMs();
    let tickStartMs = now - dtSeconds * 1000;
    const countdownActive = phase === "countdown" && realtimeCountdownEndsAt > now;

    if (phase === "countdown" && realtimeCountdownEndsAt > 0 && now >= realtimeCountdownEndsAt){
      tickStartMs = Math.max(tickStartMs, realtimeCountdownEndsAt);
      phase = "race";
      realtimeBotDecisionCache = [];
      resetBoatTrails();
      changed = true;
    }

    if (!isLocalRealtimeMode()){
      return changed;
    }

    if (phase !== "race" && !countdownActive){
      let zeroedAnySpeed = false;
      for (const boat of boats){
        if (!boat) continue;
        if (boat.currentSpeedUnitsPerSec !== 0){
          boat.currentSpeedUnitsPerSec = 0;
          zeroedAnySpeed = true;
        }
      }
      return changed || zeroedAnySpeed;
    }

    changed = resolveLocalRealtimeOverlaps() || changed;

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

      const nearActiveMark = boat.nextMark < markCount && !!marks[boat.nextMark]
        ? dist(boat, marks[boat.nextMark]) <= (ROUND_PASS_RADIUS + 8.5)
        : false;
      const turnRateScale = isBotControlledBoat(index)
        ? Math.max(
          botSkillProfile(index).turnRateScale,
          (phase === "countdown" || boat.roundInZone || nearActiveMark) ? 0.96 : 0
        )
        : 1;
      const steering = steerDirectionToward(boat, direction, dtSeconds, turnRateScale);
      if (!steering?.direction){
        return proposal;
      }

      const actualDirection = steering.direction;
      const upwind = upwindVec();
      const angle = angleBetween(actualDirection, upwind);
      const halfDead = deadZoneHalfAngleRad();
      const reverseThreshold = halfDead * 0.5;
      const heading = steering.heading;
      const moveFactor = stepFactorForMove(boat, actualDirection) * realtimePenaltyFactorForBoat(boat, now);
      const reverseSpeed = REALTIME_SPEED_UNITS_PER_SEC * dtSeconds * moveFactor * 0.10;
      const reverseMode = angle <= reverseThreshold;
      const speedFactor = reverseMode ? 0 : realtimeSpeedFactorForAngle(angle);
      const stepLength = reverseMode
        ? reverseSpeed
        : (REALTIME_SPEED_UNITS_PER_SEC * dtSeconds * speedFactor * moveFactor);
      if (stepLength <= 1e-5){
        return proposal;
      }

      const motionDirection = reverseMode
        ? { x: -actualDirection.x, y: -actualDirection.y }
        : actualDirection;

      proposal.accepted = true;
      proposal.dest = clampPositionToCapsuleField(
        clampAlongRayToField({ x: boat.x, y: boat.y }, motionDirection, stepLength),
        heading,
        true,
        BOAT_CLEARANCE_MARGIN
      );
      proposal.heading = heading;
      proposal.hasHeading = true;
      proposal.direction = actualDirection;
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
      if (!pointInField(proposal.dest) || !capsuleFitsWithinField(candidateCapsule, BOAT_CLEARANCE_MARGIN)){
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

      if (countdownActive && isBotControlledBoat(i)){
        const crossing = classifyStartLineCrossing(proposal.prev, proposal.dest);
        if (crossing === "toCourse" || startLineSideValue(proposal.dest) > -0.02){
          invalid.add(i);
          continue;
        }
      }

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
          if (phase === "race" && boat.hasHeading && Math.abs(angleWrap(proposal.heading - boat.heading)) > (12 * Math.PI / 180)){
            boat.turns += 1;
          }
          boat.x = dest.x;
          boat.y = dest.y;
          if (phase === "race"){
            boat.distance += proposal.distance;
          }
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

    changed = resolveLocalRealtimeOverlaps() || changed;

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

    if (!isMultiplayerRoomActive() && phase !== "finished"){
      const weatherChanged = updateAutoGustState(currentRaceTimeMs());
      if (weatherChanged){
        changed = true;
      }
    }

    if (isLocalRealtimeMode()){
      if (isLocalRealtimePaused()){
        localRealtimeLastTickAt = 0;
      }
      const now = Number.isFinite(frameTime) ? frameTime : performance.now();
      const dtSeconds = localRealtimeLastTickAt > 0 && !isLocalRealtimePaused()
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
    scheduleLocalBotTurn();
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
    appendBoatTrailPoint(boatIdx, dest, { force:true });

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
      clearBotTurnTimer();
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
        scheduleLocalBotTurn();
        return;
      }

      advanceTurnToNext();
      selectedBoatIndex = null;
    }

    updateStatus();
    updateStats();
    render();
    emitStateChanged();
    scheduleLocalBotTurn();
  }
