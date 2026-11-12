# ADR 0003 : index de recherche des mails (SQLite FTS5)

Statut : **proposé** (issue #4)

## Contexte

L'ADR 0001 impose SQLite pour le MVP, derrière un port de `packages/core`, avec FTS5 confiné à
l'adaptateur. La console doit retrouver un mail parmi les instantanés sans relire le stockage.

## Décision

- Le port `SearchIndex` (`packages/core`) expose `isSnapshotIndexed`, `indexSnapshot` (atomique)
  et `search` (filtres `q`, `mailbox`, `from`, `to`, `after`, `before`, pagination). Il ne
  contient aucune syntaxe de moteur.
- L'adaptateur `SqliteSearchIndex` (`apps/server/src/sqlite`) est le seul code qui connaît FTS5.
  Il utilise le module `node:sqlite` de Node 22 : **aucune dépendance ajoutée**. Les saisies sont
  réduites à des mots (lettres et chiffres), cités avec préfixe, ce qui neutralise la syntaxe FTS5.
- Seules les métadonnées sont indexées : expéditeur, destinataires, objet, date, dossier, taille,
  noms de pièces jointes. Pas le corps au MVP.
- Indexation incrémentale : `indexMailbox` ne lit que les instantanés absents de
  `indexed_snapshots`. Un message (même boîte, même `messageId`) n'est indexé qu'une fois, au
  premier instantané où il apparaît.
- Base `search.sqlite` dans `BACKUP365_DATA_DIR` (`./data` par défaut), migrations versionnées
  dans `schema_migrations`, chacune en transaction ; une base plus récente que le programme est
  refusée.
- Les tests de contrat (`searchIndexContract`, `@backup365/core/testing`) sont rejouables sur
  l'adaptateur PostgreSQL.
- Les termes recherchés sont des données personnelles : le journal des requêtes omet la chaîne
  de requête.

## Limites connues

- `node:sqlite` est « expérimental » en Node 22 (avertissement au démarrage) ; à réévaluer si
  l'API change.
- Un message déplacé de dossier entre deux instantanés garde son dossier d'origine.
- Le lecteur de métadonnées par instantané (`SnapshotMailReader`) n'a pas d'adaptateur SDK : rien
  ne remplit encore l'index en production, et rien ne déclenche l'indexation (planification à
  venir).
- La recherche renvoie des métadonnées d'éléments sauvegardés sans passer par un journal d'audit,
  qui n'existe pas encore. À traiter avec lui ; à confirmer par le Product Manager.
- Routes non authentifiées (voir ADR 0002).
- Les paramètres `after` et `before` (date ISO 8601, borne haute exclue) complètent l'API
  demandée par l'issue pour la recherche par plage de dates.
