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
import { Alert, Button, DataTable, type Column } from './ui/index.js';

export type AccountsState = AccountInfo[] | 'loading' | 'error';

export interface AccountActions {
  onRole: (id: number, role: Role) => void;
  onDisabled: (id: number, disabled: boolean) => void;
  /** Résout à `true` si la requête a réussi : le formulaire n'est vidé qu'alors. */
  onCreate: (form: FormData) => Promise<boolean> | void;
  onReset: (form: FormData) => Promise<boolean> | void;
}

const stateOf = (a: AccountInfo): string =>
  a.disabled ? 'Désactivé' : a.mustChangePassword ? 'Mot de passe à changer' : 'Actif';

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
    cell: (a) => {
      const last = isLastAdmin(state, a);
      return (
        <>
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
          {last && (
            <>
              {' '}
              <span id={`last-admin-${a.id}`}>{LAST_ADMIN_NOTICE}</span>
            </>
          )}
        </>
      );
    },
  },
];

/** Tableau des comptes et formulaires de création et de réinitialisation. */
export function AccountsView({
  state,
  message,
  actions,
  dialog,
  onRetry,
}: {
  /** Boîte de réinitialisation (étapes 2 et 3). */
  dialog?: ReactNode;
  state: AccountsState;
  message?: { kind: 'error' | 'status'; text: string };
  actions?: Partial<AccountActions>;
  onRetry?: () => void;
}) {
  // La boîte reste montée même si la liste charge ou échoue : elle porte le mot de passe
  // temporaire, qui ne peut pas être relu.
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
  const submit =
    (handler?: (form: FormData) => Promise<boolean> | void) => (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      void Promise.resolve(handler?.(new FormData(form))).then((ok) => {
        if (ok === true) form.reset();
      });
    };
  return (
    <>
      {message && (
        <Alert tone={message.kind === 'error' ? 'error' : 'success'}>{message.text}</Alert>
      )}
      <DataTable
        caption="Comptes de la console"
        hideCaption
        columns={columns(state, actions)}
        rows={state}
        rowKey={(a) => a.id}
      />
      {!state.some((a) => a.role === 'operator') && <p>{NO_OPERATOR}</p>}
      <h2>Créer un compte</h2>
      <form onSubmit={submit(actions?.onCreate)}>
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
        <div className="button-row">
          <Button type="submit">Nouveau compte</Button>
          <Button type="reset" variant="secondary">
            Annuler
          </Button>
        </div>
      </form>
      <h2>Réinitialiser un mot de passe</h2>
      <p>
        Un mot de passe temporaire est généré et affiché une seule fois ; l’utilisateur devra le
        changer à sa prochaine connexion.
      </p>
      <form onSubmit={submit(actions?.onReset)}>
        <p>
          <label>
            Compte{' '}
            <select name="id" required>
              {state.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </select>
          </label>
        </p>
        <div className="button-row">
          <Button type="submit">{RESET_TEXTS.title}</Button>
        </div>
      </form>
      {dialog}
      <p>{AUDIT_NOTICE}</p>
    </>
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
        return outcome.ok;
      },
      () => {
        setMessage({ kind: 'error', text: UNREACHABLE });
        return false;
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
    // Étape 1 : ouvre la boîte du compte choisi (étapes 2 et 3).
    onReset: (form) => {
      const id = Number(text(form, 'id'));
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
      <h1>Comptes de la console</h1>
      <AccountsView
        state={state}
        message={message}
        actions={actions}
        dialog={
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
        }
        onRetry={() => {
          setState('loading');
          reload();
        }}
      />
    </main>
  );
}
