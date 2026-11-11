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

Ces cinq commandes doivent passer avant toute PR. En développement : `pnpm --filter
@backup365/server start` après un build (port 3000, variables `PORT`, `HOST`, `LOG_LEVEL`) et
`pnpm --filter @backup365/web dev` (proxy `/api` vers le serveur).

## Conventions

- Une issue = une branche `feat/<n>-<sujet>` ou `fix/<n>-<sujet>`, une PR vers `develop`.
- Messages de commit en anglais, format conventionnel (`feat:`, `fix:`, `docs:`…).
- Tests dans le même commit que le code ; pas d'appel réseau dans les tests unitaires.
- Le domaine et les ports vivent dans `packages/core` ; `apps/*` ne contiennent que des adaptateurs.
- Aucun secret, donnée de tenant ou donnée personnelle dans le dépôt, les logs ou les tests.
