import { nextRunAt, runIntervalMinutes, type ProtectionPlanInput } from '@backup365/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PlanScheduler,
  errorCode,
  executeurSimule,
  type Executeur,
  type ExecutionTarget,
} from './plan-scheduler.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';

const input: ProtectionPlanInput = {
  name: 'Mails',
  scope: 'selection',
  dataTypes: ['mail'],
  selection: ['a', 'b'],
  rpoHours: 4,
  rtoHours: null,
  retentionDays: 30,
  gdprJustification: 'Obligation de conservation.',
};

function setup(over: { executeur?: Executeur; selection?: string[] } = {}) {
  const plans = SqlitePlanStore.open(':memory:');
  const plan = plans.create({ ...input, selection: over.selection ?? input.selection });
  const clock = { at: nextRunAt(plan, new Date('2026-03-01T10:00:00Z')) };
  const logs: string[] = [];
  const log = (obj: Record<string, unknown>, msg: string) => logs.push(msg + JSON.stringify(obj));
  const calls: ExecutionTarget[] = [];
  const executeur: Executeur = over.executeur ?? {
    execute: (t) => {
      calls.push(t);
      return Promise.resolve();
    },
  };
  const make = () =>
    new PlanScheduler({
      plans,
      executeur,
      listItems: (p) => Promise.resolve(p.selection),
      logger: { info: log, error: log },
      now: () => new Date(clock.at.getTime() + 5_000),
    });
  const intervalMs = runIntervalMinutes(plan.rpoHours) * 60_000;
  return { plans, plan, clock, logs, calls, make, intervalMs };
}

describe('planificateur', () => {
  const zone = process.env.TZ;
  afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('runs a 24 h plan only in the night window, once per night when it succeeds', async () => {
    process.env.TZ = 'Europe/Paris';
    const plans = SqlitePlanStore.open(':memory:');
    const plan = plans.create({ ...input, name: 'Nuit', rpoHours: 24, selection: ['a'] });
    const calls: ExecutionTarget[] = [];
    const clock = { at: new Date('2026-11-16T10:00:00Z') };
    const scheduler = new PlanScheduler({
      plans,
      executeur: {
        execute: (t) => {
          calls.push(t);
          return Promise.resolve();
        },
      },
      listItems: (p) => Promise.resolve(p.selection),
      logger: { info: () => undefined, error: () => undefined },
      now: () => clock.at,
    });
    const start = clock.at.getTime();
    const hours: number[] = [];
    // Un tick par quart d'heure pendant 48 h : aucun passage en journée, pas de rattrapage au
    // démarrage, et une réussite au premier passage dispense du second : un passage par nuit.
    for (let t = start; t < start + 48 * 3_600_000; t += 900_000) {
      clock.at = new Date(t);
      const before = calls.length;
      await scheduler.tick();
      if (calls.length > before) hours.push(clock.at.getHours());
    }
    expect(hours).toHaveLength(2);
    for (const h of hours) expect(h >= 22 || h < 6).toBe(true);
    expect(plans.listRuns(plan.id, 10)).toHaveLength(2);
  });

  it('retries a failed item at the second pass of the night', async () => {
    process.env.TZ = 'Europe/Paris';
    const plans = SqlitePlanStore.open(':memory:');
    const plan = plans.create({ ...input, name: 'Nuit', rpoHours: 24, selection: ['a'] });
    let fail = true;
    const clock = { at: new Date('2026-11-16T10:00:00Z') };
    const scheduler = new PlanScheduler({
      plans,
      executeur: { execute: () => (fail ? Promise.reject(new Error('x')) : Promise.resolve()) },
      listItems: (p) => Promise.resolve(p.selection),
      logger: { info: () => undefined, error: () => undefined },
      now: () => clock.at,
    });
    const first = nextRunAt(plan, clock.at);
    clock.at = new Date(first.getTime() + 1000);
    await scheduler.tick();
    expect(plans.listRuns(plan.id, 10).map((r) => r.status)).toEqual(['failed']);
    fail = false;
    clock.at = new Date(first.getTime() + 241 * 60_000);
    await scheduler.tick();
    expect(plans.listRuns(plan.id, 10).map((r) => r.status)).toEqual(['success', 'failed']);
  });

  it('launches each item at the computed slots, once per slot', async () => {
    const { plans, plan, clock, calls, make, intervalMs } = setup();
    const scheduler = make();

    await scheduler.tick();
    expect(calls.map((c) => c.itemId)).toEqual(['a', 'b']);
    expect(plans.listRuns(plan.id, 10).every((r) => r.status === 'success')).toBe(true);

    // Même créneau : rien de nouveau.
    await scheduler.tick();
    expect(calls).toHaveLength(2);

    // Juste avant le créneau suivant : rien.
    clock.at = new Date(clock.at.getTime() + intervalMs - 10_000);
    await scheduler.tick();
    expect(calls).toHaveLength(2);

    // Au créneau suivant : une exécution par élément.
    clock.at = new Date(clock.at.getTime() + 10_000);
    await scheduler.tick();
    expect(calls).toHaveLength(4);
    expect(plans.listRuns(plan.id, 10)).toHaveLength(4);
  });

  it('lists the items of an all-scope plan once per slot, not at every tick', async () => {
    const { plans, clock, calls, intervalMs } = setup();
    const all = plans.create({ ...input, name: 'Tout', scope: 'all', selection: [] });
    const listAll = vi.fn();
    const scheduler = new PlanScheduler({
      plans,
      executeur: {
        execute: (t) => {
          calls.push(t);
          return Promise.resolve();
        },
      },
      listItems: (p) => {
        if (p.id !== all.id) return Promise.resolve(p.selection);
        listAll();
        return Promise.resolve(['m1', 'm2']);
      },
      logger: { info: () => undefined, error: () => undefined },
      now: () => new Date(clock.at.getTime() + 5_000),
    });
    const allCalls = () => calls.filter((c) => c.planId === all.id).length;
    await scheduler.tick();
    expect(allCalls()).toBe(2);
    expect(listAll).toHaveBeenCalledTimes(1);

    await scheduler.tick();
    await scheduler.tick();
    expect(listAll).toHaveBeenCalledTimes(1);

    clock.at = new Date(clock.at.getTime() + intervalMs);
    await scheduler.tick();
    expect(listAll).toHaveBeenCalledTimes(2);
    expect(allCalls()).toBe(4);
  });

  it('does not catch up every missed slot after a long stop', async () => {
    const { plans, plan, clock, calls, make, intervalMs } = setup();
    clock.at = new Date(clock.at.getTime() + 10 * intervalMs);
    await make().tick();
    expect(calls).toHaveLength(2);
    expect(plans.listRuns(plan.id, 10)).toHaveLength(2);
  });

  it('marks an interrupted run failed on restart and plans the next slot', async () => {
    const { plans, plan, clock, calls, make, intervalMs } = setup();
    // Avant l'arrêt : exécution commencée dans le créneau courant, jamais terminée.
    const stale = plans.startRun(plan.id, 'a', clock.at.toISOString());
    expect(stale).toBeDefined();

    const scheduler = make();
    scheduler.start();
    await vi.waitFor(() => expect(plans.listRuns(plan.id, 10).length).toBeGreaterThan(1));
    await scheduler.stop();

    const runs = plans.listRuns(plan.id, 10);
    const interrupted = runs.find((r) => r.id === stale);
    expect(interrupted).toMatchObject({ status: 'failed', error: 'interrupted' });
    expect(interrupted?.finishedAt).not.toBeNull();
    // Le créneau de « a » a déjà une exécution (interrompue) ; seul « b » est lancé.
    expect(calls.map((c) => c.itemId)).toEqual(['b']);

    // La suivante est replanifiée au créneau suivant.
    clock.at = new Date(clock.at.getTime() + intervalMs);
    await make().tick();
    expect(calls.map((c) => c.itemId)).toEqual(['b', 'a', 'b']);
  });

  it('stores the no_content reason with a successful run', async () => {
    const { plans, plan, make } = setup({
      selection: ['a'],
      executeur: { execute: () => Promise.resolve({ noSnapshotReason: 'no_content' }) },
    });
    await make().tick();
    expect(plans.listRuns(plan.id, 10)[0]).toMatchObject({
      status: 'success',
      noSnapshotReason: 'no_content',
    });
  });

  it('stores no reason for an ordinary success or a failure', async () => {
    const ok = setup({ selection: ['a'] });
    await ok.make().tick();
    expect(ok.plans.listRuns(ok.plan.id, 10)[0]?.noSnapshotReason).toBeNull();
    const ko = setup({
      selection: ['a'],
      executeur: { execute: () => Promise.reject(new Error('x')) },
    });
    await ko.make().tick();
    expect(ko.plans.listRuns(ko.plan.id, 10)[0]).toMatchObject({
      status: 'failed',
      noSnapshotReason: null,
    });
  });

  it('never runs twice at once on the same item', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const calls: ExecutionTarget[] = [];
    const { plans, plan, make } = setup({
      selection: ['a'],
      executeur: {
        execute: async (t) => {
          calls.push(t);
          await gate;
        },
      },
    });
    const scheduler = make();

    const first = await scheduler.runNow(plan);
    expect(first).toMatchObject({ started: 1, skipped: 0 });
    // Autre plan sur le même élément : refusé par la base.
    const other = plans.create({ ...input, name: 'Autre', selection: ['a'] });
    expect(plans.startRun(other.id, 'a', new Date().toISOString())).toBeUndefined();
    const ticking = scheduler.tick();
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    // Deuxième lancement manuel : mis en file, aucune exécution ouverte avant son tour.
    const second = await scheduler.runNow(plan);
    expect(second).toMatchObject({ started: 0, queued: true });
    expect(plans.listRuns(plan.id, 10)).toHaveLength(1);

    release();
    await first.done;
    await second.done;
    await ticking;
    // Le plan manuel deux fois, plus le passage du planificateur sur l'autre plan, à son tour.
    expect(calls).toHaveLength(3);
    expect(plans.listRuns(plan.id, 10).map((r) => r.status)).toEqual(['success', 'success']);

    // Libéré : l'élément peut de nouveau être lancé.
    expect(plans.startRun(other.id, 'a', new Date().toISOString())).toBeDefined();
  });

  it('never runs two backups at once on a tenant, manual or scheduled', async () => {
    let active = 0;
    let peak = 0;
    const calls: ExecutionTarget[] = [];
    const { plans, plan, make } = setup({
      executeur: {
        execute: async (t) => {
          calls.push(t);
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        },
      },
    });
    const other = plans.create({ ...input, name: 'Autre', selection: ['c'] });
    const scheduler = make();

    const first = await scheduler.runNow(plan);
    expect(first).toMatchObject({ started: 2, queued: false });
    const ticking = scheduler.tick();
    // Lancement manuel d'un autre plan pendant la sauvegarde : mis en file, pas un échec.
    const queued = await scheduler.runNow(other);
    expect(queued).toMatchObject({ started: 0, skipped: 0, queued: true });
    expect(scheduler.isQueued(other.id)).toBe(true);
    expect(plans.listRuns(other.id, 10)).toEqual([]);

    // Une seconde demande pour le même plan en file n'ajoute rien.
    expect(await scheduler.runNow(other)).toMatchObject({ started: 0, queued: true });

    await Promise.all([first.done, queued.done, ticking]);

    expect(peak).toBe(1);
    expect(scheduler.isQueued(other.id)).toBe(false);
    expect(calls.map((c) => c.itemId)).toContain('c');
    expect(plans.listRuns(other.id, 10).every((r) => r.status === 'success')).toBe(true);
    expect(plans.listRuns(plan.id, 10).every((r) => r.status === 'success')).toBe(true);
  });

  it('keeps no secret or mail content in logs or stored errors', async () => {
    const secret = 'S3cr3t-passphrase';
    const subject = 'Objet confidentiel du mail';
    const { plans, plan, logs, make } = setup({
      selection: ['a'],
      executeur: {
        execute: () => Promise.reject(new Error(`${subject} ${secret}`)),
      },
    });
    await make().tick();

    const [run] = plans.listRuns(plan.id, 10);
    expect(run).toMatchObject({ status: 'failed', error: 'Error' });
    const everything = logs.join('\n') + JSON.stringify(plans.listRuns(plan.id, 10));
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain(subject);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('works with the simulated executor and survives an unreadable plan scope', async () => {
    const plans = SqlitePlanStore.open(':memory:');
    const plan = plans.create(input);
    const logs: string[] = [];
    const logger = { info: () => undefined, error: (_o: unknown, m: string) => logs.push(m) };
    const scheduler = new PlanScheduler({
      plans,
      executeur: executeurSimule,
      listItems: () => Promise.reject(new Error('boom')),
      logger,
    });
    await scheduler.tick();
    expect(plans.listRuns(plan.id, 10)).toEqual([]);
    expect(logs).toEqual(['éléments du plan illisibles']);
  });

  it('fails the runs left unstarted when stopped during a manual run', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { plans, plan, make } = setup({
      executeur: { execute: () => gate },
    });
    const scheduler = make();
    const result = await scheduler.runNow(plan);
    expect(result.started).toBe(2);
    const stopping = scheduler.stop();
    release();
    await stopping;
    const runs = plans.listRuns(plan.id, 10);
    expect(runs.some((r) => r.status === 'running')).toBe(false);
    expect(runs.filter((r) => r.error === 'interrupted')).toHaveLength(1);
  });

  it('reduces an error to a safe code', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('ECONNRESET');
    expect(errorCode(new Error('mail subject with spaces'))).toBe('Error');
    expect(errorCode({ name: 'a b c' })).toBe('error');
    expect(errorCode(undefined)).toBe('error');
  });
});
