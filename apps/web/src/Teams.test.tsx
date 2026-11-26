import type { StatusReport } from '@backup365/core';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { navEntries, screenOf } from './app/routing.js';
import { emptyForm } from './plans.js';
import { PlanWizard } from './plans/wizard/PlanWizard.js';
import { StatusView } from './StatusView.js';
import { TeamsPage } from './TeamsPage.js';
import {
  archiveName,
  channelsOf,
  exportChannel,
  fetchTeamSnapshots,
  teamsSummary,
  type TeamsChoice,
} from './teams.js';
import { ChooseStep } from './teams/ChooseStep.js';
import { RestoreSourceNav } from './ui/index.js';

const choice: TeamsChoice = {
  team: { id: 't1', displayName: 'Équipe Voirie' },
  channel: { id: 'c1', name: 'Général', messageCount: 182 },
  snapshot: {
    id: 's1',
    createdAt: '2026-11-12T03:00:00.000Z',
    channels: [{ id: 'c1', name: 'Général', messageCount: 182 }],
  },
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );

describe('Teams restore model (#34)', () => {
  it('writes the summary of step 3 in plain words', () => {
    // Guillemets français avec espaces fines insécables (format.ts).
    const narrowNbsp = String.fromCharCode(0x202f);
    expect(
      teamsSummary(choice, 'Ticket INC-12345 : message supprimé').replaceAll(narrowNbsp, ' '),
    ).toBe(
      'Vous allez exporter les messages du canal « Général » de l’équipe « Équipe Voirie », ' +
        'sauvegardés le 12/11/2026 03:00 UTC. Motif : « Ticket INC-12345 : message supprimé ». ' +
        'Cette action sera inscrite au journal d’audit.',
    );
  });

  it('lists every channel once, with its newest name, and names the archive safely', () => {
    expect(
      channelsOf([
        { id: 'new', createdAt: 'b', channels: [{ id: 'c1', name: 'Général', messageCount: 2 }] },
        {
          id: 'old',
          createdAt: 'a',
          channels: [
            { id: 'c1', name: 'General (ancien)', messageCount: 1 },
            { id: 'c2', name: 'Chantiers', messageCount: 1 },
          ],
        },
      ]).map((c) => c.name),
    ).toEqual(['Chantiers', 'Général']);
    expect(archiveName(choice)).toBe('teams-general-2026-11-12.zip');
  });

  it('loads snapshots and tells an unconfigured storage from a read error', async () => {
    expect(await fetchTeamSnapshots('t1', () => json({ snapshots: [] }))).toEqual({
      status: 'ok',
      data: [],
    });
    expect(
      await fetchTeamSnapshots('t1', () => json({ error: 'catalog_unavailable' }, 503)),
    ).toEqual({ status: 'unconfigured' });
    expect(await fetchTeamSnapshots('t1', () => Promise.reject(new Error('x')))).toEqual({
      status: 'error',
    });
  });

  it('exports the chosen channel with its reason, and words a refusal', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response('PK', { status: 200, headers: { 'x-backup365-messages': '182' } }),
      ),
    );
    const { done } = await exportChannel(choice, ' Ticket INC-1 ', fetchFn);
    expect(done).toEqual({ filename: 'teams-general-2026-11-12.zip', messages: 182, missing: 0 });
    expect(fetchFn).toHaveBeenCalledWith('/api/teams/t1/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshotId: 's1', channelId: 'c1', reason: 'Ticket INC-1' }),
    });
    await expect(
      exportChannel(choice, 'motif', () => json({ error: 'item_not_found' }, 404)),
    ).rejects.toThrow('ce canal n’est plus dans la sauvegarde à cette date');
  });
});

describe('Teams in plans and Sources (#34)', () => {
  it('offers Teams last in the plan form, unticked, with what it saves and the private chats notice', () => {
    const html = renderToStaticMarkup(
      <PlanWizard
        initial={emptyForm()}
        editing={false}
        mailboxes={[]}
        onSubmit={() => Promise.resolve(undefined)}
      />,
    );
    const box = /<input type="checkbox"([^>]*)>Teams/.exec(html)?.[1] ?? '';
    expect(box).not.toContain('checked');
    expect(box).toContain('aria-describedby="data-type-teams-help"');
    expect(html).toContain(
      'Teams : messages des canaux de toutes les équipes. Les fichiers des canaux sont protégés avec le site SharePoint de l’équipe. Les conversations privées ne sont pas sauvegardées.',
    );
    expect(html.indexOf('>SharePoint')).toBeLessThan(html.indexOf('>Teams'));
  });

  it('shows a « Teams (équipes et canaux) » line in Sources, and each team in the backups', () => {
    const report: StatusReport = {
      generatedAt: '2026-11-25T03:00:00Z',
      maxAgeHours: 26,
      alertCount: 1,
      rows: [
        {
          kind: 'team',
          sourceId: 't1',
          displayName: 'Accueil du public',
          workload: 'teams',
          lastSnapshotAt: '2026-11-23T02:00:00Z',
          ageHours: 49,
          state: 'stale',
        },
      ],
      services: [
        {
          service: 'teams',
          hasPlan: true,
          lastSnapshotAt: '2026-11-23T02:00:00Z',
          ageHours: 49,
          state: 'stale',
          retentionDays: 365,
          scope: { kind: 'all' },
          awaitingFirstRun: false,
        },
      ],
    };
    const html = renderToString(<StatusView state={report} />);
    expect(html).toContain('Teams (équipes et canaux)');
    expect(html).toContain('Les conversations privées ne sont pas sauvegardées.');
    expect(html).toContain('Toutes les équipes');
    expect(html).toContain('1 équipe sur 1 en retard');
    expect(html).toContain('Accueil du public');
  });
});

describe('Teams restore screens (#34)', () => {
  it('is reached by #/teams, under « Restaurer », with a fourth source tab', () => {
    expect(screenOf('#/teams')).toBe('teams');
    expect(navEntries('teams', false).find((e) => e.current)?.label).toBe('Restaurer');
    const tabs = renderToStaticMarkup(<RestoreSourceNav current="teams" />);
    expect(tabs).toContain('aria-label="Source à restaurer"');
    expect(tabs).toMatch(/<a href="#\/teams" aria-current="page">Teams<\/a>/);
  });

  it('opens on the title, the loading state and the private chats notice', () => {
    const out = renderToStaticMarkup(<TeamsPage admin />);
    expect(out).toContain('<h1>Restaurer depuis Teams</h1>');
    expect(out).toContain('role="status" aria-busy="true">Chargement des équipes…');
    expect(out).toContain('Les conversations privées ne sont pas sauvegardées.');
  });

  it('labels the team, channel and date lists, and waits for the channels', () => {
    const out = renderToStaticMarkup(
      <ChooseStep teams={[choice.team]} initial={null} onContinue={() => undefined} />,
    );
    expect(out).toContain('<label for="tm-team">Équipe</label>');
    expect(out).toContain('<label for="tm-channel">Canal</label>');
    expect(out).toMatch(/<select id="tm-channel" disabled="" aria-describedby="[^"]+"/);
    expect(out).toContain('Date de la sauvegarde (UTC)');
    expect(out).toContain('Chargement des canaux…');
    expect(out).toContain('onglet « Sites SharePoint »');
  });
});
