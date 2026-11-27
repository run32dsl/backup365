import { useEffect, useRef, type ReactNode } from 'react';
import { MAX_REASON_LENGTH } from './mail.js';
import { RestoreBlocked } from './StorageBlocked.js';
import { Alert, FormField, WIZARD_LABELS } from './ui/index.js';

/**
 * Éléments communs aux trois parcours de restauration (mail, OneDrive, SharePoint) : mêmes
 * étapes, même bloc motif, mêmes boutons, même rappel d'audit, même indicateur « en cours ».
 */

/** Étapes de OneDrive et de SharePoint ; `Steps` les affiche jusqu'à la confirmation, pas au suivi. */
export const RESTORE_STEPS = ['Choisir', 'Motif', 'Récapitulatif'];

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
  error: 'Indiquez un motif pour continuer.',
  /** Une seule limite pour les trois parcours (celle du serveur). */
  maxLength: MAX_REASON_LENGTH,
} as const;

/** Exemple du motif, propre à l'action (40 caractères au plus, sans donnée personnelle). */
export const REASON_EXAMPLES = {
  restore: 'Ticket INC-12345 : suppression erronée',
  export: 'Ticket INC-12345 : demande d’accès',
  run: 'Ticket INC-12345 : relance après échec',
  deletePlan: 'Ticket INC-12345 : plan remplacé',
  resetPassword: 'Ticket INC-12345 : mot de passe oublié',
  changeRole: 'Ticket INC-12345 : changement de poste',
  disableAccount: 'Ticket INC-12345 : départ de l’agent',
  transfer: 'Ticket INC-12345 : départ d’un agent',
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

/**
 * Haut des étapes d'une restauration : le rappel d'audit (`audit`, vrai par défaut) ou, stockage
 * bloqué, le seul bandeau qui dit la restauration suspendue (#612, #614) ; rien ne sera inscrit.
 */
export function RestoreReminders({
  blocked,
  admin,
  audit = true,
}: {
  blocked: boolean;
  admin: boolean;
  audit?: boolean;
}) {
  if (blocked) return <RestoreBlocked admin={admin} />;
  return audit ? <AuditReminder /> : null;
}

/** Bloc motif : texte libre, même libellé, même aide, même limite. */
export function ReasonField({
  value,
  error,
  of,
  placeholder,
  onChange,
}: {
  /** Exemple grisé, propre à l'action : voir `REASON_EXAMPLES`. */
  placeholder: string;
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
      placeholder={placeholder}
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
      <Alert tone="info">
        {detail ? <>{detail}. </> : null}Vous pouvez quitter cette page, la restauration continue.
      </Alert>
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
