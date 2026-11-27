# ADR 0006 : tableau de bord de l'état des sauvegardes

Statut : **proposé** (issues #7 et #31)

## Contexte

Le MVP affiche l'état de la dernière sauvegarde par charge (vision, MVP 3). Le catalogue
(ADR 0002) donne les boîtes et, par charge, les instantanés. L'issue #31 y ajoute les sites
SharePoint sauvegardés. Teams est hors périmètre (issue #34) : le SDK 6.2.0 n'a pas d'API Teams.

## Décision

- `GET /api/status` renvoie `{ generatedAt, maxAgeHours, alertCount, rows }` ; une ligne par
  source (boîte ou site) et par charge suivie : `kind` (`mailbox` ou `site`), `sourceId`,
  `displayName`, date du dernier instantané, âge en heures entières, état.
- Pour un administrateur, une ligne porte `failure` (`plan`, `at`, `coveredBy?`) quand la dernière
  exécution d'un plan qui la couvre a échoué : l'écran la dit « En échec », jamais « À jour »,
  et nomme l'autre plan qui la sauvegarde avec succès s'il existe (issue #518).
- États : `ok` (âge ≤ seuil), `stale` (« ancien », âge > seuil), `missing` (« absent », aucun
  instantané ou date illisible). `alertCount` compte les lignes `stale` et `missing`, sites
  compris. Un instantané daté du futur compte pour un âge nul.
- Le calcul est une fonction pure du catalogue (`buildStatusReport`, `packages/core`), sans
  accès réseau propre ; l'horloge est injectable pour les tests.
- `volume_octets` (issue #474) : somme des tailles (`sizeBytes`, lue par le SDK dans
  `totalSizeBytes`) des instantanés que le tableau lit, donc ceux des charges suivies. Elle vaut
  `0` sans instantané et `null` si un instantané n'a pas de taille, ou si la somme dépasse un
  entier sûr. Elle ne fait ni appel Graph ni lecture de plus. Visible par tout rôle, comme `rows`.
- Seuil : `BACKUP365_STATUS_MAX_AGE_HOURS`, 26 par défaut (nombre de 0 exclu à 8760).
  Un seuil unique pour toutes les charges.
- Charges suivies : `BACKUP365_STATUS_WORKLOADS` (liste séparée par des virgules), `mail`,
  `onedrive` et `sharepoint` par défaut, les seules que l'adaptateur sait lire. Les autres
  répondent sans instantané (ADR 0002) : les suivre par défaut les afficherait « absent » en
  permanence. Les boîtes couvrent les charges autres que `sharepoint` ; les sites ne sont lus
  que si `sharepoint` est suivie.
- Écran d'accueil : bandeau de synthèse (tout est à jour, ou nombre de sauvegardes et de
  plans en retard ou en échec), puis section « Sauvegardes » (décompte par pastilles, tableau trié
  du pire état au meilleur, ancienneté en clair) ; sous 900 px, les lignes « À jour » sont
  repliées derrière un bouton. L'état est écrit en toutes lettres, avec les mêmes libellés que
  les plans (« À jour », « En retard », « En échec »).
- Lecture de métadonnées seulement : pas d'entrée dans le journal d'audit (ADR 0002).

### Accueil allégé (issue #239)

- L'accueil ne montre plus le tableau ci-dessus (accessible par `GET /api/status`, sans page pour
  l'instant) mais trois cartes alimentées par **une seule requête**, `GET /api/overview` :
  `{ state, plans: { total, operational }, lastBackupAt, lastBackupPlan }`. Compteurs, dates et nom
  du plan de la dernière réussite, sans détail d'erreur ; ouvert à l'opérateur (lecture seule), hors journal d'audit.
- Un plan est « opérationnel » (affiché « à jour ») si sa dernière exécution a réussi. Le modèle n'a pas de plan
  suspendu : tous les plans sont actifs, donc le critère « actif » est sans effet.
- `state` : `unconfigured` seulement quand il n'y a aucun plan (maquette de l'issue). Dès qu'un
  plan existe, l'état suit le dernier résultat : `failed` si la dernière exécution terminée d'un
  plan au moins a échoué, sinon `operational` si un plan au moins a un résultat. Tant qu'aucun plan
  n'a de résultat (jamais lancé, ou première exécution en cours), `state` vaut `pending` : l'accueil
  n'affiche alors aucune pastille, seulement la phrase « Aucune sauvegarde n'est encore terminée. »,
  sans bouton. La maquette ne nomme pas ce cas : libellé provisoire, question posée au PO.
- `lastBackupAt` : fin de la dernière exécution réussie, tous plans confondus. Issue #419 :
  `lastBackupPlan` donne le nom du plan de cette exécution (donnée de configuration, ni détail
  d'erreur ni donnée sauvegardée).
- Issue #307 : `plans` porte aussi `running` et `queued`, le nombre de plans en cours et de plans
  en file, lus aux mêmes sources que `GET /api/plans`, avec la priorité de la pastille de la liste
  (un plan en cours n'est pas compté en file). La
  carte « Plans » les affiche sous le décompte, avec les pastilles de la liste (« En cours », « En
  file d’attente ») ; au repos, rien ne s'ajoute. `state` n'en dépend pas : il suit toujours le
  dernier résultat terminé.
- Issue #462 : `lateBackups` liste les sauvegardes au-delà du seuil de retard (26 h par défaut),
  une par boîte, compte ou site (`service`, `name`, `lastSnapshotAt`). Le serveur les calcule avec
  `lateBackups` du noyau, sur les mêmes lignes que `GET /api/status` : le bandeau et le compteur de
  « Sources » en comptent donc autant. Une source jamais sauvegardée n'en fait pas partie. Tant que
  la liste n'est pas vide, la carte « Sauvegarde » n'affiche pas « Opérationnelle » mais
  « En retard » (« En échec » reste prioritaire), ajoute sa phrase et un bouton « Voir les sources ».
  `state` et la carte « Plans » ne changent pas.
- Issue #578 : sous les cartes, « Couverture du tenant », « Prochaine sauvegarde » et « Derniers
  événements » (`GET /api/status`, `/api/plans`, `/api/runs`) sont chargés par l'accueil en même
  temps que `GET /api/overview`, et relus ensemble après « Sauvegarder maintenant ». Ils suivent
  `state` : rien avant la réponse (ni, pour l'administrateur, avant celle de la configuration) ;
  `unconfigured`, la seule phrase « Aucun plan… » ; `pending`, pas de tuile et seulement une
  exécution en cours ; connexion Microsoft 365 à configurer, ni échéance ni lancement. Les
  captures simulent `overview`, `plans` et `runs` à partir d'un même scénario (`homeAs` dans
  `e2e/screens.mjs`), avec les règles du serveur ; les tuiles restent celles du catalogue de démo.
- Issue #600 : `plans.waiting` compte les plans sans aucune exécution terminée (jamais lancés, ou
  première exécution en cours) ; ils ne sont comptés ni à jour, ni en retard, ni en échec. Quand
  tous les plans attendent, la carte « Plans » porte la pastille « En attente » de la carte
  « Sauvegarde » et « 1 plan, en attente de sa première sauvegarde » ; sinon une pastille
  « En attente » avec leur nombre s'ajoute aux autres. « Dernière sauvegarde » reprend la phrase
  « Aucune sauvegarde n'est encore terminée. », « Derniers événements » n'a plus de lien
  « Tout voir dans Activités » quand la liste est vide, et la ligne d'aide de « Prochaine
  sauvegarde » dit « Calculée d'après la fréquence de vos plans. », sans sigle.
- Issue #608 : sur l'accueil de l'administrateur, une seule « dernière sauvegarde », celle de
  « Derniers événements ». La carte « Dernière sauvegarde » donne le début et le plan de la ligne
  « Réussie » la plus récente (l'heure de la colonne « Heure »), une réussite sans élément copié
  comprise, comme dans le tableau ; sans ligne « Réussie », la réponse de `GET /api/overview`.
  Si cette réussite n'a rien copié, la carte ajoute « aucun nouvel élément » après le plan
  (issue #640).
  « Aucune sauvegarde ne part depuis le … », dans le bandeau comme dans la carte « Sauvegarde »,
  donne le début de la ligne la plus récente ; sans ligne, la dernière exécution des plans. La
  page Plans et l'accueil de l'opérateur (sans tableau) gardent les dates de `GET /api/plans` et
  `GET /api/overview`.
- Issue #634 : la carte « Sauvegarde » de l'administrateur cite les échecs de « Derniers
  événements ». Ce sont les plans dont la dernière exécution terminée listée est « En échec »,
  avec leur plan et l'heure de la colonne « Heure ». Un plan est cité « Échec de « … » le … »,
  plusieurs « 2 plans en échec : « … » le …, « … » le … ». Si le serveur compte plus de plans en
  échec que la liste n'en montre : « 3 plans en échec, dont « … » le … ». Le compteur « En échec »
  de la carte « Plans » n'est jamais inférieur au nombre de plans nommés. Sans échec listé, la
  réponse de `GET /api/overview`, plus ancienne que toutes les lignes.

### Sites SharePoint sauvegardés (issue #31)

- Port `BackupCatalog` : `listSites()` (sites ayant une sauvegarde, pas tous ceux du tenant) et
  `listSiteSnapshots(siteId)`. Les tests de contrat les couvrent.
- **Méthode de recensement** (vérifiée par le Product Owner, SDK 6.2.0, identifiants Graph
  factices) : `getStorageUsage({ breakdown: 'owner' })` fonctionne sans Graph ; les
  propriétaires dont `workload === 'sharepoint'` (identifiant non vide, dédoublonné) sont les
  sites sauvegardés. `sharepoint.listSnapshots(siteId)` fonctionne sans Graph et donne le nom
  d'affichage (à défaut l'URL, puis l'identifiant), la date et le nombre de fichiers.
- **Jamais `sharepoint.listSites()`** (Graph, tout le tenant) **ni `validate()`** (ADR 0002).
- **Coût** : le recensement liste tout le bucket ; il croît avec le nombre d'objets (10 requêtes
  S3 pour 2 sites sur le tenant de test), puis une lecture de manifests par site.
- **Cache** : l'adaptateur garde en mémoire sites et instantanés pendant
  `BACKUP365_CATALOG_CACHE_MINUTES` (entier de 1 à 1440, 60 par défaut). Un appel HTTP ne
  relance jamais le recensement tant que le cache est valide ; les appels simultanés
  partagent un seul calcul ; un échec n'est pas mis en cache (503 sans détail). Le délai court
  à partir de la fin du recensement.
- Un recensement interrompu (`complete` faux) est refusé (503) : une liste partielle ferait
  disparaître des sites sans alerte.

## Conséquences

- Une requête `listSnapshots` par boîte et par charge, en séquence : acceptable pour un petit
  parc. L'échec du catalogue répond 503 sans détail.
- Un site sauvegardé depuis le dernier recensement n'apparaît qu'à l'expiration du cache (1 h
  par défaut) ; il n'y a pas d'invalidation manuelle (redémarrer le serveur la force). Après une
  nouvelle sauvegarde, la date d'un site peut donc retarder d'autant, et une alerte « ancien »
  peut durer jusqu'à l'expiration.
- Si le recensement échoue, `GET /api/status` répond 503 en entier (boîtes comprises), comme
  pour un échec de lecture d'une boîte. Un échec n'étant pas mis en cache, une panne durable
  relance le parcours du bucket à chaque requête ; il n'y a ni délai maximal ni lecture en
  parallèle des sites. Choix assumé par simplicité, à revoir si le parc grandit.
- Le cache est propre au processus et n'est pas partagé entre instances.
- Un site dont tous les objets ont été supprimés n'apparaît plus : il n'est pas « absent ».
- Le tableau n'est pas un contrôle de santé : un instantané récent ne prouve pas qu'il est
  complet (les avertissements de sauvegarde ne sont pas exposés par le port).
- Les identifiants de site doivent avoir la forme canonique (avec virgule) pour que
  `sharepoint.listSnapshots` fonctionne sans Graph ; c'est le cas des clés de stockage.
- Teams reste à ajouter (issue #34).

### Conformité des plans (issue #64)

- `GET /api/status` ajoute `plans` : `{ counts: { compliant, late, failed }, nonCompliant: [...] }`.
  Chaque plan est classé par `planCompliance` (ADR 0009) ; `nonCompliant` liste les plans
  « en retard » ou « en échec » (`id`, `name`, `rpoHours`, `state`, `lastSuccessAt`, `lastRun`, la
  dernière exécution terminée, dite comme la liste des plans ; `dataTypes`, les types de données
  couverts, issue #451).
- La page « Sources » accorde la ligne d'un service avec ce qu'elle liste plus bas (issue #451) :
  une sauvegarde datée dans `rows` donne à la ligne sa date et son état ; un plan de `nonCompliant`
  dont les `dataTypes` contiennent le service suffit à ne pas le dire « Non protégé ». Une ligne
  de `rows` sans sauvegarde (une par source connue, même jamais sauvegardée) ne change rien :
  « Jamais » et « En attente » restent ceux de `services`.
- `plans` est absent sans base des plans, `null` si elle ne répond pas (le reste du tableau est
  servi). Sans plan, les trois décomptes valent 0.
- Par plan, les 500 dernières exécutions sont relues.
- `plans` n'est servi qu'aux administrateurs : réservé aux administrateurs par décision du PO
  du 2026-11-16, en attente de #86. Pour tout autre rôle, et sans session, le champ est absent et
  la section n'est pas affichée. Élargir cet accès relève du PM (#86).
- L'authentification ne peut pas être désactivée (`auth-hook.ts`) : sans service d'authentification,
  tout `/api` hors santé répond 503 ; avec lui, une session valide est exigée. Le cas « sans
  session » ne se présente donc pas sur `/api/status` ; le refus par défaut du champ `plans` est
  une défense en profondeur. Testé (`status-routes.test.ts`).
- Coût (issue #88), mesuré en mémoire avec 500 exécutions par plan, médiane de 7 appels :
  10 plans 12 ms, 50 plans 51 ms, 200 plans 201 ms (3 à 4 ms par plan, SQLite synchrone). Sous le
  seuil de 300 ms à 50 plans (seuil fixé par l'issue #88) : pas de cache. Ordre de grandeur,
  mesuré avec un banc jetable et non commité ; un disque plus lent allongerait ces temps. À reprendre si l'on dépasse environ 70 plans.
- Écran d'accueil : section « Plans de protection » (décompte par état, pastille icône + texte)
  avant le tableau des sources ; tableau des plans en retard ou en échec seulement s'il y en a.
  Chaque anomalie mène à son écran : le bandeau et le nom du plan vers `#/plans`, la source
  d'une boîte en retard ou en échec vers `#/search?mailbox=<boîte>`.

## Non vérifié

Lecture réelle contre un stockage S3 : les tests n'utilisent qu'un faux du SDK. La méthode
vient de l'essai du Product Owner ; les types ont été relevés dans le paquet 6.2.0.
