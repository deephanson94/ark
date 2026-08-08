# ADR-0018 — A challenge's subject is a place or an event

- **Date**: 2026-08-08
- **Status**: accepted
- **Bumps**: `ATLAS_VERSION` 5 → 6. `Challenge.subject` widens from `NodeId` to `SubjectId`;
  `Evidence` gains a `commit` variant; `VerbId` gains `placement`. `docs/atlas-format.md` §2, §3.6
  and §4 in the same commit.
- **Supersedes**: nothing. Extends
  [ADR-0008](./0008-truth-is-unbounded-and-the-prompt-promises-dependence.md)'s invariant to a third
  verb and inherits [ADR-0007](./0007-pass-threshold-and-the-three-to-one-choice-set.md)'s sizing
  rule and [ADR-0012](./0012-an-answer-key-is-issued-once.md)'s uniqueness rule unchanged.
- **Context**: M4's second verb — Placement, NORTH-STAR §6.2.

---

## The question

> *"Feature X was added. Which file(s) changed?"* — ground truth: the real commit.

`Challenge.subject` was a `NodeId`, and every consumer read it as one: the fog promotes it, the map
flies to it, the deck indexes questions by it, the save keys on it. Placement's subject is a
**commit**, which has no position on a map and no fog to lift.

`src/verbs/companion/index.ts` said so a milestone ago, in the paragraph explaining why Companion
went first:

> *"Placement's subject is a **commit**, and `Challenge.subject` is a `NodeId` — so it would have
> meant changing the atlas shape, the save key, the selector and the map's click path before a
> single question could be asked."*

That was accurate. This ADR is the change, and — because "the third verb is cheap now" was a claim
this verb existed to test — it records what the change actually cost.

---

## Decision

### 1. `SubjectId = NodeId | CommitId`, told apart by the id's own prefix

`n:` + 12 hex is a node (`nodeIdFor`, ADR-0002). `c:` + 12 hex is a commit — the abbreviated sha a
`CommitRecord` already carries, which is 12 hex characters exactly. No `subjectKind` field, no
lookup, no asking the verb.

The prefix rather than a companion field because *"can this subject be drawn?"* is a question about
the **id**, not about the verb that used it. This codebase has four instances on record of
verb-blind state being interpreted by verb-specific code, every one of them a leak
([ADR-0014](./0014-companion-truth-is-a-gap-not-a-threshold.md)'s "found after shipping", plus
`tracedRadius`). A prefix keeps the answer total — including for a verb this build does not have.

The validator checks each arm against the section that must contain it: a `c:` subject must name a
retained commit, an `n:` subject must name a node. Deliberately **not** "either, whichever exists":
that would let a typo'd node id pass as a missing commit, and a dangling reference is precisely what
the validator exists to refuse.

### 2. Truth is the commit's own file list, sampled; the rest is kept off the board

```
candidates ∩ files(commit) = truth
```

Every candidate is either in the answer key or a file the commit's **recorded list does not name**. A
twelve-file commit ships a six-file key and the other six appear nowhere on the board. (Not
"provably": see the rename caveat at the end of decision 3 — the certification is against the history
git detected, and saying *provably* claimed more than that.) This is the
third use of one shape — ADR-0008 removed a depth bound, ADR-0014 refused a count boundary, and both
for the same reason: a candidate sitting just outside the line traps the player who *does* know the
repo.

`evidence.touched` states the commit's full width, so the reveal can name what sampling left out as
**revealed** rather than folding it into the claim (ADR-0011 decision 3).

### 3. This verb certifies from a positive record — and that argument was overdrawn once

Companion certifies a distractor by **absence** from the co-change matrix. Four independent channels
drop pairs, and one of them — the walk window — is not boundable at all, which is why ADR-0014
decision 6 refuses an entire repo whose walk stopped short, and why a shallow clone is refused
besides.

Placement certifies by absence from **one commit's own recorded file list**. The walk window
genuinely cannot make that wrong: retained commits are the newest walked, so a walk that stopped
early removes whole commits and corrupts none. There is no `windowTruncated` here, and copying it
over would delete the deck on every large repo for nothing.

> **A shallow clone is a different mechanism, and the first version of this decision got it wrong.**
> It concluded from the above that the shallow-clone refusal was unnecessary too. It is not. A
> `--depth N` clone's oldest commit has no parent, so git diffs it against the *empty tree* and
> `git log --name-status` reports it as **adding the entire worktree**:
>
> ```
> $ git clone --depth 2 …  &&  git log --name-status
> 218bbe4 third: add c only
> A a.ts   A b.ts   A c.ts          ← a.ts and b.ts predate it
> ```
>
> Nothing downstream can tell that from a real three-file commit. Demonstrated end to end on a
> purpose-built fixture — a repo of 8 files that grew to 38, cloned at depth 2 — which shipped a
> board for *"wave one lands"* whose answer key held three `base*.ts` files predating it by eight
> commits, and whose `touched` said 23 against a true 15. **A wrong answer key, in the field, from an
> argument that was right about one channel and applied to another.**
>
> The refusal is the whole repo, on ADR-0014's own signal: `history.present && repo.root === null`,
> null exactly when the clone is shallow or the root is unreadable (ADR-0011). Refusing only the
> boundary commit would be tighter and is not available — the oldest *retained* commit need not be
> the boundary once `maxCommits`, or a commit touching no indexed file, gets between them.

What else makes a *retained* commit's list untrustworthy:

| refusal | why | measured on ark | on hono |
|---|---|---|---|
| `shallowClone` | the oldest commit's list is a diff against the empty tree — guardrail 4 | 0 (full clone) | 0 (full clone) |
| `truncated` | `maxCommitFiles` cut the list, so the key is incomplete — guardrail 4 | 0 | 0 |
| `wide` | more than `history.wideLimit` indexed files: a vendoring commit or a mass reformat, ADR-0005's own judgement — **pillar 3, not guardrail 4** | 5 | 1 |
| `uncertain` | a member with contested rename lineage, ADR-0014 decision 4 | 0 | 24 |

The `truncated` limit is **recovered, not assumed**: the truncation entry's `kept` *is*
`maxCommitFiles`, so the affected commits are identifiable exactly. ADR-0014 rejected carrying the
indexer's caps in the atlas to save schema surface; this one need not be carried either.

**`truncated` is tested before `wide`, and that ordering is load-bearing.** After it, the branch can
never be taken: truncation needs > 64 files and wideness needs > 25, so with the shipped limits every
truncatable commit is already wide and refused a branch earlier. It would have been code, a comment
and a unit test asserting a behaviour the product does not have — CLAUDE.md's dead-path landmine, in
the decision that cites it. First, it fires exactly when the cap bit and reports the guardrail-4
reason rather than the pillar-3 one.

The schema's wording was loose here and is now corrected rather than merely noted: it said a `wide`
commit's "files list may be truncated". With the indexer's defaults a wide commit's list is complete
unless it is *also* long. Wideness and truncation are independent, and only the second is a
guardrail-4 problem.

**One limit this verb has and cannot certify away.** `touched` maps each historical path through
`alias`, which is only as good as `git log -M`'s rename detection: a rename with a heavy rewrite is
reported as delete+add, so an older commit's list omits today's file under its old name and the
generator offers it as a wrong answer. The exclusion is certified against *the rename history git
detected*, not against what a human would call the same file. That is NORTH-STAR §7.2's stated trade
for the whole product, and it is why the word **provably** does not appear in `commits.ts` any more.

### 4. The sample is spread across the commit's files **sorted by path**

`truth` is `size` files taken at even intervals across the commit's files in path order.

**The sort is the decision, and the first version of this section claimed it without the code doing
it.** `commit.files` holds `NodeRef`s ascending and `atlas.nodes` is ordered by node **id** — an
FNV-1a hash of the origin path — so a commit's file list arrives in a deterministic *hash shuffle*.
Spreading over that is spreading over noise: stable, and meaningless. Sorting first is what makes the
sample the thing the verb asks about — a cross-section of *where* the change landed rather than six
files that happen to hash early. A post-ship review caught the gap between the sentence and the code;
the code moved to meet the sentence.

Slicing is then rejected for the reason that becomes true once the order is by path: it hands every
wide commit the same alphabetically-first files, which on a repo whose root holds its documents is
`CHANGELOG.md` and `CLAUDE.md` over and over.

**The counts are identical either way** — 37 boards here and 54 on hono, same refusal breakdown,
measured by running the generator both ways — so this is a choice about what the key teaches, not
about supply.

### 5. The Ctrl+F gate reads the commit message, and `directory` is left out

`gate.ts`'s subject generalises from a `NodeRef` to *what the prompt puts in front of the player*: a
home directory (or none) and a set of words. The `name` heuristic is unchanged in meaning — "select
every candidate whose filename appears in the prompt" — only its token source varies. Words are split
at camel-case humps as well as at punctuation, so a message saying `parseConfig` matches
`parse-config.ts`.

`directory` is **absent** from `COMMIT_HEURISTICS` because a commit has no directory. Including it
would have meant inventing a home for the subject — most plausibly the directory holding the most
answers — which the player cannot read off the prompt, so it would delete questions for a strategy
nobody could have used. `gate.ts`'s existing rule, applied: a heuristic has to be a guess the verb's
own board actually invites.

**`recency` is present, and it was missing until a post-ship review paired two facts nobody had put
side by side.** The prompt prints the commit's **date**; the inspector prints every node's **last
seen**. So "tick every candidate whose last-seen date is the one in the question" is as
structure-blind as a guess can be, and it is free. Measured before deciding: it beat band A on **16
of hono's 54 shipped boards**, at a flat 1.00 on several — and on **none** of ark's 37 (mean 0.348,
best 0.71), which is the clearest argument yet that a second repo is not optional. Adding it refuses
63 more boards on hono and **costs the deck nothing**, because the deck cap backfills from the 232
available; afterwards the guess beats no shipped board on either repo (hono's mean falls 0.431 →
0.201, best 1.00 → 0.75). This is ADR-0014 decision 7's three-way alignment — map giveaway, naive
guess, gate heuristic — which had two of its three legs for this verb.

### 6. `busy` is the flagship distractor, and the measurement is the whole argument

§8.3's four strategies are written for a file subject. Re-anchored on the answer key's neighbourhood
they become: files in a directory the commit touched, files sharing a name token with one it changed,
files importing or imported by one it changed. A fifth has no §8.3 analogue because §8.3's subject
has no prose — **`mentioned`**: a file whose own name is in the commit message and whose contents are
not in the diff. It is the sharpest wrong answer this verb has, and it fired 53 times on ark and 88
on hono.

The ordering was decided by measurement, and the measurement had to be taken twice.

| configuration | ark deck | ark `ctrlF` | hono `ctrlF` |
|---|---|---|---|
| as shipped | 36 | 1 | 119 |
| `busy` out of `TARGET_MIX`, padding unchanged | 34 | 3 | 132 |
| no high-churn wrong answer **anywhere** on the board | 31 | 10 | 141 |

The threat is structural: a commit's files are, almost by definition, files that get committed to, so
a board with no busy wrong answers separates the key from the distractors on churn alone. Supplying
the board with the thing that makes the naive guess wrong is what §8.3 says a distractor is for, and
the gate still scores the guess and still refuses any board it wins.

**The first version of this section claimed the effect was ten times larger** — "25 of 37 refused, a
deck of 8" — and it was wrong. That number came from a throwaway prototype whose own fallback filled
boards with the *lowest*-churn files available, manufacturing the effect it then measured; the
shipped `distant` padding walks the churn ordering busiest-first, so deleting the strategy barely
changes the board. It is recorded here rather than quietly corrected because the lesson is narrower
than "measure first": **a counterfactual is only as good as the thing it holds fixed.** The obvious
one — delete the strategy — measures almost nothing, which is why the third row exists.

### 7. Tier 6, and therefore last in the rotation

NORTH-STAR §5's tier 6 is *"You need to add feature X — where does it go?"*, ground truth *"the actual
commit that added it"*. That is this verb, asked backwards. The selector ranks tier ascending because
§5's tiers **are** the progression, so every tier-3 question is served before any of these. That is
the design working rather than a bug, and it is stated here because it means a short session never
reaches this verb.

---

## What it cost, against the claim that the seam had made it cheap

Mostly true, and the exception is worth more than the confirmation.

**Free, as designed.** The console, the map, the field notes, the progression selector and the deck
needed no edit to *know about* Placement. `VERBS` gained one line. The prompt, the instruction, the
button label, the reveal, the summary sentence, the grade's phrasing and `stillHolds` were all already
on the `Verb` contract, and the verb filled them in. The *indexer* names it — `build.ts` runs the
generator, `cli.ts` prints its refusals — exactly as it names the other two, because a report about
what a verb declined has nowhere else to live. (An earlier draft of this line said "nothing outside
`src/verbs/placement/` names this verb", which is the kind of overclaim this document keeps having to
walk back.)

**Not free: everything that assumed a subject is a node.** Nine places, each a real defect rather than
a type error:

1. `notes.ts` resolved the subject through `refById` and `continue`d on a miss — every Placement note
   would have been dropped in silence.
2. `notes.ts` chose its ruler with `verb === 'companion' ? … : …`, Blast Radius as the *else*.
3. `notes.ts` chose its **sentence** the same way, so a Placement note would have read *"all of them
   direct importers"* about a sha.
4. `save.ts`'s `asPass` required `isNodeId(subject)`. A pass it rejects is dropped at parse and erased
   by the next write — the identical failure the file's own comment describes for `VERB_IDS`, one
   field down, and it would have destroyed every Placement pass on the second session.
5. `progress.ts` would have put a commit id into `surveyed` and `understood`, which are sets of files.
6. `progress.ts`'s `livenessOf.exists` was `refById.has`, so every Placement pass would have decayed
   to nothing on restore.
7. `main.ts`'s `challengesById` would have keyed a bucket no node can resolve.
8. `main.ts`'s guide looked up the subject's node, found nothing, and returned — a live-looking button
   that does nothing.
9. The HUD and the guide both counted "questions left" off the map's **ring** set, which a commit
   subject never joins. With only Placement left the HUD read *"36 questions ringed on the map"* over
   a map with none.

Items 1–3 are one class: the field notes were the last place the M4 seam had not reached, and it had
not reached them in three separate fields. `subjectLabel`, `noteWeights` and `noteProse` are on the
`Verb` contract now.

**The lesson, and it is the one CLAUDE.md's newest landmine already names.** Every one of the nine is
a rule that lived in two places — a shape assumption in the shell and its real definition in the
schema. None of them was a type error, because `NodeId` is `string`. The way to find them was to grep
every read of `challenge.subject` and `pass.subject` and ask *what am I assuming this names?* — the
same move that closed `tracedRadius`, applied before shipping rather than a milestone later.

---

## Consequences

- **A commit subject un-fogs nothing of its own.** A Placement pass promotes exactly the files it
  proved; the subject is not on the map, so `deriveFog` skips it and `subjectsPassed` filters it out.
  This is why `report.unprovableNodes` counts truth members only for this verb.
- **`channel: 'nothing'`.** There is no cone to widen and no wire to draw. This is the first verb to
  use that arm, which existed unused since M4 for exactly this case.
- **The guide opens the question when there is nowhere to go.** ADR-0011 says suggested-next is an
  affordance and not a mode — *"the map stays the frame"* — and with a placeless subject that
  argument has nothing to protect: a button that silently does nothing does not keep the map as the
  frame, it just breaks. So the control changes its own label and opens the board.
- **Measured supply.** 37 challenges on ark from 42 eligible commits (1 `ctrlF`, 4 `duplicateKey`);
  54 on hono, capped by `maxChallengesFor(425)` from what the gate and the dedupe leave. Together the
  three verbs leave **13 of ark's 127 nodes** unprovable where Blast Radius alone leaves 39, and 142
  of hono's 425 where Blast Radius alone leaves 269. Ark indexes itself, so every figure here moves
  with the next commit — the invariants above do not.
- **Index cost**: **not measurable.** Three runs each with the verb's deck cap at 0 and at its
  normal value: 443–467 ms here against 458–470 ms without, and 1690–1871 ms on hono against
  1843–1876 ms without — the without-runs are *slower* on hono, which is how you know you are
  reading noise. (An earlier draft of this line said "+0.36 s on hono", from comparing this branch
  against `master` — two trees with different file counts. Same error as the `busy` figure above,
  twice in one document: **a counterfactual that changes two things measures neither.**) The
  generator's per-commit work is `O(commits · candidates)` with the corpus and both inverted indexes
  shared from `companion/distractors.ts`, so this is expected rather than lucky.
- **Atlas cost**: +33.1 KiB here (175.9 → 209.0) and +48.1 KiB on hono (465.5 → 513.6), holding
  1678 B/file against a 2,621 B ceiling — projecting 3.2 MB at 2,000 files against 5 MB.

## What this does not decide

- **Whether ADR-0005's `maxCommits` should move.** It was measured rather than assumed, and the
  answer is no: on ark the cap never fires (45 retained against a 500 cap — the 13 "dropped" commits
  in `report.truncations` are commits that touched no *indexed* file, which the entry conflates), and
  on hono, where it does fire hard, **the deck cap binds first** — 500 commits yield 232 distinct
  boards and `maxChallengesFor` keeps 54. Raising `maxCommits` would produce more boards for the deck
  cap to throw away. Revisit if `maxChallengesFor` ever rises.
- **Whether a commit deserves a place on the map.** It has none today and the verb is honest about
  it. A history channel that put commits somewhere is a genuine design question and a separate one.
- **Whether the boundary commit alone could be refused** instead of the whole shallow clone. It
  would need a way to identify it from the atlas, and the oldest retained commit is not it. Worth
  revisiting only if shallow clones become a common way people point Ark at a repo.
- **The overlapping-answer-key question ADR-0012 leaves open** is untouched here. Placement dedupes
  identical keys and, unlike Blast Radius, does **not** re-ask with a disjoint window: a collision
  there means two commits touched the same files, and a second window would ask about files this
  commit's own key already excluded.

## Rejected alternatives

**Anchor the challenge on one of the commit's own files and keep `subject: NodeId`.** Cheapest by
far, and it hands the player one answer for free — pillar 3, in the most direct form available.

**Add a parallel `subjectCommit` field and leave `subject` a node.** Two fields where one is
populated, which every reader then has to ask about, and the shell still has to decide which. The
prefix carries the same information with no second field and no possible disagreement between them.

**Ask the verb whether its subject is placeable.** A `Verb.locate()` member would work and is one
more thing three verbs must implement identically. Worse, it makes a fact about the *id* into a fact
about the verb, which is the direction every leak in this codebase has run.

**Rank the sample by churn, ascending, to dodge the churn gate.** It would raise the deck without
`busy` distractors. It is also choosing the answer key to be hard, which is authoring — §8.4 computes
difficulty *from* the key and must not have the key chosen to flatter it.

---

## Found after shipping, by an adversarial review of the finished code

Five findings, and the shape of them is worth as much as the fixes.

1. **A wrong answer key on a shallow clone** — decision 3's box above. The argument was right about
   the walk window and wrong about a mechanism it had filed under the same heading. Reproduced end to
   end before it was fixed.
2. **`truncated` was a dead branch**, unreachable with the shipped limits because `wide` was tested
   first — in a file whose own header quotes CLAUDE.md's dead-path landmine, and with a unit test
   constructing a truncation entry the indexer can never emit. Reordered.
3. **The sample was not sorted**, while decision 4 said it was "path-sorted" and reasoned from
   alphabetical clustering that the atlas's hash ordering does not have. The code moved to meet the
   sentence, and the test that should have caught it was itself wrong twice — first asserting a
   property true under either ordering, then asserting both ends of the *hash* order, which
   **survived the mutation** because with twelve files and a six-file key the hash order includes
   both path-extremes about a quarter of the time. It now compares the whole key against `spread`
   over the sorted paths.
4. **A structure-blind guess nobody had scored**: the prompt shows the commit's date and the
   inspector shows every node's *last seen*. 16 of hono's 54 shipped boards fell to it. `recency` is
   in `COMMIT_HEURISTICS` now, at no cost to the deck.
5. **A false comment about its own cost**: `commitOf` said it was "called once per note and once per
   reveal", which is true of the panel and false of `livenessOf` — restoring a save asks `stillHolds`
   once per *node* per stored pass, so the linear scan was `O(nodes × commits)` string builds at
   load. Memoised, on the same `WeakMap` shape `indexCoChange` uses.

**What the five have in common** is that none was findable by the type system or by any suite: three
are sentences that stopped matching their code, one is a branch that cannot run, and one is a pairing
of two true facts — a date in a prompt and a date in a panel — that no single file could see. The
review's own summary put it best: the soft spot was *exactly where the change was proudest*. The
completeness argument in `commits.ts` is the paragraph this ADR spent the most words on, and it is
where the wrong answer key was.
