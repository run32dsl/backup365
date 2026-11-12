import { useEffect, useState, type FormEvent } from 'react';
import type { IndexedMail } from '@backup365/core';
import { exportEml, fetchMail, isReasonValid, saveBlob, MIN_REASON_LENGTH } from './mail.js';

/** État de la fiche. */
export type MailState = IndexedMail | 'loading' | 'error';

/** Métadonnées d'un mail sauvegardé (jamais le corps). */
export function MailView({ state }: { state: MailState }) {
  if (state === 'loading') return <p role="status">Chargement de la fiche…</p>;
  if (state === 'error') return <p role="alert">Fiche indisponible</p>;
  return (
    <dl>
      <dt>Objet</dt>
      <dd>{state.subject}</dd>
      <dt>Expéditeur</dt>
      <dd>{state.sender}</dd>
      <dt>Destinataires</dt>
      <dd>{state.recipients.join(', ')}</dd>
      <dt>Date (UTC)</dt>
      <dd>{state.date}</dd>
      <dt>Boîte</dt>
      <dd>{state.mailboxId}</dd>
      <dt>Dossier</dt>
      <dd>{state.folder}</dd>
      <dt>Taille (octets)</dt>
      <dd>{state.size}</dd>
      <dt>Pièces jointes</dt>
      <dd>{state.attachments.length === 0 ? 'aucune' : state.attachments.join(', ')}</dd>
    </dl>
  );
}

/** Fiche d'un mail et export EML, qui exige un motif. */
export function MailPage({ mailboxId, messageId }: { mailboxId: string; messageId: string }) {
  const [state, setState] = useState<MailState>('loading');
  const [reason, setReason] = useState('');
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  useEffect(() => {
    let current = true;
    setState('loading');
    setExporting('idle');
    fetchMail(mailboxId, messageId).then(
      (m) => current && setState(m),
      () => current && setState('error'),
    );
    return () => {
      current = false;
    };
  }, [mailboxId, messageId]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isReasonValid(reason)) return;
    setExporting('busy');
    exportEml(mailboxId, messageId, reason).then(
      (blob) => {
        saveBlob(blob, 'message.eml');
        setExporting('done');
      },
      () => {
        setExporting('error');
      },
    );
  }

  return (
    <main>
      <h1>Fiche d’un mail</h1>
      <p>
        <a href="#/search">Retour à la recherche</a>
      </p>
      <MailView state={state} />
      {typeof state === 'object' && (
        <form onSubmit={submit}>
          <label>
            Motif de l’export{' '}
            <input
              type="text"
              name="reason"
              required
              minLength={MIN_REASON_LENGTH}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.currentTarget.value);
              }}
            />
          </label>{' '}
          <button type="submit" disabled={!isReasonValid(reason) || exporting === 'busy'}>
            Exporter en EML
          </button>
          <p>Le motif est inscrit au journal d’audit avec l’export.</p>
          {exporting === 'done' && <p role="status">Export inscrit au journal.</p>}
          {exporting === 'error' && <p role="alert">Export refusé ou indisponible</p>}
        </form>
      )}
    </main>
  );
}
