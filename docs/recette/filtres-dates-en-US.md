# Recette des filtres de date avec un navigateur en en-US

Issue #237, suite de la PR #236 (champs texte jj/mm/aaaa en UTC). Objectif : vérifier sur des
images que le rendu des filtres ne dépend pas de la langue du navigateur.

## Commande lancée

Base : `develop` au commit `805d0b1` (inclut #236). Le script lit `BACKUP365_LANG` ou
`--lang=` ; la forme avec l'option a été utilisée, elle est équivalente (`e2e/browser.mjs`,
`requestedLang`).

```
pnpm run captures --lang=en-US
```

## Sortie

```
118 captures, navigateur en en-US
captures : durée 151 s pour 118 images (seuil d'alerte : 300 s)
```

La commande s'est terminée en succès, build des trois paquets compris.

## Constat par capture

Chaque image a été regardée avec l'outil de lecture d'images. Pour toutes : libellés « Du (UTC) » et
« Au (UTC) », aide « jj/mm/aaaa », dates du tableau en
jj/mm/aaaa hh:mm (24 h). Aucun « mm/dd/yyyy », « yyyy », « --:-- » ni AM/PM.

| Capture                       | 1280 px | 390 px | Constat                                                                               |
| ----------------------------- | ------- | ------ | ------------------------------------------------------------------------------------- |
| `recherche`                   | vue     | vue    | conforme                                                                              |
| `recherche-date-invalide`     | vue     | vue    | conforme ; erreur « Date attendue au format jj/mm/aaaa », champ « Du (UTC) » en rouge |
| `journal-audit`               | vue     | vue    | conforme                                                                              |
| `journal-audit-date-invalide` | vue     | vue    | conforme ; même message d'erreur                                                      |

## Conclusion

Aucun écart constaté : le contenu des huit images correspond à ce que l'issue attend. Le test
`e2e/langue.spec.ts` compare déjà, au pixel près, le formulaire en fr-FR et en en-US ; il
complète ce constat visuel, mais il n'a pas été relancé ici. Les captures fr-FR n'ont pas non
plus été relancées.

L'option (b) de l'issue (ajouter aux captures un passage automatique en en-US à chaque PR)
n'est donc pas retenue, et aucune issue de correction n'est ouverte.
