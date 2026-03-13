  // -----------------------------
  // ОПТИМАЛЬНЫЙ МАРШРУТ: A* по дискретизации
  // -----------------------------
  class MinHeap {
    constructor(){ this.a=[]; }
    push(x){ this.a.push(x); this._up(this.a.length-1); }
    pop(){
      if (!this.a.length) return null;
      const top = this.a[0];
      const last = this.a.pop();
      if (this.a.length){ this.a[0]=last; this._down(0); }
      return top;
    }
    _up(i){
      while(i>0){
        const p=(i-1)>>1;
        if (this.a[p].f <= this.a[i].f) break;
        [this.a[p],this.a[i]]=[this.a[i],this.a[p]];
        i=p;
      }
    }
    _down(i){
      const n=this.a.length;
      while(true){
        let l=i*2+1,r=l+1,b=i;
        if (l<n && this.a[l].f < this.a[b].f) b=l;
        if (r<n && this.a[r].f < this.a[b].f) b=r;
        if (b===i) break;
        [this.a[b],this.a[i]]=[this.a[i],this.a[b]];
        i=b;
      }
    }
  }

  function finishLine(){ return finishSeparate ? [finishA, finishB] : [startA, startB]; }

  function pointToLineDist(p, a, b){
    return pointToSegment(p,a,b).d;
  }

  function plannerResolution(){
    const m = Math.max(worldW, worldH);
    if (m <= 25) return 0.5;
    if (m <= 60) return 0.75;
    return 1.0;
  }

  const PLANNER_DIR_STEP_DEG = 15;
  function plannerDirs(){
    const dirs = [];
    for (let deg=0; deg<360; deg+=PLANNER_DIR_STEP_DEG){
      const t = deg*Math.PI/180;
      dirs.push({ ux: Math.cos(t), uy: Math.sin(t), ang:t });
    }
    return dirs;
  }
  const DIRS = plannerDirs();

  function headingBinFor(ang){
    const stepRad = PLANNER_DIR_STEP_DEG*Math.PI/180;
    const bins = DIRS.length || Math.round(360/PLANNER_DIR_STEP_DEG);
    const normAng = (((ang%(2*Math.PI))+(2*Math.PI))%(2*Math.PI));
    return Math.round(normAng / stepRad) % bins;
  }

  function quantize(p, RES){
    const ix = Math.round(p.x/RES);
    const iy = Math.round(p.y/RES);
    return { ix, iy, x: ix*RES, y: iy*RES };
  }

  function plannerStepLenAt(pos, prevTack, dirUnit, boatSpeed=1){
    let factor = clamp(Number.isFinite(boatSpeed) ? boatSpeed : 1, 0.5, 1.8);
    if (pointInGust(pos)) factor *= GUST_MULT;

    if (tackPenaltyFactor < 1.0 && prevTack !== 0){
      const newTack = tackSignFromHeadingVec(dirUnit);
      if (newTack !== 0 && newTack !== prevTack) factor *= tackPenaltyFactor;
    }
    return STEP_RADIUS_BASE * factor;
  }

  function plannerTurnIncrement(prevHeadingAng, prevTack, newHeadingAng, newTack){
    if (prevHeadingAng === null) return 0;
    const da = Math.abs(angleWrap(newHeadingAng - prevHeadingAng));
    const tackChanged = (prevTack !== 0 && newTack !== 0 && prevTack !== newTack);
    return (tackChanged || da >= (60*Math.PI/180)) ? 1 : 0;
  }

  function isAllowedDir(dirUnit){
    if (deadZoneDeg <= 0) return true;
    const uw = upwindVec();
    const a = angleBetween(dirUnit, uw);
    return a >= (deadZoneDeg*Math.PI/180)/2;
  }

  // goalMode: "course" | "firstMark"
  function planOptimalFrom(startPos, startMarkIdx, prevHeadingAng, prevTack, goalMode, movingBoatIdx=null, movingBoatSpeed=1){
    const RES = plannerResolution();

    const sPos = { x: clamp(startPos.x,0,worldW), y: clamp(startPos.y,0,worldH) };
    const q0 = quantize(sPos, RES);

    if (isTooCloseToMarks(sPos, movingBoatIdx ?? -1)) return null;
    if (movingBoatIdx !== null && boatsPhysicalCollisionsEnabled() && isTooCloseToBoats(sPos, movingBoatIdx)) return null;

    const [fa, fb] = finishLine();
    const targetMark = marks[0];

    // ✅ добавили inZone/okFlag в ключ (для корректного "войти→выйти")
    const keyOf = (ix,iy,mark,hd,tack,iz,sw) => `${ix},${iy},${mark},${hd},${tack},${iz},${sw}`;

    const g = new Map();
    const tcnt = new Map();
    const parent = new Map();
    const parentPos = new Map();

    const pq = new MinHeap();

    const qStart = quantize(sPos, RES);
    const hdStart = (prevHeadingAng === null) ? -1 : headingBinFor(prevHeadingAng);

    // стартовое состояние "в зоне?" для текущей цели
    let startInZone = 0;
    if (goalMode === "firstMark") startInZone = (roundingZoneRelation(sPos, targetMark) < 0) ? 1 : 0;
    else if (startMarkIdx < markCount) startInZone = (roundingZoneRelation(sPos, marks[startMarkIdx]) < 0) ? 1 : 0;

    const startKey = keyOf(qStart.ix,qStart.iy,startMarkIdx,hdStart,prevTack,startInZone,0);

    g.set(startKey, 0);
    tcnt.set(startKey, 0);
    parent.set(startKey, null);
    parentPos.set(startKey, {x:sPos.x,y:sPos.y});

    function heuristic(p, markIdx){
      if (goalMode === "firstMark"){
        return dist(p, targetMark);
      }
      if (markIdx < markCount){
        return dist(p, marks[markIdx]);
      }
      return pointToLineDist(p, fa, fb);
    }

    pq.push({
      f: heuristic(sPos, startMarkIdx),
      key: startKey,
      ix:qStart.ix, iy:qStart.iy, x:sPos.x, y:sPos.y,
      mark:startMarkIdx, h:prevHeadingAng, tack:prevTack,
      iz:startInZone, sw:0
    });

    const MAX_EXPAND = (goalMode === "firstMark") ? 45000 : 250000;
    let expanded = 0;

    let bestGoalKey = null;
    let bestGoalCost = Infinity;

    while(true){
      const cur = pq.pop();
      if (!cur) break;

      if (bestGoalKey && cur.f >= bestGoalCost - 1e-9) break;

      const curG = g.get(cur.key);
      if (curG === undefined) continue;

      expanded++;
      if (expanded > MAX_EXPAND) break;

      const curPos = { x: cur.x, y: cur.y };

      for (const d of DIRS){
        const dirUnit = { x:d.ux, y:d.uy };
        if (!isAllowedDir(dirUnit)) continue;

        const stepLen = plannerStepLenAt(curPos, cur.tack, dirUnit, movingBoatSpeed);
        const nextRaw = clampAlongRayToField(curPos, dirUnit, stepLen);

        const nq = quantize(nextRaw, RES);
        const nextPos = { x: clamp(nq.x,0,worldW), y: clamp(nq.y,0,worldH) };

        if (!pointInField(nextPos)) continue;

        const moveVec = { x: nextPos.x - curPos.x, y: nextPos.y - curPos.y };
        const L = Math.hypot(moveVec.x, moveVec.y);
        if (L < 1e-6) continue;
        if (L > stepLen + 1e-6) continue;
        const headingAng = Math.atan2(moveVec.y, moveVec.x);
        if (isMoveInDeadZone(moveVec)) continue;
        if (isTooCloseToMarks(nextPos, movingBoatIdx ?? -1, headingAng, true)) continue;
        if (pathIntersectsAnyMark(curPos, nextPos)) continue;
        if (movingBoatIdx !== null){
          if (boatsPhysicalCollisionsEnabled() && isTooCloseToBoats(nextPos, movingBoatIdx, headingAng, true)) continue;
          if (boatsPhysicalCollisionsEnabled() && pathIntersectsOtherBoat(curPos, nextPos, movingBoatIdx)) continue;
        }

        const newTack = tackSignFromHeadingVec({x:moveVec.x/L,y:moveVec.y/L});
        const addTurns = plannerTurnIncrement(cur.h, cur.tack, headingAng, newTack);

        const dirForMark = {x:moveVec.x/L,y:moveVec.y/L};

        let nextMark = cur.mark;
        let nextIZ = cur.iz;
        let nextSweep = cur.sw;

        // ✅ Корректное огибание со "войти→выйти"
        if (goalMode === "firstMark"){
          if (nextMark < 1){
            const rr = processRoundingPlanner(curPos, nextPos, dirForMark, targetMark, cur.iz===1, cur.sw || 0);
            if (rr.completed){
              nextMark = 1;
              nextIZ = 0; nextSweep = 0;
            } else {
              nextIZ = rr.inZone ? 1 : 0;
              nextSweep = rr.sweep || 0;
            }
          } else {
            nextIZ = 0; nextSweep = 0;
          }
        } else {
          if (nextMark < markCount){
            const m = marks[nextMark];
            const rr = processRoundingPlanner(curPos, nextPos, dirForMark, m, cur.iz===1, cur.sw || 0);
            if (rr.completed){
              nextMark = nextMark + 1;
              nextIZ = 0; nextSweep = 0;
            } else {
              nextIZ = rr.inZone ? 1 : 0;
              nextSweep = rr.sweep || 0;
            }
          } else {
            nextIZ = 0; nextSweep = 0;
          }
        }

        let goalReached = false;

        if (goalMode === "firstMark"){
          if (nextMark >= 1) goalReached = true;
        } else {
          if (nextMark >= markCount){
            if (segmentsIntersect(curPos, nextPos, fa, fb)) goalReached = true;
          }
        }

        const hdBin = headingBinFor(headingAng);
        const k2 = keyOf(nq.ix,nq.iy,nextMark,hdBin,newTack,nextIZ,roundingSweepKey(nextSweep));

        const candG = curG + L;
        const candT = (tcnt.get(cur.key) || 0) + addTurns;

        const oldG = g.get(k2);
        const oldT = tcnt.get(k2);

        const better = (oldG === undefined) || (candG < oldG - 1e-6) || (Math.abs(candG-oldG) <= 1e-6 && candT < oldT);

        if (better){
          g.set(k2, candG);
          tcnt.set(k2, candT);
          parent.set(k2, cur.key);
          parentPos.set(k2, nextPos);

          const h = heuristic(nextPos, nextMark);
          pq.push({
            f: candG + h, key: k2,
            ix:nq.ix, iy:nq.iy, x: nextPos.x, y: nextPos.y,
            mark: nextMark, h: headingAng, tack: newTack,
            iz: nextIZ, sw: nextSweep
          });

          if (goalReached && candG < bestGoalCost){
            bestGoalCost = candG;
            bestGoalKey = k2;
          }
        }
      }
    }

    if (!bestGoalKey) return null;

    const path = [];
    let k = bestGoalKey;
    while(k){
      const p = parentPos.get(k);
      if (p) path.push({x:p.x,y:p.y});
      k = parent.get(k);
    }
    path.reverse();

    return {
      path,
      distance: bestGoalCost,
      turns: tcnt.get(bestGoalKey) || 0,
      moves: Math.max(0, path.length-1)
    };
  }

  function computeOptimalForBoat(idx){
    const b = boats[idx];
    if (!b) return;

    const startPos = {x:b.x,y:b.y};
    const markIdx = (phase==="race") ? b.nextMark : 0;

    const prevHeadingAng = b.hasHeading ? b.heading : null;
    const prevTack = b.hasHeading ? b.tack : 0;

    const res = planOptimalFrom(startPos, markIdx, prevHeadingAng, prevTack, "course", idx, boatSpeedCoeff(b));
    if (!res){
      optimalPath = [];
      optimalStats = null;
      optimalForBoat = idx;
      return;
    }

    optimalPath = res.path;
    optimalStats = { distance: res.distance, turns: res.turns, moves: res.moves };
    optimalForBoat = idx;
  }

  // Лучший старт считается только ДО 1-го знака (быстрее)
  function computeBestStart(){
    const line = { x:startB.x-startA.x, y:startB.y-startA.y };
    const len = Math.hypot(line.x,line.y) || 1;
    const ux = line.x/len, uy = line.y/len;
    const baseBoat = boats[
      Number.isInteger(selectedBoatIndex)
        ? selectedBoatIndex
        : (Number.isInteger(multiplayerSeatIndex) ? multiplayerSeatIndex : 0)
    ] || boats[0] || null;

    const n = clamp(Math.round(len / 1.2), 8, 16);
    let best = null;

    for (let i=1; i<=n; i++){
      const t = i/(n+1);
      const sp = { x: startA.x + ux*len*t, y: startA.y + uy*len*t };

      if (isTooCloseToMarks(sp)) continue;
      if (boatsPhysicalCollisionsEnabled() && isTooCloseToBoats(sp, -1)) continue;

      const res = planOptimalFrom(sp, 0, null, 0, "firstMark", -1, boatSpeedCoeff(baseBoat));
      if (!res) continue;

      if (!best || res.distance < best.stats.distance){
        best = { start: sp, path: res.path, stats: {distance:res.distance, turns:res.turns, moves:res.moves} };
      }
    }

    bestStartSolution = best;
  }

