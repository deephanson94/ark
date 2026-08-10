# ADR-0027 — A board is asked in the noun its members actually are

- **Status**: accepted
- **Date**: 2026-08-10
- **Implements**: [ADR-0026](./0026-a-go-node-is-a-package-and-its-scanner-is-hand-rolled.md)'s
  Consequences — *"the player calls every Go package a 'file' … it should be the next thing fixed"*
- **Bears on**: NORTH-STAR pillar 1 (ground truth or nothing), §9 (the console);
  [ADR-0020](./0020-a-wrong-answer-carries-the-reason-it-was-offered.md) (wording belongs to the
  verb), [ADR-0018](./0018-a-subject-is-a-place-or-an-event.md) (a subject is a place or an event),
  [ADR-0025](./0025-a-deck-is-refused-when-the-map-is-not-of-the-repository.md) decision 5 (*the cost
  of a wrong name*)
- **Code shipped**: `memberNoun` / `counted` / `pathLabel` / `wordsFor` in `src/verbs/members.ts`, the
  `Words` contract, `NoteFacts.noun` and `.populationNoun`, and the wording in all four verbs and two
  reveals.

---

## 1. The defect, as a sentence a player reads

> A breaking change lands in `hugolib`. Which of these **files** depend on it?

There is no file called `hugolib`. It is a directory of 95 of them, and since ADR-0026 it is one
node — a Go **package**. Every board a Go repo ships said this: 153 of `gohugoio/hugo`'s 156 Blast
Radius boards, 35 of `prometheus/prometheus`'s 63, and every history board about a package.
`spf13/cobra`, whose Go is one flat package at the repo root, additionally read *"changed alongside
`.`"*.

The boards are **correct** — ADR-0026 measured 0 invariant violations and 0 wrong answer keys. This
is the noun, and by ADR-0025 decision 5's own standard it is the cost that mechanism exists never to
pay: *the cost of a wrong name is ark printing a false claim about the reader's own repo.*

---

## 2. Why the verb could not fix it alone, and why the console must not

`Verb.prompt(challenge, labelOf)` is pure over a challenge and a name lookup. It has **no atlas**, so
it cannot tell a package from a file. Until Go that cost nothing: every member of every board was a
file, and every verb said so correctly.

The cheap fix is to move the sentence into the console, which has the graph. That is exactly what
ADR-0020's landmine forbids — *"anything a verb says about its own question belongs on the `Verb`
contract, not in the panel"* — and the repo has already paid for it once, when templating a verb's
title into a fixed sentence produced *"Map its companion"*.

So the **caller supplies the fact and the verb keeps writing the sentence**:

```ts
interface Words {
  label(id: AtlasId): string;
  noun(ids: Iterable<AtlasId>): Noun;   // file | package | commit | place
  readonly repo: Noun;
}
```

`noun` takes a **set** rather than the caller handing down one word per board, because a verb's
sentences count different populations and only the verb knows which: Archaeology's question is about
its members (commits) while its instruction is about its **subject** (*"inside this package's
lifetime"*). One noun per board would have been wrong on one of those two sentences on every
Archaeology board a Go repo ships.

`repo` is the third population and it exists for one sentence: Companion states the wide-commit
limit, which counts **nodes touched**, not this board's members.

---

## 3. A mixed board is the normal case, which is what decides the vocabulary

The tempting rule is *name the kind*. Measured over every shipped board:

| | hugo | prometheus | cobra |
|---|---|---|---|
| Blast Radius, members all one kind | 145 of 156 | 36 of 63 | — |
| Companion, **mixed** | **151 of 156** | **63 of 63** | 9 of 12 |
| Placement, **mixed** | **118 of 121** | 62 of 63 | 38 of 38 |

A commit touches whatever it touches, so the history verbs' boards hold Go packages *and* Markdown.
Mixed is not an edge case to fall back from; on two verbs it is the **majority**. So the vocabulary
needs a fourth word that is true of a mixed set, and it gets one the product already owns:
**place** — ADR-0018 is titled *"a subject is a place or an event"*.

*Truth* sets are markedly more uniform than candidate sets, and Blast Radius's are **100% uniform on
both repos** for a structural reason: only Go imports Go, so a package's cone holds packages. That is
why `NoteFacts` carries **two** nouns — a note can honestly say *"you proved 4 packages"* out of a
population of *places*, and one noun would be wrong about one of its two sentences.

The noun is keyed on `(kind, lang)`, not on `kind`: `dir` is a *shape* and `package` is Go's name for
it. A later language that groups by directory and calls it a crate adds a row and changes nothing
about who asks.

---

## 4. What it costs the repos that were already right

**Nothing, byte for byte.** All 160 of ark's prompts and all 216 of hono's were rendered through the
old contract and the new one and diffed: **character-identical**, question, instruction and button
alike. Every node in those repos is a file, so every noun resolves to the word that was hard-coded.

*(The first run of that comparison was a **vacuous pass**: both sides were the same v9-validator
error, because the atlases predated ADR-0026's version bump. The check now gates on 160 and 216
rendered rows before diffing. An instrument that measures nothing looks exactly like good news.)*

`tests/atlas/` holds the standing half: on the bootstrap repo every board must ask in `files` — or
`commits` for Archaeology — so grouping TypeScript, or breaking `memberNoun`, moves ark's own wording
and goes red instead of changing sentences quietly.

---

## Decision

1. **A board is asked in the noun its members actually are**, derived from the atlas at render time
   and never hard-coded in a verb.
2. **The caller supplies the fact; the verb writes the sentence.** `Words` carries a label, a
   set-to-noun function and the repo-wide noun. Putting the wording in the console instead is the
   cheap fix ADR-0020 forbids.
3. **`noun` takes a set**, because a verb's sentences count different populations — members, subject,
   repo — and only the verb knows which one each sentence is about.
4. **A mixed set is a set of `places`**, the product's own word for a node (ADR-0018), because mixed
   is the majority shape on two of four verbs rather than a fallback.
5. **`pathLabel` glosses the repo root once**, so `.` reads as `. (the root package)` everywhere —
   board row, sentence and field note alike. One label rule, not a display exception.

---

## Alternatives rejected

**Drop the noun: *"Which of these depend on it?"*** True of every board and needs no mechanism at
all. Refused because the counting sentences cannot do it — *"You proved 4 that depend on X"* — so it
would fix the question and leave the note, which is two rules for one fact.

**Say "files and packages" on a mixed board.** Accurate and it reads acceptably in a question, but
*"You proved 4 files and packages"* does not, and the phrase needs ordering and agreement logic that
a single noun does not.

**Put the noun on `Challenge`, in the atlas.** The generator knows exactly what its members are. It
is a schema change (`ATLAS_VERSION` 11) to store something the player can derive from the graph it
already has, which is the second-encoding ADR-0025's alternatives section refuses.

**Pick the majority kind on a mixed board.** A lie by proportion, and the proportions are not even
lopsided.

---

## Consequences

- `Verb.prompt`'s signature changed, which the compiler caught at all three production call sites and
  in five tests. That is the seam working: nothing had to be found by grepping.
- The inspector and the console now share one `wordsFor(graph)`. They previously shared nothing, and
  ADR-0020's landmine is about exactly that pair — the seam held in the console and failed in the
  inspector, which nobody had thought about.
- **A Python node will be a file** (its unit of import is the module, and a module is a file), so
  M5's Python half adds no noun pressure. The mechanism is here for the next language that groups.
- Nothing about grading, generation or the atlas changed. `test:determinism` is green and the atlas
  is byte-identical apart from this repo's own new source files.
