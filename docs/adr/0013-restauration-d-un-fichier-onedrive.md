# ADR 0013 : parcourir et restaurer un fichier OneDrive, ou une version antérieure

Statut : **proposé** (issue #52)

## Contexte

Suite de l'ADR 0012 (mêmes règles : motif, asynchrone, audit, rôles). Le SDK 6.2.0 fournit, côté
`onedrive` : `listSnapshots(ownerId)` (manifestes complets, lecture sans Graph), `listFileVersions
(ownerId, fileRef)` (lecture), `restore(ownerId, { snapshotId, fileFilter, conflictBehavior,
inPlace, destination, renameTo })` et `restoreVersion(ownerId, { fileRef, versionId, placement })`
(écritures, via Graph). Le point « à valider avec l'équipe technique » de la maquette est tranché
par les types : `restoreVersion` accepte `placement: 'copy'` (fichier voisin, jamais l'actuel) ou
`'in-place'` ; `restore` accepte `renameTo` pour un fichier unique. Le mode « copie » existe donc
sans téléchargement intermédiaire.

## Décision

- Ports `DriveBrowser` (lecture : instantanés, contenu d'un dossier, versions d'un fichier) et
  `DriveRestorer` (`packages/core/src/drive.ts`), indépendants du SDK. Adaptateurs
  `AtlasSdkDriveBrowser` et `AtlasSdkDriveRestorer` (`apps/server/src/atlas-drive.ts`). Aucune
  dépendance.
- **Parcours** : l'arborescence est déduite des lignes du manifeste de l'instantané (`parentPath`,
  `fileName`) ; les sous-dossiers sont les premiers segments des chemins plus profonds, les
  éléments `deleted` sont masqués (pour retrouver un fichier supprimé, choisir un instantané
  antérieur à la suppression). La date « Version du » est `lastModifiedAt`, à défaut `backupAt` ;
  pour un dossier, la plus récente de son contenu.
- **Modes** : par défaut, **copie**, qui ne modifie rien :
  - fichier : `restore` avec `fileFilter: [chemin]`, `inPlace`, `renameTo: nom (restauré
jj-mm-aaaa).ext`, `conflictBehavior: 'rename'` ;
  - dossier : `restore` avec `destination: <parent>/<nom> (restauré jj-mm-aaaa)` ;
  - version : `restoreVersion` avec `placement: 'copy'`.
    **Remplacer** n'existe que pour un fichier (ou une version) et exige la case de confirmation :
    `conflictBehavior: 'replace'` ou `placement: 'in-place'` ; l'ancienne version reste dans
    l'historique OneDrive. Remplacer un dossier entier n'est pas proposé.
- **Date du nom de la copie** : `jj-mm-aaaa` (UTC, jour du lancement) et non `jj/mm/aaaa` comme
  dans la maquette : `/` est interdit dans un nom de fichier OneDrive.
- **Câblage** : comme pour le mail (ADR 0012), l'écriture passe par Graph, que la console n'a pas
  (ADR 0002). Le parcours fonctionne avec le seul stockage (lecture) ; la restauration n'est
  câblée que dans le mode démo (`DriveRestoreService` avec un restaurateur factice, 2 s,
  `previsions.xlsx` échoue). Ailleurs : `GET /api/onedrive/status` répond `configured: false`, `POST …
/restore` répond 503 `restore_unavailable` et le bouton est désactivé.
- `DriveRestoreService` : une restauration à la fois par fichier ou dossier (409
  `restore_in_progress`), arrière-plan, durée mesurée, dernier état en mémoire (1000 au plus),
  délai de 10 minutes (`restore_unreachable`, état incertain), codes d'échec fermés. Même
  conception que `RestoreService`.
- Routes (session ; lecture : tout rôle ; restauration : `admin` ou `operator`) :

| Route                                              | Effet                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /api/onedrive/:ownerId/snapshots`             | instantanés du compte (métadonnées, hors audit, comme l'ADR 0002)                           |
| `GET /api/onedrive/:ownerId/items?snapshot=&path=` | contenu d'un dossier ; audit `list.view` / `onedrive.items`, avant la réponse               |
| `GET /api/onedrive/:ownerId/versions?path=`        | versions d'un fichier ; audit `item.open` / `onedrive.versions`                             |
| `GET /api/onedrive/:ownerId/restore?path=`         | `{ last }` : dernière restauration de l'élément ou `null`                                   |
| `POST /api/onedrive/:ownerId/restore`              | corps `{ snapshotId, path, kind, mode, versionId?, reason }` ; 202, 400, 403, 404, 409, 503 |

- **Validation côté serveur** : chemin canonique (`/…`, sans `..`, `\`, caractère de contrôle ;
  la racine est refusée pour restaurer), `kind` et `mode` fermés, dossier + `replace` ou
  - version refusés (400). L'élément (et la version) doit exister dans la sauvegarde, sinon 404
    `item_not_found` : le client ne dicte rien au SDK. Le motif suit `cleanReason` (ADR 0005).
- **Audit** : lecture du contenu et des versions (voir le tableau) ; pour la restauration,
  ressource `onedrive.restore`, cible `compte/chemin`, `restore.request` (motif) avant le
  lancement (échec : rien ne part), `restore.result` à la fin avec `count` (1 ou 0) et un motif
  `outcome=<succeeded|failed>;duration_ms=<n>;mode=<copy|replace>;reason=<motif>` (le motif,
  texte libre, est toujours le dernier champ : couper aux trois premiers `;` seulement). Jamais
  le contenu d'un fichier ; le chemin (nom de fichier) figure en cible, comme l'identifiant d'un
  mail dans l'ADR 0012.
- **Interface** : entrée « OneDrive » de la navigation (`#/onedrive/<compte>/<chemin>`, six
  entrées pour un administrateur). Étape 1 : tableau (radios : une seule sélection, flèches et
  Espace natifs ; dossiers = liens, Entrée) et panneau `Dialog` des versions. Étape 2 :
  formulaire de motif, mode, récapitulatif, confirmation du remplacement. Étape 3 : suivi
  (`role="status"`, relecture chaque seconde, « suivi perdu » si le serveur a perdu la trace).
  Composants communs : `DataTable`, `Dialog`, `FormField`, `Steps`, `Alert`, `EmptyState`, `Button`.

## Conséquences

- Pas de rôle « lecteur » (ADR 0008) : l'état « droits insuffisants » n'est atteignable que si un
  rôle refusé existait ; le message du 403 est prêt côté interface.
- Chaque navigation relit les manifestes complets du compte (`listSnapshots`) : acceptable pour un
  petit parc, à mettre en cache ou à remplacer si le SDK expose une lecture par dossier.
- Un seul compte à la fois ; restaurer vers un autre OneDrive ou un autre emplacement, la
  restauration en masse et l'aperçu restent hors périmètre.

## Non vérifié

Aucun appel réel au SDK. Hypothèses tirées des types 6.2.0, à vérifier sur un tenant de TEST :

- le format de `parentPath` (rooted `/Documents`, ou préfixé `/drive/root:`, géré par
  `normalizeDrivePath`) ;
- la portée de `fileFilter` (chemin exact ou préfixe : `/Documents/a.txt` toucherait-il aussi
  `a.txt.bak` ?). Le mode copie n'écrase rien dans les deux cas ; le mode remplacer d'un fichier
  y est sensible ;
- `renameTo` avec `inPlace` (nom obtenu, comportement si le nom existe), `destination` pour un
  dossier (arborescence créée sous le dossier daté), `listFileVersions` (versions Microsoft 365 et
  copies d'instantanés) et le contenu des manifestes (complet ou différentiel) ;
- `filesRestored` pour un fichier unique.
