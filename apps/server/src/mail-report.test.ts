import { describe, expect, it } from 'vitest';
import { alertMessage, durationText, reportText, summarize, volumeText } from './mail-report.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';

const base = {
  scope: 'selection' as const,
  dataTypes: ['mail' as const],
  rpoHours: 24 as const,
  rtoHours: null,
  retentionDays: 30,
  gdprJustification: 'Obligation de conservation.',
};

const at = (day: number, hour = 2, minute = 0) =>
  new Date(Date.UTC(2026, 10, day, hour, minute)).toISOString();

/** Deux plans : « Direction » à jour, « Comptabilité » en échec ; des boîtes et codes qui ne doivent pas sortir. */
function fixture() {
  const plans = SqlitePlanStore.open(':memory:');
  const a = plans.create({
    ...base,
    name: 'Direction',
    selection: ['marie.durand@exemple.invalid'],
  });
  const b = plans.create({
    ...base,
    name: 'Comptabilité',
    selection: ['paul.martin@exemple.invalid'],
  });
  const ok = plans.startRun(a.id, 'marie.durand@exemple.invalid', at(23, 10))!;
  plans.finishRun(ok, 'success', at(23, 10, 30), undefined, { sourceBytes: 12_400_000_000 });
  const ko = plans.startRun(b.id, 'paul.martin@exemple.invalid', at(23, 3))!;
  plans.finishRun(ko, 'failed', at(23, 3, 8), 'ErrorItemNotFound');
  // Hors période hebdomadaire : ne compte pas.
  const old = plans.startRun(a.id, 'marie.durand@exemple.invalid', at(1))!;
  plans.finishRun(old, 'success', at(1, 3), undefined, { sourceBytes: 999 });
  return plans;
}

describe('mail report content', () => {
  const now = new Date(at(24, 7));

  it('counts plan states, runs, volume and duration over the period', () => {
    const plans = fixture();
    const summary = summarize(plans.list(), (id) => plans.listRuns(id, 500), now, 'weekly');
    expect(summary.plans).toEqual({ total: 2, compliant: 1, late: 0, failed: 1 });
    expect(summary).toMatchObject({ runs: 2, failures: 1, volumeBytes: 12_400_000_000 });
    expect(summary.durationMs).toBe(38 * 60_000);
    const text = reportText(summary, now, 'weekly');
    expect(text).toContain('Plans : 1 à jour · 0 en retard · 1 en échec');
    expect(text).toContain('Exécutions : 2, dont 1 échec');
    expect(text).toContain('Volume sauvegardé : 12,4 Go · Durée : 38 min');
    expect(text).toContain('- Comptabilité : en échec · 1 exécution · 1 échec');
  });

  it('contains no mailbox, no address and no technical error, only counters and plan states', () => {
    const plans = fixture();
    const text = reportText(
      summarize(plans.list(), (id) => plans.listRuns(id, 500), now, 'daily'),
      now,
      'daily',
    );
    expect(text).not.toMatch(/@|marie|paul|ErrorItemNotFound/u);
    const alert = alertMessage(plans.listRecentRuns({ result: 'failed', limit: 20 }), [
      'x@y.invalid',
    ]);
    expect(`${alert.subject}\n${alert.text}`).not.toMatch(/marie|paul|ErrorItemNotFound/u);
    expect(alert.subject).toBe('backup365 : échec du plan « Comptabilité »');
    expect(alert.text).toContain('- Comptabilité : 1 élément en échec');
  });

  it('says the report is empty without any plan', () => {
    const text = reportText(
      summarize([], () => [], now, 'daily'),
      now,
      'daily',
    );
    expect(text).toContain('Aucun plan de protection : le rapport est vide.');
  });

  it('formats volumes and durations in French', () => {
    expect(volumeText(0)).toBe('0 o');
    expect(volumeText(830_000_000)).toBe('830 Mo');
    expect(durationText(30_000)).toBe('moins d’1 min');
    expect(durationText(125 * 60_000)).toBe('2 h 05 min');
  });
});
