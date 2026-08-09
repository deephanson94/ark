# ADR-0020 — A wrong answer carries the reason it was offered

- **Date**: 2026-08-09
- **Status**: accepted
- **Extends**: [ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md) §4 (what a
  distractor is *for*), [ADR-0014](./0014-companion-truth-is-a-gap-not-a-threshold.md) finding 3 (the
  co-change sentence, deleted) and [ADR-0019](./0019-archaeology-asks-a-place-what-happened-to-it.md)
  decision 9 (relations, never identities, guarded by a set-size check).
- **Bumps**: `ATLAS_VERSION` 7 → 8. `docs/atlas-format.md` §3.6 in the same commit (guardrail 5).
- **Measured on**: a clean clone of ark at **`4bb1996`** and of `honojs/hono` at **`cf78528`**
  (full clone, not `--depth`). Ark indexes itself, so every figure below names the commit it was
  taken at; the commit carrying this document is by construction one later than the one it describes.

---

## The question

NORTH-STAR §8.3: *"a multiple-choice question is exactly as good as its wrong answers"*, and
distractor generation is *"a real subsystem, not a helper function"*. Four verbs ship, each with
four or five named strategies. Every wrong pick on every board was chosen **by name** — a directory
sibling, a name-alike, a structurally-near non-dependent, a co-change ghost, a commit whose message
names a file it never touched.

And no reveal has ever said which. The label died at the generator's return statement:
`report.distractorMix` kept the *aggregate* — how many of each, repo-wide — and nothing kept *which*.
A reveal wanting to explain a wrong pick re-derived a reason from the graph at render time.

That re-derivation is honest, and it is not the same thing. The generator knows why it offered that
answer; throwing the knowledge away means the sharpest lesson on the board is reconstructed rather
than stated.

## The fork, and the measurement that decided it

Two shapes, and the difference is a schema change:

- **(a)** provenance ships in the atlas — `Challenge` gains a per-candidate strategy label, so
  `ATLAS_VERSION` bumps and the format document moves with it. Honest record; cannot disagree with
  what the generator did.
- **(b)** re-derived player-side from the graph. No bump, no migration — and it can quietly disagree
  with the actual choice.

**The measurement nobody had taken**: for every distractor on every shipped board, compare the
strategy that *actually* chose it against the reason today's reveal re-derives. The comparison reads
the emitted **sentence** with a pattern table rather than re-running the branch predicates, because
the sentence is what a player gets and re-implementing the predicates would have measured the probe.
Every note had to match exactly one pattern or the probe threw.

| | ark @ `4bb1996` | `honojs/hono` @ `cf78528` |
|---|---|---|
| distractor slots | 2,291 | 3,524 |
| reveal names the strategy that chose it | **1,234 (53.9%)** | **1,687 (47.9%)** |
| reveal names a *different* strategy | 879 (38.4%) | 1,279 (36.3%) |
| reveal names no class at all | 178 (7.8%) | 558 (15.8%) |

So (b) is right about half the time. The per-class breakdown is worse than the total, because the
failures are not spread evenly:

| verb / strategy | ark agree | ark disagree | what it is called instead |
|---|---|---|---|
| `companion` `treeSibling` | **0 of 148** | 148 | `busy` ×129 |
| `companion` `nameSimilar` | **0 of 80** | 80 | `busy` ×76 |
| `placement` `treeSibling` | **0 of 118** | 118 | `busy` ×66 |
| `placement` `nameSimilar` | **0 of 83** | 83 | `busy` ×48 |
| `archaeology` `sibling` | **0 of 124** | 112 (+12 silent) | `companion` ×103 |
| `archaeology` `neighbour` | 6 of 137 | 131 | `companion` ×128 |
| `blastRadius` `coChange` | 0 of 12 | 4 (+8 silent) | `graphAdjacent` ×3 |
| `blastRadius` `nameSimilar` | 0 of 32 | 3 (+29 silent) | `graphAdjacent` ×3 |

The cause is structural rather than incidental, and it is the reason no amount of improving the
re-derivation would fix it. **A candidate satisfies several predicates at once**, and which one
*chose* it was decided by a quota and a cursor, not by a predicate. A file can be a directory sibling
*and* a name-alike *and* high-churn; the reveal's `whyNot` picks an arm by priority order, so
whichever test runs first wins. In **Companion and Placement** that is a churn arm running before the
path arms and swallowing them whole; in **Blast Radius and Archaeology** there is no arm for the
class at all — `nameSimilar`, `coChange` and `sibling` have no branch to be named by, so they fall to
the generic sentence or to somebody else's. Seven of the seventeen (verb, strategy) pairs are
re-derived correctly **zero** times on both repos.

**Decision: (a).** The label ships in the atlas.

## Decision 1 — `Challenge.witness`, aligned with `candidates`

One space-separated token per candidate, positionally aligned, `-` where the candidate is in `truth`
and so was never *chosen* as anything:

```jsonc
"candidates": ["n:0a…", "n:1b…", "n:2c…", "n:3d…"],
"truth":      ["n:1b…"],
"witness":    "treeSibling - nameSimilar distant"
```

The format lives in `src/atlas/witness.ts`, beside the schema and not in `src/verbs/`, for the reason
`VERB_IDS` lives there: the validator has to refuse a malformed witness and cannot import from the
verbs, because verbs are built on the atlas and the dependency only runs one way. The *names* stay in
each verb's `distractors.ts`.

**Cost, measured through the real serialiser** — not estimated, because `serialize.ts` expands arrays
longer than 8 one element per line, so a 20-slot parallel array pays its indentation as well as its
contents and an estimate that ignores that is wrong by more than the thing it is measuring:

| encoding | ark | hono |
|---|---|---|
| object keyed by candidate id | +68.3 KiB (27.2%) | +104.3 KiB (18.7%) |
| array over candidates, `null` for truth | +60.5 KiB (24.1%) | +89.1 KiB (16.0%) |
| array over distractors only | +51.4 KiB (20.4%) | +78.2 KiB (14.0%) |
| **space-joined names, `-` for truth** | **+27.0 KiB (10.8%)** | **+40.5 KiB (7.3%)** |
| one character per candidate | +5.9 KiB (2.4%) | +8.6 KiB (1.6%) |

The chosen encoding is 2.2–2.5× cheaper than every shape that repeats an id, and 4.6× dearer than the
cheapest one. It takes this repo from **1851 to 2050 bytes per file** against a 2621 ceiling
(139 files at `4bb1996`), and hono from 1343 to 1441.

**Why not the character encoding**, which is another 21 KiB cheaper here: it needs a table, and a
table is a second thing to keep in step. Adding a strategy re-sorts the alphabet and silently remaps
every existing label — a whole atlas wrong in a way that validates. Shipping the table *in* the atlas
answers that and costs a field whose only job is to explain another field. `disclosure.ts` already
records what an encoding nobody can read costs, having embedded a raw control character in a template
literal where it was invisible in every editor and diff. A witness a human can check by eye is worth
21 KiB, and this paragraph is here so a later session tightening the budget knows exactly what it
buys and what it gives up.

**Why the per-file budget looks tight and is not.** `maxChallengesFor` has a **floor** of 40 boards
per verb, which a 140-file repo pays in full; the witness is O(deck × candidates), so on the bootstrap
repo it is charged against the smallest possible denominator. At the 2,000 files the ceiling is
quoted for, the deck scales with the repo and the witness is a few per cent of the atlas.

## Decision 2 — the witness is a second line, not a replacement

`RevealNote` gains `witness: string | null`, rendered under `note`. They are different claims and
both are wanted: `note` says what is **true** of the candidate, measured off the graph today;
`witness` says what the board **meant** by offering it.

Rejected: **letting the recorded label choose the note's arm**, so there is one sentence and it is
always the generator's. Tempting, and it loses measured detail — the hop count, the churn count, the
named neighbour — on rows where the re-derived arm is sharper than the class. A `treeSibling` pick
that is *also* a dependency of the subject gets *"the subject imports this — the arrow points the
other way"* today, which is the better lesson; under label-driven selection it would get *"same
directory"*.

No new method on `Verb`. The witness is another input to a verb's own `reveal`, so the console
learns nothing about verbs — it renders a sentence that arrived written.

## Decision 3 — a witness is withheld by **class or by board**, never by row

This is the rule the rest of the design falls out of, and it was arrived at by watching a per-row
guard defeat itself.

Some classes cannot be named aloud (decision 4). The obvious repair for a class that is safe on some
rows and not others is to withhold it on the unsafe rows. **That is strictly worse than saying
nothing**: if `structural` is the only class ever withheld from a Companion board, then the *absence*
of a line means "this row is a deep structural pick", which is precisely the fact being withheld.
A per-row guard converts a leak into a leak-by-omission with the same content.

So: a class is spoken for every row of a board or for none of it. Every guard is therefore a property
of the **subject** — how many import neighbours it has, how many files share its directory, how many
co-change partners it has — never of the candidate. `tests/atlas/` asserts this over the shipped deck
and a mutant that withholds by row is caught.

**Absence is not an assertion.** Withholding a whole class does leave a residual: a player who knows
the taxonomy can infer that an unlabelled Blast Radius row is co-change or padding, and on this repo
padding is 2 slots against 12, so the inference is usually right. That is the §7.1 standard, not the
ADR-0008 one — the atlas carries `witness` in plaintext exactly as it carries `truth`, so a reader
willing to look it up has an easier route than inferring from silence, and has opted out of the
product. ADR-0008 rejected the devtools argument for *hover* because hover is in-band and
involuntary. Silence is neither. Stated as a residual rather than denied.

## Decision 4 — two classes are recorded and never spoken

| verb | class | spoken? | why |
|---|---|---|---|
| `blastRadius` | `coChange` | **no** | it *is* Companion's answer key for the same subject |
| `companion` | `structural` | **no** | states an undrawn import connection; redundant where it is safe |
| everything else | | yes | |
| every verb | `distant` | **no** | padding, not a strategy — decision 5 |

**`coChange` is the trap of this rung, and it is written down in the file it would break.**
`blastRadius/reveal.ts` deliberately deleted its co-change sentence, and the comment says why:
`coChangeStrategy` seeds those distractors from the matrix **ranked count-descending**, which is
exactly Companion's answer key for the same subject. A witness reading *"offered because it changes
with the subject"* is that deleted sentence wearing a label, in the file that documents it.

Measured: of ark's 12 co-change distractors, 6 sit on a subject that also ships a Companion board and
**3 are members of that board's answer key**; on hono, 6 and 3 of 53. The argument is order-free, per
ADR-0019 decision 7's own repair — a fact readable off one board and tickable on another is a
pillar-3 problem in whichever order they arrive.

> **A way to keep it was designed, measured and rejected.** ADR-0019 decision 7's accumulator runs in
> exactly the right direction: Blast Radius generates first, so it could *declare* the pairs its
> witness names (a `pairFact`), and Companion — which reads `options.disclosed` and today ignores it —
> could refuse to ask them back. Measured cost: 12 pairs on ark, 52 on hono; **7 Companion boards
> lose one key member each here and 5 there, and none falls below a two-member key**. Cheap, and
> wrong: ADR-0014 finding 3 already faced this exact trade and chose the other side — *"the sentence
> is gone; Companion asks about that coupling directly now, which teaches it better than a
> parenthetical ever did."* Buying a witness line by deleting a whole question inverts a decision of
> record to win 12 slots. It is recorded here because the next session to notice the accumulator will
> have the same idea.

**`companion`'s `structural` is the judgement call, and it is the weaker of the two.** That strategy
walks the import graph outward from the subject **unbounded**. On the direct ring the label is free —
the map draws those edges by design (ADR-0008 decision 1) and `whyNot` already names the relation in
words. The correspondence is exact and worth stating: the graph re-derives this class correctly
**133 times of 219 here and 96 of 264 on hono — the direct-ring counts, to the row**. It is right
where the map already gave it away and nowhere else. Beyond the ring it
states a connection nothing draws:

| | ark | hono |
|---|---|---|
| `structural` slots | 219 | 264 |
| on the direct import ring (map already draws it) | 133 | 96 |
| transitive dependents at depth ≥ 2 | 10 | 14 |
| …**in the subject's own shipped Blast Radius answer key** | **1** | **1** |

One slot per repo. Small, and this codebase guarded a four-slot leak in ADR-0019. What settles it is
that the label **buys nothing where it is safe**: on the direct ring — 133 of 219 rows here, 96 of 264
on hono — the note already says it. By decision 3 the choice is then whole-class or nothing, since a
per-row guard would make silence mean "deep structural".

**Two honest caveats, and a review pressed on both.** First, decision 3 says absence is not an
assertion, which also licenses *speaking* the class and accepting one slot; the measured redundancy is
what tips it, not the leak alone. Second, and sharper: *"the label states an undrawn cone edge where it
is not safe"* is **false of most of the rows it condemns**. Of the 86 rows beyond the ring here, only
10 are transitive dependents; the other **76 are undirected proximity, in nobody's answer key** — and
they are precisely the population where the label would be neither redundant nor a leak, i.e. the one
place it would say something no other surface says. The decision stands on decision 3's whole-class
rule rather than on that sentence, and a later session wanting to revive `structural` should start
from those 76 rows.

## Decision 5 — `distant` says nothing, and that is a decision

`distant` is not a strategy. It is what fills a board when the four run dry, and the honest sentence
— *"offered because nothing sharper was left"* — is a confession about the board rather than a lesson
about the repo. It also invites the player to discount the row, which is a poor trade for a fact they
cannot use.

Measured, it barely exists on the bootstrap repo: **2 of ark's 2,291 distractor slots** and 111 of
hono's 3,524 (all Archaeology). And on both repos all 113 of those rows already fall on the reveal's
generic arm, so withholding a witness changes nothing anyone sees.

The interesting fact `distant` carries is real and belongs somewhere else: *this subject has a thin
neighbourhood*. That is a property of the **board**, not of the row, so if a later session wants it,
the place is `summary`.

## Decision 6 — the guards Archaeology inherits

Three of Archaeology's four witnesses say *"it touched something in this file's neighbourhood"*,
which is ADR-0019 decision 9's rule again — relations, never identities — and so they inherit its
guard: **a relation over a set of one is an identity.** The witness is withheld when the
neighbourhood it quantifies over holds one file:

| guard | fires on ark | fires on hono |
|---|---|---|
| `sibling` — one other file in the directory | **7** | **5** |
| `neighbour` — one import neighbour | 0 | 2 |
| `companion` — one co-change partner | 0 | 3 |

All three are live on real data, and the one that fires on *both* repos is `sibling` — which is also
the class with no re-derived arm at all, i.e. the single largest thing the witness adds. Each guard is
a property of the subject, so decision 3 holds for free.

## What fires, measured before any test was written around it

CLAUDE.md: count how many times a new path executes on a real repo *before* writing tests around it.

| | ark @ `4bb1996` | hono @ `cf78528` |
|---|---|---|
| wrong-answer rows | 2,291 | 3,524 |
| carry a witness | **2,051 (89.5%)** | **3,086 (87.6%)** |
| withheld: `coChange` | 12 | 53 |
| withheld: `companion structural` | 219 | 264 |
| withheld: `distant` | 2 | 111 |
| withheld: a set-size guard | 7 | 10 |

## Found while building this, and it is a live defect rather than a nicety

**Placement's reveal named files its own `discloses` never declared.**
`placement/index.ts` yields `touchedFact(commit, member)` for `challenge.truth` only — it takes a
challenge and no atlas, so it *cannot* declare more. Its reveal searched `commit.files`, the commit's
**whole** membership, for a neighbour to name. So a sentence could state *"commit C touched F"* for an
F the accumulator never heard of, which is an atom of F's Archaeology answer key: exactly the leak
ADR-0019 decision 7 exists to stop, routed around by a sentence written a milestone earlier — the
direction that document says nobody looks in.

Measured: **40 sentences — 32 distinct (board, file) namings — across 16 of ark's 40 Placement boards
named a file outside their own answer key, and 20 of those atoms are members of a shipped Archaeology
answer key**; 12 across 5 boards on hono, 4 of them in a key. (A review reproducing this got 22 for
the last figure; the two counts differ in whether a repeated atom is counted once, and the point does
not turn on it.) `whyYes` runs on every truth member of every board played, so this was not
conditional on a wrong pick — it shipped on every Placement reveal.

The fix is to search the **answer key** instead, which makes everything a sentence names a file
already on the board. One consequence had to be followed through: the fall-through then read *"no
import edge to anything else in the commit"*, which the narrowing makes **false** — the commit may
well have touched an unsampled neighbour. It reads *"anything else on this board"* now. A sentence
that survives a change to what it quantifies over was not really about the quantifier.

## Found by an adversarial review of the finished code

All of one class, and it is a class this document did not have a name for: **a witness glosses its
class, and three glosses stated §8.3's *definition* of the strategy rather than the strategy that
ships.** Every one of those strategies starts at its textbook bucket and **widens** when the bucket
runs dry, so the gloss was false on rows the widening reached — and falsifiable by a player reading
the two paths in one row of the panel, or with one `git show --stat`.

| gloss | false on, ark | false on, hono |
|---|---|---|
| Blast Radius `treeSibling` — *"a directory sibling"* | **100 of 231** | **193 of 297** |
| Companion `treeSibling` — *"a directory sibling"* | 23 of 148 | **121 of 211** |
| Placement `treeSibling` — *"living where the change landed"* | 6 of 118 | 63 of 173 |
| Placement `structural` — *"an import-graph **neighbour**"* | 4 of 100 | 24 of 188 |
| Archaeology `sibling` — *"this file's own **directory**"* | 14 of 124 | 40 of 118 |

The last is the worst and had a second defect inside it. `sibling` reads
`corpus.byDirPrefix.get(home)`, and `analyse()` registers every node under **every prefix** of its
directory — so that bucket is the whole **subtree**, which its own docstring ("the deepest bucket
only") does not say. Worse, a **root-level subject** has `home === ''`, whose bucket is the entire
repo: *"it touched this file's own corner of the tree"* is then true of every commit and worth
nothing. 24 such rows here, 25 on hono; they are withheld now, by a board-level guard, per decision 3.

And the guard counted a **third** population — exact-directory siblings — so the strategy, the guard
and the sentence quantified over three different sets. That is ADR-0019's *"two individually-honest
surfaces that disagree"* with a third surface added, and the repair is that all three now read the
subtree.

**The lesson is narrower than "check your wording", and it is the one worth keeping**: a class label
is not a class description. `treeSibling` is a correct *name* for what the generator did on every one
of those rows; the sentence explaining it to a player is a separate claim, and it has to be true of
**every member of the class, including the ones the fallback reached** — not of the paragraph in
§8.3 the strategy was named after. `tests/atlas/` now checks the claim rather than the wording, and
holds each sentence to the **strongest** relation it asserts: the first version checked only the
weaker property, and a mutant restoring *"a directory sibling"* survived it.

Placement's `structural` is the same shape as the class decision 4 withheld from Companion, asked of
the verb decision 4 never asked it of. Measured, its leak direction is empty — **0 deep rows on either
repo sit in a shipped Blast Radius key** — so what was wrong there was only the sentence.

## The direction this opens, measured and not acted on

Archaeology's `sibling` is the one class with no pre-existing `whyNot` arm, so it is genuinely new
content — and it tells the player *"commit C touched at least one file under `dir(F)`"*, which is a
weakened atom of C's **Placement** key. ADR-0019 decision 7's direction, one verb further on.

Measured over the spoken rows: **97 of ark's 100 name a commit that also ships a Placement board**
(29 of hono's 91), and ticking that board's candidates *inside the hinted subtree* is 100%-precise on
**9 boards here and 4 on hono**, and at least half-precise on 21 and 2.

Not acted on, and the reasons are stated rather than assumed. It is an existential over a subtree
rather than a name; the same exposure already exists in the `neighbour` and `companion` arms, which
shipped in M4 and are not new here; and it has not been scored against a band, so it is a measured
open question rather than a demonstrated gate failure. What this document should not have implied is
that decision 6's set-size guard is *the* guard these classes need — it addresses the identity case
and nothing else. Scoring the subtree hint as a `gate.ts` heuristic on the **Placement** board is the
work this leaves behind.

## Consequences

- **`report.distractorMix` is unchanged and still earns its place.** It is the aggregate; this is the
  identity. Neither replaces the other.
- **The gate on what is *said* is separable from the record.** Because the atlas carries every label
  honestly and each verb's reveal decides what to speak, a later session can revisit decision 4
  without a schema change — including reviving `coChange` if the pair rule above ever becomes the
  right trade.
- **`RevealNote.route` is still rendered nowhere.** Blast Radius has computed it since M2 and the
  console has never drawn it; three unit tests assert its shape. Noticed while adding a field beside
  it, and left alone rather than fixed in passing — but it is infrastructure with no consumer, which
  is the thing this repo has a landmine about.
- **The unit fixtures produce two of Archaeology's four classes.** Its boards carry only `neighbour`
  and `distant`, because the fixture's `src/core/` holds nothing that is not also an import
  neighbour, so `neighbour` claims those commits first and `sibling` never gets supply. The reveal
  tests hand the class in deliberately and say so; `tests/atlas/` covers the generator's real
  production. Chasing it with a wider fixture would test the allocator, not the reveal.

## Rejected alternatives

**(b), re-derivation.** The measurement is the argument: 53.9% / 47.9%, and two classes at zero.
Free, and a plausible fiction on roughly half the board.

**One character per candidate.** 21 KiB cheaper here; costs a table that a later strategy re-sorts.
See decision 1.

**An object keyed by candidate id.** The most readable shape and the most expensive — 68.3 KiB here,
because a 14-byte id repeated per slot dominates everything else.

**Making the witness optional on `Challenge`.** `Verb.discloses` records why not: *"an optional
member is one a verb author never notices; a required one makes the question one you must answer to
compile."* Requiring it produced a compile error at every one of the twelve construction sites,
including four generators and nine fixtures — which is the type system doing the review.

**Naming `coChange` and buying it back with a `pairFact`.** Measured and rejected in decision 4.
