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
# Chemin des fichiers passés en argument (celui du workflow), texte sur plusieurs lignes.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
printf 'Titre\n\nParagraphe.\nVoir #12.\n' > "$tmp"
bash "$script" "$tmp" >/dev/null || { echo "ECHEC : fichier valide refusé"; exit 1; }
printf 'Titre\n\nParagraphe.\nVoir SUIVI4 plus bas.\n' > "$tmp"
if bash "$script" "$tmp" >/dev/null 2>&1; then
  echo "ECHEC : fichier multi-lignes avec nom provisoire accepté"
  exit 1
fi

# resolve-placeholders.sh : la procédure qui crée les issues remplace chaque nom par son numéro.
dir="$(dirname "$script")"
got="$(printf 'Voir SUIVI1, SUIVI 2 et SUIVI10.\nFin : SUIVI_1\n' | bash "$dir/resolve-placeholders.sh" SUIVI1=290 SUIVI2=#291 SUIVI10=300 2>/dev/null)"
want="$(printf 'Voir #290, #291 et #300.\nFin : #290')"
[ "$got" = "$want" ] || { echo "ECHEC : remplacement inattendu : $got"; exit 1; }
got="$(printf 'SUIVI1SUIVI1 SUIVI1\n' | bash "$dir/resolve-placeholders.sh" SUIVI1=290 2>/dev/null)"
[ "$got" = "#290#290 #290" ] || { echo "ECHEC : noms collés mal remplacés : $got"; exit 1; }
# Un nom sans numéro fourni : refus, aucun texte n'est produit.
if got="$(printf 'Voir SUIVI1 et SUIVI3.\n' | bash "$dir/resolve-placeholders.sh" SUIVI1=290 2>/dev/null)" || [ -n "$got" ]; then
  echo "ECHEC : nom provisoire sans numéro accepté"
  exit 1
fi
if printf 'texte\n' | bash "$dir/resolve-placeholders.sh" "SUIVI1=abc" >/dev/null 2>&1; then
  echo "ECHEC : argument invalide accepté"
  exit 1
fi

# list-placeholders.mjs : liste les issues encore concernées, à partir de l'export JSON.
json='[{"number":183,"title":"Suite","body":"Voir SUIVI2 et SUIVI 3, puis SUIVI2."},{"number":184,"title":"Suivi 2026","body":"Voir #183."},{"number":185,"title":"SUIVI_1","body":null}]'
if got="$(printf '%s' "$json" | node "$dir/list-placeholders.mjs")"; then
  echo "ECHEC : liste non vide avec un code de sortie nul"
  exit 1
fi
want="$(printf '#183 : SUIVI2, SUIVI 3\n#185 : SUIVI_1')"
[ "$got" = "$want" ] || { echo "ECHEC : liste inattendue : $got"; exit 1; }
printf '[{"number":1,"title":"a","body":"Voir #2."}]' | node "$dir/list-placeholders.mjs" >/dev/null \
  || { echo "ECHEC : liste vide avec un code de sortie non nul"; exit 1; }
# Entrée vide (gh en échec) : code 2, à ne pas confondre avec « il en reste ».
code=0
printf '' | node "$dir/list-placeholders.mjs" >/dev/null 2>&1 || code=$?
[ "$code" -eq 2 ] || { echo "ECHEC : entrée vide, code $code au lieu de 2"; exit 1; }
echo "check-placeholders : OK"
