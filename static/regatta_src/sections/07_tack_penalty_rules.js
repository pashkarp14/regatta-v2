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

