# ADR 0020 : plans « toute l'organisation », nouveaux comptes et sites compris

Statut : **proposé** (issue #545)

## Contexte

Un administrateur ne doit pas ajouter chaque nouvel arrivant à un plan. Jusqu'ici, le périmètre
`all` prenait ses éléments dans le catalogue des sauvegardes (ADR 0009, « Limite ») : un compte
jamais sauvegardé n'entrait donc jamais dans un plan. Décision du PM délégué (#471) : à l'étape 1
de l'assistant, on choisit les charges, puis pour chacune « tout » (par défaut) ou une sélection.

## Décision

- **Périmètre par charge.** Un plan porte `selectionTypes`, les charges limitées à la sélection
  (colonne `plans.selection_types`, migration 6). Les autres charges choisies couvrent toute
  l'organisation. `scope` reste et vaut `selection` dès qu'une charge est limitée ; sans
  `selectionTypes` (anciens clients de l'API), toutes les charges suivent `scope`. La migration
  garde chaque plan en sélection limité sur toutes ses charges. `chargeScope` (core) est la seule
  règle de lecture : planificateur, page Sources, conformité et écran des plans s'en servent.
- **Découverte à chaque exécution.** Pour une charge « toute l'organisation », le planificateur
  liste le tenant avec l'instance de sauvegarde du SDK (identifiants Graph réels, ADR 0009) :
  `outlook.listAvailableMailboxes()` pour la messagerie et OneDrive, `sharepoint.listSites()`
  pour SharePoint. Même règle que la sauvegarde du tenant du SDK : une boîte se sauvegarde si elle
  a une licence Exchange ou si c'est une boîte partagée ; une boîte partagée n'a que sa messagerie
  sauvegardée (pas de OneDrive) ; les conteneurs de fichiers (`file_storage_container`) ne sont pas
  des sites. L'élément découvert porte sa nature (boîte ou site) : un site jamais sauvegardé n'est
  plus traité comme une boîte. La liste est faite une fois par créneau ; un compte créé en cours de
  créneau est pris au suivant.
- **Repli.** Si l'annuaire ne répond pas, le catalogue le remplace pour ce passage (comme avant)
  et le journal du serveur ne garde que le code d'erreur. Le créneau n'est alors pas tenu pour
  traité : l'annuaire est réinterrogé au passage suivant (30 s), et un compte nouveau est pris dès
  son retour. En démo, il n'y a pas d'annuaire : le catalogue fictif en tient lieu.
- **Ajoutés automatiquement.** `plan_runs.auto_added` marque la première exécution, par ce plan,
  d'un élément pris par une charge « toute l'organisation », quand le plan a déjà tourné à un
  créneau antérieur : rien n'est « ajouté » pendant le premier créneau d'un plan, même repris
  après une interruption. Cas connus où l'indication est large : une charge ajoutée à un plan
  existant (ses éléments sont tous nouveaux pour le plan) et le premier passage, avec l'annuaire,
  d'un plan créé avant #545 (les comptes jamais sauvegardés sont pris à ce moment-là, ce qui est
  bien un ajout d'office). `GET /api/status` (administrateurs) expose `autoAdded` : par plan, les
  éléments ajoutés à sa dernière exécution (le créneau de son exécution la plus récente), lus par
  une requête dédiée (1 000 au plus par plan) et nommés par le catalogue. Aucun nom n'est conservé
  dans `plans.sqlite` : tant qu'un élément n'a pas de sauvegarde, la page Sources affiche son
  identifiant.

## Conséquences

- Aucune dépendance nouvelle ; aucune nouvelle autorisation Graph au-delà de celles que la
  sauvegarde du tenant du SDK demande déjà (lecture des utilisateurs et des sites).
- Un compte parti du tenant n'est plus sauvegardé par une charge « toute l'organisation » ; ses
  sauvegardes passées restent, et la page Sources les montre vieillir.
- Les contacts, l'agenda et Teams ne sont pas des charges séparées de la console : ils suivent la
  messagerie (ADR 0011) tant qu'une issue ne les sépare pas.
