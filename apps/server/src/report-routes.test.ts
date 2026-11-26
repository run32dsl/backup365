import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import {
  MailSendError,
  unconfiguredMailer,
  type Mailer,
  type MailerStatus,
} from './graph-mailer.js';
import type { MailMessage } from './mail-report.js';
import { ReportService, lastDueAt } from './report-service.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';
import type { Role } from './sqlite/sqlite-account-store.js';
import { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import { SqliteReportStore } from './sqlite/sqlite-report-store.js';
import { sessionFor, testAuth, withHeaders } from './test-support.js';

const base = {
  scope: 'selection' as const,
  dataTypes: ['mail' as const],
  rpoHours: 24 as const,
  rtoHours: null,
  retentionDays: 30,
  gdprJustification: 'Obligation de conservation.',
};

/** Faux envoi : garde les messages ; `fail` simule un refus de Microsoft. */
function fakeMailer(status: MailerStatus = { state: 'ready', sender: 's@exemple.invalid' }) {
  const sent: MailMessage[] = [];
  const mailer: Mailer & { fail: boolean } = {
    fail: false,
    status: () => Promise.resolve(status),
    send(message) {
      if (mailer.fail) return Promise.reject(new MailSendError('permission'));
      sent.push(message);
      return Promise.resolve();
    },
  };
  return { mailer, sent };
}

function setup(role: Role = 'admin', mailer: Mailer = fakeMailer().mailer, now = new Date()) {
  const { auth } = testAuth();
  const audit = SqliteAuditLog.open(':memory:');
  const plans = SqlitePlanStore.open(':memory:');
  const store = SqliteReportStore.open(':memory:');
  const errors: Record<string, unknown>[] = [];
  const clock = { now };
  const reports = new ReportService({
    store,
    plans,
    mailer,
    logger: { error: (obj) => errors.push(obj) },
    now: () => clock.now,
  });
  const app = withHeaders(
    buildApp({ version: '1', auth, audit, plans, reports }),
    sessionFor(auth, 'root', role).headers,
  );
  return { app, audit, plans, store, reports, errors, clock };
}

const settings = {
  recipients: ['marie.durand@exemple.invalid', 'MARIE.durand@exemple.invalid', 'b@exemple.invalid'],
  frequency: 'weekly',
  failureAlert: true,
};

describe('/api/reports', () => {
  it('saves the settings once audited, without the addresses in the audit log', async () => {
    const { app, audit } = setup();
    const res = await app.inject({ method: 'PUT', url: '/api/reports', payload: settings });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ settings: { recipients: string[] } }>().settings.recipients).toEqual([
      'marie.durand@exemple.invalid',
      'b@exemple.invalid',
    ]);
    const [entry] = (await audit.list({ limit: 10, offset: 0 })).items;
    expect(entry).toMatchObject({ action: 'settings.update', resource: 'reports', count: 2 });
    expect(JSON.stringify(entry)).not.toContain('@');
    const read = await app.inject({ method: 'GET', url: '/api/reports' });
    expect(read.json()).toMatchObject({
      settings: { frequency: 'weekly', failureAlert: true },
      mailer: { state: 'ready' },
      lastSend: null,
      plans: 0,
    });
  });

  it('refuses an invalid address and more than 20 recipients', async () => {
    const { app } = setup();
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/reports',
      payload: { ...settings, recipients: ['pas une adresse'] },
    });
    expect(bad.statusCode).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => `r${i}@exemple.invalid`);
    const tooMany = await app.inject({
      method: 'PUT',
      url: '/api/reports',
      payload: { ...settings, recipients: many },
    });
    expect(tooMany.statusCode).toBe(400);
  });

  it('is reserved to administrators', async () => {
    const { app } = setup('operator');
    expect((await app.inject({ method: 'GET', url: '/api/reports' })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'PUT', url: '/api/reports', payload: settings })).statusCode,
    ).toBe(403);
  });

  it('without Mail.Send, says so and refuses to save or send', async () => {
    const { app } = setup('admin', unconfiguredMailer('sender'));
    const read = await app.inject({ method: 'GET', url: '/api/reports' });
    expect(read.json<{ mailer: unknown }>().mailer).toEqual({
      state: 'unconfigured',
      missing: 'sender',
    });
    const save = await app.inject({ method: 'PUT', url: '/api/reports', payload: settings });
    expect(save.statusCode).toBe(409);
    const test = await app.inject({
      method: 'POST',
      url: '/api/reports/test',
      payload: { recipients: ['a@exemple.invalid'], frequency: 'daily' },
    });
    expect(test.statusCode).toBe(409);
    // Vider la liste reste possible : désactiver et effacer les adresses.
    const clear = await app.inject({
      method: 'PUT',
      url: '/api/reports',
      payload: { ...settings, recipients: [] },
    });
    expect(clear.statusCode).toBe(200);
  });

  it('checks the permission again on demand', async () => {
    let state: MailerStatus = { state: 'permission', sender: 's@exemple.invalid' };
    const mailer: Mailer = {
      status: () => Promise.resolve(state),
      send: () => Promise.resolve(),
    };
    const { app } = setup('admin', mailer);
    await app.inject({ method: 'GET', url: '/api/reports' });
    state = { state: 'ready', sender: 's@exemple.invalid' };
    const res = await app.inject({ method: 'POST', url: '/api/reports/check' });
    expect(res.json()).toEqual({ mailer: state });
  });

  it('allows one test every 30 seconds, without changing the last delivery', async () => {
    const { app, store } = setup();
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/reports/test',
        payload: { recipients: ['a@exemple.invalid'], frequency: 'daily' },
      });
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
    expect(store.lastSend()).toBeNull();
  });

  it('sends a test, audits it first, and reports a refusal as an error with its time', async () => {
    const fake = fakeMailer();
    const { app, audit, clock } = setup('admin', fake.mailer, new Date('2026-11-25T09:12:00Z'));
    await app.inject({ method: 'PUT', url: '/api/reports', payload: settings });
    const ok = await app.inject({
      method: 'POST',
      url: '/api/reports/test',
      payload: { recipients: ['a@exemple.invalid'], frequency: 'daily' },
    });
    expect(ok.statusCode).toBe(200);
    expect(fake.sent[0]).toMatchObject({ to: ['a@exemple.invalid'] });
    expect(fake.sent[0]!.text).toContain('Aucun plan de protection');
    expect((await audit.list({ limit: 10, offset: 0 })).items[0]).toMatchObject({
      action: 'report.test',
    });
    fake.mailer.fail = true;
    clock.now = new Date('2026-11-25T09:13:00Z');
    const ko = await app.inject({
      method: 'POST',
      url: '/api/reports/test',
      payload: { recipients: ['a@exemple.invalid'], frequency: 'daily' },
    });
    expect(ko.statusCode).toBe(502);
    expect(ko.json()).toEqual({ error: 'send_failed', at: '2026-11-25T09:13:00.000Z' });
  });
});

describe('report schedule and failure alerts', () => {
  it('sends the weekly report once per Monday 07:00 UTC', async () => {
    const fake = fakeMailer();
    const { reports, clock } = setup('admin', fake.mailer, new Date('2026-11-24T10:00:00Z'));
    reports.save({ recipients: ['a@exemple.invalid'], frequency: 'weekly', failureAlert: false });
    await reports.tick();
    expect(fake.sent).toHaveLength(0);
    clock.now = new Date('2026-11-30T07:01:00Z');
    await reports.tick();
    await reports.tick();
    expect(fake.sent.map((m) => m.subject)).toEqual(['backup365 : rapport de la semaine']);
  });

  it('alerts once per new failure, never for failures before the settings were saved', async () => {
    const fake = fakeMailer();
    const { reports, plans, store } = setup('admin', fake.mailer, new Date('2026-11-24T10:00:00Z'));
    const plan = plans.create({ ...base, name: 'Direction', selection: ['box-a'] });
    const old = plans.startRun(plan.id, 'box-a', '2026-11-24T01:00:00Z')!;
    plans.finishRun(old, 'failed', '2026-11-24T01:05:00Z', 'error');
    reports.save({ recipients: ['a@exemple.invalid'], frequency: 'daily', failureAlert: true });
    await reports.tick();
    expect(fake.sent).toHaveLength(0);
    const ko = plans.startRun(plan.id, 'box-a', '2026-11-24T10:01:00.000Z')!;
    plans.finishRun(ko, 'failed', '2026-11-24T10:05:00.000Z', 'error');
    await reports.tick();
    await reports.tick();
    expect(fake.sent.map((m) => m.subject)).toEqual(['backup365 : échec du plan « Direction »']);
    expect(store.lastSend()).toMatchObject({ kind: 'alert', ok: true });
  });

  it('records a failed scheduled send instead of failing silently', async () => {
    const fake = fakeMailer();
    const { reports, store, errors, clock } = setup(
      'admin',
      fake.mailer,
      new Date('2026-11-24T06:00:00Z'),
    );
    reports.save({ recipients: ['a@exemple.invalid'], frequency: 'daily', failureAlert: true });
    fake.mailer.fail = true;
    clock.now = new Date('2026-11-24T07:00:00Z');
    await reports.tick();
    expect(store.lastSend()).toEqual({ at: '2026-11-24T07:00:00.000Z', kind: 'report', ok: false });
    expect(errors).toEqual([{ code: 'permission', kind: 'report' }]);
    // Nouvel essai 15 min plus tard, pas avant ; un seul rapport une fois parti.
    fake.mailer.fail = false;
    clock.now = new Date('2026-11-24T07:10:00Z');
    await reports.tick();
    expect(fake.sent).toHaveLength(0);
    clock.now = new Date('2026-11-24T07:16:00Z');
    await reports.tick();
    await reports.tick();
    expect(fake.sent.map((m) => m.subject)).toEqual(['backup365 : rapport du jour']);
    expect(store.lastSend()).toMatchObject({ kind: 'report', ok: true });
  });

  it('alerts a failure that ends after a later-started one, and interruptions', async () => {
    const fake = fakeMailer();
    const { reports, plans, clock } = setup('admin', fake.mailer, new Date('2026-11-24T10:00:00Z'));
    const plan = plans.create({ ...base, name: 'Direction', selection: ['box-a', 'box-b'] });
    reports.save({ recipients: ['a@exemple.invalid'], frequency: 'daily', failureAlert: true });
    // Démarrée avant l'enregistrement, en cours : son échec viendra après.
    const early = plans.startRun(plan.id, 'box-a', '2026-11-24T09:50:00Z')!;
    const late = plans.startRun(plan.id, 'box-b', '2026-11-24T10:01:00Z')!;
    clock.now = new Date('2026-11-24T10:05:00Z');
    plans.finishRun(late, 'failed', '2026-11-24T10:05:00.000Z', 'error');
    await reports.tick();
    clock.now = new Date('2026-11-24T10:09:00Z');
    plans.finishRun(early, 'failed', '2026-11-24T10:09:00.000Z', 'interrupted');
    await reports.tick();
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[1]!.text).toContain('1 élément en échec de sauvegarde');
  });

  it('does not send a missed report as soon as a first recipient is added', async () => {
    const fake = fakeMailer();
    const { reports, clock } = setup('admin', fake.mailer, new Date('2026-11-24T06:00:00Z'));
    reports.save({ recipients: [], frequency: 'daily', failureAlert: true });
    clock.now = new Date('2026-11-24T08:00:00Z');
    await reports.tick();
    reports.save({ recipients: ['a@exemple.invalid'], frequency: 'daily', failureAlert: true });
    await reports.tick();
    expect(fake.sent).toHaveLength(0);
  });

  it('computes the last due time in UTC', () => {
    expect(lastDueAt(new Date('2026-11-24T06:59:00Z'), 'daily').toISOString()).toBe(
      '2026-11-23T07:00:00.000Z',
    );
    // Mardi 24 → lundi 23 ; lundi 30 avant 7 h → lundi 23.
    expect(lastDueAt(new Date('2026-11-24T10:00:00Z'), 'weekly').toISOString()).toBe(
      '2026-11-23T07:00:00.000Z',
    );
    expect(lastDueAt(new Date('2026-11-30T06:00:00Z'), 'weekly').toISOString()).toBe(
      '2026-11-23T07:00:00.000Z',
    );
  });
});
