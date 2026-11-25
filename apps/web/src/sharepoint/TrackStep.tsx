import type { ReactNode } from 'react';
import { RESTORE_BUTTONS as B, RestoreResult, RunningProgress } from '../RestoreJourney.js';
import { restoreFailureBanner, RestoreFailureAlert } from '../restoreFailure.js';
import { RESTORE_LABELS } from '../restoreLabels.js';
import { ResultActions } from '../restore/ResultActions.js';
import { useJobPolling } from '../restore/useJobPolling.js';
import {
  dateTimeOf,
  errorItemLabel,
  failureCause,
  failureConsequence,
  fetchLastSiteJob,
  formatDuration,
  isOutcomeUncertain,
  pathLabel,
  placementRows,
  restoredContentLabel,
  successSummary,
  type SiteJob,
} from '../sharepoint.js';
import { Alert, Button, ResultList } from '../ui/index.js';

/** Étape 4 : progression, puis résultat. La restauration continue si l'on quitte la page. */
export function TrackStep({
  job,
  pointAt,
  siteName,
  onJob,
  onAgain,
  onRetry,
}: {
  job: SiteJob;
  pointAt?: string | undefined;
  siteName: string;
  onJob: (job: SiteJob) => void;
  onAgain: () => void;
  onRetry: () => void;
}) {
  const running = job.status === 'running';
  useJobPolling(job, () => fetchLastSiteJob(job.siteId), onJob, [job.id, job.siteId]);

  const untreated = Math.max(0, job.total - job.restored - job.skipped - job.errors);
  const failedNormally = job.status === 'failed' && !isOutcomeUncertain(job.error);
  const countRows: [string, ReactNode][] = [
    ['Site', siteName],
    [
      job.status === 'succeeded' ? RESTORE_LABELS.itemRestored : RESTORE_LABELS.item,
      restoredContentLabel(job.scope, job.path),
    ],
  ];
  if (pointAt) countRows.push([RESTORE_LABELS.backupAt, dateTimeOf(pointAt)]);
  countRows.push(...placementRows(job.scope, siteName, job.path));
  if (job.status === 'failed' && job.restored > 0) {
    countRows.push(['Éléments restaurés', job.restored]);
  }
  if (job.status === 'succeeded' && job.copyName) countRows.push(['Restauré sous', job.copyName]);
  if (failedNormally && untreated > 0) countRows.push(['Éléments non traités', untreated]);
  if (job.status !== 'running' && job.errors > 0) {
    countRows.push(['Éléments en erreur', job.errors]);
    const named = errorItemLabel(job);
    if (named) countRows.push(['En erreur', named]);
  }
  const counts = <ResultList rows={countRows} />;
  let body: ReactNode;
  if (running) {
    body = (
      <>
        <RunningProgress
          detail={`${job.total} ${job.total > 1 ? 'éléments' : 'élément'} à traiter`}
        />
        {counts}
        <ResultActions />
      </>
    );
  } else if (job.status === 'succeeded') {
    body = (
      <>
        <div aria-live="polite">
          <Alert tone="success">
            {successSummary(
              job.restored,
              job.skipped,
              job.errors,
              formatDuration(job.durationMs ?? 0),
            )}
          </Alert>
        </div>
        {counts}
        {job.skipped === 0 && <p>Aucun élément déjà présent n’a été écrasé.</p>}
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
            item:
              job.scope === 'site' || pathLabel(job.path) === '' ? siteName : pathLabel(job.path),
            uncertain: isOutcomeUncertain(job.error),
            at: job.finishedAt ?? job.startedAt,
            cause: failureCause(job.error),
            consequence: failureConsequence(job),
          })}
        />
        {counts}
        <ResultActions>
          <Button onClick={onRetry}>{B.retry}</Button>
        </ResultActions>
      </>
    );
  }
  return <RestoreResult status={job.status}>{body}</RestoreResult>;
}
