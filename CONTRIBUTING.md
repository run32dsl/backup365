# Contribuer à backup365

Les règles du projet (branches, fusion, sécurité, RGPD) sont dans [CLAUDE.md](CLAUDE.md) et
priment sur ce document. Décisions d'architecture : [docs/adr/](docs/adr/).

## Prérequis

Node 22 et pnpm via corepack (`corepack enable`). Uniquement pnpm, jamais npm ni yarn.

## Commandes

```sh
pnpm install
pnpm run build         # compile core, server et web
pnpm run typecheck     # TypeScript strict, sans émission
pnpm run lint          # ESLint
pnpm run format:check  # Prettier (`pnpm run format` pour corriger)
pnpm run test          # Vitest, sans accès réseau
```

Ces cinq commandes doivent passer avant toute PR ; le job `ci` de GitHub Actions
(`.github/workflows/ci.yml`) les rejoue sur chaque PR vers `develop` et `main`. Les actions y
sont épinglées par SHA : pour les mettre à jour, changer le SHA et le commentaire de version
ensemble. En développement : `pnpm --filter
@backup365/server start` après un build (port 3000, variables `PORT`, `HOST`, `LOG_LEVEL`, `BACKUP365_DATA_DIR` pour le dossier des bases (`search.sqlite`, reconstructible, et `audit.sqlite`, journal d'audit à conserver), `./data` par défaut ; catalogue : `BACKUP365_TENANT_ID`, `BACKUP365_S3_ENDPOINT`,
`BACKUP365_S3_ACCESS_KEY_ID`, `BACKUP365_S3_SECRET_ACCESS_KEY`, `BACKUP365_ENCRYPTION_PASSPHRASE`,
`BACKUP365_S3_REGION` facultative, voir l'ADR 0002 ; chaque secret accepte une variante `_FILE`,
voir [docs/installation.md](docs/installation.md) ; `BACKUP365_WEB_DIR` fait servir l'interface
construite par le serveur, voir l'ADR 0007) et
`pnpm --filter @backup365/web dev` (proxy `/api` vers le serveur).

## Conventions

- Une issue = une branche `feat/<n>-<sujet>` ou `fix/<n>-<sujet>`, une PR vers `develop`.
- Messages de commit en anglais, format conventionnel (`feat:`, `fix:`, `docs:`…).
- Tests dans le même commit que le code ; pas d'appel réseau dans les tests unitaires.
- Le domaine et les ports vivent dans `packages/core` ; `apps/*` ne contiennent que des adaptateurs.
- Aucun secret, donnée de tenant ou donnée personnelle dans le dépôt, les logs ou les tests.
