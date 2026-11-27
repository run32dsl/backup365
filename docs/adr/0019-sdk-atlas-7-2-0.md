# ADR 0019 : passer le SDK d'Atlas de 6.2.0 à 7.2.0, puis à 7.3.0

Statut : **proposé** (issue #542 ; montée en 7.3.0 : issue #609, voir la dernière section)

## Contexte

Le PM délégué autorise la montée de `@wisecom/atlas-sdk` de 6.2.0 à 7.2.0 (dépendance déjà
présente, version exacte épinglée). Elle ouvre les contacts, l'agenda et Teams, et apporte les
corrections de l'amont. Le paquet publié n'a pas de journal des changements : la comparaison
porte sur les types publics (`dist/index.d.mts`) et le code (`dist/index.mjs`) des deux versions.

## Décision

- `@wisecom/atlas-sdk` est épinglé en **7.2.0** dans `apps/server`. Ses dépendances transitives
  ne changent pas (même liste dans `pnpm-lock.yaml`).
- La version, publiée trop récemment pour la règle d'âge minimal de pnpm, figure dans
  `minimumReleaseAgeExclude` (`pnpm-workspace.yaml`), pour cette seule version exacte.
  L'exception pourra être retirée à la prochaine montée de version.
- Aucun changement de code de production n'est nécessaire : aucune méthode ni aucun champ que la
  console utilise n'a changé. Le bail par propriétaire (ci-dessous) change un comportement, sans
  rien casser.

## Ruptures entre 6.2.0 et 7.2.0, et leur traitement

- **Bail par propriétaire (rupture de comportement).** En 7.2.0, `backup`, `restore` et les
  suppressions prennent un bail dans le stockage pour la boîte, le propriétaire OneDrive ou le
  site visé ; il dure 10 minutes et se renouvelle pendant l'opération. Une seconde opération sur le
  même propriétaire est refusée avant toute écriture par `OwnerBusyError` (`ATLAS_OWNER_BUSY`). Le
  bail d'un processus tué bloque ce propriétaire jusqu'à son expiration. Une restauration dont les
  identifiants S3 ne peuvent pas écrire le bail (HTTP 403) se fait sans lui. Effet sur la
  console :
  - Sauvegardes : une seule à la fois par tenant (ADR 0017), donc pas de conflit entre elles. Un
    refus est enregistré avec le code `ATLAS_OWNER_BUSY` (`errorCode` du planificateur) et
    l'élément est repris au passage suivant, comme tout échec.
  - Restaurations : une restauration lancée pendant la sauvegarde du même propriétaire, ou dans
    les 10 minutes qui suivent un arrêt brutal, échoue sans rien écrire. Depuis l'issue #567,
    l'écran l'explique (`restore_busy` : « une autre opération est en cours… attendez quelques
    minutes ») et indique que rien n'a été modifié ; l'opérateur relance plus tard.
- **Retrait de la réplication et de la réhydratation** : `replicateSnapshot`, `replicateAll`,
  `replicateMailbox`, `rehydrateSnapshot`, `rehydrateOwner`, `rehydrateSite`, `rehydrateMailbox`,
  `rehydrateTenant`, `getReplicationStatus`, `getReplicationStatusByOwner`. Aucun effet : jamais
  appelées.
- **Codes d'erreur** : `AtlasErrorCode` gagne `ATLAS_FORMAT_UNSUPPORTED`,
  `ATLAS_SNAPSHOT_NOT_NEWEST`, `ATLAS_WRITE_REFUSED`, `ATLAS_OWNER_BUSY`, `ATLAS_ACCESS_REFUSED`,
  `ATLAS_GRAPH_UNAVAILABLE` et `ATLAS_STORAGE_UNAVAILABLE`. Le SDK précise que seuls les codes
  font contrat, pas les messages. Le catalogue répond déjà 503 sur toute erreur inconnue ;
  l'exécuteur et les restaurations ne gardent qu'un code. La détection « aucune sauvegarde »
  (`isBucketMissing`) lit le code `ATLAS_NOT_FOUND` et le message « No backups found », toujours
  émis en 7.2.0, avec ou sans `NoSuchBucket` en `cause` (test ajouté avec la vraie
  `NotFoundError`).
- **Nouvelles API** : `AtlasInstance` gagne `teams`, `contacts`, `calendar` et `keys`. Nos
  sous-ensembles (`AtlasSdkReader`, `AtlasBackupApi`, restaurateurs) restent satisfaits.
- **Résultats de restauration OneDrive et SharePoint** : nouveaux champs facultatifs
  (`permissionsApplied`, `skippedItems`, `unmatchedFileFilters`, couleurs de dossier). La remise
  des permissions n'a lieu que sur demande (`restorePermissions`), que la console ne passe pas.
- **Lectures** : `listSnapshotSummaries` (index, sans déchiffrer chaque manifeste) s'ajoute à
  `listSnapshots`, qui renvoie toujours les manifestes. Depuis l'issue #567, le catalogue
  l'utilise pour ses listes quand il existe ; le détail OneDrive lit encore les manifestes (il
  lui faut le nombre de fichiers, absent de l'index).
- **Sonde du stockage** : `checkStorage()` dit si le stockage refuse les écritures
  conditionnelles dont dépend le bail. Elle écrit puis supprime un objet jetable dans le bucket ;
  la console la lance au plus une fois par heure (5 minutes après un échec, 10 s au plus par
  sonde), pour les administrateurs, et n'en garde que `supported`, `ignored` ou `not_probed`.
  En 7.2.0, `ignored` n'est qu'un signalement ; en 7.3.0, Atlas refuse alors d'écrire (section
  « Montée en 7.3.0 »).
- **Validation de `createAtlasInstance`** : identique pour ce que la console passe (champs non
  vides, `s3Endpoint` URL HTTP(S) absolue, phrase d'au moins 14 octets). Un test construit
  désormais une vraie instance 7.2.0 depuis la configuration en lecture seule, sans requête.

Types, signatures de `backup`, `restore`, `restoreVersion`, `listSnapshots`, `getSnapshotDetail`,
`getStorageUsage` et la conversion en camelCase des résultats sont inchangés pour nos usages :
`pnpm run typecheck` passe sans modification.

## Champs utiles de 7.2.0

**Résultat d'une sauvegarde (succès, partiel, échec).** Exposé **seulement à l'appelant de
`backup()`**, comme en 6.2.0 : `interrupted`, `summary.folderErrors` (messagerie),
`summary.healthy` et `summary.errors` (OneDrive, SharePoint, contacts, agenda, Teams),
`summary.noSnapshotReason` (`no_content` ou `no_changes`), et nouveau `snapshotStored`
(messagerie, faux si l'opération est annulée avant le premier dossier). L'exécuteur (ADR 0009)
s'en sert déjà. **Rien n'est persisté** : ni le manifeste ni les résumés relus par
`listSnapshots` ou `listSnapshotSummaries` n'ont de statut, de compte d'erreurs ou de résultat.
Un lecteur en lecture seule ne peut toujours pas dire si un instantané est partiel.

**Éléments en échec.** OneDrive et SharePoint tiennent un registre des fichiers en échec, en
attente de nouvel essai ou abandonnés : `checkStatus()` le rend (`failedItems` par lecteur,
`totalFailedItems`). Mais `checkStatus()` interroge aussi Graph : la console en lecture seule ne
peut pas l'appeler. Les résultats de restauration n'ont pas ce champ.

**Plafond de débit.** **Non.** Ni `AtlasInstanceConfig` ni les options de sauvegarde n'ont de
plafond en octets par seconde. Les nouveautés touchent le rythme des appels Graph de Teams :
`teamsPacingShare` (part du budget Teams du tenant, de 0 à 1) et `concurrency` (canaux
simultanés, 1 à 16) ; s'y ajoutent les tentatives et délais S3 (`s3MaxAttempts`,
`s3ConnectionTimeoutMs`, `s3IdleTimeoutMs`). `throttleCoordinator` et
`ThrottledError.retry_after_ms` existaient déjà. La conclusion de l'ADR 0017 tient.

## Documents amont

- `docs/upstream/erreurs-partielles-d-un-instantane.md` : **conservé**, la demande reste
  ouverte en 7.2.0 ; une section « Vérification dans le SDK 7.2.0 » l'actualise.
- `docs/upstream/limite-de-debit.md` : **conservé**, la demande reste ouverte en 7.2.0 ; le
  contexte cite désormais 7.2.0.

## Conséquences

- Contacts, agenda et Teams deviennent possibles côté SDK ; chacun fera l'objet de sa propre
  issue (port du catalogue, écrans, restauration), hors de cette montée de version.
- Les ADR antérieurs qui citent « SDK 6.2.0 » décrivent ce qu'ils ont vérifié à leur date ; ils
  ne sont pas réécrits. L'ADR 0002 renvoie à celui-ci pour la version.
- Issue #567 : les codes `ATLAS_OWNER_BUSY`, `ATLAS_ACCESS_REFUSED`, `ATLAS_GRAPH_UNAVAILABLE`,
  `ATLAS_STORAGE_UNAVAILABLE`, `ATLAS_FORMAT_UNSUPPORTED` et `ATLAS_WRITE_REFUSED` ont désormais
  un libellé lisible (causes d'échec des plans, échecs de restauration) ; le catalogue lit
  `listSnapshotSummaries` pour ses listes ; la page Sources affiche le résultat de
  `checkStorage().conditionalWrites`.
- Vérifications sur un tenant de TEST, non faites ici (aucun appel réel au SDK dans les tests) :
  une sauvegarde et les trois restaurations avec le SDK 7.2.0, et le refus d'une restauration
  pendant une sauvegarde du même propriétaire.

## Montée en 7.3.0 (issue #609)

Comparaison des types publics (`dist/index.d.mts`) et du code (`dist/index.mjs`) de 7.2.0 et
7.3.0, avec les notes de version de 7.3.0 (pas de guide de migration publié).

**Décision.** `@wisecom/atlas-sdk` est épinglé en **7.3.0** ; l'exception d'âge minimal de pnpm
(`minimumReleaseAgeExclude`) passe à cette version exacte. Dépendances transitives inchangées
(seule l'entrée du SDK change dans `pnpm-lock.yaml`). Aucune signature utilisée par la console ne
change : `pnpm run typecheck` passe sans toucher aux ports.

### Ruptures et leur traitement

- **Stockage sans écritures conditionnelles : Atlas refuse d'écrire.** En 7.2.0, `checkStorage()`
  ne faisait que signaler `ignored`. En 7.3.0, toute écriture conditionnelle (bail, manifeste,
  clé du tenant) sonde d'abord le bucket et lève `ConditionalWritesNotEnforcedError`
  (`ATLAS_CONFIG_INVALID`) si le stockage les ignore : les sauvegardes y échouent toutes, et les
  restaurations aussi quand les identifiants S3 peuvent écrire (avec des identifiants en lecture
  seule, la sonde ne peut pas s'exécuter et la restauration se fait sans bail, comme en 7.2.0).
  C'est le cas où la console affiche `ignored`, sa propre sonde ayant pu écrire. La sonde vérifie une règle de plus (`current_if_match` : une écriture avec l'ETag
  courant doit passer, Ceph RGW 18 la refuse) et rend `violations`. Traitement : la section
  « Stockage » de la page Sources et le bandeau de synthèse ne conseillent plus d'éviter de
  restaurer pendant une sauvegarde ; ils disent que rien n'est sauvegardé ni restauré sur ce
  stockage et qu'il faut prévenir l'exploitant (`docs/installation.md` à jour). Un plan qui
  échoue ainsi garde la cause « inconnue » : `ATLAS_CONFIG_INVALID` couvre aussi d'autres erreurs
  de configuration, la page Sources donne la vraie raison.
- **Nouveau code `ATLAS_LISTING_INCOMPLETE`** (`ListingIncompleteError`) : une liste Graph
  (dossiers, calendriers, équipes) est revenue incomplète ; la sauvegarde s'arrête sans rien
  écrire. Traitement : cause `graph_unavailable`, interprétation la plus simple. Le libellé
  (« Microsoft 365 n'a pas répondu, malgré plusieurs essais ») est approché : Graph a répondu,
  mais incomplètement ; la conduite est la même, attendre le passage suivant. Si Graph renvoie
  un compte incohérent à chaque passage, le plan restera en échec avec cette cause ; une cause
  dédiée serait alors à créer. `GraphUnavailableError` couvre aussi désormais un 4xx
  répété sur un propriétaire qui existe.
- **Object Lock par exécution.** La rétention demandée (`objectLock`) n'est plus posée comme
  rétention par défaut du bucket, mais sur les seuls objets de l'exécution. Aucun effet : la
  console ne la demande pas.
- **Résultats de restauration** : `outcomeUnknown` (messagerie, OneDrive, SharePoint) liste les
  éléments dont la création a peut-être abouti malgré l'erreur. Ces lignes figurent aussi dans
  `errors`, que la console compte déjà : la restauration reste « terminée avec des erreurs ».

Les corrections de 7.3.0 (délais bornés des téléchargements et envois Graph, arrêt propre,
classement des pannes, manifestes OneDrive volumineux en plusieurs parties) s'appliquent sans
changement de code.

### Nouveautés utiles à la console (non utilisées ici)

- **`pruneSnapshots(owner, { before, dryRun })`** (messagerie, OneDrive, SharePoint) : supprime
  les instantanés plus anciens qu'une date en gardant les suivants restaurables, le plus récent
  toujours conservé. Lève la limite de l'étape 2 de l'ADR 0009 (`deleteSnapshot` refuse un
  instantané qui n'est pas le plus récent) : base d'une rétention par plan. Écrit dans le
  stockage, prend le bail ; `dryRun` permet d'afficher ce qui serait supprimé avant de le faire.
- **`objectLock` dans les résultats et les résumés d'instantanés** (OneDrive, SharePoint) :
  mode et date de fin de rétention réellement appliqués. La console pourrait afficher « protégé
  contre la suppression jusqu'au … » sur un point de restauration, si elle demande un jour une
  rétention.
- **`summary.folderFailures`** (sauvegarde de messagerie) : dossiers en échec complet avec leur
  code et `transient` (panne Microsoft 365, pas le dossier). L'exécuteur pourrait distinguer
  « Microsoft 365 indisponible » d'une erreur de dossier dans les causes d'échec.
- **`outcomeUnknown`** des restaurations : l'écran pourrait dire « vérifiez la cible avant de
  relancer » pour ces éléments, au lieu d'une erreur générique.
- **`ownerExclusion`** dans `createAtlasInstance` : exclusion fournie par l'hôte à la place du
  bail dans le bucket, pour un stockage sans écritures conditionnelles. Elle exige qu'aucun autre
  processus n'écrive dans le même tenant ; la console ne peut pas le garantir seule (CLI
  d'Atlas, second serveur). Non adoptée ; à réévaluer si un client a un tel stockage.
