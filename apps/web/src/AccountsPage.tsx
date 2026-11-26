import { useCallback, useEffect, useRef, useState } from 'react';
import { createAccount, fetchAccounts, resetPassword, updateAccount } from './accounts.js';
import { AccountChangeDialog, changeDone, type AccountChange } from './AccountChange.js';
import { AccountsView, type AccountActions, type AccountsState } from './accounts/AccountsView.js';
import { CreateAccountDialog } from './accounts/CreateAccount.js';
import { requestIdOf } from './apiError.js';
import { text } from './login/Field.js';
import { ResetPasswordDialog } from './ResetPassword.js';
import { AUDIT_NOTICE, UNREACHABLE, type Outcome, type Role } from './session.js';
import { Button, SettingsNav } from './ui/index.js';

// Tableau et boîte de création vivent sous `accounts/` ; ils restent importables d'ici.
export { AccountsView, type AccountActions, type AccountsState };
export { CreateAccountDialog, CreateAccountForm } from './accounts/CreateAccount.js';

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
      <SettingsNav current="accounts" />
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
