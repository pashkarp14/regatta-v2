  // -----------------------------
  // ОГИБАНИЕ (исправлено): "войти в зону → пройти нужным бортом → выйти из зоны"
  // -----------------------------
  function roundingZoneRelation(p, markPos){
    const d = dist(p, markPos);
    if (d < ROUND_PASS_RADIUS - 1e-9) return -1;
    if (d > ROUND_PASS_RADIUS + 1e-9) return 1;
    return 0;
  }

  function roundingSideOkAt(point, dirUnit, markPos){
    if (!point || !dirUnit) return false;

    const v = { x: markPos.x - point.x, y: markPos.y - point.y };
    const cross = dirUnit.x * v.y - dirUnit.y * v.x;
    if (roundingSide === "port") return (cross > 1e-9);
    return (cross < -1e-9);
  }

  function angleAroundMark(point, markPos){
    return Math.atan2(point.y - markPos.y, point.x - markPos.x);
  }

  function roundingSweepDelta(fromPoint, toPoint, markPos){
    return angleWrap(angleAroundMark(toPoint, markPos) - angleAroundMark(fromPoint, markPos));
  }

  function roundingSweepOk(sweep){
    if (roundingSide === "port") return sweep >= ROUNDING_MIN_SWEEP - 1e-9;
    return sweep <= -ROUNDING_MIN_SWEEP + 1e-9;
  }

  function roundingSweepKey(sweep){
    const clampedSweep = clamp(sweep, -Math.PI, Math.PI);
    return Math.round(clampedSweep / ROUNDING_SWEEP_BIN_RAD);
  }

  function segmentRoundingInfo(prevPos, curPos, dirUnit, markPos){
    const startRel = roundingZoneRelation(prevPos, markPos);
    const endRel = roundingZoneRelation(curPos, markPos);

    const startInside = (startRel < 0);
    const endInside = (endRel < 0);
    const endBoundary = (endRel === 0);
    const endOutside = (endRel > 0);
    const startBoundary = (startRel === 0);

    const seg = { x: curPos.x - prevPos.x, y: curPos.y - prevPos.y };
    const a = seg.x*seg.x + seg.y*seg.y;

    let enteredInterior = startInside || endInside;
    let exitPoint = null;

    if (a > 1e-12){
      const fx = prevPos.x - markPos.x;
      const fy = prevPos.y - markPos.y;
      const b = 2 * (fx*seg.x + fy*seg.y);
      const c = fx*fx + fy*fy - ROUND_PASS_RADIUS*ROUND_PASS_RADIUS;
      const disc = b*b - 4*a*c;

      if (disc > 1e-12){
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-b - sqrtDisc) / (2*a);
        const t2 = (-b + sqrtDisc) / (2*a);
        const interiorStart = Math.max(0, t1);
        const interiorEnd = Math.min(1, t2);

        if (interiorEnd - interiorStart > 1e-6){
          enteredInterior = true;

          if (endOutside){
            const tExit = Math.max(0, Math.min(1, t2));
            exitPoint = {
              x: prevPos.x + seg.x*tExit,
              y: prevPos.y + seg.y*tExit
            };
          }
        }
      }
    }

    return {
      startInside,
      startBoundary,
      endInside,
      endBoundary,
      endOutside,
      enteredInterior,
      exitPoint
    };
  }

  // Возвращает true только тогда, когда знак считается огибнутым "по-настоящему"
  function processRoundingRuntime(boat, prevPos, curPos, dirUnit, markPos){
    const info = segmentRoundingInfo(prevPos, curPos, dirUnit, markPos);
    const effectiveInZone = boat.roundInZone || info.startInside;

    // 1) Проход "сквозь зону" за один ход: старт и финиш хода снаружи, но сегмент прошёл рядом
    const curSweep = Number.isFinite(boat.roundSweep) ? boat.roundSweep : 0;

    if (!effectiveInZone){
      if (info.endInside){
        boat.roundInZone = true;
        boat.roundSweep = 0;
      } else {
        boat.roundInZone = false;
        boat.roundSweep = 0;
      }
      return false;
    }

    // 2) Мы оказались внутри зоны в конце хода → фиксируем "в зоне" и копим признак нужного борта
    if (!info.endOutside){
      boat.roundInZone = true;
      boat.roundSweep = curSweep + roundingSweepDelta(prevPos, curPos, markPos);
      return false;
    }

    // 3) Мы вышли из зоны (endIn=false). Если мы были в зоне раньше — засчитываем при выходе
    let exitPoint = info.exitPoint;
    if (!exitPoint && info.startBoundary){
      exitPoint = prevPos;
    }

    const totalSweep = exitPoint ? (curSweep + roundingSweepDelta(prevPos, exitPoint, markPos)) : curSweep;

    boat.roundInZone = false;
    boat.roundSweep = 0;
    return !!exitPoint && roundingSweepOk(totalSweep) && roundingSideOkAt(exitPoint, dirUnit, markPos);
  }

  // Версия для планировщика (A*): такие же правила, но состояние хранится в узле
  function processRoundingPlanner(prevPos, curPos, dirUnit, markPos, inZone, sweep){
    const info = segmentRoundingInfo(prevPos, curPos, dirUnit, markPos);
    const effectiveInZone = (inZone === true) || info.startInside;
    const curSweep = Number.isFinite(sweep) ? sweep : 0;

    if (!effectiveInZone){
      if (info.endInside){
        return { inZone:true, sweep:0, completed:false };
      }
      return { inZone:false, sweep:0, completed:false };
    }

    if (!info.endOutside){
      return {
        inZone:true,
        sweep:curSweep + roundingSweepDelta(prevPos, curPos, markPos),
        completed:false
      };
    }

    let exitPoint = info.exitPoint;
    if (!exitPoint && info.startBoundary){
      exitPoint = prevPos;
    }

    const totalSweep = exitPoint ? (curSweep + roundingSweepDelta(prevPos, exitPoint, markPos)) : curSweep;

    return {
      inZone:false,
      sweep:0,
      completed:!!exitPoint && roundingSweepOk(totalSweep) && roundingSideOkAt(exitPoint, dirUnit, markPos)
    };
  }

