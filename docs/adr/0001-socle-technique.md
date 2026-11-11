# ADR 0001 : socle technique

Statut : **accepté** le 2026-11-11 par le Product Manager (issue #9)

## Contexte

Le produit s'appuie sur `@wisecom/atlas-sdk` (Node, TypeScript). Il doit s'installer
simplement sur une machine (NAS, petit serveur), rester sobre, et être maintenable par des
agents comme par des humains.

## Décision

- **Langage** : TypeScript strict, Node 22 LTS, pnpm (corepack), monorepo pnpm :
  `apps/server` (API), `apps/web` (interface), `packages/core` (domaine, ports).
- **Serveur** : Fastify, validation des entrées par schémas (TypeBox ou Zod), journal Pino.
- **Interface** : React + Vite, sans framework de rendu serveur ; composants accessibles.
- **Persistance** : SQLite pour le MVP et les preuves de concept (catalogue, index de recherche
  FTS5, journal d'audit) ; **PostgreSQL prévu ensuite** (voir « Trajectoire »). Les sauvegardes
  elles-mêmes restent dans le S3 d'Atlas.
- **Architecture** : hexagonale comme Atlas (ports dans `core`, adaptateurs : SDK Atlas,
  SQLite, HTTP).
- **Qualité** : Vitest, ESLint, Prettier, TypeScript `--noEmit` ; CI GitHub Actions sur chaque PR.
- **Livraison** : image de conteneur + `compose.yaml` (console + MinIO optionnel).

## Trajectoire vers PostgreSQL

SQLite suffit pour les preuves de concept et la volumétrie actuelle (un tenant, une instance).
PostgreSQL est prévu pour la suite (plusieurs instances, volumétrie, recherche plus riche). Pour
que ce passage ne soit qu'un changement d'adaptateur :

- toute persistance passe par des **ports** de `packages/core` (`BackupCatalogStore`,
  `SearchIndex`, `AuditLog`…) ; aucun code hors des adaptateurs n'importe un pilote SQL ;
- les spécificités SQLite (FTS5, `PRAGMA`, types implicites) restent confinées à l'adaptateur
  SQLite ; la recherche est exprimée par une interface, pas par une syntaxe FTS5 ;
- migrations SQL versionnées, en SQL standard autant que possible, horodatages en UTC ISO 8601,
  identifiants texte ;
- les tests du domaine utilisent des faux des ports ; chaque adaptateur a ses tests de contrat,
  réutilisables pour l'adaptateur PostgreSQL.

Le choix précis (pilote, outil de migration, recherche plein texte PostgreSQL) fera l'objet d'un
ADR dédié au moment du passage.

## Conséquences

Une seule pile (TypeScript) pour le produit et le moteur, ce qui permet de réutiliser les
conventions d'Atlas. SQLite limite à une instance : suffisant pour le MVP. Le passage à PostgreSQL est préparé par
les ports dès le départ, ce qui coûte un peu de structure maintenant pour éviter une réécriture
plus tard.
