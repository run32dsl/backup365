import type { ReactNode } from 'react';
import {
  LAST_ADMIN_NOTICE,
  NO_OPERATOR,
  OIDC_MANAGED_NOTICE,
  RESET_TEXTS,
  ROLE_LABELS,
  isLastAdmin,
  type AccountInfo,
} from '../accounts.js';
import type { Problem } from '../apiError.js';
import { FailureAlert } from '../FailureAlert.js';
import { ErrorView } from '../login/Field.js';
import { Address, Alert, Button, DataTable, StatusPill, type Column } from '../ui/index.js';

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
    className: 'card-title address',
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
