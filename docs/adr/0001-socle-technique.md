# ADR 0001 : socle technique

Statut : **proposé** (à accepter par le Product Manager)

## Contexte

Le produit s'appuie sur `@wisecom/atlas-sdk` (Node, TypeScript). Il doit s'installer
simplement sur une machine (NAS, petit serveur), rester sobre, et être maintenable par des
agents comme par des humains.

## Décision

- **Langage** : TypeScript strict, Node 22 LTS, pnpm (corepack), monorepo pnpm :
  `apps/server` (API), `apps/web` (interface), `packages/core` (domaine, ports).
- **Serveur** : Fastify, validation des entrées par schémas (TypeBox ou Zod), journal Pino.
- **Interface** : React + Vite, sans framework de rendu serveur ; composants accessibles.
- **Persistance locale** : SQLite (catalogue, index de recherche FTS5, journal d'audit) ;
  les sauvegardes elles-mêmes restent dans le S3 d'Atlas.
- **Architecture** : hexagonale comme Atlas (ports dans `core`, adaptateurs : SDK Atlas,
  SQLite, HTTP).
- **Qualité** : Vitest, ESLint, Prettier, TypeScript `--noEmit` ; CI GitHub Actions sur chaque PR.
- **Livraison** : image de conteneur + `compose.yaml` (console + MinIO optionnel).

## Conséquences

Une seule pile (TypeScript) pour le produit et le moteur, ce qui permet de réutiliser les
conventions d'Atlas. SQLite limite à une instance : suffisant pour le MVP, à revoir pour le
multi-instance.
