# ADR-0015 — Pages is not deployed while the repo is private

- **Status**: accepted
- **Date**: 2026-08-08
- **Extends**: NORTH-STAR §7 (*"an atlas for a **public** repo can be shared, embedded in docs, or
  published"*) and §10's `Deploy: Static` row. Neither is contradicted — publishing stays allowed
  and stays the intended end state. It is not *done*, and this records why.

---

## Context

`.github/workflows/pages.yml` built the player against Ark's own atlas and deployed it to GitHub
Pages on every push to `master`. It never once succeeded.

Both runs it ever had failed at the same step, `actions/configure-pages@v5`:

```
##[error]Get Pages site failed. Please verify that the repository has Pages
enabled and configured to build using GitHub Actions ... Error: Not Found
```

- run #1, on `626513c` (master before M4 landed) — failed
- run #2, on `a50462b` (master after M4 landed) — failed, identically

The build half worked. The step before the failure printed
`publishing ark @ a50462bcbc4a / 113 nodes, 328 edges, 80 challenges`, so the zero-challenge guard
passed and a valid site was produced. What failed is the deploy, for a reason that has nothing to do
with the code: **`deephanson94/ark` is private**, Pages on a private repository needs a paid plan,
and the workflow passed `enablement: false`, so it would not turn Pages on even where it could.

The premise was wrong from the first commit, and it was written down. The workflow's own header said
*"it is a public repo, so its atlas may be shared (§7)"* — a load-bearing claim about the repository,
asserted in a comment, never checked against the repository. Worth noting because it is the cheapest
class of error to avoid and the hardest to see once written: a comment that states a fact is not
evidence of it.

## The cost, which is not the missing demo

A demo nobody can reach costs nothing. A check that has **never been green** costs something
specific: it teaches every future session that a red X on this repo is background noise.

That is not hypothetical. In the session that shipped M4 the agent reported "CI green" three separate
times while only ever looking at `ci.yml` runs on the feature branch, and never at `pages.yml` on
master. The human found it, not the agent. The reason the mistake was easy to make is that the red
check had already been normalised — which is the same failure shape as CLAUDE.md's *"an instrument
that measures nothing looks exactly like good news"*, read the other way round: an instrument that
always reads red stops being read.

CLAUDE.md guardrail 7 is *never leave the build broken*. A permanently failing workflow is a broken
build that everyone has agreed to ignore, which is worse than a broken build.

---

## Decision

**`pages.yml` is deleted.** Publishing returns the day the repo is public, or the day someone
deliberately enables Pages and wants the demo — as a new workflow, restored from git:

```bash
git show a50462b:.github/workflows/pages.yml > .github/workflows/pages.yml
```

**Its zero-challenge guard was not migrated, because it is already held twice over and both times
more strongly.** This is stated explicitly so a session reading "we kept the guard" does not go
looking for new YAML that does not exist:

- `tests/atlas/atlas.test.ts` asserts `atlas.challenges.length > 20` against a freshly built atlas.
  Strictly stronger than *"not zero"*, and it runs on every push, every PR, and locally.
- `scripts/e2e.ts` carries the identical `challenges.length === 0` refusal — and then builds the real
  player bundle, serves it, clicks a node, answers its question and reads back a grade. It proves the
  deck is *playable*, not merely non-empty.

Deleting the workflow therefore removes no coverage. That was checked before it was deleted rather
than assumed, because "the other suite probably covers it" is how coverage disappears.

---

## Alternatives rejected

**Enable Pages and keep the workflow.** The right answer *later*, and the reason this ADR is not
"publishing was a bad idea". Rejected now because it means paying for Pages on a private repo, or
making the repo public before its owner intends to, in exchange for a demo with no audience. The
trade flips completely at launch; revisit it then, not before.

**Disable the workflow in place** — `if: false`, or dropping the `on: push` trigger. Keeps the file
as documentation of intent. Rejected because a workflow that never runs is a workflow nobody reads:
it would rot silently against `actions/*` version bumps, against the `dist/player` output path, and
against whatever `npm run build` becomes. Git already stores it better than a disabled file does, and
the restore is one line, above.

**Make the failure non-fatal** — `continue-on-error: true` on the configure step. The worst of the
three, and worth naming so nobody proposes it as the cheap fix: it converts a check that is honestly
red into one that is green while deploying nothing. That is the landmine CLAUDE.md already records
about `npm run raster` — a measurement with no gate proving the thing happened — reproduced
deliberately.

## Consequences

- Every check on this repo is green, and a red one means something again. That is the whole point.
- There is no live URL for the player. NORTH-STAR §7's publishing sentence stays *allowed* and
  becomes *unexercised*; nothing about the atlas, the player or the build changes, because the player
  was already a static bundle deployable by any means.
- `npm run build` still produces exactly what was being deployed (`dist/player/`), so anyone can host
  it from a local checkout with no workflow at all.
- The decision has one clean trigger for reversal — the repo going public — and this file is where
  the next session finds that out instead of assuming the missing workflow is an oversight.
