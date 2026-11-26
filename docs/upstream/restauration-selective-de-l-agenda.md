# Brouillon de demande amont : restaurer des événements choisis

Destination : dépôt d'Atlas (`wisecom-oy/atlas`). **Non publié** : à publier par le Product Manager.

## Titre

SDK calendar : restaurer une partie d'un instantané

## Contexte

Nous intégrons `@wisecom/atlas-sdk` 7.2.0 dans une console web de sauvegarde Microsoft 365. Nos
utilisateurs veulent retrouver une réunion supprimée par erreur et la remettre seule dans
l'agenda d'origine, comme ils le font déjà pour un mail (`outlook.restore` avec `messageRef`).
Dans 7.2.0 (vérifié, ADR 0021 de backup365) :

- `calendar.restore(mailbox, { snapshotId, targetMailboxId })` restaure **tout** l'instantané :
  `CalendarRestoreOptions` n'a pas de filtre, et `CalendarRestoreService.run_restore` passe
  `manifest.entries` en entier à la boucle de restauration ;
- le manifeste (`CalendarEventEntry`) porte le titre et le début, mais ni la fin, ni la
  sensibilité (`private`), ni le fait qu'un événement dure toute la journée.

## Demande

1. Une option de restauration qui limite l'opération à une liste d'événements de l'instantané,
   par exemple `eventIds: readonly string[]` (identifiants `event_id` du manifeste ; un
   `seriesMaster` restaure toute la série). Les agendas à créer se limiteraient à ceux de ces
   événements.
2. Dans `CalendarEventEntry`, les champs `end_at`, `is_all_day` et `sensitivity`, pour afficher
   une liste par jour sans lire chaque objet chiffré et masquer le titre d'un événement privé.

## Comportement attendu

Sans la nouvelle option, comportement actuel inchangé (tout l'instantané). Avec elle, seuls les
événements listés sont restaurés, avec les mêmes règles : sans écrasement ni doublon
(`eventsSkipped` pour un événement déjà présent) et sans participant, donc sans invitation ; un
identifiant absent de l'instantané apparaît dans `errors`.

## Alternative étudiée

Restaurer tout l'instantané dans la boîte d'origine : les événements présents sont ignorés et
seuls les absents reviennent. Mais l'opérateur ne choisit plus ce qui revient (tous les
événements supprimés depuis la date choisie réapparaissent), ce qui ne répond pas à la demande.
