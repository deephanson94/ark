# ADR-0019 — Archaeology asks a place what happened to it

- **Date**: 2026-08-08
- **Status**: accepted, and **built** — the verb ships. Every decision below stands as written; the
  numbers do not, and the corrections are in *[Re-measured against the real
  generator](#re-measured-against-the-real-generator)* at the foot of this document. That section is
  the first task this ADR set for the session that implemented it, and it changed one thing about the
  design: **`recentK` is in the gate set and `oldestK` fires on neither repo**, which is the reverse
  of what decision 6's table predicted.
- **Superseded status line**: *"decision only; no generator exists yet"* — true until the verb was
  built. NORTH-STAR §6.2's wording cannot be built, so this records what replaces it and what that
  costs.
- **Bumps** (when it is built): `ATLAS_VERSION` 6 → 7. `Challenge.candidates` and `Challenge.truth`
  widen from `NodeId[]` to the node-or-commit union; `Evidence` gains a `history` variant; `VerbId`
  gains `archaeology`. `docs/atlas-format.md` §2 and §3.6 in the same commit (guardrail 5).
- **Extends**: [ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md)'s invariant
  to a fourth verb; inherits [ADR-0007](./0007-pass-threshold-and-the-three-to-one-choice-set.md)'s
  sizing rule unchanged; extends [ADR-0012](./0012-an-answer-key-is-issued-once.md) from answer keys
  to the *facts inside them* (decision 7); inherits three of
  [ADR-0018](./0018-a-subject-is-a-place-or-an-event.md)'s refusals, one of them for a **different
  mechanism** (decision 4).
- **Context**: M4's third and last verb, and the milestone closer.

---

## The question, and why it is not the one §6.2 asks

> *"This file was rewritten three times. What problem kept recurring?"* — ground truth: commit
> messages + reverts.

The second sentence is not gradeable. Naming a recurring problem is a free-text judgement, so
grading it needs either a model in the path (guardrail 3) or an answer key nobody can derive
(guardrail 4). The first sentence is gradeable and is already printed for free in the inspector's
`commits` column, which makes it trivia rather than a question (pillar 3).

**The reduction is recognition instead of generation.** You cannot ask a player to *name* what kept
recurring; you can ask them to *recognise* it. Show a file, show twenty commits from the repo's own
history, and ask which of them landed here. The recurring problem is what the answer key **is** —
the player reads it off the reveal — and nothing about the grade depends on their being able to
articulate it.

```
subject   a file
board     commits
truth     the commits whose own recorded file list names the subject
```

This is the question an experienced developer actually asks when handed a file they do not
understand: `git log -- that/file`. It tests *locating responsibility* — the second of the two
skills pillar 3 names — because commit messages describe changes in **intent**, and matching intent
to place is the whole of it.

### It is Placement transposed, and that objection has to be met head-on

Placement asks *commit → which files?* This asks *file → which commits?* They are the two
projections of one incidence relation, and pretending otherwise would be dishonest. Three things
make it a different verb rather than the same one twice:

- **The direction of inference differs.** Placement reasons from prose to code — *given this change,
  where does it go?* — which §5 puts at tier 6, Judgment. This reasons from code to prose — *given
  this place, what has been done to it?* — which is §5's tier 5, History. A player can be good at one
  and bad at the other.
- **The subject differs, and therefore so does what a pass is worth.** A Placement pass un-fogs the
  files it named and nothing else, because its subject is not on the map. An Archaeology pass un-fogs
  **the subject**, which is a file, and its members are not on the map at all. The two verbs lift fog
  in opposite directions.
- **The overlap is measured, not assumed, and it is large enough to need its own rule.** 55.6% of
  this repo's Archaeology key members are facts a shipped Placement reveal already states outright.
  Decision 7 is that rule, and it is the most consequential decision in this document.

---

## Decision

### 1. A member is a place **or** an event, exactly as a subject already is

ADR-0018 widened `Challenge.subject` to `NodeId | CommitId` and told the two apart by the id's own
prefix. This widens `candidates` and `truth` the same way, with the same discriminator and the same
validator rule: each arm is checked against the section that must contain it, never "either,
whichever exists".

**The union is renamed off `SubjectId` in the same commit.** It was named for the one role it had;
it now has two, and a type named for a role invites exactly the *which role is this?* reasoning that
produced ADR-0018's nine defects. One union, one name, no second field — the shape of that argument
is unchanged, only its scope.

### 2. The invariant, for the fourth time

```
candidates ∩ touchedBy(subject) = truth
```

Every candidate is either in the answer key, or a commit **whose own recorded file list does not
name the subject**. A file touched by twelve eligible commits ships a six-commit key and the other
six appear nowhere on the board. No middle band, no boundary to guess at.

The certification is Placement's positive record, transposed: absence from *one commit's own list*.
So, as there, the walk window cannot make it wrong — retained commits are the newest walked, so a
walk that stopped early removes whole commits and corrupts none. There is no `windowTruncated` here
either, and the reason is inherited rather than re-derived: ADR-0014 needs it because Companion
certifies by absence from a *matrix*, which four independent channels erode.

Two limits are inherited whole and are not certified away. `alias` is only as good as `git log -M`'s
rename detection, so a rename with a heavy rewrite hides an older commit's touch of today's file —
NORTH-STAR §7.2's stated trade for the entire product. And `churn` counts every *walked* commit while
truth samples the *retained* ones, so the prompt states neither count.

### 3. The key is a cross-section of the file's life, sampled in date order

`truth` is `size` commits taken at even intervals across the subject's touching commits **sorted by
date**, `size` bounded by ADR-0007's 3:1 rule (6 at a choice set of 20).

Date order, not the atlas's own order, and the reason is ADR-0018 decision 4's verbatim: `NodeRef`
and node-id orderings are FNV-1a hash shuffles, so spreading over them is stable and meaningless.
Here the meaningful axis is time — a sample spread across it is *the arc of the file's life*, which
is the thing the verb is asking about, rather than its six busiest weeks.

The cost of that choice is decision 6's strongest gate heuristic, and it is paid rather than dodged:
spreading over dates always includes the oldest and the newest touching commit. Interior sampling was
measured as the alternative and rejected — see the rejected list.

### 4. What is refused, and the shallow clone is a **different mechanism here**

| refusal | why |
|---|---|
| `shallowClone` | see below — guardrail 4 |
| `truncated` | `maxCommitFiles` cut a commit's list, so a non-mention is not a non-touch — guardrail 4 |
| `uncertain` | contested rename lineage — barring the *subject*, and any commit whose file list contains a barred node. Not "in any role" as a first draft had it: this verb's members are commits, and a commit has no lineage (ADR-0014 decision 4) |
| `wide` | a commit over `history.wideLimit`: removed from **both** roles, so it is simply not on the board — pillar 3, as in ADR-0018 |
| `tooFewCommits` | fewer than two eligible commits touched the subject |
| `tooFewDistractors` | not enough certified non-members inside the window (decision 5) |

`truncated` is tested before `wide` for ADR-0018's reason exactly: after it, with the shipped limits,
the branch can never be taken.

> **The shallow-clone refusal is inherited, and copying it without re-deriving it would have been the
> mistake ADR-0018 shipped.** There, a `--depth N` clone's boundary commit — which git diffs against
> the empty tree and reports as *adding the entire worktree* — corrupted **one commit's** answer key.
> Here the same record says that commit touched **every indexed file**, so it would enter the answer
> key of *every subject in the repo* as a member that never touched it. Same signal
> (`history.present && repo.root === null`), same whole-repo refusal, and a blast radius larger by
> the file count. It is written out because ADR-0018's own lesson was that a refusal justified for
> one channel and applied to another is how the wrong answer key got in.

### 5. The date window is a **pool filter**, and it retires a gate heuristic by arithmetic

Every candidate must be dated inside the subject's own `[firstSeen, lastSeen]`.

This excludes no truth member, by construction: `firstSeen` and `lastSeen` are the min and max over
every walked commit that touched the file, so every eligible toucher is already inside. What it
excludes is *wrong answers from outside the file's lifetime*.

The reason is the trap CLAUDE.md's Next action names, and it is the sharpest one this verb has. **The
inspector prints every node's first seen and last seen; every candidate row shows a date.** So "tick
every commit inside the range" is free, needs no idea of what changed with what — and its **recall is
1.0 by construction**, which means its F1 is `2p/(1+p)` and it clears band A whenever precision
reaches 0.64. Measured without the filter: best 0.52 here and best **0.77** on hono, with **17 of
hono's boards scoring between 0.70 and 0.78**. That is not a plateau, it is the edge of a cliff, and
the gate argument ADR-0008 built explicitly rests on not sitting on one.

**Note precisely what that does and does not say, because an earlier draft called it "the dominant
guess" and claimed the filter "retires a gate heuristic".** 0.77 is *below* the 0.78 bar. A `window`
heuristic in `COMMIT_TRACE_HEURISTICS` would have fired **zero** times on either repo, filter or no
filter — so nothing is being retired, and the honest justification is entirely about board quality:
without the filter, half of hono's deck hands a high B to someone reading two dates.

With the filter, the guess selects the *whole board*, so it is exactly ADR-0007's select-everything
exploit. The **bound** is the sizing rule, not a measurement: the loop requires `distractors > 2·truth`,
hence `candidates > 3·truth`, hence `2t/(t+c) < 0.5 = PASS_THRESHOLD` for every board it permits, at
any `candidateCount`. The measured maximum is 0.46, and a 19-candidate six-key board — which the rule
allows — would read 0.48. Both are below the threshold because the arithmetic says they must be, and
that is the claim; the 0.46 is an observation, not a ceiling.

**So `window` is not a gate heuristic and never could have been a useful one.** It is an invariant,
and one rule beats two — every leak ADR-0014 and ADR-0016 found was a rule that lived twice.

One consequence is forced and is named rather than smuggled: with the filter on, *every* pool member
is contemporary, so "contemporary" stops being a distractor strategy and §8.3's strategies pick
**inside** the window instead of competing with it. The counterfactual in the table below changes the
filter and that forced consequence together, because they cannot be separated — ADR-0018's
two-knobs-one-name error, avoided by saying so.

### 6. `COMMIT_TRACE_HEURISTICS` = {`mentions`, `endpoints`, `oldestK`, `broadKnown`}, and one measured guess is left out

| guess | what it needs | ark mean/best/**fires** | hono mean/best/**fires** |
|---|---|---|---|
| `mentions` — the message names the file | the prompt and the board | 0.130 / 0.67 / **0** | 0.234 / 1.00 / **11** |
| `endpoints` — the commit is dated exactly first-seen or last-seen | the inspector | 0.209 / 0.46 / **0** | 0.284 / 1.00 / **2** |
| `oldestK` — the K oldest rows on the board | the board alone | 0.154 / 0.75 / **0** | 0.460 / 1.00 / **24** |
| `recentK` — the K newest rows | the board alone | 0.190 / 0.50 / **0** | 0.199 / 0.67 / **0** |
| `broadKnown` — the K widest, among commits a reveal has priced | an earlier reveal | 0.537 / 1.00 / **5** | 0.068 / 0.67 / **0** |
| `window` — everything inside the range | the inspector | 0.252 / 0.46 / **0** | 0.304 / 0.46 / **0** |

*fires* = boards where the guess reaches band A, under the shape as decided.

**Each of the four is live on exactly one repo and dead on the other**, and that is the whole argument
for measuring on two. `broadKnown` refuses 5 boards here and 0 on hono; the other three refuse 0 here
and **33** on hono (37 firings across 33 boards — four boards lose to more than one guess, which is
why the two numbers differ and why *refusals* is the one to quote). It is the profile ADR-0018
measured for `recency` — 16 on hono, 0 here — with the same cause: ark is three days old, so its
dates barely vary and its messages rarely name files, while hono's Placement deck is too sparse to
price many widths. **A gate justified from either repo alone would have been half deleted as dead**,
which is now the third verb in a row where that was true.

**`recentK` is measured and left out.** It fires on neither repo, and CLAUDE.md's landmine is
explicit: *count how many times a path fires on a real repo before you write tests around it.* It is
recorded here so a later session does not add it on the same intuition and find it dead again — and
with the caveat that it is dead *under this configuration*: the rejected interior-sampling variant
revives it on hono, which is the honest reason the sentence is not "recentK cannot fire".

`window` is absent for decision 5's reason, which is stronger: it cannot fire, by arithmetic.

`directory` is absent for ADR-0018's reason, unchanged — the *members* have no directory.

**Nothing on Archaeology's own board or reveal may print a commit's width** — and that is not
sufficient, which the first version of this paragraph got wrong in the worst available way. It
measured the leak and then declared, two sentences later, that "the leak it prices is one the product
does not have". The product has it. Placement's reveal prints `touched` for its own subjects, so a
player who has played Placement knows the width of those commits, and *"tick the K widest"* is as
structure-blind as a guess gets.

Measured, restricted to widths a reveal has actually printed: **band A on 5 of this repo's 27 boards,
and 0 of hono's 54.** The asymmetry is decision 7's: on hono the disclosed commits leave the answer
keys and take the leak with them, while here Placement's deck covers 39 of 46 eligible commits, so
those commits stay on the board as perfectly legitimate *distractors* whose width is known.

**So `broadKnown` is the fourth gate heuristic**, scored off the same disclosure record decision 7
introduces — which carries two kinds of fact, *(commit, file)* for the exclusion and *(commit, width)*
for this. **Cost: 5 boards here (27 → 22) and none on hono.** The alternative — accepting five boards
a completing player can win on width alone — is the option ADR-0014 decision 7 exists to refuse, and
"we measured it and shipped it anyway" is not a sentence this repo should add to its record.

### 7. A fact an earlier reveal has already stated is not an answer

**This is the finding that changed the design, and it was not visible from either verb alone.**

Placement's reveal names the files a commit touched. Each of those is the atom *"commit C touched
file F"* — which is exactly a member of F's Archaeology answer key. Measured against the shipped
decks:

| | ark | hono |
|---|---|---|
| (commit, file) facts Placement's reveals state | 188 | 142 |
| Archaeology key members | 214 | 649 |
| **already disclosed** | **119 (55.6%)** | **104 (16.0%)** |
| boards whose **entire** key is disclosed | **15 of 66** | 1 of 172 |

On the repo NORTH-STAR §11 makes the first level, more than half the new verb's answer key is
already given away, and fifteen boards are fully given away. The asymmetry is structural rather than
lucky: ark's Placement deck covers 39 of its 46 eligible commits, hono's 54 of 475. **The bootstrap
repo is the worst case**, which is the whole reason pillar 6 makes it the one that has to work.

**Decision: a commit may not be an Archaeology answer for file F if a challenge generated before it
already discloses that it touched F.** The commit is then off the board entirely — it *did* touch F,
so it can never be a distractor, and the invariant is what forces that.

> That sentence is load-bearing and the first version of the measurement got it wrong. The probe
> filtered the toucher list *before* computing membership, which dropped the excluded commits into
> the distractor pool — a board offering a commit that really did touch the file, marked wrong. A
> wrong answer key, in the counterfactual that was about to justify the rule. Re-measured with
> membership taken from the unfiltered set; the numbers below are the corrected ones, and they moved
> by less than the deck cap could show, which is the direction that gets believed.

**Cost, measured**: the deck falls **40 → 27** here and **54 → 54** on hono (still at the cap).
Thirteen boards on the bootstrap repo, nothing on the reference repo. It also takes hono's cross-verb
width leak with it (`broadKnown`, 2 boards → **0**) and *not* this repo's (8 → 5), which is why
decision 6 has to gate what is left. And it moves ark off its deck cap — 27, then 22 after that gate,
against a cap of 40 — so **on the bootstrap repo it is supply that binds rather than the cap.** (An
earlier draft called that "the only one of the four verbs of which that is true", which is false:
Placement ships 39 against the same cap of 40. Superlatives about a repo that indexes itself rot
faster than the numbers they are built from.)

**Why the strong version rather than a threshold.** Refusing only the fully-disclosed boards, or
scoring disclosure as a gate heuristic, would both need the *same* coupling to the already-generated
deck — so weakening the rule buys none of the architecture back and only gives up the benefit.

**Why exclude rather than accept.** The counter-argument is real and nearly won: remembering that
commit C touched `save.ts` from a reveal an hour ago is *knowledge of the repo*, and recall is not
Ctrl+F — that is spaced repetition, which is the product working. What settles it is ADR-0011 and
NORTH-STAR §9's own line: a field note *"accumulates facts you have proven you know, not facts you
were shown"*. A board that can be answered from a reveal cannot honestly write a note claiming it was
**proved**, and fifteen boards on this repo are answerable that way in their entirety.

> **The word "previously" was doing work this document cannot support, and a review caught it.** The
> first version argued from *"a board whose entire key was previously shown"* — which assumes the
> player meets Placement before Archaeology. **Decision 8 says the opposite**: tier ascending serves
> tier 5 before tier 6, and a commit subject is reachable only through the guide, so for a player
> following the deck in order no Placement reveal exists yet.
>
> The repair is not to pick the other order — it is to stop arguing from order at all, because
> **order is not controllable**. `selector.ts`'s `rankLess` puts `attempts` above `tier`, so a board
> failed once returns *after* the tier-6 deck; the map's click path serves whatever a node's bucket
> holds first, in atlas-id order, which is not tier order (see decision 8); a player can jump
> anywhere; and a reindex reshuffles both decks. **A fact that can be read off one board's reveal and
> ticked on another is a pillar-3 problem in whichever order they arrive**, and that is the argument.
> The same order-free reasoning is what makes `broadKnown` a gate heuristic in decision 6 — the first
> draft had these two paragraphs leaning on *opposite* temporal assumptions, which is how one of them
> ended up denying a leak it had just measured.

**This does not contradict ADR-0012, and the distinction matters.** §3.6 and ADR-0012 say uniqueness
is *within-verb*, because *"two different verbs may honestly share an answer set — they are asking
different questions about the same files."* That is about a **set**. This is about a single atomic
**fact** being asserted by one verb and asked by another. The rule generalises ADR-0012 from keys to
their contents, and the ordering is the same kind of deterministic first-come rule: whichever verb
asks a fact first keeps it, in generation order, and Placement runs first.

**The architectural cost, stated plainly.** `Verb.generate(atlas, options)` sees no other verb's
output today, and this needs it to. The shape that keeps the seam intact is a **verb-blind
accumulator**: each verb declares the facts its reveal gives away, `build.ts` accumulates them in
generation order, and a later verb reads a `ReadonlySet` of facts rather than another verb's deck.
Nothing then names a verb, which is the property M4 spent its budget on. Implementing that is the
first task of the session that builds this.

### 8. Tier 5, and a player meets it before Placement and after everything else

§5 puts History at tier 5 and this is squarely it. The selector serves tier ascending, so on this
repo the deck becomes **80 tier-3 questions, then 22 tier-5, then 39 tier-6**.

> **The tier order governs the guide, and not the map — which is the primary path.** `challengesById`
> buckets a node's questions in **atlas order**, which `build.ts` sorts by challenge **id**, and
> `challengeFor` serves the first unanswered one. `archaeology-…` sorts before `blast-…` and
> `companion-…`, so **clicking a disc would open the tier-5 history question before the tier-3 import
> question**, on every subject that carries both. `main.ts`'s own comment states the rule the id
> prefix would falsify — *"a node carrying both verbs offers Blast Radius until it is answered and
> then Companion"* — which is CLAUDE.md's rule-stated-in-words landmine with the rule living in a
> comment rather than an ADR. The implementing session must order a bucket by tier explicitly rather
> than inherit an alphabetical accident; naming the verb `archaeology` and calling it done would
> silently invert the curriculum on the path `selector.ts` calls primary.

Two further consequences, both stated because a later session will otherwise discover them:

- **Archaeology is served before Placement**, which pushes tier 6 further out still. That is §5's
  progression working — the tiers *are* the curriculum — not an accident of ordering.
- **A short session still never leaves tier 3.** With three tiers and ~141 questions here, tier 6 is
  effectively unreachable in casual play. ADR-0018 noted this for one tier; a second one above tier 3
  makes it a real progression question rather than an observation, and it is listed below as
  something this decision does not settle.

### 9. `channel: 'nothing'`, and the reveal says nothing about what else a commit touched

There is no cone to widen and no wire to draw: an Archaeology pass un-fogs its subject, which is a
node, and its proved members are commits, which have no square on the map. Second user of that arm.

Checked in code rather than assumed: `tracedRadius` is built from `subjectsPassed(progress, liveness,
'blastRadius')`, keyed to that verb explicitly, so passing an Archaeology board about F does **not**
license drawing F's import cone. That was the `tracedRadius` leak, and the fix that closed it holds
here for free.

**And the reveal must not name the other files a commit touched.** It would hand over Placement's
answer key for that commit — ADR-0014's finding 3 exactly (Blast Radius's reveal handing over
Companion's key, with the count), running in the other direction. The reveal names the commit, its
date and its message, and stops.

---

## Supply, measured on two repos

Everything below is the shape as decided, including decision 7. Measured at `e44a823`.

| | ark (bootstrap) | `honojs/hono` |
|---|---|---|
| nodes | 128 | 425 |
| retained / walked commits | 51 / 67 | 500 / 2,758 |
| eligible commits | 46 (5 `wide`) | 475 (25 refused: `uncertain` and `wide`, counted in that order here — ADR-0018 tests `wide` first and reports 24 + 1) |
| files touched by ≥ 2 eligible commits, after decision 7 | 28 | 158 |
| **deck shipped** | **22** — supply binds | **54** — the cap binds |
| answer keys | 2–6 commits | 2–6 commits |
| `ctrlF` | 5 (all `broadKnown`) | 33 |
| `duplicateKey` | 1 | 10 |
| nodes it lifts out of unprovable | 1 of 16 | 14 of 154 |

**Three populations appear in this document and they are not the same number**, which an earlier
draft left for the reader to work out: **66** files here are touched by ≥ 2 eligible commits and are
what decision 7's disclosure table is measured over; **28** survive decision 7; **22** ship. When
decision 7 says "15 of 66 boards", those are candidate subjects, not shipped boards.

Counterfactuals. **Every row holds all the other decisions fixed** — including decision 7, which an
earlier draft of this table did not, so its figures described a shape this document does not
propose:

| change (one decision, everything else as decided) | ark deck / `ctrlF` | hono deck / `ctrlF` |
|---|---|---|
| as decided | 22 / 5 | 54 / 33 |
| `broadKnown` out of the gate (decision 6's last paragraph) | 27 / 0 | 54 / 33 |
| decision 7 off — disclosed members allowed back | 40 / 1 | 54 / 35 |
| decision 5 off — no window filter, `contemporary` becomes a strategy | 24 / 4 | 54 / 67 |
| **no wrong answer from inside the window, anywhere** | **0** | **3** |
| `mentions` strategy dropped from the mix | 27 / 0 | 54 / 57 |
| `companion` + `neighbour` strategies dropped | 27 / 0 | 54 / 35 |

Rows 3–7 are measured with `broadKnown` out of the gate, so read them against row 2 rather than
row 1.

The fourth row is the one that measures the threat, and it exists because ADR-0018 learned that
deleting a strategy measures almost nothing when the padding walks the same ordering anyway. It is
the whole argument for decision 5 in one line: with no contemporary wrong answers the date-range
guess scores a flat **1.00** on 19 of this repo's boards and 148 of hono's, and there is essentially
no deck left to ship.

The third row shows decision 5 is not only about board quality: without the filter this repo *loses*
three boards as well, because `oldestK` starts winning.

The sixth row is reported because it is a null result: **`companion` and `neighbour` change no
board's outcome on either repo.** They are kept on §8.3's grounds — a wrong answer that teaches is
worth having whether or not it moves a count — and that is a judgement, stated as one.

**Read the ark column as a floor and not as a plateau.** This repo is three days old: its entire
history has **three distinct commit dates**, so `[firstSeen, lastSeen]` covers nearly everything and
every date-derived signal here is close to degenerate. Every measurement above is of one commit of a
repo that indexes itself, so all of them drift; the invariants do not.

---

## What was measured and found dead

Both candidates the previous session named are dead, and re-measuring at this commit corrected one of
the two figures on record.

| | ark | hono |
|---|---|---|
| commits whose subject looks like a revert, in the retained window | **0** | **1** (10 in 2,758; only 12 body references resolve to a commit the clone holds) |
| **retained** commits carrying an issue number | **0** | 359 |
| **distinct** issues among them | **0** | 356, of which **3** have more than one commit |

**Revert detection** finds nothing on the bootstrap repo. A verb with no supply on the repo NORTH-STAR
§11 makes the first level is not a verb.

**Issue linkage** — NORTH-STAR §2's own example — is **0 on this repo and degenerate on hono**: 356
distinct issues across 359 retained commits, so *"which commit closed #N"* is a 1:1 lookup rather
than a question. It would also need the commit **body**, which `history.ts` does not keep.

> **This row said 16 and 364/368 until a review checked it, and getting it wrong is more instructive
> than the row itself.** This repo *does* now carry sixteen `#N` references — but every one of them
> is a `Merge pull request #N` subject, and `git log --name-status` without `-m` emits **no file list
> for a merge commit**, so `touched.size > 0` fails at `history.ts:177` and **not one of the sixteen
> is ever retained**. The atlas says 0. The CHANGELOG's original 0 was right, and the "correction"
> that replaced it measured the *walked git log* while the row is about *verb supply*, which only
> retained commits can provide. Hono's numbers went the same way — 364/368 came from counting `#N`
> tokens in git subjects, where one subject may carry two; the atlas keeps only the first
> (`history.ts:299-304`), so *distinct* can never exceed *carrying* and my figures were not merely
> imprecise but impossible in the shape they claimed to describe.
>
> The landmine this actually illustrates is **not** measured-constant drift, which is what the wrong
> version cited. It is narrower and worse: **I re-measured with a different instrument than the one
> that decides the question, and read the difference as drift rather than as a bug in my
> measurement.** Everything here is now measured off `atlas.json`.

**Merge commits are structurally invisible to this verb**, and that follows from the same fact. They
are walked but never retained, so they can be neither truth nor candidate — harmless for guardrail 4,
since a commit that cannot reach a board cannot corrupt a key, but it means decision 3's "arc of the
file's life" silently omits every merge on a repo that does not squash, including an evil merge that
really did change the subject. Stated because a decision record that re-derives the shallow-clone
refusal to the letter should not leave this one implicit.

**Birth cohorts** — *"which files arrived with this one?"* — die on the same repo: ark's 128 files
have **three** distinct `firstSeen` dates, so the question has three answers.

**Rename lineage** — *"which of these files has moved?"* — is 1 node here against 77 on hono. Dead in
the same place, for the same reason.

**Churn ranking** — *"which of these is busiest?"* — is refused before it is proposed: `gate.ts`
already scores it as structure-blind, and the inspector prints it.

---

## Rejected alternatives

**Keep members as files and ask a history question about them.** Every file→file relation git
supports is either co-change (Companion) or a date comparison (a column scan the inspector prints).
The transpose is where the remaining supply is; that is why this verb's members are commits despite
what that costs.

**Interior sampling — drop the oldest and newest touching commit from the key** to remove `oldestK`
by construction rather than by gate. Measured against the decided baseline it buys **nothing**:
hono's `oldestK` firings are 24 either way, while `duplicateKey` rises 10 → 14, `recentK` *starts*
firing (0 → 1) and this repo's deck falls 27 → 26 (measured against the pre-`broadKnown` baseline). It also removes a file's birth and its most recent
change from the key, which are the two most legible events in its life. A gate that refuses 24 boards
the deck cap immediately backfills is both cheaper and more honest.

**Score the date-range guess in the gate instead of filtering the pool.** Two statements of one rule,
the weaker one able to go stale. See decision 5.

**Accept the Placement overlap on the "recall is not Ctrl+F" argument.** Nearly won; lost to
NORTH-STAR §9's proved-versus-shown line and to fifteen fully-disclosed boards. See decision 7.

**Refuse only the fully-disclosed boards, or score disclosure as a gate heuristic.** Both need the
same coupling to the already-generated deck, so they cost the architecture and save none of it.

**A parallel `memberKind` field, or asking the verb whether a member is drawable.** Rejected verbatim
with ADR-0018's reasoning for subjects: a fact about the id must not become a fact about the verb.

---

## Consequences

- **`Verb.generate` gains a verb-blind disclosure set**, and `build.ts` accumulates it in generation
  order. This is the first time one verb's output constrains another's, and it is the price of
  decision 7.
- **The member widening is real work, not a rename.** Nine places assumed a *subject* was a node
  (ADR-0018); these assume a *member* is a file. Found by grepping every read, as that ADR's lesson
  prescribes:
  1. **`save.ts`'s `asIds` filters members with `isNodeId`**, and the comment beside it states the
     rule in words — *"`proved` stays node-only, because a member is always a file whatever the
     subject is."* That sentence is false the moment this verb exists, and a pass it filters to empty
     is erased by the next write. **Third instance of this exact class in that one file**, after
     `VERB_IDS` and `asPass`.
  2. `progress.ts`'s `deriveFog` adds every proved member to `understood` and `surveyed`, which are
     sets of files — fog on a square that does not exist.
  3. `progress.ts`'s `livenessOf.holds` builds a verb's population by scanning `atlas.nodes`, so
     every Archaeology member would decay to nothing on restore.
  4. `notes.ts` resolves each member with `nodeAt(graph, refById.get(member))` and `continue`s on a
     miss, so the note would vanish in silence — ADR-0018's defect 1, one field over.
  5. `challenge.ts` renders every candidate row through `pathOf` and sorts by the result.
  6. `validate.ts` requires every candidate to be a node in this atlas.

  Free, already: `progress.ts`'s `applyGrade` filters candidates with `isNodeId`; `livenessOf.exists`
  already answers for both arms; `ties.ts` is gated on `channel`; `score.ts` and `selector.ts` treat
  ids as opaque strings; `tracedRadius` is keyed to `blastRadius` by name.

  Two more the first draft of this list missed, both found by review:
  7. **`gate.ts`'s `guess()` resolves every candidate through `nodeAt`** (`gate.ts:186-217`). Three of
     the four heuristics above read a *commit's* message, date or width, so the scorer needs a
     commit-side path — implied by naming the heuristics and never listed as work.
  8. **The type list in this ADR's own header is short.** `Challenge.candidates` and `.truth` are the
     schema half; `Grade.correct` / `.missed` / `.spurious`, `SetAnswer.picked`, `RevealNote.id`,
     `NoteWeights`, `ProvedFile`, `Pass.proved` (the **stored save shape**) and `Verb.stillHolds`'s
     `member` parameter are all `NodeId` today. Every one is an alias of `string`, so **the compiler
     will report none of them** — which is ADR-0018's landmine verbatim, and the reason that ADR's
     nine defects existed at all.
- **A cross-verb key collision is not expressible.** Archaeology's `truth` holds commit ids and
  Placement's holds node ids, so the `(verb, truth)` uniqueness check the atlas test now uses cannot
  false-positive between them.
- **Difficulty (§8.4)**: `breadth` is the count of eligible commits touching the subject — its full
  population before sampling; `reach` is the share of the key whose message shares no name token with
  the subject, i.e. how much of the file's history is *not* self-describing; `surprise` is measured
  against `oldestK`, the strongest guess the board alone hands over.
  **ADR-0014 decision 7's three-way alignment does not hold cleanly here, and saying it did was an
  overclaim.** There the UI giveaway, the naive guess and the gate heuristic are one strategy. Here
  the UI giveaway is the inspector's dates (`endpoints`), the naive guess is the board's own ordering
  (`oldestK`), and the gate holds four. Two legs, not one — which is what the alignment principle
  exists to notice, so it is recorded as a divergence rather than asserted away.
- **The omni-file refuses itself.** A file touched by nearly every commit has almost no certified
  non-members, so it produces no board — the exact file a churn-ranked verb would have made its star.

## The fourth disclosure direction: measured, and deliberately not acted on

Decision 7 checks Placement→Archaeology; decision 9 closes Archaeology→Placement. A review pointed
out that the ADR had checked two directions of six. The other four, now checked:

- **Companion→Archaeology** and **BlastRadius→Archaeology**: clean. Pair counts and import edges name
  no commits, so neither reveal can state an atom of this verb's key.
- **Archaeology→Placement**: closed *by construction*, and the argument is worth stating rather than
  relying on. `F ∈ files(C)` can never be a candidate on C's Placement board, and `F ∈ truth(C)` means
  decision 7 already removed C from F's key. It holds because of the invariant, not because anyone
  arranged it.
- **Archaeology→Companion: a real overlap, measured.** Two Archaeology reveals naming ≥ 2 of the same
  commits certify that their two subjects co-changed at least twice, which — since ADR-0014's shipped
  bars here are 2–3 shared commits — *is* a Companion truth membership. **23 pairs of shipped subjects
  share ≥ 2 key commits on this repo, and 14 of those pairs are a shipped Companion answer.** On hono,
  10 and 2.

**Not acted on, and the distinction is the whole reason.** Placement's reveal **states** the atom —
"this commit changed `save.ts`" is a sentence on the screen, and ticking it later is recall of a
sentence. Archaeology's reveals only **imply** the co-change pair, and only to a player who holds two
boards side by side and counts the commits common to both. Pillar 3's text is *"answerable by
`Ctrl+F` rather than by reasoning about structure"* — and combining two reveals to notice that two
files keep moving together is not a lookup, it is exactly the inference Companion exists to teach.
Recorded with its number so a later session can overturn it on evidence rather than rediscover it.

## What this does not decide

- **Whether tier-ascending selection still serves the player** now that two tiers sit above tier 3
  and ~141 questions stand in front of them. Decision 8 states the consequence; the remedy, if one is
  wanted, is a progression decision and not this verb's.
- **Whether every figure here reproduces**, and it should be said plainly: **no generator exists**, so
  every count in this document comes from a throwaway probe, in a project whose own record contains a
  prototype that manufactured the effect it measured (ADR-0018 §6) and, in this document, a probe that
  shipped a wrong answer key inside a counterfactual. The structural figures — node and commit counts,
  eligible commits, wide commits, distinct dates, disclosure facts — were re-derived from `atlas.json`
  and reproduce. The deck and gate figures cannot be checked until the verb is built, and the first
  task after building it is to re-run this document's tables against the real generator and correct
  whatever moved.
- **Whether Placement should yield instead of Archaeology** where the two want the same fact. The
  incumbent keeps its deck, which is a choice about disruption rather than about which question is
  better.
- **Whether a commit deserves a place on the map.** Unchanged from ADR-0018 and now pressing from the
  other side: this verb puts twenty commits on screen and the map behind them shows none.
- **Whether `wideCommitFiles` at 25 is right.** Inherited and still unexamined; it now decides which
  commits an Archaeology board may contain as well as what the co-change matrix means.

---

## Found in review, before merge

An adversarial review was run against the finished document with one instruction: *the soft spot is
where the change is proudest — attack decisions 5 and 7.* It was right about where to look, and
wrong about which of the two was worse.

1. **A measured leak declared nonexistent in the same paragraph.** Decision 6 reported that the width
   guess beats band A on 5 of 27 shipped boards and then closed with *"the leak it prices is one the
   product does not have"*. Both sentences were mine, four lines apart. `broadKnown` is a gate
   heuristic now, at 5 boards here and 0 on hono.
2. **Decision 7's justification was falsified by decision 8, three paragraphs later.** The exclusion
   rule argued from a fact being *"previously shown"*; tier-ascending selection serves Archaeology
   **before** Placement. The rule survives — the argument had to be rebuilt order-free — and the same
   repair is what makes finding 1 coherent, because the two paragraphs had been leaning on opposite
   assumptions about what the player had already seen.
3. **A "correction" that replaced a right number with a wrong one.** The issue-linkage row was changed
   from 0 to 16, citing the measured-constant landmine. The atlas says **0**: all sixteen are merge
   subjects, and merge commits get no file list, so none is ever retained. Hono's 364/368 was likewise
   git-log counting, and *distinct exceeding carrying* is impossible in the shape the atlas stores.
   The real lesson is one the landmine does not cover — **a different instrument is not drift** — and
   it produced the merge-commit paragraph in decision 4, which nothing else in the document had.
4. **37 refusals against a supply table saying 33** — the sum of per-heuristic firings, quoted as
   boards, on a deck where four boards lose to more than one guess.
5. **"The only one of the four verbs where supply binds"**, falsified by this document's own decision
   8: Placement ships 39 against the same cap of 40.
6. **The map's click path inverts the tier order** by alphabetical accident, on the interaction
   `selector.ts` calls primary — and `main.ts`'s comment states the rule the `archaeology-` prefix
   breaks. Decision 8 carries it now.
7. **Two of six disclosure directions unchecked**, one of which (Archaeology→Companion) is a real
   overlap of 14 pairs here — measured, and deliberately not acted on, above.

Decision 5's core arithmetic and decision 4's certification both survived attack, including a search
for a third wrong-key mechanism beside the walk window and the shallow clone; none was found. So the
proudest paragraph was not the weakest this time — **the weakest was the one that had already done its
measurement and then wrote the opposite down.** Four of the seven above are a sentence contradicting a
number in the same document, which is a failure mode no suite can catch and no amount of measuring
prevents: it is what happens when the prose is written from the intention rather than re-read against
the table.

---

## Re-measured against the real generator

*"What this does not decide"* ended with an instruction: **no generator existed, so every deck and
gate figure above came from a throwaway probe, and the first task after building the verb is to
re-run these tables and correct whatever moved.** This is that pass. Measured at the commit that
added the verb, on the same two repos.

The **structural** figures reproduce. The **deck and gate** figures mostly do not, and one of them
inverts a decision.

| | ADR's probe (at `e44a823`) | real generator | note |
|---|---|---|---|
| ark nodes | 128 | 140 | the repo grew; ark indexes itself |
| ark retained / walked | 51 / 67 | 54 / 71 | as above |
| ark eligible commits | 46 (5 `wide`) | 49 (5 `wide`) | as above |
| ark files touched ≥ 2× | 66 | 70 | as above |
| ark subjects surviving decision 7 | 28 | 29 | |
| **ark deck** | **22** | **27** | see `oldestK` below |
| hono deck | 54 | 54 | the cap binds, as predicted |
| answer keys | 2–6 | 2–6 | both repos |
| ark `duplicateKey` | 1 | 1 | |
| hono `duplicateKey` | 10 | 11 | |
| ark disclosure share | 55.6% | **58.9%** (179 of 304) | |
| ark boards fully disclosed | 15 of 66 | **17 of 70** | |
| hono disclosure share | 16.0% | **14.4%** (132 of 917) | |
| hono boards fully disclosed | 1 of 172 | 1 of 172 | |
| decision 7 off → ark deck | 40 | **40** | reproduces exactly |
| decision 7 off → hono deck | 54 | 54 | |
| window-guess maximum | 0.46 | **0.462** | decision 5's arithmetic, to the digit |
| nodes it lifts out of unprovable, ark | 1 of 16 | 1 (21 → 20) | |
| nodes it lifts out of unprovable, hono | 14 of 154 | **16** (154 → 138) | |

### The gate table is the one that inverted

| guess | probe: ark / hono firings | real: ark / hono firings |
|---|---|---|
| `mentions` | 0 / 11 | **0 / 11** |
| `endpoints` | 0 / 2 | 0 / 3 |
| `oldestK` | 0 / **24** | 0 / **0** |
| `recentK` | 0 / 0 — *excluded on this* | 0 / **3** |
| `broadKnown` | **5** / 0 | **1** / 0 |

`mentions` reproduces exactly and `endpoints` nearly. The other three moved, and two of them matter:

**`recentK` is in `COMMIT_TRACE_HEURISTICS` now.** Decision 6 left it out on a measurement — *"it
fires on neither repo"* — and the real generator refuses **3 hono boards** with it. Excluding it
would ship three boards a player beats by ticking the newest rows, for no reason except that a
superseded probe called the guess dead. Decision 6's own rule selects it, and its own text flagged
the contingency: *"it is dead **under this configuration**"*. This is that criterion applied to
re-measured data rather than a new decision — but it is a change to what this document decided, so it
is stated at the top rather than buried here.

**`oldestK` fires zero times on both repos**, against a predicted 24 on hono. That is not the same as
dead, and the distinction is the one CLAUDE.md's landmine turns on. Both date guesses are invited by
the same structural fact — decision 3 spreads the key over the date ordering, so the key always
contains the oldest *and* the newest toucher — and `oldestK` loses because the shipped distractor
padding is spread evenly across the window rather than ranked. That is §8.3 working exactly as
ADR-0018's `busy` did: supply the board with the thing that makes the naive guess wrong, and score it
anyway. Measured, it is one design change from firing (newest-first padding takes it to 1 on hono;
dropping the window filter, to 2), and its mean is 0.169 / 0.150 against a 0.78 bar. It stays as a
canary against a regression in the distractor mix.

**`broadKnown` costs 1 board here, not 5** — so decision 6's *"cost: 5 boards here (27 → 22)"* reads
27 → 26 today, and the shipped deck is 27 rather than 22 because the deck no longer loses those 5.
The rule is unchanged and still fires on exactly one of the two repos, which was the argument.

### Three things the implementation found that no measurement predicted

**`uncertain` is not a refusal this verb can make.** Decision 4's table lists it — *"barring the
subject, and any commit whose file list contains a barred node"* — and the second clause makes the
first unreachable: `commitSupply` already refuses every commit touching a barred node, so a contested
file has **zero** eligible touchers and is dropped by the fewer-than-two test before any check runs.
Confirmed by mutation and on hono's 7 contested nodes. The guardrail is honoured more strongly by the
supply rule than by a second copy of it, and the branch is gone.

**A 2-toucher file's key *is* both endpoints**, so on a repo with one commit per date `endpoints`
scores ~1.0 on every such board and refuses it. Real repos land several commits a day, which dilutes
the guess — but the first unit fixture did not, and shipped **one board** while every assertion about
choice sets passed vacuously. Named because it is a property of the verb, not of the fixture: keys of
2 exist on both real repos precisely because their dates collide.

**Placement had no invariant test on the real atlas.** Adding Archaeology's revealed that
`candidates ∩ files(commit) = truth` had only ever been checked against a unit fixture. Both are now
in `tests/atlas/`, together with the cross-verb disclosure check — which is the one property neither
verb can see, and which `test:atlas`'s `(verb, truth)` uniqueness check structurally cannot express,
since one key holds node ids and the other commit ids.

### What this section does not claim

Every number above is one commit of a repo that indexes itself, so all of them drift; the invariants
do not. The ark column remains a floor rather than a plateau, for the reason the supply table already
gives: this repo's whole history spans a handful of distinct dates, so every date-derived signal here
is close to degenerate.
