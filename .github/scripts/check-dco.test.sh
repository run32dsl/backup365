#!/usr/bin/env bash
# Test de check-dco.sh sur un dépôt jetable : un commit signé passe, un commit non signé est refusé
# (code 1, commit nommé), une base introuvable échoue.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/check-dco.sh"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
cd "$dir"
git init -q -b main
git config user.name "Test Fictif"
git config user.email "test@exemple.fr"
git config commit.gpgsign false
git commit -q --allow-empty -m "base"
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
echo "OK : commit signé accepté, commit non signé refusé, base introuvable refusée."
