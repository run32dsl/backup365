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
