# ADR 0006 : tableau de bord de l'état des sauvegardes

Statut : **proposé** (issue #7)

## Contexte

Le MVP affiche l'état de la dernière sauvegarde par charge (vision, MVP 3). Le catalogue
(ADR 0002) donne les boîtes et, par charge, les instantanés.

## Décision

- `GET /api/status` renvoie `{ generatedAt, maxAgeHours, alertCount, rows }` ; une ligne par
  boîte et par charge suivie : date du dernier instantané, âge en heures entières, état.
- États : `ok` (âge ≤ seuil), `stale` (« ancien », âge > seuil), `missing` (« absent », aucun
  instantané ou date illisible). `alertCount` compte les lignes `stale` et `missing`. Un
  instantané daté du futur compte pour un âge nul.
- Le calcul est une fonction pure du catalogue (`buildStatusReport`, `packages/core`), sans
  accès réseau propre ; l'horloge est injectable pour les tests.
- Seuil : `BACKUP365_STATUS_MAX_AGE_HOURS`, 26 par défaut (nombre de 0 exclu à 8760).
  Un seuil unique pour toutes les charges.
- Charges suivies : `BACKUP365_STATUS_WORKLOADS` (liste séparée par des virgules), `mail` et
  `onedrive` par défaut, les seules que l'adaptateur sait lire. Les autres répondent sans
  instantané (ADR 0002) : les suivre par défaut les afficherait « absent » en permanence.
- Seules les boîtes sont couvertes : le catalogue n'a ni site SharePoint ni équipe Teams.
- Écran d'accueil : synthèse (nombre d'éléments en alerte) puis tableau ; l'état est écrit en
  toutes lettres.
- Lecture de métadonnées seulement : pas d'entrée dans le journal d'audit (ADR 0002).

## Conséquences

- Une requête `listSnapshots` par boîte et par charge, en séquence : acceptable pour un petit
  parc. L'échec du catalogue répond 503 sans détail.
- Le tableau n'est pas un contrôle de santé : un instantané récent ne prouve pas qu'il est
  complet (les avertissements de sauvegarde ne sont pas exposés par le port).
- Ajouter sites et équipes demandera d'étendre le port `BackupCatalog`.
