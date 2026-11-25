/**
 * Libellés communs aux parcours « Restaurer depuis OneDrive » et « Restaurer depuis SharePoint » :
 * un seul vocabulaire pour les deux (choix de la date, récapitulatif, résultat).
 */
export const RESTORE_LABELS = {
  /** Date de la sauvegarde : champ de choix, récapitulatif et résultat. */
  backupDate: 'Date de la sauvegarde (UTC)',
  /** Date de la version d'un fichier : colonne du tableau, récapitulatif et résultat. */
  versionAt: 'Date de la version (UTC)',
  /** Objet à restaurer, récapitulatif ; la nature est dans la valeur. */
  item: 'Élément',
  /** Objet restauré, résultat. */
  itemRestored: 'Élément restauré',
  /** Destination des éléments restaurés, récapitulatif et résultat. */
  location: 'Emplacement',
  /** Sort des fichiers déjà présents à la destination (SharePoint). */
  existingFiles: 'Fichiers déjà présents',
} as const;
