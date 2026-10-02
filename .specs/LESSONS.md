# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Plan/Checks)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Allocate each claim clause that depends on a later command to a check in the slice that builds that command, instead of proving it through a stand-in reader
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks-allocation` · harmful: 0
- features: jev-translation-feasibility
- evidence: C36/C39/C40 PARTIAL - tests/ai-study/s4-limits.test.mjs:455; src/ai-study/run-reader.mjs:23 (checks-allocation)
- last seen: 2026-10-01T20:31:05Z

### L-002 - State where an exit code is observed when the published boundary is a make target, since make itself exits 2 on any recipe failure
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `cli-boundary` · harmful: 0
- features: jev-translation-feasibility
- evidence: C34 - tests/ai-study/s4-limits.test.mjs:605-606; tests/ai-study/helpers.mjs:148-152 (cli-boundary)
- last seen: 2026-10-01T20:31:05Z

### L-003 - Add or amend a check in the same change that amends an acceptance criterion in the plan
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks-allocation` · harmful: 0
- features: jev-translation-feasibility
- evidence: plan.md AC 27 amendment (local_token_count) - no check row; C31 (checks-allocation)
- last seen: 2026-10-01T20:31:05Z

### L-004 - When a claim covers any member of a set in sequence, such as a first and second signal, prove the mixed pairs too, not only the same member repeated
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `signals` · harmful: 0
- features: jev-translation-feasibility
- evidence: C55 FAIL - src/ai-study/cli.mjs:61; tests/ai-study/s4-limits.test.mjs:917-925 (signals)
- last seen: 2026-10-01T20:59:56Z

### L-005 - Assign every check an amendment adds to a slice that builds its proof before the feature's last slice closes
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks-allocation` · harmful: 0
- features: jev-translation-feasibility
- evidence: C59 - no evidence; checks.md:199; src/ai-study/lmstudio.mjs:42-44 (checks-allocation)
- last seen: 2026-10-02T10:03:55Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
