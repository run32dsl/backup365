import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Mailbox } from '@backup365/core';
import type { Problem } from '../apiError.js';
import { isReasonValid } from '../mail.js';
import { restoreFolderName, startRestore, type RestoreJob } from '../restore.js';
import { recallRows, type RestorableMail } from '../restoreRows.js';
import { Steps } from '../ui/index.js';
import { TRANSFER as T, fetchAccounts, searchAccounts, transferBoxes } from './model.js';
import {
  ConfirmView,
  DestinationView,
  ReasonView,
  confirmRows,
  type SearchState,
} from './TransferViews.js';

/**
 * Étapes A1 à A3 de la restauration d'un mail vers la boîte d'un autre compte (issue #546) :
 * destination, motif, confirmation. `choice` est le choix « boîte d'origine / boîte d'un autre compte »,
 * affiché à l'étape « Destination ». `onStarted` reçoit la restauration lancée (A4 : suivi).
 */
export function TransferFlow({
  mail,
  choice,
  onCancel,
  onStarted,
  onSendingChange,
}: {
  mail: RestorableMail;
  choice: ReactNode;
  onCancel: () => void;
  onStarted: (job: RestoreJob) => void;
  /** Vrai pendant l'envoi de la demande : la boîte ne doit pas se fermer. */
  onSendingChange?: (sending: boolean) => void;
}) {
  const [step, setStep] = useState(1);
  const [accounts, setAccounts] = useState<Mailbox[] | 'loading' | 'error'>('loading');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>('idle');
  const [pending, setPending] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Problem | undefined>();
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLParagraphElement>(null);
  const firstStep = useRef(true);

  useEffect(() => {
    let current = true;
    fetchAccounts().then(
      (list) => {
        if (current) setAccounts(list);
      },
      () => {
        if (current) setAccounts('error');
      },
    );
    return () => {
      current = false;
    };
  }, []);

  // Recherche lancée avant l'arrivée de la liste : elle aboutit dès que la liste est là.
  useEffect(() => {
    if (pending === null || accounts === 'loading') return;
    setSearch(accounts === 'error' ? 'error' : searchAccounts(accounts, pending));
    setPending(null);
  }, [pending, accounts]);

  // Le focus va sur le titre des étapes à chaque changement (pas à l'ouverture).
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    title.current?.focus();
  }, [step]);

  const known = Array.isArray(accounts) ? accounts : [];
  const source = known.find((m) => m.id === mail.mailboxId) ?? {
    id: mail.mailboxId,
    displayName: mail.mailboxId,
  };
  const target = known.find((m) => m.id === selected);
  const folder = restoreFolderName(new Date(now));

  const focusField = (name: string) => {
    box.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.focus();
  };

  function runSearch() {
    setError(undefined);
    setSearch('loading');
    setPending(query);
  }

  function destination(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fault = !target ? T.chooseTarget : target.id === source.id ? T.sameTarget : undefined;
    setError(fault);
    if (fault) focusField('account-search');
    else setStep(2);
  }

  function motive(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isReasonValid(reason)) {
      setError(T.reasonError);
      focusField('reason');
      return;
    }
    setError(undefined);
    // Date du dossier relue à l'arrivée sur la confirmation, au plus près du lancement.
    setNow(Date.now());
    setStep(3);
  }

  function confirm() {
    if (sending || !target) return;
    setFailure(undefined);
    setSending(true);
    onSendingChange?.(true);
    void startRestore(mail.mailboxId, mail.messageId, reason, fetch, target.id).then((result) => {
      setSending(false);
      onSendingChange?.(false);
      if (result.ok) onStarted(result.job);
      else setFailure({ message: result.message, requestId: result.requestId });
    });
  }

  const back = () => {
    setError(undefined);
    setFailure(undefined);
    setStep((s) => s - 1);
  };

  return (
    <div ref={box}>
      <Steps steps={[...T.steps]} current={step} titleRef={title} />
      {step === 1 && (
        <DestinationView
          recall={recallRows(mail, transferBoxes(source))}
          source={source}
          choice={choice}
          query={query}
          search={search}
          selected={selected}
          error={error}
          onQuery={setQuery}
          onSearch={runSearch}
          onSelect={(id) => {
            setSelected(id);
            setError(undefined);
          }}
          onCancel={onCancel}
          onContinue={destination}
        />
      )}
      {step === 2 && (
        <ReasonView
          reason={reason}
          error={error}
          onReason={setReason}
          onCancel={onCancel}
          onBack={back}
          onContinue={motive}
        />
      )}
      {step === 3 && target && (
        <ConfirmView
          rows={confirmRows(mail, source, target, folder, reason)}
          folder={folder}
          sending={sending}
          failure={failure}
          onCancel={onCancel}
          onBack={back}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}
