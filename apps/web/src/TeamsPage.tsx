import { useEffect, useRef, useState, type ReactNode } from 'react';
import { saveBlob } from './mail.js';
import { NEW_PLAN_HASH } from './plans/api.js';
import type { Loaded } from './onedrive.js';
import {
  AuditReminder,
  RESTORE_BUTTONS as B,
  RESTORE_STEPS,
  RestoreResult,
  RunningProgress,
  stepOf,
} from './RestoreJourney.js';
import { ReasonStep } from './restore/ReasonStep.js';
import { ResultActions } from './restore/ResultActions.js';
import { restoreFailureBanner, RestoreFailureAlert } from './restoreFailure.js';
import { StorageUnavailable } from './StorageUnavailable.js';
import { ChooseStep } from './teams/ChooseStep.js';
import {
  TEAMS_MESSAGES as T,
  exportChannel,
  fetchTeams,
  teamsSummary,
  type Team,
  type TeamsChoice,
  type TeamsExportDone,
} from './teams.js';
import { plural, quoted } from './format.js';
import { Alert, Button, EmptyState, RestoreSourceNav, Steps, WizardActions } from './ui/index.js';

type Outcome =
  | { status: 'running' }
  | { status: 'succeeded'; done: TeamsExportDone }
  | { status: 'failed'; at: string; cause: string };

/** Teams non protégé : un administrateur crée un plan, un opérateur le demande. */
function NotProtected({ admin }: { admin: boolean }) {
  return (
    <EmptyState action={admin ? <a href={NEW_PLAN_HASH}>{T.createPlan}</a> : undefined}>
      {T.notProtected} {admin ? '' : T.askAdmin}
    </EmptyState>
  );
}

/** Résultat de l'export, dans la boîte commune du suivi (ADR 0016). */
function Result({
  outcome,
  choice,
  onAgain,
  onRetry,
}: {
  outcome: Outcome;
  choice: TeamsChoice;
  onAgain: () => void;
  onRetry: () => void;
}) {
  if (outcome.status === 'running') {
    return (
      <RestoreResult status="running">
        <RunningProgress detail={T.running.replace('…', '')} />
      </RestoreResult>
    );
  }
  if (outcome.status === 'failed') {
    const banner = restoreFailureBanner({
      item: choice.channel.name,
      at: outcome.at,
      cause: outcome.cause,
      consequence: 'aucune archive n’a été téléchargée',
    });
    return (
      <RestoreResult status="failed">
        <RestoreFailureAlert banner={banner} />
        <ResultActions>
          <Button onClick={onRetry}>{B.retry}</Button>
        </ResultActions>
      </RestoreResult>
    );
  }
  const { done } = outcome;
  return (
    <RestoreResult status="succeeded">
      <Alert tone="success">
        {T.done} Archive {quoted(done.filename)} téléchargée : {plural(done.messages, 'message')}.
        {done.missing > 0 &&
          ` ${plural(done.missing, 'pièce jointe', 'pièces jointes')} n’avai${done.missing > 1 ? 'en' : ''}t pas pu être sauvegardée${done.missing > 1 ? 's' : ''} : absente${done.missing > 1 ? 's' : ''} de l’archive.`}
      </Alert>
      <ResultActions>
        <Button onClick={onAgain}>{B.again}</Button>
      </ResultActions>
    </RestoreResult>
  );
}

/** Restaurer depuis Teams (`#/teams`) : choisir, motif, récapitulatif, puis l'archive. */
export function TeamsPage({ admin }: { admin: boolean }) {
  const [teams, setTeams] = useState<Loaded<Team[]> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [choice, setChoice] = useState<TeamsChoice | null>(null);
  // Dernier choix de l'étape 1 : retrouvé après « Précédent ».
  const [kept, setKept] = useState<TeamsChoice | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let current = true;
    setTeams(null);
    void fetchTeams().then((result) => {
      if (current) setTeams(result);
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  const step = outcome ? 4 : reason ? 3 : choice ? 2 : 1;
  useEffect(() => {
    if (step > 1) titleRef.current?.focus();
  }, [step]);

  const reset = () => {
    setChoice(null);
    setReason(null);
    setOutcome(null);
    setKept(null);
  };
  const run = (chosen: TeamsChoice, motive: string) => {
    setOutcome({ status: 'running' });
    exportChannel(chosen, motive).then(
      ({ blob, done }) => {
        saveBlob(blob, done.filename);
        setOutcome({ status: 'succeeded', done });
      },
      (err: unknown) => {
        const cause = err instanceof Error ? err.message : T.generic;
        setOutcome({ status: 'failed', at: new Date().toISOString(), cause });
      },
    );
  };

  const list = teams?.status === 'ok' ? teams.data : [];
  let content: ReactNode;
  if (teams === null) {
    content = (
      <p role="status" aria-busy="true">
        {T.loading}
      </p>
    );
  } else if (teams.status === 'unconfigured') {
    content = (
      <StorageUnavailable
        onRetry={() => {
          setAttempt((n) => n + 1);
        }}
      />
    );
  } else if (teams.status === 'no_backup' || (teams.status === 'ok' && list.length === 0)) {
    content = <NotProtected admin={admin} />;
  } else if (teams.status === 'error') {
    content = (
      <Alert tone="error">
        {T.readError} {T.readAdvice}{' '}
        <Button
          variant="secondary"
          onClick={() => {
            setAttempt((n) => n + 1);
          }}
        >
          {B.retry}
        </Button>
      </Alert>
    );
  } else if (outcome && choice && reason) {
    content = (
      <Result
        outcome={outcome}
        choice={choice}
        onAgain={reset}
        onRetry={() => {
          run(choice, reason);
        }}
      />
    );
  } else if (choice && reason) {
    content = (
      <>
        <p>{teamsSummary(choice, reason)}</p>
        <WizardActions
          back={
            <Button
              variant="secondary"
              data-safe
              onClick={() => {
                setReason(null);
              }}
            >
              {B.back}
            </Button>
          }
        >
          <Button
            onClick={() => {
              run(choice, reason);
            }}
          >
            {B.confirm}
          </Button>
        </WizardActions>
      </>
    );
  } else if (choice) {
    content = (
      <>
        <p>
          {T.destination} {T.noReturn}
        </p>
        <ReasonStep
          initial={draft}
          onBack={() => {
            setChoice(null);
          }}
          onContinue={(r) => {
            setDraft(r);
            setReason(r);
          }}
        />
      </>
    );
  } else {
    content = (
      <ChooseStep
        teams={list}
        initial={kept}
        onContinue={(c) => {
          setKept(c);
          setChoice(c);
        }}
      />
    );
  }

  const journey = teams?.status === 'ok' && list.length > 0;
  return (
    <main tabIndex={-1}>
      <h1>{T.title}</h1>
      <RestoreSourceNav current="teams" />
      {journey && !outcome && (
        <Steps steps={RESTORE_STEPS} current={stepOf(step)} titleRef={titleRef} />
      )}
      {journey && !outcome && <AuditReminder />}
      {step === 1 && <Alert tone="info">{T.privateChats}</Alert>}
      {content}
    </main>
  );
}
