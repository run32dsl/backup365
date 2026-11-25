import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { failureCause as driveCause } from './onedrive.js';
import { failureCause as mailCause } from './restore.js';
import {
  RESTORE_FAILURE_ADVICE,
  RestoreFailureAlert,
  restoreFailureBanner,
} from './restoreFailure.js';
import { errorItemLabel, failureCause as siteCause, failureConsequence } from './sharepoint.js';

const errors = ['restore_error', 'restore_unreachable', 'restore_lost', null] as const;

describe('restore failure banner', () => {
  it('opens with a bold line naming the item and the UTC date', () => {
    const banner = restoreFailureBanner({
      item: 'plan-a.pdf',
      at: '2026-11-19T17:55:42.000Z',
      cause: 'boîte injoignable pour le moment.',
      consequence: 'Rien n’a été modifié',
    });
    expect(banner.title).toBe(
      'Échec de la restauration de «\u202Fplan-a.pdf\u202F» le 19/11/2026 17:55 UTC',
    );
    expect(banner.cause).toBe('Boîte injoignable pour le moment.');
    expect(banner.consequence).toBe('Rien n’a été modifié.');
    const html = renderToStaticMarkup(<RestoreFailureAlert banner={banner} />);
    expect(html).toContain('<strong>Échec de la restauration de «\u202Fplan-a.pdf\u202F»');
    expect(html).toContain(RESTORE_FAILURE_ADVICE);
  });

  it('gives one advice for every journey: retry, then warn the operator with the time', () => {
    expect(RESTORE_FAILURE_ADVICE).toBe(
      'Réessayez\u202F; si l’échec se répète, prévenez l’exploitant du serveur avec l’heure ci-dessus.',
    );
  });

  it('asks to verify before retrying when the outcome is uncertain', () => {
    const banner = restoreFailureBanner({
      item: 'x',
      at: '2026-11-19T17:55:00.000Z',
      cause: 'c',
      consequence: 'd',
      uncertain: true,
    });
    expect(banner.advice).toBe(
      'Une fois l’état vérifié, réessayez\u202F; si l’échec se répète, prévenez l’exploitant du serveur avec l’heure ci-dessus.',
    );
  });

  it('does not point to a missing time', () => {
    const banner = restoreFailureBanner({ item: 'x', at: null, cause: 'c', consequence: 'd' });
    expect(banner.advice).not.toContain('ci-dessus');
  });

  it('falls back to the site name for a root path', () => {
    expect(errorItemLabel({ scope: 'folder', path: '/', errors: 1 })).toBeNull();
  });

  it('drops the date rather than showing a broken one', () => {
    const banner = restoreFailureBanner({ item: 'x', at: null, cause: 'c', consequence: 'd' });
    expect(banner.title).toBe('Échec de la restauration de «\u202Fx\u202F»');
  });

  it.each(errors)('shows no technical code for the cause %s', (error) => {
    for (const cause of [mailCause(error), driveCause(error), siteCause(error)]) {
      const html = renderToStaticMarkup(
        <RestoreFailureAlert
          banner={restoreFailureBanner({
            item: 'x',
            at: '2026-11-19T17:55:00.000Z',
            cause,
            consequence: failureConsequence({ error, restored: 0, errors: 0 }),
          })}
        />,
      );
      expect(html).not.toMatch(/restore_|HTTP|[A-Z]{3,}_[A-Z]+|[0-9a-f]{8}-[0-9a-f]{4}/u);
    }
  });

  it('counts restored and failed items on a partial SharePoint failure', () => {
    expect(failureConsequence({ error: 'restore_error', restored: 3, errors: 2 })).toBe(
      '3 éléments restaurés, 2 éléments en erreur',
    );
    expect(failureConsequence({ error: 'restore_error', restored: 0, errors: 0 })).toBe(
      'Rien n’a été modifié',
    );
  });
});
