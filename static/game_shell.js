document.addEventListener("DOMContentLoaded", () => {
  const regatta = window.RegattaApp;
  if (!regatta) return;

  const body = document.body;
  const overlay = document.getElementById("mainMenuOverlay");
  const screens = Array.from(document.querySelectorAll("[data-menu-screen]"));
  const navButtons = Array.from(document.querySelectorAll("[data-menu-nav]"));
  const appToastEl = document.getElementById("appToast");

  const openMainMenuBtn = document.getElementById("openMainMenu");
  const closeMainMenuBtn = document.getElementById("closeMainMenu");
  const toggleCommandDeckBtn = document.getElementById("toggleCommandDeck");
  const collapseCommandDeckBtn = document.getElementById("collapseCommandDeck");
  const commandDeckEl = document.getElementById("commandDeck");
  const deckOverlayEl = document.getElementById("deckOverlay");

  const dockMenuBtn = document.getElementById("dockMenu");
  const dockSaveMapBtn = document.getElementById("dockSaveMap");
  const dockSaveRaceBtn = document.getElementById("dockSaveRace");
  const dockToggleDeckBtn = document.getElementById("dockToggleDeck");

  const menuContinueBtn = document.getElementById("menuContinue");
  const menuNewGameBtn = document.getElementById("menuNewGame");
  const menuOpenMapsBtn = document.getElementById("menuOpenMaps");
  const menuOpenRacesBtn = document.getElementById("menuOpenRaces");
  const menuChooseLocalBtn = document.getElementById("menuChooseLocal");
  const menuChooseNetworkBtn = document.getElementById("menuChooseNetwork");
  const menuScenarioCreateBtn = document.getElementById("menuScenarioCreate");
  const menuScenarioLoadMapBtn = document.getElementById("menuScenarioLoadMap");
  const menuScenarioResumeBtn = document.getElementById("menuScenarioResume");
  const menuLocalHotseatBtn = document.getElementById("menuLocalHotseat");
  const menuLocalBotsBtn = document.getElementById("menuLocalBots");
  const menuLocalRealtimeBtn = document.getElementById("menuLocalRealtime");
  const menuCreateRoomBtn = document.getElementById("menuCreateRoom");
  const menuJoinRoomBtn = document.getElementById("menuJoinRoom");
  const menuDeckRoomBtn = document.getElementById("menuDeckRoom");
  const menuDeckCourseBtn = document.getElementById("menuDeckCourse");
  const menuDeckWeatherBtn = document.getElementById("menuDeckWeather");
  const menuDeckFleetBtn = document.getElementById("menuDeckFleet");

  const menuFlowBadgeEl = document.getElementById("menuFlowBadge");
  const menuHomeSummaryEl = document.getElementById("menuHomeSummary");
  const menuHomeLibraryEl = document.getElementById("menuHomeLibrary");
  const menuSettingsSummaryEl = document.getElementById("menuSettingsSummary");
  const menuLocalHintEl = document.getElementById("menuLocalHint");
  const menuNetworkHintEl = document.getElementById("menuNetworkHint");
  const mapsScreenHintEl = document.getElementById("mapsScreenHint");
  const racesScreenHintEl = document.getElementById("racesScreenHint");

  const savedMapsListEl = document.getElementById("savedMapsList");
  const savedRacesListEl = document.getElementById("savedRacesList");
  const mapRecordNameInput = document.getElementById("mapRecordName");
  const raceRecordNameInput = document.getElementById("raceRecordName");
  const saveCurrentMapBtn = document.getElementById("saveCurrentMap");
  const saveCurrentRaceBtn = document.getElementById("saveCurrentRace");

  const displayNameInput = document.getElementById("displayName");
  const joinRoomCodeInput = document.getElementById("joinRoomCode");
  const menuDisplayNameInput = document.getElementById("menuDisplayName");
  const menuJoinCodeInput = document.getElementById("menuJoinCode");
  const playModeSelect = document.getElementById("playMode");

  const menuState = {
    screen: "home",
    transport: null,
    scenario: null,
    maps: [],
    races: [],
  };

  let toastTimer = 0;

  function showToast(message) {
    const text = String(message || "").trim();
    if (!appToastEl || !text) return;
    window.clearTimeout(toastTimer);
    appToastEl.textContent = text;
    appToastEl.classList.remove("hidden");
    toastTimer = window.setTimeout(() => {
      appToastEl.classList.add("hidden");
      appToastEl.textContent = "";
    }, 2200);
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

  function currentDisplayName() {
    const menuName = menuDisplayNameInput?.value?.trim();
    const mainName = displayNameInput?.value?.trim();
    return menuName || mainName || "Skipper";
  }

  function syncMenuFieldsFromDeck() {
    if (menuDisplayNameInput && displayNameInput) {
      menuDisplayNameInput.value = displayNameInput.value;
    }
    if (menuJoinCodeInput && joinRoomCodeInput) {
      menuJoinCodeInput.value = joinRoomCodeInput.value;
    }
  }

  function syncDeckFieldsFromMenu() {
    if (displayNameInput && menuDisplayNameInput) {
      displayNameInput.value = menuDisplayNameInput.value.trim();
    }
    if (joinRoomCodeInput && menuJoinCodeInput) {
      joinRoomCodeInput.value = menuJoinCodeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      menuJoinCodeInput.value = joinRoomCodeInput.value;
    }
  }

  function setControlValue(control, value) {
    if (!control) return;
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setMenuOpen(nextOpen) {
    if (nextOpen) {
      setCommandDeckOpen(false);
    }
    overlay.classList.toggle("hidden", !nextOpen);
    overlay.setAttribute("aria-hidden", String(!nextOpen));
    body.classList.toggle("menu-open", nextOpen);
    if (nextOpen) {
      syncMenuFieldsFromDeck();
      renderHomeSummary();
      renderSettingsSummary();
      renderHints();
    }
  }

  function showScreen(name) {
    menuState.screen = name;
    screens.forEach((screen) => {
      screen.classList.toggle("hidden", screen.dataset.menuScreen !== name);
    });
    navButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.menuNav === name);
    });
    renderFlowBadge();
    renderHints();
  }

  function openMenu(screen = "home") {
    showScreen(screen);
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  function resetScenarioFlow(nextScreen = "home") {
    menuState.transport = null;
    menuState.scenario = null;
    showScreen(nextScreen);
  }

  function renderFlowBadge() {
    const labels = [];
    if (menuState.transport === "local") labels.push("Локальная");
    if (menuState.transport === "network") labels.push("Сеть");
    if (menuState.scenario === "create") labels.push("Новая карта");
    if (menuState.scenario === "map") labels.push("Карта");
    if (menuState.scenario === "race") labels.push("Сохраненная гонка");
    menuFlowBadgeEl.textContent = labels.length ? labels.join(" · ") : "Меню";
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function roomSummary() {
    return window.RegattaMultiplayer?.getRoomState?.() || { room: null };
  }

  function renderHomeSummary() {
    const snapshot = regatta.exportState();
    const meta = regatta.getMeta?.() || {};
    const room = roomSummary().room;
    const summary = snapshot?.course || {};
    menuHomeSummaryEl.innerHTML = `
      <div><strong>Поле:</strong> ${snapshot.world?.width || 0} × ${snapshot.world?.height || 0}</div>
      <div><strong>Лодок:</strong> ${meta.playerCount || snapshot.boats?.length || 0}</div>
      <div><strong>Знаков:</strong> ${summary.markCount || 0}</div>
      <div><strong>Режим:</strong> ${meta.playMode === "realtime" ? "Realtime" : (regatta.getLocalPilotMode?.() === "bots" ? "Локально с ботами" : "По очереди")}</div>
      <div><strong>Фаза:</strong> ${meta.phase || "race"}</div>
    `;

    menuHomeLibraryEl.innerHTML = `
      <div><strong>Карты на сервере:</strong> ${menuState.maps.length}</div>
      <div><strong>Сохраненных гонок:</strong> ${menuState.races.length}</div>
      <div><strong>Комната:</strong> ${room ? `${room.code} · ${room.status}` : "нет"}</div>
      <div><strong>Последнее обновление:</strong> ${formatDate(new Date().toISOString())}</div>
    `;
  }

  function renderSettingsSummary() {
    const meta = regatta.getMeta?.() || {};
    const snapshot = regatta.exportState();
    const room = roomSummary().room;
    menuSettingsSummaryEl.innerHTML = `
      <div><strong>Формат:</strong> ${regatta.getLocalPilotMode?.() === "bots" ? "Локально с ботами" : "Локально по очереди"}</div>
      <div><strong>Режим гонки:</strong> ${meta.playMode === "realtime" ? "Realtime" : "Пошаговый"}</div>
      <div><strong>Комната:</strong> ${room ? `${room.code} · ${room.status}` : "не активна"}</div>
      <div><strong>Ветер:</strong> ${Math.round(snapshot.settings?.windAngleDeg || 0)}°</div>
      <div><strong>Позывной:</strong> ${currentDisplayName()}</div>
    `;
  }

  function renderHints() {
    if (menuLocalHintEl) {
      menuLocalHintEl.textContent = menuState.scenario === "create"
        ? "Новая карта откроется сразу в редакторе дистанции. После правок гонку можно стартовать без потери настроек."
        : "Выбирай локальный формат и запускай текущую конфигурацию поля.";
    }

    if (menuNetworkHintEl) {
      menuNetworkHintEl.textContent = menuState.scenario === "create"
        ? "При создании комнаты хост получит свежую карту и сможет продолжить настройку в лобби."
        : "Если входишь в чужую комнату, карта и гонка будут синхронизированы от хоста.";
    }

    if (mapsScreenHintEl) {
      mapsScreenHintEl.textContent = menuState.transport === "network"
        ? "Для сетевого сценария нажми «Хостить». Для локальной подготовки доступны быстрые кнопки запуска и редактора."
        : "Стандартные карты идут с релизом, пользовательские лежат в серверной библиотеке.";
    }

    if (racesScreenHintEl) {
      racesScreenHintEl.textContent = menuState.transport === "network"
        ? "Сохраненную гонку можно поднять как новый онлайн-матч для удаленных игроков."
        : "Продолжение локально загрузит полный snapshot гонки и сохранит все текущие настройки.";
    }
  }

  function libraryMetaHtml(record) {
    const summary = record.summary || {};
    const tags = Array.isArray(record.tags) ? record.tags.map((tag) => `<span class="library-badge">${tag}</span>`).join("") : "";
    return `
      <div class="library-card__meta">
        <span>${record.author || "Skipper"}</span>
        <span>${formatDate(record.updated_at)}</span>
        <span>${summary.player_count || 0} лодок</span>
        <span>${summary.mark_count || 0} знака</span>
        <span>${summary.play_mode === "realtime" ? "Realtime" : "Пошаговая"}</span>
        ${record.scope === "standard" ? '<span class="library-badge library-badge--standard">Standard</span>' : ""}
      </div>
      <div class="library-card__meta">${tags}</div>
    `;
  }

  function mapCardActions(record) {
    return `
      <div class="library-card__actions">
        <button type="button" class="action-primary" data-library-kind="maps" data-record-id="${record.id}" data-action="local">Локально</button>
        <button type="button" class="action-secondary" data-library-kind="maps" data-record-id="${record.id}" data-action="bots">С ботами</button>
        <button type="button" class="action-secondary" data-library-kind="maps" data-record-id="${record.id}" data-action="network">Хостить</button>
        <button type="button" class="ghost-btn" data-library-kind="maps" data-record-id="${record.id}" data-action="edit">Редактор</button>
        ${record.scope === "custom" ? `<button type="button" class="ghost-btn" data-library-kind="maps" data-record-id="${record.id}" data-action="delete">Удалить</button>` : ""}
      </div>
    `;
  }

  function raceCardActions(record) {
    return `
      <div class="library-card__actions">
        <button type="button" class="action-primary" data-library-kind="races" data-record-id="${record.id}" data-action="local">Продолжить</button>
        <button type="button" class="action-secondary" data-library-kind="races" data-record-id="${record.id}" data-action="network">Хостить</button>
        ${record.scope === "custom" ? `<button type="button" class="ghost-btn" data-library-kind="races" data-record-id="${record.id}" data-action="delete">Удалить</button>` : ""}
      </div>
    `;
  }

  function renderLibraryLists() {
    savedMapsListEl.innerHTML = menuState.maps.length
      ? menuState.maps.map((record) => `
          <article class="library-card">
            <div class="library-card__top">
              <div class="library-card__title">
                <strong>${record.name}</strong>
                <span>${record.description || "Без описания"}</span>
              </div>
            </div>
            ${libraryMetaHtml(record)}
            ${mapCardActions(record)}
          </article>
        `).join("")
      : '<div class="library-card"><strong>Карты не найдены</strong><span>Сохрани текущую дистанцию или используй стандартный набор.</span></div>';

    savedRacesListEl.innerHTML = menuState.races.length
      ? menuState.races.map((record) => `
          <article class="library-card">
            <div class="library-card__top">
              <div class="library-card__title">
                <strong>${record.name}</strong>
                <span>${record.description || "Снимок гонки без описания"}</span>
              </div>
            </div>
            ${libraryMetaHtml(record)}
            ${raceCardActions(record)}
          </article>
        `).join("")
      : '<div class="library-card"><strong>Сохраненных гонок пока нет</strong><span>Сделай checkpoint текущего матча из меню или с быстрого дока.</span></div>';
  }

  async function refreshLibrary() {
    const [mapsPayload, racesPayload] = await Promise.all([
      apiRequest("/api/library/maps"),
      apiRequest("/api/library/races"),
    ]);
    menuState.maps = mapsPayload.maps || [];
    menuState.races = racesPayload.races || [];
    renderLibraryLists();
    renderHomeSummary();
    renderSettingsSummary();
  }

  async function fetchRecord(kind, recordId) {
    const payload = await apiRequest(`/api/library/${kind}/${recordId}`);
    return payload[kind === "maps" ? "map" : "race"];
  }

  async function ensureSoloContext() {
    const multiplayer = window.RegattaMultiplayer;
    if (!multiplayer?.getRoomState?.().room) return;
    await multiplayer.leaveRoom();
  }

  function prepareMapSnapshotForLocalMode(snapshot, localMode = "hotseat") {
    const source = snapshot && typeof snapshot === "object"
      ? JSON.parse(JSON.stringify(snapshot))
      : null;
    if (!source) return snapshot;

    if (localMode === "bots") {
      source.settings = {
        ...(source.settings || {}),
        playMode: "turns",
        autoFullscreenMode: "off",
      };
    }

    return regatta.normalizeMapState?.(source) || source;
  }

  async function loadMapRecord(record, { localMode = "hotseat", openEditor = false } = {}) {
    await ensureSoloContext();
    const preparedState = prepareMapSnapshotForLocalMode(record.snapshot, localMode);
    regatta.importState(preparedState);
    regatta.setLocalPilotMode?.(localMode);
    regatta.setMode(openEditor ? "marks" : "play");
    if (openEditor) {
      commandDeckEl.classList.remove("is-collapsed");
    }
    closeMenu();
    if (localMode === "bots" && record.snapshot?.settings?.playMode === "realtime") {
      showToast(`Карта «${record.name}» переведена в пошаговый режим для игры с ботами.`);
      return;
    }
    showToast(`Карта «${record.name}» загружена.`);
  }

  async function loadRaceRecord(record) {
    await ensureSoloContext();
    regatta.importState(record.snapshot);
    regatta.setLocalPilotMode?.(record.meta?.local_pilot_mode || "hotseat");
    regatta.setMode("play");
    closeMenu();
    showToast(`Гонка «${record.name}» восстановлена.`);
  }

  async function hostRecordOnline(record, kind) {
    await ensureSoloContext();
    syncDeckFieldsFromMenu();
    if (kind === "maps") {
      regatta.importState(regatta.normalizeMapState?.(record.snapshot) || record.snapshot);
    } else {
      regatta.importState(record.snapshot);
    }
    regatta.setMode(kind === "maps" ? "play" : "play");
    await window.RegattaMultiplayer?.createRoom?.();
    closeMenu();
    commandDeckEl.classList.remove("is-collapsed");
    showToast(`Комната поднята из ${kind === "maps" ? "карты" : "сохранения"} «${record.name}».`);
  }

  async function saveCurrentMap(name) {
    const mapName = String(name || "").trim() || `Карта ${new Date().toLocaleString("ru-RU")}`;
    await apiRequest("/api/library/maps", {
      method: "POST",
      body: {
        name: mapName,
        snapshot: regatta.exportMapState?.() || regatta.exportState(),
        author: currentDisplayName(),
        meta: {
          record_mode: "map",
          local_pilot_mode: regatta.getLocalPilotMode?.() || "hotseat",
        },
      },
    });
    await refreshLibrary();
    showToast(`Карта «${mapName}» сохранена.`);
  }

  async function saveCurrentRace(name) {
    const raceName = String(name || "").trim() || `Гонка ${new Date().toLocaleString("ru-RU")}`;
    await apiRequest("/api/library/races", {
      method: "POST",
      body: {
        name: raceName,
        snapshot: regatta.exportState(),
        author: currentDisplayName(),
        meta: {
          record_mode: "race",
          local_pilot_mode: regatta.getLocalPilotMode?.() || "hotseat",
        },
      },
    });
    await refreshLibrary();
    showToast(`Гонка «${raceName}» сохранена.`);
  }

  async function deleteRecord(kind, recordId) {
    await apiRequest(`/api/library/${kind}/${recordId}`, { method: "DELETE" });
    await refreshLibrary();
    showToast(kind === "maps" ? "Карта удалена." : "Сохранение удалено.");
  }

  async function startFreshLocal({ playMode, localMode, openEditor = false }) {
    await ensureSoloContext();
    setControlValue(playModeSelect, playMode);
    regatta.setLocalPilotMode?.(localMode);
    await regatta.resetRaceToReadyState?.();
    regatta.setMode(openEditor ? "marks" : "play");
    if (openEditor) {
      commandDeckEl.classList.remove("is-collapsed");
    }
    closeMenu();
    showToast(openEditor ? "Открыт редактор новой карты." : "Новая локальная гонка готова.");
  }

  async function createFreshRoom() {
    await ensureSoloContext();
    syncDeckFieldsFromMenu();
    await regatta.resetRaceToReadyState?.();
    regatta.setMode(menuState.scenario === "create" ? "marks" : "play");
    await window.RegattaMultiplayer?.createRoom?.();
    closeMenu();
    commandDeckEl.classList.remove("is-collapsed");
    showToast("Сетевая комната создана.");
  }

  function setCommandDeckOpen(nextOpen) {
    const shouldOpen = !!nextOpen;
    body.classList.toggle("deck-open", shouldOpen);
    commandDeckEl.classList.toggle("is-collapsed", !shouldOpen);
    commandDeckEl.setAttribute("aria-hidden", String(!shouldOpen));
    deckOverlayEl?.classList.toggle("hidden", !shouldOpen);
    deckOverlayEl?.setAttribute("aria-hidden", String(!shouldOpen));
  }

  function toggleCommandDeck(force) {
    const shouldOpen = typeof force === "boolean"
      ? force
      : commandDeckEl.classList.contains("is-collapsed");
    if (shouldOpen) {
      closeMenu();
    }
    setCommandDeckOpen(shouldOpen);
  }

  function focusDeckSection(sectionId) {
    setMenuOpen(false);
    setCommandDeckOpen(true);
    const section = document.getElementById(sectionId);
    if (section) {
      window.setTimeout(() => {
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 20);
    }
  }

  async function handleLibraryClick(event) {
    const button = event.target.closest("[data-record-id]");
    if (!button) return;

    const kind = button.dataset.libraryKind;
    const recordId = button.dataset.recordId;
    const action = button.dataset.action;
    if (!kind || !recordId || !action) return;

    try {
      if (action === "delete") {
        await deleteRecord(kind, recordId);
        return;
      }

      const record = await fetchRecord(kind, recordId);
      if (kind === "maps" && action === "local") {
        await loadMapRecord(record, { localMode: "hotseat" });
        return;
      }
      if (kind === "maps" && action === "bots") {
        await loadMapRecord(record, { localMode: "bots" });
        return;
      }
      if (kind === "maps" && action === "edit") {
        await loadMapRecord(record, { localMode: "hotseat", openEditor: true });
        return;
      }
      if (kind === "maps" && action === "network") {
        await hostRecordOnline(record, "maps");
        return;
      }
      if (kind === "races" && action === "local") {
        await loadRaceRecord(record);
        return;
      }
      if (kind === "races" && action === "network") {
        await hostRecordOnline(record, "races");
      }
    } catch (error) {
      showToast(error.message || "Не удалось выполнить действие.");
    }
  }

  openMainMenuBtn?.addEventListener("click", () => openMenu("home"));
  closeMainMenuBtn?.addEventListener("click", closeMenu);
  dockMenuBtn?.addEventListener("click", () => openMenu("home"));

  toggleCommandDeckBtn?.addEventListener("click", () => toggleCommandDeck());
  collapseCommandDeckBtn?.addEventListener("click", () => toggleCommandDeck(false));
  dockToggleDeckBtn?.addEventListener("click", () => toggleCommandDeck());
  deckOverlayEl?.addEventListener("click", () => toggleCommandDeck(false));

  menuContinueBtn?.addEventListener("click", closeMenu);
  menuNewGameBtn?.addEventListener("click", () => showScreen("mode"));
  menuOpenMapsBtn?.addEventListener("click", () => { menuState.transport = null; menuState.scenario = "map"; showScreen("maps"); });
  menuOpenRacesBtn?.addEventListener("click", () => { menuState.transport = null; menuState.scenario = "race"; showScreen("races"); });

  menuChooseLocalBtn?.addEventListener("click", () => {
    menuState.transport = "local";
    menuState.scenario = null;
    showScreen("scenario");
  });

  menuChooseNetworkBtn?.addEventListener("click", () => {
    menuState.transport = "network";
    menuState.scenario = null;
    showScreen("scenario");
  });

  menuScenarioCreateBtn?.addEventListener("click", () => {
    menuState.scenario = "create";
    showScreen(menuState.transport === "network" ? "network" : "local");
  });

  menuScenarioLoadMapBtn?.addEventListener("click", () => {
    menuState.scenario = "map";
    showScreen("maps");
  });

  menuScenarioResumeBtn?.addEventListener("click", () => {
    menuState.scenario = "race";
    showScreen("races");
  });

  menuLocalHotseatBtn?.addEventListener("click", async () => {
    try {
      await startFreshLocal({ playMode: "turns", localMode: "hotseat", openEditor: menuState.scenario === "create" });
    } catch (error) {
      showToast(error.message || "Не удалось подготовить локальную игру.");
    }
  });

  menuLocalBotsBtn?.addEventListener("click", async () => {
    try {
      await startFreshLocal({ playMode: "turns", localMode: "bots", openEditor: menuState.scenario === "create" });
    } catch (error) {
      showToast(error.message || "Не удалось подготовить игру с ботами.");
    }
  });

  menuLocalRealtimeBtn?.addEventListener("click", async () => {
    try {
      await startFreshLocal({ playMode: "realtime", localMode: "hotseat", openEditor: false });
    } catch (error) {
      showToast(error.message || "Не удалось подготовить локальный realtime.");
    }
  });

  menuCreateRoomBtn?.addEventListener("click", async () => {
    try {
      await createFreshRoom();
    } catch (error) {
      showToast(error.message || "Не удалось создать комнату.");
    }
  });

  menuJoinRoomBtn?.addEventListener("click", async () => {
    try {
      await ensureSoloContext();
      syncDeckFieldsFromMenu();
      await window.RegattaMultiplayer?.joinRoom?.();
      closeMenu();
      showToast("Подключение к комнате выполнено.");
    } catch (error) {
      showToast(error.message || "Не удалось войти в комнату.");
    }
  });

  menuDeckRoomBtn?.addEventListener("click", () => focusDeckSection("deckRoomSection"));
  menuDeckCourseBtn?.addEventListener("click", () => focusDeckSection("deckCourseSection"));
  menuDeckWeatherBtn?.addEventListener("click", () => focusDeckSection("deckWeatherSection"));
  menuDeckFleetBtn?.addEventListener("click", () => focusDeckSection("deckFleetSection"));

  saveCurrentMapBtn?.addEventListener("click", async () => {
    try {
      await saveCurrentMap(mapRecordNameInput?.value);
    } catch (error) {
      showToast(error.message || "Не удалось сохранить карту.");
    }
  });

  saveCurrentRaceBtn?.addEventListener("click", async () => {
    try {
      await saveCurrentRace(raceRecordNameInput?.value);
    } catch (error) {
      showToast(error.message || "Не удалось сохранить гонку.");
    }
  });

  dockSaveMapBtn?.addEventListener("click", async () => {
    try {
      await saveCurrentMap();
    } catch (error) {
      showToast(error.message || "Не удалось сохранить карту.");
    }
  });

  dockSaveRaceBtn?.addEventListener("click", async () => {
    try {
      await saveCurrentRace();
    } catch (error) {
      showToast(error.message || "Не удалось сохранить гонку.");
    }
  });

  savedMapsListEl?.addEventListener("click", handleLibraryClick);
  savedRacesListEl?.addEventListener("click", handleLibraryClick);

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.menuNav;
      if (!target) return;
      if (target === "home") {
        resetScenarioFlow("home");
        return;
      }
      if (target === "mode") {
        showScreen("mode");
        return;
      }
      if (target === "maps") {
        menuState.scenario = "map";
      }
      if (target === "races") {
        menuState.scenario = "race";
      }
      showScreen(target);
    });
  });

  menuDisplayNameInput?.addEventListener("input", syncDeckFieldsFromMenu);
  menuJoinCodeInput?.addEventListener("input", syncDeckFieldsFromMenu);
  displayNameInput?.addEventListener("input", syncMenuFieldsFromDeck);

  window.addEventListener("regatta:state-changed", () => {
    renderHomeSummary();
    renderSettingsSummary();
  });

  window.addEventListener("regatta:room-state", () => {
    renderHomeSummary();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && body.classList.contains("deck-open")) {
      toggleCommandDeck(false);
      return;
    }
    if (event.key.toLowerCase() !== "m") return;
    if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
    if (overlay.classList.contains("hidden")) {
      openMenu(menuState.screen || "home");
    } else {
      closeMenu();
    }
  });

  syncMenuFieldsFromDeck();
  renderHints();
  refreshLibrary().catch((error) => {
    showToast(error.message || "Не удалось загрузить библиотеку.");
  });
  openMenu("home");
});
