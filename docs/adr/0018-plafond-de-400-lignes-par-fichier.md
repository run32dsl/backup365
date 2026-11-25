# ADR 0018 : un fichier de l'interface ne dépasse pas 400 lignes

Statut : **proposé** (issue #256)

## Contexte

Trois écrans (`PlansPage`, `SharePointPage`, `OneDrivePage`) concentraient 2 600 lignes : chaque PR
les touchait, ce qui provoquait des conflits entre les deux voies de travail et des régressions
d'interface. L'ADR 0016 prévoyait déjà un parcours de restauration commun.

## Décision

- Dans `apps/web/src`, hors tests et hors `charte.css`, un fichier ne dépasse pas 400 lignes. La
  règle ESLint `max-lines` (`eslint.config.js`) le garantit : la CI échoue au 401e.
- Un écran découpé garde son fichier d'entrée (`PlansPage.tsx`) et range le reste dans un dossier de
  même nom (`plans/`, `onedrive/`, `sharepoint/`, `status/`, `login/`, `accounts/`, `app/`). Un
  module de logique trop long (`plans.ts`, `sharepoint.ts`) reste le point d'import des écrans et
  réexporte ses parties (`plans/model.ts`, `form.ts`, `display.ts`, `api.ts`), sans cycle.
- L'assistant de création de plan est dans `plans/wizard/` : un fichier par étape
  (`StepWhat`, `StepObjectives`, `StepRecap`) et `PlanWizard.tsx` pour l'enchaînement.
- OneDrive et SharePoint partagent leurs étapes communes dans `restore/` : l'étape « Motif »
  (`ReasonStep`), la barre d'actions du suivi (`ResultActions`) et le sondage d'une restauration
  en cours (`useJobPolling`). Les étapes « Choisir » et « Confirmation » restent propres à chaque
  source : ce qu'on choisit et ce qu'on confirme n'est pas pareil.
- Les tests qui lisent le code source d'un écran passent par `testSources.ts`, qui lit la page et
  son dossier.

## Conséquences

- Découper ne change ni le rendu ni le comportement : mêmes libellés, mêmes classes, mêmes textes.
- Une PR touche le fichier de l'étape ou de la boîte qu'elle modifie, plus rarement la page entière.
- Un écran qui grandit au-delà de 400 lignes se découpe dans la même PR, pas après.
