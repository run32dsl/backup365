import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  LAST_ADMIN_NOTICE,
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
import { AUDIT_NOTICE, UNREACHABLE, type Outcome, type Role } from './session.js';

export type AccountsState = AccountInfo[] | 'loading' | 'error';

export interface AccountActions {
  onRole: (id: number, role: Role) => void;
  onDisabled: (id: number, disabled: boolean) => void;
  onCreate: (form: FormData) => void;
  onReset: (form: FormData) => void;
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

/** Tableau des comptes et formulaires de création et de réinitialisation. */
export function AccountsView({
  state,
  message,
  actions,
  onRetry,
}: {
  state: AccountsState;
  message?: { kind: 'error' | 'status'; text: string };
  actions?: Partial<AccountActions>;
  onRetry?: () => void;
}) {
  if (state === 'loading') return <p role="status">Chargement des comptes…</p>;
  if (state === 'error') return <ErrorView message="Comptes indisponibles" onRetry={onRetry} />;
  const submit = (handler?: (form: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handler?.(new FormData(e.currentTarget));
    e.currentTarget.reset();
  };
  return (
    <>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <table>
        <thead>
          <tr>
            <th>Identifiant</th>
            <th>Rôle</th>
            <th>État</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {state.map((a) => {
            const last = isLastAdmin(state, a);
            return (
              <tr key={a.id}>
                <td>{a.username}</td>
                <td>
                  <RoleSelect
                    value={a.role}
                    locked={last}
                    describedBy={`last-admin-${a.id}`}
                    onChange={(role) => actions?.onRole?.(a.id, role)}
                  />
                </td>
                <td>{stateOf(a)}</td>
                <td>
                  <button
                    type="button"
                    aria-disabled={last || undefined}
                    aria-describedby={last ? `last-admin-${a.id}` : undefined}
                    onClick={() => {
                      if (!last) actions?.onDisabled?.(a.id, !a.disabled);
                    }}
                  >
                    {a.disabled ? 'Réactiver' : 'Désactiver'}
                  </button>
                  {last && (
                    <>
                      {' '}
                      <span id={`last-admin-${a.id}`}>{LAST_ADMIN_NOTICE}</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
          label="Mot de passe provisoire (12 caractères au minimum)"
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
        <button type="submit">Nouveau compte</button> <button type="reset">Annuler</button>
      </form>
      <h2>Réinitialiser un mot de passe</h2>
      <p>L’utilisateur devra le changer à sa prochaine connexion.</p>
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
        <Field
          label="Mot de passe provisoire"
          name="password"
          type="password"
          autoComplete="new-password"
        />
        <button type="submit">Réinitialiser</button> <button type="reset">Annuler</button>
      </form>
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
  const reload = useCallback(() => {
    fetchAccounts().then(setState, () => setState('error'));
  }, []);
  useEffect(reload, [reload]);

  const run = (done: string, request: Promise<Outcome<null>>) => {
    request.then(
      (outcome) => {
        setMessage(
          outcome.ok ? { kind: 'status', text: done } : { kind: 'error', text: outcome.message },
        );
        reload();
      },
      () => setMessage({ kind: 'error', text: UNREACHABLE }),
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
    onReset: (form) =>
      run(
        `Mot de passe réinitialisé : ${nameOf(Number(text(form, 'id')))} devra le changer à sa prochaine connexion.`,
        resetPassword(Number(text(form, 'id')), text(form, 'password')),
      ),
  };
  return (
    <main>
      <h1>Comptes de la console</h1>
      <AccountsView
        state={state}
        message={message}
        actions={actions}
        onRetry={() => {
          setState('loading');
          reload();
        }}
      />
    </main>
  );
}
