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
import { dateTimeOrDash, folderLabel, sizeOf } from './format.js';
import { RestoreAction, RestoreNotConfigured } from './RestoreAction.js';
import {
  fetchLastRestore,
  fetchRestoreConfigured,
  lastRestoreLabel,
  type RestoreJob,
} from './restore.js';
import { Alert, Button, FormField } from './ui/index.js';

/** État de la fiche. */
export type MailState = IndexedMail | 'loading' | 'error';

/** Métadonnées d'un mail sauvegardé (jamais le corps). */
export function MailView({ state }: { state: MailState }) {
  if (state === 'loading') return <p role="status">Chargement de la fiche…</p>;
  if (state === 'error') return <Alert tone="error">Fiche indisponible</Alert>;
  return (
    <dl>
      <dt>Objet</dt>
      <dd>{state.subject}</dd>
      <dt>Expéditeur</dt>
      <dd>{state.sender}</dd>
      <dt>Destinataires</dt>
      <dd>{state.recipients.join(', ')}</dd>
      <dt>Date (UTC)</dt>
      <dd>{dateTimeOrDash(state.date)}</dd>
      <dt>Boîte</dt>
      <dd>{state.mailboxId}</dd>
      <dt>Dossier</dt>
      <dd>{folderLabel(state.folder)}</dd>
      <dt>Taille</dt>
      <dd>{sizeOf(state.size)}</dd>
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
      <FormField
        label="Motif de l’export"
        type="text"
        name="reason"
        required
        minLength={MIN_REASON_LENGTH}
        counterMax={MAX_REASON_LENGTH}
        placeholder={REASON_PLACEHOLDER}
        help={REASON_GUIDANCE}
        value={reason}
        onChange={(e) => {
          onReason(e.currentTarget.value);
        }}
      />
      <Button type="submit" busy={exporting === 'busy'} disabled={!isReasonValid(reason)}>
        Exporter en EML
      </Button>
      <p>
        Le motif est inscrit au journal d’audit avec l’export. Pour les sauvegardes anciennes
        (format JSON), le fichier est reconstruit sans les pièces jointes.
      </p>
      {exporting === 'done' && <Alert tone="success">Export inscrit au journal.</Alert>}
      {exporting === 'error' && <Alert tone="error">Export refusé ou indisponible</Alert>}
    </form>
  );
}

/** Restauration depuis la fiche : bouton, et l'issue de la dernière restauration. */
export function RestoreSection({ mail }: { mail: IndexedMail }) {
  const [configured, setConfigured] = useState(true);
  const [last, setLast] = useState<RestoreJob | null>(null);
  useEffect(() => {
    let current = true;
    void fetchRestoreConfigured().then((c) => current && setConfigured(c));
    fetchLastRestore(mail.mailboxId, mail.messageId).then(
      (job) => current && setLast(job),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [mail.mailboxId, mail.messageId]);
  // Une restauration lancée ailleurs (autre écran, autre session) : on suit jusqu'à son issue.
  const running = last?.status === 'running';
  useEffect(() => {
    if (!running) return;
    let current = true;
    const timer = setInterval(() => {
      fetchLastRestore(mail.mailboxId, mail.messageId).then(
        (job) => current && job && setLast(job),
        () => undefined,
      );
    }, 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [running, mail.mailboxId, mail.messageId]);
  const label = lastRestoreLabel(last);
  return (
    <section aria-labelledby="restore-title">
      <h2 id="restore-title">Restauration</h2>
      <p>Remet une copie du mail dans sa boîte d’origine, sans rien écraser.</p>
      <RestoreAction
        mail={mail}
        configured={configured}
        hintId="restore-not-configured"
        onJob={setLast}
      />
      {!configured && <RestoreNotConfigured id="restore-not-configured" />}
      {label && <p role="status">{label}</p>}
    </section>
  );
}

/** Fiche d'un mail, restauration et export EML (le motif est exigé pour l'un et l'autre). */
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
    <main tabIndex={-1}>
      <h1>Fiche d’un mail</h1>
      <p>
        <a href="#/search">Retour à la recherche</a>
      </p>
      <MailView state={state} />
      {typeof state === 'object' && <RestoreSection mail={state} />}
      {typeof state === 'object' && (
        <ExportForm reason={reason} exporting={exporting} onReason={setReason} onSubmit={submit} />
      )}
    </main>
  );
}
