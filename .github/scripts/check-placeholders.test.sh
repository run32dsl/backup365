#!/usr/bin/env bash
# Test de check-placeholders.sh : un texte avec « SUIVI2 » (ou « SUIVI 2 ») est refusé, un texte
# avec un numéro réel ou le mot « suivi » seul passe. Lancé par « pnpm run test » et par le job
# placeholders.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/check-placeholders.sh"

for ok in "Voir #184 pour la décision." "Issue de suivi du PO, SUIVI de #179." "suivi 2 semaines"; do
  printf '%s\n' "$ok" | bash "$script" >/dev/null || { echo "ECHEC : texte valide refusé : $ok"; exit 1; }
done
for ko in "Décision sur #179 : voir SUIVI2." "voir SUIVI 2" "SUIVI_3 et #4"; do
  if printf '%s\n' "$ko" | bash "$script" >/dev/null 2>&1; then
    echo "ECHEC : texte avec nom provisoire accepté : $ko"
    exit 1
  fi
done
echo "check-placeholders : OK"
