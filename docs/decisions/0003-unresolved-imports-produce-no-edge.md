# ADR-0003 — An import we cannot resolve produces no edge, and disqualifies a challenge

- **Status**: accepted
- **Date**: 2026-08-06
- **Implements**: guardrail 4 — "never generate a challenge whose ground truth is uncertain"

## Context

Guardrail 4 says a low-confidence analysis must not carry a challenge. That is a statement about
intent. It needs to become a computation, or it will be honoured right up until the first time it
is inconvenient.

The import scanner produces three kinds of outcome for a specifier:

1. it resolved to a file in the repo;
2. it resolved to something outside the repo — a node builtin, a declared dependency, a URL;
3. we could not work it out — a computed `import()`, a bare specifier matching no declared
   dependency, an absolute path, a module we skipped as too large.

The dangerous move is collapsing (2) and (3). A scanner that treats "it is a package" and "we have
no idea" as the same thing produces an import graph that looks complete and is not.

## Decision

### Confidence is a property of edges, and there is no "uncertain" member

`Confidence` is `'certain' | 'probable'`. There is deliberately no third value:

- **certain** — the specifier resolved to exactly one file.
- **probable** — resolution had more than one viable answer and we took the first in a fixed
  priority order. The live case is `./x.js` when both `x.js` and `x.ts` exist: Node would load one,
  TypeScript the other, and the source does not say which the author meant.

An outcome of kind (3) produces **no edge at all**. Instead the specifier is recorded on the
importing node's `unresolved` list. An edge in the atlas therefore always points at something real
— the player never has to reason about a phantom.

Outcome (2) produces no edge either, and is recorded on `externals`. It carries no risk: nothing
outside the repo can import back into it.

### The challengeability rule

Blast Radius asks "which of these files break if I change the subject?". The answer key has two
halves, and only one of them is fragile:

- *"these candidates depend on the subject"* — **safe**. An import we failed to resolve can only
  ever *add* reachability, so anything we already traced really is a dependent. The truth set is a
  lower bound, and every member of it is correct.
- *"the rest do not"* — **fragile**. A candidate we are presenting as a distractor might reach the
  subject through an import we could not resolve. Marking a player wrong for picking it would be
  our error, sold to them as theirs.

So `isChallengeable(graph, subject, candidates, depth)` in `src/atlas/graph.ts` refuses a challenge
when, within the depth bound:

- any candidate, or anything on its outgoing side, has a non-empty `unresolved` list; or
- any edge reachable from a candidate is `probable` rather than `certain`.

Note the second bullet in the first condition. A candidate that is itself perfectly clean can still
have an untrustworthy verdict, because it reaches the subject *through* a file that isn't. The rule
walks the candidate's transitive dependencies, not just the candidate.

The subject is checked too. Its own unresolved imports cannot change who depends on it, but they
mean we do not fully understand the file we are asking about, and a cycle back through one would be
invisible.

## Alternatives rejected

**A numeric confidence score with a threshold.** `0.7` reads as if it were measured. It would be a
number someone picked, propagated through arithmetic nobody could justify, and compared against
another number someone picked. An enum forces the honest question — did it resolve, yes or no.

**Emit uncertain edges and let the player see them greyed out.** Attractive, and it fails the
grading contract: `grade()` is a pure function of `(challenge, answer)` and has no way to price a
maybe-edge. It also breaks the promise that a wrong pick teaches — being marked wrong on an edge
the tool itself was unsure about teaches the wrong lesson.

**Refuse to generate any challenge if the repo has any unresolved import anywhere.** Sound, and far
too strict: one dynamic `import()` in a plugin loader would silence the entire atlas. Scoping the
check to the candidates' reachable set is the tightest rule that is still sound.

## Consequences

- A repo full of dynamic dispatch yields fewer challenges rather than wrong ones. That is the
  trade guardrail 4 asks for: a missing challenge costs nothing, a wrong answer key costs trust
  permanently.
- `node.unresolved` is a diagnostic the CLI prints, so "why does this repo have so few challenges?"
  has an answer a user can act on.
- `tests/atlas/atlas.test.ts` asserts this repo currently has **zero** unresolved imports, and
  prints them if that changes. The bootstrap repo staying fully resolvable is a property worth
  defending.
