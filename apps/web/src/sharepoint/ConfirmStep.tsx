import { useEffect, useState, type FormEvent } from 'react';
import { type Problem as FailureProblem } from '../apiError.js';
import { FailureAlert } from '../FailureAlert.js';
import type { Loaded } from '../onedrive.js';
import { RESTORE_BUTTONS as B } from '../RestoreJourney.js';
import {
  SHAREPOINT_MESSAGES as T,
  SITE_WARNING_TITLE,
  confirmRowsOf,
  fetchScope,
  siteWarningOf,
  startSiteRestore,
  type Site,
  type SiteJob,
  type SiteScopeSummary,
} from '../sharepoint.js';
import { Alert, Button, FormField, ResultList, WizardActions } from '../ui/index.js';
import type { Choice } from './types.js';

/** Étape 3 : récapitulatif ; site entier : double confirmation (case, puis nom du site). */
export function ConfirmStep({
  site,
  choice,
  reason,
  onBack,
  onStarted,
}: {
  site: Site;
  choice: Choice;
  reason: string;
  onBack: () => void;
  onStarted: (job: SiteJob) => void;
}) {
  const [summary, setSummary] = useState<Loaded<SiteScopeSummary> | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState('');
  const [nameError, setNameError] = useState(false);
  const [failure, setFailure] = useState<FailureProblem | undefined>();
  const [sending, setSending] = useState(false);
  const whole = choice.scope === 'site';
  const nameOk = typed === site.displayName;
  const ready = !whole || (understood && nameOk);

  useEffect(() => {
    let current = true;
    void fetchScope(site.id, choice.snapshotId, choice.path).then((result) => {
      if (current) setSummary(result);
    });
    return () => {
      current = false;
    };
  }, [site.id, choice.snapshotId, choice.path]);

  const counts = summary?.status === 'ok' ? summary.data : null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;
    setFailure(undefined);
    if (whole && !nameOk) {
      setNameError(typed !== '');
      return;
    }
    if (!ready) return;
    setSending(true);
    void startSiteRestore(site.id, {
      snapshotId: choice.snapshotId,
      scope: choice.scope,
      path: choice.path,
      reason,
      ...(whole ? { confirmName: typed } : {}),
    }).then((result) => {
      setSending(false);
      if (result.ok) onStarted(result.job);
      else setFailure({ message: result.message, requestId: result.requestId });
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <ResultList
        rows={confirmRowsOf({
          scope: choice.scope,
          siteName: site.displayName,
          path: choice.path,
          pointAt: choice.pointAt,
          summary: counts,
          reason,
        })}
      />
      {summary === null && <p role="status">{T.loading}</p>}
      {whole && (
        <>
          <Alert tone="warning" title={SITE_WARNING_TITLE}>
            {siteWarningOf(site.displayName)}
          </Alert>
          <div className="field">
            <label className="choice">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => {
                  setUnderstood(e.currentTarget.checked);
                }}
              />{' '}
              Je comprends que cette restauration est de grande ampleur.
            </label>
          </div>
          <FormField
            label="Tapez le nom du site pour confirmer"
            type="text"
            name="site-name"
            autoComplete="off"
            value={typed}
            help={ready ? undefined : T.inactiveHint}
            error={nameError ? T.nameError : undefined}
            onChange={(e) => {
              setTyped(e.currentTarget.value);
              setNameError(false);
            }}
          />
        </>
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
          variant={whole ? 'danger' : 'primary'}
          busy={sending}
          aria-disabled={!ready || undefined}
        >
          {B.confirm}
        </Button>
      </WizardActions>
    </form>
  );
}
