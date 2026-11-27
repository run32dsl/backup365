import { createRef } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { navEntries, screenFor } from './app/routing.js';
import { LastSendStatus, ReportsLayout } from './ReportsPage.js';
import {
  FIELD_ERRORS,
  addRecipient,
  lastSendSentence,
  pendingEntryError,
  recapLines,
  recipientsError,
  sendTestReport,
  testSentMessage,
  type ReportsView,
} from './reports.js';
import { MailerNotice } from './reports/MailerNotice.js';
import { ReportFailureAlert, isDeliveryFailure } from './reports/ReportFailureNotice.js';
import { ReportsForm } from './reports/ReportsForm.js';
import { SettingsNav } from './ui/index.js';

const noop = () => undefined;

function formElement(recipients: string[]) {
  return (
    <ReportsForm
      draft={{ recipients, frequency: 'weekly', failureAlert: true }}
      error={null}
      testing={false}
      test={null}
      field={createRef()}
      onChange={noop}
      onTest={noop}
      onContinue={noop}
    />
  );
}

function form(recipients = ['marie.durand@exemple.invalid']) {
  return renderToString(formElement(recipients));
}

/** La vue entière, avec le formulaire en enfant, pour un état d'envoi donné. */
function page(mailer: ReportsView['mailer'], recipients: string[] = []) {
  const view = {
    settings: { recipients, frequency: 'weekly', failureAlert: true },
    mailer,
    lastSend: null,
    plans: 0,
  } satisfies ReportsView;
  return renderToString(
    <ReportsLayout view={view} checking={false} checkError={null} saved={false} onRecheck={noop}>
      {formElement(recipients)}
    </ReportsLayout>,
  );
}

describe('report recipients', () => {
  it('adds one trimmed address at the end of the list', () => {
    expect(addRecipient(['a@x.invalid'], '  b@x.invalid ')).toEqual({
      ok: true,
      list: ['a@x.invalid', 'b@x.invalid'],
    });
  });

  it('refuses an invalid, duplicate or extra address with the error to show under the field', () => {
    expect(addRecipient([], 'nom')).toEqual({ ok: false, error: FIELD_ERRORS.invalid });
    expect(addRecipient([], '')).toEqual({ ok: false, error: FIELD_ERRORS.invalid });
    expect(addRecipient(['a@x.invalid'], 'A@X.invalid')).toEqual({
      ok: false,
      error: 'Cette adresse est déjà dans la liste.',
    });
    const full = Array.from({ length: 20 }, (_, i) => `r${i}@x.invalid`);
    expect(addRecipient(full, 'z@x.invalid')).toEqual({ ok: false, error: FIELD_ERRORS.tooMany });
  });

  it('holds « Continuer » and the test while an address is typed but not added', () => {
    expect(pendingEntryError('  ')).toBeNull();
    expect(pendingEntryError('b@x.invalid')).toBe(FIELD_ERRORS.pending);
  });

  it('gives the field errors of the mock-up', () => {
    expect(recipientsError(['nom'], false)).toBe(FIELD_ERRORS.invalid);
    expect(recipientsError([], true)).toBe(FIELD_ERRORS.none);
    const many = Array.from({ length: 21 }, (_, i) => `r${i}@x.invalid`);
    expect(recipientsError(many, true)).toBe('20 destinataires au plus.');
    expect(recipientsError(['a@x.invalid'], true)).toBeNull();
  });
});

describe('report texts', () => {
  it('summarises the settings in plain words', () => {
    const lines = recapLines({
      recipients: ['a@x.invalid', 'b@x.invalid'],
      frequency: 'weekly',
      failureAlert: true,
    });
    expect(lines[0]).toBe(
      'Le rapport de la semaine sera envoyé le lundi vers 07:00 UTC à 2 destinataires.',
    );
    expect(lines[1]).toBe('Une alerte partira à chaque échec de sauvegarde.');
    expect(lines[2]).toContain('Aucun nom de fichier, aucun objet de mail.');
  });

  it('names the test recipient and the UTC time', () => {
    expect(testSentMessage(['admin@exemple.invalid'], '2026-11-25T09:12:00.000Z')).toBe(
      'Essai envoyé à admin@exemple.invalid à 09:12 UTC.',
    );
  });

  it('turns a Microsoft refusal into the error with its time', async () => {
    const fetchFn = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'send_failed', at: '2026-11-25T09:12:00.000Z' }), {
          status: 502,
        }),
      )) as typeof fetch;
    const out = await sendTestReport(['a@x.invalid'], 'daily', fetchFn);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.message).toMatch(
      /^Échec de l’envoi de l’essai le 25\/11\/2026 09:12 UTC\. Microsoft 365 a refusé l’envoi\./u,
    );
  });
});

describe('mail reports screen', () => {
  it('explains what to do without Mail.Send, with « Vérifier à nouveau »', () => {
    const html = renderToString(
      <MailerNotice
        mailer={{ state: 'permission', sender: 's@x.invalid' }}
        checking={false}
        onRecheck={noop}
      />,
    );
    expect(html).toContain('Envoi par mail à autoriser');
    expect(html).toContain('role="status"');
    expect(html).toContain('<code>Mail.Send</code>');
    expect(html.split('Mail.Send')).toHaveLength(2);
    expect(html.replace('<!-- -->', '')).toContain(
      'Les rapports sont désactivés tant que l’envoi n’est pas autorisé.',
    );
    expect(html).toContain('Vérifier à nouveau');
  });

  it('shows no form, field or « Continuer » while sending is not allowed', () => {
    const html = page({ state: 'permission', sender: 's@x.invalid' });
    expect(html).toContain('Envoi par mail à autoriser');
    expect(html).toContain('Aucun rapport envoyé pour l’instant.');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Ajouter un destinataire');
    expect(html).not.toContain('Continuer');
    expect(html).not.toContain('disabled');
    const ready = page({ state: 'ready', sender: 's@x.invalid' });
    expect(ready).toContain('>Ajouter un destinataire</label>');
    expect(ready).toContain('Continuer');
    expect(ready).toContain('Envoyer un essai');
  });

  it('has a single « Ajouter » control and no « Rapport désactivé » pill', () => {
    for (const html of [
      page({ state: 'ready', sender: 's@x.invalid' }),
      page({ state: 'ready', sender: 's@x.invalid' }, ['a@x.invalid']),
      page({ state: 'permission', sender: 's@x.invalid' }),
    ]) {
      expect(html.match(/<button[^>]*>[^<]*Ajouter/gu) ?? []).toHaveLength(
        html.includes('<form') ? 1 : 0,
      );
      expect(html).not.toContain('Rapport désactivé');
    }
  });

  it('writes each recipient once, in the list, with no text area', () => {
    const html = form(['marie.durand@exemple.invalid', 'paul.martin@exemple.invalid']);
    expect(html).not.toContain('<textarea');
    for (const address of ['marie.durand@exemple.invalid', 'paul.martin@exemple.invalid']) {
      expect(html.split(`>${address}<`)).toHaveLength(2);
    }
    expect(html).toContain('>Ajouter un destinataire</label>');
    expect(html).toMatch(/<p id="[^"]+" class="recipient-intro">Seules ces personnes/u);
  });

  it('names each « Retirer » and shows the empty state without recipient', () => {
    expect(form()).toContain('aria-label="Retirer marie.durand@exemple.invalid"');
    const empty = form([]);
    expect(empty).toContain(
      '<div class="empty" role="status"><p>Aucun destinataire pour l’instant.</p></div>',
    );
  });

  it('gives the audit reminder as an information alert, with no typed glyph', () => {
    const html = form();
    expect(html).toMatch(
      /<div class="alert alert-info" role="status"><span class="alert-icon" aria-hidden="true">i<\/span><span class="alert-text">Chaque modification est inscrite au journal d’audit\.<\/span>/u,
    );
    expect(html).not.toContain('field-help reports-audit');
  });

  it('says the last send in a sentence, without the internal kind', () => {
    const at = '2026-11-23T07:00:00.000Z';
    expect(lastSendSentence({ at, kind: 'report', ok: true })).toBe(
      'Dernier rapport envoyé le 23/11/2026 07:00 UTC',
    );
    expect(lastSendSentence({ at, kind: 'alert', ok: true })).toBe(
      'Dernière alerte envoyée le 23/11/2026 07:00 UTC',
    );
    const view = {
      settings: { recipients: [], frequency: 'weekly', failureAlert: true },
      mailer: { state: 'ready', sender: 's@x.invalid' },
      lastSend: { at, kind: 'report', ok: true },
      plans: 1,
    } satisfies ReportsView;
    const html = renderToString(<LastSendStatus view={view} />);
    expect(html).toContain('Dernier rapport envoyé le 23/11/2026 07:00 UTC');
    expect(html).toContain('Envoyé');
    expect(html).not.toMatch(/\((rapport|alerte)\)/u);
  });

  it('is a Réglages view for administrators only', () => {
    expect(screenFor('#/rapports', true)).toBe('reports');
    expect(screenFor('#/rapports', false)).toBe('forbidden');
    const settings = navEntries('reports', true).find((e) => e.label === 'Réglages');
    expect(settings?.current).toBe(true);
    const nav = renderToString(<SettingsNav current="reports" />);
    expect(nav).toContain('aria-label="Vue des réglages"');
    expect(nav).toMatch(/href="#\/rapports" aria-current="page"/u);
  });

  it('shows on Home only a failed report or alert, not a failed test', () => {
    expect(isDeliveryFailure({ at: 'x', kind: 'report', ok: false })).toBe(true);
    expect(isDeliveryFailure({ at: 'x', kind: 'alert', ok: false })).toBe(true);
    expect(isDeliveryFailure({ at: 'x', kind: 'test', ok: false })).toBe(false);
    expect(isDeliveryFailure({ at: 'x', kind: 'report', ok: true })).toBe(false);
  });

  it('warns on Home, as a status, with the nature and date of the send in the title', () => {
    const report = renderToString(
      <ReportFailureAlert send={{ at: '2026-11-23T07:00:00.000Z', kind: 'report', ok: false }} />,
    );
    const alert = renderToString(
      <ReportFailureAlert send={{ at: '2026-11-27T09:12:00.000Z', kind: 'alert', ok: false }} />,
    );
    expect(report).toContain('class="alert alert-warning" role="status"');
    expect(report).toContain('Le rapport du 23/11/2026 n’a pas pu être envoyé');
    expect(alert).toContain('L’alerte d’échec du 27/11/2026 n’a pas pu être envoyée');
    for (const html of [report, alert]) {
      expect(html).not.toMatch(/\((rapport|alerte)\)/u);
      expect(html).toContain(
        '</strong>Les sauvegardes ne sont pas concernées ; les destinataires n’ont rien reçu. ' +
          'Microsoft 365 a refusé l’envoi : vérifiez la permission et la boîte d’envoi, puis envoyez un essai.</span>' +
          '<a class="alert-link" href="#/rapports">Ouvrir les rapports par mail</a></div>',
      );
    }
  });
});
