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
- États : `ok` (âge ≤ seuil), `stale` (« ancien », âge > seuil), `missing` (« absent », aucun
  instantané ou date illisible). `alertCount` compte les lignes `stale` et `missing`, sites
  compris. Un instantané daté du futur compte pour un âge nul.
- Le calcul est une fonction pure du catalogue (`buildStatusReport`, `packages/core`), sans
  accès réseau propre ; l'horloge est injectable pour les tests.
- Seuil : `BACKUP365_STATUS_MAX_AGE_HOURS`, 26 par défaut (nombre de 0 exclu à 8760).
  Un seuil unique pour toutes les charges.
- Charges suivies : `BACKUP365_STATUS_WORKLOADS` (liste séparée par des virgules), `mail`,
  `onedrive` et `sharepoint` par défaut, les seules que l'adaptateur sait lire. Les autres
  répondent sans instantané (ADR 0002) : les suivre par défaut les afficherait « absent » en
  permanence. Les boîtes couvrent les charges autres que `sharepoint` ; les sites ne sont lus
  que si `sharepoint` est suivie.
- Écran d'accueil : synthèse (nombre d'éléments en alerte) puis tableau (source, type, charge) ;
  l'état est écrit en toutes lettres.
- Lecture de métadonnées seulement : pas d'entrée dans le journal d'audit (ADR 0002).

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

## Non vérifié

Lecture réelle contre un stockage S3 : les tests n'utilisent qu'un faux du SDK. La méthode
vient de l'essai du Product Owner ; les types ont été relevés dans le paquet 6.2.0.
