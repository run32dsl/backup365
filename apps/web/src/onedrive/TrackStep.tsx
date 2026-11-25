import type { ReactNode } from 'react';
import {
  dateTimeOf,
  failureCause,
  fetchLastDriveJob,
  isOutcomeUncertain,
  restoredSummary,
  type DriveJob,
} from '../onedrive.js';
import { RESTORE_BUTTONS as B, RestoreResult, RunningProgress } from '../RestoreJourney.js';
import { RestoreFailureAlert, restoreFailureBanner } from '../restoreFailure.js';
import { RESTORE_LABELS } from '../restoreLabels.js';
import { formatDuration } from '../restore.js';
import { ResultActions } from '../restore/ResultActions.js';
import { useJobPolling } from '../restore/useJobPolling.js';
import { Alert, Button, ResultList } from '../ui/index.js';
import { folderLabel, type Choice } from './types.js';

/** Étape 3 : suivi. La restauration continue si l'on quitte la page. */
export function TrackStep({
  account,
  choice,
  backupAt,
  job,
  onJob,
  onAgain,
  onRetry,
}: {
  account: string;
  choice: Choice;
  backupAt: string | null;
  job: DriveJob;
  onJob: (job: DriveJob) => void;
  onAgain: () => void;
  onRetry: () => void;
}) {
  useJobPolling(job, () => fetchLastDriveJob(account, job.path), onJob, [
    account,
    job.id,
    job.path,
  ]);

  const target = job.copyName ?? choice.entry.name;
  const where = folderLabel(job.path);
  const versionAt = choice.version?.at ?? choice.entry.versionAt;
  const items = (
    <ResultList
      rows={[
        ['Compte', account],
        job.status === 'succeeded'
          ? [RESTORE_LABELS.itemRestored, `${choice.entry.name} → ${target}`]
          : [RESTORE_LABELS.item, choice.entry.name],
        [RESTORE_LABELS.backupDate, dateTimeOf(backupAt)],
        ...(versionAt
          ? [[RESTORE_LABELS.versionAt, dateTimeOf(versionAt)] as [string, string]]
          : []),
        ['Emplacement', where],
      ]}
    />
  );
  let body: ReactNode;
  if (job.status === 'running') {
    body = (
      <>
        <RunningProgress />
        {items}
        <ResultActions />
      </>
    );
  } else if (job.status === 'succeeded') {
    body = (
      <>
        <Alert tone="success">
          {restoredSummary(job.kind, formatDuration(job.durationMs ?? 0))}
        </Alert>
        {items}
        <ResultActions>
          <Button onClick={onAgain}>{B.again}</Button>
        </ResultActions>
      </>
    );
  } else {
    body = (
      <>
        <RestoreFailureAlert
          banner={restoreFailureBanner({
            item: choice.entry.name,
            at: job.finishedAt ?? job.startedAt,
            cause: failureCause(job.error),
            consequence: isOutcomeUncertain(job.error)
              ? 'L’état de OneDrive est incertain : vérifiez avant de réessayer'
              : 'Rien n’a été modifié',
            uncertain: isOutcomeUncertain(job.error),
          })}
        />
        {items}
        <ResultActions>
          <Button onClick={onRetry}>{B.retry}</Button>
        </ResultActions>
      </>
    );
  }
  return <RestoreResult status={job.status}>{body}</RestoreResult>;
}
