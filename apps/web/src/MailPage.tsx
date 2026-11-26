import { useEffect, useState, type FormEvent } from 'react';
import type { IndexedMail } from '@backup365/core';
import { exportEml, fetchMail, isReasonValid, saveBlob } from './mail.js';
import { dateTimeOrDash, folderLabel, sizeOf } from './format.js';
import { apiErrorFor, splitTitle } from './apiError.js';
import { ConfigurationLink } from './ConfigurationBlock.js';
import { useAdmin } from './role.js';
import { RestoreAction, recallRows } from './RestoreAction.js';
import {
  AuditReminder,
  REASON,
  REASON_EXAMPLES,
  RESTORE_BUTTONS as B,
  ReasonField,
} from './RestoreJourney.js';
import {
  fetchLastRestore,
  fetchRestoreConfigured,
  lastRestoreSummary,
  type RestoreJob,
} from './restore.js';
import { Alert, Button, Dialog, ResultList, RestoreSourceNav, StatusPill } from './ui/index.js';

/** État de la fiche. */
export type MailState = IndexedMail | 'loading' | 'error';

/** Restauration non configurée : cause courte en titre, conduite à tenir dans le corps. */
export function RestoreUnavailable() {
  const admin = useAdmin();
  const { title, text } = splitTitle(apiErrorFor('restore_unavailable', admin) ?? '');
  return (
    <Alert tone="warning" {...(title ? { title } : {})}>
      {text}
      {admin ? <ConfigurationLink /> : null}
    </Alert>
  );
}

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
  return <ResultList rows={rows.filter(([, value]) => value.trim() !== '')} />;
}

/** Issue d'une demande d'export : motif refusé, fichier remis, ou export refusé par le serveur. */
export type ExportOutcome = 'invalid' | 'done' | 'error';

/**
 * Valide le motif, puis demande l'export. Sans motif valide, rien n'est envoyé : le serveur
 * inscrit au journal d'audit chaque export qui lui parvient avec son motif.
 */
export async function runExport(
  reason: string,
  request: (reason: string) => Promise<Blob>,
  save: (blob: Blob) => void,
): Promise<ExportOutcome> {
  if (!isReasonValid(reason)) return 'invalid';
  try {
    save(await request(reason));
    return 'done';
  } catch {
    return 'error';
  }
}

/** Export depuis la fiche : bouton, boîte de dialogue avec motif, et l'issue de l'export. */
export function ExportSection({ mail }: { mail: IndexedMail }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<'idle' | 'done'>('idle');
  const [failed, setFailed] = useState(false);

  function openPanel() {
    setFieldError(undefined);
    setFailed(false);
    setReason('');
    setResult('idle');
    setOpen(true);
  }

  function closePanel() {
    if (!sending) setOpen(false);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    void runExport(
      reason,
      (r) => exportEml(mail.mailboxId, mail.messageId, r),
      (blob) => {
        saveBlob(blob, 'message.eml');
      },
    ).then((outcome) => {
      setSending(false);
      if (outcome === 'invalid') {
        setFieldError(REASON.error);
        return;
      }
      setFieldError(undefined);
      if (outcome === 'error') {
        setFailed(true);
        return;
      }
      setResult('done');
      setOpen(false);
    });
  }

  const subject = mail.subject === '' ? '(sans objet)' : mail.subject;
  return (
    <section aria-labelledby="export-title" className="mail-section">
      <h3 id="export-title">Exporter</h3>
      <p>Télécharge une copie du mail au format .eml, lisible par Outlook.</p>
      <Button variant="secondary" aria-label={`Exporter ${subject}`} onClick={openPanel}>
        Exporter
      </Button>
      {result === 'done' && (
        <div className="export-result">
          <Alert tone="success">Export inscrit au journal d’audit.</Alert>
        </div>
      )}
      <Dialog open={open} title="Exporter ce mail" onClose={closePanel}>
        <AuditReminder />
        <form onSubmit={submit} noValidate>
          <ResultList rows={recallRows(mail)} />
          <ReasonField
            of="de l’export"
            placeholder={REASON_EXAMPLES.export}
            value={reason}
            error={fieldError}
            onChange={setReason}
          />
          <h3>Ce qui va se passer</h3>
          <ul>
            <li>Le mail sera téléchargé sur votre poste, dans un fichier .eml.</li>
            <li>
              Pour les anciennes sauvegardes, les pièces jointes ne sont pas incluses dans le
              fichier.
            </li>
            <li>L’export sera inscrit au journal d’audit, avec votre motif.</li>
          </ul>
          {failed && <Alert tone="error">Export refusé ou indisponible.</Alert>}
          <div className="button-row dialog-actions">
            <Button variant="secondary" data-safe onClick={closePanel}>
              {B.cancel}
            </Button>
            <Button type="submit" busy={sending}>
              Exporter
            </Button>
          </div>
        </form>
      </Dialog>
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
  return <RestoreSectionView mail={mail} configured={configured} last={last} onJob={setLast} />;
}

/** Section de restauration : le bouton, ou un avertissement quand la restauration est indisponible. */
export function RestoreSectionView({
  mail,
  configured,
  last,
  onJob,
}: {
  mail: IndexedMail;
  configured: boolean;
  last: RestoreJob | null;
  onJob?: (job: RestoreJob) => void;
}) {
  const summary = lastRestoreSummary(last);
  const admin = useAdmin();
  return (
    <section aria-labelledby="restore-title" className="mail-section">
      <h3 id="restore-title">Restaurer dans la boîte d’origine</h3>
      <p>
        Remet une copie du mail dans sa boîte d’origine, sans rien écraser.
        {admin && ' Un administrateur peut aussi le restaurer vers la boîte d’un autre compte.'}
      </p>
      {configured ? (
        <RestoreAction mail={mail} configured onJob={onJob} />
      ) : (
        <div className="restore-unavailable">
          <RestoreUnavailable />
        </div>
      )}
      {summary && (
        <p role="status">
          Dernière restauration : <StatusPill status={summary.status} label={summary.label} />
          {summary.duration ? ` ${summary.duration}` : ''}
          {last?.transfer ? ` (vers ${last.transfer.targetName})` : ''}
        </p>
      )}
    </section>
  );
}

/** Fiche d'un mail, restauration et export (le motif est exigé pour l'un et l'autre). */
export function MailPage({ mailboxId, messageId }: { mailboxId: string; messageId: string }) {
  const [state, setState] = useState<MailState>('loading');
  useEffect(() => {
    let current = true;
    setState('loading');
    fetchMail(mailboxId, messageId).then(
      (m) => current && setState(m),
      () => current && setState('error'),
    );
    return () => {
      current = false;
    };
  }, [mailboxId, messageId]);

  return (
    <main tabIndex={-1}>
      <h1>Restaurer depuis la messagerie</h1>
      <RestoreSourceNav current="mail" />
      <p>
        <a href="#/search">Retour à la recherche</a>
      </p>
      <h2>{mailTitle(state)}</h2>
      <MailView state={state} />
      {typeof state === 'object' && <RestoreSection mail={state} />}
      {typeof state === 'object' && (
        <ExportSection key={`${state.mailboxId}/${state.messageId}`} mail={state} />
      )}
    </main>
  );
}
