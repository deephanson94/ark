# ADR-0046 — The opening is a rank term, and it has to be a list

**Status**: accepted · built · 2026-08-14
**Follows**: [ADR-0045](./0045-tier-2s-third-question-is-two-questions-and-only-one-survives.md) §5.6,
[ADR-0040](./0040-a-progression-ascends-through-each-verbs-own-range.md).
**Bears on**: [ADR-0011](./0011-progress-is-keyed-to-the-repo-and-notes-claim-only-what-was-proved.md)
decision 4 (this is its third amendment), and ADR-0025's whitelist landmine, which it walks into
deliberately.

**Measured on** corpus clones: `ark` `9b86d12`, `honojs/hono` `7075369e`, `kysely-org/kysely`
`f24018c7`, `graphql/graphql-js` `9c245018`. Reproduce with
`npx tsx scripts/probe-opening.ts /tmp/ark-corpus ark hono kysely graphql-js`; `ARK_SHOW=1` prints
the served fifteen with their flags. §4 and §7 add eight further repos from a post-ship review.

---

## 1. The complaint, and why it is not an ordering bug

Three cold playtests rated the product 4/10, 5/10 and 4/10 and all three named the first fifteen
boards. ADR-0040 fixed the half that ordering can fix — the second verb now arrives at board 5 rather
than 25 — and left the residue.

ADR-0045 §5.6 established why the residue is not reachable by ordering *within* Blast Radius: §8.4
makes a **real** subject a hard question, since `breadth` is a term in both difficulty and
load-bearingness (ADR-0040's ρ = 0.96). So that verb's easy end is by construction its peripheral end,
and there are **zero** boards at difficulty ≤ 0.30 whose subject has even one non-leaf dependent. The
openings measured before this change:

| repo | first five subjects served |
|---|---|
| hono | `benchmarks/jsx/src/preact.ts`, `keys.test.json`, `benchmarks/query-param/src/qs.mts`, `benchmarks/jsx/src/react-jsx/react.ts`, `src/jsx/dom/server.ts` |
| graphql-js | `__testUtils__/viralSchema.ts`, `resources/strip-private-declarations.ts`, `__tests__/simplePubSub.ts`, `__testUtils__/kitchenSinkSDL.ts`, `__testUtils__/getTracingChannel.ts` |
| kysely | `jsr.json`, `src/readonly/readonly-driver.ts`, `package.json`, `example/src/util/errors.ts`, `src/index.ts` |
| ark | `src/player/challenge.ts`, `src/indexer/serve.ts`, `src/player/tally.ts`, `src/verbs/companion/cochange.ts`, `src/player/ui.ts` |

**ark's opening was never broken**, which matters: the bootstrap repo is the one a session looks at,
and the defect concentrates on hono and graphql-js — `docs/experiments/0001`'s matched pair, the two
repos twelve participants would actually meet.

## 2. The graph property was tried first, and it cannot work

The proposal was a pure graph term with no list in it: **demote a subject with zero transitive
dependents that themselves have dependents**. It is exactly the quantity ADR-0040 measured its ρ
against, and it is refuted by one witness pair on this repo:

```
src/indexer/build.ts       cone 12, of which non-leaf 0
tests/fixtures/atlas.ts    cone 31, of which non-leaf 0
```

`src/indexer/build.ts` is the indexer's orchestrator — ADR-0041's naming rule names a whole map region
*"around `src/indexer/build.ts`"*. It carries the fixture signature because everything importing it is
a script, a test or the CLI, and those are entry points with no importers of their own. hono has the
same pair (`src/adapter/vercel/handler.ts` against `keys.test.json`). **An orchestrator near the top
of a program and a fixture consumed by tests are topologically the same shape**, so no predicate over
the import graph separates them; the distinction lives in a layer the graph does not record. That is
`CLAUDE.md`'s entry-point landmine one level up — *a file whose dependents are all entry points is not
peripheral*.

Measured, it flags **seven** of ark's served fifteen, of which **five are real modules** —
`challenge.ts`, `serve.ts`, `tally.ts`, `build.ts` and `experiment.ts`, the last being ADR-0037's
shipped instrumentation — against two genuine fixtures. *(An earlier draft said "four real against
two", which undercounts this document's own evidence against the property it is refusing.)*

The cone-size floor is refused for a separate reason already on record: it re-derives
ADR-0040 §3's rejected landmark term, and it sinks exactly the edgeless files Companion exists to
reach.

## 3. Decision

**Decision 1 — one rank term, `sideshow`, and it may only demote.**

`isSideshow(path)` in `selector.ts`. It cannot refuse a board, cannot reach `retain`, cannot change an
answer key, and cannot change what is drawn. The whole deck is still served and still finishable.

**Decision 2 — it is a path list, and demotion-only is what makes that acceptable.**

ADR-0025's landmine is that *"a decision not to include something and a failure to think of it look
identical in a table"*, and it cost 64 challenges about a Terraform repo's documentation because `.tf`
was missing. The bar for putting a list in the product is therefore high, and it is cleared here by
**what happens when the list is wrong**, not by the list being right:

- a **missing** pattern costs one junk board served early — the defect this reduces, not a new one;
- an **over-firing** pattern costs one good board served later, and it is still served.

Both failures are soft. No other mechanism in this repository can say that about a whitelist.

Part of it is a **rule** rather than a list — a manifest or a Markdown file is not a source file and
so cannot be a module worth opening on, and neither has a false-positive mode; `testdata` is
rule-grade too, since the Go toolchain reserves that directory name. The rule alone is not enough: it
catches 1 of hono's 4 junk openings and 0 of graphql-js's 8. **The list is what carries the two repos
that matter**, which is the honest statement of what is being bought.

**Decision 3 — it sits *above* `progress`, and the argument for below was refuted by measuring it.**

The argument for below was that a term this high flattens the progression — every real subject before
any sideshow one, whatever the difficulty — and undoes ADR-0040's interleave. Measured at three
placements, it is backwards in both halves:

| repo | test-pathed in the first 15 | | | 2nd verb arrives at board | | |
|---|---|---|---|---|---|---|
| | baseline | below | **above** | baseline | below | **above** |
| ark | 1 | 0 | **0** | 4 | 4 | **4** |
| hono | 4 | 4 | **0** | 6 | 2 | **2** |
| kysely | 2 | 1 | **0** | 7 | 3 | **3** |
| graphql-js | 8 | 8 | **0** | 8 | 2 | **2** |

Below `progress` the term is nearly inert where it is most needed, because it can only reorder
*within* a band and Blast Radius's band 0 is **entirely** sideshow on graphql-js. And the interleave it
was supposed to protect gets **better**, not worse — the boards being demoted were the ones crowding
it out.

The openings after the change: hono `src/jsx/dom/server.ts, http-status.ts, client.ts,
reg-exp-router/index.ts, jsx-runtime.ts`; kysely `readonly-driver.ts, src/index.ts,
insert-query-node.ts, mysql-adapter.ts, on-duplicate-key-node.ts`; graphql-js
`resources/strip-private-declarations.ts, characterClasses.ts, GraphQLError.ts, collectFields.ts,
didYouMean.ts`. **ark's first five are character-identical to before**, which is the acceptance
criterion for a repo that was not broken — its *fifteen* move by two boards, `probe-nameable.ts` and
`tests/fixtures/atlas.ts` out for `blastRadius/reveal.ts` and `world/hero.ts`, which is the term doing
its job. Saying "ark's opening is unchanged" alongside "1 → 0 on ark" would be two claims that cannot
both hold of the same fifteen.

## 4. Two known gaps, stated rather than patched

Both were found by running the shipped predicate over eight repos this decision was not designed on —
django, hugo, prometheus, typeorm, rxjs, excalidraw, flask, cobra.

**Missing: `resources/`, `docs/`, `site/`, `tools/`.** graphql-js still opens on
`resources/strip-private-declarations.ts`; rxjs opens on `apps/rxjs.dev/tools/*` website tooling and
hugo on stray `docs/assets/js/*`. None is being added: each is a plausible real-source directory on
some other repository, and adding them blind is the failure this ADR is supposed to be honest about
rather than repeat.

**Over-firing: a product module legitimately named `test`.** `django/test/client.py` is
`django.test.Client`, real user-facing product source. rxjs publishes `@rxjs/test` from
`packages/test/src/`, so five product files are demoted there. Measured across those eight repos this
is the **only** false-positive shape the list has — typeorm's 242 flags are all `test/functional/*`,
prometheus's 9 are testdata, `.test.tsx` and manifests, and hugo flags none. Demotion-only is what
makes it soft: those files are served later, never lost.

**Two clauses were widened on that evidence**, both to rule grade rather than list grade: `.md` joins
`.json`, because a Markdown file is definitionally not a module and has no false-positive mode (it
fixes cobra's and flask's openings, and is a no-op on an all-Markdown map, where uniform demotion
falls through to the rank below); and `testdata` joins the segment list because the Go toolchain
reserves and ignores that directory name. The `__…__` convention is a wrapper in the pattern rather
than three more entries — enumerating it is how `__testdata__` was missed while `testdata` was
present, which is a list inside a list with the same failure mode one level down.

## 5. What it cost elsewhere

**The e2e's walking assertion went red, and the fix was not to loosen it.** That step enters the world
with nothing selected — which spawns the hero at the shore — and asserts that walking surveys
something new. The buildings near the shore are the ones a session has already surveyed by then, so
the assertion had been thinning for milestones: `63 → 65`, then `67 → 69`, then **`74 → 75`**, one new
building in six sweeps. This change surveys eight more nodes earlier and tipped it to `82 → 82`.

**A test that goes red because the product improved is measuring the wrong thing.** The first repair —
sweep harder, at 2.1× run speed — traded the failure for a different one: the hero leaves the map and
the *next* assertion goes red with `17 towers · 0 roads` on screen, which the screenshot shows plainly.
The repair that holds is to enter the world from a **selected node**, which is ADR-0032 §3.4's fast
travel and the representative path anyway; the hero then arrives in the city with something to find.
The deadline is untouched, so a genuinely dead surveyor still fails.

## 6. What this does not claim

It does not claim the opening is now good — only that it is no longer a fixture, a benchmark or a
manifest on the four measured repos. Whether the loop lands is what `docs/experiments/0001` is for,
and it remains unrun; every review in this lineage has said the experiment outranks the work around
it, and this change is worth its afternoon mainly because hono and graphql-js are the repos those
participants will see.

---

## 7. Post-review

Reviewed at `5e0b663` against eight repos this decision was not designed on. §4's second gap class,
the two rule-grade widenings, and §2's and §3's corrected counts all come from it. Three further
things it established:

**The branch was red and the commit message said otherwise.** `npm run test:e2e` failed
deterministically at `5e0b663` — twice, identically — on a step this change never touched:
*"no click on the map ever ticked a candidate"*. The cause is that step's own sweep, whose loop bounds
never reach their own denominators (`column < 30` over `/44`, `row < 20` over `/24`), so it searched
66% by 79% of the canvas. It passed for milestones because the marks happened to land there; **ark
indexes itself, so this commit re-rolled the layout and put all 19 of them outside the swept
rectangle**. The e2e was clean on the working tree and not on the tree that contained the commit —
the *measured-on-the-tree-that-does-not-yet-contain-it* landmine, arriving on a test claim rather than
on a figure. Fixed by sweeping the whole canvas.

**Demotion-only holds in the code and not merely in this document.** `isSideshow` has no consumer in
`src/` outside `selector.ts`; `suggestNext` has exactly one caller; nothing in `src/verbs`,
`src/indexer` or `src/atlas` imports the selector, so `retain`, the generator and the atlas are
unreachable from the term. The default `pathOf` keeps every other caller's rank bit-identical, and a
commit subject resolves to `null` and is never demoted.

**The e2e entry change is not a loosening, with one hole now closed.** `surveyedBeforeWalk` is read
*after* entry, so the entry click's own surveys land in the baseline, and the deadline preserves
falsifiability — a dead surveyor still fails. But if the entry grid found no clickable node the step
fell back to the shore *silently*, inheriting exactly the fragility the entry exists to remove. It
now fails loudly instead.
