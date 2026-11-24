import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { API_ERRORS, readFailure, splitTitle } from './apiError.js';
import { PlanFailure } from './PlansPage.js';
import { FailureAlert } from './FailureAlert.js';
import { runPlan } from './plans.js';
import { errorMessage } from './session.js';

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('splitTitle', () => {
  it('splits a short title from the text and capitalises the text', () => {
    expect(splitTitle('Sauvegarde indisponible : la console n’est pas reliée.')).toEqual({
      title: 'Sauvegarde indisponible',
      text: 'La console n’est pas reliée.',
    });
  });

  it('keeps a message without separator, or with a long prefix, whole', () => {
    expect(splitTitle('Réessayez plus tard.')).toEqual({ text: 'Réessayez plus tard.' });
    const long = `${'x'.repeat(41)} : suite`;
    expect(splitTitle(long)).toEqual({ text: long });
  });

  it('gives a title to the backup-not-configured banner of a plan', () => {
    const html = renderToStaticMarkup(
      <PlanFailure
        problem={{
          message: API_ERRORS['backup_not_configured'] ?? '',
          code: 'backup_not_configured',
        }}
      />,
    );
    expect(html).toContain('<strong class="alert-title">Sauvegarde indisponible</strong>');
    expect(html).not.toContain('Sauvegarde indisponible :');
  });
});

describe('erreurs visibles', () => {
  it('explains every known business code in French, saying what to do', () => {
    for (const code of [
      'backup_not_configured',
      'audit_unavailable',
      'search_unavailable',
      'content_unavailable',
      'auth_unavailable',
    ]) {
      expect(API_ERRORS[code]).toMatch(/\p{L}{3,}.*\./u);
    }
  });

  it('uses no technical wording in any message', () => {
    for (const message of Object.values(API_ERRORS)) {
      expect(message).not.toMatch(/tenant|fichiers? de secrets|documentation d’installation/iu);
    }
  });

  it('never answers a bare "Erreur inattendue (HTTP nnn)"', async () => {
    const unknown = await readFailure(reply(502, {}));
    expect(unknown.message).not.toMatch(/^Erreur inattendue/u);
    expect(unknown.message).toContain('Réessayez');
    expect(await errorMessage(reply(500, { error: 'new_code' }))).toContain('prévenez');
  });

  it('keeps the request id and the code of a failed run', async () => {
    const fetchFn = (() =>
      Promise.resolve(
        reply(503, { error: 'backup_not_configured' }, { 'x-request-id': 'req-9' }),
      )) as typeof fetch;
    expect(await runPlan('p', 'x', fetchFn)).toMatchObject({
      ok: false,
      code: 'backup_not_configured',
      requestId: 'req-9',
      message: expect.stringContaining('Sauvegarde indisponible'),
    });
  });

  it('shows the not-configured message with a link to the home block, and the small request id', () => {
    const html = renderToStaticMarkup(
      <FailureAlert
        problem={{
          message: API_ERRORS['backup_not_configured'] ?? '',
          code: 'backup_not_configured',
          requestId: 'req-9',
        }}
      />,
    );
    expect(html).toContain('Sauvegarde indisponible');
    expect(html).toContain('<a href="#/">');
    expect(html).not.toContain('Configurer la connexion');
    expect(html).toContain('<code>req-9</code>');
    expect(renderToStaticMarkup(<FailureAlert problem={{ message: 'x' }} />)).not.toContain(
      'Identifiant de requête',
    );
  });
});
