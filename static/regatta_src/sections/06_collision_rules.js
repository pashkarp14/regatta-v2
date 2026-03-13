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

