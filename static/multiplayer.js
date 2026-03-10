document.addEventListener("DOMContentLoaded", () => {
  const regatta = window.RegattaApp;
  if (!regatta) return;

  const displayNameInput = document.getElementById("displayName");
  const createRoomBtn = document.getElementById("createRoom");
  const joinRoomCodeInput = document.getElementById("joinRoomCode");
  const joinRoomBtn = document.getElementById("joinRoom");
  const leaveRoomBtn = document.getElementById("leaveRoom");
  const startRoomBtn = document.getElementById("startRoom");
  const copyRoomCodeBtn = document.getElementById("copyRoomCode");
  const roomCodeValueEl = document.getElementById("roomCodeValue");
  const roomStatusEl = document.getElementById("roomStatus");
  const roomPlayersEl = document.getElementById("roomPlayers");
  const roomNoticeEl = document.getElementById("roomNotice");
  const roomHintEl = document.getElementById("roomHint");
  const syncIndicatorEl = document.getElementById("syncIndicator");
  const roomPhaseLabelEl = document.getElementById("roomPhaseLabel");
  const interactionLockEl = document.getElementById("interactionLock");
  const playerCountSelect = document.getElementById("playerCount");
  const movesPerTurnInput = document.getElementById("movesPerTurn");

  const originalDisabledState = new WeakMap();
  const originalMovesPerTurnDisabled = !!movesPerTurnInput?.disabled;

  function setupLockedControls() {
    return Array.from(document.querySelectorAll("[data-room-lock='setup']"));
  }

  function originalDisabledFor(node) {
    if (!originalDisabledState.has(node)) {
      originalDisabledState.set(node, !!node.disabled);
    }
    return originalDisabledState.get(node) === true;
  }

  const roomState = {
    room: null,
    socket: null,
    applyingRemote: false,
    lastFingerprint: regatta.fingerprintState(),
    selfSeatIndex: null,
    lastRealtimeIntentKey: "",
    lastRealtimeIntentSentAt: 0,
  };

  function roomPlayer() {
    if (!roomState.room || roomState.selfSeatIndex === null) return null;
    return roomState.room.players?.find((player) => player.seat_index === roomState.selfSeatIndex) || null;
  }

  function isRoomHost() {
    return !!roomPlayer()?.is_host;
  }

  function isMyTurn() {
    const player = roomPlayer();
    return !!(player && roomState.room && roomState.room.current_player === player.seat_index);
  }

  function roomPlayMode() {
    if (!roomState.room) return regatta.getMeta?.().playMode || "turns";
    return roomState.room.play_mode || roomState.room.game_state?.settings?.playMode || "turns";
  }

  function roomRacePhase() {
    return roomState.room?.game_state?.race?.phase || null;
  }

  function isRealtimeRoom() {
    return !!roomState.room && roomState.room.status === "live" && roomPlayMode() === "realtime";
  }

  function isRealtimeCountdownRoom() {
    return isRealtimeRoom() && roomRacePhase() === "countdown";
  }

  function canEditSetup() {
    if (!roomState.room) return true;
    return roomState.room.status === "lobby" && isRoomHost();
  }

  function canEditTurnBudget() {
    if (!roomState.room) return true;
    if (roomState.room.status === "lobby") return isRoomHost();
    if (isRealtimeRoom()) return isRoomHost();
    return isMyTurn();
  }

  function canPushState() {
    if (!roomState.room) return false;
    if (roomState.room.status === "lobby") return isRoomHost();
    if (isRealtimeRoom()) return false;
    return isMyTurn();
  }

  function canSendRealtimeControl() {
    return !!(
      roomState.room
      && roomState.socket
      && roomState.socket.connected
      && isRealtimeRoom()
      && roomRacePhase() !== "finished"
      && roomPlayer()
      && !roomState.applyingRemote
    );
  }

  function canInteractWithBoard() {
    if (!roomState.room) return true;
    if (roomState.room.status === "lobby") return isRoomHost();
    if (isRealtimeRoom()) return !!roomPlayer();
    return isMyTurn();
  }

  function setNotice(message, tone = "neutral") {
    const text = typeof message === "string" ? message.trim() : "";
    roomNoticeEl.textContent = text;
    roomNoticeEl.className = text ? `room-notice room-notice-${tone}` : "room-notice hidden";
  }

  function setHint(message = "") {
    const text = typeof message === "string" ? message.trim() : "";
    roomHintEl.textContent = text;
    roomHintEl.classList.toggle("hidden", !text);
  }

  function setSyncLabel(text, accent = false) {
    syncIndicatorEl.textContent = text;
    syncIndicatorEl.classList.toggle("hero-badge-muted", !accent);
  }

  async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }

  function renderRoster(room) {
    if (!room) {
      roomPlayersEl.innerHTML = "";
      return;
    }

    const players = [...room.players].sort((left, right) => left.seat_index - right.seat_index);
    roomPlayersEl.innerHTML = players.map((player) => `
      <li class="room-player">
        <strong>
          <span class="room-seat">${player.seat_index + 1}</span>
          <span>${player.name}</span>
        </strong>
        <span class="room-tags">
          ${player.is_host ? '<span class="room-tag room-tag-host">Host</span>' : ""}
          ${player.is_self ? '<span class="room-tag room-tag-self">Вы</span>' : ""}
        </span>
      </li>
    `).join("");
  }

  function hydrateRoom(room) {
    if (!room) return null;

    if (roomState.selfSeatIndex === null && Number.isInteger(room.self?.seat_index)) {
      roomState.selfSeatIndex = room.self.seat_index;
    }

    return {
      ...room,
      players: (room.players || []).map((player) => ({
        ...player,
        is_self: roomState.selfSeatIndex !== null && player.seat_index === roomState.selfSeatIndex,
      })),
    };
  }

  function applyPermissions() {
    const setupDisabled = !canEditSetup();
    for (const control of setupLockedControls()) {
      const originalDisabled = originalDisabledFor(control);
      control.disabled = originalDisabled || setupDisabled;
    }
    if (movesPerTurnInput) {
      movesPerTurnInput.disabled = originalMovesPerTurnDisabled || !canEditTurnBudget();
    }

    createRoomBtn.disabled = !!roomState.room;
    joinRoomBtn.disabled = !!roomState.room;
    joinRoomCodeInput.disabled = !!roomState.room;
    leaveRoomBtn.disabled = !roomState.room;
    copyRoomCodeBtn.disabled = !roomState.room;
    startRoomBtn.disabled = !roomState.room
      || !isRoomHost()
      || roomState.room.status !== "lobby"
      || roomState.room.joined_count !== roomState.room.max_players;

    if (!roomState.room) {
      interactionLockEl.classList.add("hidden");
      interactionLockEl.textContent = "";
      return;
    }

    if (canInteractWithBoard()) {
      interactionLockEl.classList.add("hidden");
      interactionLockEl.textContent = "";
      return;
    }

    interactionLockEl.classList.remove("hidden");
    interactionLockEl.textContent = roomState.room.status === "lobby"
      ? "Хост настраивает дистанцию. Пока можно следить за полем и готовиться к старту."
      : isRealtimeRoom()
        ? "В этой комнате активен realtime-режим, но этот браузер сейчас не привязан к лодке."
        : `Сейчас ход лодки ${roomState.room.current_player + 1}. Твоя лодка активируется, когда очередь дойдёт до тебя.`;
  }

  function renderRoom(room) {
    roomState.room = hydrateRoom(room);
    regatta.setMultiplayerContext({ seatIndex: roomState.room ? roomState.selfSeatIndex : null });
    renderRoster(roomState.room);

    if (!roomState.room) {
      roomCodeValueEl.textContent = "-";
      roomStatusEl.textContent = "Готов к локальной игре";
      roomPhaseLabelEl.textContent = "Соло";
      setHint("Размер комнаты берётся из настройки «Лодок». Хост настраивает дистанцию, остальные игроки подключаются по коду и ждут старта.");
      setNotice("Сетевой слой не активен, пока ты не создашь комнату.", "neutral");
      setSyncLabel("Локальный режим", false);
      roomState.lastRealtimeIntentKey = "";
      applyPermissions();
      return;
    }

    roomCodeValueEl.textContent = roomState.room.code;
    roomPhaseLabelEl.textContent = roomState.room.status === "lobby"
      ? `Лобби ${roomState.room.code}`
      : `Матч ${roomState.room.code}`;

    if (roomState.room.status === "lobby") {
      setHint(`Ожидаем подключение всех экипажей: ${roomState.room.joined_count} из ${roomState.room.max_players}.`);
      roomStatusEl.textContent = `Лобби · ${roomState.room.joined_count}/${roomState.room.max_players}`;
      setNotice(
        isRoomHost()
          ? "Комната создана. Настраивай дистанцию и запускай матч, когда соберётся весь состав."
          : "Ты подключился к комнате. Хост готовит дистанцию и запустит матч после сбора экипажа.",
        "success",
      );
    } else if (isRealtimeRoom()) {
      const countdownEndsAt = roomState.room.game_state?.race?.realtimeCountdownEndsAt || 0;
      if (isRealtimeCountdownRoom()) {
        const secondsLeft = Math.max(1, Math.ceil((countdownEndsAt - Date.now()) / 1000));
        setHint(`Старт через ${secondsLeft}. После сигнала обе лодки пойдут одновременно.`);
        roomStatusEl.textContent = `Гонка · общий отсчет`;
        setNotice(
          "Realtime-режим активен. Управление идёт курсором мыши или касанием по полю, а сервер двигает обе лодки одновременно.",
          "neutral",
        );
      } else if (roomRacePhase() === "finished") {
        setHint("Гонка завершена.");
        roomStatusEl.textContent = "Гонка · финиш";
        setNotice("Матч завершён. Можно настроить дистанцию заново и запустить новый старт.", "neutral");
      } else {
        setHint("Матч запущен. Все лодки движутся одновременно по серверному тику.");
        roomStatusEl.textContent = "Гонка · realtime";
        setNotice(
          "Realtime-режим активен. Веди свою лодку курсором мыши или касанием по полю, сервер считает движение для всех одновременно.",
          "neutral",
        );
      }
    } else {
      setHint(`Матч запущен. Активная лодка: ${roomState.room.current_player + 1}.`);
      roomStatusEl.textContent = `Гонка · ход лодки ${roomState.room.current_player + 1}`;
      setNotice(
        isMyTurn()
          ? "Твой ход. Маршрут и движение будут синхронизированы для всей комнаты."
          : `Матч в эфире. Сейчас играет лодка ${roomState.room.current_player + 1}.`,
        "neutral",
      );
    }

    applyPermissions();
  }

  function ensureSocket() {
    if (!roomState.room || roomState.socket || typeof window.io !== "function") return;

    roomState.socket = window.io({
      transports: ["websocket", "polling"],
    });

    roomState.socket.on("connect", () => {
      setSyncLabel("Комната подключена", true);
      roomState.socket.emit("room:join_socket", { room_code: roomState.room.code });
      void tryPushState(true);
      void trySendRealtimeControl(true);
    });

    roomState.socket.on("disconnect", () => {
      setSyncLabel("Соединение потеряно", false);
    });

    roomState.socket.on("room:error", (payload) => {
      setNotice(payload?.error || "Не удалось синхронизировать комнату.", "danger");
    });

    roomState.socket.on("room:presence", (payload) => {
      if (payload?.room) {
        renderRoom(payload.room);
      }
    });

    roomState.socket.on("room:snapshot", (payload) => {
      handleIncomingRoom(payload?.room);
    });

    roomState.socket.on("room:state_updated", (payload) => {
      handleIncomingRoom(payload?.room);
    });
  }

  function disconnectSocket() {
    if (!roomState.socket) return;
    roomState.socket.disconnect();
    roomState.socket = null;
  }

  function handleIncomingRoom(room) {
    if (!room) return;

    const incomingState = room.game_state;
    if (incomingState) {
      const incomingFingerprint = JSON.stringify(incomingState);
      if (incomingFingerprint !== roomState.lastFingerprint) {
        roomState.applyingRemote = true;
        try {
          regatta.importState(incomingState);
          roomState.lastFingerprint = regatta.fingerprintState();
        } finally {
          roomState.applyingRemote = false;
        }
      }
    }

    renderRoom(room);
  }

  async function createRoom() {
    const payload = await apiRequest("/api/rooms", {
      method: "POST",
      body: {
        display_name: displayNameInput.value.trim(),
        max_players: parseInt(playerCountSelect.value, 10) || 2,
        game_state: regatta.exportState(),
      },
    });

    roomState.lastFingerprint = regatta.fingerprintState();
    renderRoom(payload.room);
    ensureSocket();
  }

  async function joinRoom() {
    const payload = await apiRequest("/api/rooms/join", {
      method: "POST",
      body: {
        display_name: displayNameInput.value.trim(),
        room_code: joinRoomCodeInput.value.trim(),
      },
    });

    if (payload.room?.game_state) {
      roomState.applyingRemote = true;
      try {
        regatta.importState(payload.room.game_state);
        roomState.lastFingerprint = regatta.fingerprintState();
      } finally {
        roomState.applyingRemote = false;
      }
    }

    renderRoom(payload.room);
    ensureSocket();
  }

  async function startRoom() {
    if (!roomState.room) return;
    const payload = await apiRequest(`/api/rooms/${roomState.room.code}/start`, {
      method: "POST",
      body: {
        game_state: regatta.exportState(),
      },
    });

    if (payload.room?.game_state) {
      roomState.applyingRemote = true;
      try {
        regatta.importState(payload.room.game_state);
        roomState.lastFingerprint = regatta.fingerprintState();
      } finally {
        roomState.applyingRemote = false;
      }
    } else {
      roomState.lastFingerprint = regatta.fingerprintState();
    }
    renderRoom(payload.room);
    void trySendRealtimeControl(true);
  }

  async function leaveRoom() {
    await apiRequest("/api/rooms/leave", { method: "POST" });
    disconnectSocket();
    roomState.room = null;
    roomState.selfSeatIndex = null;
    roomState.lastFingerprint = regatta.fingerprintState();
    roomState.lastRealtimeIntentKey = "";
    renderRoom(null);
  }

  async function bootstrapRoom() {
    try {
      const payload = await apiRequest("/api/bootstrap");
      if (payload.display_name) {
        displayNameInput.value = payload.display_name;
      }
      if (payload.room) {
        handleIncomingRoom(payload.room);
        ensureSocket();
      } else {
        renderRoom(null);
      }
    } catch (error) {
      setNotice(error.message, "danger");
      renderRoom(null);
    }
  }

  async function copyRoomCode() {
    if (!roomState.room) return;
    try {
      await navigator.clipboard.writeText(roomState.room.code);
      setNotice(`Код ${roomState.room.code} скопирован.`, "success");
    } catch (error) {
      setNotice("Не удалось скопировать код комнаты.", "warning");
    }
  }

  async function tryPushState(force = false) {
    if (!roomState.socket || !roomState.socket.connected || !canPushState() || roomState.applyingRemote) return;

    const nextFingerprint = regatta.fingerprintState();
    if (!force && nextFingerprint === roomState.lastFingerprint) return;

    roomState.lastFingerprint = nextFingerprint;
    roomState.socket.emit("room:push_state", {
      room_code: roomState.room.code,
      state: regatta.exportState(),
    });
  }

  async function trySendRealtimeControl(force = false) {
    if (!canSendRealtimeControl()) return;

    const intent = regatta.getRealtimeIntent?.();
    const payload = {
      room_code: roomState.room.code,
      active: !!intent?.active,
      target: intent?.target || null,
    };
    const key = JSON.stringify(payload);
    const now = Date.now();
    if (!force && key === roomState.lastRealtimeIntentKey && now - roomState.lastRealtimeIntentSentAt < 250) {
      return;
    }

    roomState.lastRealtimeIntentKey = key;
    roomState.lastRealtimeIntentSentAt = now;
    roomState.socket.emit("room:control", payload);
  }

  createRoomBtn.addEventListener("click", async () => {
    try {
      await createRoom();
    } catch (error) {
      setNotice(error.message, "danger");
    }
  });

  joinRoomBtn.addEventListener("click", async () => {
    try {
      await joinRoom();
    } catch (error) {
      setNotice(error.message, "danger");
    }
  });

  leaveRoomBtn.addEventListener("click", async () => {
    try {
      await leaveRoom();
    } catch (error) {
      setNotice(error.message, "danger");
    }
  });

  startRoomBtn.addEventListener("click", async () => {
    try {
      await startRoom();
    } catch (error) {
      setNotice(error.message, "danger");
    }
  });

  copyRoomCodeBtn.addEventListener("click", copyRoomCode);

  joinRoomCodeInput.addEventListener("input", () => {
    joinRoomCodeInput.value = joinRoomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  setInterval(() => {
    void tryPushState();
  }, 350);

  setInterval(() => {
    void trySendRealtimeControl();
  }, 250);

  setInterval(() => {
    if (isRealtimeCountdownRoom() && roomState.room) {
      renderRoom(roomState.room);
    }
  }, 200);

  window.addEventListener("regatta:state-changed", () => {
    void tryPushState(true);
  });

  window.addEventListener("regatta:realtime-intent", () => {
    void trySendRealtimeControl(true);
  });

  bootstrapRoom();
});
