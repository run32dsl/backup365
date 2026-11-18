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
- Unités `rem`. Échelle d'espacement : 4, 8, 16 et 24 px (`--space-1` à `--space-4`).
- Cibles tactiles d'au moins 44 px (2,75 rem). Lisible à 200 % de zoom.

## Composants de base

Les composants communs sont dans `apps/web/src/ui/` (`Button`, `FormField`, `ChoiceGroup`, `DataTable`,
`Dialog`, `EmptyState`, `Alert`, `Steps`, `StatusPill`) : un écran les utilise au lieu de
refaire ses boutons, tableaux et formulaires. La page `#/composants`, visible en mode démo
seulement (lien « Composants » en pied de page), les montre dans tous leurs états. Un nouveau
composant s'y ajoute avec ses tests de comportement.

- **Bouton** : plein pour l'action principale, contour pour les actions secondaires et la
  barre latérale ; grisé quand il est désactivé.
- **Champ** : un `<label>` visible au-dessus, contour 3:1, aide reliée par `aria-describedby`.
- **Tableau** : `<th scope="col">`, légende (masquée visuellement si le titre la remplace),
  texte qui passe à la ligne plutôt que de déborder.
- **Badge d'état** (`.badge`) : « À jour » (`✔`), « En cours », « En retard » (`⚠`),
  « En échec » (`✖`) ; mêmes libellés pour les plans et les sauvegardes. L'accueil ajoute
  « Opérationnelle » (`✔`, `--ok`) et « Non configurée » (`⚠`, `--warn`, seulement sans plan) ;
  des plans sans aucun résultat : pas de badge, une phrase.
- **Carte d'accueil** (`.overview-card`) : `<section aria-labelledby>` avec un `h2` ; trois cartes
  en grille, deux colonnes dès 900 px, une seule dessous (bouton pleine largeur).
- **Bandeau d'alerte** : `role="alert"` pour une erreur, `role="status"` pour une information ;
  sans détail technique.
- **État vide** (`.empty`) : phrase claire et, au plus, un bouton d'action.
- **Navigation** : `<nav aria-label="Navigation principale">`, entrée active en
  `aria-current="page"`, lien d'évitement « Aller au contenu ». Sous 900 px, la barre latérale
  devient une barre repliable (bouton « Menu », `aria-expanded`) ; Échap la referme et rend le
  focus au bouton. Le clavier ne repose que sur des éléments natifs (`<a href>`, `<button>`),
  dans l'ordre du document, sans `tabindex` positif.

## Navigation principale

Cinq entrées au plus : Tableau de bord, Plans de protection, Rechercher et restaurer, Journal
d'audit, Administration (comptes). Seules les entrées livrées apparaissent, sans entrée
grisée. Aujourd'hui : Tableau de bord, Rechercher et restaurer, Journal d'audit, et
Administration pour les administrateurs.

## Vocabulaire de référence

| Terme              | Sens                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| sauvegarde         | copie d'une boîte, d'un site ou d'une charge                          |
| plan de protection | ce qui est sauvegardé, à quelle fréquence, pour combien de temps      |
| restauration       | remise d'un élément sauvegardé (export ou retour au tenant)           |
| motif              | raison déclarée d'une consultation, d'un export ou d'une restauration |
| journal            | journal d'audit : qui, quoi, quand, pourquoi, en lecture seule        |

Éviter « snapshot », « backup » et « log » dans les textes affichés.
