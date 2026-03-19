# Regatta Frontend Guide

Use this file for work inside `static/` and for any browser-facing flow.

## File responsibilities

- `regatta.js`
  - main gameplay runtime
  - exports `window.RegattaApp`
  - owns local game state, rendering, realtime local loop, AI, import/export, fullscreen helpers
- `regatta_src/sections/*.js`
  - source of truth for the gameplay bundle
  - rebuild into `regatta.js` after edits
- `multiplayer.js`
  - browser room state
  - REST calls to room/bootstrap endpoints
  - Socket.IO bridge
  - exports `window.RegattaMultiplayer`
- `game_shell.js`
  - main menu flow
  - command deck open/close behavior
  - save/load UI flow
  - orchestration between `RegattaApp` and `RegattaMultiplayer`
- `regatta.css`
  - all main styling for the single-page shell
- `vendor/`
  - vendored assets; do not edit unless the task is explicitly about third-party updates

## Source-of-truth rules

- If the change touches gameplay, physics, AI, rendering, input, or shared runtime state:
  - edit `regatta_src/sections/*.js`
  - rebuild `regatta.js`
  - verify the bundle matches
- If the change touches room state in the browser:
  - start in `multiplayer.js`
  - then check matching backend payloads in `regatta_app/`
- If the change touches menu flow or setup UX:
  - start in `game_shell.js`
  - then check matching ids in `templates/index.html`
- If the change is mostly structure or naming:
  - start in `templates/index.html`
  - search the three JS files for the affected id or data attribute

## Script and event contracts

- Script order from the template matters:
  - `socket.io.min.js`
  - `regatta.js`
  - `multiplayer.js`
  - `game_shell.js`
- `regatta.js` emits browser events:
  - `regatta:state-changed`
  - `regatta:realtime-intent`
  - `regatta:view-settings-changed`
- `multiplayer.js` emits browser events:
  - `regatta:room-state`
  - `regatta:room-draft`
- `multiplayer.js` expects `window.RegattaApp` to exist first
- `game_shell.js` expects both globals:
  - `window.RegattaApp`
  - `window.RegattaMultiplayer`

## DOM coupling to keep in mind

- `templates/index.html` is heavily id-driven; there is very little indirection
- `data-room-lock="setup"` is used by browser logic to disable setup controls while in a room
- `data-menu-screen` and `data-menu-nav` are used by the main menu shell
- Canvas and board controls are wired by exact ids such as `board`, `toggleFullscreen`, `boardStartAction`, and `interactionLock`

## High-risk areas

- Renaming or moving ids without updating JS will break startup because DOM references are taken immediately
- Menu and room UX usually span three files:
  - `templates/index.html`
  - `static/game_shell.js`
  - `static/multiplayer.js`
- Shared view settings span frontend and backend:
  - `regatta.js`
  - `multiplayer.js`
  - `regatta_app/game_state.py`

## Quick checks after frontend changes

- page loads without console errors
- `GET /api/bootstrap` still hydrates the page
- menu opens, closes, and switches screens
- room create/join/start still works if related files changed
- if `regatta_src` changed, run bundle build + verify
