# Regatta Source Sections

`static/regatta.js` stays as the runtime bundle the browser loads.

To make the game logic easier to navigate, the source now lives in
`static/regatta_src/sections/` as ordered fragments of that bundle.

Use:

```powershell
.venv\Scripts\python.exe tools\sync_regatta_sections.py split
.venv\Scripts\python.exe tools\sync_regatta_sections.py build
.venv\Scripts\python.exe tools\sync_regatta_sections.py verify
```

Recommended workflow:

1. Edit the files in `static/regatta_src/sections/`.
2. Rebuild `static/regatta.js`.
3. Run the existing browser checks.

The current split keeps runtime behavior unchanged while reducing the amount of code that has to fit into context for one task.
