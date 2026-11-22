/**
 * Libellés communs aux parcours « Restaurer depuis OneDrive » et « Restaurer depuis SharePoint » :
 * un seul vocabulaire pour les deux (choix de la date, récapitulatif, résultat).
 */
export const RESTORE_LABELS = {
  /** Choix de la date, étape « Choisir ». */
  backupDate: 'Date de la sauvegarde',
  /** Date de la sauvegarde, récapitulatif et résultat. */
  backupAt: 'Sauvegarde du',
  /** Objet à restaurer, récapitulatif ; la nature est dans la valeur. */
  item: 'Élément',
  /** Objet restauré, résultat. */
  itemRestored: 'Élément restauré',
  /** Destination des éléments restaurés, récapitulatif et résultat. */
  location: 'Emplacement',
  /** Sort des fichiers déjà présents à la destination (SharePoint). */
  existingFiles: 'Fichiers déjà présents',
} as const;
