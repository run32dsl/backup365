import { useEffect, useState, type FormEvent } from 'react';
import { RESET_TEXTS, ROLE_OPTIONS } from '../accounts.js';
import type { Problem } from '../apiError.js';
import { FailureAlert } from '../FailureAlert.js';
import { Field, text } from '../login/Field.js';
import { TemporaryPasswordStep } from '../ResetPassword.js';
import type { Role } from '../session.js';
import { Button, ChoiceGroup, Dialog } from '../ui/index.js';
import type { AccountActions } from './AccountsView.js';

/** Contenu de la boîte « Créer un compte ». Sans état : `error` et `busy` viennent de la boîte. */
export function CreateAccountForm({
  error,
  busy = false,
  onSubmit,
  onCancel,
}: {
  error?: Problem | undefined;
  busy?: boolean;
  onSubmit?: (form: FormData) => void;
  onCancel?: () => void;
}) {
  const [role, setRole] = useState<Role>('operator');
  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit?.(new FormData(e.currentTarget));
      }}
    >
      {error && <FailureAlert problem={error} />}
      <Field label="Identifiant" name="username" autoComplete="off" />
      <ChoiceGroup<Role>
        legend="Rôle"
        name="role"
        value={role}
        options={ROLE_OPTIONS}
        onChange={setRole}
      />
      <p>
        Un mot de passe temporaire sera créé et affiché une seule fois. Le compte devra le changer à
        sa première connexion.
      </p>
      <div className="button-row dialog-actions">
        <Button variant="secondary" data-safe onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" busy={busy}>
          Créer le compte
        </Button>
      </div>
    </form>
  );
}

/**
 * Boîte « Créer un compte » : une fois le compte créé, elle montre le mot de passe temporaire
 * (même étape qu'après une réinitialisation) et ne se ferme qu'une fois la case cochée.
 */
export function CreateAccountDialog({
  open,
  onCreate,
  onClose,
}: {
  open: boolean;
  onCreate: AccountActions['onCreate'];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Problem>();
  const [created, setCreated] = useState<{ username: string; password: string }>();
  const [handed, setHanded] = useState(false);
  useEffect(() => {
    setBusy(false);
    setError(undefined);
    setCreated(undefined);
    setHanded(false);
  }, [open]);
  return (
    <Dialog
      open={open}
      title={created ? `${RESET_TEXTS.resultTitle} de ${created.username}` : 'Créer un compte'}
      // Ni « ✕ » ni Échap tant que la case n'est pas cochée.
      dismissible={!created || handed}
      onClose={onClose}
    >
      {created ? (
        <TemporaryPasswordStep
          username={created.username}
          password={created.password}
          onHanded={setHanded}
          onDone={onClose}
        />
      ) : (
        <CreateAccountForm
          error={error}
          busy={busy}
          onCancel={onClose}
          onSubmit={(form) => {
            if (busy) return;
            setBusy(true);
            setError(undefined);
            void onCreate(form).then((result) => {
              setBusy(false);
              if ('password' in result) {
                setCreated({ username: text(form, 'username').trim(), password: result.password });
              } else setError(result.error);
            });
          }}
        />
      )}
    </Dialog>
  );
}
