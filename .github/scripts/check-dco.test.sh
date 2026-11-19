#!/usr/bin/env bash
# Test de check-dco.sh sur un dépôt jetable : un commit signé passe, un commit non signé est refusé
# (code 1, commit nommé), une base introuvable échoue. L'étape « fork » de dco.yml est ensuite
# rejouée telle qu'elle est écrite dans le workflow, avec le shell par défaut des Actions (bash -e).
# Lancé par « pnpm run test » et par le job dco.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/check-dco.sh"
workflow="$here/../workflows/dco.yml"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
cd "$dir"
git init -q -b main
git config user.name "Test Fictif"
git config user.email "test@exemple.fr"
git config commit.gpgsign false
git commit -q --allow-empty -m "empty"
empty="$(git rev-parse HEAD)"
mkdir -p .github/scripts
cp "$script" .github/scripts/check-dco.sh
git add .github/scripts/check-dco.sh
git commit -q -m "base"
base="$(git rev-parse HEAD)"

git commit -q --allow-empty -s -m "signed"
bash "$script" "$base" HEAD >/dev/null || { echo "ECHEC : un commit signé est refusé"; exit 1; }

git commit -q --allow-empty -m "unsigned"
status=0
out="$(bash "$script" "$base" HEAD 2>&1)" || status=$?
[ "$status" -eq 1 ] || { echo "ECHEC : code $status au lieu de 1 pour un commit non signé"; exit 1; }
echo "$out" | grep -q "Commit sans Signed-off-by : .* unsigned" || { echo "ECHEC : commit non nommé : $out"; exit 1; }
if echo "$out" | grep -q " signed"; then
  echo "ECHEC : le commit signé est listé"
  exit 1
fi

if bash "$script" 0000000000000000000000000000000000000000 HEAD >/dev/null 2>&1; then
  echo "ECHEC : une base introuvable est acceptée"
  exit 1
fi

# Étape « fork » du workflow : la commande est extraite de dco.yml, pas recopiée.
step="$(sed -n 's/^        run: \(git show .*\)$/\1/p' "$workflow")"
[ -n "$step" ] || { echo "ECHEC : étape fork introuvable dans dco.yml"; exit 1; }
run_step() { BASE_SHA="$1" HEAD_SHA="$2" RUNNER_TEMP="$dir" bash -e -c "$step" >/dev/null 2>&1; }

if run_step "$base" HEAD; then
  echo "ECHEC : l'étape fork accepte un commit non signé"
  exit 1
fi
run_step "$base" HEAD~1 || { echo "ECHEC : l'étape fork refuse un commit signé"; exit 1; }
# Base sans le script (PR ouverte avant sa fusion) : l'étape doit échouer, pas passer à vide.
status=0
out="$(BASE_SHA="$empty" HEAD_SHA=HEAD~1 RUNNER_TEMP="$dir" LC_ALL=C bash -e -c "$step" 2>&1)" || status=$?
[ "$status" -ne 0 ] || { echo "ECHEC : l'étape fork passe quand le script est absent de la base"; exit 1; }
# L'échec doit venir de git show, pas d'une autre erreur de l'étape.
echo "$out" | grep -q "^fatal: path '.github/scripts/check-dco.sh'" || { echo "ECHEC : cause inattendue : $out"; exit 1; }
echo "OK : commit signé accepté, commit non signé refusé, base introuvable refusée, étape fork rejouée."
