import { useEffect, useState, type FormEvent } from 'react';
import type { IndexedMail } from '@backup365/core';
import { exportEml, fetchMail, isReasonValid, saveBlob } from './mail.js';
import { dateTimeOrDash, folderLabel, sizeOf } from './format.js';
import { RestoreAction, RestoreNotConfigured } from './RestoreAction.js';
import { AuditReminder, ReasonField } from './RestoreJourney.js';
import {
  fetchLastRestore,
  fetchRestoreConfigured,
  lastRestoreLabel,
  type RestoreJob,
} from './restore.js';
import { Alert, Button } from './ui/index.js';

/** État de la fiche. */
export type MailState = IndexedMail | 'loading' | 'error';

/** Titre de la fiche : l'objet du mail, un repli s'il est vide, un titre générique sinon. */
export function mailTitle(state: MailState): string {
  if (typeof state !== 'object') return 'Fiche d’un mail';
  return state.subject.trim() || '(sans objet)';
}

/** Métadonnées d'un mail sauvegardé (jamais le corps). */
export function MailView({ state }: { state: MailState }) {
  if (state === 'loading') return <p role="status">Chargement de la fiche…</p>;
  if (state === 'error') return <Alert tone="error">Fiche indisponible</Alert>;
  const rows: [string, string][] = [
    ['Expéditeur', state.sender],
    ['Destinataires', state.recipients.join(', ')],
    ['Date (UTC)', dateTimeOrDash(state.date)],
    ['Boîte', state.mailboxId],
    ['Dossier', folderLabel(state.folder)],
    ['Taille', sizeOf(state.size)],
    ['Pièces jointes', state.attachments.length === 0 ? 'aucune' : state.attachments.join(', ')],
  ];
  return (
    <dl className="meta-list">
      {rows
        .filter(([, value]) => value.trim() !== '')
        .map(([label, value]) => (
          <div key={label} className="meta-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Formulaire d'export : même bloc motif et même rappel d'audit que les restaurations. */
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
  const valid = isReasonValid(reason);
  const empty = reason.trim() === '';
  return (
    <section aria-labelledby="export-title" className="mail-section">
      <h2 id="export-title">Exporter en EML</h2>
      <form onSubmit={onSubmit}>
        <ReasonField of="de l’export" value={reason} onChange={onReason} />
        <p className="field-help export-note">
          Pour les anciennes sauvegardes, les pièces jointes ne sont pas incluses dans le fichier.
        </p>
        <AuditReminder />
        <Button
          type="submit"
          variant="secondary"
          busy={exporting === 'busy'}
          disabled={!valid}
          aria-describedby={empty ? 'export-disabled-help' : undefined}
        >
          Exporter en EML
        </Button>
        {exporting === 'done' ? (
          <div className="export-result">
            <Alert tone="success">Export inscrit au journal d’audit.</Alert>
          </div>
        ) : exporting === 'error' ? (
          <div className="export-result">
            <Alert tone="error">Export refusé ou indisponible.</Alert>
          </div>
        ) : (
          empty && (
            <p id="export-disabled-help" className="field-help export-help">
              Saisissez un motif pour exporter.
            </p>
          )
        )}
      </form>
    </section>
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
    <section aria-labelledby="restore-title" className="mail-section">
      <h2 id="restore-title">Restaurer dans la boîte d’origine</h2>
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
      <p>
        <a href="#/search">Retour à la recherche</a>
      </p>
      <h1>{mailTitle(state)}</h1>
      <MailView state={state} />
      {typeof state === 'object' && <RestoreSection mail={state} />}
      {typeof state === 'object' && (
        <ExportForm reason={reason} exporting={exporting} onReason={setReason} onSubmit={submit} />
      )}
    </main>
  );
}
