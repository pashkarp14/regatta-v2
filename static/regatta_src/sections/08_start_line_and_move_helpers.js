  // -----------------------------
  // "За стартовой линией" — сторона предстарт
  // -----------------------------
  function startLineDirUnit(){
    const v = { x:startB.x-startA.x, y:startB.y-startA.y };
    const n = norm(v);
    return { x:n.x, y:n.y };
  }

  function courseSideNormalUnit(){
    const d = startLineDirUnit();
    const n1 = { x:-d.y, y:d.x };
    const n2 = { x:d.y,  y:-d.x };

    const mid = { x:(startA.x+startB.x)/2, y:(startA.y+startB.y)/2 };
    const m = marks[0] || { x:mid.x, y:mid.y+1 };
    const vm = { x:m.x-mid.x, y:m.y-mid.y };

    const dot1 = n1.x*vm.x + n1.y*vm.y;
    const dot2 = n2.x*vm.x + n2.y*vm.y;

    return (dot1 >= dot2) ? n1 : n2;
  }

  function prestartNormalUnit(){
    const c = courseSideNormalUnit();
    return { x:-c.x, y:-c.y };
  }

  function pointInPrestartZone(p){
    const d = startLineDirUnit();
    const n = prestartNormalUnit();
    const A = startA;
    const AP = { x:p.x-A.x, y:p.y-A.y };

    const along = AP.x*d.x + AP.y*d.y;
    const across = AP.x*n.x + AP.y*n.y;

    const lineLen = Math.hypot(startB.x-startA.x, startB.y-startA.y);
    return along >= 0 && along <= lineLen && across >= 0 && across <= PRESTART_DEPTH;
  }

  // -----------------------------
  // Ход: клик → дотягивание
  // -----------------------------
  function clampAlongRayToField(startPos, dirUnit, maxLen){
    let tMax = maxLen;

    if (Math.abs(dirUnit.x) > 1e-9){
      const tx1 = (0 - startPos.x) / dirUnit.x;
      const tx2 = (worldW - startPos.x) / dirUnit.x;
      tMax = Math.min(tMax, Math.max(tx1,tx2));
      tMax = Math.max(0, tMax);
    } else {
      if (startPos.x < 0 || startPos.x > worldW) return { ...startPos };
    }

    if (Math.abs(dirUnit.y) > 1e-9){
      const ty1 = (0 - startPos.y) / dirUnit.y;
      const ty2 = (worldH - startPos.y) / dirUnit.y;
      tMax = Math.min(tMax, Math.max(ty1,ty2));
      tMax = Math.max(0, tMax);
    } else {
      if (startPos.y < 0 || startPos.y > worldH) return { ...startPos };
    }

    return { x: startPos.x + dirUnit.x*tMax, y: startPos.y + dirUnit.y*tMax };
  }

  function proposeDestination(boatIdx, clickP){
    const b = boats[boatIdx];
    if (!b || b.finished) return null;

    const v = { x: clickP.x - b.x, y: clickP.y - b.y };
    const n = norm(v);
    if (n.L < 1e-6) return null;

    const dir = { x: n.x, y: n.y };
    if (isMoveInDeadZone(v)) return null;

    const R = allowedRadiusForMove(b, dir);

    let dest = clickP;
    if (n.L >= snapThreshold * R){
      dest = clampAlongRayToField({x:b.x,y:b.y}, dir, R);
    }

    if (!pointInField(dest)) return null;
    const headingAng = Math.atan2(dir.y, dir.x);
    if (isTooCloseToMarks(dest, boatIdx, headingAng, true)) return null;
    if (boatsPhysicalCollisionsEnabled() && isTooCloseToBoats(dest, boatIdx, headingAng, true)) return null;

    const dd = dist(dest, {x:b.x,y:b.y});
    if (dd > R + 1e-6) return null;

    const prevPos = {x:b.x,y:b.y};
    if (pathIntersectsAnyMark(prevPos, dest)) return null;
    if (boatsPhysicalCollisionsEnabled() && pathIntersectsOtherBoat(prevPos, dest, boatIdx)) return null;

    return dest;
  }

