# Étude et brouillon de demande amont : erreurs partielles d'un instantané

Issue #282. Destination du brouillon : dépôt d'Atlas (`wisecom-oy/atlas`). **Non publié** : à
publier par le Product Manager.

## Étude : le SDK 6.2.0 expose-t-il les erreurs partielles d'un instantané ?

**Non.** Les erreurs récupérables existent, mais seulement dans la valeur de retour de la
sauvegarde, jamais dans ce que le catalogue relit ensuite.

- `BackupSyncSummary` (`dist/index.d.mts`, ligne 986) porte `folder_errors`, `warnings` et
  `interrupted`. Il est renvoyé par `outlook.backup()` (`dist/index.mjs`, lignes 57772 à 57790,
  champ `summary`).
- Le manifeste, lui, est construit par `build_manifest` (`dist/index.mjs`, définition ligne 57325, appel ligne 57746) sans ces
  champs. Le type `Manifest` (`dist/index.d.mts`, ligne 90) n'a ni erreur, ni avertissement, ni
  statut. Seul `excluded_folders` y figure : ce sont des exclusions voulues (Junk, dossiers
  système), pas des échecs.
- Les lectures du catalogue (ADR 0002) renvoient ces manifestes : `outlook.listSnapshots` et
  `getSnapshotDetail` (`OutlookSnapshotManifest`), `onedrive.listSnapshots`
  (`OneDriveSnapshotManifest`, lignes 376 à 387) et `sharepoint.listSnapshots`. Aucun n'a de
  champ d'erreur. Le manque est le même pour les trois charges : `OneDriveBackupSummary` (ligne 1664) et `SharePointBackupSummary` (ligne 1813) portent `errors`, `warnings` et `healthy`, mais
  renvoyés à l'appelant, jamais persistés.
- Le SDK marque l'instantané `COMPLETED` même quand `folder_errors` n'est pas vide
  (`dist/index.mjs`, lignes 57311 à 57317) : le statut existant ne suffirait pas.
- Sans nouvelle entrée et avec un instantané précédent, `persist_mailbox_run` n'écrit aucun
  manifeste (ligne 57451) : il n'y a alors pas d'endroit où enregistrer les erreurs.
- `SnapshotStatus` (`COMPLETED`, `FAILED`, `IN_PROGRESS`, ligne 19) existe sur le type de domaine
  `Snapshot`, mais les lectures ci-dessus ne le renvoient pas.

Conséquence : la console, qui ne lance pas les sauvegardes (Atlas le fait), ne peut pas
justifier « Avec avertissements » ni « En échec » pour un instantané. Selon la recommandation de
l'issue, le libellé n'est donc pas affiché et le catalogue n'est pas modifié. Un instantané
absent reste « En échec » côté plan (ADR 0006), c'est un autre calcul.

## Vérification dans le SDK 7.2.0 (issue #542)

**Toujours non** (ADR 0019). Les références de lignes ci-dessus visent le paquet 6.2.0. En
7.2.0, les résultats de `backup()` portent les mêmes informations (plus `snapshot_stored` pour la
messagerie), toujours renvoyées à l'appelant seulement. Ni `Manifest`, ni
`OneDriveSnapshotManifest`, ni `SharePointSnapshotManifest`, ni les nouveaux résumés d'index
(`SnapshotSummary`, lus par `listSnapshotSummaries`) n'ont de statut, de compte d'erreurs ou de
résultat. Le registre des fichiers en échec (OneDrive, SharePoint) n'est lisible que par
`checkStatus()`, qui interroge Graph. La demande ci-dessous reste valable.

## Brouillon de demande amont

### Titre

SDK : persister dans le manifeste d'un instantané les erreurs et avertissements de sa sauvegarde

### Contexte

Notre console web (SDK 7.2.0, lecture seule du stockage) liste les instantanés d'après leurs
manifestes. `BackupSyncSummary.folder_errors` et `warnings` ne sont renvoyés qu'à l'appelant de
`backup()` : une fois l'opération terminée, rien dans le stockage ne dit qu'un dossier ou une
pièce jointe a échoué.

### Demande

1. Enregistrer dans le manifeste, par exemple `error_count` et `warning_count` (nombres, sans
   nom de dossier ni contenu), et un `outcome` : `success`, `partial` ou `failed`.
2. Les exposer dans les résumés renvoyés par `listSnapshots` et `getSnapshotDetail`, pour les
   trois charges.
3. Champs facultatifs : un manifeste ancien reste valide et se lit « inconnu ».
4. Préciser la valeur de `outcome` d'une exécution interrompue, et où l'enregistrer quand aucun
   manifeste n'est réécrit (aucune nouvelle entrée).

### Comportement attendu

Aucun changement pour les lecteurs existants. Un lecteur sans accès à Graph sait si le dernier
instantané est complet, partiel ou en échec.

## Suite côté console

Quand le SDK exposera ce résultat : ajouter `outcome` au port `BackupCatalog` et à `Snapshot`,
l'afficher dans la page « Sources » à côté de la fraîcheur (icône et texte), ajouter les
libellés à la charte, et étendre le lien « Voir dans le journal d'audit » à « Avec
avertissements ».
