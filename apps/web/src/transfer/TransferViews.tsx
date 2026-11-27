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
import {
  failureCause,
  formatDuration,
  isOutcomeUncertain,
  RESTORE_MESSAGES,
  type RestoreJob,
} from '../restore.js';
import { RestoreFailureAlert, restoreFailureBanner, sdkRefusalCause } from '../restoreFailure.js';
import { folderRows, recallRows, WhatHappens, type RestorableMail } from '../restoreRows.js';
import { quoted } from '../format.js';
import { Alert, Button, ChoiceGroup, FormField, ResultList } from '../ui/index.js';
import {
  TRANSFER as T,
  CONFIRM_LABEL,
  accountLabel,
  foundLabel,
  READ_WARNING,
  transferBoxes,
} from './model.js';

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

/** A1. Destination : le choix « boîte d'origine / boîte d'un autre compte », la recherche, le compte visé. */
export function DestinationView({
  recall,
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
  /** Mail et boîte d'origine, dans la liste libellée commune aux deux destinations. */
  recall: [string, ReactNode][];
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
      <div className="wrap-anywhere">
        <ResultList rows={recall} />
      </div>
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

/** « Annuler » puis « Précédent », devant l'action principale, comme à l'étape 1 (#574). */
function CancelAndBack({ onCancel, onBack }: { onCancel: () => void; onBack: () => void }) {
  return (
    <>
      <Button variant="secondary" data-safe onClick={onCancel}>
        {B.cancel}
      </Button>
      <Button variant="secondary" data-safe onClick={onBack}>
        {B.back}
      </Button>
    </>
  );
}

/** A2. Motif : rappel d'audit et motif obligatoire. */
export function ReasonView({
  reason,
  error,
  onReason,
  onCancel,
  onBack,
  onContinue,
}: {
  reason: string;
  error?: string | undefined;
  onReason: (r: string) => void;
  onCancel: () => void;
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
      <Actions back={<CancelAndBack onCancel={onCancel} onBack={onBack} />}>
        <Button type="submit">{B.next}</Button>
      </Actions>
    </form>
  );
}

/** Récapitulatif de la confirmation : la liste libellée de la boîte d'origine, puis le motif. */
export function confirmRows(
  mail: RestorableMail,
  source: Mailbox,
  target: Mailbox,
  folder: string,
  reason: string,
): [string, ReactNode][] {
  return [
    ...recallRows(mail, transferBoxes(source, target)),
    ...folderRows(mail, folder, false, true),
    ['Motif', reason.trim()],
  ];
}

/**
 * A3. Confirmation : avertissement en tête (#590), liste libellée, « Ce qui va se passer », puis
 * l'action. L'adresse de destination n'est écrite qu'une fois, dans la liste.
 */
export function ConfirmView({
  rows,
  folder,
  sending,
  failure,
  onCancel,
  onBack,
  onConfirm,
}: {
  rows: [string, ReactNode][];
  folder: string;
  sending: boolean;
  failure?: Problem | undefined;
  onCancel: () => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <Alert tone="warning">{READ_WARNING}</Alert>
      <div className="wrap-anywhere">
        <ResultList rows={rows} />
      </div>
      <WhatHappens folder={folder} transfer />
      {sending && (
        <p role="status" className="sr-only">
          {T.sending}
        </p>
      )}
      {failure && <FailureAlert problem={failure} />}
      <Actions back={<CancelAndBack onCancel={onCancel} onBack={onBack} />}>
        <Button busy={sending} onClick={onConfirm}>
          {CONFIRM_LABEL}
        </Button>
      </Actions>
    </>
  );
}

/** A4. Suivi puis résultat : bandeau court et la même liste libellée que la boîte d'origine. */
export function TransferOutcome({
  job,
  mail,
  onClose,
  onRetry,
}: {
  job: RestoreJob & { transfer: NonNullable<RestoreJob['transfer']> };
  mail: RestorableMail;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { sourceName, targetId, targetName } = job.transfer;
  const failed = job.status === 'failed';
  const boxes = transferBoxes(
    { id: job.mailboxId, displayName: sourceName },
    { id: targetId, displayName: targetName },
  );
  const rows = (
    <div className="wrap-anywhere">
      <ResultList
        rows={[...recallRows(mail, boxes), ...folderRows(mail, job.folder, failed, true)]}
      />
    </div>
  );
  const close = (
    <Button variant={failed ? 'secondary' : 'primary'} onClick={onClose}>
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
        {rows}
        <Actions back={audit}>{close}</Actions>
      </>
    );
  }
  if (job.status === 'succeeded') {
    return (
      <>
        <Alert tone="success">Mail restauré en {formatDuration(job.durationMs ?? 0)}.</Alert>
        {rows}
        <Actions back={audit}>{close}</Actions>
      </>
    );
  }
  const subject = mail.subject === '' ? '(sans objet)' : mail.subject;
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
      {rows}
      <Actions back={audit}>
        {close}
        <Button onClick={onRetry}>{B.retry}</Button>
      </Actions>
    </>
  );
}
