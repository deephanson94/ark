# ADR-0014 — Companion's truth is a gap, not a threshold

- **Date**: 2026-08-07
- **Status**: accepted
- **Supersedes**: nothing. Extends [ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md)'s
  argument to a second verb, and inherits [ADR-0007](./0007-pass-threshold-and-the-three-to-one-choice-set.md)'s
  sizing rule and [ADR-0012](./0012-an-answer-key-is-issued-once.md)'s uniqueness rule unchanged.
- **Context**: M4 — the first verb graded on git rather than on imports.

---

## The question

NORTH-STAR §6.2 words Companion as *"which file changes with this one most
often?"*, ground truth the co-change matrix. The matrix is a bag of integers.
Turning integers into an answer key needs a rule for which candidates are
correct, and that rule has to satisfy guardrail 4: **never generate a challenge
whose ground truth is uncertain.**

Two things make that harder than it looks.

## Problem 1 — absence is not evidence of absence

`atlas.history.coChange` is lossy in three independent ways, all in
`src/indexer/history.ts`:

| | what it drops |
|---|---|
| `minCoChangeCount` (2) | pairs seen fewer times than this |
| `wideCommitFiles` (25) | commits touching more indexed files than this, entirely |
| `maxCoChangePairs` (8,000) | the tail of the matrix, sorted by count descending |
| `maxCommitsWalked` (20,000) | **the older end of history, entirely** — see decision 6 |

So "this pair is not in the matrix" does **not** mean "these files never changed
together". A generator that read absence as zero would offer a genuine companion
as a wrong answer — a wrong answer key, which is the single failure guardrail 4
exists to prevent.

## Problem 2 — a count boundary is the depth bound all over again

The obvious construction is *truth = partners at or above N, distractors =
partners below N*. It reproduces, exactly, the mistake ADR-0008 removed.

There, a depth bound made §8.3's "distance n±1" distractor strategy present real
dependents at hop n+1 as correct exclusions, **marking a player who knows the
codebase wrong**. Here, a candidate whose true count sits one under the bar is
the same trap: the player remembers the two files moving together, picks it, and
is marked wrong over an integer nobody could have known. The bound would not be
protecting anything either — it would exist only because the generator needed
somewhere to cut.

---

## Decision

**1. The answer key is a sample of the subject's companions, ranked by count
descending, and every companion not sampled is kept off the board.**

The invariant is deliberately the same shape as ADR-0008's:

```
candidates ∩ companions(subject) = truth
```

where `companions(subject)` is every partner the matrix records at all. So every
candidate is either in the answer key, or **certified to have co-changed at most
once**. There is no middle band on the board, and therefore no boundary for the
player to guess at: the line they are asked to draw is *coupled* against *never
coupled*.

**2. `evidence.minCount` is measured, not prescribed.**

It is the weakest coupling that actually made the key — the count of the
lowest-ranked truth member. This is ADR-0008 §5's treatment of `importGraph.depth`
applied verbatim: a fact about the question, not a description of the tool, so
the prompt may state it. On this repo the shipped keys rest on 2–3 shared
commits, on `honojs/hono` 2–7, on `sveltejs/svelte` 2–613.

**3. The certification bound is derived from what the atlas can prove.**

```
ceiling = capBit ? count(last kept pair) : minCoChangeCount − 1
floor   = ceiling + 1
```

A companion must clear `floor` to be sampled at all. Two properties hold together
and both are needed:

- **No missing truth.** Every pair at or above `floor` has a count strictly
  greater than `ceiling`, and the matrix is sorted count-descending, so all of
  them survive the cap.
- **No false distractor.** Every pair absent from the matrix has a count at or
  below `ceiling`, hence below `floor`.

This is a *bound*, not a fallback path. It is computed on every repo and used on
every board. Its raised branch — the one where the pair cap actually bit — is
**not exercised by any repo we have measured**: ark, hono and svelte all sit well
under 8,000 pairs. It is tested by constructing the truncation, and this ADR
records that it is unexercised in the field rather than letting a later session
discover it and assume the code is dead. Deleting it would make the verb wrong on
the first repo large enough to trip the cap, which is a different thing from a
retry that never retries.

**4. Contested rename lineage bars a node from every role.**

`applyRenames` resolves a contested historical path arbitrarily — deterministic,
but arbitrary. Until M4 that was harmless: co-change only ranked Blast Radius's
distractors, so a misattributed count cost a slightly worse wrong answer. Grading
against those counts changes the stakes, and "arbitrary" is not a standard
guardrail 4 accepts in an answer key. `AtlasNode.lineage` records it, and
Companion refuses such a node as subject, as answer **and as distractor** —
certifying an exclusion on history we know is misattributed is the same defect.

Measured: 0 contested nodes on this repo, 0 on svelte (18,240 renames, none
contested), **7 on hono**, where two files were renamed to each other's paths and
back so each live file claims the other's history.

**5. The prompt states the rule it is graded under, with numbers.**

The player is told the measured bar (*"in at least 3 separate commits"*), the
wide-commit limit (*"commits touching more than 25 files at once are ignored"*)
and what everything else on the board is certified at (`evidence.atMost` —
*"at most once"*, or higher when the pair cap raised the bound).
An earlier draft said "commits touching a large fraction of the repo", which is
false in both directions: the limit is absolute, so on a small repo it admits a
commit touching a quarter of the files, and on a monorepo it excludes an ordinary
feature landing. `History.wideLimit` exists to carry the real number across the
wall.

**6. A walk that stopped short refuses the whole repo.**

`maxCommitsWalked` is a **fourth** loss channel, and the first draft of this ADR
listed only three. The ceiling below reasons about pairs the *matrix* dropped
and says nothing about commits the *walk* never read: a pair coupled only in
older history is absent for a reason no bound covers, so it would be offered as
a certified exclusion while being a genuine companion.

There is nothing to derive here, so the verb refuses. Recoverable exactly from
the atlas — `commitsWalked` against the `commits` truncation's `kept + dropped`
— and reported as `windowTruncated`. It fires on none of ark (36 commits), hono
(2,758) or svelte (11,285); it would fire on TypeScript. A missing deck costs
nothing and a wrong answer key costs trust permanently.

**A shallow clone is the same channel and had to be added separately.**
`totalCommits` comes from `git rev-list --count HEAD`, which on a `--depth`
clone counts only what is *present* — so `commitsWalked == totalCommits` and the
comparison above sees nothing wrong, while history really is cut at the graft
boundary and a pair coupled beyond it ships as a certified exclusion. This is
not a corner case: `git.ts` records that both large repos an earlier session
measured were `--depth` clones. It needs no new atlas field, because
`repo.root` is already null exactly when the clone is shallow or the root is
unreadable (ADR-0011), so `history.present && repo.root === null` is the
condition — and the unreadable case falls on the refusing side, which is the
direction guardrail 4 wants.

**7. The naive guess this verb is measured against is churn, not adjacency.**

§8.4's `surprise` needs a baseline the map actually gives away. For Blast Radius
that is depth-1 importers, drawn on the canvas by design. For Companion it is the
**commit count in the inspector**, which is printed for every node and leaks no
pair. So `surprise` is measured against *"select the busiest candidates"*, and
`gate.ts` scores the same guess and refuses the board if it earns a band A. Map
giveaway, naive guess and gate heuristic are the same strategy — the three-way
alignment ADR-0008 built for the other verb.

That gate refuses 8 subjects here, 48 on hono and 14 on svelte. It is the
verb's most active guardrail after the deck cap.

---

## Consequences

- **Fewer questions than the supply allows, on purpose.** The strong invariant
  bans every known companion from the board, not just the sampled ones, so a
  hub with eighty partners contributes eighty exclusions it cannot use as
  distractors. Measured: it costs nothing on any repo tried — the deck cap binds
  first (210 subjects capped on hono, 222 on svelte).
- **A `.md` file is a legitimate answer.** Companion's eligibility is every
  language, unlike Blast Radius's `canImport` filter, and that is where the
  measured payoff is: `docs/prior-art.md` §4.2 found the import graph and the
  churn hotspots are nearly disjoint populations. Companion lifts the provable
  share of the map from 78 to 86 nodes here, 156 → 247 on hono and 283 → 776 on
  svelte.
- **`minCount` varies per question**, so two boards about neighbouring files can
  state different bars. That is the honest rendering of uneven history and the
  prompt says which bar applies.
- **Dedupe stays within-verb**, per ADR-0012 and `docs/atlas-format.md` §3.6:
  two verbs may honestly share an answer set because they are asking different
  questions about it.

## Found after shipping, by a second review of the finished code

Three instances of one class, all *"verb-blind state read by verb-specific
code"*, and the third ran in the direction nobody was watching:

1. the map's radius unlock (`depthFor`), caught before writing;
2. the inspector's transitive-count field, caught in an e2e screenshot;
3. **Blast Radius's own reveal**, which said *"changed with the subject in N
   commits, but never imports it"* about a distractor that `coChangeStrategy`
   had picked from the matrix ranked count-descending — i.e. the strongest
   member of Companion's answer key for the same subject, handed over with its
   count, while that question was still open. The sentence is gone; Companion
   asks about that coupling directly now, which teaches it better.

Plus `onGraded`, which drew the full import cone after *any* grade rather than
through `depthFor`. The rule is one line and it now lives in one place.

**The lesson worth carrying**: two of the three were found by a reviewer reading
for this specific class, and one only by looking at a screenshot. Neither the
type system nor the test suite could see any of them, because every one is a
true statement rendered to a player who had not earned it.

## What this does not decide

- **What a Companion pass unlocks on the map.** Today it lifts fog on the subject
  and the members proved, and draws no co-change link. That is honest but thin,
  and it is the open question this verb leaves behind.
- **Whether the `wide` definition is right.** 25 files is absolute where the
  thing it approximates ("a commit so broad it couples everything") is relative.
  It is inherited from M0 and unexamined; changing it moves every count in the
  matrix, so it wants its own measurement rather than a guess.

## Rejected alternatives

**A global threshold N for the whole repo.** Simpler to explain and wrong twice:
it makes the bar an artifact of repo size rather than of the evidence for a
particular pair, and it puts the near-miss candidates back on the board.

**Top-1 — "which file changes with this one most often", literally.** Closest to
§6.2's wording. Rejected because it discards partial credit, which
`docs/prior-art.md` §3 identifies as one of the better-evidenced parts of the
design, and because a strict-maximum requirement would refuse every subject whose
two strongest partners tie.

**Ranking companions by association strength (lift) instead of raw count.** It
would suppress the file that changes with everything — `CHANGELOG.md` has 37
partners here and is nobody's specific companion. Rejected in the *truth* path
because the graded fact then stops being statable to a human: "changed together
at least 4 times" is checkable by anyone with a git log, and "has a lift above
1.8" is not. Specificity survives as a **tie-break** inside equal counts, where
it changes which of two equally-true answers is shown and nothing about what is
true. The churn gate handles the degenerate boards instead.

**Recording the indexer's limits in the atlas so `minCoChangeCount` need not be
assumed.** More schema surface, on a shape guardrail 5 makes expensive to change,
to carry a constant that has never moved — and the failure direction is safe:
assuming a floor no lower than the real one makes the bar conservative, costing
questions rather than correctness. `wideLimit` *is* carried, because it changes
what the numbers mean rather than how many of them there are.
