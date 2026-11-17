import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  LAST_ADMIN_NOTICE,
  RESET_TEXTS,
  NO_OPERATOR,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  isLastAdmin,
  createAccount,
  fetchAccounts,
  resetPassword,
  updateAccount,
  type AccountInfo,
} from './accounts.js';
import { ErrorView, Field } from './LoginPage.js';
import { ResetPasswordDialog } from './ResetPassword.js';
import { AUDIT_NOTICE, UNREACHABLE, type Outcome, type Role } from './session.js';
import { Alert, Button, DataTable, Dialog, StatusPill, type Column } from './ui/index.js';

export type AccountsState = AccountInfo[] | 'loading' | 'error';

export interface AccountActions {
  onRole: (id: number, role: Role) => void;
  onDisabled: (id: number, disabled: boolean) => void;
  /** Résout à `true` si le compte est créé (la boîte se ferme), sinon au message d'erreur affiché dans la boîte. */
  onCreate: (form: FormData) => Promise<true | string>;
  /** Ouvre la boîte de réinitialisation du compte de la ligne. */
  onReset: (id: number) => void;
}

const stateOf = (a: AccountInfo) =>
  a.disabled ? (
    <StatusPill status="failed" label="Désactivé" />
  ) : a.mustChangePassword ? (
    <StatusPill status="late" label="Mot de passe à changer" />
  ) : (
    <StatusPill status="compliant" label="Actif" />
  );

function RoleSelect({
  name,
  value,
  locked = false,
  describedBy,
  onChange,
}: {
  name?: string;
  value?: Role;
  locked?: boolean;
  describedBy?: string;
  onChange?: (r: Role) => void;
}) {
  return (
    <select
      name={name}
      aria-disabled={locked || undefined}
      aria-describedby={locked ? describedBy : undefined}
      {...(name ? { defaultValue: value } : { value })}
      onChange={(e) => {
        if (!locked) onChange?.(e.currentTarget.value as Role);
      }}
    >
      {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}

const columns = (
  state: AccountInfo[],
  actions?: Partial<AccountActions>,
): Column<AccountInfo>[] => [
  { header: 'Identifiant', cell: (a) => (a.oidc ? `${a.username} (Microsoft)` : a.username) },
  {
    header: 'Rôle',
    cell: (a) => (
      <RoleSelect
        value={a.role}
        locked={isLastAdmin(state, a)}
        describedBy={`last-admin-${a.id}`}
        onChange={(role) => actions?.onRole?.(a.id, role)}
      />
    ),
  },
  { header: 'État', cell: stateOf },
  {
    header: 'Actions',
    className: 'card-action',
    cell: (a) => {
      const last = isLastAdmin(state, a);
      return (
        <div className="button-row">
          <Button
            variant="secondary"
            aria-label={`${RESET_TEXTS.title} : ${a.username}`}
            onClick={() => actions?.onReset?.(a.id)}
          >
            {RESET_TEXTS.title}
          </Button>
          <Button
            variant="secondary"
            aria-disabled={last || undefined}
            aria-describedby={last ? `last-admin-${a.id}` : undefined}
            onClick={() => {
              if (!last) actions?.onDisabled?.(a.id, !a.disabled);
            }}
          >
            {a.disabled ? 'Réactiver' : 'Désactiver'}
          </Button>
        </div>
      );
    },
  },
];

/** Tableau des comptes ; la création et la réinitialisation s'ouvrent en boîtes (`dialog`). */
export function AccountsView({
  state,
  message,
  actions,
  dialog,
  onRetry,
}: {
  /** Boîtes de création et de réinitialisation (étapes 2 et 3). */
  dialog?: ReactNode;
  state: AccountsState;
  message?: { kind: 'error' | 'status'; text: string };
  actions?: Partial<AccountActions>;
  onRetry?: () => void;
}) {
  // Les boîtes restent montées même si la liste charge ou échoue : celle du mot de passe
  // temporaire porte un mot de passe qui ne peut pas être relu.
  if (state === 'loading')
    return (
      <>
        <p role="status">Chargement des comptes…</p>
        {dialog}
      </>
    );
  if (state === 'error')
    return (
      <>
        <ErrorView message="Comptes indisponibles" onRetry={onRetry} />
        {dialog}
      </>
    );
  const lastAdmin = state.find((a) => isLastAdmin(state, a));
  return (
    <>
      {message && (
        <Alert tone={message.kind === 'error' ? 'error' : 'success'}>{message.text}</Alert>
      )}
      {lastAdmin && (
        <Alert id={`last-admin-${lastAdmin.id}`} tone="info">
          {LAST_ADMIN_NOTICE}
        </Alert>
      )}
      <h2>Comptes de la console</h2>
      <DataTable
        caption="Comptes de la console"
        hideCaption
        columns={columns(state, actions)}
        rows={state}
        rowKey={(a) => a.id}
      />
      {!state.some((a) => a.role === 'operator') && <p>{NO_OPERATOR}</p>}
      {dialog}
      <p>{AUDIT_NOTICE}</p>
    </>
  );
}

/** Contenu de la boîte « Créer un compte ». Sans état : `error` et `busy` viennent de la boîte. */
export function CreateAccountForm({
  error,
  busy = false,
  onSubmit,
  onCancel,
}: {
  error?: string;
  busy?: boolean;
  onSubmit?: (form: FormData) => void;
  onCancel?: () => void;
}) {
  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit?.(new FormData(e.currentTarget));
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <p>
        <label>
          Identifiant <input name="username" autoComplete="off" required />
        </label>
      </p>
      <p>
        <label>
          Rôle <RoleSelect name="role" value="operator" />
        </label>
      </p>
      <Field
        label="Mot de passe temporaire (12 caractères au minimum)"
        name="password"
        type="password"
        autoComplete="new-password"
      />
      <ul>
        {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
          <li key={role}>
            {ROLE_LABELS[role]} : {ROLE_DESCRIPTIONS[role]}
          </li>
        ))}
      </ul>
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

/** Décide de la suite d'une création : la boîte se ferme si elle a réussi, sinon elle reste. */
export async function submitCreate(
  create: (form: FormData) => Promise<true | string>,
  form: FormData,
  close: () => void,
): Promise<string | undefined> {
  const result = await create(form);
  if (result === true) {
    close();
    return undefined;
  }
  return result;
}

/** Boîte « Créer un compte » : se ferme sur « Annuler » ou quand la création a réussi. */
export function CreateAccountDialog({
  open,
  onCreate,
  onClose,
}: {
  open: boolean;
  onCreate: (form: FormData) => Promise<true | string>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setBusy(false);
    setError(undefined);
  }, [open]);
  return (
    <Dialog open={open} title="Créer un compte" onClose={onClose}>
      <CreateAccountForm
        error={error}
        busy={busy}
        onCancel={onClose}
        onSubmit={(form) => {
          if (busy) return;
          setBusy(true);
          void submitCreate(onCreate, form, onClose).then((failure) => {
            setBusy(false);
            setError(failure);
          });
        }}
      />
    </Dialog>
  );
}

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Gestion des comptes (écran `#/comptes`, administrateur seulement). */
export function AccountsPage() {
  const [state, setState] = useState<AccountsState>('loading');
  const [message, setMessage] = useState<{ kind: 'error' | 'status'; text: string }>();
  const [reset, setReset] = useState<{ id: number; username: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const resetDone = useRef(false);
  const reload = useCallback(() => {
    fetchAccounts().then(setState, () => setState('error'));
  }, []);
  useEffect(reload, [reload]);

  const run = (done: string, request: Promise<Outcome<null>>) => {
    return request.then(
      (outcome) => {
        setMessage(
          outcome.ok ? { kind: 'status', text: done } : { kind: 'error', text: outcome.message },
        );
        reload();
        return outcome.ok ? (true as const) : outcome.message;
      },
      () => {
        setMessage({ kind: 'error', text: UNREACHABLE });
        return UNREACHABLE;
      },
    );
  };

  const nameOf = (id: number) =>
    (Array.isArray(state) ? state.find((a) => a.id === id)?.username : undefined) ?? 'le compte';
  const actions: AccountActions = {
    onRole: (id, role) => run('Rôle modifié.', updateAccount(id, { role })),
    onDisabled: (id, disabled) =>
      run(disabled ? 'Compte désactivé.' : 'Compte réactivé.', updateAccount(id, { disabled })),
    onCreate: (form) =>
      run(
        'Compte créé.',
        createAccount(
          text(form, 'username').trim(),
          text(form, 'password'),
          text(form, 'role') as Role,
        ),
      ),
    // Étape 1 : ouvre la boîte du compte de la ligne (étapes 2 et 3).
    onReset: (id) => {
      setReset({ id, username: nameOf(id) });
    },
  };
  const runReset = async (reason: string) => {
    if (!reset) return { error: UNREACHABLE };
    try {
      const outcome = await resetPassword(reset.id, reason);
      if (outcome.ok) {
        resetDone.current = true;
        return { password: outcome.value };
      }
      return { error: outcome.message };
    } catch {
      return { error: UNREACHABLE };
    }
  };
  return (
    <main tabIndex={-1}>
      <div className="page-header">
        <h1>Administration</h1>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          <span aria-hidden="true">+ </span>
          Créer un compte
        </Button>
      </div>
      <AccountsView
        state={state}
        message={message}
        actions={actions}
        dialog={
          <>
            <CreateAccountDialog
              open={creating}
              onCreate={actions.onCreate}
              onClose={() => {
                setCreating(false);
              }}
            />
            <ResetPasswordDialog
              username={reset?.username ?? null}
              run={runReset}
              onClose={() => {
                setReset(null);
                // Rechargement après la lecture du mot de passe : la session du compte est révoquée.
                if (resetDone.current) reload();
                resetDone.current = false;
              }}
            />
          </>
        }
        onRetry={() => {
          setState('loading');
          reload();
        }}
      />
    </main>
  );
}
