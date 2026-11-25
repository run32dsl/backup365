import type { ReactNode } from 'react';
import { RESTORE_BUTTONS as B } from '../RestoreJourney.js';
import { WizardActions } from '../ui/index.js';

/** Barre d'actions du suivi : lien vers le journal d'audit, puis l'action propre à l'état. */
export function ResultActions({ children }: { children?: ReactNode }) {
  return (
    <WizardActions
      back={
        <a className="btn btn-secondary" href="#/audit">
          {B.audit}
        </a>
      }
    >
      {children}
    </WizardActions>
  );
}
