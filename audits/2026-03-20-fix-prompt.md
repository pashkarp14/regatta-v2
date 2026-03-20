# Strict Fix Prompt For Audit Findings

```text
You are fixing concrete product issues discovered by the 2026-03-20 Regatta behavior audit.

Repository:
- C:\Users\pavel\OneDrive\Рабочий стол\Codex\Regatta

Required reading before touching code:
- C:\Users\pavel\OneDrive\Рабочий стол\Codex\Regatta\audits\2026-03-20-regatta-behavior-audit.md
- C:\Users\pavel\OneDrive\Рабочий стол\Codex\Regatta\audits\2026-03-20-artifacts\README.md
- C:\Users\pavel\OneDrive\Рабочий стол\Codex\Regatta\audits\2026-03-20-artifacts\results.json

Primary files to inspect first:
- C:\Users\pavel\OneDrive\Рабочий стол\Codex\Regatta\static\game_shell.js
- C:\Users\pavel\OneDrive\Рабочий стол\Codex\Regatta\static\multiplayer.js
- C:\Users\pavel\OneDrive\Рабочий стол\Codex\Regatta\templates\index.html
- If needed: C:\Users\pavel\OneDrive\Рабочий стол\Codex\Regatta\regatta_app\

Mission:
Fix the narrow, high-value issues found in the audit. Do not refactor broadly. Do not paper over symptoms. Reproduce first, then fix root causes, then verify with evidence.

Non-negotiable workflow:
1. Reproduce each target issue locally.
2. Explain the root cause in code terms.
3. Implement the smallest safe fix.
4. Add or update automated verification where it meaningfully protects the fix.
5. Re-run the relevant checks and report exact results.
6. Do not claim success without verification output.

Issues to fix, in priority order:

1. Home-screen library summary shows incorrect counts on first load.
Current bad behavior:
- `Карты на сервере: 0`
- `Сохраненных гонок: 0`
even when the library API already returns real records.

Success criteria:
- summary counts are correct immediately on first render
- summary stays correct after navigating between menu screens
- summary stays correct after save/delete/load actions for maps and races
- no stale counts survive a completed library refresh

2. `static/game_shell.js` contains bindings to DOM ids that do not exist in the template.
Audit list:
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

For each id, you must decide one of only two valid outcomes:
- delete dead code if the control is obsolete
- restore the missing DOM contract if the control is still part of the current product

Invalid outcome:
- leaving the mismatch in place without explanation

Success criteria:
- current UI contracts are internally consistent
- dead references are removed or justified by actual runtime creation
- no menu/library/deck flows regress

3. Finished-room host action is unstable.
Observed audit behavior:
- host action can flip between `Начать гонку заново` and `Редактировать карту`
- phase can drift between `race` and `finished`

Your job:
- determine whether this is a real state-management bug, UI derivation bug, or forced-state edge case
- make the behavior deterministic for the same underlying room/game state

Success criteria:
- identical room state always yields identical board action text and action target
- no silent bounce between `race` and `finished` for the same loaded snapshot
- if the issue only exists in forced-state testing, encode that clearly and harden the code path or guard it

Constraints:
- do not edit `static/vendor/`
- do not do a broad rewrite
- do not revert unrelated user changes
- keep patches small and explainable
- preserve existing UX copy unless the bug fix truly requires copy changes

Verification requirements:
- run targeted checks for every fixed issue
- run at least the relevant portions of the audit runner or equivalent reproduction steps
- if you add tests, they must fail before the fix and pass after it
- if something cannot be verified automatically, say exactly why

Expected final output:
1. Short summary of each root cause
2. Files changed
3. Tests or verification steps added
4. Exact verification results
5. Remaining risks or non-goals

Do not stop after analysis. Carry the work through reproduction, implementation, verification, and final summary.
```
