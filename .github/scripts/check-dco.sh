#!/usr/bin/env bash
# Vérifie que chaque commit de BASE..HEAD porte une ligne « Signed-off-by: Nom <courriel> ».
# Usage : check-dco.sh <base> <head>. Les commits de fusion sont ignorés.
set -euo pipefail

base="${1:?base manquante}"
head="${2:?head manquante}"
missing=0

# Hors de la boucle : un échec de rev-list (base introuvable) doit arrêter le script.
shas="$(git rev-list --no-merges "$base..$head")"

while read -r sha; do
  [ -n "$sha" ] || continue
  if ! git show -s --format=%B "$sha" | grep -Eq '^Signed-off-by: .+ <.+>[[:space:]]*$'; then
    echo "Commit sans Signed-off-by : $(git show -s --format='%h %s' "$sha")"
    missing=1
  fi
done <<< "$shas"

if [ "$missing" -ne 0 ]; then
  echo "Signez chaque commit avec « git commit -s » (voir CONTRIBUTING.md, DCO 1.1)." >&2
  echo "Pour corriger : git rebase --signoff <base>, puis git push --force-with-lease." >&2
  exit 1
fi
echo "Tous les commits sont signés."
