import { useEffect, useId, useRef, useState } from 'react';
import { RESTORE_BUTTONS as B } from '../RestoreJourney.js';
import { RESTORE_LABELS } from '../restoreLabels.js';
import { dateTimeOf } from '../format.js';
import type { Loaded } from '../onedrive.js';
import {
  TEAMS_MESSAGES as T,
  channelsOf,
  fetchTeamSnapshots,
  type Team,
  type TeamSnapshot,
  type TeamsChoice,
} from '../teams.js';
import { Alert, Button, EmptyState, WizardActions } from '../ui/index.js';

/** Étape 1 : équipe, canal et date de la sauvegarde. Le contenu est toujours « Messages ». */
export function ChooseStep({
  teams,
  initial,
  onContinue,
}: {
  teams: Team[];
  initial: TeamsChoice | null;
  onContinue: (choice: TeamsChoice) => void;
}) {
  const [teamId, setTeamId] = useState(initial?.team.id ?? teams[0]?.id ?? '');
  const [snapshots, setSnapshots] = useState<Loaded<TeamSnapshot[]> | null>(null);
  const [channelId, setChannelId] = useState(initial?.channel.id ?? '');
  const [snapshotId, setSnapshotId] = useState(initial?.snapshot.id ?? '');
  const [attempt, setAttempt] = useState(0);
  const dateRef = useRef<HTMLSelectElement>(null);
  const helpId = useId();

  useEffect(() => {
    if (!teamId) return;
    let current = true;
    setSnapshots(null);
    void fetchTeamSnapshots(teamId).then((result) => {
      if (!current) return;
      setSnapshots(result);
      if (result.status !== 'ok') return;
      const channels = channelsOf(result.data);
      // Un choix précédent (retour arrière) est gardé s'il existe encore.
      setChannelId((id) => (channels.some((c) => c.id === id) ? id : (channels[0]?.id ?? '')));
      setSnapshotId((id) =>
        result.data.some((s) => s.id === id) ? id : (result.data[0]?.id ?? ''),
      );
    });
    return () => {
      current = false;
    };
  }, [teamId, attempt]);

  const team = teams.find((t) => t.id === teamId);
  const list = snapshots?.status === 'ok' ? snapshots.data : [];
  const channels = channelsOf(list);
  const snapshot = list.find((s) => s.id === snapshotId);
  const channel = snapshot?.channels.find((c) => c.id === channelId);
  const loading = snapshots === null;

  return (
    <>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="tm-team">Équipe</label>
          <select
            id="tm-team"
            value={teamId}
            onChange={(e) => {
              setTeamId(e.currentTarget.value);
            }}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tm-channel">Canal</label>
          <select
            id="tm-channel"
            value={channelId}
            disabled={loading || channels.length === 0}
            aria-describedby={helpId}
            onChange={(e) => {
              setChannelId(e.currentTarget.value);
            }}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p id={helpId} className="field-help">
            {T.channelHelp}
          </p>
        </div>
        <div className="field">
          <label htmlFor="tm-point">{RESTORE_LABELS.backupDate}</label>
          <select
            id="tm-point"
            ref={dateRef}
            value={snapshotId}
            disabled={loading || list.length === 0}
            onChange={(e) => {
              setSnapshotId(e.currentTarget.value);
            }}
          >
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {`${dateTimeOf(s.createdAt)} UTC`}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p>
        {T.content} {T.filesHint}
      </p>
      {loading && (
        <p role="status" aria-busy="true">
          {T.loadingChannels}
        </p>
      )}
      {snapshots !== null && snapshots.status !== 'ok' && (
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
      )}
      {snapshots?.status === 'ok' && list.length === 0 && (
        <EmptyState>Aucune sauvegarde n’est encore terminée.</EmptyState>
      )}
      {snapshot && !channel && channels.length > 0 && (
        <EmptyState
          action={
            <Button
              variant="secondary"
              onClick={() => {
                dateRef.current?.focus();
              }}
            >
              {T.otherDate}
            </Button>
          }
        >
          {T.noChannel}
        </EmptyState>
      )}
      <WizardActions>
        <Button
          disabled={!team || !snapshot || !channel}
          onClick={() => {
            if (team && snapshot && channel) onContinue({ team, channel, snapshot });
          }}
        >
          {B.next}
        </Button>
      </WizardActions>
    </>
  );
}
