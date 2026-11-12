# ADR 0002 : catalogue des sauvegardes via le SDK Atlas, sans Graph

Statut : **proposé** (issue #3)

## Contexte

La console doit lister boîtes et instantanés (vision, principe 3 : moindre privilège, mode
lecture seule possible). Le SDK expose `listMailboxes`, `listSnapshots`, `getSnapshotDetail`
et leurs équivalents par charge. On suppose, sans l'avoir vérifié (voir « Non vérifié »), que
ces lectures portent sur le stockage S3 d'Atlas.

## Décision

- Le port `BackupCatalog` (`packages/core`) est en lecture seule : boîtes, instantanés par
  charge, détail d'un instantané. Il est indépendant du SDK.
- L'adaptateur `AtlasSdkCatalog` (`apps/server`) ne dépend que d'une interface minimale
  (`AtlasWorkloadReader`) par charge. Les erreurs du SDK sont converties en
  `CatalogUnavailableError` ; l'API répond 503 sans détail.
- Configuration par variables d'environnement : `BACKUP365_S3_BUCKET`,
  `BACKUP365_S3_ACCESS_KEY_ID`, `BACKUP365_S3_SECRET_ACCESS_KEY`,
  `BACKUP365_ENCRYPTION_PASSPHRASE` (obligatoires), `BACKUP365_S3_ENDPOINT`,
  `BACKUP365_S3_REGION` (facultatives). Sans aucune de ces variables, le serveur démarre et
  les routes du catalogue répondent 503.
- Hypothèse à vérifier : le SDK lit sans identifiant Graph. Le catalogue n'est pas instancié
  avec une configuration Graph ; si la vérification échoue, cet ADR est amendé.
- Les tests de contrat (`@backup365/core/testing`) sont rejouables sur tout adaptateur.

## Limites connues

- Les routes ne sont pas authentifiées (Entra est hors MVP) : la console ne doit pas être
  exposée hors d'un réseau de confiance.
- Seules des métadonnées (boîtes, dates) sont lues, pas de contenu : ces lectures ne passent pas
  par le journal d'audit, qui couvre la lecture et l'export d'éléments sauvegardés. À confirmer
  par le Product Manager.
- Le câblage de `main.ts` (lecture de `parseStorageConfig`, construction du SDK) reste à faire.

## Non vérifié

Le paquet `@wisecom/atlas-sdk` n'est pas installé dans le dépôt (version à figer, ajout de
dépendance à expliquer) et sa documentation (`docs/reference/sdk.md` d'Atlas) n'était pas
accessible lors de l'écriture. Restent à confirmer avant le câblage final :

1. les signatures réelles et les formes de retour (adaptation dans `AtlasWorkloadReader`) ;
2. que le SDK se construit et lit sans identifiants Graph. Si ce n'est pas le cas, l'amont
   doit être corrigé (principe 5) et cet ADR amendé ;
3. les noms des variables attendues par le SDK, s'ils diffèrent.

## Conséquences

Le catalogue est testable sans réseau. Le câblage réel (`main.ts`) reste à faire dès que le
SDK est disponible ; d'ici là, la console répond 503 sur ces routes.
