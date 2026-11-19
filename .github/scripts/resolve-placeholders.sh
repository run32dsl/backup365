#!/usr/bin/env bash
# Remplace les noms provisoires « SUIVI » + chiffre par le numéro réel des issues créées, puis
# refuse le texte s'il en reste un (check-placeholders.sh). À appeler par la procédure qui crée
# les issues de suivi, avant de publier une décision ou une issue.
# Usage : resolve-placeholders.sh SUIVI1=290 SUIVI2=291 < texte.md > texte-final.md
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
args=()
for pair in "$@"; do
  if [[ ! "$pair" =~ ^SUIVI([0-9]+)=#?([0-9]+)$ ]]; then
    echo "Argument invalide : $pair (attendu : SUIVI<n>=<numéro d'issue>)." >&2
    exit 2
  fi
  name="${BASH_REMATCH[1]}"
  issue="${BASH_REMATCH[2]}"
  # Le chiffre ne doit pas être prolongé : SUIVI1 ne touche pas SUIVI10.
  # Deux passes : le caractère qui suit est consommé, deux noms collés demandent la seconde.
  rule="s/SUIVI[ _-]?$name([^0-9]|\$)/#$issue\\1/g"
  args+=(-e "$rule" -e "$rule")
done

out="$(mktemp)"
trap 'rm -f "$out"' EXIT
if [ "${#args[@]}" -eq 0 ]; then cat > "$out"; else sed -E "${args[@]}" > "$out"; fi
bash "$dir/check-placeholders.sh" "$out" >&2
cat "$out"
