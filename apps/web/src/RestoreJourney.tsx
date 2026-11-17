import type { ReactNode } from 'react';
import { MAX_REASON_LENGTH } from './mail.js';
import { Alert, FormField } from './ui/index.js';

/**
 * Éléments communs aux trois parcours de restauration (mail, OneDrive, SharePoint) : mêmes
 * étapes, même bloc motif, mêmes boutons, même rappel d'audit, même indicateur « en cours ».
 */

/** Étapes de OneDrive et de SharePoint ; `Steps` les affiche à chaque écran, fin comprise. */
export const RESTORE_STEPS = ['Choisir', 'Motif', 'Confirmation'];

/** Rang de l'écran dans `RESTORE_STEPS` : le suivi se tient sur la dernière étape. */
export const stepOf = (n: number): number => Math.min(n, RESTORE_STEPS.length);

/** Phrase de la charte (principe « Traçabilité »). */
export const AUDIT_REMINDER =
  'Chaque consultation, export ou restauration est inscrite au journal d’audit.';

export const REASON = {
  label: 'Motif de la restauration (obligatoire)',
  help: 'Ce motif sera inscrit au journal d’audit. N’y saisissez pas de donnée personnelle.',
  placeholder: 'Ticket INC-12345 : suppression accidentelle',
  error: 'Indiquez un motif pour continuer.',
  /** Une seule limite pour les trois parcours (celle du serveur). */
  maxLength: MAX_REASON_LENGTH,
} as const;

/** Libellés des boutons, les mêmes dans les trois parcours. */
export const RESTORE_BUTTONS = {
  back: 'Précédent',
  cancel: 'Annuler',
  next: 'Continuer',
  confirm: 'Restaurer',
  audit: 'Voir dans le journal d’audit',
  again: 'Nouvelle restauration',
  retry: 'Réessayer',
} as const;

/** Rappel d'audit : `Alert` d'information, au même endroit sur chaque étape. */
export function AuditReminder() {
  return <Alert tone="info">{AUDIT_REMINDER}</Alert>;
}

/** Bloc motif : texte libre, même libellé, même aide, même limite. */
export function ReasonField({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label={REASON.label}
      type="text"
      name="reason"
      required
      counterMax={REASON.maxLength}
      placeholder={REASON.placeholder}
      help={REASON.help}
      error={error}
      value={value}
      onChange={(e) => {
        onChange(e.currentTarget.value);
      }}
    />
  );
}

/** Restauration en cours : même texte et même barre d'avancement partout. */
export function RunningProgress({ detail }: { detail?: ReactNode }) {
  return (
    <>
      <p role="status">
        <span className="spinner" aria-hidden="true" /> Restauration en cours…
        {detail ? <> {detail}</> : null}
      </p>
      {/* Le SDK ne rend pas de progression : barre sans valeur, jamais un pourcentage inventé. */}
      <div
        role="progressbar"
        aria-label="Progression de la restauration"
        aria-valuetext="En cours"
        className="progress"
      >
        <span className="progress-bar" />
      </div>
    </>
  );
}
