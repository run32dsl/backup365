#!/usr/bin/env bash
# Refuse un texte (issue, décision, description de PR) qui contient encore un nom provisoire
# « SUIVI » suivi d'un chiffre (SUIVI2, SUIVI 2) : un renvoi doit citer le numéro réel (#NNN).
# Usage : check-placeholders.sh [fichier...] ; sans argument, lit l'entrée standard.
set -euo pipefail

if grep -nE 'SUIVI[ _-]?[0-9]' "$@"; then
  echo "Nom provisoire SUIVIn trouvé : remplacez-le par le numéro réel de l'issue (#NNN)." >&2
  exit 1
fi
echo "Aucun nom provisoire SUIVIn."
