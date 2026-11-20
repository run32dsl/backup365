import { useEffect, useRef, type ReactNode } from 'react';
import { MAX_REASON_LENGTH } from './mail.js';
import { Alert, FormField, WIZARD_LABELS } from './ui/index.js';

/**
 * Éléments communs aux trois parcours de restauration (mail, OneDrive, SharePoint) : mêmes
 * étapes, même bloc motif, mêmes boutons, même rappel d'audit, même indicateur « en cours ».
 */

/** Étapes de OneDrive et de SharePoint ; `Steps` les affiche jusqu'à la confirmation, pas au suivi. */
export const RESTORE_STEPS = ['Choisir', 'Motif', 'Confirmation'];

/** Rang de l'écran pour `Steps` : au-delà de la dernière étape, toutes sont terminées (le suivi n'affiche plus `Steps`). */
export const stepOf = (n: number): number => Math.min(n, RESTORE_STEPS.length + 1);

/** Titre du suivi, identique pour OneDrive et SharePoint (mêmes mots que le mail). */
export const RESULT_TITLES = {
  running: 'Restauration en cours',
  succeeded: 'Restauration terminée',
  failed: 'Restauration échouée',
} as const;

/** Suivi d'une restauration : titre `h2`, puis le contenu (l'alerte juste dessous). */
export function RestoreResult({
  status,
  children,
}: {
  status: keyof typeof RESULT_TITLES;
  children: ReactNode;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  // Plus d'indicateur d'étapes au suivi : le titre du résultat reçoit le focus.
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <section aria-labelledby="restore-result-title">
      <h2 id="restore-result-title" ref={title} tabIndex={-1}>
        {RESULT_TITLES[status]}
      </h2>
      {children}
    </section>
  );
}

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

/** Libellé du motif : « Motif <of> (obligatoire) », ex. « du lancement ». */
export const reasonLabel = (of: string): string => `Motif ${of} (obligatoire)`;

/** Libellés des boutons, les mêmes dans les trois parcours. */
export const RESTORE_BUTTONS = {
  back: WIZARD_LABELS.back,
  cancel: 'Annuler',
  next: WIZARD_LABELS.next,
  confirm: 'Restaurer',
  audit: 'Voir dans le journal d’audit',
  again: 'Nouvelle restauration',
  retry: 'Réessayer',
} as const;

/** Rappel d'audit : `Alert` d'information, au même endroit sur chaque étape. */
export function AuditReminder({ extra }: { extra?: string }) {
  return (
    <Alert tone="info">
      {AUDIT_REMINDER}
      {extra ? ` ${extra}` : ''}
    </Alert>
  );
}

/** Bloc motif : texte libre, même libellé, même aide, même limite. */
export function ReasonField({
  value,
  error,
  of,
  onChange,
}: {
  /** Complément du libellé : « de la restauration » (défaut), « de l’export »… */
  of?: string;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label={of === undefined ? REASON.label : reasonLabel(of)}
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
