import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { screenOf } from './App.js';
import { ExportForm, MailPage, MailView, RestoreSectionView, mailTitle } from './MailPage.js';
import { AUDIT_REMINDER, REASON } from './RestoreJourney.js';
import { submitFilters } from './audit.js';
import { SearchPage, SearchView } from './SearchPage.js';
import {
  exportEml,
  fetchMail,
  initialSearchQuery,
  isReasonValid,
  mailHref,
  parseMailHash,
  parseSearchHash,
  searchHref,
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
    expect(html).toContain('01/01/2026 10:00');
    expect(html).toContain('Boîte de réception');
    expect(html).not.toContain('T10:00');
    expect(html.replace(/<!-- -->/g, '')).toContain('40 résultats, 1 à 1');
    expect(html).toContain(`href="${mailHref(mail)}"`);
  });

  it('drops the mailbox column and names the mailbox in the counter when filtered', () => {
    const state = { total: 25, limit: 25, offset: 0, items: [mail] };
    const filtered = renderToString(<SearchView state={state} mailbox="paul.moreau@exemple.fr" />);
    expect(filtered).not.toContain('>Boîte<');
    expect(filtered).toContain('25 résultats');
    expect(filtered).toContain('dans la boîte paul.moreau@exemple.fr');
    expect(renderToString(<SearchView state={state} />)).toContain('>Boîte<');
    const withRestore = renderToString(
      <SearchView state={state} mailbox="paul.moreau@exemple.fr" restoreConfigured />,
    );
    expect(withRestore).toContain('>Action<');
    expect(withRestore).not.toContain('>Boîte<');
    const empty = { total: 0, limit: 25, offset: 0, items: [] };
    expect(renderToString(<SearchView state={empty} mailbox="paul.moreau@exemple.fr" />)).toContain(
      'Aucun résultat',
    );
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

  it('shows Précédent and Suivant only when there is more than one page', () => {
    const many = renderToString(
      <SearchView state={{ total: 40, limit: 25, offset: 0, items: [mail] }} />,
    );
    expect(many).toContain('Précédent');
    expect(many).toContain('Suivant');
    const one = renderToString(
      <SearchView state={{ total: 10, limit: 25, offset: 0, items: [mail] }} />,
    );
    expect(one).not.toContain('Précédent');
    expect(one).not.toContain('Suivant');
  });

  it('uses the shared filters container', () => {
    expect(renderToString(<SearchPage />)).toContain('class="filters"');
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
    expect(html).toContain('1,2 Ko');
  });

  it('omits empty metadata, titles the two sections and never mentions JSON', () => {
    const html = renderToString(<MailView state={{ ...mail, recipients: [] }} />);
    expect(html).not.toContain('Destinataires');
    expect(html).toContain('Expéditeur');
    const form = renderToString(
      <ExportForm
        reason=""
        exporting="idle"
        onReason={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(form).toContain('<h2');
    expect(form).toContain('Saisissez un motif pour exporter.');
    expect(form).toContain('aria-describedby="export-disabled-help"');
    expect(form).not.toContain('JSON');
  });

  it('titles the sheet with the subject, a fallback when blank, a generic title otherwise', () => {
    expect(mailTitle(mail)).toBe(mail.subject);
    expect(mailTitle({ ...mail, subject: '   ' })).toBe('(sans objet)');
    expect(mailTitle('loading')).toBe('Fiche d’un mail');
    expect(mailTitle('error')).toBe('Fiche d’un mail');
  });

  it('shows the empty-reason help only while the reason is empty', () => {
    const render = (reason: string) =>
      renderToString(
        <ExportForm
          reason={reason}
          exporting="idle"
          onReason={() => undefined}
          onSubmit={() => undefined}
        />,
      );
    expect(render('')).toContain('export-disabled-help');
    expect(render('ab')).not.toContain('export-disabled-help');
  });

  it('orders the export box: reason, attachments note, audit reminder, button, then result', () => {
    const render = (exporting: 'idle' | 'done' | 'error') =>
      renderToString(
        <ExportForm
          reason="ab"
          exporting={exporting}
          onReason={() => undefined}
          onSubmit={() => undefined}
        />,
      );
    const idle = render('idle');
    const reason = idle.indexOf('<label');
    expect(reason).toBeGreaterThan(-1);
    expect(reason).toBeLessThan(idle.indexOf('pièces jointes'));
    expect(idle.indexOf('pièces jointes')).toBeLessThan(idle.indexOf('alert-info'));
    expect(idle.indexOf('alert-info')).toBeLessThan(idle.indexOf('<button'));
    const done = render('done');
    const afterButton = done.indexOf('</button>') + '</button>'.length;
    expect(done.slice(afterButton)).toMatch(
      /^<div class="export-result">.*Export inscrit au journal d’audit\./,
    );
    expect(render('error').indexOf('export-result')).toBeGreaterThan(
      render('error').indexOf('</button>'),
    );
  });

  it('keeps the generic title while the sheet is loading', () => {
    const html = renderToString(<MailPage mailboxId="mbx-1" messageId="m1" />);
    expect(html).toContain('<h1>Fiche d’un mail</h1>');
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
    expect(html).toContain('Motif de l’export (obligatoire)');
    expect(html).toContain('maxLength="120"');
    expect(html).toContain(REASON.help);
    expect(html).toContain(AUDIT_REMINDER);
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

  it('shows a warning alert and no Restaurer button when restore is not configured', () => {
    const off = renderToString(<RestoreSectionView mail={mail} configured={false} last={null} />);
    expect(off).toMatch(/class="alert alert-warning" role="alert"/);
    expect(off).toContain('Restauration indisponible');
    expect(off).toContain('Prévenez un administrateur.</span>');
    expect(off).not.toContain('<button');
    expect(off).not.toContain('Restaurer Facture');
    const on = renderToString(<RestoreSectionView mail={mail} configured last={null} />);
    expect(on).toContain('Restaurer Facture 1');
    expect(on).not.toContain('role="alert"');
  });

  it('routes the new screens', () => {
    expect(screenOf('#/search')).toBe('search');
    expect(screenOf(searchHref('a@b.fr'))).toBe('search');
    expect(parseSearchHash(searchHref('a b/é'))).toBe('a b/é');
    expect(parseSearchHash('#/search')).toBeNull();
    expect(parseSearchHash('#/search?mailbox=%E0')).toBeNull();
    expect(screenOf(mailHref(mail))).toBe('mail');
    expect(screenOf('#/mail/x')).toBe('home');
  });

  it('builds the search query from the form, dropping empty filters in the request', async () => {
    const form = new FormData();
    form.set('q', ' facture ');
    form.set('mailbox', '');
    form.set('after', '18/11/2026');
    form.set('before', '18/11/2026');
    const query = searchQueryFromForm(form);
    expect(query).toMatchObject({
      q: 'facture',
      limit: 25,
      offset: 0,
      after: '2026-11-18T00:00:00.000Z',
      before: '2026-11-19T00:00:00.000Z',
    });
    const fetchFn = vi.fn<typeof fetch>(() => json({ total: 0, limit: 25, offset: 0, items: [] }));
    await searchMails(query, fetchFn);
    const url = String(fetchFn.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('q=facture');
    expect(url).not.toContain('mailbox');
    expect(url).toContain('after=2026-11-18T00%3A00%3A00.000Z');
    expect(url).toContain('before=2026-11-19T00%3A00%3A00.000Z');
  });

  it('shows jj/mm/aaaa text fields, without the native date input or « exclu »', () => {
    const html = renderToString(<SearchPage />);
    expect(html).not.toContain('datetime-local');
    expect(html).not.toContain('exclu');
    expect(html).toContain('Date au format jj/mm/aaaa, en UTC comme le tableau');
  });

  it('prefills the mailbox field and starts the search from the anchor mailbox', async () => {
    expect(renderToString(<SearchPage mailbox="a@b.fr" />)).toContain('value="a@b.fr"');
    expect(renderToString(<SearchPage />)).not.toContain('value="a@b.fr"');
    expect(initialSearchQuery()).toBeNull();
    const query = initialSearchQuery('a@b.fr');
    expect(query).toEqual({ limit: 25, offset: 0, mailbox: 'a@b.fr' });
    const fetchFn = vi.fn<typeof fetch>(() => json({ total: 0, limit: 25, offset: 0, items: [] }));
    await searchMails(query!, fetchFn);
    expect(String(fetchFn.mock.calls[0]?.[0] ?? '')).toContain('mailbox=a%40b.fr');
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

  it('refuses Du after Au under Au and accepts Du = Au for the whole UTC day', () => {
    const search = (after: string, before: string) => {
      const data = new FormData();
      data.set('after', after);
      data.set('before', before);
      const build = vi.fn(searchQueryFromForm);
      return { result: submitFilters(data, 'after', 'before', build), build };
    };
    const bad = search('20/11/2026', '18/11/2026');
    expect(bad.result.query).toBeNull();
    expect(bad.result.errors.toError).toBe(
      'La date « Au » doit être égale ou postérieure à « Du »',
    );
    expect(bad.build).not.toHaveBeenCalled();
    const same = search('18/11/2026', '18/11/2026');
    expect(same.result.errors.toError).toBeUndefined();
    expect(same.result.query).toMatchObject({
      after: '2026-11-18T00:00:00.000Z',
      before: '2026-11-19T00:00:00.000Z',
    });
  });
});
