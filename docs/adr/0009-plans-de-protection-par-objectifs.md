# ADR 0009 : plans de protection par objectifs

Statut : **proposé** (issue #60, première étape de #49)

L'issue demandait « ADR 0008 », mais ce numéro est déjà pris par les comptes locaux et sessions :
cet ADR prend le suivant, 0009.

## Contexte

L'utilisateur ne veut pas régler des planifications : il veut un objectif (« je peux perdre au
plus 4 h de mails ») et la console s'en occupe. Cet ADR fixe le modèle et les calculs purs ; le
planificateur, l'API et l'écran viennent dans les issues suivantes de #49. Une seule configuration
de tenant par console.

## Décision

### Modèle

- Base distincte `plans.sqlite` (migrations `PLAN_MIGRATIONS`) : les plans et leur historique ne se
  reconstruisent pas depuis le catalogue.
- `plans` : nom (unique, sans tenir compte de la casse), périmètre `all` ou `selection`, RPO en
  heures (4, 12 ou 24 ; 24 par défaut), RTO cible indicatif (heures, facultatif, jamais mesuré ni
  garanti), durée de conservation en jours, justification RGPD **obligatoire**. `plan_items` porte
  la sélection. Les contraintes sont aussi dans la base (`CHECK`), pas seulement dans le code.
- `plan_runs` : plan, élément, début, fin, statut (`running`, `success`, `failed`), durée, erreur.
  L'erreur est un code ou un message technique de 200 caractères au plus : jamais un contenu de
  mail, un objet, un expéditeur ni un secret.
- Validation côté serveur par `parseProtectionPlanInput` (`packages/core`) ; ses messages ne
  reprennent pas la valeur reçue.

### Fréquence

- Intervalle = RPO / 2 : 120, 360 ou 720 minutes. Ainsi, un échec isolé laisse encore une
  seconde tentative avant l'échéance du RPO.
- Créneaux = `décalage + k × intervalle` depuis l'époque Unix (UTC), à la minute. Le décalage est
  `FNV-1a(identifiant du plan) mod intervalle` : déterministe, identique d'un appel et d'un
  redémarrage à l'autre, sans état, et il étale les plans au lieu de les lancer tous à minuit.
- `nextRunAt(plan, après)` renvoie le premier créneau strictement postérieur.

### Conformité

- Conforme : la dernière exécution réussie a fini depuis **moins** que le RPO.
- Sinon « en échec » si l'exécution la plus récente a échoué, « en retard » dans les autres cas, y
  compris sans aucune exécution (rien n'est protégé tant qu'une première sauvegarde n'a pas réussi).
- Une exécution en cours ne rend pas conforme.

### Reprise après redémarrage

Rien n'est tenu en mémoire : le prochain créneau se déduit de l'horloge et de l'identifiant du
plan, l'état se déduit de `plan_runs`. Au démarrage, le planificateur (issue suivante) passe
en `failed` (erreur `interrupted`) les exécutions restées `running`, puis lance **une seule**
exécution par plan dont le dernier créneau n'a pas d'exécution, sans rattraper chaque créneau
manqué.

### API `/api/plans` (issue #61)

Réservée aux administrateurs : sans session 401, rôle autre qu'administrateur 403, base des plans
ou journal d'audit indisponible 503. Les écritures exigent le jeton CSRF comme le reste de l'API.

| Route                   | Effet                                                     | Réponses           |
| ----------------------- | --------------------------------------------------------- | ------------------ |
| `GET /api/plans`        | `{ items }` : les plans, triés par nom                    | 200                |
| `POST /api/plans`       | crée un plan (corps = `ProtectionPlanInput`)              | 201, 400, 409      |
| `PUT /api/plans/:id`    | remplace le plan en entier (mêmes règles que la création) | 200, 400, 404, 409 |
| `DELETE /api/plans/:id` | supprime le plan, sa sélection et son historique          | 204, 404           |

- Un plan : `id` (UUID), `name`, `scope`, `selection`, `rpoHours`, `rtoHours`, `retentionDays`,
  `gdprJustification`, `createdAt`.
- 400 : `{ error: 'invalid_plan', message, errors }`, `errors` listant chaque règle violée (RPO hors
  de 4, 12, 24 ; justification absente ; périmètre ou sélection incohérents ; etc.), sans reprendre
  la valeur reçue. 409 : `plan_name_taken` (nom déjà pris, casse ignorée).
- Audit : `plan.create`, `plan.update`, `plan.delete` (ressource `plan`, cible = identifiant du
  plan). Le motif ne porte que des codes (`scope:all,rpo:4`, `changed:rpoHours,name`), jamais le nom
  ni la justification.
- La suppression d'un plan emporte son historique d'exécutions (cascade) ; la purge n'est donc pas
  rejouable : l'écran de l'issue suivante devra demander une confirmation.

### Planificateur, historique et lancement manuel (issue #62)

- `PlanScheduler` (`apps/server`) démarre avec le serveur (hook `onReady`) : une minuterie de 30 s,
  l'état en base. L'`Executeur` est injecté ; `executeurSimule` réussit aussitôt (mode démo seulement
  depuis l'issue #63, voir plus bas). Les éléments d'un plan sont sa sélection, ou toutes les boîtes du catalogue
  si le périmètre est `all`.
- À chaque passage, pour chaque plan et chaque élément : si aucune exécution (quel qu'en soit le
  statut) n'a débuté depuis le dernier créneau, une exécution est lancée. Un échec n'est donc pas
  relancé avant le créneau suivant. Les éléments passent l'un après l'autre, et les décalages des
  plans étalent le reste.
- Au démarrage, les exécutions restées `running` passent en `failed` (erreur `interrupted`) ; le
  dernier créneau compte alors comme déjà tenté pour cet élément, la suivante est au créneau suivant.
- Jamais deux exécutions à la fois sur un élément, tous plans confondus : index unique partiel
  `plan_runs (item_id) WHERE status = 'running'` (migration 2), valable aussi entre processus.
- `error` ne reçoit que le `code` ou le nom de l'erreur de l'exécuteur, jamais son message. Les
  journaux du planificateur ne portent que des identifiants de plan, d'élément et d'exécution, et des codes.

| Route                     | Effet                                                                             | Réponses                |
| ------------------------- | --------------------------------------------------------------------------------- | ----------------------- |
| `GET /api/plans/:id/runs` | `{ items }` : 200 exécutions au plus, de la plus récente à la plus ancienne       | 200, 404                |
| `POST /api/plans/:id/run` | lance tous les éléments du plan ; corps `{ reason }` obligatoire (200 caractères) | 202, 400, 404, 409, 503 |

- Mêmes règles d'accès que les autres routes des plans (administrateur ; 401, 403, 503).
- `202 { started, skipped }` : les exécutions sont ouvertes avant la réponse et se poursuivent en
  arrière-plan ; `skipped` compte les éléments déjà en cours. 409 `run_in_progress` si tous le
  sont, `no_items` si le plan ne couvre rien ; 400 `reason_required` sans motif.
- Audit : `plan.run` (ressource `plan`, cible = identifiant du plan, motif = le motif saisi), consigné
  avant le lancement. Le motif est du texte libre : il ne doit pas contenir de contenu de mail.

### Exécution réelle via le SDK (issue #63)

- `AtlasExecuteur` (`apps/server/src/atlas-executeur.ts`) implémente `Executeur`. Il utilise une
  **seconde instance du SDK**, avec les identifiants Graph réels ; l'instance du catalogue reste
  en lecture seule, avec ses valeurs factices (ADR 0002). Elle est libérée à l'arrêt.
- Un élément du plan est un propriétaire (boîte) ou un site SharePoint déjà connu du catalogue :
  un site → `sharepoint.backup` ; sinon `outlook.backup` puis `onedrive.backup`, les deux tentées
  même si la première échoue (la première erreur est relancée).
- Première exécution complète, suivantes incrémentales : c'est le choix du SDK, `forceFull` n'est
  jamais passé. Une exécution interrompue (`interrupted`) ou dont le résumé signale des erreurs
  (`backup_errors`) est un échec ; sinon `error` reçoit le code d'erreur du SDK, jamais son message.
  `sharepoint.backup` rend un résultat par site, racine en tête : une liste vide est un échec
  (`no_result`), pas un succès. Un OneDrive ou un site sans contenu (`noSnapshotReason:
'no_content'` dans le résumé du SDK) n'est pas distingué : l'exécution est notée en succès alors
  qu'aucun point de restauration n'existe. C'est un choix du PO (2026-11-16) : un succès, car il n'y
  avait rien à protéger, et le noter en échec ferait échouer chaque utilisateur sans fichier
  OneDrive. Choix réversible. Le motif est désormais enregistré (issue #80) : `plan_runs` a une
  colonne `no_snapshot_reason` (`no_content` ou vide, migration 4), exposée par
  `GET /api/plans/:id/runs` et par `lastRun` de `GET /api/plans`. Le statut reste `success` ; un
  site est `no_content` si tous ses résultats le sont. Pour un propriétaire (boîte + OneDrive), la
  messagerie ne rend pas de motif et compte comme ayant un point de restauration : l'exécution
  n'est `no_content` que si chaque charge l'est. `compliance.lastRestorePointAt` de
  `GET /api/plans` est la fin de la dernière réussite qui a créé un point, lue par le magasin sur
  tout l'historique ; ce champ est propre à cette route, le type `Compliance` du core (partagé
  avec le tableau de bord) ne change pas. `lastSuccessAt` (qui fonde la conformité) compte
  toujours une réussite vide. L'écran des plans écrit « Réussie (rien à sauvegarder) » et,
  si aucune réussite n'a créé de point, « Conforme : rien à sauvegarder ».
- Identifiants : `BACKUP365_M365_CLIENT_ID` et `BACKUP365_M365_CLIENT_SECRET` (variante
  `_FILE`). Un seul des deux : démarrage refusé, l'erreur nomme la variable. Aucun : « sauvegarde
  non configurée » ; hors démo, aucun planificateur n'est créé, donc aucune exécution ni ligne de
  `plan_runs`. `GET /api/plans/execution` (administrateur) répond `{ configured: true, retention: 'not_enforced' }`
  ou `{ configured: false, label: 'sauvegarde non configurée', retention: 'not_enforced' }` ; `POST /api/plans/:id/run` répond
  503 `backup_not_configured`. Le mode démo garde l'exécuteur simulé.
- Statut, début, fin et durée de chaque exécution sont ceux de `plan_runs` (issue #62).
- **Limite** : avec le périmètre `all`, les éléments viennent du catalogue (boîtes déjà
  sauvegardées) ; une première sauvegarde d'un propriétaire inconnu du catalogue passe par une
  sélection. La découverte des boîtes du tenant (`outlook.listAvailableMailboxes`) n'est pas faite.
  De même, un site SharePoint jamais sauvegardé (ou absent du cache du catalogue) est traité comme
  une boîte et l'exécution échoue avec un code du SDK.
- **Conservation non appliquée** : le SDK 6.2.0 n'a pas de purge par âge (seulement
  `deleteSnapshot` à l'unité, et `objectLockRequest` qui protège contre la suppression sans
  jamais supprimer). La durée du plan reste saisie, avec sa justification RGPD, car c'est un
  objectif fixé par l'utilisateur ; elle n'est jamais présentée comme appliquée (l'API d'exécution
  expose `retention: 'not_enforced'`). Rien n'est supprimé. Le choix entre purge via
  `deleteSnapshot`, Object Lock, les deux ou rien est reporté dans #79 (critère de #63 reporté par
  décision PO du 2026-11-16).

### Sécurité des identifiants

Les identifiants Graph et les secrets viennent des variables d'environnement ou de fichiers montés
(ADR 0001, 0007). Ils ne sont ni dans `plans.sqlite`, ni dans les journaux, ni dans `error`.
Les journaux ne contiennent aucun contenu de mail.

## Conséquences

- Aucune dépendance nouvelle.
- Changer le RPO d'un plan recalcule son décalage (il dépend de l'intervalle) : ses créneaux changent.
- Un plan nouveau est « en retard » jusqu'à sa première réussite ; l'écran devra le formuler
  (« pas encore sauvegardé »).
- Les durées de conservation sont stockées ici ; leur application (purge) relève d'une autre issue.
