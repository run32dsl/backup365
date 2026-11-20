# ADR 0016 : un seul modèle de parcours de restauration

Statut : **proposé** (issue #103)

## Contexte

Les restaurations de mail (ADR 0012), de fichier OneDrive (ADR 0013) et de site SharePoint
(ADR 0014) font la même chose : choisir, donner un motif, confirmer, suivre. Chacune avait ses
titres, ses libellés de boutons, son bloc motif et sa phrase d'audit, ce qui donnait l'impression
de trois produits.

## Décision

- Un module `apps/web/src/RestoreJourney.tsx` porte ce qui est commun : les étapes
  (« Choisir », « Motif », « Confirmation »), le bloc motif (`ReasonField`), les libellés des
  boutons, le rappel d'audit (`AuditReminder`, un `Alert` d'information) et l'indicateur « en
  cours » (`RunningProgress`).
- Le titre de page est stable (« Restaurer depuis OneDrive », « Restaurer depuis SharePoint ») ;
  `Steps` porte l'étape jusqu'à la confirmation et disparaît au suivi (en cours, terminée,
  échouée) : aucun écran ne montre « Toutes les étapes sont terminées ». Le suivi a un titre `h2` commun (`RestoreResult` : « Restauration en
  cours », « Restauration terminée », « Restauration échouée ») et un récapitulatif libellé
  (`ResultList`, dans `apps/web/src/ui/`, aussi utilisé par l’étape « Récapitulatif » des plans).
- Le motif est un texte libre, obligatoire, de 120 caractères au plus (`MAX_REASON_LENGTH`, la
  limite du serveur), pour les trois parcours. SharePoint n'a plus de liste de motifs.
- Le rappel d'audit reprend la phrase de la charte : « Chaque consultation, export ou
  restauration est inscrite au journal d'audit. » Il n'apparaît que là où un élément sauvegardé
  est consulté, exporté ou restauré, et pas dans les boîtes de résultat (voir la charte).
- Barre d'actions : le composant `WizardActions` (`apps/web/src/ui/`), utilisé à chaque étape et
  sur les écrans de fin, aussi par l'assistant de plan. En bureau, retour en contour à gauche et
  action principale à droite ; en mobile, pleine largeur, action principale en haut.
  `dialog-actions` est réservé aux boîtes de dialogue.
- Boutons : « Précédent » ou « Annuler » (contour), « Continuer » (plein), « Restaurer » (plein, à
  la confirmation) ; en fin de parcours « Voir dans le journal d'audit » et « Nouvelle
  restauration ».

## Conséquences

- OneDrive passe de deux à trois étapes : le mode (copie ou remplacement) et le récapitulatif
  sont à la confirmation, le motif seul à l'étape « Motif ».
- Le serveur reçoit un motif libre pour SharePoint (il recevait « liste : précision »).
- La restauration d'un mail reste une fenêtre à un seul écran : elle partage le bloc motif, le
  rappel d'audit et les libellés, mais pas `Steps` (pas d'étapes à afficher).
- Les scripts de captures et les tests de bout en bout utilisent les mêmes libellés.
