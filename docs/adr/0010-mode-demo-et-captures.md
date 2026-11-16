# ADR 0010 : mode démo, captures et tests de navigateur

Statut : **proposé** (issue #67)

## Contexte

Personne dans la chaîne de développement ne voit l'interface. Il faut pouvoir la lancer sans S3 ni
Microsoft 365, avec des données qui ne sont celles d'aucun tenant.

## Décision

- `BACKUP365_DEMO=1` remplace le SDK Atlas par un faux en mémoire (`apps/server/src/demo.ts`), qui
  passe par les mêmes adaptateurs que le vrai : catalogue, index et export suivent le chemin réel.
  Les données sont inventées, domaine `exemple.fr` uniquement (un test parcourt le jeu).
- Le démarrage est refusé si une variable de stockage réel est présente, ou si la base des comptes
  contient un compte autre que ceux de démonstration : leurs mots de passe sont publics.
- `/api/health` annonce `demo: true` ; l'interface affiche un bandeau sur tous ses écrans.
- Dépendance de développement `@playwright/test` (accord du PM, 2026-11-16) : captures
  (`e2e/screens.mjs`, `pnpm run captures`) et tests de navigateur (`pnpm run test:e2e`).
  `BACKUP365_CHROMIUM` désigne un Chromium existant ; sinon Playwright utilise le sien.

## Conséquences

- Le faux SDK doit suivre les évolutions des interfaces `AtlasSdkReader` et voisines (le
  compilateur le signale).
- Le mode démo est un mode de développement : il ne s'utilise jamais sur des données réelles.
