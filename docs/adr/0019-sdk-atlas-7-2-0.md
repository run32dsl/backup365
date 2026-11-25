# ADR 0019 : passer le SDK d'Atlas de 6.2.0 à 7.2.0

Statut : **proposé** (issue #542)

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
    les 10 minutes qui suivent un arrêt brutal, échoue sans rien écrire. L'écran affiche alors
    l'échec générique `restore_unreachable` ; l'opérateur relance plus tard. Un libellé dédié
    (« sauvegarde en cours, réessayez dans quelques minutes ») est une suite possible, qui touche
    l'interface et sort de cette issue.
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
  `listSnapshots`, qui renvoie toujours les manifestes. Piste de performance, hors périmètre.
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
- Vérifications sur un tenant de TEST, non faites ici (aucun appel réel au SDK dans les tests) :
  une sauvegarde et les trois restaurations avec le SDK 7.2.0, et le refus d'une restauration
  pendant une sauvegarde du même propriétaire.
