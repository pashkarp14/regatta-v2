# Regatta Gameplay Bundle Guide

`static/regatta.js` is the browser bundle. The source of truth is `static/regatta_src/sections/`.

## Workflow

Edit the smallest relevant section file first, then rebuild the bundle:

```powershell
.venv\Scripts\python tools\sync_regatta_sections.py build
.venv\Scripts\python tools\sync_regatta_sections.py verify
```

Useful commands:

```powershell
.venv\Scripts\python tools\sync_regatta_sections.py split
.venv\Scripts\python tools\sync_regatta_sections.py build
.venv\Scripts\python tools\sync_regatta_sections.py verify
```

Do not reorder sections unless you also update `tools/sync_regatta_sections.py`.

## Section map

- `00_bootstrap_dom.js`: DOM bootstrap and early references
- `01_world_and_camera.js`: world size, camera, transforms, geometry helpers
- `02_wind_and_runtime_settings.js`: wind, runtime settings, bot difficulty
- `03_game_objects_and_boat_state.js`: core game objects and boat state
- `04_geometry_intersections.js`: geometry and intersection math
- `05_rounding_rules.js`: mark-rounding runtime rules
- `06_collision_rules.js`: boat and mark collision checks
- `07_tack_penalty_rules.js`: tack logic, penalties, movement factors
- `08_start_line_and_move_helpers.js`: start-line geometry and ray movement helpers
- `09_progress_and_bot_ai.js`: race progress, bots, realtime steering, local loops
- `10_spawn_and_reset_placement.js`: spawn placement and reset helpers
- `11_optimal_route_planner.js`: A* route planner and path helpers
- `12_ui_status_and_stats.js`: status text, HUD summaries, stats
- `13_reset_import_export.js`: reset flow, import/export, snapshots, room sync helpers
- `14_rendering.js`: canvas rendering
- `15_canvas_input.js`: canvas interaction and realtime pointer input
- `16_ui_events.js`: DOM event wiring
- `17_init_and_bootstrap_end.js`: init routine and `window.RegattaApp` exposure

## Editing advice

- Prefer a single-section change when possible
- If a change spans gameplay state and UI text, expect to touch at least one runtime section plus one UI/status section
- Search for existing custom events before introducing a new one
- Keep the public `window.RegattaApp` API stable unless the task explicitly changes its contract

## Common hotspots

- Realtime behavior: `02`, `07`, `09`, `15`
- Import/export and room sync helpers: `13`
- Rendering-only changes: `14`
- Menu-triggered behavior exposed to other scripts: `12`, `13`, `17`
