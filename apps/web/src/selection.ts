/** Ligne « Sélection : … » de l'étape « Choisir », commune à OneDrive et SharePoint. */

const KIND_WORD = { file: 'fichier', folder: 'dossier', library: 'bibliothèque' } as const;

/** `Sélection : fichier « plan-a.pdf »` : le type puis le nom seul, le chemin étant dans le fil d'Ariane. */
export function selectionLabel(selected: {
  name: string;
  kind: keyof typeof KIND_WORD;
  versionAt?: string | null;
}): string {
  const base = `Sélection : ${KIND_WORD[selected.kind]} « ${selected.name} »`;
  return selected.versionAt ? `${base}, version du ${selected.versionAt} UTC` : base;
}

/** Sélection du site entier. */
export const WHOLE_SITE_SELECTION = 'Sélection : le site entier';
