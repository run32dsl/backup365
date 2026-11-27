# Charte d'interface

Statut : **proposé** (issue #48). La feuille de style est `apps/web/src/charte.css` ; elle
n'ajoute aucune dépendance.

## Principes

1. **Partir du besoin.** Un écran répond à une question de l'utilisateur ; pas de réglage
   « au cas où ».
2. **La conformité se voit.** Le motif est demandé avant d'ouvrir ou d'exporter, et le rappel
   « Chaque consultation, export ou restauration est inscrite au journal d’audit » reste
   visible.
3. **Jamais la couleur seule.** Un état associe une icône et un texte.
4. **Léger.** CSS simple, police système, aucune bibliothèque de composants.
5. **Accessible d'abord.** Clavier, contraste AA, `prefers-color-scheme` et
   `prefers-reduced-motion` respectés.

## Palette

Les couleurs sont des variables CSS : clair par défaut, redéfinies dans
`@media (prefers-color-scheme: dark)`. Aucun réglage de thème manuel pour l'instant.

| Variable                  | Clair                 | Sombre                | Usage                    |
| ------------------------- | --------------------- | --------------------- | ------------------------ |
| `--bg`                    | `#ffffff`             | `#12161a`             | fond                     |
| `--surface`               | `#f4f6f8`             | `#1b2127`             | barre latérale, en-têtes |
| `--text`                  | `#1a1f24`             | `#e8ecef`             | texte                    |
| `--muted`                 | `#4a5560`             | `#b0bac3`             | texte secondaire         |
| `--border`                | `#6b7782`             | `#8a96a1`             | contour des champs (3:1) |
| `--accent`                | `#0b5cad`             | `#7ab7f5`             | liens, bouton principal  |
| `--ok-fg` / `--ok-bg`     | `#14602a` / `#e3f4e8` | `#a6e3b8` / `#153a22` | succès                   |
| `--warn-fg` / `--warn-bg` | `#6e4a00` / `#fdf0d5` | `#f5d58a` / `#46340a` | avertissement            |
| `--err-fg` / `--err-bg`   | `#9b1c1c` / `#fbe4e4` | `#f7b4b4` / `#4a1b1b` | échec, alerte            |

Texte sur fond : au moins 4,5:1 ; contour des contrôles : au moins 3:1.

## Typographie et espacements

- Police système (`system-ui`), corps 1 rem, titre de page (`h1`, un seul par écran) 1,5 rem.
- Échelle de titres, définie une fois dans `charte.css` : `h1` 1,5 rem, `h2` 1,25 rem (parties
  d'un écran, cartes d'accueil, résultats de parcours, titre des boîtes de dialogue), `h3`
  1,125 rem. Un composant ne redéfinit jamais une taille de titre ; le `h1` reste le plus grand.
  La page `#/composants` montre l'échelle.
- Unités `rem`. Échelle d'espacement : 4, 8, 16 et 24 px (`--space-1` à `--space-4`).
- Cibles tactiles d'au moins 44 px (2,75 rem). Lisible à 200 % de zoom.

## Composants de base

Les composants communs sont dans `apps/web/src/ui/` (`Button`, `FormField`, `ChoiceGroup`, `DataTable`,
`Dialog`, `EmptyState`, `Alert`, `Steps`, `StatusPill`) : un écran les utilise au lieu de
refaire ses boutons, tableaux et formulaires. La page `#/composants`, visible en mode démo
seulement (lien « Composants » en pied de page), les montre dans tous leurs états. Un nouveau
composant s'y ajoute avec ses tests de comportement.

- **Bouton** : plein pour l'action principale, contour pour les actions secondaires et la
  barre latérale ; grisé quand il est désactivé. Action irréversible ou retrait d'accès =
  variante danger (`Button variant="danger"`), au déclenchement comme à la confirmation
  (« Supprimer » / « Supprimer le plan », « Désactiver » / « Désactiver ») ; « Annuler » reste
  secondaire, comme « Réactiver ». Exemple sur `#/composants`.
- **Champ** : un `<label>` visible au-dessus, contour 3:1, aide reliée par `aria-describedby`.
  L'exemple grisé d'un champ « Motif » décrit une raison plausible pour l'action concernée
  (« Ticket INC-12345 : plan remplacé » pour supprimer un plan, « : demande d’accès » pour
  un export) : jamais le même texte d'un écran à l'autre. Il tient en 40 caractères au plus,
  sans donnée personnelle, pour s'afficher en entier à 390 px. Exemples sur `#/composants`.
- **Tableau** : `<th scope="col">`, légende (masquée visuellement si le titre la remplace),
  texte qui passe à la ligne plutôt que de déborder.
- **Badge d'état** (`.badge`) : « À jour » (`✔`), « En cours », « En retard » (`⚠`),
  « En échec » (`✖`) ; mêmes libellés pour les plans et les sauvegardes. L'accueil ajoute
  « Opérationnelle » (`✔`, `--ok`), « Non configurée » (`⚠`, `--warn`, seulement sans plan) et
  « En attente » (`◷`, neutre : `--border-soft` et `--text`, des plans sans aucun résultat,
  sans bouton, avec la phrase « Aucune sauvegarde n’est encore terminée. »).
- **Carte d'accueil** (`.overview-card`) : `<section aria-labelledby>` avec un `h2` ; trois cartes
  en grille, deux colonnes dès 900 px, une seule dessous (bouton pleine largeur).
- **Blocs sous les cartes** (« Couverture du tenant », « Prochaine sauvegarde », « Derniers
  événements ») : ils lisent les mêmes données que les cartes, chargées une fois, et ne les
  contredisent jamais (#578). Sans plan, seule reste la phrase « Aucun plan de protection n’est
  configuré. », sans « Sauvegarder maintenant ». Plans sans résultat : un `EmptyState`
  « Aucune sauvegarde n’est encore terminée. » à la place des tuiles, aucune exécution terminée
  listée. Connexion Microsoft 365 à configurer : ni échéance ni « Sauvegarder maintenant ».
  Stockage bloqué (#612) : carte « Sauvegarde » en « ✖ Interrompue », « Aucune sauvegarde ne
  partira tant que le stockage n’est pas corrigé. » à la place de l'échéance, sans « Sauvegarder
  maintenant », que la connexion soit reliée ou non. La carte ne répète pas le titre du bandeau
  et passe directement aux échecs et retards ; son seul bouton, « Voir le stockage », ouvre État
  des sources sur la section « Stockage » (titre focalisé), sans « Voir les sources » en plus
  (#616). Lancement de tous les plans avec au moins un refus : la boîte passe en résultat, comme
  `RunDialog` (#596). Titre « Lancement partiel » (bandeau d'avertissement) ou « Lancement
  impossible » (bandeau d'erreur) ; bilan en gras (« 3 sauvegardes lancées, 1 non lancée ») puis
  les plans non lancés, raison en minuscule après les deux-points ; motif rappelé en lecture
  seule ; seul « Fermer » reste.
  Tuiles de « Couverture du tenant » : dès 900 px, trois tuiles sur une ligne (libellé, chiffre,
  puis « Voir dans Sources → »). Sous 900 px, une seule colonne, comme les cartes : chaque tuile
  prend toute la largeur, le libellé à gauche et le chiffre à droite sur une ligne, puis « Voir
  dans Sources → » en ligne secondaire (`--muted`) ; cible d'au moins 44 px. La flèche est liée
  au mot par une espace insécable, jamais seule à la ligne (#582).
- **Connexion Microsoft 365 sur l'accueil** (administrateur) : aucune carte ni aucun bloc ne
  s'ajoute pour elle. Connexion configurée, une ligne secondaire (`--muted`) dans la carte
  « Sauvegarde » : « Microsoft 365 connecté · Messagerie, OneDrive, SharePoint ». Connexion à
  configurer, un `Alert` d'avertissement (`role="status"`) sous le `h1`, titré « Connexion
  Microsoft 365 à configurer », avec les trois étapes numérotées ; commandes et chemins en
  `<code>`. Le libellé « Non configurée » reste réservé à la sauvegarde sans plan.
- **Rappel d'audit** (`AuditReminder`, `Alert` d'information) : une règle unique.
  Dans un parcours ou une boîte qui consulte, exporte ou restaure un élément sauvegardé, le
  rappel est le premier `Alert` d'information, sous le titre de l'étape de saisie. Dans une
  boîte de résultat (en cours, réussie, échouée), le bandeau de résultat vient en premier et le
  rappel est retiré : le bouton « Voir dans le journal d’audit » en tient lieu. Pour une action
  qui ne touche pas à un élément sauvegardé (réinitialisation de mot de passe, création ou
  lancement d'un plan), il n'y a pas de bandeau : seule l'aide du champ motif (« Ce motif sera
  inscrit au journal d’audit… ») reste. `#/composants` montre ce placement.
- **Écran d'accès** (`.auth`) : bloc centré (28 rem au plus) avec « backup365 », le titre, les
  bandeaux (refus Microsoft en `Alert` d'erreur « Accès refusé ») et des boutons pleine largeur ;
  connexion, premier administrateur et mot de passe imposé l'utilisent, avec la version de la
  console sous le bloc. Le changement volontaire, dans la console, ne l'utilise pas.
- **Bandeau d'alerte** : `role="alert"` pour une erreur, `role="status"` pour une information ;
  sans détail technique.
- **Bandeau d'en-tête d'État des sources** (`status/Summary.tsx`) : un `Alert` d'erreur s'il y a
  un échec (plan ou sauvegarde), d'avertissement sinon. Titre en gras : les deux problèmes les
  plus graves, dans l'ordre plan en échec, sauvegarde en échec, plan en retard, sauvegarde en
  retard (« 1 plan en échec et 1 sauvegarde en retard ») ; à défaut « N sources sans plan ».
  Corps : des phrases terminées par un point, la conduite à tenir d'abord (« Ouvrez le plan
  concerné pour voir sa dernière exécution. »), puis les sources sans plan. Le lien « Voir les
  plans de protection » passe dans la prop `action` (`.alert-link`, sans retour à la ligne). Le
  bandeau ne répète pas la liste des compteurs : les pastilles des sections la donnent.
- **Stockage bloqué** (`conditionalWrites === 'ignored'`, administrateurs) : la panne la plus
  grave, traitée comme une connexion Microsoft 365 interrompue. Sur État des sources, le bandeau
  d'en-tête passe en `Alert` d'erreur titré « Sauvegardes et restaurations bloquées sur ce
  stockage », quels que soient les échecs ; son corps donne d'abord la conduite à tenir
  (« Prévenez l’exploitant du serveur : le stockage est à faire corriger. »), dit que les
  sauvegardes listées sont antérieures au blocage, puis donne les compteurs et les autres
  problèmes. La section « Stockage », en `Alert` d'erreur sans titre, remonte juste sous le
  bandeau, avant « Services » ; elle ne garde que l'explication (le stockage ne bloque pas deux
  opérations simultanées sur une même source, donc rien n'y est fait), titre et conduite à tenir
  n'étant dits qu'une fois, dans le bandeau (#616). Le même `Alert` d'erreur (`StorageBlocked`)
  se place sous le `h1` de l'Accueil, en tête de Plans de protection (avant celui de la connexion, s'il y en a un ; la suspension du
  lancement manuel n'y est dite qu'une fois) et en tête des trois parcours de restauration.
  Là, il est complété par « La restauration est suspendue jusqu’à la correction du stockage. »
  et remplace le formulaire (#614) : ni choix de destination, ni rappel d'audit, ni motif, ni
  récapitulatif ; rien n'est saisi ni inscrit au journal d'audit. Un seul bouton secondaire
  reste, « Fermer » dans la boîte « Restaurer ce mail », « Précédent » à l'étape « Motif » de
  OneDrive et de SharePoint ; pas de bouton principal grisé. Le bouton « Restaurer » de la fiche
  et « Continuer » de l'étape « Choisir » restent, pour consulter, et mènent à cet état. Un
  opérateur, qui ne voit pas l'état du stockage (`GET /api/status` ne lui dit que
  `restoreSuspended`), a le même blocage dans un `Alert` d'erreur sans titre : « Restauration
  impossible pour l’instant. Prévenez un administrateur. » Exemple sur `#/composants`.
- **Échec d'une restauration** (messagerie, OneDrive, SharePoint) : un seul `Alert` d'erreur
  (`RestoreFailureAlert`), construit comme celui d'un plan. Première ligne en gras « Échec de la
  restauration de « élément » le jj/mm/aaaa hh:mm UTC », puis la cause, la conséquence et la
  conduite à tenir (réessayer, puis prévenir l'exploitant du serveur avec l'heure). Si le
  résultat est inconnu, la conduite à tenir demande de vérifier l'état avant de réessayer.
- **État vide** (`.empty`) : phrase claire et, au plus, un bouton d'action.
- **Navigation** : `<nav aria-label="Navigation principale">`, entrée active en
  `aria-current="page"`, lien d'évitement « Aller au contenu ». Sous 900 px, la barre latérale
  devient une barre repliable (bouton « Menu », `aria-expanded`) ; Échap la referme et rend le
  focus au bouton. Le clavier ne repose que sur des éléments natifs (`<a href>`, `<button>`),
  dans l'ordre du document, sans `tabindex` positif.

## Navigation principale

Cinq entrées au plus (`MAX_ADMIN_NAV_ENTRIES`, appliquée par `navEntries`), décision du PM du
2026-11-19 : Accueil (`#/`), Sources (`#/plans`), Restaurer (`#/search`), Activités (`#/activites`,
avec la sous-navigation « Sauvegardes » et « Journal d'audit » `#/audit`), Réglages (`#/comptes`, administrateurs seulement : un opérateur voit quatre entrées). Aucune
entrée par service. Dès 900 px, c'est une barre verticale étroite de 6 rem : une icône
décorative (`aria-hidden`) au-dessus d'un libellé court, qui passe à la ligne sans être tronqué.
Dessous, le menu repliable garde les mêmes entrées en ligne. Ce sont des `<a href>` natifs, dont
l'active porte `aria-current="page"`, un trait et un fond plein.

Le `h1` d'une rubrique commence par le libellé de son entrée : « Accueil », « Activités »
(phrase d'introduction : « Journal d’audit : … », terme du vocabulaire de référence), « Réglages »
(y compris la page réservée aux administrateurs). Le mot « tableau de bord » n'est pas affiché.

Les vues d'une rubrique sont choisies par un sélecteur en tête de page (`SubNav`, `<nav>` de
liens natifs, sans `role="tab"`, dont les libellés passent à la ligne sous 900 px, marge des liens `--space-2`, cible d'au moins 44 px ; si la barre déborde malgré tout, l'entrée active est ramenée dans la zone visible) :

- **Restaurer** (`aria-label="Source à restaurer"`) : Mails (`#/search`, y compris la fiche d'un
  mail), Fichiers OneDrive (`#/onedrive`), Sites SharePoint (`#/sharepoint`). L'entrée
  « Restaurer » reste active sur ces quatre écrans.
- **Sources** (`aria-label="Vue des sources"`, administrateurs) : Plans de protection (`#/plans`)
  et État des sources (`#/sources` ; l'ancienne `#/etat` y redirige). Un opérateur n'a que les
  plans.
- **Réglages** (`aria-label="Vue des réglages"`, administrateurs) : Comptes (`#/comptes`) et
  Rapports par mail (`#/rapports`). Un opérateur n'a ni l'entrée ni les vues (« Cette page est
  réservée aux administrateurs. »). Le formulaire des rapports tient dans une colonne de 40 rem
  au plus ; sous 900 px, ses boutons passent en pleine largeur.

Dans chaque rubrique, l'ordre est le `h1` propre à la vue, le sélecteur, puis le contenu. Les
actions propres à une vue (« Créer un plan ») viennent après le sélecteur, sur la ligne de la
phrase d'introduction : à droite dès 900 px, pleine largeur dessous.

Les titres des écrans de restauration restent « Restaurer depuis la messagerie », « Restaurer
depuis OneDrive », « Restaurer depuis SharePoint ». Seules les entrées livrées apparaissent, sans
entrée grisée. Le compte, le lien « Mot de passe » et « Se déconnecter » sont en bas de la barre.

## Vocabulaire de référence

| Terme              | Sens                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| sauvegarde         | copie d'une boîte, d'un site ou d'une charge                          |
| plan de protection | ce qui est sauvegardé, à quelle fréquence, pour combien de temps      |
| restauration       | remise d'un élément sauvegardé (export ou retour au tenant)           |
| motif              | raison déclarée d'une consultation, d'un export ou d'une restauration |
| journal            | journal d'audit : qui, quoi, quand, pourquoi, en lecture seule        |

Éviter « snapshot », « backup » et « log » dans les textes affichés.
