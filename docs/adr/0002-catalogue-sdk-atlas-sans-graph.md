# ADR 0002 : catalogue des sauvegardes via le SDK Atlas, sans Graph

Statut : **proposé** (issues #3 et #14), à accepter par le Product Manager

## Contexte

La console doit lister boîtes et instantanés (vision, principe 3 : moindre privilège, mode
lecture seule possible). Le SDK `@wisecom/atlas-sdk` expose ces lectures sur le stockage S3
d'Atlas. Le Product Manager a vérifié (2026-11-12, sauvegardes du tenant de test, identifiants
Graph volontairement faux) quelles lectures fonctionnent sans Graph.

## Décision

- Le port `BackupCatalog` (`packages/core`) est en lecture seule : boîtes, instantanés par
  charge, détail d'un instantané. Il est indépendant du SDK.
- **Dépendance** : `@wisecom/atlas-sdk` en version figée `6.2.0` (npm, Apache-2.0, même projet
  qu'Atlas), dans `apps/server` uniquement. Le SDK embarque l'accès S3, le chiffrement et le
  client Graph ; le réécrire serait un fork de fait (README, principe 5).
- L'adaptateur `AtlasSdkCatalog` (`apps/server/src/atlas-catalog.ts`) ne dépend que de
  l'interface `AtlasSdkReader`, sous-ensemble de `AtlasInstance`. `atlas-sdk.ts` construit
  l'instance réelle (`createAtlasInstance`) ; `main.ts` la câble. Les erreurs du SDK sont
  converties en `CatalogUnavailableError` ; l'API répond 503 sans détail.
- **Lectures utilisées**, toutes sans Graph (S3 et phrase de chiffrement seulement) :
  `outlook.listMailboxes()`, `outlook.listSnapshots(ownerId)`,
  `outlook.getSnapshotDetail(snapshotId)`, `onedrive.listSnapshots(ownerId)`.
- **`validate()` n'est jamais appelé** : il vérifie aussi un jeton Graph et échoue
  (`ATLAS_AUTH_DENIED`) en mode lecture seule. Un stockage ou une phrase erronés se voient à la
  première lecture (503).
- **Valeurs factices Graph** : `createAtlasInstance` exige `clientId` et `clientSecret` non vides.
  La console passe les constantes `NO_GRAPH_CLIENT_ID` / `NO_GRAPH_CLIENT_SECRET`
  (`atlas-sdk.ts`). Ce ne sont pas des identifiants et rien ne les lit depuis l'environnement.
- **Identifiants** : une boîte est identifiée par `ownerId` (résumé `MailboxSummary` : ownerId,
  ownerEmail, mailboxPurpose, snapshotCount, totalObjects, totalSizeBytes, lastBackupAt). Le
  résumé n'a pas de nom d'affichage : la console montre `ownerEmail`, à défaut `ownerId`.
  L'identifiant d'instantané est `snapshotId`.
- **Charges couvertes** : `mail` (liste et détail) et `onedrive` (liste ; le SDK n'a pas de
  détail, l'adaptateur cherche l'instantané parmi ceux de chaque boîte). `contacts`,
  `sharepoint` et `teams` répondent sans instantané.
- **Configuration** par variables d'environnement : `BACKUP365_TENANT_ID`,
  `BACKUP365_S3_ENDPOINT` (URL http(s) absolue), `BACKUP365_S3_ACCESS_KEY_ID`,
  `BACKUP365_S3_SECRET_ACCESS_KEY`, `BACKUP365_ENCRYPTION_PASSPHRASE` (14 octets au moins)
  obligatoires ; `BACKUP365_S3_REGION` facultative (`eu-west-3`). Le SDK dérive le bucket du
  tenant (`atlas-<tenantId>`) : il n'y a pas de variable de bucket. Sans aucune de ces
  variables, le serveur démarre et les routes du catalogue répondent 503 ; avec une
  configuration partielle, il refuse de démarrer.
- Les tests de contrat (`@backup365/core/testing`) sont rejouables sur tout adaptateur ; les
  tests de l'adaptateur et du câblage utilisent un faux du SDK, sans réseau.

## Limites connues

- Les routes ne sont pas authentifiées (Entra est hors MVP) : la console ne doit pas être
  exposée hors d'un réseau de confiance.
- Seules des métadonnées (boîtes, dates) sont lues, pas de contenu : ces lectures ne passent pas
  par le journal d'audit, qui couvre la lecture et l'export d'éléments sauvegardés. À confirmer
  par le Product Manager.
- Le détail d'un instantané OneDrive relit les instantanés de toutes les boîtes, en séquence et
  avec leurs manifests complets. Il ignore un propriétaire OneDrive sans sauvegarde mail (la
  liste des boîtes vient des manifests Outlook). Acceptable pour un petit parc, à remplacer si
  le SDK expose un détail ou si le port accepte un `ownerId`. L'échec de lecture d'une seule boîte
  fait échouer tout le détail (503), sans reprise partielle : choix assumé, par simplicité.
- Le script d'installation de `core-js-pure` (dépendance transitive du SDK) est désactivé
  (`allowBuilds` dans `pnpm-workspace.yaml`) ; il n'affiche qu'une bannière.

## Non vérifié

Lecture réelle contre un stockage S3 : les tests n'utilisent qu'un faux du SDK. Les signatures
et formes de retour ont été relevées dans les types du paquet 6.2.0, et le constat « sans Graph »
vient de l'essai du Product Manager.

## Conséquences

Le catalogue réel est câblé ; la console reste utilisable sans stockage configuré (503 sur les
routes du catalogue). Toute montée de version du SDK demande de relire `AtlasSdkReader`.
