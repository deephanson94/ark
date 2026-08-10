# ADR-0031 — The repo goes public, and the flip is a checklist rather than a switch

- **Status**: accepted — **prep shipped; the visibility flip itself is the owner's action and has not
  happened.** See §5.
- **Date**: 2026-08-10
- **Supersedes the precondition of**: [ADR-0015](./0015-pages-is-not-deployed-while-the-repo-is-private.md)
  — *"publishing returns the day the repo is public"*
- **Bears on**: NORTH-STAR's header (the name is a placeholder with known collisions), §10
  (`npx ark`); [ADR-0029](./0029-npx-ark-is-a-script-not-a-checkbox.md) (packaging, and why
  `private: true` stays); pillar 5
- **Bumps**: nothing.
- **Code shipped**: `LICENSE`, and this document. **Not** `pages.yml` — §5 says why.

---

## 1. What actually forced it, and it is not what it looked like

The repo is hitting GitHub's 2,000 CI/CD minutes a month, which are free for public repositories.
Before treating that as the reason, it was measured — billed from a real run (PR #39, run
`31401258605`):

| job | runner | wall | billed |
|---|---|---|---|
| build and test | ubuntu | 36 s | 1 |
| player smoke test | ubuntu | 98 s | 2 |
| atlas fingerprint (ubuntu) | ubuntu | 18 s | 1 |
| **atlas fingerprint (macos)** | **macos** | **15 s** | **10** |
| atlas fingerprint (windows) | windows | 38 s | 2 |
| platforms agree | ubuntu | 6 s | 1 |
| | | **3½ min of compute** | **17 billed** |

macOS bills at **10×** on a private repo and GitHub rounds every job up to a whole minute, so **a
15-second job is 59% of the bill** — more than everything else put together. 17 minutes a run is 117
runs a month, and a working session spends eight of them.

**So the honest statement is that CI is not heavy; a multiplier is.** That matters because it means
going public is not the *only* fix, and a document that quoted "we are out of minutes" without the
table would have made it look like one. The alternative — moving the three-platform matrix off every
push — was offered and **declined**, on the correct ground that the minutes become free anyway and
ADR-0006's cross-platform determinism guarantee is worth keeping at its tightest. That is a decision
about what to keep, not an oversight.

---

## 2. Why public is right independently of the minutes

- **ADR-0015 exists only because the repo is private.** `pages.yml` was deleted — not disabled —
  because Pages on a private repo needs a paid plan, so the workflow failed on every run it ever had
  and got normalised into background noise. That document names its own reversal: *"publishing
  returns the day the repo is public"*. This is that day.
- **The product is a tool you point at other people's repositories.** A stranger cannot evaluate
  `npm run play -- <path>` without reading what it does to their source, and pillar 5 — *source never
  leaves the machine* — is a **promise**, which is worth exactly as much as the ability to check it.
  A private repo asks to be trusted; a public one can be read.
- **The bootstrap fixture is the demo.** NORTH-STAR §11 makes this repo v1's only target, and §7
  says an atlas of a public repo may be shared. The deployed player would be ark's map of ark, which
  is the one codebase whose map this project can vouch for.

---

## 3. What was checked before recommending it

A pre-publication pass, run rather than assumed:

| check | result |
|---|---|
| tracked files whose *name* suggests a secret (`.env`, `*.pem`, `*.key`, `id_rsa`, `token`, `credential`) | **none** |
| every added line across all **130** commits against `ghp_`, `github_pat_`, `sk-…`, `AKIA…`, `-----BEGIN … PRIVATE KEY`, `xox[baprs]-`, `Bearer …` | **no match** |
| author identities in history | two — the owner's, and `noreply@anthropic.com` |
| tracked agent configuration | `.claude/settings.json` only: a model name, an effort level, a permission mode, and a hook that runs `scripts/install_pkgs.sh`. `settings.local.json` is gitignored |
| generated artefacts | `atlas.json`, `dist/`, `node_modules`, `src/player/public/`, `artifacts/` all gitignored |

**What that does not cover, stated rather than implied**: a pattern scan finds secrets that *look
like* secrets. It cannot find a password that looks like a word, and it was run over added lines
rather than over every blob. The residual risk is low for a repo with two authors and no deployment
credentials, and it is not zero.

---

## 4. What it costs, and one of the two is a real decision

- **Publication is irreversible in effect.** Flipping back to private later does not un-publish: the
  130 commits, every ADR and the whole CHANGELOG can be cloned, forked, cached and archived in the
  interval. This is the ordinary cost and it is accepted.
- **The name goes out before it is settled, and NORTH-STAR's header says not to do that.** Its
  wording is *check npm / GitHub / the domain **before anything public***, and `ark` collides with
  *ARK: Survival Evolved*, ARK Invest, ark.io and KDE's `ark`. ADR-0029 restated it three commits
  ago. **Accepted deliberately**, on the distinction that document already draws: a public *repo* is
  a weaker form of public than an npm *publish*, `private: true` stays in `package.json`, and nothing
  here claims the name on a registry. The cost is that a rename gets more expensive the moment
  someone has the URL — which is a reason to settle it soon, not a reason to delay the flip.
- **The documents name a prior project of the owner's.** `Promptasy` appears **19 times across four
  files** — NORTH-STAR's §0, Appendix A and B, `CHANGELOG.md`, ADR-0009 and ADR-0024 — with details
  about its internals (130 authored skills, eleven board types, 40+ iteration phases). That is the
  owner's to publish or redact and this document does not decide it; it is written down here because
  *"nobody thought about it"* and *"we decided that was fine"* look identical afterwards, which is
  this repo's own landmine about lists.

---

## 5. The flip is a checklist, and it is a checklist because of ADR-0029

**`pages.yml` is deliberately *not* restored in this change**, and the reason is the defect ADR-0015
is about. Restoring it while the repo is still private puts a workflow on `master` that fails on
every run — the permanently-red check that gets normalised into noise, which is the exact thing that
document deleted the file to stop. So the restore belongs *after* the flip, not before, and it is one
line.

Ordered, because two of these only work once the one above has happened:

1. **Owner**: Settings → General → Danger Zone → *Change visibility* → Public.
2. **Owner**: Settings → Pages → Source: **GitHub Actions**. (Pages is not enabled by making a repo
   public; it is a separate switch, and skipping it makes step 3 red.)
3. Restore the workflow — ADR-0015's own line, from the commit that deleted it:
   `git show a50462b:.github/workflows/pages.yml > .github/workflows/pages.yml`, then align its
   hard-coded `node-version: '22'` with `ci.yml`'s `env.NODE_VERSION` so the two cannot drift.
4. **Check the run.** Both workflows, on `master`, on the commit that landed — *list the workflows
   before you claim they passed*, which this repo learned by reporting CI green three times while
   `pages.yml` had failed on every run it ever had.
5. Move `README.md`'s **No Pages deploy** row out of Known gaps and put the deployed URL in its
   place.

**This list is written down instead of remembered for the reason ADR-0029 exists**: an item nobody
can execute gets ticked from memory. Steps 1 and 2 are the owner's and cannot be scripted; steps 3–5
are checkable and should not be claimed until step 4 has actually been read.

---

## Decision

1. **The repository becomes public.** The minutes are the trigger; ADR-0015 and pillar 5's
   checkability are the reasons that survive the trigger.
2. **A `LICENSE` file ships in the same change.** `package.json` has said `"license": "MIT"` since
   M0 and there was no licence file, which means *all rights reserved* to anyone who reads the repo
   — a manifest field is metadata and the file is the grant. This is the one thing in the prep that
   would have been a real defect rather than a tidy-up.
3. **`private: true` stays in `package.json`, and the documents keep saying *"pack it and install
   it"* rather than `npx ark`.** GitHub-public and npm-published are different things and ADR-0029's
   naming argument is untouched by this one.
4. **The three-platform fingerprint matrix is unchanged.** It could have been trimmed to save 12 of
   17 billed minutes; free minutes make that a saving with no purchaser, and ADR-0006's guarantee is
   kept at its tightest instead. Recorded so that a later session reading §1's table does not
   conclude the trim was forgotten.
5. **`pages.yml` is restored *after* the flip, not with this change** (§5). A workflow that must fail
   until an unrelated switch is thrown is the thing ADR-0015 deleted.

---

## Alternatives rejected

**Stay private and trim the CI matrix.** The measured saving is real — a PR run drops from 17 billed
minutes to 5, which is 400 runs a month instead of 117 — and it was offered and declined. It buys
minutes at the cost of checking cross-platform determinism per merge instead of per push, and going
public buys the same minutes for free while keeping the check. It remains the right move if the
repository ever goes private again.

**Settle the name first, then publish.** Defensible, and rejected as sequencing: the naming decision
needs npm, GitHub and domain checks plus a judgement about the product, and holding the flip behind
it pays CI minutes for a decision that has no deadline. The cost of publishing first is bounded and
named in §4.

**Squash or rewrite history before publishing.** Refused. The history *is* the artefact here — 130
commits, 31 ADRs and a CHANGELOG that records every measurement and every correction, which is the
most legible thing this repository has. Rewriting it to look tidier would also invalidate every
`originPath`-derived node id (ADR-0002) and therefore every saved playthrough, which is the asset
that whole ADR exists to protect.

**Publish a filtered copy to a second repo.** All of the cost of a fork, none of the benefit: two
histories to keep in step, and the private one still burns the minutes.

---

## Consequences

- **CI minutes stop being a constraint**, so the sixth job added by ADR-0029 (`test:pack`, ~30 s) and
  the macOS leg both stay.
- **ADR-0015's status becomes historical rather than current.** Its analysis of *why* a permanently
  red workflow is worse than a deleted one stands and is quoted in §5; its precondition is gone.
- **`README.md` gains a licence and loses its Known-gaps row about Pages** — the latter at step 5 of
  the checklist, not before, because the row is true until the deploy is green.
- **Anyone can now check pillar 5 rather than trust it.** That is the change worth the most and the
  one no measurement in §1 captures.

---

## What would change this

- **A secret found after publication.** Rotate it; do not rely on making the repo private again,
  which does not un-publish anything (§4).
- **The name.** If it is settled to something else, the rename is a content edit in `package.json`,
  `NORTH-STAR.md`, this document and the `bin` name — NORTH-STAR's header notes deliberately that the
  product name appears in no *filename*, so a rename is never a file move. It gets more expensive
  once the URL is in circulation.
