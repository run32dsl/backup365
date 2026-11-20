import { useEffect, useState, type FormEvent } from 'react';
import type { IndexedMail } from '@backup365/core';
import { API_ERRORS, type Problem } from './apiError.js';
import { FailureAlert } from './FailureAlert.js';
import { isReasonValid } from './mail.js';
import { AuditReminder, REASON, RESTORE_BUTTONS as B, ReasonField } from './RestoreJourney.js';
import {
  RESTORE_MESSAGES as T,
  announcement,
  failureCause,
  isOutcomeUncertain,
  fetchLastRestore,
  formatDuration,
  restoreFolderName,
  shortUtcDate,
  startRestore,
  type RestoreJob,
} from './restore.js';
import { Alert, Button, Dialog, ResultList } from './ui/index.js';

export type RestorableMail = Pick<IndexedMail, 'mailboxId' | 'messageId' | 'subject' | 'date'>;

/**
 * Message affiché sous le bouton quand la restauration n'est pas configurée : c'est le cas où
 * `POST …/restore` répond 503 `restore_unavailable`.
 */
export function RestoreNotConfigured({ id }: { id: string }) {
  return (
    <p id={id} className="field-help">
      {API_ERRORS['restore_unavailable']}
    </p>
  );
}

/** Titre du panneau selon l'état de la restauration. */
export function dialogTitle(job: RestoreJob | null): string {
  if (!job) return T.title;
  if (job.status === 'running') return T.runningTitle;
  return job.status === 'succeeded' ? T.succeededTitle : T.failedTitle;
}

/** Rappel du mail et de la boîte, commun aux états en cours, réussi et échoué. */
function recallRows(mail: RestorableMail): [string, string][] {
  const date = shortUtcDate(mail.date);
  const subject = mail.subject === '' ? '(sans objet)' : mail.subject;
  return [
    ['Mail', date ? `${subject} · ${date}` : subject],
    ['Boîte', mail.mailboxId],
  ];
}

/** Restauration en cours : même modèle que les résultats (alerte, liste libellée, « Fermer »). */
export function Tracking({
  job,
  mail,
  now,
  onClose,
}: {
  job: RestoreJob;
  mail: RestorableMail;
  now: number;
  onClose: () => void;
}) {
  const elapsed = Math.max(0, now - Date.parse(job.startedAt));
  return (
    <>
      <Alert tone="info">
        {T.running} {T.keepsRunning}
      </Alert>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement(elapsed)}
      </p>
      <ResultList rows={[...recallRows(mail), ['Dossier', job.folder]]} />
      <div className="button-row dialog-actions">
        <Button onClick={onClose}>Fermer</Button>
      </div>
    </>
  );
}

/** Résultat d'une restauration terminée : rappel du mail et de la boîte, puis les actions. */
export function RestoreOutcome({
  job,
  mail,
  onClose,
  onRetry,
}: {
  job: RestoreJob;
  mail: RestorableMail;
  onClose: () => void;
  onRetry: () => void;
}) {
  const recall = recallRows(mail);
  if (job.status === 'succeeded') {
    return (
      <>
        <Alert tone="success">Mail restauré en {formatDuration(job.durationMs ?? 0)}.</Alert>
        <ResultList rows={[...recall, ['Dossier', job.folder]]} />
        <div className="button-row dialog-actions">
          <a className="btn btn-secondary" href="#/audit">
            {B.audit}
          </a>
          <Button onClick={onClose}>Fermer</Button>
        </div>
      </>
    );
  }
  return (
    <>
      <Alert tone="error">
        La restauration a échoué : {failureCause(job.error).replace(/\.$/, '')}.{' '}
        {isOutcomeUncertain(job.error) ? T.uncertain : T.untouched}
      </Alert>
      <ResultList rows={[...recall, ['Durée', formatDuration(job.durationMs ?? 0)]]} />
      <div className="button-row dialog-actions">
        <a className="btn btn-secondary" href="#/audit">
          {B.audit}
        </a>
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
        <Button onClick={onRetry}>{B.retry}</Button>
      </div>
    </>
  );
}

/**
 * « Restaurer » : bouton et panneau modal (confirmation avec motif, puis suivi). La restauration
 * continue si le panneau est fermé ; `onJob` reçoit chaque changement d'état.
 * `configured: false` désactive le bouton (`aria-disabled`) et le relie à `hintId`.
 */
export function RestoreAction({
  mail,
  configured,
  hintId,
  onJob,
  variant = 'primary',
}: {
  mail: RestorableMail;
  configured: boolean;
  hintId?: string;
  onJob?: (job: RestoreJob) => void;
  /** `secondary` dans une liste : le bouton plein est réservé à l'action principale de l'écran. */
  variant?: 'primary' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [failure, setFailure] = useState<Problem | undefined>();
  const [sending, setSending] = useState(false);
  const [job, setJob] = useState<RestoreJob | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const update = (next: RestoreJob) => {
    setJob(next);
    onJob?.(next);
  };

  // Tant que la restauration court (panneau ouvert ou non) : horloge et relecture de l'état.
  const running = job?.status === 'running';
  const jobId = job?.id;
  useEffect(() => {
    if (!running || !job) return;
    const runningJob = job;
    let current = true;
    const timer = setInterval(() => {
      setNow(Date.now());
      fetchLastRestore(mail.mailboxId, mail.messageId).then(
        (last) => {
          if (!current) return;
          if (last && last.id === jobId && last.status !== 'running') update(last);
          else if (!last || last.id !== jobId) {
            // Le serveur a perdu la trace (redémarrage) : on n'attend pas indéfiniment.
            update({ ...runningJob, status: 'failed', error: 'restore_lost', durationMs: null });
          }
        },
        () => undefined,
      );
    }, 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
    // `update` ne change que par `onJob`, que l'appelant garde stable.
  }, [running, jobId, mail.mailboxId, mail.messageId]);

  function openPanel() {
    if (!configured) return;
    setFieldError(undefined);
    setFailure(undefined);
    setNow(Date.now());
    // Une restauration terminée appartient au passé : une nouvelle demande repart du formulaire.
    if (job?.status !== 'running') setJob(null);
    setOpen(true);
    if (job?.status !== 'running') {
      // Une restauration lancée par une autre personne ou une autre session.
      fetchLastRestore(mail.mailboxId, mail.messageId).then(
        (last) => {
          if (last?.status === 'running') setJob(last);
        },
        () => undefined,
      );
    }
  }

  function closePanel() {
    // Pas de fermeture pendant l'envoi de la demande : on ne saurait pas si elle est partie.
    if (!sending) setOpen(false);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    if (!isReasonValid(reason)) {
      setFieldError(REASON.error);
      return;
    }
    setFieldError(undefined);
    setFailure(undefined);
    setSending(true);
    void startRestore(mail.mailboxId, mail.messageId, reason).then((result) => {
      setSending(false);
      if (result.ok) {
        setNow(Date.now());
        update(result.job);
      } else {
        setFailure({ message: result.message, requestId: result.requestId });
      }
    });
  }

  const date = shortUtcDate(mail.date);
  const subject = mail.subject === '' ? '(sans objet)' : mail.subject;
  const label = `Restaurer ${subject}`;
  return (
    <>
      <Button
        variant={variant}
        aria-label={label}
        aria-disabled={!configured || undefined}
        aria-describedby={!configured ? hintId : undefined}
        onClick={openPanel}
      >
        Restaurer
      </Button>
      <Dialog open={open} title={dialogTitle(job)} onClose={closePanel}>
        {job === null && <AuditReminder />}
        {job === null && (
          <form onSubmit={submit} noValidate>
            <p>
              {subject}
              {date && ` · ${date}`}
              <br />
              Boîte d’origine : {mail.mailboxId}
            </p>
            <ReasonField value={reason} error={fieldError} onChange={setReason} />
            <h3>Ce qui va se passer</h3>
            <ul>
              <li>
                Le mail sera copié dans la boîte d’origine, dans le dossier «{' '}
                {restoreFolderName(new Date(now))} ».
              </li>
              <li>Aucun mail existant ne sera modifié ni écrasé.</li>
              <li>Le contenu du mail n’est jamais inscrit au journal d’audit.</li>
            </ul>
            {failure && <FailureAlert problem={failure} />}
            <div className="button-row dialog-actions">
              <Button variant="secondary" data-safe onClick={closePanel}>
                {B.cancel}
              </Button>
              <Button type="submit" busy={sending}>
                {sending ? T.sending : B.confirm}
              </Button>
            </div>
          </form>
        )}
        {job?.status === 'running' && (
          <Tracking job={job} mail={mail} now={now} onClose={closePanel} />
        )}
        {(job?.status === 'succeeded' || job?.status === 'failed') && (
          <RestoreOutcome
            job={job}
            mail={mail}
            onClose={closePanel}
            onRetry={() => {
              setJob(null);
            }}
          />
        )}
      </Dialog>
    </>
  );
}
