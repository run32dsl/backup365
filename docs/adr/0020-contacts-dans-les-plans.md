# ADR 0020 : les contacts, une charge des plans de protection

Statut : **proposé** (issue #543)

## Contexte

Le SDK 7.2.0 (ADR 0019) gère les contacts à part de la messagerie : `contacts.backup(mailbox)`,
`contacts.listSnapshots(mailbox)` et `contacts.restore(mailbox, { snapshotId, targetMailboxId })`.
L'issue #543 demande de sauvegarder les contacts par les plans, puis de les parcourir et d'en
restaurer un ou plusieurs, comme un mail.

Vérifié dans le SDK 7.2.0 (`dist/index.d.mts` et `dist/index.mjs`) :

- `ContactsRestoreOptions` n'a que `snapshot_id` et `target_mailbox_id`, et
  `ContactsRestoreService.run_restore` restaure toutes les entrées du manifeste : on ne peut pas
  restaurer un contact choisi, seulement tout le carnet d'une date ;
- un contact déjà présent dans le dossier cible est ignoré (`contacts_skipped`), jamais doublé ni
  écrasé ;
- le manifeste ne donne que le nom affiché (`display_name`) : ni adresse électronique ni
  organisation, et aucune méthode ne lit un contact sauvegardé.

## Décision

- **Plans.** `DATA_TYPES` devient `mail`, `contacts`, `onedrive`, `sharepoint` (contacts juste
  après la messagerie). La case « Contacts » de l'assistant a pour aide « Copie les contacts des
  boîtes couvertes par ce plan. » ; celle de « Messagerie » dit désormais « avec le calendrier ».
- **Défaut.** `DEFAULT_DATA_TYPES` exclut les contacts : un nouveau plan et un plan créé par l'API
  sans `dataTypes` ne les sauvegardent pas tant qu'ils ne sont pas cochés. Aucune migration : les
  plans existants gardent leur liste.
- **Exécution.** Pour une boîte, l'exécuteur (ADR 0009) appelle `contacts.backup(boîte)` entre
  `outlook.backup` et `onedrive.backup`, seulement si le plan protège les contacts. Le résultat se
  lit comme OneDrive (`healthy`, `noSnapshotReason`, taille du `snapshot`). « Toute
  l'organisation » liste les boîtes dès qu'une charge autre que SharePoint est choisie.
- **Restauration : non construite.** Le parcours de la maquette (choisir un ou plusieurs contacts)
  ne peut pas s'appuyer sur le SDK 7.2.0. Une demande amont est rédigée
  (`docs/upstream/restauration-selective-des-contacts.md`).

## Conséquences

- La page « Sources », l'accueil et le rapport d'état ne montrent pas encore les contacts : une
  ligne de contacts (si `BACKUP365_STATUS_WORKLOADS` les liste) reste rattachée à la messagerie.
- Décision produit attendue pour la restauration : attendre le filtre amont, ou proposer la
  restauration de tout le carnet d'une date (hors périmètre de la maquette de #543).

## Non vérifié

Aucun appel réel au SDK : `contacts.backup` sur un tenant de TEST (droit Graph `Contacts.Read`,
contenu de l'instantané, `noSnapshotReason` d'une boîte sans contact) reste à faire.
