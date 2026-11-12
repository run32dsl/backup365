# ADR 0003 : index de recherche des mails (SQLite FTS5)

Statut : **accepté** le 2026-11-12 par le Product Manager (issue #18)

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

## Remplissage en production (issue #36)

- `AtlasSdkSnapshotMailReader` lit `outlook.getSnapshotDetail` (manifeste seul, sans Graph, sans
  déchiffrer de mail) : `objectId` devient `messageId`, `from.address` l'expéditeur, `subject`
  l'objet, `folderId` le dossier (l'identifiant, pas le chemin), `sizeBytes` la taille, les noms
  de `attachments` les pièces jointes (entrées JSON seulement ; un mail MIME embarque les siennes,
  sans nom dans le manifeste).
- **Date** : `receivedAt` du manifeste quand il existe (entrées MIME), sinon la date de
  l'instantané où le mail apparaît. **Destinataires** : vides (voir les limites).
- `SearchIndexer` lance un cycle au démarrage (hook `onReady`, sans retarder l'écoute ni
  `/api/health`) puis un par `BACKUP365_INDEX_INTERVAL_MINUTES` (60 par défaut), jamais deux à la
  fois. Il appelle `indexMailbox` pour chaque boîte ; un instantané est indexé de façon atomique,
  donc un échec est repris au cycle suivant. L'échec est journalisé par nom et code d'erreur
  seulement.
- `GET /api/status` ajoute `index: { mails, lastRunAt, lastSuccessAt, lastRunFailed }` (dates
  `null` avant le premier cycle ; `mails` est `null` si l'index ne répond pas). L'état du cycle
  est en mémoire : il repart de zéro au redémarrage.

## Limites connues

- `node:sqlite` est « expérimental » en Node 22 (avertissement au démarrage) ; à réévaluer si
  l'API change.
- Un message déplacé de dossier entre deux instantanés garde son dossier d'origine.
- Les destinataires ne sont pas dans le manifeste de l'instantané : ils restent vides, et le
  filtre `to` ne trouve donc aucun mail réel (les lire demanderait un déchiffrement par mail).
- La recherche renvoie des métadonnées d'éléments sauvegardés : elle exige donc un `AuditLog`
  (port du cœur, sans termes recherchés dans l'événement) et répond 503 sans lui. Aucun adaptateur
  d'audit n'existe encore : la route est inactive en production tant qu'il n'est pas branché.
- Routes non authentifiées (voir ADR 0002).
- Les paramètres `after` et `before` (date ISO 8601, borne haute exclue) complètent l'API
  demandée par l'issue pour la recherche par plage de dates.
