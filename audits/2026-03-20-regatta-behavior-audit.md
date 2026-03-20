# Regatta Behavior Audit - 2026-03-20

## Scope

- Targets:
  - local app started from this repo on an isolated temporary library directory
  - remote staging target at `http://158.160.217.19:5001/`
- Coverage:
  - menu screens: `home`, `mode`, `scenario`, `local`, `network`, `maps`, `races`
  - command deck sections: room, course, rules, editor modes, weather, tactics, fleet
  - board actions: menu, deck open/close, board start action, fullscreen button
  - library flows: save, load, prepare for network, delete
  - multiplayer flows: draft, host lobby, guest lobby, observer lobby, live room
- Evidence:
  - raw JSON: `output/behavior-audit-2026-03-20/results.json`
  - runner: `output/behavior-audit-2026-03-20/behavior_audit.py`
  - screenshots: `output/behavior-audit-2026-03-20/screenshots/`

## Executive Summary

- The local and remote builds behave almost identically in gameplay, menus, settings, library flows, and multiplayer permissions.
- The only expected environment-level difference is backend wiring:
  - local `/healthz`: `redis=false`, `session_backend=filesystem`
  - remote `/healthz`: `redis=true`, `session_backend=redis`
- `GET /api/bootstrap` returned the same shape on both targets: empty display name, no active room, version `2.0.0`.
- 40 deck and board controls were exercised on both targets. All confirmed settings applied except:
  - `realtimePrepSeconds` is intentionally hidden while `playMode=turns`
  - `modeFinish` is intentionally hidden while `finishSeparate=no`
  - `toggleFullscreen` could not be honestly verified in headless Playwright
- No unexpected console errors were captured during the main traversal on either target.
- Confirmed product issues:
  - the home-screen library summary can show incorrect counts on initial load
  - `static/game_shell.js` still binds several DOM ids that do not exist in the current template
  - the forced finished-room path is unstable and can flip between `Начать гонку заново` and `Редактировать карту`

## Targets And Health

| Target | URL | `/healthz` | `/api/bootstrap` |
| --- | --- | --- | --- |
| Local | ephemeral local server from repo | `ok`, filesystem session, no Redis | `display_name=""`, `room=null`, `version=2.0.0` |
| Remote | `http://158.160.217.19:5001/` | `ok`, Redis session, Redis rooms | `display_name=""`, `room=null`, `version=2.0.0` |

## State Catalog

| State | How to enter | Observed behavior |
| --- | --- | --- |
| `home` | initial load or nav `Главная` | Main menu already open; cards for new game, current race, saved races; summary block for current race and library |
| `mode` | `menuNewGame` | Split between local and network branches |
| `scenario` | `menuChooseLocal` or `menuCreateRoom` branch | Split between create new map, load map, resume race |
| `local` | `menuScenarioCreate` from local branch | Choose hotseat vs bots and turns vs realtime |
| `network` | `menuChooseNetwork` | Enter display name, join code, create-room branch |
| `maps` | `menuScenarioLoadMap` or nav `Карты` | Map cards expose local launch, bots launch, network prep, editor, and delete for custom maps |
| `races` | `menuScenarioResume`, home saves card, or nav `Сохранения` | Race cards expose continue, network prep, and delete for custom races |
| `solo_idle` | open deck in local race | Room controls hidden, gameplay settings editable |
| `local_editor` | local create flow opens editor | Editor mode buttons visible; room controls hidden |
| `local_active_race` | switch to play mode locally | Same setup availability as solo; no room UI |
| `pending_network_draft` | prepare map or race for network before room creation | `Открыть комнату` and `Отменить` visible, `Копировать` disabled, all setup still editable |
| `network_lobby_host` | host created room, waiting for guest | Host setup editable, room role locked, start disabled until room is full |
| `network_lobby_guest` | second browser joined host room | Setup mostly disabled, `Выйти` and `Копировать` enabled |
| `network_lobby_observer` | host created room with observer role | Host role locked to observer, setup still editable, start disabled until racers join |
| `live_network_active_player` | host started turns room and host is active boat | Core setup disabled, `movesPerTurn` still editable, tactical overlays available, restart action visible |
| `live_network_non_active_player` | guest in live room while it is not their turn | Interaction lock visible, most controls disabled, tactical overlays hidden |
| `finished_editable_host` | forced finished-state capture in live room | Unstable; see findings section |

## Transition Catalog

### Main Menu

| Control | From | To / Effect |
| --- | --- | --- |
| `closeMainMenu` | any menu screen | closes menu and returns to board |
| `menuNewGame` | `home` | `mode` |
| `menuContinue` | `home` | closes menu and returns to current board state |
| `menuOpenRaces` | `home` | `races` |
| `menuChooseLocal` | `mode` | `scenario` |
| `menuChooseNetwork` | `mode` | `network` |
| `menuScenarioCreate` | `scenario` in local branch | `local` |
| `menuScenarioCreate` | `scenario` in network branch | stays in network-prep branch for draft creation |
| `menuScenarioLoadMap` | `scenario` | `maps` |
| `menuScenarioResume` | `scenario` | `races` |
| `menuCreateRoom` | `network` | `scenario` create-room branch |
| `menuJoinRoom` | `network` | joins existing room by code |

### Menu Navigation And Dock

| Control | Effect |
| --- | --- |
| hero `Главное меню` / dock `Меню` | opens main menu |
| hero `Настройки гонки` / dock `Настройки` | opens command deck |
| deck `Закрыть` | collapses command deck |
| maps/races nav `Главная` | returns to `home` |
| maps/races nav `Новая игра` | returns to `mode` |
| maps/races nav `Карты` | opens `maps` |
| maps/races nav `Сохранения` | opens `races` |

## Local Launch Flows

All four local "create map" variants completed successfully on both targets.

| Flow | Result |
| --- | --- |
| new game -> local -> create -> hotseat -> turns | menu closes, deck opens, `mode=marks`, `playMode=turns`, `localPilotMode=hotseat` |
| new game -> local -> create -> hotseat -> realtime | menu closes, deck opens, `mode=marks`, `playMode=realtime`, countdown/prestart UI appears |
| new game -> local -> create -> bots -> turns | menu closes, deck opens, `mode=marks`, `playMode=turns`, `localPilotMode=bots` |
| new game -> local -> create -> bots -> realtime | menu closes, deck opens, `mode=marks`, `playMode=realtime`, `localPilotMode=bots` |

## Library Flows

### Save And Load

| Flow | Local | Remote |
| --- | --- | --- |
| `dockSaveMap` | map count increased | map count increased |
| `dockSaveRace` | race count increased | race count increased |
| map -> `На одном устройстве` | launches local hotseat from selected map | same |
| map -> `Против ботов` | launches local bots from selected map | same |
| map -> `Редактор` | opens selected map in editor | same |
| map -> `Подготовить для сети` | creates pending room draft | same |
| race -> `Продолжить` | resumes saved race locally | same |
| race -> `Подготовить для сети` | creates pending room draft from saved race | same |
| delete custom map via UI | worked | worked during audit |
| delete custom race via UI | worked | worked during audit |

### Remote Cleanup

- Audit-created remote races were removable and the API now returns no custom races.
- Audit-created remote maps were removable and the API now returns only three standard maps.
- The already-open browser session kept showing stale library data until reload; this is separate from API state.

## Settings Matrix

### Course, Room, And Launch Setup

| Control | Result | Availability / Notes |
| --- | --- | --- |
| `playerCount` | changed boat array and `race.hybridMovesLeft`; stats refreshed | host-only in room contexts |
| `markCount` | changed `course.markCount` | host-only in room contexts |
| `roundingSide` | changed `settings.roundingSide` | host-only in room contexts |
| `finishSeparate` | changed `settings.finishSeparate` | when `yes`, finish editor becomes meaningful |
| `gridCols` | input value changed only | requires `applyGrid` to affect world size |
| `gridRows` | input value changed only | requires `applyGrid` to affect world size |
| `applyGrid` | confirmed in targeted retest: `54x72 -> 60x80` | no visible effect if grid values are unchanged |
| `randomCourse` | rebuilt marks/start/finish, repositioned boats, changed wind | worked on both targets |
| `resetGame` | reset boat placement/state and refreshed deck/board status | worked on both targets |
| `roomHostRole` | editable only before room creation | locked once a room exists |
| `startRoom` | opens room from draft, then starts room from lobby | disabled until room is ready |
| `copyRoomCode` | works only after room exists | disabled in draft, enabled in lobby, hidden in live room |
| `leaveRoom` | cancels draft or leaves room | hidden in live room, visible earlier |

### Rules And Interaction

| Control | Result | Availability / Notes |
| --- | --- | --- |
| `playMode` | changed `settings.playMode`, race phase, hints, stats, board action label/visibility | guest cannot change |
| `interactionMode` | changed `settings.interactionMode` and explanatory copy | guest cannot change |
| `prestartRounds` | changed `settings.prestartRoundsSetting`, race phase, boat start state, status, stats | visible in turns mode; guest cannot change |
| `realtimePrepSeconds` | hidden in turns mode | becomes visible in realtime mode |
| `deadZone` | changed `settings.deadZoneDeg` | guest/live non-active cannot change |
| `snapThreshold` | changed `settings.snapThreshold` | guest/live non-active cannot change |
| `movesPerTurn` | changed `settings.movesPerTurn` and `race.subMovesLeft` | remains editable for active host even in live room |
| `tackPenalty` | changed `settings.tackPenaltyFactor` | guest/live non-active cannot change |
| `turnRateDegPerSec` | changed `settings.turnRateDegPerSec` | guest/live non-active cannot change |
| `luffingSpeedPercent` | changed `settings.luffingSpeedPercent` | guest/live non-active cannot change |
| `botDifficulty` | changed `settings.botDifficulty` and meta label | host/local only |

### Weather

| Control | Result | Availability / Notes |
| --- | --- | --- |
| `autoGusts` | changed `settings.autoGustsEnabled` and `race.nextAutoGustAt` | host/local only |
| `autoGustInterval` | changed `settings.autoGustIntervalSec` | host/local only |
| `autoGustDuration` | changed `settings.autoGustDurationSec` | host/local only |
| `windLeft` | changed wind angle | host/local only |
| `windRight` | changed wind angle | host/local only |
| `toggleWindArrow` | toggled `settings.showWindArrow` | host/local only |
| `randomGust` | created `course.gustRect` and `race.gustExpiresAt` | host/local only |
| `clearGust` | confirmed in targeted retest: removes gust when one exists | no visible change if no gust exists |

### Tactics, Fleet, And View

| Control | Result | Availability / Notes |
| --- | --- | --- |
| `toggleOptimal` | toggled `settings.showOptimal` | hidden for guest and live non-active player |
| `bestStart` | toggled `settings.showBestStart` | hidden for guest and live non-active player |
| `toggleLaylines` | toggled `settings.showLaylines` | host/local only in meaningful states |
| `toggleTrails` | toggled `settings.showTrails` | host/local only in meaningful states |
| `optimalBoatTarget` | target selector appears when optimal overlay is relevant | hidden in many non-owner states |
| `bestStartBoatTarget` | target selector appears when best-start overlay is relevant | hidden in many non-owner states |
| `autoFullscreenMode` | changed `settings.autoFullscreenMode` | underlying setting applied |
| `toggleFullscreen` | headless click timed out; no product claim made | requires real browser / OS fullscreen surface |

### Editor Modes

| Control | Result | Availability / Notes |
| --- | --- | --- |
| `modePlay` | returns to play view | visible in editor-capable states |
| `modeMarks` | changes editor meta mode and hint text | visible in editor-capable states |
| `modeStart` | changes editor meta mode and hint text | visible in editor-capable states |
| `modeFinish` | intentionally hidden while `finishSeparate=no` | becomes relevant only for separate finish line |
| `modeBoats` | changes editor meta mode and hint text | visible in editor-capable states |
| `modeModel` | changes editor meta mode and hint text | visible in editor-capable states |
| `resumeFromModel` | remained hidden in tested paths | model-resume path not exposed in normal solo flow |

## Disabled / Hidden Matrix By Phase

| Phase | Room controls | Setup controls | Tactical overlays | Board action | Special notes |
| --- | --- | --- | --- | --- | --- |
| `solo_idle` | hidden | editable | visible | hidden/disabled | `realtimePrepSeconds` hidden in turns |
| `local_editor` | hidden | editable | visible | hidden/disabled | editor hints active |
| `local_active_race` | hidden | editable | visible | hidden/disabled | normal local race |
| `pending_network_draft` | `Открыть комнату` and `Отменить` visible; `Копировать` disabled | editable | visible | hidden/disabled | draft exists, room does not |
| `network_lobby_host` | role locked, leave/copy enabled, start disabled until full | editable | visible | visible but disabled | host can still tune course/weather |
| `network_lobby_guest` | leave/copy enabled, start disabled | mostly disabled | hidden | hidden | guest cannot edit setup |
| `network_lobby_observer` | role locked to observer, leave/copy enabled, start disabled | editable | visible | visible but disabled | observer-host still edits lobby |
| `live_network_active_player` | hidden | core setup disabled; `movesPerTurn` still editable | visible | visible and enabled as restart action | active player has no interaction lock |
| `live_network_non_active_player` | hidden | disabled | hidden | hidden/disabled | interaction lock visible |
| `finished_editable_host` | hidden | mostly disabled | visible | unstable | see finding below |

## Multiplayer Behavior

- Room creation, join-by-code, host reload, guest join, and start transition worked on both targets.
- Host-only edits were enforced correctly in lobby and live play.
- Guest lock behavior was consistent:
  - cannot edit boat count, marks, play mode, prestart, movement tuning, weather
  - can copy room code and leave lobby
- Observer-host behavior is distinct:
  - role is locked to observer once room exists
  - host can still edit setup before the race starts
- Live sync via Socket.IO worked:
  - host and guest saw room phase changes
  - active vs non-active player permissions diverged correctly
  - join-by-code and room code copy were functional

## Local vs Remote Differences

- Confirmed intended differences:
  - remote uses Redis-backed session and room state
  - local test server uses filesystem session and in-process room state
- No meaningful gameplay or UI drift was found between local and remote in the tested paths.
- The same control matrix and lobby/live permission rules were observed on both targets.

## Static Inventory Findings

`static/game_shell.js` still references the following ids that are not present in the current template:

- `dockPauseRace`
- `mapRecordName`
- `menuDeckCourse`
- `menuDeckFleet`
- `menuDeckRoom`
- `menuDeckRules`
- `menuDeckWeather`
- `menuFlowBadge`
- `menuOpenMaps`
- `menuSettingsSummary`
- `raceRecordName`
- `saveCurrentMap`
- `saveCurrentRace`

`static/multiplayer.js` had no missing template ids in the same static comparison.

## Findings And Oddities

### 1. Home Library Summary Counts Are Wrong On Initial Load

- Fresh reload of the remote home screen showed:
  - `Карты на сервере: 0`
  - `Сохраненных гонок: 0`
- At the same time the API reported:
  - three standard maps via `GET /api/library/maps`
  - race counts changed correctly before cleanup
- The summary can refresh to a different value after navigating inside the menu, so this looks like a stale or delayed summary computation rather than real storage loss.

### 2. Finished-Room Action Is Unstable Under Forced Finished-State Capture

- In the forced finished-room audit path, the host action can alternate between:
  - `Начать гонку заново`
  - `Редактировать карту`
- The corresponding meta phase also flipped between `race` and `finished` across repeated timed captures on both targets, with remote showing the drift more often.
- This was reproduced only through a forced state import, not by organically sailing a room to completion, so treat this as a lower-confidence inconsistency candidate rather than a proven player-facing regression.

### 3. Stale DOM Bindings Still Exist In `game_shell.js`

- Thirteen ids are still queried even though the template no longer contains them.
- No hard crash surfaced in the audited paths, but this is a maintenance and regression risk, especially around menu/library actions.

### 4. Two Controls Are Precondition-Sensitive Rather Than Broken

- `applyGrid` does nothing unless `gridCols` / `gridRows` are changed first.
- `clearGust` does nothing unless a gust is currently present.
- Raw one-click automation can therefore look like a no-op, but targeted retests confirmed both behaviors work when prerequisites are met.

### 5. Fullscreen Was Not Verifiable In Headless Mode

- The fullscreen button exists and is enabled in the UI.
- Headless Playwright cannot reliably assert browser/OS fullscreen transitions here, so no pass/fail claim should be made for actual fullscreen behavior without a headed run.

## Limitations

- No fully organic race-to-finish multiplayer session was played out turn by turn; the finished-room inspection relied on forced state transitions to expose UI behavior.
- Fullscreen needs a real headed browser session to validate properly.
- The raw results include more state detail than this report; use the JSON for exact control snapshots and screenshots.

## Final Remote Hygiene State

After cleanup verification:

- `GET /api/library/maps` on remote returned only standard maps:
  - `std-training-bay`
  - `std-cutter-spiral`
  - `std-storm-gate`
- `GET /api/library/races` on remote returned an empty list.

## Artifact Index

- Report: `audits/2026-03-20-regatta-behavior-audit.md`
- Raw results: `output/behavior-audit-2026-03-20/results.json`
- Runner: `output/behavior-audit-2026-03-20/behavior_audit.py`
- Screenshot set: `output/behavior-audit-2026-03-20/screenshots/`
