import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  RETENTION_TEXT,
  RetentionView,
  excessLabel,
  fetchRetention,
  type RetentionExcessItem,
} from './plans/RetentionSimulation.js';
import type { PlanItem } from './plans/model.js';

const plan = (id: string, name: string, retentionDays: number) =>
  ({ id, name, retentionDays }) as PlanItem;

const excess = (over: Partial<RetentionExcessItem>): RetentionExcessItem => ({
  planId: 'p1',
  retentionDays: 90,
  cutoff: '2026-08-28T12:00:00.000Z',
  snapshots: 0,
  items: 0,
  bytes: 0,
  oldestAt: null,
  ...over,
});

const text = (html: string) => html.replace(/<[^>]+>/g, ' ');

describe('simulation de conservation (issue #79)', () => {
  it('dit ce qui dépasse la durée de chaque plan, avec le volume, et que rien n’est supprimé', () => {
    const html = renderToStaticMarkup(
      <RetentionView
        state={[
          excess({ snapshots: 2, items: 1, bytes: 1_850_000_000 }),
          excess({ planId: 'p2', retentionDays: 365 }),
        ]}
        plans={[plan('p1', 'Mails', 90), plan('p2', 'Direction', 365)]}
      />,
    );
    const out = text(html);
    expect(out).toContain(RETENTION_TEXT.title);
    expect(out).toContain('Conservation non appliquée pour l’instant : rien n’est supprimé.');
    expect(out).toContain('Mails');
    expect(out).toContain(
      'Durée 90 jours : 2 points de restauration (1 élément) antérieurs au 28/08/2026, 1,9 Go.',
    );
    expect(out).toContain('Direction');
    expect(out).toContain('Durée 1 an : rien ne la dépasse.');
    // Pas de second tableau sur l'écran des plans.
    expect(html).not.toContain('<table');
  });

  it('accorde au singulier et ignore un plan inconnu de la liste', () => {
    expect(excessLabel(excess({ snapshots: 1, items: 1, bytes: 842 }))).toBe(
      'Durée 90 jours : 1 point de restauration (1 élément) antérieur au 28/08/2026, 842 o.',
    );
    const html = renderToStaticMarkup(
      <RetentionView state={[excess({ planId: 'gone' })]} plans={[plan('p1', 'Mails', 90)]} />,
    );
    expect(html).not.toContain('<dl');
  });

  it('montre le chargement et l’indisponibilité du stockage', () => {
    expect(renderToStaticMarkup(<RetentionView state="loading" plans={[]} />)).toContain(
      RETENTION_TEXT.loading,
    );
    expect(renderToStaticMarkup(<RetentionView state="error" plans={[]} />)).toContain(
      RETENTION_TEXT.error,
    );
  });

  it('lit la route de simulation et lève hors 2xx', async () => {
    const urls: string[] = [];
    const ok = (url: RequestInfo | URL) => {
      urls.push(String(url));
      return Promise.resolve(Response.json({ items: [excess({ snapshots: 3 })] }));
    };
    expect((await fetchRetention(ok as typeof fetch))[0]?.snapshots).toBe(3);
    expect(urls).toEqual(['/api/plans/retention']);
    const ko = () => Promise.resolve(new Response('', { status: 503 }));
    await expect(fetchRetention(ko as typeof fetch)).rejects.toThrow();
  });
});
