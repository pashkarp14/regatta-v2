  // -----------------------------
  // Клики по canvas
  // -----------------------------
  function updateRealtimeIntentFromClient(clientX, clientY){
    if (mode !== "play" || !isCursorSteeringMode()) return;
    if (isLocalRealtimePaused()){
      resetRealtimePointer();
      render();
      return;
    }
    realtimeCursorClient = { clientX, clientY };
    const boatIdx = realtimeControlledBoatIndex();
    if (!Number.isInteger(boatIdx) || !boats[boatIdx] || boats[boatIdx].finished || phase === "finished"){
      clearRealtimeIntent();
      return;
    }
    refreshRealtimeIntentFromPointer({ emit:true });
  }

  function resetRealtimePointer(pointerId=null, { keepIntent=false } = {}){
    if (pointerId === null || activeRealtimePointerId === pointerId){
      activeRealtimePointerId = null;
      realtimeCursorClient = null;
      if (!keepIntent){
        clearRealtimeIntent();
      }
    }
  }

  canvas.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey){
      e.preventDefault();
      const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      setZoom(zoom * zoomFactor, e.clientX, e.clientY);
      render();
      return;
    }

    if (e.deltaX === 0 && e.deltaY === 0) return;
    e.preventDefault();

    let deltaX = -e.deltaX;
    let deltaY = -e.deltaY;
    if (e.shiftKey && Math.abs(e.deltaX) < 0.01){
      deltaX = -e.deltaY;
      deltaY = 0;
    }

    panCameraBy(deltaX, deltaY);
    render();
  }, { passive:false });

  canvas.addEventListener("pointerdown", (e) => {
    if (mode !== "play" || !isCursorSteeringMode()) return;
    if (isLocalRealtimePaused()){
      e.preventDefault();
      return;
    }
    const point = screenToWorld(e.clientX, e.clientY);
    if (isLocalRealtimeMode() && point){
      const hitBoat = getBoatAtPoint(point);
      if (hitBoat >= 0 && !boats[hitBoat]?.finished){
        selectedBoatIndex = hitBoat;
        clearRealtimeIntent();
        updateStatus();
        updateStats();
        render();
        e.preventDefault();
        return;
      }
    }
    if (e.pointerType !== "mouse"){
      activeRealtimePointerId = e.pointerId;
      canvas.setPointerCapture?.(e.pointerId);
    }
    updateRealtimeIntentFromClient(e.clientX, e.clientY);
    render();
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (mode !== "play" || !isCursorSteeringMode()) return;
    if (e.pointerType === "mouse" || activeRealtimePointerId === e.pointerId){
      updateRealtimeIntentFromClient(e.clientX, e.clientY);
      render();
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!isCursorSteeringMode()) return;
    if (e.pointerType !== "mouse"){
      resetRealtimePointer(e.pointerId);
      render();
    }
  });

  canvas.addEventListener("pointercancel", (e) => {
    if (!isCursorSteeringMode()) return;
    resetRealtimePointer(e.pointerId);
    render();
  });

  canvas.addEventListener("mouseleave", () => {
    if (!isCursorSteeringMode()) return;
    resetRealtimePointer(null, { keepIntent:true });
    render();
  });

  canvas.addEventListener("click", (e) => {
    if (mode === "play" && isCursorSteeringMode()) return;
    const p = screenToWorld(e.clientX, e.clientY);
    if (!p) return;

    if (mode === "marks"){
      const idx = parseInt(markToEditSelect.value,10);
      marks[idx] = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
      invalidateSolutions();
      updateStatus();
      updateOptInfo();
      render();
      return;
    }

    if (mode === "start"){
      if (!startAwaitSecond){
        startA = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
        startB = { ...startA };
        startAwaitSecond = true;
      } else {
        startB = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
        startAwaitSecond = false;

        if (!finishSeparate){
          finishA = { ...startA };
          finishB = { ...startB };
        }
        resetBoats();
      }
      ensureScenarioLegOptions();
      invalidateSolutions();
      updateStatus();
      updateStats();
      updateOptInfo();
      render();
      return;
    }

    if (mode === "finish"){
      if (!finishSeparate) return;

      if (!finishAwaitSecond){
        finishA = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
        finishB = { ...finishA };
        finishAwaitSecond = true;
      } else {
        finishB = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };
        finishAwaitSecond = false;
      }
      invalidateSolutions();
      updateStatus();
      updateOptInfo();
      render();
      return;
    }

    if (mode === "boats"){
      const bi = getBoatAtPoint(p);
      if (bi >= 0){
        placementSelectedBoat = bi;
        render();
        return;
      }

      if (placementSelectedBoat !== null){
        let dest = null;

        if (prestartRoundsSetting > 0 && phase === "prestart"){
          if (pointInPrestartZone(p)) dest = p;
        } else {
          const info = pointToSegment(p, startA, startB);
          if (info.d <= START_PICK_TOL) dest = info.proj;
        }

        if (dest){
          if (!isTooCloseToMarks(dest) && !isTooCloseToBoats(dest, placementSelectedBoat)){
            const b = boats[placementSelectedBoat];
            b.x = dest.x;
            b.y = dest.y;
            b.hasHeading = false;
            b.heading = 0;
            b.tack = 0;
            b.roundInZone = false;
            b.roundSweep = 0;
          }
        }

        placementSelectedBoat = null;
        invalidateSolutions();
        updateStats();
        updateOptInfo();
        render();
      }
      return;
    }

    if (mode === "model"){
      const bi = getBoatAtPoint(p);
      if (bi >= 0){
        placementSelectedBoat = bi;
        render();
        return;
      }

      if (placementSelectedBoat !== null){
        const dest = { x: clamp(p.x,0,worldW), y: clamp(p.y,0,worldH) };

        if (!isTooCloseToMarks(dest) && !isTooCloseToBoats(dest, placementSelectedBoat)){
          const b = boats[placementSelectedBoat];
          b.x = dest.x;
          b.y = dest.y;
          b.hasHeading = false;
          b.heading = 0;
          b.tack = 0;
          b.roundInZone = false;
          b.roundSweep = 0;
        }

        placementSelectedBoat = null;
        invalidateSolutions();
        updateStats();
        updateOptInfo();
        render();
      }
      return;
    }

    // play
    const clickedBoat = getBoatAtPoint(p);

    if (clickedBoat >= 0 && canSelectBoatForPlay(clickedBoat)){
      selectedBoatIndex = clickedBoat;
      render();
      return;
    }

    if (selectedBoatIndex !== null && canSelectBoatForPlay(selectedBoatIndex)){
      const dest = proposeDestination(selectedBoatIndex, p);
      if (dest){
        performMove(selectedBoatIndex, dest);
        maybeStartGunIfNeeded();
        invalidateSolutions();
        updateStatus();
        updateStats();
        updateOptInfo();
      } else {
        render();
      }
    }
  });

