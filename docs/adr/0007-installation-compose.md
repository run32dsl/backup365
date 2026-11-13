# ADR 0007 : installation par image de conteneur et compose

Statut : **proposé** (issue #8)

## Contexte

L'ADR 0001 prévoit une livraison par image de conteneur et `compose.yaml`. Le serveur ne servait
que l'API, et les secrets du stockage n'existaient qu'en variables d'environnement.

## Décision

- `Containerfile` en deux étapes : construction avec pnpm, puis exécution sur `node:22.23.4-slim` épinglé par digest (index multi-architecture)
  sans pnpm ni sources (`pnpm deploy --prod`), utilisateur `node`, volume `/data`.
- Le serveur sert lui-même l'interface construite quand `BACKUP365_WEB_DIR` est défini
  (`static-web.ts`, sans dépendance) : fichiers lus au démarrage et indexés, donc aucune
  remontée de dossier possible ; CSP propre aux pages (scripts et styles `self`), celle de l'API
  reste `default-src 'none'`. Un seul processus, un seul port.
- Secrets du stockage : variante `<NOM>_FILE` (clé d'accès, clé secrète, phrase de chiffrement),
  exclusive de la variable directe ; compose monte des fichiers de `./secrets/`.
- `compose.yaml` : console et MinIO facultatif (profil `minio`, aucun port publié). Le port de la
  console n'est publié que sur 127.0.0.1, la console n'ayant pas d'authentification.
- La CI construit l'image et vérifie qu'elle démarre (`/api/health`, interface servie).
- Ce que l'image lance est assemblé par `createServer` (`server.ts`), `main.ts` n'ajoutant que
  l'écoute : le démarrage sans stockage, l'environnement de `compose.yaml` et la copie
  `VACUUM INTO` sont ainsi testés sans conteneur (`server.test.ts`, `delivery.test.ts`). Ces
  tests ne remplacent pas le job `image`, seul à construire et démarrer l'image réelle.

## Complément : publication de l'image (statut : proposé)

Le workflow `publish-image.yml` construit le `Containerfile` et pousse l'image sur
`ghcr.io/run32dsl/backup365` : étiquettes `develop` et `sha-<7 caractères>` à chaque fusion sur
`develop`, version (sans le `v`) à chaque tag `v*`. `linux/amd64` seulement ; signature et arm64
hors périmètre. Il n'utilise que `GITHUB_TOKEN` (`packages: write`) et les commandes `docker` du
runner, sans action tierce à épingler. Le contexte de construction exclut `.env*`, `secrets`,
`data` et les dossiers de travail (`.dockerignore`).

## Conséquences

Installation en quelques commandes, sans Node ni pnpm sur l'hôte. Les images Node et MinIO sont
épinglées par digest d'index multi-architecture (décision du PO du 2026-11-12, PR #32), sur des
versions publiées depuis au moins une semaine ; leur mise à jour régulière reste à organiser. Le serveur porte désormais un
petit service de fichiers statiques à maintenir ; une authentification reste à faire (hors MVP).
