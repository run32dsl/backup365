# Contribuer à backup365

Les règles du projet (branches, fusion, sécurité, RGPD) sont dans [CLAUDE.md](CLAUDE.md) et
priment sur ce document. Décisions d'architecture : [docs/adr/](docs/adr/).

## Code écrit avec l'IA

Une partie du code, des tests et de la documentation est écrite par des agents IA (Claude
Code). Chaque PR est relue automatiquement, passe la CI et les critères d'acceptation de son
issue, puis est validée par le mainteneur. Les contributions humaines suivent le même circuit.
Les agents ne voient jamais de données réelles.

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

## Mode démo, captures et tests de navigateur

`BACKUP365_DEMO=1` lance la console sans S3 ni Microsoft 365, sur un faux catalogue entièrement
fictif (domaine `exemple.fr`, voir `apps/server/src/demo.ts`) et un bandeau « Mode démo : données
fictives » sur tous les écrans. Comptes : `admin-demo` / `demonstration-admin` et `operateur-demo` /
`demonstration-operateur`. Le serveur refuse de démarrer si une configuration de stockage réelle est
présente ; utiliser un `BACKUP365_DATA_DIR` jetable.

- `pnpm run captures` construit, lance le mode démo sur un port libre et écrit
  `captures/<écran>-1280.png` et `-390.png` (dossier ignoré par git). Regarder les images avant
  d'ouvrir la PR. `pnpm run captures --lang=en-US` (ou la variable `BACKUP365_LANG=en-US`) les
  prend avec un navigateur en anglais : le rendu doit rester identique, ce que vérifie
  `e2e/langue.spec.ts` pour les filtres de date. Un Chromium installé avec la seule langue `en-US`
  (conteneurs des agents) affiche ses champs natifs en anglais quelle que soit l'option : ne pas
  utiliser de champ `date` ou `datetime-local`, mais un champ texte au format `jj/mm/aaaa`.
- **Ajouter un écran** : une entrée dans `e2e/screens.mjs` (`name`, `hash`, `role`, `prepare`
  éventuel pour les gestes préalables).
- `pnpm run test:e2e` joue les tests Playwright (`e2e/*.spec.ts`) en mode démo. Installer le
  navigateur une fois avec `pnpm exec playwright install chromium`, ou pointer
  `BACKUP365_CHROMIUM` vers un exécutable Chromium existant.

## Conventions

- Une issue = une branche `feat/<n>-<sujet>` ou `fix/<n>-<sujet>`, une PR vers `develop`.
- Messages de commit en anglais, format conventionnel (`feat:`, `fix:`, `docs:`…).
- Tests dans le même commit que le code ; pas d'appel réseau dans les tests unitaires.
- Le domaine et les ports vivent dans `packages/core` ; `apps/*` ne contiennent que des adaptateurs.
- Aucun secret, donnée de tenant ou donnée personnelle dans le dépôt, les logs ou les tests.
