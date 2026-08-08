# ADR-0016 — A history wire is drawn only where no board is open

- **Date**: 2026-08-08
- **Status**: accepted
- **Extends**: [ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md) decision 1
  (what the map may give away) to a second relation, and closes the open item
  [ADR-0014](./0014-companion-truth-is-a-gap-not-a-threshold.md) left behind
  (*"what a Companion pass unlocks on the map"*). Inherits ADR-0011's
  proved-versus-shown discipline unchanged.
- **Context**: the rung after M4. Companion asks about a coupling the player is never shown.
- **Figures**: measured on this repo at `ef0d8de`, except the Blast Radius overlap
  paragraph, which is one commit later. **Every number here moves**, because ark
  indexes itself and each commit changes its own matrix — by `b058070` the deck's
  200 pairs had made "79% vanish" into 59% and the gate table's 89 into 87. The
  argument rests on the ratios and the signs, never the digits; re-measure before
  quoting one.

---

## The question

The map draws imports. Every edge on it is an import, and there is no history
channel at all. So a Companion pass lifted fog on the subject and the members
proved and **changed nothing else on screen** — NORTH-STAR §4's *"fog lifts
around what you proved you understand"* only half kept, for the one verb whose
entire argument is that it reaches a coupling the import graph structurally
cannot see.

Blast Radius, by contrast, redraws the node's full import cone on a pass. The
task was to give Companion an equivalent payoff. The data is already in the
atlas (`history.coChange`), so no schema change and no reindex.

The whole difficulty is deciding **who may see which wire, and when**.

---

## Problem 1 — there is no free tier, and the reason is structural

ADR-0008's rule is *direct importers for everyone, the full cone only for the
proved*. The obvious move is to find Companion's equivalent of depth 1 — a weak
signal safe to hand out — and there is none. Two reasons, the second measured:

**Blast Radius's free tier is the *bottom* of its answer; any count tier is the
*top* of Companion's.** ADR-0008 could spend depth 1 because the question lives
above it — consequence 2 there *forces* the truth sample to include distance ≥ 2
members precisely because direct importers are readable off the map, and §8.4
defines `surprise` against exactly that guess. Companion's key is sampled
**count-descending** (`rankCompanions`), so "draw only the strong pairs" is not a
baseline the grade measures beyond. It is the answer key, pre-sorted, best first.

**On this repo the key usually *is* the whole row.** Measured `|truth| / |row|`
over the shipped deck: **median 1.00** (min 0.29). There is no subset of a node's
partners that is not key material. And the floor is 2 while the matrix's own
minimum is 2, so **every pair the matrix records** is sampleable into some key —
there is no quiet tail of pairs too weak to be answer material.

A visible count threshold would also rebuild ADR-0014's Problem 2 in ink: that
ADR exists to remove the middle band, and a map drawing pairs at or above N
teaches that absence below N means absence of coupling — the false certification
the floor derivation exists to prevent. **The boards refuse to have a middle
band; the map must not paint one.**

The honest free tier already exists and is already appointed: **churn**
(ADR-0014 decision 7). Per-node, leaks no pair, printed in the inspector, and the
baseline `surprise` and `gate.ts` both measure against.

## Problem 2 — the relation is symmetric, so a leak lands on both ends

Blast Radius's containment argument needs a chain. Co-change needs nothing:
drawing `(S, P)` is an element of **both** endpoints' keys, and under ADR-0014's
invariant it is maximally sharp — any partner of `P` on `P`'s board *is* in
`P`'s truth, with no near-miss candidates to dilute it.

Simulated over the real deck, per frame, counting drawn pairs that are members of
a still-unanswered subject's key:

| gate | worst-case open-key exposure in one frame | subjects ever exposed |
|---|---:|---:|
| both endpoints in `provedThrough(…, 'companion')` — *the shape `tracedRadius` uses* | **89** | 28 / 40 |
| either endpoint an answered subject | 56 | 32 / 40 |
| both endpoints answered subjects | **0** | 0 / 40 |

The first row is the tempting one, because it is the helper the other verb
already uses. It would have been the **fifth** instance of ADR-0014's bug class —
verb-blind state read by verb-specific code — and this time *inside* the correct
verb. `provedThrough` returns subjects **and members proved in someone else's
question**; for imports that is bounded by containment (a member's cone is a
subset of the cone it was proved inside), and co-change has no containment at
all — a member's row reaches anywhere on the map.

---

## Decision

**1. The map draws exactly the pairs a reveal has named — never the subject's row.**

`companion/reveal.ts` writes a note carrying the co-change count for every board
member in the subject's row, **correct and missed alike**, so answering S hands
the player every pair `(S, T)` for `T ∈ truth(S)` in words. Rendering those costs
no disclosure.

The whole **row** is a different act, and the difference is measured: on a full
clear the row rule draws 169 pairs where the named rule draws 138 — **31 pairs,
18% of the finished layer, that no reveal ever named.** The summary sentence
states the row's *cardinality* ("has changed with N files in all"); it does not
state the *identities*, and ADR-0011 decision 3 is exactly the rule that a count
may be shown while a name must be earned.

**2. A wire is withheld while either of its files still carries an open Companion
board. This is pillar 3, not a disclosure argument.**

Every drawn pair was named in a reveal, so nothing here is information the player
was not given. But **text in a closed panel is a memory test and ink on the map
is a lookup**, concurrent with the board — §9 deliberately keeps the world
visible behind the challenge scrim. Two Companion subjects commonly carry each
other in their keys, so an ungated layer assembles a later board's answer one
answered neighbour at a time: measured, up to **5 of a 6-member key** drawn
beside an open question. Pillar 3 is violated exactly when a challenge can be
answered by looking something up rather than by reasoning, and a wired answer is
the map's Ctrl+F.

The general principle, which also explains why Blast Radius never has this
problem despite drawing every import edge always:

> **The map may aggregate what it already draws; only a reveal may introduce a
> primitive, and the map may keep what a passed reveal introduced.**

An import cone is aggregation of visible edges, and the aggregating *is* the
tested skill. A co-change pair is a primitive the map has never shown, and
reading a wire is not a skill.

Nothing is permanently withheld: the layer converges to all 138 named pairs, so
this is deferral, not subtraction (guardrail 6).

**3. There is exactly one gate. The transient flash was built, measured and removed.**

The first version drew every pair the open reveal named — ungated, on the
argument that the panel a few pixels away was naming them anyway — with the gated
layer underneath. It is measurably wrong: **79% of those wires vanish when the
panel closes** (6 promised and 1 kept on the board the e2e plays; 4 of 40 boards
keep nothing at all). The reveal's *"now drawn on the map"* was false within one
click — verbatim the defect `onGraded` records this codebase shipping once
already, in the other direction.

So the summary claims the **record** rather than the rendering, and states the
timing instead of glossing it: *"…become history wires, drawn once both files'
questions are answered."* A verb may say what it revealed; only the player knows
what is on screen.

**4. Supply, measured, because a gate that never opens is a layer nobody sees.**

Wires drawn after k Companion passes on this repo:

```
k= 1 → 1      k=10 → 16      k=30 → 90
k= 5 → 4      k=20 → 49      k=40 → 138
```

Non-zero from the first pass, which was the requirement. The cost against the
ungated rule is real and accepted: 1 wire instead of 5 at k=1, converging to the
same 138. `FrameStats.tiesDrawn` is in the HUD string and `test:e2e` fails if it
is zero after a Companion pass — the same liveness gate `peaksDrawn` has, for the
same reason: simulating supply in node proves the arithmetic, not that a stroke
reached a canvas.

**5. Encoding: shallow arcs, one new ink, width by log(count).**

Arcs rather than straight lines so the relation separates *before* colour
registers — and because many companions also import each other, where a straight
wire would hide underneath the import edge exactly at the point the lesson lives.
One new `INK` slot (ember) because a node can carry an open question, sit in a
drawn cone and have a wire simultaneously, and `palette.ts` already records that
simultaneous meanings must not share ink. No dash — taken by `probable` imports.
Width is `log2` because counts run 2–10 here and to **613** on `sveltejs/svelte`;
linear width cannot serve both. Drawn at every zoom level, unlike imports: they
are few, earned, and the long cross-region wires are what territory zoom is for.

---

**6. The licence lives on the `Verb` contract, not in the shell.**

`Reveal.unlocks` cannot carry this rule alone: it is a fact about one grade and
lives as long as the panel does, while the map must rebuild the same licence from
a **restored save**, where no `Reveal` has ever existed. The first implementation
reconstructed it by name — `challenge.verb !== 'companion'`, hard-coded in two
files — which is the "nothing outside a verb names a verb" seam M4 spent its
whole budget building, undone by the next feature that needed it. `Verb.channel`
is the static twin, `channelOf()` is the single place the question is answered,
and an unknown id draws nothing.

## Consequences

- **`Reveal.unlocks` gains `coChangeTies`.** `nothing` stays on the contract
  though no verb returns it now: a verb that reveals a relation the map cannot
  draw must be able to say so rather than borrow a channel meaning something
  else, which is how the first three leaks happened.
- **The orbit shows no wires, and the player is not told why.** The arc is built
  in *screen* space, so it transfers unchanged; what is undecided is only the
  anchor (top, like the orbit's existing import wires, or base) and how a wire
  occludes against the columns it crosses. Top-to-top is the obvious candidate.
  The cost until then is real: Companion's summary promises wires "drawn once
  both files' questions are answered", and one keystroke into the orbit the ink
  is gone and the HUD reads `0 wires`. A mild instance of the promised-versus-
  drawn defect decision 3 exists to remove.
- **The e2e picks its subject rather than stumbling on one.** The endpoint gate
  makes "answer any Companion question" an unreliable trigger, so the script
  selects a subject carrying only a Companion board whose key contains a
  non-subject. Almost every companion-only subject qualifies and the script needs
  exactly one, so this is robust to the deck changing under it — which it does on
  every commit.

## What this does not fix, named so it is not mistaken for solved

**Two Companion subjects can each carry the other in their answer key**, so
answering P discloses a member of Q's key in *text* — up to **6 of 6** on this
repo, measured. That is a property of how the deck is generated, not of anything
drawn: ADR-0012 issues each answer key once but says nothing about keys that
*overlap*. The endpoint gate keeps it off the map; it does not remove it from the
reveal panel. The fix is generator-side — window mutual members the way ADR-0012
re-asks colliding subjects — and it belongs to a later session.

**`tracedRadius`'s member half is an open defect, reclassified during this
work.** `provedThrough(…, 'blastRadius')` includes members, so a file proved as a
member of S's question gets `FULL_RADIUS` from `depthFor` while **its own** Blast
Radius board is still open — and by ADR-0008's invariant
(`candidates ∩ dependents(M, ∞) = truth`) the lit set intersected with M's board
is that board's answer key, byte-exact. Hovering S's cone does not substitute:
`cone(S)` strictly overapproximates `cone(M)` and can contain M's certified
distractors, so it never isolates the key; `cone(M)` does, precisely. Measured on
this repo: **20 of 40 Blast Radius subjects**, up to 12 at once. This ADR does not
fix it — the fix is either excluding member-unlocks whose own board is open, or
accepting and documenting it — but it must not go back to being assumed fine.

> **CLOSED at `e6f7e2f`, and by neither option this paragraph offered.** The set
> the radius rule reads (`subjectsPassed`, formerly `provedThrough`) now returns
> **subjects only**, so a file unlocks its own cone by passing its own question
> and by nothing else.
>
> Gating on whether the member's board is open — the first option above — is
> forbidden in as many words by ADR-0008 decision 1: *"the rule must not depend
> on whether a challenge is open, because the leak happens at the moment of
> choosing the subject."* Accepting it was the second, and the same decision
> rules that out too: the unlock is *"permanently unlocked by passing that node's
> challenge"*. **The member half was a divergence from the decision of record,
> not an open question** — which is why the fix needed no new decision, and why
> this paragraph's framing of the choice was wrong.
>
> Re-measured at `e6f7e2f` before the change, because the deck is regenerated at
> every commit and these figures drift: **26 of 40 boards exposable, and all 26
> recover their key byte-exact**; 9 exposed in the deck's actual serving order,
> 6 at once at the worst frame. After it the count is not smaller, it is
> **structurally zero** — a node is in the set only if its own board is passed,
> so its board is never open.
>
> **The cost, stated rather than absorbed.** After a perfect clear, 41 files lose
> an unlock they had only through membership. Of those, **8 have any dependents
> at all** to draw, and none of the 41 carries a Blast Radius question of its
> own — so those 8 join the population ADR-0012's `report.unprovableNodes`
> already counts: files no question can lift the fog from. A cone nobody can earn
> is the honest state under ADR-0008, not a regression.

**A wire beside an open *Blast Radius* board is a distractor, not an answer —
measured rather than assumed.** The gate checks Companion boards only, so a
licensed wire can sit next to an open blast question about the same subject.
Worst case simulated (every Companion board cleared, no blast board answered):
**12 of 40** blast boards have a candidate wired to their subject, **37 of 800**
candidates across the deck. Of those wired candidates **41% are blast truth,
against a 27% base rate** — a weak signal that is wrong more often than right,
which is exactly §8.3's fourth distractor class, the one NORTH-STAR calls the
*best* wrong answers *because getting them wrong is itself a lesson*. Widening
the gate would delete a teaching signal rather than close a leak. Re-measure if a
repo's two decks overlap much more than this one's.

**The reindex path is not covered, and the module's central sentence goes false
across it.** `retie()` licenses the *current* atlas's `challenge.truth` off a
stored `(verb, subject)` pass, so once a reindex regenerates the deck an answered
subject's truth can differ from what was revealed when the pass was earned — and
the map then draws pairs no reveal named *to this player*. It is not an open-board
leak (the pass retires the subject's question, partners stay gated), and it is
defensible under ADR-0011's shown/proved split as material of a retired question.
But "what is drawn is exactly the pairs some reveal has named" is a claim about
one atlas, and namedness is unreconstructible because the save stores `proved`,
not named. The conservative fix, if this ever matters: draw `pass.proved`-derived
pairs after a head change, since `proved ⊆ named` always. Symmetrically, a stored
pass whose subject leaves the regenerated deck loses its wires entirely — fog and
notes key to the pass record, wires key to the current deck.

## Rejected alternatives

**A count threshold — draw pairs at or above N.** Argued above: it is the top of
the ranked key, and it paints the middle band ADR-0014 exists to ban.

**The subject's whole row on a pass.** 31 pairs (18%) that no reveal named. Its
defence — "the row is the picture of a sentence already spoken" — conflates
stating a cardinality with naming identities.

**Gating on `provedThrough`.** 89 open-key members in one frame. The fifth
instance of a bug class this repo has already documented four times.

**A global co-change layer or a toggle.** `docs/prior-art.md` §4.1: every
whole-repo map in the category is dead or ornamental and every survivor shows a
local neighbourhood that expands. Also a complete answer-key handout.

**Styling the fail case differently instead of withholding it.** Dimming is
emphasis; the leak is existence. A player who fails S, keeps S's wires and
reopens the same board is transcribing — the M1 hover leak with one extra click.
Persisting shown-but-unproved pairs would also need a new stored surface and a
`SAVE_VERSION` bump, which is its own decision and not a styling one.
