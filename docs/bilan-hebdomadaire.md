# Modèle du bilan hebdomadaire du Product Owner

Le bilan est rédigé chaque semaine par le Product Owner, avant la promotion `develop` → `main`.
Les rubriques ci-dessous sont fixes ; une rubrique sans objet l'écrit explicitement.

Semaine du : `<lundi> au <dimanche>` (bilan précédent : `<lien>`, utile au test de répétition).

## Durées de la CI

Procédure et seuils : `CONTRIBUTING.md`, section « Durées de la CI ». Seuils : 10 min pour le
job `ci`, 5 min (300 s) pour `captures`, sous le timeout de 15 min. Règle de source : pour `ci`, la durée du
job dans GitHub Actions ; pour `captures`, la durée des `verifs` (mesurée sur l'hôte, construction
comprise), complétée par celle des résumés de run ; en cas d'écart, la valeur la plus défavorable.
Le bilan écrit sous le tableau le nombre de runs `ci` pris en compte (médiane et maximum).

| Mesure                                   | Source                                 | Valeur | Seuil  |
| ---------------------------------------- | -------------------------------------- | ------ | ------ |
| Durée médiane du job `ci` sur `develop`  | interface Actions, semaine écoulée     |        | -      |
| Durée maximale du job `ci` sur `develop` | interface Actions, semaine écoulée     |        | 10 min |
| Durée maximale de `captures`             | `.review/verifs-*.txt`, résumés de run |        | 300 s  |

- **Dépassement** : si le maximum du job `ci` dépasse 10 min, ou si `captures` dépasse 300 s,
  le bilan renvoie vers une issue ouverte le jour même (`#<n>`). Sinon : « aucun dépassement ».
- **Répétition** : si un dépassement se répète deux semaines de suite, le bilan propose au PM,
  dans une issue « [PM] », l'ouverture automatique d'une issue par un workflow (permission
  `issues: write`). Sinon : « pas de répétition ».
