# Brouillon de demande amont : restaurer des contacts choisis

Destination : dépôt d'Atlas (`wisecom-oy/atlas`). **Non publié** : à publier par le Product Manager.

## Titre

SDK contacts : restaurer une partie d'un instantané et lire les champs d'un contact

## Contexte

Nous intégrons `@wisecom/atlas-sdk` 7.2.0 dans une console web de sauvegarde Microsoft 365. Nos
utilisateurs veulent retrouver un contact supprimé par erreur et le remettre seul dans sa boîte,
comme ils le font déjà pour un mail (`outlook.restore` avec `messageRef`). Dans 7.2.0 (vérifié,
ADR 0020) :

- `contacts.restore(mailbox, { snapshotId, targetMailboxId })` restaure **tout** l'instantané :
  `ContactsRestoreOptions` n'a pas de filtre, et `ContactsRestoreService.run_restore` passe
  `manifest.entries` en entier à la boucle de restauration ;
- le manifeste (`ContactManifestEntry`) ne porte que `display_name`, sans adresse électronique
  ni organisation, et `ContactsApi` n'a aucune méthode pour lire un contact sauvegardé.

## Demande

1. Une option de restauration qui limite l'opération à une liste de contacts de l'instantané,
   par exemple `contactIds: readonly string[]` (identifiants `contact_id` du manifeste). Les
   dossiers à créer se limiteraient à ceux de ces contacts.
2. Une lecture sans Graph des champs d'identification d'un contact (adresse électronique
   principale, organisation), soit dans le manifeste, soit par une méthode du type
   `contacts.readContact(mailbox, snapshotId, contactId)`, pour distinguer deux homonymes avant
   de restaurer.

## Comportement attendu

Sans la nouvelle option, comportement actuel inchangé (tout l'instantané). Avec elle, seuls les
contacts listés sont restaurés, avec la même règle sans écrasement (`contactsSkipped` pour un
contact déjà présent) ; un identifiant absent de l'instantané apparaît dans `errors`.

## Alternative étudiée

Restaurer tout l'instantané dans la boîte d'origine : sans écrasement, les contacts présents sont
ignorés et seuls les absents reviennent. Mais l'opérateur ne choisit plus ce qui revient (tous les
contacts supprimés depuis la date choisie réapparaissent), ce qui ne répond pas à la demande.
