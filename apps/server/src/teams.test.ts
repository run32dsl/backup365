import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FakeBackupCatalog, type AuditEvent, type AuditLog } from '@backup365/core';
import {
  AtlasSdkTeamsArchive,
  TeamExportTooLargeError,
  type AtlasTeamsReader,
} from './atlas-teams.js';
import { demoTeamsApi, singleFileZip } from './demo-teams.js';
import { buildTestApp } from './test-support.js';

function auditLog() {
  const events: AuditEvent[] = [];
  const audit: AuditLog = {
    record: (e) => {
      events.push(e);
      return Promise.resolve();
    },
    list: () => Promise.resolve({ total: 0, items: [] }),
    verify: () => Promise.resolve({ ok: true, entries: 0 }),
  };
  return { events, audit };
}

/** Faux du SDK : une équipe, deux instantanés, un zip de quelques octets. */
const reader: AtlasTeamsReader = {
  teams: {
    listSnapshots: (teamId) =>
      teamId === 'broken'
        ? Promise.reject(new Error('https://bucket/secret'))
        : Promise.resolve({
            indexes:
              teamId === 'team-1'
                ? [
                    {
                      snapshotId: 'tm-old',
                      createdAt: new Date('2026-11-11T03:00:00Z'),
                      channels: [{ channelId: 'c1', messageCount: 3 }],
                    },
                    {
                      snapshotId: 'tm-new',
                      createdAt: new Date('2026-11-12T03:00:00Z'),
                      channels: [{ channelId: 'c1', displayName: 'Général', messageCount: 5 }],
                    },
                  ]
                : [],
          }),
    save: (_teamId, options) => {
      options.output?.end(Buffer.from('PK-zip'));
      return Promise.resolve({ messagesSaved: 5, hostedMissing: ['m1'], interrupted: false });
    },
  },
};

describe('AtlasSdkTeamsArchive', () => {
  it('lists snapshots newest first with their channels, named or by id', async () => {
    const archive = new AtlasSdkTeamsArchive(reader);
    expect(await archive.listSnapshots('team-1')).toEqual([
      {
        id: 'tm-new',
        createdAt: '2026-11-12T03:00:00.000Z',
        channels: [{ id: 'c1', name: 'Général', messageCount: 5 }],
      },
      {
        id: 'tm-old',
        createdAt: '2026-11-11T03:00:00.000Z',
        channels: [{ id: 'c1', name: 'c1', messageCount: 3 }],
      },
    ]);
  });

  it('builds the whole archive before handing it back, and refuses one too large', async () => {
    const archive = new AtlasSdkTeamsArchive(reader);
    const done = await archive.exportChannel('team-1', 'tm-new', 'c1');
    expect(done.bytes.toString()).toBe('PK-zip');
    expect([done.messages, done.missing]).toEqual([5, 1]);
    await expect(
      new AtlasSdkTeamsArchive(reader, 3).exportChannel('team-1', 'tm-new', 'c1'),
    ).rejects.toBeInstanceOf(TeamExportTooLargeError);
  });

  it('hides SDK messages behind an unavailable catalog', async () => {
    await expect(new AtlasSdkTeamsArchive(reader).listSnapshots('broken')).rejects.toMatchObject({
      name: 'CatalogUnavailableError',
      message: 'Sauvegardes Teams indisponibles',
    });
  });
});

describe('demo Teams', () => {
  it('writes a valid single-file zip through the SDK stream', async () => {
    const zip = singleFileZip('a.txt', 'abc');
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));
    const result = await demoTeamsApi(Date.now()).save('team-voirie', {
      snapshotId: 'snap-tm-team-voirie-1',
      channelId: 'chan-voirie-general',
      output,
    });
    expect(result.messagesSaved).toBe(182);
    expect(Buffer.concat(chunks).readUInt32LE(0)).toBe(0x04034b50);
  });
});

function setup(over: { audit?: null; archive?: null } = {}) {
  const { events, audit } = auditLog();
  const catalog = new FakeBackupCatalog({
    mailboxes: [],
    teams: [{ id: 'team-1', displayName: 'Équipe de test' }],
    snapshots: {},
  });
  const app = buildTestApp({
    version: 't',
    catalog,
    ...(over.audit === null ? {} : { audit }),
    ...(over.archive === null ? {} : { teams: new AtlasSdkTeamsArchive(reader) }),
  });
  return { app, events };
}

const exportOf = (app: ReturnType<typeof setup>['app'], payload: object, team = 'team-1') =>
  app.inject({ method: 'POST', url: `/api/teams/${team}/export`, payload });
const valid = {
  snapshotId: 'tm-new',
  channelId: 'c1',
  reason: 'Ticket INC-12345 : message supprimé',
};

describe('Teams routes', () => {
  it('lists teams, then audits the channel listing before answering', async () => {
    const { app, events } = setup();
    expect((await app.inject('/api/teams/teams')).json()).toEqual({
      teams: [{ id: 'team-1', displayName: 'Équipe de test' }],
    });
    expect(events).toHaveLength(0);
    const res = await app.inject('/api/teams/team-1/snapshots');
    expect(res.json().snapshots.map((s: { id: string }) => s.id)).toEqual(['tm-new', 'tm-old']);
    expect(events.map((e) => [e.action, e.resource, e.target, e.count])).toEqual([
      ['list.view', 'teams.channels', 'team-1', 2],
    ]);
  });

  it('exports a channel as a zip, with the reason written to the audit log first', async () => {
    const { app, events } = setup();
    const res = await exportOf(app, valid);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['x-backup365-messages']).toBe('5');
    expect(res.headers['x-backup365-omitted-attachments']).toBe('1');
    expect(res.body).toBe('PK-zip');
    expect(events.at(-1)).toMatchObject({
      action: 'item.export',
      resource: 'teams',
      target: 'team-1/c1',
      count: 5,
      reason: valid.reason,
    });
  });

  it('refuses an export without reason, of an unknown channel, or without audit log', async () => {
    const { app, events } = setup();
    expect((await exportOf(app, { ...valid, reason: ' ' })).json()).toEqual({
      error: 'reason_required',
    });
    const unknown = await exportOf(app, { ...valid, channelId: 'other' });
    expect([unknown.statusCode, unknown.json()]).toEqual([404, { error: 'item_not_found' }]);
    expect(events.map((e) => [e.action, e.reason])).toEqual([['access.denied', 'item_not_found']]);
    expect((await exportOf(setup({ audit: null }).app, valid)).statusCode).toBe(503);
    expect(
      (await setup({ audit: null }).app.inject('/api/teams/team-1/snapshots')).statusCode,
    ).toBe(503);
  });

  it('refuses an archive too large (413), audited, and sends nothing if the audit fails', async () => {
    const { events, audit } = auditLog();
    const catalog = new FakeBackupCatalog({ mailboxes: [], snapshots: {} });
    const big = buildTestApp({
      version: 't',
      catalog,
      audit,
      teams: new AtlasSdkTeamsArchive(reader, 3),
    });
    const res = await exportOf(big, valid);
    expect([res.statusCode, res.json()]).toEqual([413, { error: 'export_too_large' }]);
    expect(events.at(-1)).toMatchObject({ action: 'access.denied', reason: 'export_too_large' });

    const failing: AuditLog = { ...audit, record: () => Promise.reject(new Error('disk')) };
    const closed = buildTestApp({
      version: 't',
      catalog,
      audit: failing,
      teams: new AtlasSdkTeamsArchive(reader),
    });
    const refused = await exportOf(closed, valid);
    expect(refused.statusCode).toBeGreaterThanOrEqual(500);
    expect(refused.body).not.toContain('PK-zip');
  });

  it('builds two archives at most at once (429), and validates the team id', async () => {
    const waiting: (() => void)[] = [];
    const slow: AtlasTeamsReader = {
      teams: {
        listSnapshots: reader.teams.listSnapshots,
        save: async (teamId, options) => {
          await new Promise<void>((r) => {
            waiting.push(r);
          });
          return reader.teams.save(teamId, options);
        },
      },
    };
    const { audit } = auditLog();
    const app = buildTestApp({
      version: 't',
      catalog: new FakeBackupCatalog({ mailboxes: [], snapshots: {} }),
      audit,
      teams: new AtlasSdkTeamsArchive(slow),
    });
    const first = exportOf(app, valid);
    const second = exportOf(app, valid);
    await new Promise((r) => setTimeout(r, 20));
    const third = await exportOf(app, valid);
    expect([third.statusCode, third.json()]).toEqual([429, { error: 'export_busy' }]);
    expect(waiting).toHaveLength(2);
    for (const r of waiting) r();
    expect((await first).statusCode).toBe(200);
    expect((await second).statusCode).toBe(200);
    expect((await app.inject('/api/teams/a%5Cb/snapshots')).statusCode).toBe(400);
  });

  it('answers 503 without storage, and hides SDK messages', async () => {
    const off = setup({ archive: null });
    expect((await off.app.inject('/api/teams/team-1/snapshots')).json()).toEqual({
      error: 'catalog_unavailable',
    });
    const broken = await setup().app.inject('/api/teams/broken/snapshots');
    expect(broken.statusCode).toBe(503);
    expect(broken.body).not.toContain('secret');
  });
});
