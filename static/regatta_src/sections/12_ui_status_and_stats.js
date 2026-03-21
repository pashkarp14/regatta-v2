  // -----------------------------
  // UI / статус / статистика
  // -----------------------------
  function updateStatus(){
    syncFullscreenPhaseWatch();

    if (mode === "marks"){
      const idx = parseInt(markToEditSelect.value,10) + 1;
      statusEl.textContent = `Режим: знаки. Клик по полю — поставить знак ${idx}.`;
      return;
    }
    if (mode === "start"){
      statusEl.textContent = startAwaitSecond
        ? "Режим: старт. Выбери второй конец стартовой линии."
        : "Режим: старт. Первый клик — первый конец, второй клик — второй конец.";
      return;
    }
    if (mode === "finish"){
      statusEl.textContent = finishAwaitSecond
        ? "Режим: финиш. Выбери второй конец финишной линии."
        : "Режим: финиш. Первый клик — первый конец, второй клик — второй конец.";
      return;
    }
    if (mode === "boats"){
      statusEl.textContent = "Режим: лодки. Клик по лодке — выбрать. Клик в стартовую зону — переставить лодку, не задевая другие лодки и знаки.";
      return;
    }
    if (mode === "model"){
      statusEl.textContent =
        "Режим: моделирование. Клик по лодке — выбрать. Клик по полю — поставить лодку. Затем выбери участок дистанции и нажми «Применить ситуацию».";
      return;
    }

    if (isRaceComplete()){
      statusEl.textContent = "Гонка завершена: все лодки финишировали.";
      return;
    }

    const controlledBoatIndex = realtimeControlledBoatIndex();
    const ownBoat = Number.isInteger(controlledBoatIndex) ? boats[controlledBoatIndex] : null;
    const ownLegInfo = ownBoat && !ownBoat.finished
      ? ` Твоя лодка: ${controlledBoatIndex + 1}. Следующий знак: ${Math.min(ownBoat.nextMark + 1, markCount)} из ${markCount}.`
      : "";

    if (isRealtimePaused()){
      if (phase === "countdown"){
        const countdown = realtimeCountdownState();
        statusEl.textContent = multiplayerSessionActive
          ? `Пауза. ${multiplayerHostMode ? "Общий отсчет остановлен" : "Хост остановил отсчет"} на ${formatCountdownSeconds(countdown.totalMsLeft)} с.${ownLegInfo}`
          : `Пауза. Отсчет остановлен на ${formatCountdownSeconds(countdown.totalMsLeft)} с. Нажми «Продолжить», чтобы вернуться к старту.${ownLegInfo}`;
      } else {
        statusEl.textContent = multiplayerSessionActive
          ? `Пауза. ${multiplayerHostMode ? "Гонка остановлена для всей комнаты" : "Хост остановил гонку"}.${ownLegInfo}`
          : `Пауза. Realtime-гонка остановлена. Нажми «Продолжить», чтобы вернуть лодки в гонку.${ownLegInfo}`;
      }
      return;
    }

    if (phase === "countdown"){
      const countdown = realtimeCountdownState();
      if (countdown.active){
        statusEl.textContent = `Предстарт. До сигнала ${formatCountdownSeconds(countdown.totalMsLeft)} с. Фальстарт считается только в последние 3.0 с до старта.${ownLegInfo}`;
      } else if (isLocalRealtimeMode()) {
        const localHint = isLocalBotsMode()
          ? "Лодка 1 под твоим управлением, остальные экипажи ведёт ИИ."
          : "Веди выбранную лодку курсором мыши или касанием по полю.";
        statusEl.textContent = `Локальный realtime готов. Нажми «Общий старт», чтобы открыть предстарт. ${localHint}${ownLegInfo}`;
      } else {
        statusEl.textContent = `Ожидание общего старта.${ownLegInfo}`;
      }
      return;
    }

    if (phase === "finished"){
      statusEl.textContent = "Гонка завершена: все лодки финишировали.";
      return;
    }

    const controlHint = isLocalRealtimeMode()
      ? (isLocalBotsMode()
        ? "Веди лодку 1 курсором мыши или касанием по полю, остальные экипажи рулит ИИ."
        : "Веди выбранную лодку курсором мыши или касанием по полю.")
      : "Веди свою лодку курсором мыши или касанием по полю.";
    statusEl.textContent = `Реальное время. Все лодки идут одновременно. ${controlHint}${ownLegInfo}`;
  }

  function updateStats(){
    const lines = [];
    const finishLinePoints = finishLine();
    const courseLegs = [];
    const startMid = midpoint(startA, startB);
    const finishMid = midpoint(finishLinePoints[0], finishLinePoints[1]);
    const visibleMarks = marks.slice(0, markCount);

    if (visibleMarks.length){
      courseLegs.push(`Старт → знак 1: <b>${formatMeters(dist(startMid, visibleMarks[0]))}</b>`);
      for (let i=1; i<visibleMarks.length; i++){
        courseLegs.push(`Знак ${i} → знак ${i+1}: <b>${formatMeters(dist(visibleMarks[i-1], visibleMarks[i]))}</b>`);
      }
      courseLegs.push(`Знак ${visibleMarks.length} → финиш: <b>${formatMeters(dist(visibleMarks[visibleMarks.length - 1], finishMid))}</b>`);
    }

    lines.push(`<b>Статистика</b>`);
    lines.push(`<div style="display:grid;gap:8px;margin-top:6px;">`);
    lines.push(`<div><b>Стартовая линия:</b> ${formatMeters(lineLengthUnits(startA, startB))}</div>`);
    lines.push(`<div><b>Финишная линия:</b> ${formatMeters(lineLengthUnits(finishLinePoints[0], finishLinePoints[1]))}</div>`);
    if (courseLegs.length){
      lines.push(`<div><b>Леги дистанции:</b> ${courseLegs.join(" · ")}</div>`);
    }
    lines.push(`</div>`);

    lines.push(`<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;">`);
    for (let i=0;i<boats.length;i++){
      const boat = boats[i];
      const fin = boat.finished
        ? `✅ финиш: ${boat.place}`
        : (phase === "finished"
          ? "⏳ финишный протокол"
          : phase === "countdown"
            ? "⏳ стартовая процедура"
            : "⏳ в гонке");
      const controlledBoatIndex = realtimeControlledBoatIndex();
      const controlLabel = controlledBoatIndex === i
        ? "курсор"
        : (isLocalRealtimeMode() ? "без управления" : "сервер");
      lines.push(`
        <div style="border:1px solid #eee;border-radius:10px;padding:8px 10px;min-width:220px;">
          <div><b style="color:${boat.color};">Лодка ${i+1}</b> — ${fin}</div>
          <div>Скорость: <b>×${boatSpeedCoeff(boat).toFixed(2)}</b></div>
          <div>Пройдено: <b>${formatMeters(boat.distance)}</b></div>
          <div>Повороты: <b>${boat.turns}</b></div>
          <div>Штрафы: <b>${parseInt(boat.penalties,10) || 0}</b>${(parseInt(boat.collisions,10) || 0) > 0 ? ` · контакты: <b>${parseInt(boat.collisions,10) || 0}</b>` : ""}</div>
          <div>Управление: <b>${controlLabel}</b></div>
          <div>${boatStartSummary(boat)}</div>
          <div>${boat.lastPenaltyReason ? `Последний инцидент: <b>${boat.lastPenaltyReason}</b>` : "Инциденты: нет"}</div>
          <div>Знаки: <b>${Math.min(boat.nextMark, markCount)}</b> / ${markCount}</div>
        </div>
      `);
    }
    lines.push(`</div>`);
    statsEl.innerHTML = lines.join("");
  }

  function updateOptInfo(){
    const finTxt = finishSeparate ? "Финиш: отдельная линия" : "Финиш: по стартовой линии";
    const roundTxt = (roundingSide==="port") ? "Огибание: левая дистанция" : "Огибание: правая дистанция";
    const contactTxt = `Встречи: ${interactionModeLabel()}`;
    const gustTxt = autoGustsEnabled
      ? `Порывы: авто (${autoGustIntervalSec.toFixed(0)}с / ${autoGustDurationSec.toFixed(0)}с)`
      : (gustRect ? "Порывы: ручной" : "Порывы: выкл");

    let extra = "";

    if (shouldRenderOptimalHint() && optimalStats && optimalForBoat !== null){
      extra += `<div style="margin-top:6px;">🧭 <b>Оптимум для лодки ${optimalForBoat+1}</b>: расстояние <b>${formatMeters(optimalStats.distance)}</b>, повороты <b>${optimalStats.turns}</b>, ходов <b>${optimalStats.moves}</b></div>`;
    }
    if (shouldRenderBestStartHint() && bestStartSolution){
      const bestStartBoatLabel = Number.isInteger(bestStartForBoat) ? ` для лодки ${bestStartForBoat + 1}` : "";
      extra += `<div style="margin-top:6px;">🏁 <b>Лучший старт${bestStartBoatLabel}</b>: расстояние <b>${formatMeters(bestStartSolution.stats.distance)}</b>, повороты <b>${bestStartSolution.stats.turns}</b>, ходов <b>${bestStartSolution.stats.moves}</b></div>`;
    }
    if ((shouldRenderBestStartHint() && !bestStartSolution) || (shouldRenderOptimalHint() && !optimalStats)){
      extra += `<div style="margin-top:6px;">⚠️ Не удалось найти маршрут (попробуй уменьшить поле / мёртвую зону / сдвинуть знаки/финиш).</div>`;
    }

    const phaseLabel = isRealtimePaused()
      ? "пауза"
      : phase === "countdown"
        ? "отсчет"
        : phase === "finished"
          ? "финиш"
          : "гонка";
    optInfoEl.innerHTML = `<b>Состояние</b>: ${finTxt}. ${roundTxt}. ${contactTxt}. ${gustTxt}. Фаза: <b>${phaseLabel}</b>.${extra}`;
  }
