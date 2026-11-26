import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { detailLabel, reasonLabel } from '../auditLabels.js';
import { quoted } from '../format.js';
import { startRestore, type RestoreJob } from '../restore.js';
import {
  accountLabel,
  confirmRows,
  foundLabel,
  searchAccounts,
  transferFolderName,
} from './model.js';
import { source } from '../testSources.js';
import {
  ConfirmView,
  DestinationChoice,
  DestinationView,
  TransferOutcome,
} from './TransferViews.js';

/** Restauration d'un mail vers la boîte d'un autre compte (issue #546). */

const camille = { id: 'camille@example.org', displayName: 'Camille Exemple' };
const dominique = { id: 'dominique@example.org', displayName: 'Dominique Fictif' };
const domitille = { id: 'domitille@example.org', displayName: 'Domitille Essai' };
const noop = () => undefined;

const transferJob = (
  over: Partial<RestoreJob> = {},
): RestoreJob & {
  transfer: NonNullable<RestoreJob['transfer']>;
} => ({
  id: 'j1',
  mailboxId: camille.id,
  messageId: 'm1',
  status: 'succeeded',
  startedAt: '2026-11-26T10:00:00.000Z',
  finishedAt: '2026-11-26T10:00:02.000Z',
  durationMs: 2000,
  folder: 'Restauration de Camille Exemple 26-11-2026',
  error: null,
  ...over,
  transfer: {
    sourceName: 'Camille Exemple',
    targetId: dominique.id,
    targetName: 'Dominique Fictif',
  },
});

describe('account search', () => {
  it('matches name or address, without case nor accents, sorted by name', () => {
    const all = [domitille, camille, dominique];
    expect(searchAccounts(all, 'DOMI').map((m) => m.id)).toEqual([dominique.id, domitille.id]);
    expect(searchAccounts(all, 'example.org')).toHaveLength(3);
    expect(searchAccounts([{ id: 'e@x', displayName: 'Élodie' }], 'elo')).toHaveLength(1);
    expect(foundLabel(0)).toBe('Aucun compte ne correspond à cette recherche.');
    expect(foundLabel(2)).toBe('2 comptes trouvés.');
  });

  it('shows the found accounts, the source one disabled', () => {
    const html = renderToString(
      <DestinationView
        source={camille}
        choice={null}
        query="e"
        search={[camille, dominique]}
        selected=""
        error="Choisissez un compte de destination."
        onQuery={noop}
        onSearch={noop}
        onSelect={noop}
        onCancel={noop}
        onContinue={noop}
      />,
    );
    expect(html).toContain('Boîte de Camille Exemple · camille@example.org');
    expect(html).toContain('Rechercher un compte (nom ou adresse)');
    expect(html).toContain('Dominique Fictif · dominique@example.org');
    expect(html).toMatch(/disabled=""[^>]*aria-describedby/);
    expect(html).toContain('compte d’origine');
    expect(html).toContain('Choisissez un compte de destination.');
  });
});

describe('confirmation (A3)', () => {
  it('names the source and the destination, and the new folder', () => {
    const rows = confirmRows({
      subject: 'Budget 2026',
      date: '2026-11-25T02:00:00.000Z',
      source: camille,
      target: dominique,
      reason: ' Ticket INC-12345 : départ d’un agent ',
      now: Date.parse('2026-11-26T09:00:00Z'),
    });
    expect(Object.fromEntries(rows)).toEqual({
      Élément: 'Budget 2026 · 25/11/2026 02:00 UTC',
      Source: 'Camille Exemple · camille@example.org',
      Destination: 'Dominique Fictif · dominique@example.org',
      Emplacement: `Dossier ${quoted('Restauration de Camille Exemple 26-11-2026')} (nouveau, rien n’est écrasé)`,
      Motif: 'Ticket INC-12345 : départ d’un agent',
    });
    const html = renderToString(
      <ConfirmView
        rows={rows}
        targetName="Dominique Fictif"
        sending={false}
        onBack={noop}
        onConfirm={noop}
      />,
    );
    expect(html).toContain('Camille Exemple · camille@example.org');
    expect(html).toContain('Dominique Fictif pourra lire cet élément.');
    expect(html).toContain('Restaurer vers Dominique Fictif');
  });

  it('uses the source name and the UTC date for the folder, like the server', () => {
    expect(transferFolderName('Camille Exemple', new Date('2026-11-26T23:30:00Z'))).toBe(
      'Restauration de Camille Exemple 26-11-2026',
    );
    expect(accountLabel({ id: 'a@x', displayName: 'a@x' })).toBe('a@x');
  });
});

describe('result (A4)', () => {
  it('says what was restored, from whom, to whom, and where', () => {
    const html = renderToString(
      <TransferOutcome job={transferJob()} subject="Budget 2026" onClose={noop} onRetry={noop} />,
    );
    expect(html).toContain('Budget 2026');
    expect(html).toContain('de Camille Exemple a été restauré vers Dominique Fictif.');
    expect(html).toContain('Dossier : Restauration de Camille Exemple 26-11-2026');
    expect(html).toContain('Voir dans le journal d’audit');
  });

  it('names the destination in the failure cause and asks to check the folder if uncertain', () => {
    const html = renderToString(
      <TransferOutcome
        job={transferJob({ status: 'failed', error: 'restore_unreachable' })}
        subject="Budget 2026"
        onClose={noop}
        onRetry={noop}
      />,
    );
    expect(html).toContain('la boîte de Dominique Fictif');
    expect(html).toContain('Restauration de Camille Exemple 26-11-2026');
    expect(html).toContain('Réessayer');
  });
});

describe('server exchange', () => {
  it('sends the destination account and maps the admin refusal', async () => {
    const sent: unknown[] = [];
    const ok = await startRestore(
      camille.id,
      'm1',
      ' Ticket ',
      (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return Promise.resolve(
          new Response(JSON.stringify({ job: transferJob() }), { status: 202 }),
        );
      },
      dominique.id,
    );
    expect(ok.ok).toBe(true);
    expect(sent).toEqual([{ reason: 'Ticket', targetMailbox: dominique.id }]);
    const refused = await startRestore(camille.id, 'm1', 'Ticket', () =>
      Promise.resolve(new Response(JSON.stringify({ error: 'admin_required' }), { status: 403 })),
    );
    expect(refused).toMatchObject({ ok: false, message: 'Action réservée aux administrateurs.' });
  });
});

describe('rights', () => {
  it('offers « Un autre compte » to administrators only', () => {
    const text = source('RestoreAction.tsx');
    // Le choix n'est rendu que pour un administrateur, et le parcours n'est ouvert qu'à lui.
    expect(text).toContain('const destinationChoice = admin ? <DestinationChoice');
    expect(text).toContain("const other = admin && mode === 'other';");
    const html = renderToString(<DestinationChoice value="origin" onChange={noop} />);
    expect(html).toContain('Le compte d’origine');
    expect(html).toContain('Un autre compte');
  });
});

describe('audit labels', () => {
  it('reads who to whom from the request and the result', () => {
    const request = `from=${camille.id};to=${dominique.id};reason=Ticket INC-1`;
    expect(detailLabel(request)).toBe(
      'Restauration vers un autre compte · de camille@example.org vers dominique@example.org',
    );
    expect(reasonLabel(request)).toBe('Ticket INC-1');
    const result = `outcome=succeeded;duration_ms=2000;from=${camille.id};to=${dominique.id};reason=Ticket INC-1`;
    expect(detailLabel(result)).toBe(
      'Réussie, 2 s · Restauration vers un autre compte · de camille@example.org vers dominique@example.org',
    );
    expect(reasonLabel(result)).toBe('Ticket INC-1');
  });
});
