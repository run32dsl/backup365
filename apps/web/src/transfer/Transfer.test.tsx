import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { detailLabel, reasonLabel } from '../auditLabels.js';
import { restoreFolderName, startRestore, type RestoreJob } from '../restore.js';
import { formRows, RestoreOutcome } from '../RestoreAction.js';
import { recallRows } from '../restoreRows.js';
import { ResultList } from '../ui/index.js';
import { accountLabel, foundLabel, searchAccounts, transferBoxes } from './model.js';
import { source } from '../testSources.js';
import {
  ConfirmView,
  confirmRows,
  DestinationChoice,
  DestinationView,
  ReasonView,
  TransferOutcome,
} from './TransferViews.js';

/** Restauration d'un mail vers la boîte d'un autre compte (issue #546). */

const camille = { id: 'camille@example.org', displayName: 'Camille Exemple' };
const dominique = { id: 'dominique@example.org', displayName: 'Dominique Fictif' };
const domitille = { id: 'domitille@example.org', displayName: 'Domitille Essai' };
const noop = () => undefined;
const mail = {
  mailboxId: camille.id,
  messageId: 'm1',
  subject: 'Budget 2026',
  date: '2026-11-25T02:00:00.000Z',
  folder: 'Inbox',
};
const now = Date.parse('2026-11-26T09:00:00Z');
/** Libellés de la liste (`<dt>`) dans l'ordre du rendu. */
const labels = (html: string): string[] =>
  [...html.matchAll(/<dt>([^<]*)<\/dt>/g)].map((m) => m[1] ?? '');

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
  folder: 'Restauré par backup365 26/11/2026',
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
        recall={recallRows(mail, transferBoxes(camille))}
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
    // La boîte source est dans la liste libellée, plus en texte brut « Source : » (#574).
    expect(labels(html)).toEqual(['Mail', 'Boîte d’origine']);
    expect(html).toContain(
      '<dt>Boîte d’origine</dt><dd>Camille Exemple · camille@example.org</dd>',
    );
    expect(html).not.toContain('Source :');
    expect(html).toContain('Rechercher un compte (nom ou adresse)');
    expect(html).toContain('Dominique Fictif · dominique@example.org');
    expect(html).toMatch(/disabled=""[^>]*aria-describedby/);
    expect(html).toContain('compte d’origine');
    expect(html).toContain('Choisissez un compte de destination.');
  });
});

describe('confirmation (A3)', () => {
  const folder = restoreFolderName(new Date(now));
  const confirm = renderToString(
    <ConfirmView
      rows={confirmRows(mail, camille, dominique, folder, ' Ticket INC-12345 ')}
      folder={folder}
      sending={false}
      onCancel={noop}
      onBack={noop}
      onConfirm={noop}
    />,
  );

  it('uses the operator labels and folder name, with a dd/mm/yyyy date (#574)', () => {
    const operator = renderToString(<ResultList rows={formRows(mail, now)} />);
    expect(labels(operator)).toEqual([
      'Mail',
      'Boîte',
      'Dossier d’origine',
      'Restauré dans le dossier',
    ]);
    expect(labels(confirm)).toEqual([
      'Mail',
      'Boîte d’origine',
      'Boîte de destination',
      'Dossier d’origine',
      'Restauré dans le dossier',
      'Motif',
    ]);
    for (const html of [operator, confirm]) {
      expect(html).toContain('Restauré par backup365 26/11/2026');
      expect(html).toContain('<dt>Mail</dt><dd>Budget 2026 · ');
    }
    expect(confirm).toContain(
      '<dt>Boîte de destination</dt><dd>Dominique Fictif · dominique@example.org</dd>',
    );
    expect(confirm).not.toMatch(/\d\d-\d\d-\d{4}/);
  });

  it('keeps « Ce qui va se passer » and a short action next to Annuler and Précédent', () => {
    expect(confirm).toContain('<h3>Ce qui va se passer</h3>');
    expect(confirm).toContain(
      'dossier « Restauré par backup365 26/11/2026 » de la boîte de destination',
    );
    const actions = confirm.slice(confirm.indexOf('dialog-actions'));
    expect([...actions.matchAll(/<button[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual([
      'Annuler',
      'Précédent',
      'Restaurer vers ce compte',
    ]);
    expect(accountLabel({ id: 'a@x', displayName: 'a@x' })).toBe('a@x');
  });

  it('opens on the read warning, before the list, without repeating the destination (#590)', () => {
    const warning = confirm.indexOf('La boîte de destination pourra lire ce mail.');
    expect(warning).toBeGreaterThanOrEqual(0);
    expect(warning).toBeLessThan(confirm.indexOf('<dt>Mail</dt>'));
    expect(confirm).not.toContain('pourra lire cet élément');
    expect(confirm.split('dominique@example.org')).toHaveLength(2);
    expect(confirm.split('Dominique Fictif')).toHaveLength(2);
  });

  it('offers Annuler at the reason step too', () => {
    const html = renderToString(
      <ReasonView reason="" onReason={noop} onCancel={noop} onBack={noop} onContinue={noop} />,
    );
    expect(html).toContain('>Annuler<');
    expect(html).toContain('>Précédent<');
  });
});

describe('result (A4)', () => {
  it('shows a short banner and the operator list, with the destination box', () => {
    const html = renderToString(
      <TransferOutcome job={transferJob()} mail={mail} onClose={noop} onRetry={noop} />,
    );
    expect(html).toContain('Mail restauré en <!-- -->2 s<!-- -->.');
    expect(labels(html)).toEqual([
      'Mail',
      'Boîte d’origine',
      'Boîte de destination',
      'Dossier d’origine',
      'Restauré dans le dossier',
    ]);
    expect(html).toContain('<dt>Dossier d’origine</dt><dd>Boîte de réception</dd>');
    expect(html).toContain('Restauré par backup365 26/11/2026');
    expect(html).not.toContain('Dossier :');
    expect(html).not.toContain('a été restauré vers');
    expect(html).toContain('Voir dans le journal d’audit');
    // Même liste que l'opérateur, une ligne « Boîte de destination » en plus.
    const operator = renderToString(
      <RestoreOutcome job={transferJob()} mail={mail} onClose={noop} onRetry={noop} />,
    );
    const shared = labels(html)
      .filter((l) => l !== 'Boîte de destination')
      .map((l) => (l === 'Boîte d’origine' ? 'Boîte' : l));
    expect(labels(operator)).toEqual(shared);
  });

  it('names the destination in the failure cause and asks to check the folder if uncertain', () => {
    const html = renderToString(
      <TransferOutcome
        job={transferJob({ status: 'failed', error: 'restore_unreachable' })}
        mail={mail}
        onClose={noop}
        onRetry={noop}
      />,
    );
    expect(html).toContain('la boîte de Dominique Fictif');
    expect(html).toContain('<dt>Dossier visé</dt><dd>Restauré par backup365 26/11/2026</dd>');
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
