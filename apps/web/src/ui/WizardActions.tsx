import type { ReactNode } from 'react';

/** Les deux seuls libellés de navigation des parcours en étapes. */
export const WIZARD_LABELS = { back: 'Précédent', next: 'Continuer' } as const;

/**
 * Barre d'actions des parcours en étapes (plans, OneDrive, SharePoint), la même à chaque étape :
 * en bureau, retour en contour à gauche et action principale pleine à droite ; en mobile, boutons
 * pleine largeur, action principale en haut. Sans `back`, l'action principale reste à droite.
 */
export function WizardActions({ back, children }: { back?: ReactNode; children: ReactNode }) {
  return (
    <div className="wizard-actions">
      {back}
      {children}
    </div>
  );
}
