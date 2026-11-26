# ADR 0021 : l'agenda, une charge des plans de protection

Statut : **proposé** (issue #544)

## Contexte

Le SDK 7.2.0 (ADR 0019) gère l'agenda à part de la messagerie : `calendar.backup(mailbox)`,
`calendar.listSnapshots(mailbox)` et `calendar.restore(mailbox, { snapshotId, targetMailboxId })`.
L'issue #544 demande, comme #543 pour les contacts, de sauvegarder l'agenda par les plans, puis
de le parcourir par date et d'en restaurer un ou plusieurs événements dans l'agenda d'origine,
sans envoyer d'invitation.

Vérifié dans le SDK 7.2.0 (`dist/index.d.mts` et `dist/index.mjs`) :

- `outlook.backup` ne lit que `/mailFolders` : la messagerie ne copie pas l'agenda. L'aide
  « avec le calendrier » sous « Messagerie » (ADR 0011, ADR 0020) était donc fausse ;
- `CalendarRestoreOptions` n'a que `snapshot_id` et `target_mailbox_id`, et
  `CalendarRestoreService.run_restore` passe `manifest.entries` en entier à la boucle de
  restauration : on ne peut pas restaurer un événement choisi, seulement tout l'agenda d'une date ;
- un événement déjà présent (même `iCalUId`, ou restauré plus tôt depuis la même source) est
  ignoré (`events_skipped`) : rien n'est remplacé, mais rien n'est doublé non plus, à l'inverse
  de ce que suppose la maquette (« un événement encore présent sera en double ») ;
- un événement restauré ne porte aucun participant (leur liste est écrite dans le corps) : aucune
  invitation n'est envoyée. Une série est restaurée en entier (`seriesMaster` avec ses exceptions) ;
- le manifeste donne, par événement, l'agenda (`calendar_id`, nom dans `calendars`), le type
  (`singleInstance` ou `seriesMaster`), le titre (`subject`) et le début (`start_at`) : une liste
  par date est possible, mais pas la fin ni la sensibilité (« Privé ») sans lire l'objet chiffré,
  et aucune méthode publique ne lit un événement sauvegardé.

## Décision

- **Plans.** `DATA_TYPES` devient `mail`, `contacts`, `calendar`, `onedrive`, `sharepoint`. La case
  « Agenda » suit « Contacts », avec l'aide « Copie les événements des agendas des boîtes
  couvertes par ce plan. » ; l'aide « avec le calendrier » de « Messagerie » est retirée.
- **Défaut.** `DEFAULT_DATA_TYPES` exclut l'agenda, comme les contacts : un nouveau plan et un plan
  créé par l'API sans `dataTypes` ne le sauvegardent pas tant qu'il n'est pas coché. Aucune
  migration : la migration 5 a déjà retiré l'ancienne valeur `calendar`, donc aucun plan existant
  ne se met à sauvegarder l'agenda.
- **Exécution.** Pour une boîte, l'exécuteur (ADR 0009) appelle `calendar.backup(boîte)` après
  `contacts.backup` et avant `onedrive.backup`, seulement si le plan protège l'agenda. Le résultat
  se lit comme OneDrive (`healthy`, `noSnapshotReason`, taille du `snapshot`) ; un agenda dont des
  pièces jointes n'ont pas pu être copiées rend `healthy` faux, donc l'exécution est en échec.
- **Parcours de restauration : non construit.** Le parcours de la maquette (choisir un ou
  plusieurs événements) ne peut pas s'appuyer sur le SDK 7.2.0. Une demande amont est rédigée
  (`docs/upstream/restauration-selective-de-l-agenda.md`).

## Conséquences

- La page « Sources », l'accueil et le rapport d'état ne montrent pas encore l'agenda.
- Décision produit attendue pour la restauration : attendre le filtre amont, ou proposer la
  restauration de tout l'agenda d'une date dans la boîte d'origine (sans doublon ni invitation,
  mais l'opérateur ne choisit plus ce qui revient).

## Non vérifié

Aucun appel réel au SDK : `calendar.backup` sur un tenant de TEST (droit Graph `Calendars.Read`,
contenu de l'instantané, `noSnapshotReason` d'une boîte sans événement) reste à faire.
