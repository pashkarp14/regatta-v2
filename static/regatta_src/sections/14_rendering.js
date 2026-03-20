  // -----------------------------
  // Отрисовка
  // -----------------------------
  function drawField(){
    const tl = fieldTopLeft();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.strokeRect(tl.x, tl.y, fieldPixelW(), fieldPixelH());
  }

  function screenVectorFromWorldVector(vector){
    return {
      x: Number.isFinite(vector?.x) ? vector.x : 0,
      y: Number.isFinite(vector?.y) ? -vector.y : 0
    };
  }

  function screenAngleFromWorldVector(vector){
    const screenVector = screenVectorFromWorldVector(vector);
    return Math.atan2(screenVector.y, screenVector.x);
  }

  function screenWindFromVector(){
    return screenVectorFromWorldVector(windFromVec());
  }

  function screenUpwindAngle(){
    return screenAngleFromWorldVector(upwindVec());
  }

  function drawWindArrow(){
    if (!showWindArrow) return;
    const tl = fieldTopLeft();
    const windFrom = screenWindFromVector();
    const unit = (() => {
      const length = Math.hypot(windFrom.x, windFrom.y) || 1;
      return { x: windFrom.x / length, y: windFrom.y / length };
    })();
    const fieldCenter = {
      x: tl.x + fieldPixelW() / 2,
      y: tl.y + fieldPixelH() / 2,
    };
    const innerMargin = 18;
    const halfWidth = Math.max(24, fieldPixelW() / 2 - innerMargin);
    const halfHeight = Math.max(24, fieldPixelH() / 2 - innerMargin);
    const reachX = Math.abs(unit.x) > 1e-6 ? halfWidth / Math.abs(unit.x) : Number.POSITIVE_INFINITY;
    const reachY = Math.abs(unit.y) > 1e-6 ? halfHeight / Math.abs(unit.y) : Number.POSITIVE_INFINITY;
    const edgeReach = Math.min(reachX, reachY);
    const shaftLength = clamp(Math.min(fieldPixelW(), fieldPixelH()) * 0.18, 52, 92);
    const tail = {
      x: fieldCenter.x + unit.x * edgeReach,
      y: fieldCenter.y + unit.y * edgeReach,
    };
    const tip = {
      x: tail.x - unit.x * shaftLength,
      y: tail.y - unit.y * shaftLength,
    };
    const screenAngle = Math.atan2(tip.y - tail.y, tip.x - tail.x);

    ctx.save();
    ctx.strokeStyle = "#d32f2f";
    ctx.fillStyle = "#d32f2f";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - Math.cos(screenAngle - Math.PI / 6) * 16, tip.y - Math.sin(screenAngle - Math.PI / 6) * 16);
    ctx.lineTo(tip.x - Math.cos(screenAngle + Math.PI / 6) * 16, tip.y - Math.sin(screenAngle + Math.PI / 6) * 16);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawLine(aW, bW, color, dash){
    const a = worldToScreen(aW);
    const b = worldToScreen(bW);
    ctx.save();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x,a.y);
    ctx.lineTo(b.x,b.y);
    ctx.stroke();
    ctx.restore();
  }

  function laylineCourseVectors(){
    const base = upwindVec();
    const half = Math.max(5, deadZoneDeg / 2) * Math.PI / 180;
    return [
      rotateVec(base, half),
      rotateVec(base, -half)
    ];
  }

  function drawLaylineRay(anchor, dirUnit, color){
    const far = clampAlongRayToField(anchor, dirUnit, Math.hypot(worldW, worldH) * 2);
    const back = clampAlongRayToField(anchor, { x:-dirUnit.x, y:-dirUnit.y }, Math.hypot(worldW, worldH) * 2);
    drawLine(back, far, color, [10, 8]);
  }

  function drawLaylineBundle(anchor, color){
    const laylines = laylineCourseVectors();
    for (const vec of laylines){
      drawLaylineRay(anchor, { x:-vec.x, y:-vec.y }, color);
    }
  }

  function drawLaylines(){
    if (!showLaylines) return;

    for (let i=0;i<markCount;i++){
      drawLaylineBundle(marks[i], "rgba(255, 112, 67, 0.58)");
      const p = worldToScreen(marks[i]);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 112, 67, 0.24)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, ROUND_PASS_RADIUS * PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    drawLaylineBundle(startA, "rgba(23, 48, 66, 0.42)");
    drawLaylineBundle(startB, "rgba(23, 48, 66, 0.42)");

    if (finishSeparate){
      drawLaylineBundle(finishA, "rgba(47, 125, 50, 0.42)");
      drawLaylineBundle(finishB, "rgba(47, 125, 50, 0.42)");
    }
  }

  function drawStartLine(){ drawLine(startA, startB, "#000", [8,8]); }
  function drawFinishLine(){ if (!finishSeparate) return; drawLine(finishA, finishB, "#1b5e20", [10,6]); }

  function drawCommitteeBoatAtScreen(x,y, lineAngleRad){
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lineAngleRad);

    const hullL = Math.max(30, PX*1.2);
    const hullH = Math.max(14, PX*0.55);

    ctx.fillStyle = "#455a64";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(0, -hullH/2);
    ctx.lineTo(hullL*0.75, -hullH/2);
    ctx.lineTo(hullL, 0);
    ctx.lineTo(hullL*0.75, hullH/2);
    ctx.lineTo(0, hullH/2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#90a4ae";
    ctx.beginPath();
    ctx.rect(hullL*0.20, -hullH*0.45, hullL*0.30, hullH*0.60);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hullL*0.35, -hullH*0.45);
    ctx.lineTo(hullL*0.35, -hullH*1.6);
    ctx.stroke();

    ctx.fillStyle = "#d32f2f";
    ctx.beginPath();
    ctx.moveTo(hullL*0.35, -hullH*1.6);
    ctx.lineTo(hullL*0.55, -hullH*1.45);
    ctx.lineTo(hullL*0.35, -hullH*1.30);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawCommitteeBoatsOnLine(aW,bW, drawLeft, drawRight){
    const a = worldToScreen(aW);
    const b = worldToScreen(bW);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ang = Math.atan2(dy, dx);

    let left = a, right = b;
    if (a.x > b.x){ left = b; right = a; }

    if (drawLeft)  drawCommitteeBoatAtScreen(left.x,  left.y,  ang);
    if (drawRight) drawCommitteeBoatAtScreen(right.x, right.y, ang);
  }

  function drawMarks(){
    for (let i=0;i<markCount;i++){
      const m = marks[i];
      const p = worldToScreen(m);
      ctx.fillStyle = "#ff7043";
      ctx.beginPath();
      ctx.arc(p.x,p.y, Math.max(8, PX*0.25), 0, Math.PI*2);
      ctx.fill();

      ctx.fillStyle="#fff";
      ctx.font = `bold ${Math.max(10, PX*0.35)}px system-ui`;
      ctx.textAlign="center";
      ctx.textBaseline="middle";
      ctx.fillText(String(i+1), p.x, p.y);
    }
  }

  function drawGust(){
    const zone = normalizeGustZone(gustRect);
    if (!zone) return;

    const center = worldToScreen({ x: zone.cx, y: zone.cy });
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(zone.angle);
    ctx.fillStyle = "rgba(100,150,255,0.22)";
    ctx.strokeStyle = "rgba(100,150,255,0.68)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, zone.rx * PX, zone.ry * PX, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(-zone.rx * PX * 0.75, 0);
    ctx.lineTo(zone.rx * PX * 0.75, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawTrails(){
    if (!showTrails) return;
    for (let i=0; i<boatTrails.length; i++){
      const trail = boatTrails[i];
      if (!Array.isArray(trail) || trail.length < 2) continue;
      const points = trail.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
      if (points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = rgbaHex(boats[i]?.color || BOAT_COLORS[i % BOAT_COLORS.length], 0.34);
      ctx.lineWidth = Math.max(2, PX * 0.08);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const start = worldToScreen(points[0]);
      ctx.moveTo(start.x, start.y);
      for (let j=1; j<points.length; j++){
        const point = worldToScreen(points[j]);
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Large top-down yacht icon with a clear bow orientation.
  function drawYachtIcon(size, color, tack){
    const sailSide = (tack === -1) ? -1 : 1;
    const hullColor = mixHexColor(color, "black", 0.12);
    const deckColor = mixHexColor(color, "white", 0.55);
    const trimColor = mixHexColor(color, "white", 0.20);
    const sailShade = rgbaHex(color, 0.22);
    const wakeColor = rgbaHex(color, 0.14);
    const outlineColor = "#142133";

    ctx.save();
    ctx.scale(size / 24, size / 24);

    ctx.fillStyle = wakeColor;
    ctx.beginPath();
    ctx.moveTo(-5.8, 10.2);
    ctx.quadraticCurveTo(-2.6, 13.5, 0.0, 12.4);
    ctx.quadraticCurveTo(2.6, 13.5, 5.8, 10.2);
    ctx.quadraticCurveTo(2.5, 11.8, 0.0, 11.6);
    ctx.quadraticCurveTo(-2.5, 11.8, -5.8, 10.2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = hullColor;
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0.0, -11.1);
    ctx.bezierCurveTo(4.8, -8.8, 5.7, -2.0, 5.4, 6.8);
    ctx.quadraticCurveTo(4.4, 10.2, 0.0, 11.3);
    ctx.quadraticCurveTo(-4.4, 10.2, -5.4, 6.8);
    ctx.bezierCurveTo(-5.7, -2.0, -4.8, -8.8, 0.0, -11.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = deckColor;
    ctx.beginPath();
    ctx.moveTo(0.0, -8.2);
    ctx.bezierCurveTo(2.9, -6.7, 3.4, -1.4, 3.2, 5.1);
    ctx.quadraticCurveTo(2.5, 7.7, 0.0, 8.4);
    ctx.quadraticCurveTo(-2.5, 7.7, -3.2, 5.1);
    ctx.bezierCurveTo(-3.4, -1.4, -2.9, -6.7, 0.0, -8.2);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = trimColor;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(0.0, -7.5);
    ctx.lineTo(0.0, 8.1);
    ctx.moveTo(-2.2, 4.2);
    ctx.lineTo(2.2, 4.2);
    ctx.stroke();

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0.0, -8.8);
    ctx.lineTo(0.0, 6.3);
    ctx.stroke();

    ctx.save();
    ctx.scale(sailSide, 1);

    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.strokeStyle = "rgba(15,23,42,0.20)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0.0, -8.2);
    ctx.lineTo(0.0, 3.0);
    ctx.quadraticCurveTo(7.6, 1.0, 5.3, -6.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = sailShade;
    ctx.beginPath();
    ctx.moveTo(-0.1, -5.1);
    ctx.lineTo(-0.1, 4.8);
    ctx.quadraticCurveTo(-4.3, 3.5, -3.0, -3.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.beginPath();
    ctx.moveTo(0.0, -8.8);
    ctx.lineTo(2.4, -8.0);
    ctx.lineTo(0.0, -7.2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    ctx.fillStyle = mixHexColor(color, "black", 0.24);
    ctx.beginPath();
    ctx.moveTo(-0.8, 7.5);
    ctx.lineTo(0.8, 7.5);
    ctx.lineTo(0.45, 10.2);
    ctx.lineTo(-0.45, 10.2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawBoats(){
    for (let i=0;i<boats.length;i++){
      const b = boats[i];
      const p = worldToScreen({x:b.x,y:b.y});

      ctx.save();
      ctx.translate(p.x,p.y);

      let ang = 0;
      if (b.hasHeading){
        const vx = Math.cos(b.heading);
        const vy = -Math.sin(b.heading);
        ang = Math.atan2(vy, vx) + Math.PI/2;
      }
      ctx.rotate(ang);

      const size = clamp(PX * 1.6, 10, 72);
      drawYachtIcon(size, b.color, b.tack);

      ctx.rotate(-ang);
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.lineWidth = Math.max(2, size*0.07);
      ctx.fillStyle = "#102033";
      ctx.font = `700 ${Math.max(11, size*0.28)}px system-ui`;
      ctx.textAlign="center";
      ctx.textBaseline="middle";
      ctx.strokeText(String(i+1), 0, size*0.05);
      ctx.fillText(String(i+1), 0, size*0.05);

      if (b.finished){
        ctx.strokeStyle = "#00c853";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0,0, Math.max(15, size*0.78), 0, Math.PI*2);
        ctx.stroke();
      }

      if ((mode === "boats" || mode === "model") && placementSelectedBoat === i){
        ctx.strokeStyle = "#1976d2";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0,0, Math.max(17, size*0.90), 0, Math.PI*2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  function drawCapsuleOverlay(capsule, fillStyle, strokeStyle, extraRadius=0){
    const a = worldToScreen(capsule.a);
    const b = worldToScreen(capsule.b);
    const r = (capsule.r + extraRadius) * PX;

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = fillStyle;
    ctx.lineWidth = Math.max(4, r * 2);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoatPlacementOverlay(){
    if (mode !== "boats" && mode !== "model") return;

    ctx.save();

    ctx.fillStyle = "rgba(0, 200, 0, 0.10)";
    ctx.strokeStyle = "rgba(0, 200, 0, 0.30)";
    ctx.lineWidth = 2;

    const tl = fieldTopLeft();

    if (mode === "model"){
      ctx.fillRect(tl.x, tl.y, fieldPixelW(), fieldPixelH());
      ctx.strokeRect(tl.x, tl.y, fieldPixelW(), fieldPixelH());
    } else {
      const A = startA, B = startB;
      const a = worldToScreen(A);
      const b = worldToScreen(B);

      if (prestartRoundsSetting > 0 && phase === "prestart"){
        const n = prestartNormalUnit();
        const A2 = { x:A.x + n.x*PRESTART_DEPTH, y:A.y + n.y*PRESTART_DEPTH };
        const B2 = { x:B.x + n.x*PRESTART_DEPTH, y:B.y + n.y*PRESTART_DEPTH };

        const a2 = worldToScreen(A2);
        const b2 = worldToScreen(B2);

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.lineTo(a2.x, a2.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        const thickness = START_PICK_TOL * PX;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const L = Math.hypot(dx,dy) || 1;
        const nx = -dy/L;
        const ny = dx/L;

        const p1 = { x:a.x + nx*thickness, y:a.y + ny*thickness };
        const p2 = { x:b.x + nx*thickness, y:b.y + ny*thickness };
        const p3 = { x:b.x - nx*thickness, y:b.y - ny*thickness };
        const p4 = { x:a.x - nx*thickness, y:a.y - ny*thickness };

        ctx.beginPath();
        ctx.moveTo(p1.x,p1.y);
        ctx.lineTo(p2.x,p2.y);
        ctx.lineTo(p3.x,p3.y);
        ctx.lineTo(p4.x,p4.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(255, 0, 0, 0.10)";
    ctx.strokeStyle = "rgba(255, 0, 0, 0.25)";
    ctx.lineWidth = 1.5;

    for (let i=0;i<boats.length;i++){
      if (placementSelectedBoat === i) continue;
      drawCapsuleOverlay(
        boatCapsuleForIndex(i),
        "rgba(255, 0, 0, 0.18)",
        "rgba(255, 0, 0, 0.30)",
        BOAT_CLEARANCE_MARGIN
      );
    }

    for (let i=0;i<markCount;i++){
      const p = worldToScreen(marks[i]);
      const r = (MARK_RADIUS + BOAT_COLLISION_RADIUS + MARK_CLEARANCE_MARGIN) * PX;
      ctx.beginPath();
      ctx.arc(p.x,p.y,r,0,Math.PI*2);
      ctx.fill(); ctx.stroke();
    }

    ctx.restore();
  }

  function drawMoveOverlay(){
    if (mode !== "play") return;
    if (selectedBoatIndex === null) return;
    const b = boats[selectedBoatIndex];
    if (!b || b.finished) return;

    const baseFactor = boatSpeedCoeff(b) * (pointInGust({x:b.x,y:b.y}) ? GUST_MULT : 1.0);
    const baseR = STEP_RADIUS_BASE * baseFactor;

    const center = worldToScreen({x:b.x,y:b.y});
    const Rp = baseR * PX;

    ctx.fillStyle = "rgba(0, 200, 0, 0.08)";
    ctx.strokeStyle = "rgba(0, 200, 0, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, Rp, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    const baseAng = screenUpwindAngle();
    const half = (deadZoneDeg * Math.PI/180)/2;

    if (deadZoneDeg > 0){
      ctx.fillStyle = "rgba(255, 0, 0, 0.14)";
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.arc(center.x, center.y, Rp, baseAng - half, baseAng + half, false);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.font = "12px system-ui";
    ctx.textAlign="center";
    ctx.textBaseline="bottom";
    const tips = [];
    tips.push(`Огибание: ${roundingSide==="port" ? "знак слева" : "знак справа"}, зона: ${ROUND_PASS_RADIUS.toFixed(2)}`);
    if (pointInGust({x:b.x,y:b.y})) tips.push("Порыв: +дальность");
    tips.push(`Скорость: ×${boatSpeedCoeff(b).toFixed(2)}`);
    if (tackPenaltyFactor < 1.0) tips.push(`Штраф смены галса: ×${tackPenaltyFactor.toFixed(2)}`);
    tips.push(`Дотягивание: ${snapThreshold.toFixed(2)}R`);
    tips.push(`Лодки: ${interactionModeLabel()}`);
    ctx.fillText(tips.join(" | "), center.x, center.y - Rp - 6);
  }

  function drawOptimalPath(){
    if (shouldRenderOptimalHint() && optimalPath && optimalPath.length >= 2){
      ctx.save();
      ctx.strokeStyle = "rgba(25, 118, 210, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      const p0 = worldToScreen(optimalPath[0]);
      ctx.moveTo(p0.x,p0.y);
      for (let i=1;i<optimalPath.length;i++){
        const p = worldToScreen(optimalPath[i]);
        ctx.lineTo(p.x,p.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (shouldRenderBestStartHint() && bestStartSolution){
      const path = bestStartSolution.path;
      if (path && path.length >= 2){
        ctx.save();
        ctx.strokeStyle = "rgba(46, 125, 50, 0.85)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        const p0 = worldToScreen(path[0]);
        ctx.moveTo(p0.x,p0.y);
        for (let i=1;i<path.length;i++){
          const p = worldToScreen(path[i]);
          ctx.lineTo(p.x,p.y);
        }
        ctx.stroke();
        ctx.restore();
      }

      const sp = worldToScreen(bestStartSolution.start);
      ctx.save();
      ctx.fillStyle = "rgba(46,125,50,0.90)";
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, Math.max(6, PX*0.18), 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = "#0d3b14";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawRealtimeHudPanel(){
    if (!isCursorSteeringMode() || mode !== "play") return;

    const boatIdx = realtimeControlledBoatIndex();
    const boat = Number.isInteger(boatIdx) ? boats[boatIdx] : null;
    if (!boat) return;

    const courseDeg = boatCourseToWindDeg(boat);
    const speedMps = boatRealtimeSpeedMps(boat);
    const reverse = (Number.isFinite(boat.currentSpeedUnitsPerSec) ? boat.currentSpeedUnitsPerSec : 0) < -1e-6;
    const lines = [
      `Лодка ${boatIdx + 1}`,
      `Острота к ветру: ${courseDeg === null ? "—" : `${courseDeg.toFixed(0)}°`}`,
      `Скорость: ${speedMps.toFixed(1)} м/с`,
      `Галс: ${boatTackLabel(boat)}`,
      `Пройдено: ${formatMeters(boat.distance || 0)}`,
      `Знаки: ${Math.min(boat.nextMark || 0, markCount)} / ${markCount}`
    ];

    if (reverse){
      lines.push("Режим: задний ход 10%");
    } else if ((Number.isFinite(boat.penaltySlowUntil) ? boat.penaltySlowUntil : 0) > currentRaceTimeMs()){
      lines.push("Штраф: замедление");
    }

    ctx.save();
    const boxX = 18;
    const boxY = 18;
    const boxW = 320;
    const boxH = 30 + lines.length * 18;
    ctx.fillStyle = "rgba(255, 253, 248, 0.90)";
    ctx.strokeStyle = rgbaHex(boat.color, 0.55);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#173042";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "700 15px system-ui";
    ctx.fillText(lines[0], boxX + 14, boxY + 12);
    ctx.font = "600 13px system-ui";
    for (let i=1; i<lines.length; i++){
      ctx.fillText(lines[i], boxX + 14, boxY + 12 + i * 18);
    }
    ctx.restore();
  }

  function drawRealtimeOverlay(){
    refreshRealtimeIntentFromPointer({ emit:false });
    if (isCursorSteeringMode() && mode === "play" && (realtimeCursorTarget || realtimeCursorDirection)){
      const boatIdx = realtimeControlledBoatIndex();
      const boat = Number.isInteger(boatIdx) ? boats[boatIdx] : null;
      if (boat){
        const start = worldToScreen({ x: boat.x, y: boat.y });
        const overlayTarget = realtimeCursorTarget || clampAlongRayToField(
          { x: boat.x, y: boat.y },
          realtimeCursorDirection || { x: 1, y: 0 },
          Math.max(worldW, worldH) * 2
        );
        const target = worldToScreen(overlayTarget);
        ctx.save();
        ctx.strokeStyle = rgbaHex(boat.color, 0.72);
        ctx.fillStyle = rgbaHex(boat.color, 0.96);
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(target.x, target.y, Math.max(5, PX * 0.12), 0, Math.PI * 2);
        ctx.fill();
        if (realtimeCursorTarget && overlayTarget !== realtimeCursorTarget){
          const pointerTarget = worldToScreen(realtimeCursorTarget);
          ctx.beginPath();
          ctx.arc(pointerTarget.x, pointerTarget.y, Math.max(4, PX * 0.09), 0, Math.PI * 2);
          ctx.fillStyle = rgbaHex(boat.color, 0.35);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    drawRealtimeHudPanel();

    if (isRealtimePaused()){
      const pausePrimary = phase === "countdown" ? "Пауза перед стартом" : "Гонка на паузе";
      const pauseSecondary = multiplayerSessionActive
        ? (phase === "countdown"
          ? (multiplayerHostMode ? "Хост остановил общий отсчёт" : "Отсчёт остановлен хостом")
          : (multiplayerHostMode ? "Комната на паузе для всех лодок" : "Хост поставил гонку на паузу"))
        : (phase === "countdown"
          ? "Отсчёт и движение лодок остановлены"
          : "Лодки остановлены. Нажми «Продолжить»");
      const pauseBoxW = 360;
      const pauseBoxH = 76;
      const pauseBoxX = (canvas.width - pauseBoxW) / 2;
      const pauseBoxY = canvas.height * 0.12;
      ctx.save();
      ctx.fillStyle = "rgba(10, 24, 34, 0.88)";
      ctx.strokeStyle = "rgba(120, 229, 217, 0.72)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(pauseBoxX, pauseBoxY, pauseBoxW, pauseBoxH, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f2f6f8";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = "700 28px Georgia, serif";
      ctx.fillText(pausePrimary, canvas.width / 2, pauseBoxY + 12);
      ctx.font = "600 14px system-ui";
      ctx.fillStyle = "rgba(226, 238, 242, 0.86)";
      ctx.fillText(pauseSecondary, canvas.width / 2, pauseBoxY + 46);
      ctx.restore();
    }

    const countdown = realtimeCountdownState();
    if (!countdown.active) return;

    const primary = `До старта ${formatCountdownSeconds(countdown.totalMsLeft)} с`;
    const secondary = countdown.inFinal
      ? "Последние 3 секунды. Фальстарт считается уже сейчас"
      : "Фальстарт считается только в последние 3.0 с до старта";
    const boxW = 340;
    const boxH = 68;
    const boxX = (canvas.width - boxW) / 2;
    const boxY = 18;
    ctx.save();
    ctx.fillStyle = countdown.inFinal ? "rgba(183, 28, 28, 0.96)" : "rgba(255, 253, 248, 0.94)";
    ctx.strokeStyle = countdown.inFinal ? "rgba(255, 235, 238, 0.86)" : "rgba(23, 48, 66, 0.12)";
    ctx.lineWidth = countdown.inFinal ? 3 : 1.5;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = countdown.inFinal ? "#fff8f6" : "#173042";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = countdown.inFinal ? "700 28px Georgia, serif" : "700 24px Georgia, serif";
    ctx.fillText(primary, canvas.width / 2, boxY + 12);
    ctx.font = countdown.inFinal ? "700 14px system-ui" : "600 14px system-ui";
    ctx.fillStyle = countdown.inFinal ? "rgba(255, 248, 246, 0.96)" : "rgba(23, 48, 66, 0.78)";
    ctx.fillText(secondary, canvas.width / 2, boxY + 42);
    ctx.restore();
  }

  function render(){
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);

    drawField();
    drawGust();
    drawLaylines();

    drawStartLine();
    drawCommitteeBoatsOnLine(startA, startB, false, true);

    drawFinishLine();
    if (finishSeparate){
      drawCommitteeBoatsOnLine(finishA, finishB, true, true);
    }

    drawMarks();
    drawWindArrow();

    drawBoatPlacementOverlay();
    drawMoveOverlay();

    drawOptimalPath();
    drawTrails();
    drawBoats();
    drawRealtimeOverlay();
  }

