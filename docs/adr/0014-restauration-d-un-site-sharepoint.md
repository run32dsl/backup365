# ADR 0014 : restaurer un élément, un dossier, une bibliothèque ou un site SharePoint

Statut : **proposé** (issue #53)

## Contexte

Suite des ADR 0012 et 0013 (mêmes règles : motif, asynchrone, audit, rôles). Le SDK 6.2.0 fournit,
côté `sharepoint` : `listSnapshots(siteId)` (manifestes complets, lecture sans Graph) et
`restore(siteId, { snapshotId, fileFilter, conflictBehavior, inPlace, renameTo, … })` (écriture,
via Graph) qui rend `filesRestored`, `filesSkipped`, `errors` et `interrupted`. Il ne rend aucune
progression ni ne permet d'annuler : `on_progress` et `should_interrupt` sont retirés des options du
SDK. Les sites et leurs instantanés viennent déjà du catalogue (`listSites`, `listSiteSnapshots`,
ADR 0002 et 0006).

## Décision

- **Ports** `SiteBrowser` (contenu d'un dossier, périmètre d'une restauration) et `SiteRestorer`
  (`packages/core/src/sharepoint.ts`), indépendants du SDK ; adaptateurs `AtlasSdkSiteBrowser` et
  `AtlasSdkSiteRestorer` (`apps/server/src/atlas-site.ts`). Aucune dépendance.
- **Chemin virtuel** `/<bibliothèque>/<dossiers>/<fichier>`, déduit du manifeste
  (`libraryName` + `parentPath` + `fileName`, `Documents` si la bibliothèque n'est pas nommée). La
  racine liste les bibliothèques ; les éléments `deleted` sont masqués. La granularité fixe la
  profondeur du chemin : site `/`, bibliothèque un segment, dossier et élément deux ou plus (le type
  est revérifié contre la sauvegarde).
- **Règle fixe, sans écrasement** : `restore` est toujours appelé avec `inPlace: true` et
  `conflictBehavior: 'rename'` (jamais `replace`) ; un élément seul reçoit en plus `renameTo:
nom (restauré jj-mm-aaaa).ext` (`jj-mm-aaaa` et non `jj/mm/aaaa` de la maquette : `/` est interdit
  dans un nom de fichier, comme à l'ADR 0013). Le site entier n'a pas de `fileFilter`. Le résultat
  distingue restaurés, **conservés** (`filesSkipped`) et erreurs ; une restauration interrompue
  compte pour une erreur.
- **Câblage** : comme pour le mail et OneDrive, l'écriture passe par Graph, que la console n'a pas
  (ADR 0002). Le parcours fonctionne avec le seul stockage ; la restauration n'est câblée que dans le
  mode démo (`SiteRestoreService` avec un restaurateur factice, 2 s ; `plan-b.pdf` échoue).
  Ailleurs : `GET /api/sharepoint/status` répond `configured: false`, `POST …/restore` répond 503
  `restore_unavailable` et « Continuer » est inactif avec son explication.
- **`SiteRestoreService`** : une restauration à la fois **par site** (le site entier recouvre tout),
  409 `restore_in_progress`, arrière-plan, durée mesurée, dernier état en mémoire, délai de 30 minutes
  (`restore_unreachable`, état incertain), codes d'échec fermés. Le job porte le total attendu (d'après
  la sauvegarde) et les comptes finaux, y compris en cas d'échec (résultat partiel).
- **Routes** (session ; lecture : tout rôle ; restauration : `admin` ou `operator`) :

| Route                                               | Effet                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/sharepoint/status`                        | `{ configured }`                                                                   |
| `GET /api/sharepoint/sites`                         | sites sauvegardés (métadonnées, hors audit, comme l'ADR 0002)                      |
| `GET /api/sharepoint/:siteId/snapshots`             | points de restauration                                                             |
| `GET /api/sharepoint/:siteId/items?snapshot=&path=` | contenu d'un dossier ; audit `list.view` / `sharepoint.items`, avant la réponse    |
| `GET /api/sharepoint/:siteId/scope?snapshot=&path=` | `{ items, sizeBytes }` du périmètre ; audit `list.view` / `sharepoint.scope`       |
| `GET /api/sharepoint/:siteId/restore`               | `{ last }` : dernière restauration du site ou `null`                               |
| `POST /api/sharepoint/:siteId/restore`              | `{ snapshotId, scope, path, reason, confirmName? }` ; 202, 400, 403, 404, 409, 503 |

- **Validation côté serveur** : chemin canonique, `scope` fermé, profondeur conforme, site, instantané
  et élément présents dans la sauvegarde (404 `item_not_found` sinon). **Site entier** : rôle
  `admin` seul (403 `admin_required`, journalisé) et `confirmName` égal au nom du site (400
  `confirmation_mismatch`) : la double confirmation n'est pas qu'une affaire d'interface.
- **Audit** : lecture du contenu et du périmètre (tableau) ; pour la restauration, ressource
  `sharepoint.restore`, cible `site/chemin` (`site/` pour le site entier), `restore.request`
  (`scope=<…>;reason=<motif>`) avant le lancement (échec : rien ne part), `restore.result` à la fin
  avec `count` = éléments restaurés et le motif
  `outcome=<…>;duration_ms=<n>;scope=<…>;skipped=<n>;errors=<n>;reason=<motif>` (texte libre en
  dernier : couper aux cinq premiers `;` seulement). Jamais le contenu d'un fichier.
- **Interface** : entrée « SharePoint » (`#/sharepoint/<site>/<granularité>/<chemin>` ; le chemin ouvert reste dans le fragment, que le serveur ne reçoit jamais, comme pour OneDrive ; sept entrées pour un
  administrateur). Étapes : choisir (site, granularité en `fieldset`, arborescence `role="tree"` au
  clavier, point de restauration), motif (liste et précision obligatoire), récapitulatif (case puis
  nom du site pour le site entier), suivi. La progression est une barre `role="progressbar"` sans
  valeur : le SDK n'en rend pas, on n'invente pas de pourcentage. Composants communs : `Steps`,
  `Alert`, `EmptyState`, `FormField`, `Button`. Un accès direct au site entier sans être administrateur
  affiche le refus de la maquette.

## Conséquences

- Pas de bouton « Annuler » pendant la restauration (le SDK ne sait pas interrompre) : l'écran
  l'explique par « Vous pouvez quitter cette page, la restauration continue ».
- Chaque navigation relit les manifestes complets du site (`listSnapshots`) : acceptable pour un
  petit parc, à mettre en cache si les sites sont volumineux.
- Le motif est demandé à l'étape 2, après le parcours de l'étape 1 comme dans la maquette (les
  noms de dossiers et de fichiers lus à l'étape 1 sont journalisés). Restaurer vers un autre site ou
  écraser, les sous-sites, permissions et paramètres restent hors périmètre.
- « RPO cible » de l'écran 1 n'est pas affiché (il vient des plans de protection, hors de cette issue).

## Non vérifié

Aucun appel réel au SDK. Hypothèses tirées des types 6.2.0, à vérifier sur un tenant de TEST :

- le format de `parentPath` et `libraryName` des manifestes SharePoint (chemin relatif à la
  bibliothèque supposé) ;
- le format de `fileFilter` (« identifiant ou chemin complet », avec ou sans la bibliothèque) et
  sa portée : chemin exact ou préfixe de chaîne (`/Plans 2024` toucherait-il `/Plans 2024 bis` ?).
  Le mode « sans écraser » rend l'erreur inoffensive, mais le périmètre pourrait déborder ;
- le comportement de `conflictBehavior: 'rename'` en place : nom obtenu pour un dossier ou une
  bibliothèque (le suffixe daté n'est garanti que pour un élément seul), sémantique de
  `filesSkipped` (« conservés ») ;
- `inPlace` avec `renameTo` sur SharePoint, comme à l'ADR 0013.
