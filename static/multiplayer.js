document.addEventListener("DOMContentLoaded", () => {
  const regatta = window.RegattaApp;
  if (!regatta) return;

  const displayNameInput = document.getElementById("displayName");
  const createRoomBtn = document.getElementById("createRoom");
  const joinRoomCodeInput = document.getElementById("joinRoomCode");
  const joinRoomBtn = document.getElementById("joinRoom");
  const leaveRoomBtn = document.getElementById("leaveRoom");
  const startRoomBtn = document.getElementById("startRoom");
  const resetLobbyBtn = document.getElementById("resetLobby");
  const copyRoomCodeBtn = document.getElementById("copyRoomCode");
  const roomHostRoleEl = document.getElementById("roomHostRole");
  const roomCodeValueEl = document.getElementById("roomCodeValue");
  const roomStatusEl = document.getElementById("roomStatus");
  const roomPlayersEl = document.getElementById("roomPlayers");
  const roomNoticeEl = document.getElementById("roomNotice");
  const roomHintEl = document.getElementById("roomHint");
  const roomPanelNoteEl = document.getElementById("roomPanelNote");
  const syncIndicatorEl = document.getElementById("syncIndicator");
  const roomPhaseLabelEl = document.getElementById("roomPhaseLabel");
  const interactionLockEl = document.getElementById("interactionLock");
  const appToastEl = document.getElementById("appToast");
  const playerCountSelect = document.getElementById("playerCount");
  const movesPerTurnInput = document.getElementById("movesPerTurn");
  const sharedViewControlIds = ["toggleOptimal", "bestStart", "optimalBoatTarget", "bestStartBoatTarget", "toggleLaylines", "toggleTrails", "toggleWindArrow"];
  const hostHintOnlyControlIds = ["toggleOptimal", "bestStart"];
  const MIN_ROOM_PLAYERS = 2;
  const MAX_ROOM_PLAYERS = 20;
  const DEFAULT_ROOM_PANEL_NOTE = "Создание и вход в комнату находятся в главном меню. Здесь остаются только статус лобби, запуск гонки и состав экипажей.";

  const originalDisabledState = new WeakMap();
  const originalMovesPerTurnDisabled = !!movesPerTurnInput?.disabled;
  const joinLinkState = (() => {
    const url = new URL(window.location.href);
    const roomCode = url.searchParams.get("room");
    if (!roomCode) return null;
    return {
      roomCode: roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6),
      autoJoinRequested: url.searchParams.get("join") === "1",
      handled: false,
    };
  })();

  function getJoinLinkState() {
    if (!joinLinkState || joinLinkState.handled || !joinLinkState.roomCode) {
      return null;
    }
    return {
      roomCode: joinLinkState.roomCode,
      autoJoinRequested: joinLinkState.autoJoinRequested,
    };
  }

  function joinLinkOverridesRoom(room, pendingJoinLink = getJoinLinkState()) {
    const roomCode = typeof room?.code === "string"
      ? room.code.trim().toUpperCase()
      : "";
    return !!pendingJoinLink?.roomCode && !!roomCode && roomCode !== pendingJoinLink.roomCode;
  }

  function setupLockedControls() {
    return Array.from(document.querySelectorAll("[data-room-lock='setup']"));
  }

  function sharedViewControls() {
    return sharedViewControlIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);
  }

  function hostHintOnlyControls() {
    return hostHintOnlyControlIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);
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
    selfPlayerId: null,
    selfSeatIndex: null,
    selfIsObserver: false,
    lastRealtimeIntentKey: "",
    lastRealtimeIntentSentAt: 0,
    lastSharedViewKey: "",
    lastSharedViewSentAt: 0,
    serverClockOffsetMs: 0,
  };
  const pendingRoomDraft = {
    active: false,
    displayName: "",
    maxPlayers: MIN_ROOM_PLAYERS,
    source: "map",
    mode: "edit",
    hostRole: "player",
  };
  let toastTimer = 0;
  let roomStartPending = false;
  let activeRoomInviteCode = "";
  let activeRoomInviteMessage = "";

  if (copyRoomCodeBtn) {
    copyRoomCodeBtn.textContent = "\u0421\u0441\u044b\u043b\u043a\u0430";
  }

  function clearJoinLinkQuery() {
    const url = new URL(window.location.href);
    const hadParams = url.searchParams.has("room") || url.searchParams.has("join") || url.searchParams.has("_asset");
    if (!hadParams) return;
    url.searchParams.delete("room");
    url.searchParams.delete("join");
    if (url.searchParams.get("_asset") === currentAssetVersion()) {
      url.searchParams.delete("_asset");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function currentAssetVersion() {
    return document.documentElement?.dataset?.assetVersion || "";
  }

  function clearAssetRefreshQuery() {
    const url = new URL(window.location.href);
    if (url.searchParams.get("_asset") !== currentAssetVersion()) return;
    url.searchParams.delete("_asset");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function refreshForAssetMismatch(serverAssetVersion) {
    const nextVersion = typeof serverAssetVersion === "string" ? serverAssetVersion.trim() : "";
    const clientVersion = currentAssetVersion();
    if (!nextVersion || !clientVersion || nextVersion === clientVersion) {
      return false;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("_asset", nextVersion);
    showToast("Обновляю страницу");
    window.location.replace(`${url.pathname}${url.search}${url.hash}`);
    return true;
  }

  async function ensureFreshAssets() {
    const clientVersion = currentAssetVersion();
    if (!clientVersion) return true;

    try {
      const payload = await apiRequest("/api/bootstrap");
      if (refreshForAssetMismatch(payload?.asset_version)) {
        return false;
      }
    } catch (error) {
      return true;
    }

    return true;
  }

  function buildRoomInviteLink(roomCode) {
    const inviteUrl = new URL(window.location.origin + window.location.pathname);
    inviteUrl.searchParams.set("room", roomCode);
    inviteUrl.searchParams.set("join", "1");
    return inviteUrl.toString();
  }

  async function revealRoomInvite(roomCode) {
    const inviteLink = buildRoomInviteLink(roomCode);
    activeRoomInviteCode = roomCode;
    activeRoomInviteMessage = `Комната создана. Ссылка для входа: ${inviteLink}`;
    let copied = false;

    try {
      await copyTextWithFallback(inviteLink);
      copied = true;
    } catch (error) {
      copied = false;
    }

    setNotice(activeRoomInviteMessage, "success");
    showToast(copied ? "Ссылка скопирована" : "Ссылка готова");
    return inviteLink;
  }

  function announceJoinLink(roomCode) {
    window.dispatchEvent(new CustomEvent("regatta:join-link", {
      detail: {
        roomCode,
      },
    }));
  }

  function emitRoomStateChanged() {
    window.dispatchEvent(new CustomEvent("regatta:room-state", {
      detail: {
        room: roomState.room,
        selfPlayerId: roomState.selfPlayerId,
        selfSeatIndex: roomState.selfSeatIndex,
        selfIsObserver: roomState.selfIsObserver,
      },
    }));
  }

  function emitRoomDraftChanged() {
    window.dispatchEvent(new CustomEvent("regatta:room-draft", {
      detail: {
        draft: pendingRoomDraft.active ? { ...pendingRoomDraft } : null,
      },
    }));
  }

  function hasPendingRoomDraft() {
    return !roomState.room && pendingRoomDraft.active;
  }

  function normalizePendingRoomDraft(draft = {}) {
    if (!draft || typeof draft !== "object") return null;
    return {
      active: true,
      displayName: typeof draft.display_name === "string"
        ? draft.display_name.trim().slice(0, 24)
        : "",
      maxPlayers: Math.max(
        MIN_ROOM_PLAYERS,
        Math.min(MAX_ROOM_PLAYERS, parseInt(draft.max_players, 10) || parseInt(playerCountSelect?.value, 10) || MIN_ROOM_PLAYERS)
      ),
      source: draft.source === "race" ? "race" : "map",
      mode: draft.mode === "play" ? "play" : "edit",
      hostRole: draft.host_role === "observer" ? "observer" : "player",
    };
  }

  function setPendingRoomDraft(draft) {
    const normalized = normalizePendingRoomDraft(draft);
    pendingRoomDraft.active = !!normalized;
    pendingRoomDraft.displayName = normalized?.displayName || "";
    pendingRoomDraft.maxPlayers = normalized?.maxPlayers || MIN_ROOM_PLAYERS;
    pendingRoomDraft.source = normalized?.source || "map";
    pendingRoomDraft.mode = normalized?.mode || "edit";
    pendingRoomDraft.hostRole = normalized?.hostRole || "player";
    roomStartPending = false;

    if (pendingRoomDraft.active) {
      if (displayNameInput && pendingRoomDraft.displayName) {
        displayNameInput.value = pendingRoomDraft.displayName;
      }
      if (playerCountSelect) {
        playerCountSelect.value = String(pendingRoomDraft.maxPlayers);
      }
      if (roomHostRoleEl) {
        roomHostRoleEl.value = pendingRoomDraft.hostRole;
      }
    }

    emitRoomDraftChanged();
    renderRoom(roomState.room);
  }

  function clearPendingRoomDraft({ silent = false } = {}) {
    pendingRoomDraft.active = false;
    pendingRoomDraft.displayName = "";
    pendingRoomDraft.maxPlayers = MIN_ROOM_PLAYERS;
    pendingRoomDraft.source = "map";
    pendingRoomDraft.mode = "edit";
    pendingRoomDraft.hostRole = roomHostRoleEl?.value === "observer" ? "observer" : "player";
    roomStartPending = false;
    if (!silent) {
      emitRoomDraftChanged();
    }
    renderRoom(roomState.room);
  }

  function pendingDraftMaxPlayers() {
    return Math.max(
      MIN_ROOM_PLAYERS,
      Math.min(MAX_ROOM_PLAYERS, regatta.exportState()?.boats?.length || parseInt(playerCountSelect?.value, 10) || pendingRoomDraft.maxPlayers || MIN_ROOM_PLAYERS)
    );
  }

  function pendingDraftDisplayName() {
    return displayNameInput?.value?.trim() || pendingRoomDraft.displayName || "";
  }

  function pendingDraftHostRole() {
    return roomHostRoleEl?.value === "observer" || pendingRoomDraft.hostRole === "observer"
      ? "observer"
      : "player";
  }

  function roomHumanCapacity(room) {
    if (!room) return pendingDraftHostRole() === "observer" ? pendingDraftMaxPlayers() + 1 : pendingDraftMaxPlayers();
    return Number.isInteger(room.capacity)
      ? room.capacity
      : room.max_players + (room.host_mode === "observe" ? 1 : 0);
  }

  function roomStartReady(room = roomState.room) {
    return !!(room?.can_start ?? room?.start_ready);
  }

  function roomRacersJoined(room = roomState.room) {
    if (!room) return 0;
    return Number.isInteger(room.joined_racers_count)
      ? room.joined_racers_count
      : (room.players || []).filter((player) => !player.is_observer && Number.isInteger(player.seat_index)).length;
  }

  function roomHostObserves(room = roomState.room) {
    return !!room && room.host_mode === "observe";
  }

  function roomOccupancyLabel(room = roomState.room) {
    if (!room) return "";
    return `${roomRacersJoined(room)} лодок`;
  }

  function roomPlayer() {
    if (!roomState.room) return null;
    if (roomState.selfPlayerId) {
      const playerById = roomState.room.players?.find((player) => player.player_id === roomState.selfPlayerId) || null;
      if (playerById) return playerById;
    }
    return roomState.room.players?.find((player) => player.is_self) || null;
  }

  function isRoomHost() {
    return !!(roomPlayer()?.is_host || roomState.room?.is_host);
  }

  function isRoomObserver() {
    return !!(roomPlayer()?.is_observer || roomState.selfIsObserver);
  }

  function isRoomRacer() {
    const player = roomPlayer();
    return !!(player && !player.is_observer && Number.isInteger(player.seat_index));
  }

  function isMyTurn() {
    return false;
  }

  function roomPlayMode() {
    if (!roomState.room) return "realtime";
    return roomState.room.play_mode || roomState.room.game_state?.settings?.playMode || "realtime";
  }

  function roomRacePhase() {
    return roomState.room?.game_state?.race?.phase || null;
  }

  function roomPauseStartedAt() {
    return Number(roomState.room?.game_state?.race?.realtimePauseStartedAt) || 0;
  }

  function isRoomRealtimePaused() {
    return !!roomState.room?.game_state?.race?.realtimePaused;
  }

  function isRealtimeRoom() {
    return !!roomState.room && roomState.room.status === "live" && roomPlayMode() === "realtime";
  }

  function isRealtimeCountdownRoom() {
    return isRealtimeRoom() && roomRacePhase() === "countdown";
  }

  function isPendingRealtimeStartRoom() {
    if (!roomState.room || roomPlayMode() !== "realtime") return false;
    const countdownEndsAt = Number(roomState.room?.game_state?.race?.realtimeCountdownEndsAt) || 0;
    return roomRacePhase() === "countdown" && countdownEndsAt <= 0;
  }

  function roomNowMs() {
    const syncedNowMs = Date.now() + roomState.serverClockOffsetMs;
    return isRoomRealtimePaused()
      ? Math.min(syncedNowMs, roomPauseStartedAt() || syncedNowMs)
      : syncedNowMs;
  }

  function roomCountdownState() {
    if (!isRealtimeCountdownRoom()) {
      return { active: false, totalMsLeft: 0, prepMsLeft: 0, finalMsLeft: 0, inFinal: false };
    }

    const countdownEndsAt = roomState.room?.game_state?.race?.realtimeCountdownEndsAt || 0;
    const totalMsLeft = Math.max(0, countdownEndsAt - roomNowMs());
    return {
      active: totalMsLeft > 0,
      totalMsLeft,
      prepMsLeft: totalMsLeft,
      finalMsLeft: 0,
      inFinal: false,
    };
  }

  function formatCountdownSeconds(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "0.0";
    const seconds = ms / 1000;
    return seconds >= 10 ? String(Math.ceil(seconds)) : seconds.toFixed(1);
  }

  function canEditSetup() {
    if (!roomState.room) return true;
    return roomState.room.status === "lobby" && isRoomHost();
  }

  function canEditLiveRoom() {
    return !!(
      roomState.room
      && isRoomHost()
      && roomState.room.status === "live"
    );
  }

  function canResetLobby() {
    return !!(roomState.room && isRoomHost());
  }

  function canEditTurnBudget() {
    if (!roomState.room) return true;
    if (roomState.room.status === "lobby") return isRoomHost();
    return isRoomHost();
  }

  function canPushState() {
    if (!roomState.room) return false;
    return roomState.room.status === "lobby" && isRoomHost();
  }

  function canPushSharedViewSettings() {
    return !!(
      roomState.room
      && roomState.socket
      && roomState.socket.connected
      && isRoomHost()
      && !roomState.applyingRemote
    );
  }

  function canSendRealtimeControl() {
    return !!(
      roomState.room
      && roomState.socket
      && roomState.socket.connected
      && isRoomRacer()
      && (roomState.room.status === "lobby" || (isRealtimeRoom() && roomRacePhase() !== "finished"))
      && !isRoomRealtimePaused()
      && !roomState.applyingRemote
    );
  }

  function canToggleRoomPause() {
    return !!(
      roomState.room
      && roomState.socket
      && roomState.socket.connected
      && isRoomHost()
      && isRealtimeRoom()
      && roomRacePhase() !== "finished"
      && !roomState.applyingRemote
    );
  }

  function canInteractWithBoard() {
    if (!roomState.room) return true;
    if (roomState.room.status === "lobby") {
      if (!isRoomHost() && isRoomRacer() && (regatta.getMeta?.().mode || "play") !== "play") {
        regatta.setMode?.("play");
      }
      return isRoomHost() || (isRoomRacer() && (regatta.getMeta?.().mode || "play") === "play");
    }
    if (isRealtimeRoom()) return isRoomRacer();
    return false;
  }

  function syncBoardStartAction() {
    if (typeof regatta.setBoardStartActionOverride !== "function") return;

    if (!roomState.room || roomStartPending) {
      regatta.setBoardStartActionOverride(null);
      return;
    }

    if (!isRoomHost()) {
      regatta.setBoardStartActionOverride(null);
      return;
    }

    const roomReady = roomStartReady(roomState.room);
    const editingLiveRoom = canEditLiveRoom();
    const waitingStart = roomState.room.status === "lobby" || isPendingRealtimeStartRoom();
    regatta.setBoardStartActionOverride({
      label: editingLiveRoom ? "В лобби" : (waitingStart ? "Старт гонки" : "Начать гонку заново"),
      title: editingLiveRoom
        ? "Остановить текущую гонку и снова открыть настройки дистанции"
        : (waitingStart
          ? (roomReady ? "Запустить матч" : "Дождись всех участников")
          : "Перезапустить матч с текущей дистанцией"),
      disabled: editingLiveRoom ? false : !roomReady,
      onTrigger: handleRoomStartAction,
    });
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

  async function copyTextWithFallback(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "readonly");
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    helper.style.top = "0";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    helper.setSelectionRange(0, helper.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(helper);
    if (!copied) {
      throw new Error("copy-failed");
    }
  }

  function setSyncLabel(text, accent = false) {
    syncIndicatorEl.textContent = text;
    syncIndicatorEl.classList.toggle("hero-badge-muted", !accent);
  }

  function showToast(message) {
    const text = typeof message === "string" ? message.trim() : "";
    if (!appToastEl || !text) return;
    window.clearTimeout(toastTimer);
    appToastEl.textContent = text;
    appToastEl.classList.remove("hidden");
    toastTimer = window.setTimeout(() => {
      appToastEl.classList.add("hidden");
      appToastEl.textContent = "";
    }, 1800);
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

    const players = [...room.players].sort((left, right) => {
      if (!!left.is_host !== !!right.is_host) return left.is_host ? -1 : 1;
      if (!!left.is_observer !== !!right.is_observer) return left.is_observer ? -1 : 1;
      const leftSeat = Number.isInteger(left.seat_index) ? left.seat_index : 10_000;
      const rightSeat = Number.isInteger(right.seat_index) ? right.seat_index : 10_000;
      return leftSeat - rightSeat;
    });
    roomPlayersEl.innerHTML = players.map((player) => `
      <li class="room-player">
        <strong>
          <span class="room-seat">${player.is_observer ? "S" : (player.seat_index + 1)}</span>
          <span>${player.name}</span>
        </strong>
        <span class="room-tags">
          ${player.is_host ? '<span class="room-tag room-tag-host">Host</span>' : ""}
          ${player.is_observer ? '<span class="room-tag room-tag-observer">Наблюдает</span>' : ""}
          ${player.is_self ? '<span class="room-tag room-tag-self">Вы</span>' : ""}
        </span>
        ${isRoomHost() && !player.is_host
          ? `<button type="button" class="ghost-btn room-kick-btn" data-player-kick="${player.player_id}">\u041a\u0438\u043a</button>`
          : ""}
      </li>
    `).join("");
  }

  function hydrateRoom(room) {
    if (!room) return null;

    if (Number.isFinite(room.server_time_ms)) {
      roomState.serverClockOffsetMs = room.server_time_ms - Date.now();
      regatta.setServerClockOffset?.(roomState.serverClockOffsetMs);
    }

    const sameRoom = room.code && room.code === roomState.room?.code;
    const incomingSelf = room.self || {};
    const incomingSelfKnown = !!incomingSelf.token_present;
    const previousSelfPlayer = sameRoom
      ? (roomState.room?.players || []).find((player) => player.is_self) || null
      : null;
    const preservedSelf = sameRoom && !incomingSelfKnown
      ? {
          playerId: roomState.selfPlayerId || previousSelfPlayer?.player_id || null,
          seatIndex: Number.isInteger(roomState.selfSeatIndex)
            ? roomState.selfSeatIndex
            : (Number.isInteger(previousSelfPlayer?.seat_index) ? previousSelfPlayer.seat_index : null),
          isObserver: !!(roomState.selfIsObserver || previousSelfPlayer?.is_observer),
          isHost: !!(roomState.room?.is_host || previousSelfPlayer?.is_host),
          name: roomState.room?.self?.name || previousSelfPlayer?.name || "",
        }
      : null;

    const players = (room.players || []).map((player) => {
      const matchesPreservedPlayerId = preservedSelf
        && typeof preservedSelf.playerId === "string"
        && preservedSelf.playerId.length > 0
        && player.player_id === preservedSelf.playerId;
      const matchesPreservedSeat = preservedSelf
        && Number.isInteger(preservedSelf.seatIndex)
        && Number.isInteger(player.seat_index)
        && player.seat_index === preservedSelf.seatIndex
        && !player.is_observer;
      const matchesPreservedObserver = preservedSelf
        && preservedSelf.isObserver
        && player.is_observer
        && typeof preservedSelf.name === "string"
        && preservedSelf.name.length > 0
        && player.name === preservedSelf.name;
      return {
        ...player,
        is_self: !!player.is_self || !!matchesPreservedPlayerId || !!matchesPreservedSeat || !!matchesPreservedObserver,
        is_observer: !!player.is_observer,
      };
    });

    const effectiveSelfPlayer = players.find((player) => player.is_self) || null;
    roomState.selfPlayerId = typeof incomingSelf.player_id === "string" && incomingSelf.player_id
      ? incomingSelf.player_id
      : (effectiveSelfPlayer?.player_id || preservedSelf?.playerId || null);
    roomState.selfSeatIndex = Number.isInteger(incomingSelf.seat_index)
      ? incomingSelf.seat_index
      : (Number.isInteger(effectiveSelfPlayer?.seat_index) ? effectiveSelfPlayer.seat_index : null);
    roomState.selfIsObserver = incomingSelfKnown
      ? !!incomingSelf.is_observer
      : !!(effectiveSelfPlayer?.is_observer || preservedSelf?.isObserver);

    return {
      ...room,
      is_host: incomingSelfKnown
        ? !!room.is_host
        : (effectiveSelfPlayer ? !!effectiveSelfPlayer.is_host : !!preservedSelf?.isHost),
      players,
      self: incomingSelfKnown
        ? {
            ...incomingSelf,
            player_id: roomState.selfPlayerId,
            is_observer: !!incomingSelf.is_observer,
            token_present: true,
          }
        : {
            player_id: roomState.selfPlayerId,
            name: effectiveSelfPlayer?.name || preservedSelf?.name || null,
            seat_index: roomState.selfSeatIndex,
            is_observer: roomState.selfIsObserver,
            token_present: !!effectiveSelfPlayer || !!preservedSelf,
          },
    };
  }

  function applyPermissions() {
    const pendingDraft = hasPendingRoomDraft();
    const setupDisabled = !canEditSetup();
    const sharedViewDisabled = !!roomState.room && !isRoomHost();
    const showHostHintControls = !roomState.room || isRoomHost();
    for (const control of setupLockedControls()) {
      const originalDisabled = originalDisabledFor(control);
      control.disabled = originalDisabled || setupDisabled;
    }
    for (const control of sharedViewControls()) {
      const originalDisabled = originalDisabledFor(control);
      control.disabled = originalDisabled || sharedViewDisabled;
    }
    for (const control of hostHintOnlyControls()) {
      control.classList.toggle("hidden", !showHostHintControls);
    }
    if (movesPerTurnInput) {
      movesPerTurnInput.disabled = originalMovesPerTurnDisabled || !canEditTurnBudget();
    }
    if (roomHostRoleEl) {
      roomHostRoleEl.disabled = !!roomState.room || roomStartPending;
      roomHostRoleEl.value = roomState.room
        ? (roomState.room.host_mode === "observe" ? "observer" : "player")
        : pendingDraftHostRole();
    }

    createRoomBtn.disabled = !!roomState.room || pendingDraft;
    joinRoomBtn.disabled = !!roomState.room;
    joinRoomCodeInput.disabled = !!roomState.room;
    leaveRoomBtn.disabled = !roomState.room && !pendingDraft;
    copyRoomCodeBtn.disabled = !roomState.room;
    startRoomBtn.disabled = roomStartPending || (
      roomState.room
        ? (
            !isRoomHost()
            || (roomState.room.status === "lobby" && !roomStartReady(roomState.room))
            || !["lobby", "live"].includes(roomState.room.status)
          )
        : !pendingDraft
    );
    if (startRoomBtn) {
      if (!roomState.room) {
        startRoomBtn.textContent = pendingDraft ? "Открыть комнату" : "Запустить матч";
      } else if (canEditLiveRoom()) {
        startRoomBtn.textContent = "Остановить и пересобрать карту";
      } else {
        startRoomBtn.textContent = (roomState.room.status === "lobby" || isPendingRealtimeStartRoom())
          ? "Запустить матч"
          : "Начать гонку заново";
      }
    }
    if (leaveRoomBtn) {
      leaveRoomBtn.textContent = roomState.room ? "Выйти" : (pendingDraft ? "Отменить" : "Выйти");
    }
    if (resetLobbyBtn) {
      const showResetLobby = canResetLobby();
      resetLobbyBtn.classList.toggle("hidden", !showResetLobby);
      resetLobbyBtn.disabled = !showResetLobby || roomStartPending;
    }

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
    if (roomState.room.status === "lobby") {
      interactionLockEl.textContent = isRoomObserver()
        ? "Ты в комнате как наблюдатель. Можно следить за полем и стартом, но лодка тебе не назначена."
        : "Лобби открыто. Переключись в режим «В игру», чтобы пройтись по карте до старта.";
      return;
    }
    interactionLockEl.textContent = roomState.room.status === "lobby"
      ? "Хост настраивает дистанцию. Пока можно следить за полем и готовиться к старту."
      : "В этой комнате активен realtime-режим, но этот браузер сейчас не привязан к лодке.";
  }

  function renderRoom(room) {
    roomState.room = hydrateRoom(room);
    if (!roomState.room || roomState.room.code !== activeRoomInviteCode) {
      activeRoomInviteCode = "";
      activeRoomInviteMessage = "";
    }
    regatta.setMultiplayerContext({
      active: !!roomState.room,
      seatIndex: roomState.room ? roomState.selfSeatIndex : null,
      observer: !!roomState.selfIsObserver,
      lobbyPreview: !!roomState.room && roomState.room.status === "lobby",
      host: !!roomState.room && isRoomHost(),
    });
    renderRoster(roomState.room);

    if (!roomState.room) {
      const pendingDraft = hasPendingRoomDraft();
      roomState.serverClockOffsetMs = 0;
      roomState.selfPlayerId = null;
      roomState.selfIsObserver = false;
      regatta.setServerClockOffset?.(0);
      roomCodeValueEl.textContent = "-";
      if (pendingDraft) {
        const pendingMaxPlayers = pendingDraftMaxPlayers();
        const pendingRole = pendingDraftHostRole();
        const pendingRoomStatus = pendingRole === "observer"
          ? `Черновик комнаты · ${pendingMaxPlayers} экипажей + судья`
          : `Черновик комнаты · ${pendingMaxPlayers} экипажей`;
        const sourceLabel = pendingRoomDraft.source === "race" ? "сохранённая гонка" : "карта";
        roomStatusEl.textContent = `Черновик комнаты · ${pendingMaxPlayers} мест`;
        roomPhaseLabelEl.textContent = "Подготовка комнаты";
        setHint(`Сейчас готовится сетевой запуск: ${sourceLabel}. Доведи дистанцию до нужного вида и нажми «Открыть комнату», когда всё будет готово.`);
        setNotice("Комната ещё не создана. Пока можно менять карту, ветер, число лодок и остальные настройки без лишних подключений.", "neutral");
        setSyncLabel("Черновик комнаты", true);
        if (roomPanelNoteEl) {
          roomPanelNoteEl.textContent = "Сначала подготовь карту, затем открой комнату и раздай код участникам. Пока комнаты нет, в настройки никто не вмешивается.";
        }
      } else {
        roomStatusEl.textContent = "Готов к локальной игре";
        roomPhaseLabelEl.textContent = "Соло";
        setHint("Размер комнаты берётся из настройки «Лодок». Хост настраивает дистанцию, остальные игроки подключаются по ссылке или коду и ждут старта.");
        setNotice("Сетевой слой не активен, пока ты не создашь комнату.", "neutral");
        setSyncLabel("Локальный режим", false);
        if (roomPanelNoteEl) {
          roomPanelNoteEl.textContent = DEFAULT_ROOM_PANEL_NOTE;
        }
      }
      roomState.lastRealtimeIntentKey = "";
      roomState.lastSharedViewKey = "";
      syncBoardStartAction();
      applyPermissions();
      emitRoomStateChanged();
      return;
    }

    if (pendingRoomDraft.active) {
      pendingRoomDraft.active = false;
      pendingRoomDraft.displayName = "";
      pendingRoomDraft.maxPlayers = MIN_ROOM_PLAYERS;
      pendingRoomDraft.source = "map";
      pendingRoomDraft.mode = "edit";
      pendingRoomDraft.hostRole = roomHostRoleEl?.value === "observer" ? "observer" : "player";
      emitRoomDraftChanged();
    }
    if (roomPanelNoteEl) {
      roomPanelNoteEl.textContent = DEFAULT_ROOM_PANEL_NOTE;
    }

    roomCodeValueEl.textContent = roomState.room.code;
    roomPhaseLabelEl.textContent = roomState.room.status === "lobby"
      ? `Лобби ${roomState.room.code}`
      : `Матч ${roomState.room.code}`;
    if (roomState.room.status === "live") {
      regatta.setMode?.("play");
    }

    if (roomState.room.status === "lobby") {
      const hostObserves = roomHostObserves(roomState.room);
      const occupancyLabel = roomOccupancyLabel(roomState.room);
      setHint(`В лобби сейчас ${occupancyLabel}. Хост может стартовать, как только готов состав.`);
      roomStatusEl.textContent = `Лобби · ${occupancyLabel}`;
      setNotice(
        isRoomHost()
          ? "Комната создана. Настраивай дистанцию, делись ссылкой и запускай матч, когда готов."
          : "Ты подключился к комнате. Хост готовит дистанцию и сам решает, когда запускать старт.",
        "success",
      );
      setHint(`Лобби открыто: ${occupancyLabel}. До старта можно пройтись по карте, а официальный старт вернёт всех на исходные позиции.`);
      roomStatusEl.textContent = `Лобби · ${occupancyLabel}`;
      setNotice(
        isRoomHost()
          ? (activeRoomInviteCode === roomState.room.code && activeRoomInviteMessage
            ? activeRoomInviteMessage
            : hostObserves
            ? "Комната создана. Ты в роли наблюдателя: настрой дистанцию, дождись нужного состава и запускай старт в любой удобный момент."
            : "Комната создана. Пока участники заходят, они уже могут изучать карту, а старт ты запускаешь вручную, когда всё готово.")
          : (isRoomObserver()
            ? "Ты вошёл как наблюдатель. Можно смотреть поле и подготовку, но лодка тебе не назначена."
            : "Ты вошёл в лобби. Переключись в режим «В игру» и можешь пройтись по карте до официального старта."),
        "success",
      );
    } else if (isRealtimeRoom()) {
      if (isPendingRealtimeStartRoom()) {
        setHint("Старт заново подготовлен. Лодки возвращены на стартовые позиции, нажми «Старт гонки», когда все готовы.");
        roomStatusEl.textContent = `Гонка · готова к старту`;
        setNotice(
          "Realtime-режим ожидает общего запуска. До нажатия «Старт гонки» отсчёт не идёт и матч ещё не начался.",
          "neutral",
        );
      } else if (isRoomRealtimePaused()) {
        const countdown = roomCountdownState();
        setHint(
          roomRacePhase() === "countdown"
            ? `Пауза: общий отсчёт остановлен на ${formatCountdownSeconds(countdown.totalMsLeft)} с.`
            : "Пауза: хост временно остановил realtime-гонку для всей комнаты."
        );
        roomStatusEl.textContent = "Гонка · пауза";
        setNotice(
          isRoomHost()
            ? "Пауза активна для всей комнаты. Нажми «Продолжить», когда можно возвращаться в гонку."
            : "Хост поставил гонку на паузу. Дождись продолжения, чтобы снова управлять лодкой.",
          "neutral",
        );
      } else if (isRealtimeCountdownRoom()) {
        const countdown = roomCountdownState();
        setHint(`Предстарт: до сигнала ${formatCountdownSeconds(countdown.totalMsLeft)} с. Фальстарт считается только в последние 3.0 с до старта.`);
        roomStatusEl.textContent = `Гонка · общий отсчет`;
        setNotice(
          "Realtime-режим активен. Управление идёт курсором мыши или касанием по полю, а сервер двигает обе лодки одновременно.",
          "neutral",
        );
      } else if (roomRacePhase() === "finished") {
        setHint("Гонка завершена.");
        roomStatusEl.textContent = "Гонка · финиш";
        setNotice("Матч завершён. Нажми «Редактировать карту», чтобы вернуть комнату в лобби и снова открыть все настройки.", "neutral");
      } else {
        setHint("Матч запущен. Все лодки движутся одновременно по серверному тику.");
        roomStatusEl.textContent = "Гонка · realtime";
        setNotice(
          "Realtime-режим активен. Веди свою лодку курсором мыши или касанием по полю, сервер считает движение для всех одновременно.",
          "neutral",
        );
      }
    }

    syncBoardStartAction();
    applyPermissions();
    emitRoomStateChanged();
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
        handleIncomingRoom(payload.room);
      }
    });

    roomState.socket.on("room:snapshot", (payload) => {
      handleIncomingRoom(payload?.room);
    });

    roomState.socket.on("room:state_updated", (payload) => {
      handleIncomingRoom(payload?.room);
    });

    roomState.socket.on("room:kicked", (payload) => {
      if (typeof payload?.room_code === "string") {
        joinRoomCodeInput.value = payload.room_code;
      }
      disconnectSocket();
      roomState.room = null;
      roomState.selfPlayerId = null;
      roomState.selfSeatIndex = null;
      roomState.selfIsObserver = false;
      roomState.lastRealtimeIntentKey = "";
      roomState.lastSharedViewKey = "";
      regatta.clearRealtimeIntent?.();
      renderRoom(null);
      setNotice("\u0425\u043e\u0441\u0442 \u0443\u0431\u0440\u0430\u043b \u0432\u0430\u0441 \u0438\u0437 \u043a\u043e\u043c\u043d\u0430\u0442\u044b.", "warning");
      announceJoinLink(joinRoomCodeInput.value.trim());
    });
  }

  function disconnectSocket() {
    if (!roomState.socket) return;
    roomState.socket.disconnect();
    roomState.socket = null;
  }

  function handleIncomingRoom(room) {
    if (!room) return;
    const previousStatus = roomState.room?.status || null;

    const incomingState = room.game_state;
    if (incomingState) {
      const incomingFingerprint = JSON.stringify(incomingState);
      if (incomingFingerprint !== roomState.lastFingerprint) {
        roomState.applyingRemote = true;
        try {
          regatta.importState(incomingState);
          if (previousStatus === "live" && room.status === "lobby") {
            regatta.clearRealtimeIntent?.();
            roomState.lastRealtimeIntentKey = "";
            roomState.lastRealtimeIntentSentAt = 0;
          }
          roomState.lastFingerprint = regatta.fingerprintState();
        } finally {
          roomState.applyingRemote = false;
        }
      }
    }

    renderRoom(room);
  }

  async function createRoom(overrides = {}) {
    if (!await ensureFreshAssets()) return null;
    const payload = await apiRequest("/api/rooms", {
      method: "POST",
      body: {
        display_name: typeof overrides.display_name === "string" ? overrides.display_name : displayNameInput.value.trim(),
        max_players: Math.max(
          MIN_ROOM_PLAYERS,
          Math.min(MAX_ROOM_PLAYERS, parseInt(overrides.max_players, 10) || parseInt(playerCountSelect.value, 10) || MIN_ROOM_PLAYERS)
        ),
        host_role: overrides.host_role === "observer" ? "observer" : pendingDraftHostRole(),
        game_state: overrides.game_state || regatta.exportState(),
      },
    });

    if (payload.room?.game_state) {
      roomState.applyingRemote = true;
      try {
        regatta.importState(payload.room.game_state);
      } finally {
        roomState.applyingRemote = false;
      }
    }

    roomStartPending = false;
    pendingRoomDraft.active = false;
    pendingRoomDraft.displayName = "";
    pendingRoomDraft.maxPlayers = MIN_ROOM_PLAYERS;
    pendingRoomDraft.source = "map";
    pendingRoomDraft.mode = "edit";
    pendingRoomDraft.hostRole = roomHostRoleEl?.value === "observer" ? "observer" : "player";
    roomState.lastFingerprint = regatta.fingerprintState();
    renderRoom(payload.room);
    ensureSocket();
    emitRoomDraftChanged();
    return payload.room;
  }

  async function joinRoom(overrides = {}) {
    if (!await ensureFreshAssets()) return false;
    clearPendingRoomDraft({ silent: true });
    const nextDisplayName = typeof overrides.display_name === "string"
      ? overrides.display_name.trim()
      : displayNameInput.value.trim();
    const nextRoomCode = typeof overrides.room_code === "string"
      ? overrides.room_code.trim()
      : joinRoomCodeInput.value.trim();
    const payload = await apiRequest("/api/rooms/join", {
      method: "POST",
      body: {
        display_name: nextDisplayName,
        room_code: nextRoomCode,
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

    roomStartPending = false;
    renderRoom(payload.room);
    ensureSocket();
    if (joinLinkState?.roomCode === nextRoomCode.toUpperCase()) {
      joinLinkState.handled = true;
      clearJoinLinkQuery();
    }
    return true;
  }

  async function startRoom({ armRealtime = true } = {}) {
    if (!roomState.room) return;
    if (!await ensureFreshAssets()) return false;
    const payload = await apiRequest(`/api/rooms/${roomState.room.code}/start`, {
      method: "POST",
      body: {
        game_state: regatta.exportState(),
        arm_realtime: armRealtime,
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
    return true;
  }

  async function editRoom() {
    if (!roomState.room) return;
    const payload = await apiRequest(`/api/rooms/${roomState.room.code}/edit`, {
      method: "POST",
    });

    if (payload.room?.game_state) {
      roomState.applyingRemote = true;
      try {
        regatta.importState(payload.room.game_state);
        regatta.clearRealtimeIntent?.();
        roomState.lastFingerprint = regatta.fingerprintState();
      } finally {
        roomState.applyingRemote = false;
      }
    }
    roomState.lastRealtimeIntentKey = "";
    roomState.lastRealtimeIntentSentAt = 0;
    renderRoom(payload.room);
  }

  async function resetLobby() {
    if (!roomState.room) return;
    const payload = await apiRequest(`/api/rooms/${roomState.room.code}/reset-lobby`, {
      method: "POST",
    });

    if (payload.room?.game_state) {
      roomState.applyingRemote = true;
      try {
        regatta.importState(payload.room.game_state);
        regatta.clearRealtimeIntent?.();
        roomState.lastFingerprint = regatta.fingerprintState();
      } finally {
        roomState.applyingRemote = false;
      }
    }
    roomState.lastRealtimeIntentKey = "";
    roomState.lastRealtimeIntentSentAt = 0;
    renderRoom(payload.room);
  }

  async function handleRoomStartAction() {
    if (roomStartPending) return;

    if (!roomState.room) {
      if (!hasPendingRoomDraft()) return;

      roomStartPending = true;
      syncBoardStartAction();
      applyPermissions();
      let createdRoom = null;

      try {
        createdRoom = await createRoom({
          display_name: pendingDraftDisplayName(),
          max_players: pendingDraftMaxPlayers(),
          game_state: regatta.exportState(),
        });
      } catch (error) {
        setNotice(error.message, "danger");
      } finally {
        roomStartPending = false;
        renderRoom(roomState.room);
      }
      if (createdRoom?.code) {
        await revealRoomInvite(createdRoom.code);
      }
      return;
    }

    roomStartPending = true;
    syncBoardStartAction();
    applyPermissions();

    try {
      if (canEditLiveRoom()) {
        await editRoom();
        return;
      }
      regatta.setMode?.("play");
      const armRealtime = roomState.room.status === "lobby" || isPendingRealtimeStartRoom();
      if (armRealtime) {
        await regatta.requestBoardFullscreenIfAuto?.();
      } else {
        await regatta.resetRaceToReadyState?.();
      }
      const started = await startRoom({ armRealtime });
      if (started === false) return;
    } catch (error) {
      setNotice(error.message, "danger");
    } finally {
      roomStartPending = false;
      renderRoom(roomState.room);
    }
  }

  async function toggleRoomPause() {
    if (!canToggleRoomPause()) return false;
    roomState.socket.emit("room:pause", {
      room_code: roomState.room.code,
      paused: !isRoomRealtimePaused(),
    });
    return true;
  }

  async function leaveRoom() {
    if (!roomState.room) {
      clearPendingRoomDraft();
      return;
    }
    await apiRequest("/api/rooms/leave", { method: "POST" });
    disconnectSocket();
    roomState.room = null;
    roomState.selfPlayerId = null;
    roomState.selfSeatIndex = null;
    roomState.selfIsObserver = false;
    roomState.lastFingerprint = regatta.fingerprintState();
    roomState.lastRealtimeIntentKey = "";
    roomState.lastSharedViewKey = "";
    roomStartPending = false;
    renderRoom(null);
  }

  async function kickPlayer(playerId) {
    if (!roomState.room || !isRoomHost() || !playerId) return;
    const payload = await apiRequest(`/api/rooms/${roomState.room.code}/kick`, {
      method: "POST",
      body: {
        player_id: playerId,
      },
    });
    renderRoom(payload.room);
  }

  async function bootstrapRoom() {
    try {
      const payload = await apiRequest("/api/bootstrap");
      if (refreshForAssetMismatch(payload?.asset_version)) {
        return;
      }
      clearAssetRefreshQuery();
      roomStartPending = false;
      if (payload.display_name) {
        displayNameInput.value = payload.display_name;
      }
      const pendingJoinLink = getJoinLinkState();
      const holdInviteFlow = joinLinkOverridesRoom(payload.room, pendingJoinLink);
      if (payload.room && !holdInviteFlow) {
        handleIncomingRoom(payload.room);
        ensureSocket();
      } else {
        if (holdInviteFlow) {
          disconnectSocket();
        }
        renderRoom(null);
      }

      if (pendingJoinLink?.roomCode) {
        joinRoomCodeInput.value = pendingJoinLink.roomCode;
        if (!holdInviteFlow && payload.room?.code && payload.room.code === pendingJoinLink.roomCode) {
          joinLinkState.handled = true;
          clearJoinLinkQuery();
        } else {
          announceJoinLink(pendingJoinLink.roomCode);
        }
      }
    } catch (error) {
      setNotice(error.message, "danger");
      renderRoom(null);
    }
  }

  async function copyRoomCode() {
    if (!roomState.room) return;
    try {
      await copyTextWithFallback(buildRoomInviteLink(roomState.room.code));
      setNotice(`Ссылка на комнату ${roomState.room.code} скопирована.`, "success");
      showToast("Скопировано");
    } catch (error) {
      setNotice("Не удалось скопировать ссылку.", "warning");
      showToast("Не удалось");
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
      direction: intent?.direction || null,
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

  async function trySendSharedViewSettings(force = false) {
    if (!canPushSharedViewSettings()) return;

    const settings = regatta.getSharedViewSettings?.();
    if (!settings || typeof settings !== "object") return;

    const payload = {
      room_code: roomState.room.code,
      settings,
    };
    const key = JSON.stringify(payload);
    const now = Date.now();
    if (!force && key === roomState.lastSharedViewKey && now - roomState.lastSharedViewSentAt < 250) {
      return;
    }

    roomState.lastSharedViewKey = key;
    roomState.lastSharedViewSentAt = now;
    roomState.socket.emit("room:view_settings", payload);
  }

  createRoomBtn.addEventListener("click", async () => {
    try {
      const room = await createRoom();
      if (room?.code) {
        await revealRoomInvite(room.code);
      }
    } catch (error) {
      setNotice(error.message, "danger");
    }
  });

  joinRoomBtn.addEventListener("click", async () => {
    try {
      const joined = await joinRoom();
      if (!joined) return;
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
    await handleRoomStartAction();
  });

  resetLobbyBtn?.addEventListener("click", async () => {
    try {
      await resetLobby();
    } catch (error) {
      setNotice(error.message, "danger");
    }
  });

  copyRoomCodeBtn.addEventListener("click", copyRoomCode);

  roomPlayersEl?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-player-kick]");
    if (!button) return;
    try {
      await kickPlayer(button.dataset.playerKick);
    } catch (error) {
      setNotice(error.message, "danger");
    }
  });

  joinRoomCodeInput.addEventListener("input", () => {
    joinRoomCodeInput.value = joinRoomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  roomHostRoleEl?.addEventListener("change", () => {
    pendingRoomDraft.hostRole = roomHostRoleEl.value === "observer" ? "observer" : "player";
    emitRoomDraftChanged();
    renderRoom(roomState.room);
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
    if (roomState.room?.status === "lobby") {
      applyPermissions();
    }
    void tryPushState(true);
  });

  window.addEventListener("regatta:realtime-intent", () => {
    void trySendRealtimeControl(true);
  });

  window.addEventListener("regatta:view-settings-changed", () => {
    void trySendSharedViewSettings(true);
  });

  window.RegattaMultiplayer = {
    createRoom,
    joinRoom,
    leaveRoom,
    startRoom,
    editRoom,
    resetLobby,
    canToggleRoomPause,
    isRoomPaused: isRoomRealtimePaused,
    toggleRoomPause,
    setPendingRoomDraft,
    clearPendingRoomDraft,
    getPendingRoomDraft: () => (
      pendingRoomDraft.active
        ? {
            ...pendingRoomDraft,
            displayName: pendingDraftDisplayName(),
            maxPlayers: pendingDraftMaxPlayers(),
          }
        : null
    ),
    getRoomState: () => ({
      room: roomState.room,
      selfPlayerId: roomState.selfPlayerId,
      selfSeatIndex: roomState.selfSeatIndex,
      selfIsObserver: roomState.selfIsObserver,
      serverClockOffsetMs: roomState.serverClockOffsetMs,
    }),
    getJoinLinkState,
  };

  bootstrapRoom();
});
