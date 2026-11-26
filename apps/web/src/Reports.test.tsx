import { createRef } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { navEntries, screenFor } from './app/routing.js';
import {
  FIELD_ERRORS,
  parseRecipients,
  recapLines,
  recipientsError,
  sendTestReport,
  testSentMessage,
} from './reports.js';
import { MailerNotice } from './reports/MailerNotice.js';
import { isDeliveryFailure } from './reports/ReportFailureNotice.js';
import { ReportsForm } from './reports/ReportsForm.js';
import { SettingsNav } from './ui/index.js';

const noop = () => undefined;

function form(ready: boolean, text = 'marie.durand@exemple.invalid') {
  return renderToString(
    <ReportsForm
      draft={{ text, frequency: 'weekly', failureAlert: true }}
      ready={ready}
      error={null}
      testing={false}
      test={null}
      field={createRef()}
      onChange={noop}
      onTest={noop}
      onContinue={noop}
    />,
  );
}

describe('report recipients', () => {
  it('splits on commas and new lines and drops duplicates', () => {
    expect(parseRecipients('a@x.invalid, b@x.invalid\nA@x.invalid;\n')).toEqual([
      'a@x.invalid',
      'b@x.invalid',
    ]);
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
    expect(html).toContain('Vérifier à nouveau');
  });

  it('greys out the form and hides the test button while sending is not allowed', () => {
    const html = form(false);
    expect(html).not.toContain('Envoyer un essai');
    expect(html).toMatch(/<textarea[^>]*disabled/u);
    expect(form(true)).toContain('Envoyer un essai');
  });

  it('names each « Retirer » and shows the empty state without recipient', () => {
    expect(form(true)).toContain('aria-label="Retirer marie.durand@exemple.invalid"');
    const empty = form(true, '');
    expect(empty).toContain('Aucun destinataire pour l’instant.');
    expect(empty).toContain('Ajouter un destinataire');
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
});
