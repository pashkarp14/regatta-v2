  // -----------------------------
  // Постановка лодок: спавн
  // -----------------------------
  function spawnHeadingAlongStart(){
    const d = startLineDirUnit();
    return Math.atan2(d.y, d.x);
  }

  function tryRandomSpawnBehindStart({
    occupiedCapsules = [],
    minDepth = 0.65,
    maxDepth = PRESTART_DEPTH,
    minAlong = 0.08,
    maxAlong = 0.92,
  } = {}){
    const d = startLineDirUnit();
    const n = prestartNormalUnit();
    const lineLen = Math.hypot(startB.x-startA.x, startB.y-startA.y);
    const spawnHeading = spawnHeadingAlongStart();

    for (let attempt=0; attempt<320; attempt++){
      const alongT = clamp(minAlong + Math.random() * Math.max(0.02, maxAlong - minAlong), 0.02, 0.98);
      const depth = clamp(minDepth + Math.random() * Math.max(0.1, maxDepth - minDepth), minDepth, maxDepth);
      const p = {
        x: startA.x + d.x * (alongT * lineLen) + n.x * depth,
        y: startA.y + d.y * (alongT * lineLen) + n.y * depth
      };

      if (!pointInField(p)) continue;

      const candidate = boatCapsuleAt(p, spawnHeading, true);
      let blocked = false;
      for (let i=0; i<markCount; i++){
        if (capsuleIntersectsMark(candidate, marks[i], MARK_CLEARANCE_MARGIN)){
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      for (const capsule of occupiedCapsules){
        if (capsulesOverlap(candidate, capsule, BOAT_CLEARANCE_MARGIN)){
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      return { point: p, heading: spawnHeading, capsule: candidate };
    }

    const fallback = {
      x: startA.x + d.x * (lineLen * 0.5) + n.x * clamp(minDepth, 0.2, PRESTART_DEPTH),
      y: startA.y + d.y * (lineLen * 0.5) + n.y * clamp(minDepth, 0.2, PRESTART_DEPTH),
    };
    return {
      point: fallback,
      heading: spawnHeading,
      capsule: boatCapsuleAt(fallback, spawnHeading, true),
    };
  }

  function randomSpawnBehindStart(options = {}){
    const spawn = tryRandomSpawnBehindStart(options);
    return spawn.point;
  }

  function placeBoatsBehindStartRandomly({ minDepth=0.65, maxDepth=PRESTART_DEPTH } = {}){
    const occupiedCapsules = [];
    const spawnHeading = spawnHeadingAlongStart();
    for (let i=0; i<boats.length; i++){
      const spawn = tryRandomSpawnBehindStart({ occupiedCapsules, minDepth, maxDepth });
      boats[i].x = spawn.point.x;
      boats[i].y = spawn.point.y;
      boats[i].heading = spawnHeading;
      boats[i].hasHeading = true;
      boats[i].tack = tackSignFromHeadingVec(startLineDirUnit());
      occupiedCapsules.push(spawn.capsule);
    }
  }

