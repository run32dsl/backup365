import { useEffect, useState, type FormEvent } from 'react';
import { ROLE_LABELS, ROLE_OPTIONS } from './accounts.js';
import type { Problem } from './apiError.js';
import { FailureAlert } from './FailureAlert.js';
import { REASON, REASON_EXAMPLES, ReasonField } from './RestoreJourney.js';
import type { Role } from './session.js';
import { Button, ChoiceGroup, Dialog, ResultList } from './ui/index.js';

/** Changement demandé sur la ligne d'un compte : le rôle ou la désactivation. */
export interface AccountChange {
  id: number;
  kind: 'role' | 'disable';
  username: string;
  role: Role;
}

/** Titre de la boîte : l'action seule, le compte est dans la liste du corps. */
export const changeTitle = (c: AccountChange): string =>
  c.kind === 'role' ? 'Modifier le rôle' : 'Désactiver ce compte\u202F?';

/** Phrase de succès du bandeau : elle nomme le compte. */
export const changeDone = (c: AccountChange, role: Role): string =>
  c.kind === 'role'
    ? `Rôle de ${c.username} : ${ROLE_LABELS[role]}.`
    : `${c.username} est désactivé.`;

/** Contenu de la boîte, construit comme celui de la réinitialisation. */
export function AccountChangeForm({
  change,
  role,
  error,
  failure,
  busy = false,
  onRole,
  onSubmit,
  onCancel,
}: {
  change: AccountChange;
  /** Rôle choisi (changement de rôle). */
  role: Role;
  error?: string | undefined;
  failure?: Problem | undefined;
  busy?: boolean;
  onRole?: (role: Role) => void;
  onSubmit?: (reason: string) => void;
  onCancel?: () => void;
}) {
  const [reason, setReason] = useState('');
  const disable = change.kind === 'disable';
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit?.(reason.trim());
      }}
    >
      <ResultList rows={[['Compte', change.username]]} />
      {disable ? (
        <p>
          Ce compte ne pourra plus se connecter&#x202F;; ses actions restent dans le journal
          d’audit.
        </p>
      ) : (
        <ChoiceGroup
          legend="Rôle"
          name="account-role"
          value={role}
          options={ROLE_OPTIONS}
          onChange={(r) => onRole?.(r)}
        />
      )}
      <ReasonField
        of={disable ? 'de la désactivation' : 'du changement de rôle'}
        placeholder={disable ? REASON_EXAMPLES.disableAccount : REASON_EXAMPLES.changeRole}
        value={reason}
        error={error}
        onChange={setReason}
      />
      {failure && <FailureAlert problem={failure} />}
      <div className="button-row dialog-actions">
        <Button variant="secondary" data-safe onClick={onCancel}>
          Annuler
        </Button>
        <Button variant={disable ? 'danger' : 'primary'} type="submit" busy={busy}>
          {disable ? 'Désactiver' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Boîte de changement de rôle ou de désactivation : rien n'est envoyé avant la validation.
 * `run` rend `true` (la boîte se ferme) ou le message d'erreur affiché dans la boîte.
 */
export function AccountChangeDialog({
  change,
  run,
  onClose,
}: {
  change: AccountChange | null;
  run: (reason: string, role: Role) => Promise<true | Problem>;
  onClose: () => void;
}) {
  const [role, setRole] = useState<Role>('operator');
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRole(change?.role ?? 'operator');
    setError(undefined);
    setFailure(undefined);
    setBusy(false);
  }, [change]);
  return (
    <Dialog open={change !== null} title={change ? changeTitle(change) : ''} onClose={onClose}>
      {change && (
        <AccountChangeForm
          change={change}
          role={role}
          error={error}
          failure={failure}
          busy={busy}
          onRole={setRole}
          onCancel={onClose}
          onSubmit={(reason) => {
            if (busy) return;
            if (!reason) {
              setError(REASON.error);
              return;
            }
            setError(undefined);
            setFailure(undefined);
            setBusy(true);
            void run(reason, role).then((result) => {
              setBusy(false);
              if (result === true) onClose();
              else setFailure(result);
            });
          }}
        />
      )}
    </Dialog>
  );
}
