# Template Guide

Use this file for work inside `templates/`.

## What this directory does

- `index.html` is the single-page shell for the whole app
- The page contains:
  - hero/header chrome
  - command deck sidebar
  - board/canvas stage
  - fullscreen and start actions
  - main menu overlay and menu screens

## DOM contracts that matter

- The frontend relies on exact ids from this template
- Common high-coupling groups:
  - room and roster controls
  - setup controls in the command deck
  - board controls and canvas
  - menu screen buttons and screen containers
- `data-room-lock="setup"` is used by browser code to lock setup controls while a room is active
- `data-menu-screen` and `data-menu-nav` drive menu screen switching in `static/game_shell.js`

## Script order

The current order at the bottom of the page is important:

1. `static/vendor/socket.io.min.js`
2. `static/regatta.js`
3. `static/multiplayer.js`
4. `static/game_shell.js`

If you change script order, re-check all startup flows.

## Safe editing rules

- If you rename an id, search for it in:
  - `static/regatta.js`
  - `static/multiplayer.js`
  - `static/game_shell.js`
- Keep canvas-related ids stable unless the task is specifically about board bootstrapping
- Prefer structural HTML changes here and keep behavior changes in JS files

## Quick checks after template changes

- page boot completes without JS errors
- command deck still opens and closes
- menu overlay still navigates between screens
- room controls still render and update correctly
