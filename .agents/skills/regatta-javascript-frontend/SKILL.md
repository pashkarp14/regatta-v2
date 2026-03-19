---
name: "regatta-javascript-frontend"
description: "Use when editing Regatta browser code in static/*.js, static/regatta_src/sections/*.js, static/regatta.css, or templates/index.html. Use it to choose the correct source-of-truth file, preserve DOM and custom-event contracts, and keep gameplay, menu, and multiplayer JavaScript changes clean."
---

# Regatta JavaScript Frontend

Use this skill for browser-facing work in `static/` and `templates/`.

## First context

1. Read `AGENTS.md`.
2. Read `static/AGENTS.md`.
3. If the task touches gameplay runtime, also read `static/regatta_src/AGENTS.md`.
4. If the task touches markup or ids, also read `templates/AGENTS.md`.

## Pick the right source of truth

- gameplay, rendering, physics, AI, runtime state: `static/regatta_src/sections/*.js`
- generated gameplay bundle: `static/regatta.js`
- room syncing, REST calls, Socket.IO bridge: `static/multiplayer.js`
- main menu, launch flow, command deck orchestration: `static/game_shell.js`
- DOM structure and ids: `templates/index.html`
- shared styling: `static/regatta.css`

Do not edit `static/regatta.js` directly when the real source is `static/regatta_src/sections/*.js`.

## Frontend rules for this repo

- Preserve the script load order from the template:
  - `socket.io.min.js`
  - `regatta.js`
  - `multiplayer.js`
  - `game_shell.js`
- Preserve the public globals unless the task explicitly changes them:
  - `window.RegattaApp`
  - `window.RegattaMultiplayer`
- Reuse existing browser events before inventing new ones:
  - `regatta:state-changed`
  - `regatta:realtime-intent`
  - `regatta:view-settings-changed`
  - `regatta:room-state`
  - `regatta:room-draft`
- Treat DOM ids and `data-*` attributes as contracts. If one changes, search all JS files for the same identifier before finishing.
- Keep the current plain-JS architecture. Do not introduce bundlers, frameworks, modules, or new runtime dependencies.

## JavaScript code quality expectations

- Prefer small named helpers over large inline event handlers.
- Keep DOM lookup patterns consistent with the existing codebase.
- Keep cross-file APIs explicit:
  - expose new behavior via the existing `window.RegattaApp` or `window.RegattaMultiplayer` surfaces only when needed
  - avoid hidden coupling through ad hoc globals
- Keep async behavior narrow and intentional. Do not add async layers where a synchronous helper is enough.
- When changing user-visible state, update the matching status or hint text if the UI would otherwise become misleading.
- Preserve the project's current style instead of rewriting code into a different paradigm.

## Bundle workflow

If you edit any file in `static/regatta_src/sections/`:

```powershell
.venv\Scripts\python tools\sync_regatta_sections.py build
.venv\Scripts\python tools\sync_regatta_sections.py verify
```

If build and source disagree, fix the sections rather than hand-editing the bundle.

## Cross-file coordination

Check these combinations before finishing:

- `templates/index.html` + one or more JS files when ids, buttons, screens, or controls change
- `static/multiplayer.js` + `regatta_app/` when room payloads or socket semantics change
- `static/game_shell.js` + `static/multiplayer.js` when launch or room flows change
- `static/regatta_src/sections/*.js` + `static/game_shell.js` or `static/multiplayer.js` when exported app behavior changes

## Verification checklist

- page boots without new console errors
- menu overlay still opens, closes, and navigates
- command deck still works if deck-related files changed
- for room changes: create/join/start/leave still behave correctly
- for gameplay changes: relevant board interaction still works
- if sections changed: rebuild and verify the bundle

## Finish line

Before concluding:

- confirm you edited the true source-of-truth file
- confirm DOM/event/public API coupling was checked
- state clearly whether you rebuilt the gameplay bundle and what UI flow you verified
