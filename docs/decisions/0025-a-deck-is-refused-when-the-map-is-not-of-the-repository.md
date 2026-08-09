# ADR-0025 — A deck is refused when the map is not a map of the repository

- **Status**: accepted
- **Date**: 2026-08-09
- **Implements**: [ADR-0024](./0024-a-language-ships-on-its-deck-not-on-its-map.md) decision 3 — *"No
  language ships until §8's Markdown-map behaviour is refused or labelled"*
- **Bears on**: NORTH-STAR pillar 2 (the repo is the level), pillar 6 (ten minutes to first true
  insight), risk #4 (fog frustration), risk #7 (repos without history); ADR-0024 §8; guardrail 5
- **Bumps**: `ATLAS_VERSION` 8 → 9. `report` gains `unreadable`. No migration — the missing
  information lives on a filesystem the player is forbidden to touch, so `npm run index` is the whole
  of it (`docs/atlas-format.md` §4).
- **Code shipped by this ADR**: `src/atlas/coverage.ts` (the rule), `walk.ts`'s `UNREAD` table, the
  `report.unreadable` field, the CLI guard, and three player surfaces.

---

## 1. The defect, stated as what a person sees

Point ark at `spf13/cobra` today and it does not produce a silhouette. It produces **48 confident,
correctly-graded questions about the repository's README files**, over a map of 17 Markdown nodes,
with not one line of Go anywhere on it. `gohugoio/hugo` produces **144**. Every one of those
questions is graded against ground truth extracted from the repo, so pillar 1 is intact and every
answer key is right. The thing that is wrong is the *frame*: a player who answers them learns the
co-change structure of hugo's documentation tree while believing they are learning hugo.

This is `CLAUDE.md`'s instrument-that-measures-nothing landmine one level up. **It does not look like
a failure. It looks like a small repo.** And the guard that was supposed to catch it could not,
for two independent reasons ADR-0024 §8 records: its predicate is `challenges.length === 0` (hugo's
count is 144), and it sat on the `play` path only, past the `command === 'index'` return — so
`npm run index`, `scripts/budget.ts` and every measurement in that document never reached it.

Three documents, including this repo's own `CLAUDE.md`, said a Go or Python repo produces *"a map
with no edges and no questions"*. The first half was right. The second was false for four milestones.

---

## 2. What was measured, and what it holds fixed

**Eleven repos**, chosen along the axis that decides this — *how much of the repo is source ark
cannot read* — and including three that a rule could plausibly get wrong in each direction: genuine
documentation repos with no code (`sindresorhus/awesome`), a book with a code appendix
(`donnemartin/system-design-primer`), and large JavaScript repos with substantial non-JS components
(`facebook/react`, `vercel/next.js`, `sveltejs/svelte`).

**What is held fixed**: ark's **production** walk options, unmodified — the same `.gitignore`
handling, the same `DEFAULT_EXCLUDES`, the same size and symlink rules. No ecosystem excludes were
added, because the question is what ark *does*, not what a probe could be tuned to see. The four
repos ADR-0024 measured are at the same shas, and their node and challenge counts **reproduce that
document exactly** (cobra 17/48, hugo 1,049/144, django 107/75, flask 8/6), which is the gate saying
the instrument is the same one.

**What is not held fixed, and is stated rather than hidden**: `react`, `next.js` and `svelte` are
`--depth 1` clones and their rows are **walk-level only** — node counts, source counts, and therefore
the verdict. No deck was generated for them, because a shallow clone's history is refused for an
unrelated reason (ADR-0018) and a deck size from one would be a number about the clone.

Ark's own figures are from a clean clone of **`e6fe5e4`**, which is the commit before the one
carrying this file. Ark indexes itself, so a figure taken from a working tree is false the moment it
is committed.

---

## 3. The signal is in `report.skipped`, not in the language mix of the nodes

The tempting rule is *"no scanned-language nodes ⇒ refuse"*. It is wrong **in both directions**, and
the same table shows both errors:

| repo | onDisk | nodes | of which `.md` | source nodes | `unsupported` | *"no source nodes ⇒ refuse"* |
|---|---|---|---|---|---|---|
| hugo `44da0860` | 2,545 | 1,049 | 1,016 | **24** | 1,494 | **ships** — 144 questions about the docs |
| django `c9eb16a87e` | 7,007 | 107 | 7 | **45** | 6,900 | **ships** — 75 questions about JSON fixtures and admin JS |
| awesome `7cb5c837` | 23 | 7 | 7 | **0** | 16 | **refuses** — and it is genuinely its Markdown |
| cobra `adbc881` | 65 | 17 | 17 | 0 | 48 | refuses ✓ |
| flask `6a2f545b` | 236 | 8 | 6 | 0 | 228 | refuses ✓ |

It ships the two worst offenders — 24 stray JavaScript files are enough to save hugo — and refuses
the one repo that is honestly a documentation repo. Three of eleven wrong.

**A documentation repo is not distinguishable by what is on the map.** hugo's map is 97% Markdown and
hugo is a static site generator written in Go; awesome's map is 100% Markdown and awesome is a list. The difference is not
visible in the nodes at all. It is visible in what the walk **skipped**, and only there.

But `report.skipped`'s `unsupported` tally cannot see it either, because it cannot tell a PNG from a
Go file. Scored as a ratio against everything the walk saw:

| | ark | hono | react | next.js | svelte | awesome | hugo | cobra | sdp | flask | django |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `unsupported / onDisk` | 3.9% | 10.3% | 8.0% | 18.4% | 54.8% | **69.6%** | **58.7%** | 73.8% | 83.5% | 96.6% | 98.5% |

**No threshold on that ratio gets all eleven right, and the proof is two cells.** To refuse hugo the
bar must be at or below 58.7%; awesome must ship and is at 69.6%. The sets overlap, so no bar exists.
And the reason awesome is at 69.6% is that it ships six SVGs, two Illustrator files and two PNGs —
its verdict would be decided by its asset count.

So the walk gains a third table beside `SCANNED` and `CARRIED`: **`UNREAD`, extensions it recognises
as program source and cannot read.** The count it produces is a *refinement* of `unsupported` — every
file in it is also counted there, so that number stays comparable — and it is the only instrument in
this document that separates the eleven.

---

## 4. The rule, and both clauses measured

```
deckRefused  =  unreadable ≥ 5                       (1) there is a body of unreadable source
             ∧  mapped × 9 < unreadable              (2) the map holds less than a tenth of it
```

where `mapped` counts nodes in a language the scanner parses and `unreadable` counts files the walk
recognised as source and did not read. Markdown and JSON are in neither term, in either direction —
they are terrain, and letting them into the numerator is exactly the mistake §3 refutes.

| repo | mapped | unreadable | languages | mapped share | (1) | (2) | verdict |
|---|---|---|---|---|---|---|---|
| hono `7075369e` | 383 | 1 | Shell | 99.7% | n | n | ship |
| ark `e6fe5e4` | 113 | 1 | Shell | 99.1% | n | n | ship |
| react (depth 1) | 4,436 | 136 | 120 Rust, 16 Shell | 97.0% | **Y** | n | ship |
| next.js (depth 1) | 23,045 | 1,042 | 1,012 Rust, 29 Shell, 1 Python | 95.7% | **Y** | n | ship |
| svelte (depth 1) | 3,467 | 4,462 | Svelte | 43.7% | **Y** | n | ship |
| awesome `7cb5c837` | 0 | 1 | Shell | 0.0% | n | **Y** | ship |
| hugo `44da0860` | 24 | 920 | 906 Go, 10 Shell, 4 C | 2.5% | Y | Y | **REFUSE** |
| django `c9eb16a87e` | 45 | 2,930 | 2,928 Python, 2 Shell | 1.5% | Y | Y | **REFUSE** |
| cobra `adbc881` | 0 | 36 | Go | 0.0% | Y | Y | **REFUSE** |
| flask `6a2f545b` | 0 | 84 | 83 Python, 1 Shell | 0.0% | Y | Y | **REFUSE** |
| sdp `ae9bbd7b` | 0 | 27 | 26 Python, 1 Shell | 0.0% | Y | Y | **REFUSE** |

**Neither clause separates the eleven on its own, and each rescues a case the other gets wrong.**
This is the whole reason there are two, and it is measured rather than asserted:

- **Clause 2 alone** — refuse when the mapped share is under a tenth — refuses **awesome**, whose
  share is 0.0% because it has no source to be a tenth of. 1 error.
- **Clause 1 alone** — refuse when there is a body of unreadable source — refuses **react, next.js
  and svelte**. 3 errors.
- **Together**: 0 errors on all eleven.

Each was mutation-tested rather than reasoned about, and the mutants separate cleanly: setting
`UNREADABLE_FLOOR` to 0 reddens **three** assertions — the two clause-1 ones and the sentence test,
which carries the refusal's suffix — and **no** clause-2 assertion; replacing clause 2 with the
majority rule reddens the two clause-2 assertions and no clause-1 assertion. (The "three" was "two"
until a review re-ran it: the third assertion was added *after* the mutation was measured, which is
the shape of every stale constant in this repo.) The
unit suite asserts the clauses **separately** as well as together, because `CLAUDE.md` has a landmine
about a rule named after a conjunction enforcing one clause and keeping the label.

### 4.1 Where the tenth came from, and why "a majority" was wrong

The first draft of clause 2 was `mapped ≤ unreadable` — *the map must hold a majority of the
repository's source* — chosen because it is the only threshold on `[0,1]` with a name instead of a
number. It is wrong, and the data says so in one row: it **refuses `sveltejs/svelte`**, whose 4,462
`.svelte` files outnumber the 3,467 files its compiler is actually written in. A JavaScript tool
refusing the Svelte repo is not a defensible outcome, and the semantics were doing the deciding where
the measurement should have.

*(Those 3,467 are **3,382 `.js`, 84 `.ts` and 1 `.mjs`** — svelte's compiler is JSDoc-typed
JavaScript. Every document in this change first called them "TypeScript files", which is false of
97.6% of them and was caught only by counting; the count and the verdict are unaffected, and the
sentence it appears in is *strengthened*, which is exactly why nobody checked it.)*

Sorted, the mapped share of the **ten repos whose verdict clause 2 decides** reads: **99.7, 99.1,
97.0, 95.7, 43.7 │ 2.5, 1.5, 0.0, 0.0, 0.0**. (`awesome` is the eleventh and is *also* at 0.0%, which
is the point of §4's second bullet: clause 1 removes it before this ratio is consulted, and no bar
placed on this axis alone could get it right.) The largest gap is 2.5% → 43.7%; **every** value
inside it gives the same eleven verdicts. One tenth sits there with a ~4× margin on each side, and it
is round. The margin is the justification; the roundness is only tie-breaking.

The floor is derived the same way, over all eleven. Unreadable counts, sorted: **1, 1, 1 │ 27, 36,
84, 136, 920, 1,042, 2,930, 4,462**. Any value in [2, 27] gives identical verdicts; 5 is the geometric
middle of that gap.

### 4.2 What the table is diluted by, and it is worth knowing

Clause 2's denominator is source, not files, so a large documentation tree does **not** protect a
repo — hugo's 1,016 Markdown pages do not appear in its 2.5%. That is deliberate and it is what makes
hugo refusable. The cost is on the other side: a repo whose readable source is a tenth or more of its
total keeps its deck **however much of it is missing**, so `sveltejs/svelte` is not refused with 4,462
`.svelte` files absent from its map. The badge says so on every frame; the deck is not refused. That is the
line this ADR draws — **label always, refuse only when the map is a sliver** — and §7 says what would
move it.

---

## 5. What it costs, and what it withdraws

| repo | deck before | deck now | atlas before | atlas now |
|---|---|---|---|---|
| ark `e6fe5e4` | 160 | 160 | 307,079 B | 307,139 B |
| hono `7075369e` | 216 | 216 | 611,837 B | 611,897 B |
| awesome `7cb5c837` | 14 | 14 | 75,915 B | 75,975 B |
| hugo `44da0860` | 144 | **0** | 635,373 B | 485,408 B |
| django `c9eb16a87e` | 75 | **0** | 181,635 B | 102,736 B |
| cobra `adbc881` | 48 | **0** | 91,054 B | 46,637 B |
| sdp `ae9bbd7b` | 42 | **0** | 94,610 B | 51,173 B |
| flask `6a2f545b` | 6 | **0** | 9,480 B | 6,704 B |

**315 questions are withdrawn, across five of eleven repos, and every one of them was correct.** That
is the trade: they were correct *questions about the wrong repository*, and guardrail 4's asymmetry
applies one level up — a missing challenge costs nothing, a challenge that reads as success while
teaching a shadow costs trust.

The three unchanged decks each pay **+60 bytes** — one `unreadable` entry, whose serialised form is
54 bytes plus the key. The field is bounded by the number of *languages* rather than the number of
files, which is the property worth having: hugo's **920** unreadable files cost **118 bytes**, because
they are three languages rather than 920 rows. *(This paragraph first said three entries "would cost
60 bytes too", which is the bound misread as a constant — it is ~2× one entry, not equal to it.)*

**Refusing is also cheaper.** Generation is skipped rather than run and discarded, so hugo indexes in
4,328 ms against 4,829 and django in 3,621 against 4,042. A repo ark cannot read now gets its answer
faster, which is the right direction for pillar 6.

**`donnemartin/system-design-primer` is the honest cost and it is named rather than buried.** It is a
book: 23 Markdown chapters, 54 PNG diagrams beside 17 OmniGraffle sources, and 26 Python files of
example solutions. Ark now refuses its
deck, and a defensible reading is that the book *is* its Markdown and the 42 questions were fine. The
rule cannot tell it from cobra, because nothing on the filesystem can: 26 Python files beside 23
Markdown files is the same shape as 36 Go files beside 17. Guessing at which one is "really" the
repo is a judgement about intent, and pillar 1 is that ark does not make those.

---

## 6. Where the refusal is said

Four surfaces. **Three of them share one sentence**, composed in `src/atlas/coverage.ts` so the
terminal and the player cannot drift — `CLAUDE.md` has a landmine about two individually-honest
panels stating contradictory facts about one population. The fourth (the field notes, item 4) says
something else entirely, in its own words, in `ui.ts`: it is about *notes*, not about coverage, so
there is nothing for it to agree with. That is a deliberate exception rather than the rule, and this
header claimed the rule covered all four until a review read it against the code.

1. **The CLI, on both commands.** The guard moved above the `command === 'index'` return, so
   `npm run index` and `scripts/budget.ts` reach it. Its predicate is the refusal, not
   `challenges.length === 0` — and **the old predicate is kept as a second branch**, because "the
   deck was refused" and "no generator found anything to ask about" are different facts with
   different remedies. That branch is live and was checked rather than assumed: a one-file repo with
   no git history reaches it, prints its own note, and is **not** refused — `unreadable` is 0. A
   live guard aimed at the wrong thing is not a dead branch, and now it is aimed at the right one
   from both commands.
2. **A standing line in the HUD**, whenever anything is unreadable — `1 source file not on this map`
   on this repo, `920 source files not on this map` on hugo, with the full sentence as its title.
   **This has no threshold.** How much of your repository is on this map is a measurement and the
   player is entitled to it whether or not it crossed a bar; the threshold governs the deck only.
3. **The "Where next?" panel**, which said **"every question answered"** over a repo that was never
   asked one. That sentence was going to be the defect's last hiding place: a refused deck and an
   exhausted deck both leave the count at zero, and only one of them means the player finished
   something. The HUD's `quests` line had the identical bug **in the same file, 141 lines down**,
   spelled with different words off a different variable — *the bug you already fixed is still there,
   one line down*, so both were repaired from one value rather than one of them being repaired
   twice.
4. **The field notes' empty state**, found by grepping the rest of the player for readers of an empty
   deck after fixing the first two. *"Nothing proved yet. Answer a question and what you establish is
   written down here"* invites an action a refused repo does not have. Weaker than the other two — an
   impossible instruction rather than a false claim — and included because "I fixed the two I knew
   about" is how the third one survives. The inspector's *"the rest of the radius is earned"* is the
   same shape and is **left**: on a refused repo it sits over a map whose import radius is empty
   anyway, and rewording it would be guessing at a case with no measurement behind it.

---

## Decision

1. **The map ships and the deck does not, when the map is not a map of the repository.** The
   refusal is `sourceCoverage`'s two clauses (§4). The map, regions, history and layout are all
   generated and valid; `challenges` is `[]` and `report.unreadable` says why. Risk #4's silhouette
   is preserved — you can see there is something there.
2. **The signal is what the walk skipped, refined by language — never the language mix of the
   nodes.** §3 measures both naive alternatives failing, one of them provably (no threshold exists).
3. **A threshold is placed in the largest gap in a measured distribution, and both neighbours are
   named.** One tenth, between hugo's 2.5% and svelte's 43.7%. A threshold chosen for its English —
   *a majority* — refused a JavaScript repo, and this document's first draft had it.
4. **What is missing from the map is said on the map, with no threshold at all.** Labelling and
   refusing are separate mechanisms with separate triggers: every repo with unreadable source gets
   the count; only a sliver gets the refusal.
5. **`UNREAD` lists program source and nothing else, and omits an extension rather than guessing at
   it.** `.html`, `.rst`, `.css` and `.txt` are out — counting markup would refuse a book with an
   HTML build directory. `.m`, `.pl`, `.v` and `.d` are out because each names two *unrelated*
   languages with no dominant reading, and the cost of an undercount is a shipped deck while the cost
   of a wrong name is ark printing a false claim about the reader's own repo.
   **Two entries are kept knowingly against that rule and the cost is stated rather than denied**:
   `.h` is C, C++ or Objective-C and is reported as **C**, because dropping it would blind the rule to
   every C and C++ repo there is; `.fs` is F#, a GLSL fragment shader or Forth, and is reported as
   **F#**. Both print a name that is wrong for some repos. The third instance of this — folding
   `.C` (C++ by convention) onto `.c` and printing **C** — was a `toLowerCase()` at the lookup and is
   **removed**: upper-case spellings worth having are rows of their own, and everything else is an
   undercount, which is the safe direction.
6. **Adding a language to `SCANNED` deletes its row from `UNREAD` in the same commit.** They are
   disjoint by construction and a unit test asserts it over every entry, because an extension in both
   would be indexed *and* counted as missing.

---

## Alternatives rejected

**Label it and keep the deck.** This is the smaller change and it is what ADR-0024 decision 3 offers
as the alternative. Refused because the label mitigates the sentence and not the apparatus: the fog
still fills in, the field notes still accumulate, the HUD still counts questions remaining, and every
one of those is a claim of progress *on the repository*. A player is not going to read one line and
then disbelieve the rest of the interface. The line ships anyway (§6.2) — it is the right thing for the
partial case, which is now a real and separate state.

**Refuse only the challenges whose subjects are not source.** Surgical, and it keeps django's 45
JavaScript files playable. Refused on two grounds. It is a per-row guard, and ADR-0020's rule is
*withhold by class or by board, never by row*. And it does not fix the defect: a deck about django's
45 admin JavaScript files still presents itself as a game about django, which is 2,928 Python files.

**Refuse the index entirely — write no atlas.** Refused on risk #4 and pillar 6. The map of cobra's
Markdown is *true*; there really are 17 documents laid out by their real coupling. Withholding it
teaches nothing, and the silhouette is what the north star asks for when something is unexplored.

**Put the ratio in the atlas as a number.** `report` could carry `sourceCoverage: 0.025`. Refused: a
float in the atlas is a determinism hazard for nothing, the counts are already there, and a stored
ratio would let a future bar disagree with the atlas that was written under the old one. The rule is
a pure function over two integers and lives in one file.

**Record a `deckRefused: true` flag beside it.** Refused for the same reason — the rule is
deterministic over data the atlas already carries, so a second encoding of it is a second thing that
can be wrong. This is *not* the ADR-0020 case: there, the reconstructed reason genuinely disagreed
with the recorded one on 53.9% of slots. Here they cannot disagree, because there is one function.

**Count `.html` and `.rst` as unreadable source.** They are not marginal: `.html` is hugo's
second-largest unsupported class at 123 and django carries 373, and flask carries 79 `.rst` against
83 `.py`. Refused because it inverts the rule on exactly the case it exists to protect — a
documentation site with a generated HTML tree would be refused for shipping its own output — and
because both are markup, which the map already carries a kind of (`md`) without calling it source.
(The *largest* unsupported classes after Go and Python are not markup at all: django's are 1,274
`.po` and 1,263 `.mo`, which are compiled translations, and hugo's third is 99 `.png`.)

---

## Consequences

- **ADR-0024 decision 3's precondition is met**, and M5 is unblocked. Go and Python repos now behave
  the way that ADR assumed they already did — a map and no deck — rather than the way they actually
  did.
- **The refusal will resolve itself as languages land.** cobra and hugo flip to shipping the moment Go
  is on the map. The size of the flip depends on the granularity ADR-0024 decided: at **package**
  granularity — the one that ships — hugo's 906 Go files become roughly **193 package nodes** beside
  its 24 JS files, not 930 file nodes. Either way clause 2 stops holding by a wide margin. *(This line
  said "24 to 930", which describes the file granularity that ADR-0024 refused.)*
- **`ATLAS_VERSION` is 9 and every saved atlas is stale.** The validator's existing "reindex required"
  error is the migration, as with every bump since ADR-0010. Progress in `localStorage` is keyed on
  the repo's root commit and independent of this number (ADR-0011), so a reindex costs nothing a
  player has earned.
- **`IndexResult.generation` is now nullable**, and callers must say which of the two states they are
  in. There are two: `cli.ts` prints the refusal instead of four verb reports, and `tests/atlas/`
  fails loudly with the reason rather than letting every deck assertion pass vacuously over an empty
  deck.
- The probe scripts are scratch and are **not** committed. What is committed is this document, the
  rule, and the tests.

---

## 9. Post-ship review — what an adversary found, reproduced

Ten findings against the merged commit, every one re-derived here before being accepted. Four were
false statements, and **the two that matter are both about the same thing: this document described a
rule, and what shipped is a list.**

### 9.1 The defect recurs on any language the table does not name — measured, not feared

`terraform-aws-modules/terraform-aws-vpc` at `0a36bd54` is 77 `.tf` files and 24 Markdown ones.
Indexed with the shipped code it produced **25 nodes and 64 challenges** — 15 Companion, 32
Placement, 17 Archaeology — over nothing but documentation, with `report.unreadable` **empty**. So
every surface this ADR added was silent: no badge, no sentence, no CLI note, no refusal. That is
ADR-0025's own §1 defect, intact, three commits after ADR-0025.

`.tf` is not ambiguous and no decision excluded it; it was simply not on the list. Nor are `.el`,
`.nix`, `.vim` or `.proto`. The Known-gaps row said the undercount was *"on purpose"* and named
ambiguous extensions and an Objective-C repo, which describes a decision that was never taken for
this class and understates who slips through.

**Fixed**: `UNREAD` gains Terraform, Emacs Lisp, Nix, Vim script and Protocol Buffers. Re-measured,
the eleven repos' verdicts are **unchanged in every cell**, and tfvpc is refused with
`77 Terraform`. The honest statement of the residual gap is not *"ambiguous extensions are excluded"*
— it is **a list has a failure mode a rule does not, and this is a list**; anything not on it is
invisible, silently, exactly as before.

### 9.2 A mainstream repo sits in the band §7 called empty, and it ships

`prometheus/prometheus` at HEAD: **249 mapped source files against 747 unreadable** (727 Go, 16
Shell, 4 Protocol Buffers) — a mapped share of **25.0%**, inside the 2.5% → 43.7% gap this document
placed its threshold in and called uninhabited. It **ships**, and its Blast Radius deck is 48 boards
about the React web UI of a Go time-series database.

This does not move the bar — the gap is still the largest in the distribution and one tenth is still
~4× clear on the refusing side — but *"there is none in this set"* was a fact about the set, and the
first repo cloned to test it landed in the middle of the band. §4.2's trade now has a witness with a
name instead of a hypothetical, and the sentence that survives is the one already written: the bar is
**measured to be safe, not measured to be tight**.

### 9.3 The rest

- **`sveltejs/svelte`'s 3,467 files are JavaScript** (3,382 `.js`, 84 `.ts`, 1 `.mjs`), not
  TypeScript, in six documents. The count and the verdict are unaffected and the sentence is
  *strengthened* by the correction, which is why nobody checked it. §4.1.
- **`.C` printed the wrong language name.** A `toLowerCase()` at the lookup folded it onto `.c` and
  reported C++ as **C** — the one cost decision 5 says this mechanism never pays, paid by the line
  written to be helpful about `.R`. The fold is gone; upper-case spellings are rows.
- **Three player surfaces had no test at all**, and the review proved it by reverting the guide's
  refusal branch and running everything green: 606 unit, 102 atlas, clean build, and the panel back
  to *"every question answered"* over a refused deck. The forks are now `src/player/empty.ts`, unit
  tested, and both mutations are caught.
- Three numbers were wrong in this document and are corrected in place with the wrongness named:
  three `unreadable` entries cost **118 bytes**, not 60; the floor mutation reddens **three**
  assertions, not two; and hugo's post-M5 map is ~193 **package** nodes, not 930 file nodes.
- **§6's header claimed four surfaces share one composed sentence**; the fourth writes its own, and
  the header is corrected rather than the code — the field notes are about notes, not coverage.
- **The two sides of the ratio are admitted under different rules, and this is left as it is.** The
  `UNREAD` tally runs *before* the size and binary checks (`walk.ts`), so a 2 MB or binary Go file
  counts as unreadable source while a 2 MB TypeScript file counts as neither mapped nor unreadable —
  it is `tooLarge` and nothing else. The bias runs toward refusing, which is the safe direction, and
  it flips **no verdict on any of the thirteen**. Kept because the alternative is worse: moving the
  tally after those checks would make a large Go file *invisible*, which is the defect this whole
  document is about. Written down because an asymmetry nobody has stated is one the next measurement
  will trip over.

The tally is worth keeping: of ten findings, **four were prose contradicting a measurement in the
same change**, one was a shipped behaviour with no test, and **one was the fixed defect still live in
production on a repo nobody had tried**. The last is the only one that no amount of re-reading would
have found, and it cost one clone.

---

## What would change this

- **A repo where the tenth is wrong.** The nearest measured neighbour on the shipping side is
  `sveltejs/svelte` at 43.7%, and the nearest on the refusing side is hugo at 2.5%. A repo landing
  between 2.5% and 10% would be the first real test of the bar's placement, and there is none in this
  set — so the bar is measured to be *safe*, not measured to be *tight*.
- **A documentation repo with a large body of example code.** `system-design-primer` is refused today
  (§5) and it is the one row of eleven where a reasonable person could disagree. What would change it
  is a signal that separates a code appendix from a codebase, and the two candidates are both
  outside this document: the *git history* (whose commits touch which files) and file size. Neither
  was measured here, and either would need its own ADR — the history one especially, because
  `commitsRetained / commitsWalked` reads 25.0% on cobra and 18.1% on hono, which is the wrong way
  round.
- **`UNREAD` growing an ambiguous extension.** The table is conservative by decision 5, which means
  it undercounts, which means it ships decks it should refuse — an Objective-C repo (`.m`) is
  currently invisible to this rule. That is the safe direction and it is a known gap rather than an
  accident.
- **A language ark scans arriving.** Decision 6 makes that a same-commit edit, and the disjointness
  test makes forgetting it a red suite rather than a repo counted as both mapped and missing.
