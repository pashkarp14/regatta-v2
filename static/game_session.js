document.addEventListener("DOMContentLoaded", () => {
  const KEY = "regatta-active-session";
  const menuContinueBtn = document.getElementById("menuContinue");
  const menuContinueDescriptionEl = document.getElementById("menuContinueDescription");
  const dock = document.querySelector(".command-dock");
  const topbarActions = document.querySelector(".menu-topbar-actions");

  function readSession() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function writeSession(value) {
    if (!value) {
      sessionStorage.removeItem(KEY);
      syncUi();
      return;
    }
    sessionStorage.setItem(KEY, JSON.stringify(value));
    syncUi();
  }

  function clearSession() {
    writeSession(null);
  }

  function hasActiveSession() {
    const state = readSession();
    return !!(state && state.kind);
  }

  function setLocalSession() {
    writeSession({ kind: "local", updatedAt: Date.now() });
  }

  function setRoomSession(roomCode) {
    writeSession({ kind: "room", roomCode: roomCode || "", updatedAt: Date.now() });
  }

  function createExitButton(id, className, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = className;
    button.textContent = text;
    return button;
  }

  async function exitGame() {
    const room = window.RegattaMultiplayer?.getRoomState?.().room || null;
    if (room) {
      try {
        await window.RegattaMultiplayer?.leaveRoom?.();
      } catch (_) {
      }
      clearSession();
      window.location.replace(window.location.pathname);
      return;
    }
    clearSession();
    window.location.replace(window.location.pathname);
  }

  function syncUi() {
    const active = hasActiveSession();
    if (menuContinueBtn) {
      menuContinueBtn.disabled = !active;
      menuContinueBtn.classList.toggle("hidden", !active);
    }
    if (menuContinueDescriptionEl && !active) {
      menuContinueDescriptionEl.textContent = "Сейчас нет активной игры.";
    }
    const dockExit = document.getElementById("dockExitGame");
    if (dockExit) dockExit.classList.toggle("hidden", !active);
    const menuExit = document.getElementById("menuExitGame");
    if (menuExit) menuExit.classList.toggle("hidden", !active);
  }

  if (dock && !document.getElementById("dockExitGame")) {
    const button = createExitButton("dockExitGame", "dock-btn hidden", "Выйти из игры");
    button.addEventListener("click", exitGame);
    dock.appendChild(button);
  }

  if (topbarActions && !document.getElementById("menuExitGame")) {
    const button = createExitButton("menuExitGame", "ghost-btn hidden", "Выйти из игры");
    button.addEventListener("click", exitGame);
    topbarActions.insertBefore(button, topbarActions.firstChild || null);
  }

  const originalImportState = window.RegattaApp?.importState?.bind(window.RegattaApp);
  if (originalImportState) {
    window.RegattaApp.importState = (...args) => {
      const result = originalImportState(...args);
      const room = window.RegattaMultiplayer?.getRoomState?.().room || null;
      if (room) {
        setRoomSession(room.code);
      } else {
        setLocalSession();
      }
      return result;
    };
  }

  const originalResetRaceToReadyState = window.RegattaApp?.resetRaceToReadyState?.bind(window.RegattaApp);
  if (originalResetRaceToReadyState) {
    window.RegattaApp.resetRaceToReadyState = async (...args) => {
      const result = await originalResetRaceToReadyState(...args);
      const room = window.RegattaMultiplayer?.getRoomState?.().room || null;
      if (room) {
        setRoomSession(room.code);
      } else {
        setLocalSession();
      }
      return result;
    };
  }

  const originalCreateRoom = window.RegattaMultiplayer?.createRoom?.bind(window.RegattaMultiplayer);
  if (originalCreateRoom) {
    window.RegattaMultiplayer.createRoom = async (...args) => {
      const room = await originalCreateRoom(...args);
      if (room?.code) setRoomSession(room.code);
      return room;
    };
  }

  const originalJoinRoom = window.RegattaMultiplayer?.joinRoom?.bind(window.RegattaMultiplayer);
  if (originalJoinRoom) {
    window.RegattaMultiplayer.joinRoom = async (...args) => {
      const result = await originalJoinRoom(...args);
      const room = window.RegattaMultiplayer?.getRoomState?.().room || null;
      if (room?.code) setRoomSession(room.code);
      return result;
    };
  }

  const originalLeaveRoom = window.RegattaMultiplayer?.leaveRoom?.bind(window.RegattaMultiplayer);
  if (originalLeaveRoom) {
    window.RegattaMultiplayer.leaveRoom = async (...args) => {
      const result = await originalLeaveRoom(...args);
      clearSession();
      return result;
    };
  }

  window.addEventListener("regatta:room-state", () => {
    const room = window.RegattaMultiplayer?.getRoomState?.().room || null;
    if (room?.code) {
      setRoomSession(room.code);
      return;
    }

    const state = readSession();
    if (state?.kind === "room") {
      clearSession();
      window.location.replace(window.location.pathname);
    }
  });

  window.addEventListener("pagehide", () => {
    const room = window.RegattaMultiplayer?.getRoomState?.().room || null;
    if (!room) return;
    try {
      navigator.sendBeacon("/api/rooms/leave", new Blob([], { type: "application/json" }));
    } catch (_) {
    }
  });

  syncUi();
});
