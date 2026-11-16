import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RestoreAction, dialogTitle } from './RestoreAction.js';
import { SearchView } from './SearchPage.js';
import {
  announcement,
  failureCause,
  fetchLastRestore,
  fetchRestoreConfigured,
  formatClock,
  formatDuration,
  isOutcomeUncertain,
  lastRestoreLabel,
  RESTORE_MESSAGES,
  restoreFolderName,
  startRestore,
  type RestoreJob,
} from './restore.js';

const mail = {
  mailboxId: 'mbx 1',
  messageId: 'm/1=',
  snapshotId: 'snap-1',
  sender: 'alice@example.test',
  recipients: ['bob@example.test'],
  subject: 'Facture 1',
  date: '2026-01-01T10:00:00.000Z',
  folder: 'Inbox',
  size: 1234,
  attachments: [],
};

const job = (over: Partial<RestoreJob> = {}): RestoreJob => ({
  id: 'j1',
  mailboxId: 'mbx 1',
  messageId: 'm/1=',
  status: 'succeeded',
  startedAt: '2026-11-14T10:00:00.000Z',
  finishedAt: '2026-11-14T10:00:18.000Z',
  durationMs: 18_000,
  folder: 'Restauré par backup365 14/11/2026',
  error: null,
  ...over,
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('restore helpers', () => {
  it('names the folder with the UTC date, as the server does', () => {
    expect(restoreFolderName(new Date('2026-11-14T23:30:00Z'))).toBe(
      'Restauré par backup365 14/11/2026',
    );
  });

  it('formats durations and the running clock', () => {
    expect(formatDuration(18_000)).toBe('18 s');
    expect(formatDuration(200)).toBe('1 s');
    expect(formatDuration(65_000)).toBe('1 min 05 s');
    expect(formatClock(12_400)).toBe('00:12');
    expect(formatClock(-5)).toBe('00:00');
  });

  it('announces the running state once, then every 15 seconds', () => {
    expect(announcement(0)).toBe('Restauration en cours…');
    expect(announcement(14_999)).toBe('Restauration en cours…');
    expect(announcement(15_000)).toBe('Restauration en cours… 15 s');
    expect(announcement(44_000)).toBe('Restauration en cours… 30 s');
  });

  it('describes the last restoration on the sheet', () => {
    expect(lastRestoreLabel(null)).toBeNull();
    expect(lastRestoreLabel(job())).toBe('Dernière restauration : réussie, 18 s');
    expect(lastRestoreLabel(job({ status: 'failed', durationMs: 45_000 }))).toBe(
      'Dernière restauration : échouée, 45 s',
    );
    expect(lastRestoreLabel(job({ status: 'running', durationMs: null }))).toContain('en cours');
  });

  it('titles the panel after the state and explains the cause of a failure', () => {
    expect(dialogTitle(null)).toBe('Restaurer ce mail');
    expect(dialogTitle(job({ status: 'running' }))).toBe('Restauration en cours');
    expect(dialogTitle(job())).toBe('Restauration réussie');
    expect(dialogTitle(job({ status: 'failed' }))).toBe('Restauration échouée');
    expect(failureCause('restore_unreachable')).toBe('boîte injoignable pour le moment.');
    expect(failureCause('restore_lost')).toContain('perdu');
  });

  it('does not claim the mailbox is untouched when the outcome is uncertain', () => {
    expect(isOutcomeUncertain('restore_unreachable')).toBe(true);
    expect(isOutcomeUncertain('restore_lost')).toBe(true);
    expect(isOutcomeUncertain('restore_error')).toBe(false);
    expect(RESTORE_MESSAGES.uncertain).toContain('incertain');
  });
});

describe('restore requests', () => {
  it('posts the trimmed reason and returns the job', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => json({ job: job({ status: 'running' }) }, 202));
    const result = await startRestore('mbx 1', 'm/1=', ' Ticket #1234 ', fetchFn);
    expect(result).toMatchObject({ ok: true, job: { status: 'running' } });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/mails/mbx%201/m%2F1%3D/restore');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'Ticket #1234' });
  });

  it('translates server refusals into French messages', async () => {
    const refuse = (status: number, error: string) =>
      startRestore('a', 'b', 'motif', () => json({ error }, status) as Promise<Response>);
    expect(await refuse(403, 'forbidden')).toEqual({
      ok: false,
      message: 'Vous n’avez plus le droit de restaurer.',
    });
    expect(await refuse(404, 'mail_not_found')).toEqual({
      ok: false,
      message: 'Ce mail n’est plus disponible dans la sauvegarde.',
    });
    expect(await refuse(400, 'reason_required')).toMatchObject({
      message: 'Indiquez un motif (120 caractères au plus).',
    });
    expect(await refuse(500, 'boom')).toMatchObject({ ok: false });
    const down = await startRestore('a', 'b', 'motif', () => Promise.reject(new Error('net')));
    expect(down.ok).toBe(false);
  });

  it('reads the last restoration and whether restoration is configured', async () => {
    expect(
      await fetchLastRestore('a', 'b', () => json({ last: job() }) as Promise<Response>),
    ).toEqual(job());
    await expect(
      fetchLastRestore('a', 'b', () => json({}, 500) as Promise<Response>),
    ).rejects.toThrow('HTTP 500');
    expect(
      await fetchRestoreConfigured(() => json({ configured: false }) as Promise<Response>),
    ).toBe(false);
  });
});

describe('RestoreAction', () => {
  it('renders an enabled button named after the mail', () => {
    const html = renderToString(<RestoreAction mail={mail} configured />);
    expect(html).toContain('aria-label="Restaurer Facture 1"');
    expect(html).not.toContain('aria-disabled');
  });

  it('disables the button and links it to the hint when no tenant is linked', () => {
    const html = renderToString(<RestoreAction mail={mail} configured={false} hintId="hint" />);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-describedby="hint"');
  });

  it('adds a restore button to each search result, and the hint once when not configured', () => {
    const state = { total: 1, limit: 25, offset: 0, items: [mail] };
    const without = renderToString(<SearchView state={state} />);
    expect(without).not.toContain('Restaurer');
    const configured = renderToString(<SearchView state={state} restoreConfigured />);
    expect(configured).toContain('Restaurer Facture 1');
    const off = renderToString(<SearchView state={state} restoreConfigured={false} />);
    expect(off).toContain('La restauration nécessite un tenant relié.');
    expect(off).toContain('href="#/"');
  });
});
