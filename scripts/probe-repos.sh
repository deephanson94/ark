#!/usr/bin/env bash
# Clone the corpus this session measures, at FULL DEPTH and pinned to a named commit.
#
# Full depth is not a nicety. `src/verbs/commits.ts` refuses the entire history deck on a shallow
# repository, so a `--depth` clone reads zero Companion / Placement / Archaeology boards and makes
# Blast Radius's share of the deck look artificially high — the exact opposite of what this probe
# measures. See CLAUDE.md's shallow-clone landmine.
#
# Usage:  scripts/probe-repos.sh [outdir]
set -uo pipefail

OUT="${1:-/tmp/ark-corpus}"
JOBS="$(nproc)"
mkdir -p "$OUT"

# repo|url|pinned-commit|why it is in the corpus
REPOS=$(cat <<'EOF'
rxjs|https://github.com/ReactiveX/rxjs|54796b38a57e|peeked cold: resolves badly (1774 unresolved) yet ships 75/295
apollo-client|https://github.com/apollographql/apollo-client|ba511be48b63|peeked cold: 46/348, workspace-ish specifiers
typeorm|https://github.com/typeorm/typeorm|df07bf1ef46f|peeked cold: resolves at 97% and ships 58/2221 — the counterexample to rate
excalidraw|https://github.com/excalidraw/excalidraw|abeeaeba217a|peeked cold: 21/479, the worst starvation seen
hono|https://github.com/honojs/hono|7075369e|reference: the cap-limited control, README's best third-party target
kysely|https://github.com/kysely-org/kysely|f24018c7|reference: experiment 0001's matched pair
graphql-js|https://github.com/graphql/graphql-js|9c245018|reference: experiment 0001's matched pair
hugo|https://github.com/gohugoio/hugo|44da08608|Go: package granularity, the large Go case (ADR-0026)
cobra|https://github.com/spf13/cobra|adbc881|Go: one package, no blast deck — the honest small case
prometheus|https://github.com/prometheus/prometheus|HEAD|Go: the repo that caught ADR-0026's missing edge
django|https://github.com/django/django|c9eb16a87e|Python: the scale case, 83.7% closure-tainted
flask|https://github.com/pallets/flask|6a2f545b|Python: 0 of 30 blast subjects, the optimistic Python end
system-design-primer|https://github.com/donnemartin/system-design-primer|HEAD|Python: prose-heavy, ADR-0025's rescued repo
vue-core|https://github.com/vuejs/core|HEAD|+TS: pnpm monorepo with @vue/* workspace self-references — phase 3's hypothesis on a second repo
date-fns|https://github.com/date-fns/date-fns|HEAD|+TS: thousands of tiny files, purely relative imports, nothing dynamic — the should-resolve-perfectly extreme
express|https://github.com/expressjs/express|HEAD|+JS: CommonJS require(), flat — a different module system from every other TS repo here
webpack|https://github.com/webpack/webpack|HEAD|+JS: large CJS app with genuinely dynamic requires — the pessimistic end
nest|https://github.com/nestjs/nest|HEAD|+TS: monorepo with @nestjs/* self-references and decorator/DI indirection
EOF
)

clone_one() {
  local name="$1" url="$2" pin="$3" out="$4"
  local dir="$out/$name"
  if [ -d "$dir/.git" ]; then
    echo "have  $name"
  else
    git clone --quiet "$url" "$dir" 2>&1 | tail -2 || { echo "FAIL  $name"; return 1; }
  fi
  if [ "$pin" != "HEAD" ]; then
    git -C "$dir" checkout --quiet "$pin" 2>&1 | tail -1 || { echo "FAIL-PIN  $name $pin"; return 1; }
  fi
  local sha; sha="$(git -C "$dir" rev-parse HEAD)"
  local shallow; shallow="$(git -C "$dir" rev-parse --is-shallow-repository)"
  local commits; commits="$(git -C "$dir" rev-list --count HEAD)"
  echo "ok    $name  $sha  shallow=$shallow  commits=$commits"
}
export -f clone_one

echo "$REPOS" | while IFS='|' read -r name url pin why; do
  [ -z "$name" ] && continue
  echo "$name $url $pin"
done | xargs -P "$JOBS" -n 3 bash -c 'clone_one "$0" "$1" "$2" "'"$OUT"'"'

echo "--- corpus at $OUT ---"
for d in "$OUT"/*/; do
  n="$(basename "$d")"
  printf '%-22s %s  shallow=%s  commits=%s\n' "$n" \
    "$(git -C "$d" rev-parse --short=12 HEAD 2>/dev/null)" \
    "$(git -C "$d" rev-parse --is-shallow-repository 2>/dev/null)" \
    "$(git -C "$d" rev-list --count HEAD 2>/dev/null)"
done
