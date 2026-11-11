# Règles de développement de backup365

Projet public : tout ce qui est commité est public et permanent. Jamais de secret, de donnée de
tenant (UPN, domaine, ID, noms de fichiers réels), de donnée personnelle ni de chemin personnel.

## Contexte

Console web de sauvegarde Microsoft 365 construite sur le SDK d'Atlas (`@wisecom/atlas-sdk`,
version figée). Lire `docs/vision.md` (principes non négociables) et `docs/adr/` (décisions).

## Branches et fusion

- `develop` : intégration. Les agents ouvrent leurs PR **vers `develop`**.
- Une PR vers `develop` est fusionnée automatiquement (squash) **uniquement si** : CI verte,
  revue automatique au verdict « Prêt », critères d'acceptation de l'issue cochés dans la PR.
- `main` : version acceptée. Promotion `develop` → `main` par le Product Manager, chaque semaine.
- Interdits : push direct sur `develop` ou `main`, `--force`, modifier `LICENSE`, ajouter une
  dépendance sans l'expliquer dans la PR (et dans un ADR si elle structure le projet).

## Travail d'une issue

1. Une issue = une branche `feat/<n>-<sujet>` ou `fix/<n>-<sujet>` depuis `origin/develop`.
2. Relire les critères d'acceptation ; si l'un est ambigu, choisir l'interprétation la plus
   simple et l'écrire dans la PR.
3. Tests en même temps que le code ; aucun appel réseau dans les tests unitaires.
4. Documentation à jour dans la même PR.
5. Critère de fin : `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run test`
   (commandes définies par l'ADR 0001 une fois le socle en place).
6. Description de PR : Résumé, Changements, Critères d'acceptation (cochés avec preuve),
   Non vérifié. Termine par `Closes #<n>`.

## Décisions

Une décision d'architecture = un fichier `docs/adr/NNNN-titre.md` (contexte, décision,
conséquences, statut : proposé / accepté). Le Product Manager accepte ou refuse lors de la
revue hebdomadaire ; en attendant, « proposé » suffit pour avancer.

## Sécurité et RGPD (le produit manipule des données personnelles)

- Aucune donnée sauvegardée n'est envoyée hors du stockage de l'utilisateur ; aucune télémétrie.
- Toute lecture ou export d'un élément sauvegardé passe par le journal d'audit.
- Secrets uniquement par variables d'environnement ou fichiers montés ; jamais dans les logs.
- Entrées utilisateur validées côté serveur ; pas de SQL concaténé ; en-têtes de sécurité HTTP.
