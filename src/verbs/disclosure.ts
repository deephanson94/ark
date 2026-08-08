/**
 * What an earlier reveal has already told the player — ADR-0019 decision 7.
 *
 * Until M4's third verb, every verb generated in isolation: `generate(atlas,
 * options)` saw the repo and nothing else. That was correct while no two verbs
 * asked about the same underlying relation. Placement and Archaeology are the
 * two projections of one incidence matrix — *commit → which files?* and
 * *file → which commits?* — so **Placement's reveal, which names the files a
 * commit touched, states an atom of some file's Archaeology answer key**.
 * Measured before this module existed: 55.6% of this repo's Archaeology key
 * members and 15 of 66 candidate boards entirely, against 16.0% and 1 of 172 on
 * `honojs/hono`. The bootstrap repo is the worst case, because a small commit
 * count means the earlier verb's deck covers nearly all of it.
 *
 * ## Why a set of facts and not "the other verb's deck"
 *
 * The obvious implementation is to hand Archaeology the Placement challenges and
 * let it look inside them. That is a verb naming a verb, which is the coupling
 * CLAUDE.md forbids and the seam M4 spent its budget building. Instead every
 * verb *declares* what its own reveal gives away, `build.ts` accumulates the
 * declarations in generation order, and a later verb reads **a set of opaque
 * strings**. Nothing downstream knows which verb put a fact in, and a verb that
 * is deleted takes exactly its own facts with it.
 *
 * ## Why the key format lives here
 *
 * Two producers and two consumers would otherwise each build the string, and a
 * one-character disagreement would make the whole mechanism silently do nothing
 * — a gate that never fires, which this repo has shipped before and now has a
 * landmine about. One module, two constructors, no format anywhere else.
 *
 * ## The two kinds of fact, and why width is one of them
 *
 * `touched` is the exclusion of decision 7: a commit may not be an Archaeology
 * answer for a file whose membership an earlier reveal already stated.
 *
 * `width` is decision 6's gate input, and it is a *different shape* on purpose —
 * it names a commit with no file attached, because what leaked is the single
 * number `evidence.touched`. Knowing it lets a player rank the board by size
 * without reading a message: measured at band A on 5 of this repo's boards
 * before `broadKnown` was gated. Folding the two into one fact type would have
 * meant inventing a file for a fact that has none.
 */

import type { CommitId, Challenge, NodeId } from '../atlas/index.js';

/**
 * One fact an earlier reveal has stated, as an opaque key.
 *
 * Deliberately a `string` rather than a discriminated union: the accumulator's
 * whole value is that it is verb-blind, and a union invites a `switch` on the
 * kind, which is where verb-specific interpretation of shared state creeps back
 * in. Consumers ask "is this fact known?", never "what kind of facts are here?".
 */
export type DisclosedFact = string;

/**
 * Field separator, written as an escape rather than as the character itself.
 *
 * `\u001f` cannot occur in a node id, a commit id or a fact kind, so no pair of
 * distinct facts can collide by concatenation. It is spelled out because the
 * first version of this file embedded the raw control character in a template
 * literal, where it is **invisible in every editor and diff** — a delimiter you
 * cannot see is one nobody can check, and `git.ts` learned the same lesson with
 * its own `UNIT`.
 */
const SEP = '\u001f';

/**
 * An earlier reveal said this commit touched this file.
 *
 * Keyed on the `CommitId` rather than the bare sha because that is the value
 * both sides already hold — the discloser reads `challenge.subject`, the
 * consumer builds `commitIdFor(record.sha)` — and a stripping helper between
 * them would be one more place for the two to disagree about a format whose
 * only job is to match.
 */
export function touchedFact(commit: CommitId, member: NodeId): DisclosedFact {
  return `touched${SEP}${commit}${SEP}${member}`;
}

/** An earlier reveal printed how many files this commit touched. */
export function widthFact(commit: CommitId): DisclosedFact {
  return `width${SEP}${commit}`;
}

/**
 * The facts a set of challenges' reveals give away, in generation order.
 *
 * Order does not affect the contents — a set is a set — but it does decide
 * **which verb keeps a fact**, because a verb reads only what was accumulated
 * before it ran. ADR-0012 issues an answer *key* once; decision 7 extends that
 * to the facts inside one, and the tie-break is the same kind of deterministic
 * first-come rule: whichever verb asks a fact first keeps it.
 */
export function accumulate(
  into: Set<DisclosedFact>,
  challenges: Iterable<Challenge>,
  discloses: (challenge: Challenge) => Iterable<DisclosedFact>,
): Set<DisclosedFact> {
  for (const challenge of challenges) {
    for (const fact of discloses(challenge)) into.add(fact);
  }
  return into;
}

/** Nothing. The two import-and-co-change verbs name no commit in any reveal. */
export function disclosesNothing(): readonly DisclosedFact[] {
  return [];
}
