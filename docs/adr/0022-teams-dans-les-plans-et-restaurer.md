# ADR 0022 : Teams dans les plans, la page Sources et Restaurer

Statut : **accepté** le 2026-11-26 par le Product Owner (issue #34) ; remise dans le canal
d'origine reportée à #558

## Contexte

Le PM délégué fait entrer Teams dans le périmètre (décision du 25/11) : les équipes et les canaux
dans les plans, la page Sources et « Restaurer » (parcours commun, ADR 0016). La maquette prévoit
deux contenus (messages, fichiers) et deux destinations (export, retour dans le canal).

Vérifié dans le SDK 7.2.0 (`dist/index.d.mts` et `dist/index.mjs`) :

- `TeamsApi` a `backup`, `verify`, `listTeams`, `listSnapshots`, `status`, `delete`, `save` et
  `quarantine`, mais **aucune méthode de restauration** : rien ne remet un message dans un canal ;
- la sauvegarde ne copie que les **messages des canaux** (et leurs contenus hébergés). Pour les
  fichiers d'un canal, l'index ne garde que l'adresse du dossier SharePoint de l'équipe
  (`get_channel_files_folder`) : les fichiers eux-mêmes ne sont sauvegardés qu'avec ce site ;
- `save` écrit une archive zip (team.json, messages du canal en JSON, transcription HTML), d'un
  instantané entier ou d'un seul canal (`channelId`), vers un fichier ou un flux. Le SDK le dit
  « Reads storage only; never calls Graph » : l'instance en lecture seule de la console suffit ;
- `listSnapshots(teamId)` rend les index (date, nom de l'équipe, canaux avec nom et nombre de
  messages) sans Graph ; `listTeams()` passe par Graph ;
- les conversations privées (chats) ne sont pas lues.

## Décision

- **Plans.** `DATA_TYPES` gagne `teams`, en dernier ; il n'est jamais coché par défaut (il demande
  sept autorisations Graph de plus, voir `docs/mise-en-production.md`). L'aide de la case dit ce
  qui est sauvegardé (les messages, les fichiers avec le site SharePoint de l'équipe) et que les
  conversations privées ne le sont pas. Teams couvre **toutes les équipes**, quel que soit le
  périmètre : la sélection d'un plan ne propose pas d'équipe (interprétation la plus simple de
  « aucun réglage propre à Teams »).
- **Exécution.** Un élément de plan `teams:<id>` désigne une équipe. Les équipes viennent de
  `teams.listTeams()` de l'instance de sauvegarde (Graph : une équipe jamais sauvegardée l'est) ;
  en démo, du catalogue. L'exécuteur appelle `teams.backup(id)` et lit le résultat comme
  OneDrive (`healthy`, `noSnapshotReason`, messages copiés, taille de l'index). Si les équipes ne
  peuvent pas être listées (autorisations Teams absentes), le plan garde ses boîtes et ses sites
  et reçoit un élément `teams:` qui échoue (`teams_unlisted`), visible dans Activités.
- **Sources et accueil.** Le catalogue tire les équipes sauvegardées du même recensement du
  stockage que les sites (workload `teams`, même cache) ; une équipe dont l'index est illisible
  reste listée sans point de restauration (« En échec ») et ne rend pas les sites indisponibles ; une ligne de service « Teams (équipes et
  canaux) » et une ligne par équipe dans « Sauvegardes ». `teams` entre dans les charges suivies
  par défaut (`BACKUP365_STATUS_WORKLOADS`), donc dans la ligne « Microsoft 365 connecté · … » de
  l'accueil. Aucune carte nouvelle.
- **Restaurer, onglet « Teams » (`#/teams`).** Trois étapes communes (ADR 0016) : équipe, canal et
  date ; motif ; récapitulatif. La seule destination est l'**export** : `POST
/api/teams/:teamId/export` construit l'archive du canal en mémoire (plafond 512 Mio, sinon 413
  `export_too_large` ; deux exports à la fois au plus, sinon 429 `export_busy`), inscrit `item.export` au journal avec le motif, puis l'envoie. La liste des
  canaux (`GET /api/teams/:teamId/snapshots`) est consignée en `list.view` (`teams.channels`).
  Contrairement aux autres restaurations, l'export fonctionne hors démo : il ne passe pas par
  Graph.
- **Non construit**, faute d'API : « Remettre dans le canal d'origine » et le contenu
  « Fichiers ». L'écran le dit (la destination et l'aide de l'étape 1 renvoient vers l'onglet
  « Sites SharePoint » pour les fichiers).
- **Démo.** Deux équipes fictives (l'une à jour, l'autre en retard) et un plan « Teams,
  quotidien » ; l'export rend un zip d'un seul fichier explicatif.

## Conséquences

- La boîte « Connexion sans accès Teams » de la maquette n'est pas construite : la console ne lit
  pas les autorisations accordées. Un refus Graph fait échouer l'exécution du plan, visible dans
  Activités et sur la page Sources.
- L'archive est gardée en mémoire le temps de l'envoi : un canal de plusieurs centaines de Mio
  pèse sur le serveur. Un envoi en flux suppose d'écrire l'audit avant de connaître le résultat.

## Non vérifié

Aucun appel réel au SDK : `teams.backup` et `teams.save` sur un tenant de TEST (autorisations,
contenu de l'archive, durée d'une première sauvegarde d'équipe) restent à faire.
