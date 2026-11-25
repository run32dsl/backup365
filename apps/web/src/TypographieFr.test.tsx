import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { API_ERRORS, fallbackMessage } from './apiError.js';
import { FailureAlert } from './FailureAlert.js';
import { NBSP, NNBSP, quoted } from './format.js';
import { restoreFailureBanner } from './restoreFailure.js';
import { noResultText } from './SearchPage.js';

/** Une espace ordinaire après « « », avant « » », « ? », « ; », « ! » ou « ! » permet une coupe de ligne. */
const BAD = /« | »| [?;!]/;

describe('typographie française des messages', () => {
  it('quoted wraps the text in guillemets with narrow no-break spaces', () => {
    expect(quoted('x')).toBe('« x »');
    expect(NNBSP).toBe(' ');
    expect(NBSP).toBe(' ');
  });

  it('keeps the failure banner of a restore free of breakable spaces', () => {
    for (const uncertain of [false, true]) {
      const b = restoreFailureBanner({
        item: 'Devis',
        at: '2026-11-25T05:35:00Z',
        cause: 'La boîte est verrouillée',
        consequence: 'Rien n’a été modifié',
        uncertain,
      });
      expect([b.title, b.cause, b.consequence, b.advice].join('\n')).not.toMatch(BAD);
    }
  });

  it('keeps every API failure message free of breakable spaces', () => {
    for (const message of [...Object.values(API_ERRORS), fallbackMessage(500)]) {
      expect(message).not.toMatch(BAD);
    }
    const html = renderToStaticMarkup(
      <FailureAlert
        problem={{
          code: 'internal_error',
          message: API_ERRORS['internal_error']!,
          requestId: 'r-1',
        }}
      />,
    );
    expect(html.replace(/<[^>]+>/g, '')).not.toMatch(BAD);
  });

  it('keeps the empty search state free of breakable spaces', () => {
    for (const query of [
      undefined,
      { q: 'introuvable-xyz' },
      { q: 'devis', mailbox: 'a@b.c' },
      { q: 'devis', after: '2026-01-01', before: '2026-02-01' },
    ]) {
      expect(noResultText(query)).not.toMatch(BAD);
    }
    expect(noResultText({ q: 'devis' })).toContain(quoted('devis'));
  });
});
