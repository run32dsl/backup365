import { useState, type FormEvent } from 'react';
import { type Problem as FailureProblem } from '../apiError.js';
import { FailureAlert } from '../FailureAlert.js';
import {
  COPY_CONSEQUENCE,
  ONEDRIVE_MESSAGES as T,
  REPLACE_WARNING_TITLE,
  confirmRowsOf,
  copyNameOf,
  replaceWarningOf,
  restoreBlocked,
  startDriveRestore,
  type DriveJob,
  type DriveMode,
} from '../onedrive.js';
import { RESTORE_BUTTONS as B } from '../RestoreJourney.js';
import { Alert, Button, ChoiceGroup, ResultList, WizardActions } from '../ui/index.js';
import { folderLabel, type Choice } from './types.js';

/** Étape 3 : mode et récapitulatif. */
export function ConfirmStep({
  account,
  choice,
  backupAt,
  reason,
  onBack,
  onStarted,
}: {
  account: string;
  choice: Choice;
  backupAt: string | null;
  reason: string;
  onBack: () => void;
  onStarted: (job: DriveJob) => void;
}) {
  const { entry, version } = choice;
  const [mode, setMode] = useState<DriveMode>('copy');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const [failure, setFailure] = useState<FailureProblem | undefined>();
  const [sending, setSending] = useState(false);
  const blocked = restoreBlocked(mode, confirmed);
  const canReplace = entry.kind === 'file';
  const versionAt = version?.at ?? entry.versionAt;
  const copyName = version ? '' : copyNameOf(entry.name, entry.kind, new Date());

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setFailure(undefined);
    if (mode === 'replace' && !confirmed) {
      setConfirmError(true);
      return;
    }
    setConfirmError(false);
    setSending(true);
    void startDriveRestore(account, {
      snapshotId: choice.snapshotId,
      path: entry.path,
      kind: entry.kind,
      mode,
      versionId: version?.versionId ?? undefined,
      reason,
    }).then((result) => {
      setSending(false);
      if (result.ok) onStarted(result.job);
      else setFailure({ message: result.message, requestId: result.requestId });
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <ChoiceGroup<DriveMode>
        legend="Mode"
        name="mode"
        value={mode}
        options={[
          { value: 'copy', label: 'Restaurer en copie (recommandé)' },
          ...(canReplace
            ? [{ value: 'replace' as const, label: 'Remplacer le fichier actuel' }]
            : []),
        ]}
        onChange={(next) => {
          setMode(next);
          if (next === 'copy') {
            setConfirmed(false);
            setConfirmError(false);
          }
        }}
      />
      <ResultList
        rows={confirmRowsOf({
          account,
          name: entry.name,
          mode,
          backupAt,
          versionAt,
          folderLabel: folderLabel(entry.path),
          copyName,
          reason,
        })}
      />
      {mode === 'copy' && <p>{COPY_CONSEQUENCE}</p>}
      {mode === 'replace' && (
        <Alert tone="warning" title={REPLACE_WARNING_TITLE}>
          {replaceWarningOf(entry.name, versionAt)}
        </Alert>
      )}
      {mode === 'replace' && (
        <div className="field">
          <label className="choice">
            <input
              type="checkbox"
              checked={confirmed}
              aria-invalid={confirmError || undefined}
              aria-describedby={confirmError ? 'od-confirm-error' : undefined}
              onChange={(e) => {
                setConfirmed(e.currentTarget.checked);
                setConfirmError(false);
              }}
            />{' '}
            {T.confirmReplace}
          </label>
          {confirmError && (
            <p id="od-confirm-error" className="field-error" role="alert">
              <span aria-hidden="true">✖</span> {T.confirmError}
            </p>
          )}
        </div>
      )}
      {failure && <FailureAlert problem={failure} />}
      <WizardActions
        back={
          <Button variant="secondary" data-safe onClick={onBack}>
            {B.back}
          </Button>
        }
      >
        <Button
          type="submit"
          busy={sending}
          aria-disabled={blocked || undefined}
          className={blocked ? 'is-inactive' : undefined}
        >
          {B.confirm}
        </Button>
      </WizardActions>
    </form>
  );
}
