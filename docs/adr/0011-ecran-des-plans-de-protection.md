# ADR 0011 : écran des plans de protection

Statut : **proposé** (issue #50, interface de #49)

## Contexte

La maquette de l'écran des plans (`#/plans`) demande des choses que l'API de l'ADR 0009 ne portait
pas : choisir les types de données protégés (messagerie, fichiers, calendriers, contacts), afficher
dans la liste la conformité et la dernière exécution, et laisser un opérateur lire la liste.

## Décision

- **Types de données.** Un plan porte `dataTypes`, sous-ensemble non vide de `mail`, `files`,
  `calendar`, `contacts` (colonne `data_types`, migration 3, défaut « tout » pour les plans
  existants). C'est la vue de l'utilisateur, distincte des charges du catalogue (`WORKLOADS`) ; le
  planificateur n'en tient pas encore compte (exécuteur simulé).
- **Liste.** `GET /api/plans` ajoute à chaque plan `compliance` (`planCompliance`, ADR 0009),
  `running` et `lastRun` (statut et dates, jamais l'erreur). La conformité se calcule sur le serveur,
  à l'heure du serveur.
- **Lecture seule.** `GET /api/plans` est la seule route ouverte à l'opérateur ; création,
  modification, suppression, historique et lancement restent réservés aux administrateurs. Pour
  l'opérateur, la liste omet la sélection, la justification et le RTO.
- **Justification.** Le texte enregistré est le motif choisi (« Obligation légale », « Besoin
  métier », « Intérêt public », « Autre ») suivi de la précision : aucun champ de plus.
- **Choix proposés.** Perte de données 4, 12 ou 24 h ; remise en service 8, 24 ou 72 h ; conservation 6 mois, 1 an ou 3 ans (ordre croissant, sans les sigles RPO ni RTO à l'écran).
  Défauts : 12 h, 24 h, 1 an, tout protégé, toute l'organisation.
- **Non configuré.** L'écran le déduit de `GET /api/mailboxes` (503 `catalog_unavailable`). Il n'existe
  pas encore d'écran de configuration : « Configurer la sauvegarde » renvoie au tableau de bord.
- **Blocages de l'assistant (#240).** Aucun bouton n'est désactivé : au clic, chaque raison
  s'affiche à côté de son champ (`aria-invalid`, `aria-describedby`), un bandeau court donne le
  nombre de points, le focus va sur le premier champ en erreur et l'écran défile jusqu'à lui. Une
  saisie n'efface que l'erreur de son champ (`errorsAfterChange`), le bandeau suit le compte. Un nom
  déjà utilisé (comparé comme le serveur : sans espaces autour ni différence de casse) est refusé dès
  l'étape 1 ; s'il est refusé à l'envoi (409), l'assistant revient à l'étape 1. Un autre échec
  d'envoi s'affiche au-dessus des boutons de l'étape 3 et prend le focus, saisies conservées. Après
  la création, la confirmation de la liste reçoit le focus.
- Ancres : `#/plans`, `#/plans/nouveau`, `#/plans/<id>/modifier`.

## Conséquences

- Aucune dépendance nouvelle.
- Une base des plans en version 3 est refusée par un programme plus ancien (démarrage en échec,
  comme pour toute migration).
- Le calcul de la conformité à chaque lecture lit jusqu'à 200 exécutions par plan : suffisant pour
  quelques dizaines de plans ; à revoir au-delà.
