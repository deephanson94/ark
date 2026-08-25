# ADR-0052 — A candidate row may carry what its own verb's gate already prices

**Status**: accepted
**Date**: 2026-08-25
**Supersedes**: nothing. **Amends**: `COMMIT_HEURISTICS` (ADR-0018 §4).

---

## 1. The report

Three round-7 cold testers described Placement as word-matching rather than
reasoning. One scored **0%** and wrote:

> *"It shows me a commit message and twenty file paths. I had no basis for that
> at all — I picked the ones whose names looked like the message and that is
> the entire thought I had."*

That is pillar 3's own sentence turned around: the complaint is not that the
board is *too easy* to Ctrl+F, it is that Ctrl+F is the **only** move available.

## 2. The structural cause, which is in the code rather than in the wording

`Verb.channel` says what the map may draw about an open board:

| Verb | channel | what the map says while its board is open |
|---|---|---|
| `blastRadius` | `importRadius` | draws the subject's direct ring |
| `companion` | `coChangeTies` | **nothing** — ADR-0016 gates the wires off for exactly this board |
| `placement` | `nothing` | nothing |
| `archaeology` | `nothing` | nothing |

So on three verbs of four the map is scenery while the question is up. For
Companion that is a deliberate, argued refusal (drawing the tie *is* the key).
For Placement it is not a refusal at all — nobody ever decided it.

Meanwhile `gate.ts` scores Placement against `churn` (the most-edited
candidates) and `recency` (candidates whose `lastSeen` is the commit's own
date). **Every shipped Placement board is therefore already proof against a
player who can read those two numbers** — and the player cannot read them. They
live in the inspector, and an open board redirects the map's hover to row
highlighting, so no candidate can be inspected while the question is up.

The precedent is one line of `challenge.ts`, which shows every commit row's date
*"whatever the order, so the 'tick the oldest K' guess exists either way and
`oldestK` scores and refuses it"*, and `keyRule`, which states the key size out
loud because *"the gate already hands every heuristic `truth.length`"*. **Show
the fact; let the gate refuse the boards the guess beats.**

## 3. Decision 1 — a verb may annotate its own candidate rows

`Verb.candidateNote?(id, words)` is optional and **per verb**, and Placement is
the only implementer. A row renders `12 commits · last 2026-08-21` beside the
path.

It is on the verb rather than in the console for the reason ADR-0027 gives about
prompts: a console that decided this for itself would be choosing what a verb
gives away. `Words.history(id)` supplies the fact; the verb writes the string.

Blast Radius's gate is `directory`, `name`, `partition` — it prices neither
column — so the same annotation there would open a channel nothing refuses. The
absence is asserted, not assumed (`scripts/e2e.ts`, `tests/unit/placement.test.ts`).

## 4. Decision 2 — the conjunction is a heuristic, because scoring the two alone does not bound it

**This is the part that measurement changed.**

`churn` and `recency` were scored, each alone. The conjunction is *not*
dominated by either: a date filter returning more rows than the key needs can be
truncated by churn, which raises precision without costing recall. That guess
was priced-and-unavailable for as long as both numbers were unreadable. Making
them readable is what required pricing it.

Measured before shipping either half (`scripts/probe-cold.ts`, `beats A` column):

| repo | Placement boards | churn alone | dates alone | both | beats A | best |
|---|---|---|---|---|---|---|
| ark | 40 | 0.275 | 0.280 | 0.282 | **0** | 0.750 |
| hono | 54 | 0.043 | 0.184 | 0.172 | **0** | 0.667 |
| kysely | 75 | 0.073 | 0.097 | 0.154 | **0** | 0.667 |
| graphql-js | 69 | 0.118 | 0.062 | 0.159 | **0** | 0.667 |
| django | 273 | 0.037 | 0.258 | 0.271 | **2** | **1.000** |
| svelte | 235 | 0.016 | 0.404 | 0.394 | **2** | **1.000** |

Four repos said the channel was free. The fifth and sixth said it hands out an
**exact answer key**. This repo's rule about measuring on a second repo has now
been paid for a fourth time, and the four that read zero include ark — the one a
session looks at hardest.

`datedChurn` therefore joins `COMMIT_HEURISTICS`.

### 4.1 It has two readings and each is the only one that fires somewhere

- *of those dated right, the busiest k* — django's two boards, at 1.000.
- *of the busiest k, those dated right* — svelte has one, at 0.800.

The second returns **fewer** than k picks and is more precise for it, so it is
not reachable from the first. Scoring one and calling the class covered is this
repo's landmine about a conjunction whose second clause nobody enforced; both
are scored and the better is taken, on the same argument `partition` makes for
taking the best of its tied groups — *being generous to the adversary refuses a
board a player might have got wrong, which costs one question; being stingy
ships one they can win without reasoning, which costs the pillar.*

The comparison uses `scoreSet` rather than a hit count, and that is not a
nicety: the second reading is a **subset** of the first, so on equal hits it is
strictly smaller and therefore strictly more precise. A hit count would call
that a tie and hand back the weaker set.

### 4.2 What it costs

`beats A` is **0 on all six repos** afterwards, best 0.750 against the 0.78 bar.

Deck sizes are unchanged on ark (40), hono (54), kysely (75) and graphql-js
(69) — those repos are cap-limited, so a refused subject is replaced. django
goes 273 → **272** and svelte 235 → **234**: one board each.

## 5. What this does not claim

**It does not claim the board is now about structure.** Reading both columns and
nothing else reaches a bare pass (0.5) on **28% of ark's boards, 24% of hono's,
39% of django's and 56% of svelte's**. That is a grade-C floor bought with no
reasoning about coupling at all, and it is stated here rather than buried,
because the honest comparison is against **zero** — which is what the same
player scored yesterday, with no basis for anything.

The gate's bar is band A and not the pass mark, deliberately (ADR-0010: *"the
files in this folder are coupled" is cheap but true, so scraping a C off it is
an easy question, not a broken one*). This decision is inside that rule, not an
exception to it. If the owner wants the floor lower, the lever is the bar, and
moving it is an owner-level change to what every verb refuses.

**It does not address Archaeology**, whose rows are commits and which reported
the same complaint. Its candidates already print a date and a message; what they
lack is any structural fact at all. The obvious one — the commit's **diff
width** — is measured here rather than left to the next session to assume:

| repo | Archaeology boards | widest-k mean | reaches pass | beats A | best |
|---|---|---|---|---|---|
| ark | 40 | 0.255 | 30% | **1** | 1.000 |
| hono | 54 | 0.218 | 20% | **2** | 1.000 |
| kysely | 75 | 0.272 | 29% | **2** | 1.000 |
| graphql-js | 69 | 0.193 | 17% | 0 | 0.750 |
| django | 83 | 0.222 | 31% | **2** | 1.000 |
| svelte | 71 | 0.233 | 34% | **1** | 1.000 |

So it is **not free**, and it needs a gate heuristic first exactly as this
decision's column did. Two differences worth carrying forward. This guess beats
a board on **ark**, so unlike `datedChurn` the bootstrap repo would have caught
it. And `broadKnown` does **not** already cover it: that heuristic filters to
commits an earlier reveal has priced (`subject.widthKnown`), and the guess a
printed column enables is unfiltered — a heuristic whose name suggests it covers
a class, covering a subset of it, which is this repo's oldest recurring shape.

## 6. How it is checked

- `tests/unit/gate.test.ts` — two fixtures, one per reading, each built so that
  neither `churn` nor `recency` **alone** can reach the bar, so a pass cannot
  come from the wrong heuristic firing. Mutation-tested: deleting the second
  reading kills exactly the second test; removing `datedChurn` from the set
  kills all three.
- `tests/atlas/atlas.test.ts` — the same guess re-derived against the **real**
  deck, with a plant (*some board must offer a date-matched candidate*) so a
  clean zero cannot mean the check never ran. It is a canary rather than a test:
  ark ships no board it would catch even with the gate removed, which is exactly
  why the unit fixtures exist.
- `scripts/e2e.ts` — every Placement row carries a note, no other verb's row
  does, asserted on the one step guaranteed to serve a Placement board rather
  than on the step whose verb moves with the deck.
