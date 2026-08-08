# Prior art — why the code-comprehension tools died, and what the evidence says about 3D

> **This closes NORTH-STAR risk #6 and ADR-0009's precondition P1**, four milestones later than the
> north star asked for it. It also **rewrites P1**, because the research found that P1 gates on the
> wrong question.
>
> - **Date**: 2026-08-07
> - **Method**: two independent research passes, one on the tools, one on the empirical literature.
> - **Status of the verdict**: P1's supersession clause is **not triggered**. The 3D direction
>   survives. What does not survive is the assumption that "3D" is one thing.

---

## 0. Evidence quality — read this before citing anything below

**Both research passes were blocked from nearly every primary source by this environment's egress
policy.** Reachable: `github.com`, `raw.githubusercontent.com`. Blocked: ACM DL, IEEE Xplore,
ScienceDirect, Springer, arXiv, PubMed, Semantic Scholar, Wikipedia, Hacker News, `web.archive.org`,
and the vendors' own sites including `sourcetrail.com` and `codescene.com`.

So: **the shape of the literature is well attested; the decimal places are not.** Every effect size
below reached us through a search engine that read the page for us. Two documents we most wanted
verbatim — Sourcetrail's discontinuation post and CodeSee's shutdown letter — were seen only in
snippets. Anything load-bearing should be re-verified from an unblocked machine before it is quoted
outward. Nothing here has been upgraded from inference to fact; where a claim rests on one summary,
it says so.

---

## 1. The verdict on P1

P1 read: *"a prior-art writeup on why Sourcetrail, CodeSee, CodeCity and Gource failed. If 3D
legibility is a primary cause for any comprehension-focused tool, this ADR is superseded."*

**No tool in this category died of 3D legibility.** Classified by primary cause:

| Cause | Tools |
|---|---|
| **(a) the spatial/3D representation failed to aid comprehension** | **none found** |
| (b) required a build / compiler | Sourcetrail, secondarily |
| (c) required uploading source | CodeSee, as a named weakness |
| (d) business / funding | **Sourcetrail, CodeSee, Sourcegraph (pivot)** |
| (e) it was a *viewer* — showed a picture, asked nothing | **Gource (by choice), Repo Visualizer, GitHub Skyline** |
| (f) research-prototype decay | **CodeCity, Code Park, CodeMetropolis, Softwarenaut, Moose** |

Two facts make (a) hard to sustain. **The flagship 2D tool died anyway** — Sourcetrail was
resolutely 2D, the exact thing you would build if you believed 3D was the problem, and it still
died. And **a 3D city-metaphor tool is alive and commercial today**: CodeCharta (MaibornWolff),
v1.143.0, actively maintained, sold into consulting engagements — the one row we verified by
fetching the source ourselves.

**P1 is therefore closed, and the ADR is not superseded.**

### But P1 gated on the wrong risk

The causes of death converge, and not on legibility:

> Sourcetrail's stated reasons were the **maintenance burden of a complex cross-platform
> architecture** and the founders' attention moving elsewhere. They gave the tool away in 2019
> because *"not all developers saw the value of the tool, making it difficult to sell"* — which
> removed the revenue that funded the maintenance that then killed it.

A 3D world is a large multiplier on exactly that burden — renderer, camera, navigation, performance,
platform breadth — applied to a project whose entire cohort died of maintenance burden and demand,
not of illegibility. **The historically attested question is not "does 3D hurt comprehension" but
"does 3D consume the maintenance budget that killed everyone else".** P1's replacement is stated in
§5.

---

## 2. The finding that actually matters: the axis is viewpoint, not dimension

This is the synthesis neither pass expected, and it changes what "third person" should mean here.

Sorted by result, the studies split on **where the viewer is**, not on how many dimensions:

| | Wins | Loses |
|---|---|---|
| **Viewpoint** | **Exocentric** — outside the structure, rotating it | **Egocentric** — inside it, walking |
| **Depth cue** | motion parallax (> stereo) | static projection |

**Every 3D result that beat 2D did so by giving the viewer motion parallax over a structure they
stayed outside of. Every 3D result that lost put the viewer inside it.** We found no study in which
first-person traversal of an abstract structure beat an overview of it.

### The strongest argument FOR — and it is about Ark's exact task

Path tracing in node-link graphs is measurably better in 3D with motion parallax:

- **Ware & Franck, ACM TOG 1996** — task was *"is there a path of length 2 between these two nodes"*.
  At a fixed 20% error rate: ~55 comprehensible nodes in 2D vs ~160 with stereo + motion parallax.
  **Motion parallax alone (+120%) mattered more than stereo alone (+60%).**
- **Ware & Mitchell, APGV 2005** — replication at high resolution: up to ~1,000 nodes at <10% error.
- **McGuffin, Servera & Forest, IEEE TVCG 2023** — **preregistered**, n=34, path tracing, 2D vs a
  rotatable 3D layout. **Error rates lower in 3D — despite the 2D condition having edge routing and
  interactive edge highlighting.** A strong 2D baseline, and 3D still won.

"Which files transitively depend on this one?" *is* a reachability query on a node-link diagram.
This is not a metaphor borrowed from geography or from word-list mnemonics; it is the same task
family, replicated across 27 years with a preregistration at the end. **And parallax carries the
larger half of the effect, so no headset is required — orbit-on-drag in a browser gets it.**

### The strongest argument AGAINST — and it is about walking

- **Cockburn & McKenzie, CHI 2002**, n=69: retrieval of items by location **deteriorated
  monotonically as freedom to place them in the third dimension increased** — 2D → 2.5D → 3D — and
  it did so in the **physical** condition as well as the virtual one, so it is not a rendering
  artifact. Spatial memory is Ark's core mechanic. This is the manipulation that degraded it.
- **Richardson, Montello & Hegarty, Memory & Cognition 1999**: map vs real navigation vs
  **traversing a virtual rendition** of a building. The **VE condition was worst overall** and was
  distinctively prone to disorientation after rotation. That is the closest existing analogue to a
  walkable overworld, tested on real geography — the domain most favourable to it — and it lost.
- **CodeCity does not say what it is quoted as saying.** Wettel & Lanza, ICSE 2011, n=41: +24%
  correctness, −12% time. **The control group used Eclipse plus an Excel spreadsheet, not a 2D
  visualization.** The experiment establishes *visualization beats no visualization*. Two summaries
  also report the gain concentrating on **overview tasks** — the flat map's home turf. The three VR
  follow-ups (n=24/26; n=20; Romano et al.) produced **speed** gains and **affect** gains with
  correctness null.
- Against a background where **62% of software-visualization approaches lack a strong evaluation**
  (Merino et al., JSS 2018, 387 papers surveyed), this is not a body of evidence that licenses a
  milestone-sized bet on any renderer.

**So: "spin the repo" is supported. "Walk the repo" is the designer's fantasy.** ADR-0009 already
orders the orbit before the avatar; the evidence says that ordering is right for a sharper reason
than caution — orbit is *where the measured win lives*, not a stepping stone to it.

### One thing nobody has measured, and it sits on our thesis

**Not one study in this literature measures retained structural knowledge after the tool is taken
away.** Every software-visualization experiment measures task performance *with the visualization on
screen*. NORTH-STAR §4's target outcome — the player can name the entry point, the regions and the
most-depended-upon module afterwards — has never been instrumented by anyone, in 2D or 3D.

---

## 3. The differentiator survives contact with the prior art

**No tool in ~30 years of this category ever verified comprehension as a product feature.** We
looked hard and found none.

The irony is sharp: **the measurement instrument existed in every serious study and was thrown
away.** Wettel's CodeCity experiment, Code Park's three user studies and Merino's HoloLens study all
did what Ark does — put comprehension tasks in front of users and score correctness — once, to the
researcher's benefit, to publish a paper. Then they shipped the tool without the quiz.

**Ark's actual novelty is turning the evaluation harness into the product.**

And the mechanic is the best-evidenced thing in this entire document, by a wide margin:

- **Adesope, Trevisan & Sundararajan, RER 2017** — 272 effects from 188 experiments. Practice
  testing vs restudying **g = 0.51**; vs no activity **g = 0.93**; **0.67** in classrooms. And
  **multiple-choice practice showed a larger effect (0.70) than short-answer (0.48)** — which is a
  direct endorsement of the select-a-subset format. Do not "improve" it into free text.
- **Karpicke & Blunt, Science 2011** — retrieval practice produced more learning than **elaborative
  studying with concept mapping**, and the advantage held on **inference** questions. It beat
  concept mapping *on a concept-mapping final test*. For a product whose one-liner is "learn it by
  mapping it", this is pointed: **being tested on structure beat building a diagram of it.**
- **Pan & Rickard, Psych. Bulletin 2018** — 192 transfer effect sizes, N = 10,382. Transfer
  **d = 0.40**, roughly 20–40% below the within-material effect. **This is the number attached to
  risk #1**; a transfer playtest should be powered for 0.40, not for the headline.

Nobody has run retrieval practice on systems comprehension. Ark is a plausible first.

### Nobody is doing this as a game

Searched dead projects, game jams, research prototypes and GitHub. Nearest misses:
`gh-dungeons` (deterministic-per-SHA dungeons — but **BSP procedural generation**, no mapping from
the graph, no question asked: the repo is a random seed, not the content); Code Park (3D, game-like,
comprehension-focused, user-tested — research only, still a viewer); CodeMetropolis (rendered in
Minecraft, still a viewer); Gitlantis (navigation cosmetics).

**Why not?** Speculation, flagged: the expensive part is not the game, it is the **deterministic
answer key**. A viewer can be 85% accurate and look fine; a grader that is 85% accurate destroys
trust on question seven. Guardrail 4 — *never generate a challenge whose ground truth is uncertain*
— is the thing nobody else was forced to write, and it is probably the moat.

---

## 4. What the prior art says to do differently

### 4.1 The global map is the dead pattern; focus+context is the survivor

Every whole-repo map in this history is dead or ornamental (Repo Visualizer, GitHub Skyline, Gource).
Every survivor shows a **local neighbourhood that expands**:

- **Mylyn** — the one scale solution that shipped to millions and became a business. Assign every
  artifact a *degree of interest* from interaction recency, then **filter the rest out of the view
  entirely**. It never tried to show you the system.
- **Sourcetrail** — refused to draw the hairball: the graph "focuses on the currently selected
  symbol while directly showing all incoming and outgoing dependencies."

Ark's fog plus direct-importers-only-until-`understood` is **already the surviving pattern**. Treat
the full map as silhouette and context, not as the interface.

### 4.2 Measure covered *mass*, not covered file count

CodeScene's power law: hotspots are **2–3% of code**, absorb **11–16% of commits**, and account for
**25–70% of defects**. So "% of files that can appear on a board" weights every file equally against
a distribution that is anything but.

Re-measured on that basis (this session):

| | files covered | dependent mass | churn | LOC | top-2% hubs | top-2% churn |
|---|---:|---:|---:|---:|---:|---:|
| ark | 70.8% | **98.9%** | 67.0% | 75.6% | 100% | **0%** |
| svelte | 6.9% | **63.9%** | 15.5% | 26.2% | 90.2% | 64.6% |
| vite | 10.5% | 11.1% | 8.7% | 3.9% | 29.3% | **2.4%** |

The "91% dark" alarm was **the wrong metric**. On svelte, 6.9% of files carry 64% of the
transitive-dependent mass and 90% of the top hubs. On ark, 99%.

Two real findings survive the reframing:

1. **vite is genuinely badly covered** — 10.5% of files, 11.1% of mass, 3.9% of LOC. Sampling is
   essentially *uniform*, which on a power-law distribution means we are not finding the important
   files. Known cause: the questions are about `playground/` fixtures rather than the source.
2. **Churn hotspots are systematically missed on all three** — 0% / 64.6% / 2.4% of the top 2%. The
   import graph and the change-history hotspots are **nearly disjoint populations**. That is a
   measured argument that the git-derived verbs cover *complementary* ground, not more of the same.

### 4.3 If we add depth, these are constraints, not preferences

Each traces to a specific result in §2.

1. **Preserve a permanent, one-keystroke survey view.** CodeCity's gains concentrated on overview
   tasks; ADR-0009's D1 already requires this.
2. **Orbit, do not walk.** Motion parallax is the active ingredient; embodiment is the part with
   evidence against it.
3. **Freeze X,Y; derive Z only.** Ware's effect is parallax *over a stable layout*. ADR-0009 already
   says this and the evidence backs it.
4. **Quantise Z.** Cockburn's losses grew with *freedom* in the third dimension; Patchworks' gains
   came where placement was **constrained**. Discrete topology-derived layers, not a continuous space.
5. **Landmarks, not terrain.** Globally visible landmarks improved incidental spatial learning
   measurably three weeks after a single exposure. Three or four always-visible hubs will do more
   than any amount of ground texture — and "richly modelled world" is the part of the Zelda fantasy
   the evidence gives us *least* reason to build.
6. **The decision earns the effect, not the camera.** Qin & Karimi's meta-analysis (128 effect sizes,
   33 experiments) finds active exploration beats passive, moderated by **decision-making**. Ark's
   player already chooses which landmark to investigate. A movement controller adds locomotion cost
   without adding a decision.
7. **No headset.** Session ceilings of 15–30 minutes for first-timers and poor text legibility are
   incompatible with pillar 6, and our nouns are file paths.
8. **Budget against the four named defects** (Merino et al. 2018): navigation, occlusion, selection,
   **text readability**. AR fixed the first two and not the last two, and Ark is text-heavy.
9. **Instrument the four-week mark.** Gamification shows a documented novelty effect with engagement
   dropping at ~4 weeks. A 3D world will produce a spike. **The spike is not evidence.**

### 4.4 The cheapest high-leverage finding, and it needs no 3D at all

**Map-derived spatial memory is orientation-specific; navigation-derived memory is not.** After
learning from a map, judgments are easy when aligned with the learned orientation and hard when
misaligned (Presson & Hazelrigg; Shelton & McNamara; König et al. found the same north-alignment
effect).

Ark's map is north-up and fixed, forever, by design. **Our players are likely encoding an
alignment-locked picture** — and Blast Radius picks an arbitrary subject each time, so we want
orientation-flexible knowledge. Rotating the map between challenges is a one-session change with a
clear predicted effect, and it addresses a documented weakness of exactly the learning modality we
chose. It is the highest-leverage, lowest-cost item in this entire document.

> **DONE 2026-08-08 —
> [ADR-0017](./decisions/0017-the-map-turns-between-challenges.md).** Grading a challenge turns the
> map by the golden angle. The step is irrational in units of a turn on purpose: measured over a full
> clear of this repo's deck, a hashed heading fails to turn at all 14 times in 80, and any round
> number closes into a cycle that puts 10–20 of those 80 questions back at exactly north-up. §2's
> closing point still stands over all of it — **nobody in this literature, us included, has measured
> retained structural knowledge after the tool was taken away** — so this is the bet this section
> argues for, not a demonstrated cure.

### 4.5 Individual differences may swamp the design question

Ishikawa & Montello, Cognitive Psychology 2006, n=24, ten weekly sessions: some participants had
near-perfect configural knowledge after one or two trials; others were **at chance after ten**. Most
either had it immediately or never got it. **If survey knowledge by navigation were the only path
Ark offered, a substantial fraction of users could not complete the product.** Keep the graded,
explicit path as the primary one.

---

## 5. P1's replacement

P1 is closed. It is replaced by **P1′**, which gates on the risk the history actually attests:

> **P1′ — the maintenance-budget gate.** Before any renderer change ships, the third-person layer
> must have a measured comprehension gain that justifies its ongoing cost, and the cost must be
> stated. Concretely: `npm run raster` re-measured **on real hardware** (the current 45/33/43 fps is
> a headless software-raster floor, not a desktop number), plus a stated estimate of the CI, review
> and platform surface the layer adds. Sourcetrail died of maintenance burden and weak demand, not
> of illegibility, and it was 2D.

And a second gate the evidence created rather than inherited:

> **P4 — orbit before avatar, and the avatar needs a route-shaped verb.** The measured 3D win is
> exocentric (parallax over a structure you stay outside of). Egocentric traversal is the condition
> that lost in both of the studies closest to it. So the walkable avatar is additionally gated on
> the **Trace** verb existing (M6) — before Trace, the product asks no question that walking can
> answer better than orbiting — and on the orbit's own measured results, per ADR-0009.

---

## 6. Sources

Every URL below was reachable only through a search intermediary except where marked
**[primary]**. See §0.

**Tools** — [Sourcetrail archive notice **[primary]**](https://raw.githubusercontent.com/CoatiSoftware/Sourcetrail/master/README.md) ·
[Sourcetrail issue #1214 **[primary]**](https://github.com/CoatiSoftware/Sourcetrail/issues/1214) ·
[Sourcetrail DOCUMENTATION.md **[primary]**](https://github.com/CoatiSoftware/Sourcetrail/blob/master/DOCUMENTATION.md) ·
[CodeCharta **[primary]**](https://github.com/MaibornWolff/codecharta) ·
[gh-dungeons **[primary]**](https://github.com/leereilly/gh-dungeons) ·
[GitKraken/CodeSee acquisition](https://www.crunchbase.com/acquisition/gitkraken-acquires-codesee--b5a40293) ·
[Gource](https://gource.io/) · [Code Park, VISSOFT 2017](https://www.eecs.ucf.edu/~jjl/pubs/vissoft17.pdf) ·
[CodeMetropolis](http://codemetropolis.github.io/CodeMetropolis/) ·
[CodeScene, Software (r)Evolution](https://codescene.com/blog/software-revolution-part1/) ·
[Mylyn FAQ](https://wiki.eclipse.org/Mylyn_FAQ)

**3D / graphs** — [Ware & Franck, TOG 1996](https://dl.acm.org/doi/10.1145/234972.234975) ·
[Ware & Mitchell, APGV 2005](https://dl.acm.org/doi/10.1145/1080402.1080411) ·
[McGuffin et al., TVCG 2023 (preregistered)](https://ieeexplore.ieee.org/document/10024310/) ·
[Wettel & Lanza, ICSE 2011](https://dl.acm.org/doi/10.1145/1985793.1985868) ·
[Moreno-Lumbreras et al., IST 2023](https://www.sciencedirect.com/science/article/pii/S0950584922001732) ·
[Huang, Pfister & Yang, Info Vis 2023](https://journals.sagepub.com/doi/10.1177/14738716231157082) ·
[Merino et al., JSS 2018](https://www.sciencedirect.com/science/article/abs/pii/S0164121218301237)

**Spatial cognition** — [Cockburn & McKenzie, CHI 2002](https://dl.acm.org/doi/abs/10.1145/503376.503413) ·
[Richardson, Montello & Hegarty 1999](https://link.springer.com/article/10.3758/BF03211566) ·
[Thorndyke & Hayes-Roth 1982](https://www.sciencedirect.com/science/article/abs/pii/0010028582900196) ·
[König et al., Frontiers in VR 2021](https://www.frontiersin.org/journals/virtual-reality/articles/10.3389/frvir.2021.625548/full) ·
[Qin & Karimi, QJEP 2024](https://journals.sagepub.com/doi/10.1177/17470218231185121) ·
[Ishikawa & Montello 2006](https://pubmed.ncbi.nlm.nih.gov/16375882/) ·
[Ma et al., Sci Reports 2022 (landmarks)](https://www.nature.com/articles/s41598-022-10855-z)

**Retrieval practice** — [Adesope et al., RER 2017](https://journals.sagepub.com/doi/abs/10.3102/0034654316689306) ·
[Karpicke & Blunt, Science 2011](https://www.science.org/doi/10.1126/science.1199327) ·
[Pan & Rickard, Psych Bull 2018](https://pubmed.ncbi.nlm.nih.gov/29733621/)

**Code + spatial memory** — [Kuhn et al., CodeMap, SOFTVIS 2010](https://arxiv.org/abs/1007.4303) ·
[Henley & Fleming, Patchworks, CHI 2014](https://dl.acm.org/doi/10.1145/2556288.2557073) ·
[DeLine et al., Code Thumbnails](https://www.microsoft.com/en-us/research/publication/code-thumbnails-using-spatial-memory-to-navigate-source-code/)

**Read in full when unblocked** — [arXiv:2504.04553](https://arxiv.org/html/2504.04553v2), ICPC 2026,
*Human–AI Collaboration for Code Comprehension*: uses comprehension quizzes as **reflective probes**.
That is Ark's mechanic, named, in a 2026 paper — used as an instrument *on* the user rather than as
a loop *for* the user. The closest thing to a competitor-in-waiting.

---

## 7. One warning this document leaves behind

**A `.md` file in `docs/` is exactly the artifact this whole category produced instead of a product.**
Sourcetrail's founders wrote a thoughtful post-mortem; CodeCity's author published an experiment
nobody built on; 62% of the field shipped approaches with no strong evaluation. This document is
worth exactly as much as the decisions it changes. The decisions it changed are in §4.2 (the
coverage metric), §4.4 (rotate the map), §5 (P1′ and P4), and ADR-0009's amendment.
