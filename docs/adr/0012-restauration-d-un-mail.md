# ADR 0012 : restauration d'un mail dans sa boîte d'origine

Statut : **proposé** (issue #51)

## Contexte

La vision prévoit la restauration d'un élément, journalisée, avec un mode lecture seule possible
(principe 3). Jusqu'ici la console ne fait que lire : elle construit le SDK avec de faux
identifiants Graph (ADR 0002), ce qui suffit pour lister, indexer et lire un message, pas pour
écrire dans une boîte. `outlook.restore(snapshotId, { messageRef, folderName })` du SDK recrée un
message dans la boîte d'origine, dans un dossier nommé, sans toucher à l'existant ; il passe par
Graph et exige donc de vrais identifiants avec droit d'écriture.

## Décision

- Port `MailRestorer` (`packages/core`) : `restoreMessage(snapshotId, messageRef, folderName)`
  renvoie `{ restored, errors }`, des comptes seulement. L'adaptateur `AtlasSdkMailRestorer` appelle
  `outlook.restore` avec `messageRef` et sans `targetMailbox` (boîte d'origine). Aucune dépendance.
- **Pas de câblage réel dans cette issue.** La console n'a pas d'identifiants Graph : en dehors du
  mode démo, `RestoreService` n'est pas créé, `GET /api/restore` répond `{ configured: false }`,
  `POST …/restore` répond 503 `restore_unavailable` et l'interface désactive le bouton avec le message
  `restore_unavailable` de `API_ERRORS`, sans renvoi vers l'Accueil (qui ne configure rien). Relier un tenant (identifiants Graph
  par variables d'environnement ou fichiers montés, mode lecture seule désactivé explicitement)
  relève de l'agent tenant ; l'essai réel se fait sur un tenant de TEST uniquement (voir
  « Non vérifié »). Le mode démo utilise un restaurateur factice (2 s, le mail n° 25 de chaque
  boîte échoue).
- Dossier : `Restauré par backup365 jj/mm/aaaa`, date UTC du lancement.
- `RestoreService` (`apps/server`) : une restauration à la fois par mail (409
  `restore_in_progress`), exécutée en arrière-plan, durée mesurée du lancement à la fin. Dernière
  restauration de chaque mail gardée **en mémoire** (1000 au plus, perdues au redémarrage) ; la
  durée mesurée est aussi dans le journal d'audit, d'où le RTO observé pourra être calculé (non
  traité ici). Un échec ne garde qu'un code fermé (`restore_error`, `restore_unreachable`), jamais
  le message du SDK.
- Routes (session, rôle `admin` ou `operator`, 403 sinon) :

| Route                                           | Effet                                                 | Réponses                     |
| ----------------------------------------------- | ----------------------------------------------------- | ---------------------------- |
| `GET /api/restore`                              | `{ configured }`                                      | 200                          |
| `GET /api/mails/:mailboxId/:messageId/restore`  | `{ last }` : dernière restauration du mail, ou `null` | 200                          |
| `POST /api/mails/:mailboxId/:messageId/restore` | corps `{ reason }` ; lance la restauration, `{ job }` | 202, 400, 403, 404, 409, 503 |

- **Motif** : mêmes règles que l'export (`cleanReason` : 3 à 120 caractères, sans caractère de
  contrôle), sinon 400 `reason_required` sans rien consigner ni lancer.
- **Audit**, ressource `mail.restore`, cible `boîte/message` : `restore.request` (motif = le motif)
  consigné **avant** le lancement (s'il échoue, rien ne part) ; `restore.result` à la fin, avec
  `count` (1 réussie, 0 échouée) et un motif de la forme
  `outcome=<succeeded|failed>;duration_ms=<n>;reason=<motif>` (le motif, texte libre, est
  toujours le dernier champ : couper aux deux premiers `;` seulement). Une restauration qui ne
  rend pas la main en 10 minutes passe en échec (`restore_unreachable`). Jamais l'objet, l'expéditeur ni le
  contenu du mail. Un résultat qui ne peut pas être consigné est signalé dans les journaux
  applicatifs par un code, la restauration n'est pas annulée pour autant.
- Interface : bouton « Restaurer » sur chaque résultat de recherche et sur la fiche ; panneau
  modal (`Dialog`) en trois états (formulaire, en cours, réussie ou échouée). La fiche affiche
  « Dernière restauration : réussie, 18 s ». Le panneau peut être fermé : la restauration continue.

## Conséquences

- Le rôle « lecteur » de la maquette n'existe pas (ADR 0008 : `admin` et `operator`, tous deux
  autorisés) : le cas « bouton `aria-disabled` pour un lecteur » n'est pas construit.
- Tant que la restauration n'est pas câblée, seul le mode démo la montre.
- Une restauration en cours à l'arrêt de la console est perdue sans trace de fin (le journal a la
  demande, pas le résultat).
- La limite de 120 caractères du motif et la consigne de n'y mettre aucune donnée personnelle
  restent celles de l'ADR 0005.

## Non vérifié

`outlook.restore` n'a jamais été appelé contre un vrai tenant : le comportement réel (nom du
dossier créé, valeur de `restoredCount` pour un seul message, non-écrasement) est une hypothèse
tirée des types du SDK. **Essai réel à faire par l'agent tenant, sur un tenant de TEST uniquement** :
relier le tenant, restaurer un mail de test depuis la fiche, vérifier dans la boîte le dossier
`Restauré par backup365 <date>`, la présence du mail, l'absence de modification du reste, puis
les deux lignes d'audit.
