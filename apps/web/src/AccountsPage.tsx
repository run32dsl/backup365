import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  LAST_ADMIN_NOTICE,
  OIDC_MANAGED_NOTICE,
  RESET_TEXTS,
  NO_OPERATOR,
  ROLE_LABELS,
  ROLE_OPTIONS,
  isLastAdmin,
  createAccount,
  fetchAccounts,
  resetPassword,
  updateAccount,
  type AccountInfo,
} from './accounts.js';
import { AccountChangeDialog, changeDone, type AccountChange } from './AccountChange.js';
import { requestIdOf, type Problem } from './apiError.js';
import { FailureAlert } from './FailureAlert.js';
import { ErrorView, Field } from './LoginPage.js';
import { ResetPasswordDialog, TemporaryPasswordStep } from './ResetPassword.js';
import { AUDIT_NOTICE, UNREACHABLE, type Outcome, type Role } from './session.js';
import {
  Address,
  Alert,
  Button,
  ChoiceGroup,
  DataTable,
  Dialog,
  StatusPill,
  type Column,
} from './ui/index.js';

export type AccountsState = AccountInfo[] | 'loading' | 'error';

export interface AccountActions {
  /** Ouvre la boîte de changement de rôle du compte de la ligne. */
  onRole: (id: number) => void;
  /** Désactiver ouvre une boîte avec motif ; réactiver s'applique tout de suite. */
  onDisabled: (id: number, disabled: boolean) => void;
  /** Résout au mot de passe temporaire si le compte est créé, sinon au message d'erreur affiché dans la boîte. */
  onCreate: (form: FormData) => Promise<{ password: string } | { error: Problem }>;
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

const columns = (
  state: AccountInfo[],
  actions?: Partial<AccountActions>,
): Column<AccountInfo>[] => [
  {
    header: 'Identifiant',
    className: 'card-title',
    cell: (a) => (
      <>
        <Address value={a.username} />
        {a.oidc && <span className="acct-kind"> (Microsoft)</span>}
      </>
    ),
  },
  {
    header: 'Rôle',
    className: 'nowrap card-nolabel acct-inline',
    cell: (a) => ROLE_LABELS[a.role],
  },
  { header: 'État', className: 'card-nolabel acct-inline', cell: stateOf },
  {
    header: 'Actions',
    className: 'card-action',
    cell: (a) => {
      const last = isLastAdmin(state, a);
      const lock = {
        'aria-disabled': last || undefined,
        'aria-describedby': last ? `last-admin-${a.id}` : undefined,
      };
      // Le rôle et le mot de passe d'un compte Microsoft viennent d'Entra : boutons grisés.
      const managed = a.oidc
        ? {
            'aria-disabled': true as const,
            'aria-describedby': last ? `oidc-${a.id} last-admin-${a.id}` : `oidc-${a.id}`,
          }
        : lock;
      return (
        <div className="button-row">
          {a.oidc && (
            <span id={`oidc-${a.id}`} className="cell-secondary action-reason">
              {OIDC_MANAGED_NOTICE}
            </span>
          )}
          {last && (
            <span id={`last-admin-${a.id}`} className="cell-secondary action-reason">
              {LAST_ADMIN_NOTICE}
            </span>
          )}
          <Button
            variant="secondary"
            {...(a.oidc ? managed : {})}
            aria-label={`${RESET_TEXTS.title} : ${a.username}`}
            onClick={() => {
              if (!a.oidc) actions?.onReset?.(a.id);
            }}
          >
            {RESET_TEXTS.title}
          </Button>
          <Button
            variant="secondary"
            className="action-half"
            {...managed}
            aria-label={`Modifier le rôle : ${a.username}`}
            onClick={() => {
              if (!last && !a.oidc) actions?.onRole?.(a.id);
            }}
          >
            Modifier le rôle
          </Button>
          <Button
            className="action-half"
            variant={a.disabled ? 'secondary' : 'danger'}
            {...lock}
            aria-label={`${a.disabled ? 'Réactiver' : 'Désactiver'} : ${a.username}`}
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
  loadRequestId,
}: {
  /** Boîtes de création et de réinitialisation (étapes 2 et 3). */
  dialog?: ReactNode;
  state: AccountsState;
  message?: { kind: 'error' | 'status'; text: string; requestId?: string | undefined };
  actions?: Partial<AccountActions>;
  onRetry?: () => void;
  loadRequestId?: string | undefined;
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
        <ErrorView message="Comptes indisponibles" requestId={loadRequestId} onRetry={onRetry} />
        {dialog}
      </>
    );
  return (
    <>
      {message &&
        (message.kind === 'error' ? (
          <FailureAlert problem={{ message: message.text, requestId: message.requestId }} />
        ) : (
          <Alert tone="success">{message.text}</Alert>
        ))}
      <DataTable
        caption="Comptes de la console"
        hideCaption
        columns={columns(state, actions)}
        rows={state}
        rowKey={(a) => a.id}
      />
      {!state.some((a) => a.role === 'operator') && <p>{NO_OPERATOR}</p>}
      {dialog}
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

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

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

/** Gestion des comptes (écran `#/comptes`, administrateur seulement). */
export function AccountsPage() {
  const [state, setState] = useState<AccountsState>('loading');
  const [message, setMessage] = useState<{
    kind: 'error' | 'status';
    text: string;
    requestId?: string | undefined;
  }>();
  const [reset, setReset] = useState<{ id: number; username: string } | null>(null);
  const [change, setChange] = useState<AccountChange | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadRequestId, setLoadRequestId] = useState<string>();
  const resetDone = useRef(false);
  const reload = useCallback(() => {
    fetchAccounts().then(setState, (e: unknown) => {
      setLoadRequestId(requestIdOf(e));
      setState('error');
    });
  }, []);
  useEffect(reload, [reload]);

  const run = (done: string, request: Promise<Outcome<null>>) => {
    return request.then(
      (outcome) => {
        setMessage(
          outcome.ok
            ? { kind: 'status', text: done }
            : { kind: 'error', text: outcome.message, requestId: outcome.requestId },
        );
        reload();
        return outcome.ok
          ? (true as const)
          : { message: outcome.message, requestId: outcome.requestId };
      },
      () => {
        setMessage({ kind: 'error', text: UNREACHABLE });
        return { message: UNREACHABLE };
      },
    );
  };

  const nameOf = (id: number) =>
    (Array.isArray(state) ? state.find((a) => a.id === id)?.username : undefined) ?? 'le compte';
  const openChange = (id: number, kind: AccountChange['kind']) => {
    const account = Array.isArray(state) ? state.find((a) => a.id === id) : undefined;
    if (account) setChange({ id, kind, username: account.username, role: account.role });
  };
  const runChange = (reason: string, role: Role) => {
    if (!change) return Promise.resolve({ message: UNREACHABLE });
    const patch = change.kind === 'role' ? { role, reason } : { disabled: true, reason };
    return run(changeDone(change, role), updateAccount(change.id, patch));
  };
  const actions: AccountActions = {
    // Rôle et désactivation : une boîte avec motif ; rien n'est envoyé avant sa validation.
    onRole: (id) => {
      openChange(id, 'role');
    },
    onDisabled: (id, disabled) => {
      if (disabled) openChange(id, 'disable');
      else void run(`${nameOf(id)} est réactivé.`, updateAccount(id, { disabled }));
    },
    onCreate: async (form) => {
      try {
        const outcome = await createAccount(
          text(form, 'username').trim(),
          text(form, 'role') as Role,
        );
        if (outcome.ok) {
          setMessage({ kind: 'status', text: 'Compte créé.' });
          reload();
          return { password: outcome.value };
        }
        return { error: { message: outcome.message, requestId: outcome.requestId } };
      } catch {
        return { error: { message: UNREACHABLE } };
      }
    },
    // Étape 1 : ouvre la boîte du compte de la ligne (étapes 2 et 3).
    onReset: (id) => {
      setReset({ id, username: nameOf(id) });
    },
  };
  const runReset = async (reason: string) => {
    if (!reset) return { error: { message: UNREACHABLE } };
    try {
      const outcome = await resetPassword(reset.id, reason);
      if (outcome.ok) {
        resetDone.current = true;
        return { password: outcome.value };
      }
      return { error: { message: outcome.message, requestId: outcome.requestId } };
    } catch {
      return { error: { message: UNREACHABLE } };
    }
  };
  return (
    <main tabIndex={-1}>
      <h1>Réglages</h1>
      <div className="view-intro">
        <p>Comptes qui peuvent se connecter à la console. {AUDIT_NOTICE}</p>
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
        loadRequestId={loadRequestId}
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
            <AccountChangeDialog
              change={change}
              run={runChange}
              onClose={() => {
                setChange(null);
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
