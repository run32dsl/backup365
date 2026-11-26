import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import type { Mailbox } from '@backup365/core';
import { FailureAlert } from '../FailureAlert.js';
import type { Problem } from '../apiError.js';
import {
  AuditReminder,
  REASON_EXAMPLES,
  RESTORE_BUTTONS as B,
  ReasonField,
  RunningProgress,
} from '../RestoreJourney.js';
import { failureCause, isOutcomeUncertain, RESTORE_MESSAGES, type RestoreJob } from '../restore.js';
import { RestoreFailureAlert, restoreFailureBanner, sdkRefusalCause } from '../restoreFailure.js';
import { quoted } from '../format.js';
import { Alert, Button, ChoiceGroup, FormField, ResultList } from '../ui/index.js';
import { TRANSFER as T, accountLabel, confirmLabel, foundLabel, readWarning } from './model.js';

/** Résultat de la recherche : pas encore lancée, en cours, en échec, ou les comptes trouvés. */
export type SearchState = 'idle' | 'loading' | 'error' | Mailbox[];

/** Barre d'actions d'une étape : retour (ou annuler) en contour, action principale pleine. */
function Actions({ back, children }: { back: ReactNode; children: ReactNode }) {
  return (
    <div className="button-row dialog-actions">
      {back}
      {children}
    </div>
  );
}

/** Choix de la destination (administrateurs) : la boîte d'origine ou celle d'un autre compte. */
export function DestinationChoice({
  value,
  onChange,
}: {
  value: 'origin' | 'other';
  onChange: (value: 'origin' | 'other') => void;
}) {
  return (
    <ChoiceGroup
      legend={T.legend}
      name="restore-destination"
      value={value}
      options={[
        { value: 'origin', label: T.origin },
        { value: 'other', label: T.other },
      ]}
      onChange={(next) => {
        onChange(next);
        // Le choix change de place dans la boîte : le focus le suit.
        requestAnimationFrame(() => {
          document
            .querySelector<HTMLInputElement>('input[name="restore-destination"]:checked')
            ?.focus();
        });
      }}
    />
  );
}

/** A1. Destination : le choix « compte d'origine / autre compte », la recherche, le compte visé. */
export function DestinationView({
  source,
  choice,
  query,
  search,
  selected,
  error,
  onQuery,
  onSearch,
  onSelect,
  onCancel,
  onContinue,
}: {
  source: Mailbox;
  choice: ReactNode;
  query: string;
  search: SearchState;
  selected: string;
  error?: string | undefined;
  onQuery: (q: string) => void;
  onSearch: () => void;
  onSelect: (id: string) => void;
  onCancel: () => void;
  onContinue: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Entrée lance la recherche ; « Continuer » reste le bouton d'envoi du formulaire.
    if (e.key === 'Enter') {
      e.preventDefault();
      onSearch();
    }
  };
  return (
    <form onSubmit={onContinue} noValidate>
      <p>
        <strong>Source :</strong>{' '}
        <span className="wrap-anywhere">{`Boîte de ${accountLabel(source)}`}</span>
      </p>
      {choice}
      <FormField
        label={T.search}
        type="search"
        name="account-search"
        autoComplete="off"
        value={query}
        error={error}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          onQuery(e.currentTarget.value);
        }}
        adornment={() => (
          <Button variant="secondary" busy={search === 'loading'} onClick={onSearch}>
            {T.searchButton}
          </Button>
        )}
      />
      <p role="status" className={typeof search === 'object' && search.length > 0 ? 'sr-only' : ''}>
        {search === 'loading'
          ? T.searching
          : search === 'error'
            ? T.unavailable
            : typeof search === 'object'
              ? foundLabel(search.length)
              : ''}
      </p>
      {typeof search === 'object' && search.length > 0 && (
        <div className="wrap-anywhere account-results">
          <ChoiceGroup
            legend={T.results}
            name="target-account"
            value={selected}
            onChange={onSelect}
            options={search.map((m) => ({
              value: m.id,
              label: accountLabel(m),
              ...(m.id === source.id ? { disabled: true, hint: T.sourceHint } : {}),
            }))}
          />
        </div>
      )}
      <Actions
        back={
          <Button variant="secondary" data-safe onClick={onCancel}>
            {B.cancel}
          </Button>
        }
      >
        <Button type="submit">{B.next}</Button>
      </Actions>
    </form>
  );
}

/** A2. Motif : rappel d'audit et motif obligatoire. */
export function ReasonView({
  reason,
  error,
  onReason,
  onBack,
  onContinue,
}: {
  reason: string;
  error?: string | undefined;
  onReason: (r: string) => void;
  onBack: () => void;
  onContinue: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onContinue} noValidate>
      <AuditReminder />
      <ReasonField
        placeholder={REASON_EXAMPLES.transfer}
        value={reason}
        error={error}
        onChange={onReason}
      />
      <Actions
        back={
          <Button variant="secondary" data-safe onClick={onBack}>
            {B.back}
          </Button>
        }
      >
        <Button type="submit">{B.next}</Button>
      </Actions>
    </form>
  );
}

/** A3. Confirmation : récapitulatif source → destination, avertissement, puis « Restaurer vers… ». */
export function ConfirmView({
  rows,
  targetName,
  sending,
  failure,
  onBack,
  onConfirm,
}: {
  rows: [string, string][];
  targetName: string;
  sending: boolean;
  failure?: Problem | undefined;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <div className="wrap-anywhere">
        <ResultList rows={rows} />
      </div>
      <Alert tone="warning">{readWarning(targetName)}</Alert>
      {sending && (
        <p role="status" className="sr-only">
          {T.sending}
        </p>
      )}
      {failure && <FailureAlert problem={failure} />}
      <Actions
        back={
          <Button variant="secondary" data-safe onClick={onBack}>
            {B.back}
          </Button>
        }
      >
        <Button busy={sending} onClick={onConfirm}>
          {confirmLabel(targetName)}
        </Button>
      </Actions>
    </>
  );
}

/** A4. Suivi puis résultat d'une restauration vers un autre compte. */
export function TransferOutcome({
  job,
  subject,
  onClose,
  onRetry,
}: {
  job: RestoreJob & { transfer: NonNullable<RestoreJob['transfer']> };
  subject: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { sourceName, targetName } = job.transfer;
  const folder = <p className="wrap-anywhere">{`Dossier : ${job.folder}`}</p>;
  const close = (
    <Button variant={job.status === 'failed' ? 'secondary' : 'primary'} onClick={onClose}>
      Fermer
    </Button>
  );
  const audit = (
    <a className="btn btn-secondary" href="#/audit">
      {B.audit}
    </a>
  );
  if (job.status === 'running') {
    return (
      <>
        <RunningProgress detail={`Restauration vers ${targetName}`} />
        {folder}
        <Actions back={audit}>{close}</Actions>
      </>
    );
  }
  if (job.status === 'succeeded') {
    return (
      <>
        <Alert tone="success">
          {`${quoted(subject)} de ${sourceName} a été restauré vers ${targetName}.`}
        </Alert>
        {folder}
        <Actions back={audit}>{close}</Actions>
      </>
    );
  }
  const uncertain = isOutcomeUncertain(job.error);
  const destination = `la boîte de ${targetName}`;
  return (
    <>
      <RestoreFailureAlert
        banner={restoreFailureBanner({
          item: subject,
          at: job.finishedAt ?? job.startedAt,
          cause: sdkRefusalCause(job.error, destination)
            ? `${sdkRefusalCause(job.error, destination) ?? ''}.`
            : `restauration vers ${destination} : ${failureCause(job.error)}`,
          consequence: uncertain
            ? `L’état de ${destination} est incertain : vérifiez le dossier ${quoted(job.folder)} avant de réessayer.`
            : RESTORE_MESSAGES.untouched,
          uncertain,
        })}
      />
      <Actions back={audit}>
        {close}
        <Button onClick={onRetry}>{B.retry}</Button>
      </Actions>
    </>
  );
}
