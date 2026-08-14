# ADR-0045 — Tier 2's third question is two questions, and only one survives

**Status**: **`cycle` refused · `upstream` refused** · nothing built · 2026-08-14
**Reversed by review on the day it was written.** §3 recommended building `upstream`; a Fable review
re-ran every probe, reproduced every table, and killed the recommendation on a mistake in how the
benefits were measured. §5 is the record. The measurements below stand; the conclusion they were used
to reach does not.
**Follows**: [ADR-0043](./0043-tier-2-is-unaskable-while-the-map-gives-away-depth-1.md) §7, which left this
question open in as many words — *"this document does not clear it and does not condemn it; it was
not measured."*
**Bears on**: [ADR-0034](./0034-the-phenomenon-catalogue-is-deferred-and-a-cycle-is-an-answer-key.md) §4,
[ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md) decision 1,
NORTH-STAR §5 tier 2 and §6.2's Layering backlog verb.

**Measured on** clean clones of `ark` **`9b86d12`**, `honojs/hono` `7075369e`, `kysely-org/kysely`
`f24018c7`, `graphql/graphql-js` `9c245018`, `typeorm/typeorm` `df07bf1e`, `gohugoio/hugo` `44da0860`,
`prometheus/prometheus`, `django/django` `c9eb16a87e`. Reproduce with `scripts/probe-layering.ts` and
`scripts/probe-upstream.ts`. **No `src/` change.**

*The ark sha above first read `f5a77bd`, the branch head, while every ark figure was measured on the
corpus clone at `9b86d12`. Not a transcription slip: it is this repository's own landmine — a figure
about a self-indexing repo taken from the tree that does not yet contain it — and the review showed it
matters here, because at `f5a77bd` ark is 250 nodes and §3.1's end-game gate fires on 41 of 169 rather
than 81 of 149. Three documentation commits halve the headline exposure.*

---

## 1. Why this was measured at all

ADR-0043 refused a Direction verb and found that **two of tier 2's three questions are the depth-1
graph**, which ADR-0008 decision 1 gives away on purpose. The third — *"where's the layering
violation?"* — is not a depth-1 relation, so hover and the inspector do not touch it, and it was the
one route to tier-2 content that costs the map nothing.

NORTH-STAR §6.2's Layering verb is *"arrange these modules into layers"*, which ADR-0043 §7 objects
to twice: not a set-selection shape, and a DAG has many valid layerings so the ground truth is not
unique. **Both objections are about assigning layer *numbers*.** Reachability itself is unique, and
two reformulations inherit that:

- **`cycle`** — *"which of these are in a dependency cycle with `X`?"* Truth is `X`'s strongly
  connected component. A cycle is the canonical layering violation and mutual reachability is unique.
- **`upstream`** — *"which of these does `X` depend on, directly or through a chain?"* Truth is `X`'s
  transitive **dependencies**: Blast Radius's relation read along its other axis, which is exactly the
  confusion NORTH-STAR §8.3 strategy 1 calls *"a real tier-2 mistake"*.

## 2. `cycle` is refused, on three grounds

**Ground 1 — it teaches an answer key.** ADR-0034 §4 proved that every SCC-mate of a subject is a
transitive dependent, so ADR-0008's invariant forces every one of them into that subject's Blast
Radius key. Re-derived here with an independent Tarjan pass: **1,326 of 1,326** cycle subjects across
eight repos have their whole component inside their own cone. A verb whose entire content is naming
the component therefore teaches the guess ADR-0034 scored:

| repo | "tick the component" fires | beats band A | of a deck of |
|---|---|---|---|
| hugo | 114 | **111** | 156 |
| kysely | 22 | **21** | 75 |
| prometheus | 7 | 5 | 63 |
| graphql-js | 7 | 1 | 69 |
| hono | 9 | 0 | 54 |
| ark | 2 | 0 | 40 |

ADR-0034 reported hugo as 109 of 112 fired at a different index of that repo; this reads 111 of 114.
Two boards apart on a moved tree, which is agreement rather than drift — the mechanism is a proof,
not a heuristic, so only the deck can move.

ADR-0034 decision: ***"nothing may name a cycle, draw one, or imply SCC membership without a gate."***
A cycle verb is that, as its whole purpose.

**Ground 2 — the only available gate inverts the curriculum it exists to serve.** ADR-0020 allows a
gate by class or by board, never by row, so the shape is ADR-0030's: serve a cycle board only when no
member of its component still carries an unanswered Blast Radius board. Priced — boards open at the
*start* of a session, before anything is answered:

| repo | cycle subjects | open at start |
|---|---|---|
| ark | 2 | **0** |
| hugo | 133 | **0** |
| hono | 29 | 4 |
| kysely | 84 | 4 |
| graphql-js | 24 | 6 |
| prometheus | 49 | 24 |
| typeorm | 757 | 755 |

**Zero on the bootstrap repo and zero on hugo.** A tier-2 question that can only be asked after the
tier-3 deck is cleared is not tier-2 content; NORTH-STAR §5 orders these tiers deliberately, and this
gate reverses the order for the two repos where the phenomenon is most real. (typeorm's 755 is not a
reprieve: its Blast Radius deck is 58 boards of 2,248 subjects, so almost nothing is gated because
almost nothing carries a board.)

**Ground 3 — the bootstrap repo has two subjects.** ark's only non-trivial component is `[2]`. Under
NORTH-STAR §11 ark is the v1 target and pillar 6's forcing function; a verb that ships it two boards
with a key of size one is not a verb this project can develop against.

**One thing the measurement refuted, and it was my own claim.** `probe-layering.ts`'s first header
said the containment means a Blast Radius reveal *"states the cycle key entirely"*. It does not: the
cone is not the key, because ADR-0008 samples truth to a cap of 6. Measured against the **shipped**
reveals it is **3% on hugo, 7% on kysely, 12% on graphql-js, 33% on hono** — the 100%s are on the two
repos with two subjects each. Set containment was the ceiling and the shipped figure is far below it.
The refusal above does not rest on that direction and never needed to.

## 3. `upstream` survives, and its supply argument is structural

**ADR-0003's taint walks the *outgoing* side of every candidate**, which is why Blast Radius costs
`rate × mean closure` and why typeorm ships 58 boards of 2,248 subjects (ADR-0042). Mirror the
relation and the cost mirrors with it: a distractor here must be certified *not reachable from `X`*,
which is a fact about **`X`'s own closure**, not about the candidate's. One closure per board instead
of twenty.

| repo | nodes | closure clean | `upstream` boards | Blast Radius boards |
|---|---|---|---|---|
| ark | 226 | 149 of 149 | **149** | 40 |
| hono | 425 | 309 of 325 | **309** | 54 |
| kysely | 600 | 328 of 408 | **328** | 75 |
| graphql-js | 549 | 404 of 408 | **404** | 69 |
| typeorm | 3,704 | 171 of 3,400 | **171** | 58 |

**Three to seven times Blast Radius's supply on four repos, and three times on typeorm** — the
taint-limited one, where the same 12,000-site closure problem still bites but bites once per board
rather than twenty times.

### 3.1 What it gives away, measured

**Depth-1 hover.** Hovering a candidate `Y` lights `Y`'s importers; if the subject is among them, `X`
imports `Y` and `Y` is in the key. That is Blast Radius's own situation mirrored and survivable for
the same reason — the depth-1 slice is what decision 1 hands over on purpose. It beats band A on
**33 of ark's 149, 57 of hono's 309, 20 of kysely's 328, 67 of graphql-js's 404** — 6–22%, gateable
by scoring the guess per board, exactly as ADR-0021 scores a Ctrl+F heuristic.

**typeorm is the warning: 150 of 171, mean 0.911.** The reason is systematic and worth stating,
because it is a trap any future verb with a closure gate will meet: **guardrail 4 selects for shallow
closures**, and a shallow closure is precisely the one whose key is all direct dependencies. The
safety rule and the leak are correlated by construction. Gated, typeorm keeps 21 boards against its
58 Blast Radius ones — the one repo where this verb would be *worse* supplied than the verb it
extends.

**Full-radius hover, and this one is new in shape.** An `understood` node renders its **whole**
radius, not depth 1. Hovering an understood candidate `Y` shows `dependents(Y, ∞)`, and `X ∈
dependents(Y, ∞)` ⟺ `X` transitively imports `Y` ⟺ **`Y` is in this key, at any depth**. Precision is
1.000 by construction — no distractor is reachable from `X`, so none ever lights — so the guess scores
`2r/(1+r)` for `r` the share of the key that could ever be understood, and beats band A exactly when
`r ≥ 0.639`:

| repo | boards | end-game guess beats A | mean |
|---|---|---|---|
| ark | 149 | **81** | 0.652 |
| hono | 309 | **182** | 0.652 |
| typeorm | 171 | **104** | 0.644 |
| kysely | 328 | 81 | 0.325 |
| graphql-js | 404 | 15 | 0.347 |

**Blast Radius is untouched by the same move** — its key is `dependents(X)`, and an understood
candidate's radius answers the reverse relation — so this exposure belongs to this verb and not to
the one already shipped. And the shape is the opposite of every gate in this repository: it **grows
as the player progresses**, where ADR-0030's twin gate opens as they progress. It is still closable
statically, because `tracedRadius` holds subjects and a generator knows which nodes carry boards:
refuse a board whose key is ≥ 0.639 blast-subjects.

**Disclosure by the existing deck** is mild: *"X depends on Y"* and *"Y is depended on by X"* are one
fact, so every shipped Blast Radius reveal naming `X` in a board about `Y` states an atom here —
**1.7% (kysely), 3.3% (graphql-js), 6.3% (hono), 9.5% (ark)**, against ADR-0019 §7's 55.6% for the
Placement/Archaeology pair. typeorm reads 36.0% of a 342-atom denominator.

### 3.2 What it buys: coverage, which is the Companion argument

`progress.ts` promotes a node only as a passed subject or as a correctly picked key member, so a node
in neither position is permanently fogged whatever the player does.

| repo | fogged by the whole four-verb deck | still fogged with `upstream` |
|---|---|---|
| ark | 60 | **28** |
| hono | 149 | **65** |
| graphql-js | 201 | **83** |
| kysely | 248 | **166** |
| typeorm | 2,563 | 2,494 |

**It roughly halves the permanently-fogged set on four of five repos.** That is the property that
made Companion worth building — reaching files the existing deck structurally cannot — rather than a
fifth question about the same files.

## 4. What is proposed, and what is honestly still unknown

**Proposed**: refuse `cycle` permanently, on §2. Build `upstream` behind two static gates — the
per-board depth-1 score and the `r ≥ 0.639` end-game bound — if the owner wants tier-2-adjacent
content at this price.

**Three things this does not claim.**

1. **`upstream` is not one of tier 2's three questions.** It is a fourth, and it grades the tier-2
   *skill* (imports versus imported-by) rather than answering *"which way do dependencies point"*,
   *"what is a hub"* or *"where is the layering violation"*. Those three remain exactly as ADR-0043
   left them: two blocked by decision 1, one refused here. **This does not close the tier-2 gap; it
   routes around it.**
2. **It is the same mechanic as Blast Radius.** Set selection over transitive reachability, in the
   other direction. Whether reversing the arrow teaches anything the forward question does not is
   unmeasured and is the sort of claim `docs/experiments/0001` exists to settle.
3. **The two gates' combined cost is not measured.** They are scored independently above and their
   overlap is unknown, so *"149 boards minus 33 minus 81"* is not a number anyone should quote. The
   residual deck is the first thing to measure if this is built, and typeorm's is small enough that
   it may not survive at all.

---

## 5. The review, and why `upstream` is refused

A Fable review re-ran both probes and **reproduced every table in §2 and §3 to the digit** on the
corpus commits — the 1,326/1,326 containment, the 111-of-114 leak, both hover tables, both disclosure
percentages, the fog table. The document's instruments were sound. Its conclusion was not, and §4's
own third caveat — *"the two gates' combined cost is not measured"* — is the hole the whole argument
walks through.

### 5.1 The mistake, stated plainly

**Every benefit was measured on the ungated, uncapped deck; every cost was measured per board.** Put
the same boards through this document's own two gates and the product's own cap and the case
disappears. Re-derived here with an independent instrument (`scripts/probe-upstream.ts`, extended):

| repo | boards | depth-1 gate | end-game gate | **union gate** | **residual** | **shipped** | Blast Radius deck |
|---|---|---|---|---|---|---|---|
| ark | 149 | 33 | 81 | **127** | **22** | **22** | 40 |
| hono | 309 | 57 | 182 | **251** | **58** | 54 | 54 |
| kysely | 328 | 20 | 81 | **127** | **201** | 75 | 75 |
| graphql-js | 404 | 67 | 15 | **77** | **327** | 69 | 69 |
| typeorm | 171 | 150 | 104 | **162** | **9** | **9** | 58 |

On the four cap-limited repos the shipped deck is **the same size as Blast Radius's**, because the cap
binds either way. On ark it is **smaller — 22 against 40**. And on typeorm — the taint-limited repo,
the only one where mirror-certification buys anything, and the entire point of §3's structural
argument — it is **9 boards against 58**. §3.1 already said typeorm would be the repo where this verb
is worse supplied, quoting 21 from one gate; both gates make it 9. **The supply case has no repo left
to stand on.**

The gates also cannot be scored separately, which is how §3.1 scored them. A player at end-game holds
both channels on one board: hover an unproven candidate for the direct slice, an understood one for
the deep slice. Precision stays 1.000 either way, so the **union** is the guess, and it beats band A
on 127 of ark's 149 where the two gates independently caught 33 and 81. The residuals above are the
union's.

### 5.2 Two figures that flattered the recommendation

**"Three to seven times Blast Radius's supply" crosses its units.** It divides this verb's *uncapped
supply* by Blast Radius's *capped deck*. In like units — ADR-0042 §1.1's survey, same commits — blast
supply is 88 / 218 / 331 / 220 on ark / hono / kysely / graphql-js against 149 / 309 / 328 / 404 here.
So **1.7× / 1.4× / 0.99× / 1.8×**, and **kysely is less**. The headline of §3 is the one comparison in
the document that crosses units, and it does so by 2–4× in the direction that sells the verb.

**The fog claim dies with the gates.** §3.2 counted coverage over all boards including the ones §3.1
proposes to refuse, and a refused board proves nothing. On the union residual: ark 60 → **56** (not
28), hono 149 → **139** (not 65), kysely 248 → **214** (not 166), typeorm 2,563 → **2,560**.
graphql-js 201 → **104** is the one repo where the claim roughly survives. The Companion analogy —
*reaching files the existing deck structurally cannot* — holds on one repo of five.

And §3.2's sentence *"roughly halves … on four of five repos"* contradicted its own table before any
of this: kysely's row read 248 → 166, which is a third.

### 5.3 Two exposures the document never measured

**Reverse disclosure, and it is larger than the direction that was measured.** §3.1 measured *blast
reveals → upstream keys* at 1.7–9.5% and called disclosure mild. Run the other way — an `upstream`
reveal states *"X depends on Y"*, which is an atom of **Y's** Blast Radius key — the guess decides
**40 of typeorm's 58 blast boards, 22 of hono's 54, 11 of graphql-js's 69, 10 of ark's 40** on the
ungated deck. That is ADR-0019 §7's landmine by name (*"the direction it runs in is the one nobody
looks at"*), and `CLAUDE.md` requires the check before adding a verb. The union residual happens to
suppress it to 0–1 boards per repo — by correlation with the end-game gate, not by construction, and
closing it properly needs ADR-0022's `decidedBy` machinery, which this document neither prices nor
mentions.

**The inspector, unexamined by the author who found it the day before.** ADR-0043 §9.2 showed
`imported by: 0` resurrecting route D's exploit on 800 of 1,436 boards. The mirror applies here: a
truth member has in-degree ≥ 1 by construction, so every in-degree-0 candidate is eliminable and
recall stays 1. The fix is cheap — a distractor floor of in-degree ≥ 1 — but it is design this
document does not contain, and not noticing it one day after writing ADR-0043 §9.2 is the failure that
section is *about*.

### 5.4 Two corrections that do not change the verdict

**`cycle`'s refusal stands, but *"permanently"* is struck.** One formulation was never priced: ban
SCC-mates from Blast Radius candidate pools, which is legal under ADR-0008 (unsampled dependents are
already banned) and makes the taught component worthless against blast boards. Measured cost: **0
blast boards die on all six repos**; 114 of hugo's 156 keys and 22 of kysely's 75 would re-sample. It
still probably fails — a passed subject's *drawn* radius contains its mates under decision 1,
reopening the leak from the other side, and ark still has two subjects with a key of size one — but
the record should say it was not priced rather than imply nothing was left to try.

**Guardrail 4 has a language gate this document omits.** The certification argument is sound where
dependencies *are* imports: cycles are handled, `probable` edges refuse the board, and an unresolved
site anywhere in the closure refuses it, so a clean closure is the true closure. But ADR-0003's
landmine names the exception — a dependency that is not an import records no unresolved site — so on a
Python repo a distractor could be a real dynamic dependency (562 such pairs on django). `upstream`
would need `GRADED_IMPORT_LANGS` exactly as Blast Radius does, and §3 never says so.

**And every gate figure describes a generator nobody wrote.** The probe samples keys by node-id sort;
ADR-0008 consequence 2 requires stratified sampling by distance, which changes the direct share of
every key and therefore both gates' firing rates. ADR-0043 §9.1 carried that caveat for its own
numbers and this document did not.

### 5.5 The decision

**`upstream` is refused.** Not because it is unsound — with the conditions in §5.3 and §5.4 it could
be made sound — but because after them it ships a deck the same size as Blast Radius's on four repos,
smaller on the bootstrap, a ninth of the size on the one repo it was supposed to rescue, and it buys
real fog coverage on one repo of five. That is a Companion-sized build plus new cross-verb disclosure
machinery, for a mirror of a verb that already exists.

**The conditions under which it should be re-opened** are written down so the refusal is checkable:
gate on the union rather than on two independent scores; declare its atoms through `disclosure.ts` and
refuse boards whose reveals assemble a blast key past the bar; floor distractors at in-degree ≥ 1;
restrict to `GRADED_IMPORT_LANGS`; sample truth stratified by distance and **re-score both gates**,
since every figure here is about the id-sorted sample. If a future session changes the deck cap, or
ADR-0008 decision 1's full-radius half, the first two rows of §5.1's table are what to re-measure.

### 5.6 What the review says to do instead

Recorded here rather than acted on, because it is a different decision. The measured problem is the
*opening*: three cold playtests at 4/10, 5/10, 4/10, all naming the first fifteen boards. The review's
finding is that **no ordering rule can fix that inside Blast Radius**: on all four reference repos,
**15 of 15** of the easiest blast boards have a subject with zero non-leaf dependents, and there are
**zero** boards at difficulty ≤ 0.30 whose subject has even one. That is by construction — §8.4 makes
a real subject a hard question, which is ADR-0040's ρ = 0.96 read from the other end — so the easy
boards are structurally the fixture-shaped ones (`jsr.json`, `package.json`, `keys.test.json`, eight
`__testUtils__` files on graphql-js).

The easy-and-real boards already exist in the **other** verbs: Companion's easiest fifteen are 0 of 15
test-shaped on all four repos, with landmark subjects, and they are not lookups. So the proposal is
one rank term — a blast board whose subject has zero non-leaf dependents sorts last — inserted between
`progress` and `difficulty` in the selector. Ordering only: no board lost, no atlas change, no new
disclosure. **That is the next thing to measure, and it is a smaller change than anything in this
document.**
