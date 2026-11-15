import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { screenOf } from './App.js';
import { ExportForm, MailPage, MailView } from './MailPage.js';
import { SearchPage, SearchView } from './SearchPage.js';
import {
  exportEml,
  fetchMail,
  isReasonValid,
  mailHref,
  parseMailHash,
  searchMails,
  searchQueryFromForm,
} from './mail.js';

const mail = {
  mailboxId: 'mbx 1',
  messageId: 'm/1=',
  snapshotId: 'snap-1',
  sender: 'alice@example.test',
  recipients: ['bob@example.test', 'carol@example.test'],
  subject: 'Facture 1',
  date: '2026-01-01T10:00:00.000Z',
  folder: 'Inbox',
  size: 1234,
  attachments: ['facture.pdf'],
};

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('SearchView', () => {
  it('lists results with a link to each sheet', () => {
    const html = renderToString(
      <SearchView state={{ total: 40, limit: 25, offset: 0, items: [mail] }} />,
    );
    expect(html).toContain('Facture 1');
    expect(html.replace(/<!-- -->/g, '')).toContain('40 résultat(s), 1 à 1');
    expect(html).toContain(`href="${mailHref(mail)}"`);
  });

  it('shows empty, loading and error states, and escapes content', () => {
    const empty = { total: 0, limit: 25, offset: 0, items: [] };
    expect(renderToString(<SearchView state={empty} />)).toContain('Aucun résultat');
    expect(renderToString(<SearchView state="loading" />)).toContain('en cours');
    expect(renderToString(<SearchView state="error" />)).toContain('indisponible');
    const html = renderToString(
      <SearchView state={{ ...empty, total: 1, items: [{ ...mail, subject: '<img src=x>' }] }} />,
    );
    expect(html).not.toContain('<img');
  });

  it('renders the search form with the free text, mailbox and date filters', () => {
    const html = renderToString(<SearchPage />);
    for (const name of ['q', 'mailbox', 'after', 'before'])
      expect(html).toContain(`name="${name}"`);
  });
});

describe('MailPage', () => {
  it('shows the metadata of the mail', () => {
    const html = renderToString(<MailView state={mail} />);
    expect(html).toContain('bob@example.test, carol@example.test');
    expect(html).toContain('facture.pdf');
    expect(html).toContain('1234');
  });

  it('shows loading and error states, and the export form only once the sheet is loaded', () => {
    expect(renderToString(<MailView state="error" />)).toContain('indisponible');
    const html = renderToString(<MailPage mailboxId="mbx-1" messageId="m1" />);
    expect(html).toContain('Chargement');
    expect(html).not.toContain('Exporter en EML');
  });
});

describe('ExportForm', () => {
  it('shows the label, the ticket placeholder and the no-personal-data guidance', () => {
    const html = renderToString(
      <ExportForm
        reason=""
        exporting="idle"
        onReason={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(html).toContain('Motif de l’export');
    expect(html).toContain('placeholder="Ticket INC-12345"');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain(
      'Indiquez de préférence le numéro du ticket interne. N’y saisissez pas de donnée personnelle (nom, adresse, contenu du mail).',
    );
  });
});

describe('mail helpers', () => {
  it('refuses a reason longer than 120 characters', () => {
    expect(isReasonValid('x'.repeat(120))).toBe(true);
    expect(isReasonValid('x'.repeat(121))).toBe(false);
  });

  it('round-trips the sheet address, including reserved characters', () => {
    expect(parseMailHash(mailHref(mail))).toEqual({ mailboxId: 'mbx 1', messageId: 'm/1=' });
    expect(parseMailHash('#/mail/a')).toBeNull();
    expect(parseMailHash('#/mail/%E0%A4%A/b')).toBeNull();
  });

  it('routes the new screens', () => {
    expect(screenOf('#/search')).toBe('search');
    expect(screenOf(mailHref(mail))).toBe('mail');
    expect(screenOf('#/mail/x')).toBe('home');
  });

  it('builds the search query from the form, dropping empty filters in the request', async () => {
    const form = new FormData();
    form.set('q', ' facture ');
    form.set('mailbox', '');
    form.set('after', '2026-01-01T10:00');
    form.set('before', '');
    const query = searchQueryFromForm(form);
    expect(query).toMatchObject({ q: 'facture', limit: 25, offset: 0, before: '' });
    expect(query.after).toMatch(/^2026-01-01T\d\d:00:00\.000Z$/);
    const fetchFn = vi.fn<typeof fetch>(() => json({ total: 0, limit: 25, offset: 0, items: [] }));
    await searchMails(query, fetchFn);
    const url = String(fetchFn.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('q=facture');
    expect(url).not.toContain('mailbox');
    expect(url).not.toContain('before');
  });

  it('requires a reason of at least three characters', () => {
    expect(isReasonValid('  ab ')).toBe(false);
    expect(isReasonValid(' Audit interne ')).toBe(true);
  });

  it('posts the trimmed reason to the export route and returns the file', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('EML', { status: 200 })),
    );
    const blob = await exportEml(
      'mbx 1',
      'm/1=',
      ' Audit interne ',
      fetchFn as unknown as typeof fetch,
    );
    expect(await blob.text()).toBe('EML');
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/mails/mbx%201/m%2F1%3D/export');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ reason: 'Audit interne' });
  });

  it('throws on a refused export or sheet', async () => {
    const refuse = (() => json({}, 503)) as unknown as typeof fetch;
    await expect(exportEml('a', 'b', 'motif', refuse)).rejects.toThrow('HTTP 503');
    await expect(fetchMail('a', 'b', refuse)).rejects.toThrow('HTTP 503');
  });
});
