import { useEffect, useState, type FormEvent } from 'react';
import type { IndexedMail } from '@backup365/core';
import {
  exportEml,
  fetchMail,
  isReasonValid,
  saveBlob,
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
} from './mail.js';

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

export const REASON_PLACEHOLDER = 'Ticket INC-12345';
export const REASON_GUIDANCE =
  'Indiquez de préférence le numéro du ticket interne. N’y saisissez pas de donnée personnelle (nom, adresse, contenu du mail).';

/** Formulaire d'export : le motif guide vers un numéro de ticket, sans donnée personnelle. */
export function ExportForm({
  reason,
  exporting,
  onReason,
  onSubmit,
}: {
  reason: string;
  exporting: 'idle' | 'busy' | 'done' | 'error';
  onReason: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        Motif de l’export{' '}
        <input
          type="text"
          name="reason"
          required
          minLength={MIN_REASON_LENGTH}
          maxLength={MAX_REASON_LENGTH}
          placeholder={REASON_PLACEHOLDER}
          aria-describedby="reason-help"
          value={reason}
          onChange={(e) => {
            onReason(e.currentTarget.value);
          }}
        />
      </label>{' '}
      <button type="submit" disabled={!isReasonValid(reason) || exporting === 'busy'}>
        Exporter en EML
      </button>
      <p id="reason-help">{REASON_GUIDANCE}</p>
      <p>
        Le motif est inscrit au journal d’audit avec l’export. Pour les sauvegardes anciennes
        (format JSON), le fichier est reconstruit sans les pièces jointes.
      </p>
      {exporting === 'done' && <p role="status">Export inscrit au journal.</p>}
      {exporting === 'error' && <p role="alert">Export refusé ou indisponible</p>}
    </form>
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
        <ExportForm reason={reason} exporting={exporting} onReason={setReason} onSubmit={submit} />
      )}
    </main>
  );
}
