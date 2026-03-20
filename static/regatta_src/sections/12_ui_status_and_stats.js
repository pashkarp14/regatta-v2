  // -----------------------------
  // UI / статус / статистика
  // -----------------------------
  function updateStatus(){
    syncFullscreenPhaseWatch();

    if (mode === "marks"){
      const idx = parseInt(markToEditSelect.value,10)+1;
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
      const zone = (prestartRoundsSetting > 0 && phase==="prestart")
        ? "зелёная зона за стартовой линией"
        : "зелёная зона на стартовой линии";
      statusEl.textContent = `Режим: лодки. Клик по лодке — выбрать. Клик в ${zone} — поставить (нельзя ставить на другие лодки/знаки).`;
      return;
    }
    if (mode === "model"){
      statusEl.textContent =
        "Режим: моделирование. Клик по лодке — выбрать. Клик по полю — поставить лодку (нельзя ставить на лодки/знаки). " +
        "Выбери лег и следующего игрока, затем нажми «Запустить ситуацию».";
      return;
    }

    const allDone = isRaceComplete();
    if (allDone){
      statusEl.textContent = "Гонка завершена: все лодки финишировали.";
      return;
    }

    if (isRealtimePlayMode()){
      const controlledBoatIndex = realtimeControlledBoatIndex();
      const ownBoat = Number.isInteger(controlledBoatIndex) ? boats[controlledBoatIndex] : null;
      const ownLegInfo = ownBoat && !ownBoat.finished
        ? `Твоя лодка: ${controlledBoatIndex + 1}. Следующий знак: ${Math.min(ownBoat.nextMark + 1, markCount)} из ${markCount}.`
        : "";
      if (phase === "countdown"){
        const countdown = realtimeCountdownState();
        if (countdown.active){
          statusEl.textContent = `ПРЕДСТАРТ. До сигнала ${formatCountdownSeconds(countdown.totalMsLeft)} с. Фальстарт считается только в последние 3.0 с до старта. ${ownLegInfo}`;
        } else if (isLocalRealtimeMode()) {
          const localRealtimeHint = isLocalBotsMode()
            ? "Лодка 1 под твоим управлением, остальные экипажи ведёт ИИ."
            : "Курсором управляешь выбранной лодкой на одном устройстве.";
          statusEl.textContent = `ЛОКАЛЬНЫЙ REALTIME ГОТОВ. Нажми «Общий старт», чтобы открыть предстарт. ${localRealtimeHint} ${ownLegInfo}`;
        } else {
          statusEl.textContent = `ОЖИДАНИЕ ОБЩЕГО СТАРТА. ${ownLegInfo}`;
        }
      } else if (phase === "finished"){
        statusEl.textContent = "Гонка завершена: все лодки финишировали.";
      } else {
        const controlHint = isLocalRealtimeMode()
          ? (isLocalBotsMode()
            ? "Веди лодку 1 курсором мыши или касанием по полю, остальные экипажи рулит ИИ."
            : "Веди выбранную лодку курсором мыши или касанием по полю.")
          : "Веди свою лодку курсором мыши или касанием по полю.";
        statusEl.textContent = `РЕАЛЬНОЕ ВРЕМЯ. Все лодки идут одновременно. ${controlHint} ${ownLegInfo}`;
      }
      return;
    }

    if (isHybridRaceMode()){
      const seat = (multiplayerSeatIndex !== null && boats[multiplayerSeatIndex]) ? multiplayerSeatIndex : selectedBoatIndex;
      const ownBoat = Number.isInteger(seat) ? boats[seat] : null;
      const ownInfo = ownBoat ? `Твоя лодка: ${seat+1}. Шагов в раунде: ${stepsLeftForBoat(seat)} / ${movesPerTurn}.` : "";
      statusEl.textContent = `ГОНКА. Гибридный раунд ${hybridRound}. Все экипажи ходят одновременно. ${ownInfo} Клик по своей лодке → клик в разрешенную область.`;
      return;
    }

    const b = boats[currentPlayer];
    const who = currentPlayer+1;

    const phaseText = (phase==="prestart")
      ? `ПРЕДСТАРТ: осталось кругов ${prestartRoundsLeft}`
      : "ГОНКА";

    const stepsInfo = `Шагов осталось: ${subMovesLeft} / ${movesPerTurn}`;
    const legInfo = (phase==="race" && b && !b.finished) ? `След. знак: ${Math.min(b.nextMark+1, markCount)} из ${markCount}` : "";

    statusEl.textContent = `${phaseText}. Ход лодки ${who}. ${stepsInfo}. ${legInfo}. Клик по своей лодке → клик в разрешённую область.`;
  }

  updateStatus = function(){
    syncFullscreenPhaseWatch();

    if (mode === "marks"){
      const idx = parseInt(markToEditSelect.value,10) + 1;
      statusEl.textContent = `\u0420\u0435\u0436\u0438\u043c: \u0437\u043d\u0430\u043a\u0438. \u041a\u043b\u0438\u043a \u043f\u043e \u043f\u043e\u043b\u044e \u2014 \u043f\u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0437\u043d\u0430\u043a ${idx}.`;
      return;
    }
    if (mode === "start"){
      statusEl.textContent = startAwaitSecond
        ? "\u0420\u0435\u0436\u0438\u043c: \u0441\u0442\u0430\u0440\u0442. \u0412\u044b\u0431\u0435\u0440\u0438 \u0432\u0442\u043e\u0440\u043e\u0439 \u043a\u043e\u043d\u0435\u0446 \u0441\u0442\u0430\u0440\u0442\u043e\u0432\u043e\u0439 \u043b\u0438\u043d\u0438\u0438."
        : "\u0420\u0435\u0436\u0438\u043c: \u0441\u0442\u0430\u0440\u0442. \u041f\u0435\u0440\u0432\u044b\u0439 \u043a\u043b\u0438\u043a \u2014 \u043f\u0435\u0440\u0432\u044b\u0439 \u043a\u043e\u043d\u0435\u0446, \u0432\u0442\u043e\u0440\u043e\u0439 \u043a\u043b\u0438\u043a \u2014 \u0432\u0442\u043e\u0440\u043e\u0439 \u043a\u043e\u043d\u0435\u0446.";
      return;
    }
    if (mode === "finish"){
      statusEl.textContent = finishAwaitSecond
        ? "\u0420\u0435\u0436\u0438\u043c: \u0444\u0438\u043d\u0438\u0448. \u0412\u044b\u0431\u0435\u0440\u0438 \u0432\u0442\u043e\u0440\u043e\u0439 \u043a\u043e\u043d\u0435\u0446 \u0444\u0438\u043d\u0438\u0448\u043d\u043e\u0439 \u043b\u0438\u043d\u0438\u0438."
        : "\u0420\u0435\u0436\u0438\u043c: \u0444\u0438\u043d\u0438\u0448. \u041f\u0435\u0440\u0432\u044b\u0439 \u043a\u043b\u0438\u043a \u2014 \u043f\u0435\u0440\u0432\u044b\u0439 \u043a\u043e\u043d\u0435\u0446, \u0432\u0442\u043e\u0440\u043e\u0439 \u043a\u043b\u0438\u043a \u2014 \u0432\u0442\u043e\u0440\u043e\u0439 \u043a\u043e\u043d\u0435\u0446.";
      return;
    }
    if (mode === "boats"){
      const zone = (prestartRoundsSetting > 0 && phase === "prestart")
        ? "\u0437\u0435\u043b\u0435\u043d\u0430\u044f \u0437\u043e\u043d\u0430 \u0437\u0430 \u0441\u0442\u0430\u0440\u0442\u043e\u0432\u043e\u0439 \u043b\u0438\u043d\u0438\u0435\u0439"
        : "\u0437\u0435\u043b\u0435\u043d\u0430\u044f \u0437\u043e\u043d\u0430 \u043d\u0430 \u0441\u0442\u0430\u0440\u0442\u043e\u0432\u043e\u0439 \u043b\u0438\u043d\u0438\u0438";
      statusEl.textContent = `\u0420\u0435\u0436\u0438\u043c: \u043b\u043e\u0434\u043a\u0438. \u041a\u043b\u0438\u043a \u043f\u043e \u043b\u043e\u0434\u043a\u0435 \u2014 \u0432\u044b\u0431\u0440\u0430\u0442\u044c. \u041a\u043b\u0438\u043a \u0432 ${zone} \u2014 \u043f\u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c (\u043d\u0435\u043b\u044c\u0437\u044f \u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043d\u0430 \u0434\u0440\u0443\u0433\u0438\u0435 \u043b\u043e\u0434\u043a\u0438/\u0437\u043d\u0430\u043a\u0438).`;
      return;
    }
    if (mode === "model"){
      statusEl.textContent =
        "\u0420\u0435\u0436\u0438\u043c: \u043c\u043e\u0434\u0435\u043b\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435. \u041a\u043b\u0438\u043a \u043f\u043e \u043b\u043e\u0434\u043a\u0435 \u2014 \u0432\u044b\u0431\u0440\u0430\u0442\u044c. \u041a\u043b\u0438\u043a \u043f\u043e \u043f\u043e\u043b\u044e \u2014 \u043f\u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043b\u043e\u0434\u043a\u0443 (\u043d\u0435\u043b\u044c\u0437\u044f \u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043d\u0430 \u043b\u043e\u0434\u043a\u0438/\u0437\u043d\u0430\u043a\u0438). " +
        "\u0412\u044b\u0431\u0435\u0440\u0438 \u043b\u0435\u0433 \u0438 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0433\u043e \u0438\u0433\u0440\u043e\u043a\u0430, \u0437\u0430\u0442\u0435\u043c \u043d\u0430\u0436\u043c\u0438 \u00ab\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c \u0441\u0438\u0442\u0443\u0430\u0446\u0438\u044e\u00bb.";
      return;
    }

    if (isRaceComplete()){
      statusEl.textContent = "\u0413\u043e\u043d\u043a\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430: \u0432\u0441\u0435 \u043b\u043e\u0434\u043a\u0438 \u0444\u0438\u043d\u0438\u0448\u0438\u0440\u043e\u0432\u0430\u043b\u0438.";
      return;
    }

    if (isRealtimePlayMode()){
      const controlledBoatIndex = realtimeControlledBoatIndex();
      const ownBoat = Number.isInteger(controlledBoatIndex) ? boats[controlledBoatIndex] : null;
      const ownLegInfo = ownBoat && !ownBoat.finished
        ? ` \u0422\u0432\u043e\u044f \u043b\u043e\u0434\u043a\u0430: ${controlledBoatIndex + 1}. \u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0437\u043d\u0430\u043a: ${Math.min(ownBoat.nextMark + 1, markCount)} \u0438\u0437 ${markCount}.`
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
          statusEl.textContent = `\u041f\u0440\u0435\u0434\u0441\u0442\u0430\u0440\u0442. \u0414\u043e \u0441\u0438\u0433\u043d\u0430\u043b\u0430 ${formatCountdownSeconds(countdown.totalMsLeft)} \u0441. \u0424\u0430\u043b\u044c\u0441\u0441\u0442\u0430\u0440\u0442 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0432 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 3.0 \u0441 \u0434\u043e \u0441\u0442\u0430\u0440\u0442\u0430.${ownLegInfo}`;
        } else if (isLocalRealtimeMode()) {
          statusEl.textContent = `\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 realtime \u0433\u043e\u0442\u043e\u0432. \u041d\u0430\u0436\u043c\u0438 \u00ab\u041e\u0431\u0449\u0438\u0439 \u0441\u0442\u0430\u0440\u0442\u00bb, \u0447\u0442\u043e\u0431\u044b \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0440\u0442. \u0412 \u0441\u043e\u043b\u043e \u0432\u0435\u0434\u0438 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u0443\u044e \u043b\u043e\u0434\u043a\u0443 \u043a\u0443\u0440\u0441\u043e\u0440\u043e\u043c.${ownLegInfo}`;
        } else {
          statusEl.textContent = `\u041e\u0436\u0438\u0434\u0430\u043d\u0438\u0435 \u043e\u0431\u0449\u0435\u0433\u043e \u0441\u0442\u0430\u0440\u0442\u0430.${ownLegInfo}`;
        }
      } else if (phase === "finished"){
        statusEl.textContent = "\u0413\u043e\u043d\u043a\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430: \u0432\u0441\u0435 \u043b\u043e\u0434\u043a\u0438 \u0444\u0438\u043d\u0438\u0448\u0438\u0440\u043e\u0432\u0430\u043b\u0438.";
      } else {
        const controlHint = isLocalRealtimeMode()
          ? "\u0412\u0435\u0434\u0438 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u0443\u044e \u043b\u043e\u0434\u043a\u0443 \u043a\u0443\u0440\u0441\u043e\u0440\u043e\u043c \u043c\u044b\u0448\u0438 \u0438\u043b\u0438 \u043a\u0430\u0441\u0430\u043d\u0438\u0435\u043c \u043f\u043e \u043f\u043e\u043b\u044e."
          : "\u0412\u0435\u0434\u0438 \u0441\u0432\u043e\u044e \u043b\u043e\u0434\u043a\u0443 \u043a\u0443\u0440\u0441\u043e\u0440\u043e\u043c \u043c\u044b\u0448\u0438 \u0438\u043b\u0438 \u043a\u0430\u0441\u0430\u043d\u0438\u0435\u043c \u043f\u043e \u043f\u043e\u043b\u044e.";
        statusEl.textContent = `\u0420\u0435\u0430\u043b\u044c\u043d\u043e\u0435 \u0432\u0440\u0435\u043c\u044f. \u0412\u0441\u0435 \u043b\u043e\u0434\u043a\u0438 \u0438\u0434\u0443\u0442 \u043e\u0434\u043d\u043e\u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e. ${controlHint}${ownLegInfo}`;
      }
      return;
    }

    if (isHybridRaceMode()){
      const seat = (multiplayerSeatIndex !== null && boats[multiplayerSeatIndex]) ? multiplayerSeatIndex : selectedBoatIndex;
      const ownBoat = Number.isInteger(seat) ? boats[seat] : null;
      const ownInfo = ownBoat
        ? ` \u0422\u0432\u043e\u044f \u043b\u043e\u0434\u043a\u0430: ${seat + 1}. \u0428\u0430\u0433\u043e\u0432 \u0432 \u0440\u0430\u0443\u043d\u0434\u0435: ${stepsLeftForBoat(seat)} / ${movesPerTurn}.`
        : "";
      statusEl.textContent = `\u0413\u043e\u043d\u043a\u0430. \u0413\u0438\u0431\u0440\u0438\u0434\u043d\u044b\u0439 \u0440\u0430\u0443\u043d\u0434 ${hybridRound}. \u0412\u0441\u0435 \u044d\u043a\u0438\u043f\u0430\u0436\u0438 \u0445\u043e\u0434\u044f\u0442 \u043e\u0434\u043d\u043e\u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e.${ownInfo} \u041a\u043b\u0438\u043a \u043f\u043e \u0441\u0432\u043e\u0435\u0439 \u043b\u043e\u0434\u043a\u0435 \u2192 \u043a\u043b\u0438\u043a \u0432 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u043d\u0443\u044e \u043e\u0431\u043b\u0430\u0441\u0442\u044c.`;
      return;
    }

    const boat = boats[currentPlayer];
    const who = currentPlayer + 1;
    const phaseText = (phase === "prestart")
      ? `\u041f\u0440\u0435\u0434\u0441\u0442\u0430\u0440\u0442: \u043a\u0440\u0443\u0433\u043e\u0432 \u0434\u043e \u0441\u0442\u0430\u0440\u0442\u0430 ${prestartRoundsLeft}`
      : "\u0413\u043e\u043d\u043a\u0430";
    const stepsInfo = `\u0428\u0430\u0433\u043e\u0432 \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c: ${subMovesLeft} / ${movesPerTurn}`;
    const legInfo = (phase === "race" && boat && !boat.finished)
      ? ` \u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0437\u043d\u0430\u043a: ${Math.min(boat.nextMark + 1, markCount)} \u0438\u0437 ${markCount}.`
      : "";

    if (isLocalBotsMode()){
      if (isBotControlledBoat(currentPlayer)){
        statusEl.textContent = `${phaseText}. \u0425\u043e\u0434 \u0431\u043e\u0442\u0430 ${who}. ${stepsInfo}.${legInfo} \u0410\u0432\u0442\u043e\u043f\u0438\u043b\u043e\u0442 \u043f\u0440\u043e\u0441\u0447\u0438\u0442\u044b\u0432\u0430\u0435\u0442 \u043c\u0430\u043d\u0435\u0432\u0440.`;
      } else {
        statusEl.textContent = `${phaseText}. \u0422\u0432\u043e\u0439 \u0445\u043e\u0434: \u043b\u043e\u0434\u043a\u0430 ${who}. ${stepsInfo}.${legInfo} \u041a\u043b\u0438\u043a \u043f\u043e \u0441\u0432\u043e\u0435\u0439 \u043b\u043e\u0434\u043a\u0435 \u2192 \u043a\u043b\u0438\u043a \u0432 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u043d\u0443\u044e \u043e\u0431\u043b\u0430\u0441\u0442\u044c.`;
      }
      return;
    }

    statusEl.textContent = `${phaseText}. \u0425\u043e\u0434 \u043b\u043e\u0434\u043a\u0438 ${who}. ${stepsInfo}.${legInfo} \u041a\u043b\u0438\u043a \u043f\u043e \u0441\u0432\u043e\u0435\u0439 \u043b\u043e\u0434\u043a\u0435 \u2192 \u043a\u043b\u0438\u043a \u0432 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u043d\u0443\u044e \u043e\u0431\u043b\u0430\u0441\u0442\u044c.`;
  };

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
      const b = boats[i];
      const fin = b.finished ? `✅ финиш: ${b.place}` : (phase==="race" || phase==="finished" ? "⏳ в гонке" : phase==="countdown" ? "⏳ стартовая процедура" : "⏳ предстарт");
      const controlledBoatIndex = realtimeControlledBoatIndex();
      const stepLine = isRealtimePlayMode()
        ? `Управление: <b>${controlledBoatIndex === i ? "курсор" : (isLocalRealtimeMode() ? "без управления" : "сервер")}</b>`
        : `Шагов: <b>${stepsLeftForBoat(i)}</b>${isHybridRaceMode() ? ` / ${movesPerTurn}` : ""}`;
      lines.push(`
        <div style="border:1px solid #eee;border-radius:10px;padding:8px 10px;min-width:220px;">
          <div><b style="color:${b.color};">Лодка ${i+1}</b> — ${fin}</div>
          <div>Скорость: <b>×${boatSpeedCoeff(b).toFixed(2)}</b></div>
          <div>Пройдено: <b>${formatMeters(b.distance)}</b></div>
          <div>Повороты: <b>${b.turns}</b></div>
          <div>Штрафы: <b>${parseInt(b.penalties,10) || 0}</b>${(parseInt(b.collisions,10) || 0) > 0 ? ` · контакты: <b>${parseInt(b.collisions,10) || 0}</b>` : ""}</div>
          <div>${stepLine}</div>
          <div>${boatStartSummary(b)}</div>
          <div>${b.lastPenaltyReason ? `Последний инцидент: <b>${b.lastPenaltyReason}</b>` : "Инциденты: нет"}</div>
          <div>Знаки: <b>${Math.min(b.nextMark, markCount)}</b> / ${markCount}</div>
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
      : phase === "prestart"
      ? "предстарт"
      : phase === "countdown"
        ? "отсчет"
        : phase === "finished"
          ? "финиш"
          : "гонка";
    optInfoEl.innerHTML = `<b>Состояние</b>: ${finTxt}. ${roundTxt}. ${contactTxt}. ${gustTxt}. Фаза: <b>${phaseLabel}</b>.${extra}`;
  }

