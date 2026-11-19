# Modèle du bilan hebdomadaire du Product Owner

Le bilan est rédigé chaque semaine par le Product Owner, avant la promotion `develop` → `main`.
Les rubriques ci-dessous sont fixes ; une rubrique sans objet l'écrit explicitement.

Semaine du : `<lundi> au <dimanche>` (bilan précédent : `<lien>`, utile au test de répétition).

## Durées de la CI

Procédure et seuils : `CONTRIBUTING.md`, section « Durées de la CI ». Seuils : 10 min pour le
job `ci`, 5 min (300 s) pour `captures`, sous le timeout de 15 min. Pour `captures`, la durée de l'étape dans le job `ci` prime ; celle des
`verifs` (mesurée sur l'hôte) est notée à part si elle est plus longue.

| Mesure                                   | Source                                   | Valeur | Seuil  |
| ---------------------------------------- | ---------------------------------------- | ------ | ------ |
| Durée médiane du job `ci` sur `develop`  | interface Actions, semaine écoulée       |        | -      |
| Durée maximale du job `ci` sur `develop` | interface Actions, semaine écoulée       |        | 10 min |
| Durée maximale de `captures`             | résumés de run et `.review/verifs-*.txt` |        | 300 s  |

- **Dépassement** : si le maximum du job `ci` dépasse 10 min, ou si `captures` dépasse 300 s,
  le bilan renvoie vers une issue ouverte le jour même (`#<n>`). Sinon : « aucun dépassement ».
- **Répétition** : si un dépassement se répète deux semaines de suite, le bilan propose au PM,
  dans une issue « [PM] », l'ouverture automatique d'une issue par un workflow (permission
  `issues: write`). Sinon : « pas de répétition ».
