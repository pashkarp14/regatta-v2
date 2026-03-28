# Regatta Load Testing Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible Regatta load-testing runner that targets a remote stand, captures runtime `/metrics`, and produces `summary.json` plus `report.md`.

**Architecture:** Keep the existing `tools/load` package as the shared implementation surface, expand it to support baseline snapshot discovery, remote environment capture, scenario execution, metrics inventory, and offline report generation. Add thin CLIs for running a scenario and aggregating an output directory so the runner remains scriptable and testable.

**Tech Stack:** Python, asyncio, httpx, python-socketio client, JSONL artifacts, Prometheus text parsing.

---

### Task 1: Lock the contract with tests

**Files:**
- Modify: `tests/test_load_runner.py`
- Modify: `tests/test_load_smoke.py`

- [ ] **Step 1: Write failing tests for the required artifacts**
- [ ] **Step 2: Run the focused tests and verify they fail for the expected reasons**
- [ ] **Step 3: Add minimal assertions for JSONL artifacts, metrics inventory, and baseline reshaping**
- [ ] **Step 4: Re-run the focused tests and confirm the failures are now implementation gaps, not test bugs**

### Task 2: Expand the load runner core

**Files:**
- Modify: `tools/load/run.py`
- Create: `tools/load/scenarios.py`
- Create: `tools/load/run_load.py`
- Create: `tools/load/requirements.txt`

- [ ] **Step 1: Add baseline snapshot loading with remote library lookup and local fallback**
- [ ] **Step 2: Add richer recorder outputs (`requests.jsonl`, `socket_events.jsonl`, `room_revisions.jsonl`, environment capture)**
- [ ] **Step 3: Add scenario helpers for smoke, join storm, live race, and mixed chaos**
- [ ] **Step 4: Add CLI wiring for remote smoke checks, metrics inventory, scenario execution, and final metrics capture**
- [ ] **Step 5: Run the focused tests and make them pass**

### Task 3: Build offline aggregation and reporting

**Files:**
- Create: `tools/load/report_load.py`
- Modify: `tools/load/__init__.py`

- [ ] **Step 1: Parse raw Prometheus text into counters and histograms**
- [ ] **Step 2: Aggregate runner JSONL logs plus `/metrics` deltas into `summary.json`**
- [ ] **Step 3: Render a concise `report.md` that separates `/metrics` findings from runner findings**
- [ ] **Step 4: Add or update tests for report generation**

### Task 4: Verify locally and against the remote stand

**Files:**
- No code changes expected

- [ ] **Step 1: Run the focused unit tests for `tools/load`**
- [ ] **Step 2: Run the existing load smoke test locally**
- [ ] **Step 3: Execute the remote scenario sequence until a stop condition or a stable low-level run**
- [ ] **Step 4: Regenerate `summary.json` and `report.md` from the collected output**
