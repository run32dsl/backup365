import { nextRunAt, parseProtectionPlanInput, runIntervalMinutes } from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { listPlanItems } from './plan-items.js';
import { PlanScheduler, type ExecutionTarget } from './plan-scheduler.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';

/**
 * Issue #545 : un plan « tout le tenant » sauvegarde un compte créé après lui, sans qu'on touche
 * au plan. Planificateur, magasin et liste des éléments réels ; seuls l'annuaire Graph et
 * l'exécuteur sont simulés (aucun appel réseau).
 */
describe('plan « tout le tenant »', () => {
  it('backs up an account created after the plan, without changing the plan', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    const parsed = parseProtectionPlanInput({
      name: 'Tout le tenant',
      scope: 'all',
      dataTypes: ['mail', 'onedrive', 'sharepoint'],
      rpoHours: 4,
      retentionDays: 365,
      gdprJustification: 'Obligation légale : test.',
    });
    if (!parsed.ok) throw new Error(parsed.errors.join(' '));
    const plan = plans.create(parsed.plan);
    const before = JSON.stringify(plans.get(plan.id));

    // L'annuaire du tenant : un seul compte et un site à la création du plan. Le catalogue des
    // sauvegardes est vide : un compte jamais sauvegardé doit quand même être pris.
    const tenant = { owners: [{ id: 'alice' }], sites: [{ id: 'site-a' }] };
    const directory = {
      listOwners: () => Promise.resolve([...tenant.owners]),
      listSites: () => Promise.resolve([...tenant.sites]),
    };
    const catalog = {
      listMailboxes: () => Promise.resolve([]),
      listSites: () => Promise.resolve([]),
    };
    const calls: ExecutionTarget[] = [];
    const clock = {
      at: new Date(nextRunAt(plan, new Date('2026-03-01T10:00:00Z')).getTime() + 5000),
    };
    const scheduler = new PlanScheduler({
      plans,
      executeur: {
        execute: (t) => {
          calls.push(t);
          return Promise.resolve();
        },
      },
      listItems: (p) => listPlanItems(p, { catalog, directory }),
      logger: { info: () => undefined, error: () => undefined },
      now: () => clock.at,
    });

    await scheduler.tick();
    expect(calls.map((c) => c.itemId)).toEqual(['alice', 'site-a']);

    // Un compte et un site créés dans le tenant après le plan.
    tenant.owners.push({ id: 'bob' });
    tenant.sites.push({ id: 'site-b' });
    clock.at = new Date(clock.at.getTime() + runIntervalMinutes(plan.rpoHours) * 60_000);
    calls.length = 0;
    await scheduler.tick();

    expect(calls).toEqual([
      { planId: plan.id, itemId: 'alice', dataTypes: ['mail', 'onedrive'], kind: 'owner' },
      { planId: plan.id, itemId: 'bob', dataTypes: ['mail', 'onedrive'], kind: 'owner' },
      { planId: plan.id, itemId: 'site-a', dataTypes: ['sharepoint'], kind: 'site' },
      { planId: plan.id, itemId: 'site-b', dataTypes: ['sharepoint'], kind: 'site' },
    ]);
    // Le plan n'a pas changé ; seuls les nouveaux venus sont notés « ajoutés automatiquement ».
    expect(JSON.stringify(plans.get(plan.id))).toBe(before);
    const runs = plans.listRuns(plan.id, 10);
    expect(
      runs
        .filter((r) => r.autoAdded)
        .map((r) => r.itemId)
        .sort(),
    ).toEqual(['bob', 'site-b']);
    expect(runs.filter((r) => r.itemId === 'bob').map((r) => r.status)).toEqual(['success']);
  });

  it('does not mark anything as added at the very first run', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    const plan = plans.create({
      name: 'Tout',
      scope: 'all',
      dataTypes: ['mail'],
      selection: [],
      rpoHours: 4,
      rtoHours: null,
      retentionDays: 30,
      gdprJustification: 'Test.',
    });
    const scheduler = new PlanScheduler({
      plans,
      executeur: { execute: () => Promise.resolve() },
      listItems: (p) =>
        listPlanItems(p, {
          directory: {
            listOwners: () => Promise.resolve([{ id: 'a' }, { id: 'b' }]),
            listSites: () => Promise.resolve([]),
          },
        }),
      logger: { info: () => undefined, error: () => undefined },
    });
    const run = await scheduler.runNow(plan);
    await run.done;
    expect(plans.listRuns(plan.id, 10).map((r) => r.autoAdded)).toEqual([false, false]);
  });

  it('a first run resumed in the same slot adds nothing; a directory outage is retried', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    const plan = plans.create({
      name: 'Tout',
      scope: 'all',
      dataTypes: ['mail'],
      selection: [],
      rpoHours: 4,
      rtoHours: null,
      retentionDays: 30,
      gdprJustification: 'Test.',
    });
    const clock = {
      at: new Date(nextRunAt(plan, new Date('2026-03-01T10:00:00Z')).getTime() + 5000),
    };
    // Première exécution interrompue après « a » (redémarrage), dans le même créneau.
    plans.startRun(plan.id, 'a', clock.at.toISOString());
    plans.interruptRunning(clock.at.toISOString());
    const owners = { fail: true, list: [{ id: 'a' }, { id: 'b' }] };
    const listOwners = () =>
      owners.fail
        ? Promise.reject(Object.assign(new Error('x'), { code: 'ATLAS_GRAPH_UNAVAILABLE' }))
        : Promise.resolve(owners.list);
    const calls: string[] = [];
    const scheduler = new PlanScheduler({
      plans,
      executeur: {
        execute: (t) => {
          calls.push(t.itemId);
          return Promise.resolve();
        },
      },
      listItems: (p) =>
        listPlanItems(p, {
          // Catalogue des sauvegardes : il ne connaît que « a ».
          catalog: {
            listMailboxes: () => Promise.resolve([{ id: 'a' }]),
            listSites: () => Promise.resolve([]),
          },
          directory: { listOwners, listSites: () => Promise.resolve([]) },
        }),
      logger: { info: () => undefined, error: () => undefined },
      now: () => clock.at,
    });
    await scheduler.tick();
    // Annuaire en panne : le catalogue sert ; « a » a déjà son exécution dans ce créneau.
    expect(calls).toEqual([]);
    owners.fail = false;
    clock.at = new Date(clock.at.getTime() + 60_000);
    await scheduler.tick();
    // Annuaire rétabli dans le même créneau : « b » est pris sans attendre le créneau suivant,
    // et n'est pas « ajouté » : le plan n'avait encore jamais tourné à un créneau antérieur.
    expect(calls).toEqual(['b']);
    expect(plans.listRuns(plan.id, 10).every((r) => !r.autoAdded)).toBe(true);
  });
});
