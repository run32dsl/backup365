import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ROLE_LABELS,
  createAccount,
  fetchAccounts,
  resetPassword,
  updateAccount,
  type AccountInfo,
} from './accounts.js';
import { Field } from './LoginPage.js';
import type { Outcome, Role } from './session.js';

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
  onChange,
}: {
  name?: string;
  value?: Role;
  onChange?: (r: Role) => void;
}) {
  return (
    <select
      name={name}
      defaultValue={value}
      onChange={onChange && ((e) => onChange(e.currentTarget.value as Role))}
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
}: {
  state: AccountsState;
  message?: { kind: 'error' | 'status'; text: string };
  actions?: Partial<AccountActions>;
}) {
  if (state === 'loading') return <p role="status">Chargement des comptes…</p>;
  if (state === 'error') return <p role="alert">Comptes indisponibles</p>;
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
          {state.map((a) => (
            <tr key={a.id}>
              <td>{a.username}</td>
              <td>
                <RoleSelect value={a.role} onChange={(role) => actions?.onRole?.(a.id, role)} />
              </td>
              <td>{stateOf(a)}</td>
              <td>
                <button type="button" onClick={() => actions?.onDisabled?.(a.id, !a.disabled)}>
                  {a.disabled ? 'Réactiver' : 'Désactiver'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <button type="submit">Créer</button>
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
        <button type="submit">Réinitialiser</button>
      </form>
    </>
  );
}

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Gestion des comptes (écran `#/accounts`, administrateur seulement). */
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
      () => setMessage({ kind: 'error', text: 'Serveur injoignable.' }),
    );
  };

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
        'Mot de passe réinitialisé.',
        resetPassword(Number(text(form, 'id')), text(form, 'password')),
      ),
  };
  return (
    <main>
      <h1>Comptes</h1>
      <AccountsView state={state} message={message} actions={actions} />
    </main>
  );
}
