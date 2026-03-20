# Regatta Behavior Audit Artifacts

This directory contains the full 2026-03-20 behavior-audit package:

- `../2026-03-20-regatta-behavior-audit.md` - human-readable report
- `behavior_audit.py` - replayable audit runner
- `results.json` - raw structured output from the completed audit
- `screenshots/` - captured UI evidence
- `runtime/` - local temporary server logs from the audit run

## What The Runner Does

`behavior_audit.py` runs the full audit against two targets:

- a clean local app instance started from this repo on an isolated temporary library directory
- the remote staging target at `http://158.160.217.19:5001/`

The runner covers:

- menu navigation
- local launch flows
- library save/load/delete flows
- settings application checks
- multiplayer host/guest/observer states
- screenshot collection
- JSON result export

## Prerequisites

Run from the repo root:

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m playwright install chromium
```

If the repo already has a working virtualenv, only the Playwright browser install may be needed.

## How To Re-Run The Audit

From the repo root:

```powershell
.venv\Scripts\python audits\2026-03-20-artifacts\behavior_audit.py
```

The script will:

- start a temporary local server on a free port
- write new artifacts back into this same directory
- hit the remote staging server as part of the audit
- create and delete temporary library records during remote verification

## Outputs

After a run, the script refreshes:

- `audits/2026-03-20-artifacts/results.json`
- `audits/2026-03-20-artifacts/screenshots/`
- `audits/2026-03-20-artifacts/runtime/`

## Notes

- The runner is intentionally opinionated and hard-codes the audit date prefix `AUDIT-2026-03-20`.
- It is meant for reproducing the audited behavior, not as a polished permanent test framework.
- The fullscreen check is limited in headless mode and should not be treated as a reliable browser fullscreen assertion.
