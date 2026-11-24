import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasBackupApi } from './atlas-executeur.js';
import type { AtlasHandle } from './atlas-sdk.js';
import { parseM365Config, withSecretFiles } from './config.js';
import { createServer } from './server.js';
import { TEST_PASSWORD, withHeaders } from './test-support.js';

// L'exécuteur réel branché sur le planificateur, avec un faux SDK : aucun appel réseau.

const CLIENT_ID = 'client-id-de-test-m365';
const CLIENT_SECRET = 'secret-client-de-test-m365';

let dir: string;
let app: FastifyInstance | undefined;
let logs: string[];
const noFile = (): string => {
  throw new Error('aucun fichier attendu');
};

const env = (extra: Record<string, string> = {}): Record<string, string> => ({
  NODE_ENV: 'production',
  LOG_LEVEL: 'debug',
  BACKUP365_DATA_DIR: join(dir, 'data'),
  BACKUP365_TENANT_ID: 'tenant-de-test',
  BACKUP365_S3_ENDPOINT: 'https://s3.example.test',
  BACKUP365_S3_ACCESS_KEY_ID: 'identifiant-de-test',
  BACKUP365_S3_SECRET_ACCESS_KEY: 'valeur-secrete-de-test',
  BACKUP365_ENCRYPTION_PASSPHRASE: 'phrase-de-test-assez-longue',
  ...extra,
});
const m365 = { BACKUP365_M365_CLIENT_ID: CLIENT_ID, BACKUP365_M365_CLIENT_SECRET: CLIENT_SECRET };

const readHandle = (): AtlasHandle => ({
  outlook: {
    listMailboxes: () => Promise.resolve([]),
    listSnapshots: () => Promise.resolve([]),
    getSnapshotDetail: () => Promise.resolve(undefined),
    readMessage: () => Promise.resolve(undefined),
  },
  onedrive: { listSnapshots: () => Promise.resolve([]) },
  sharepoint: { listSnapshots: () => Promise.resolve([]) },
  getStorageUsage: () => Promise.resolve({ complete: true }),
  dispose: () => Promise.resolve(),
});

function backupApi(fail = false) {
  const backup = vi.fn(() =>
    fail
      ? Promise.reject(
          Object.assign(new Error(`jeton ${CLIENT_SECRET} refusé`), { code: 'ATLAS_AUTH_DENIED' }),
        )
      : Promise.resolve({ interrupted: false, summary: { folderErrors: [], healthy: true } }),
  );
  const dispose = vi.fn(() => Promise.resolve());
  const api = {
    outlook: { backup },
    onedrive: { backup },
    sharepoint: { backup: () => Promise.resolve([]) },
    dispose,
  } as unknown as AtlasBackupApi;
  return { api, backup, dispose };
}

async function start(
  environment: Record<string, string>,
  factory?: () => AtlasBackupApi,
): Promise<FastifyInstance> {
  const stream = { write: (msg: string) => void logs.push(msg) };
  const target = createServer(environment, 't', noFile, readHandle, stream, factory);
  await target.ready();
  const res = await target.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { username: 'tester', password: TEST_PASSWORD },
  });
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  withHeaders(target, { cookie, 'x-csrf-token': res.json<{ csrfToken: string }>().csrfToken });
  return target;
}

const createPlan = async (target: FastifyInstance): Promise<string> => {
  const res = await target.inject({
    method: 'POST',
    url: '/api/plans',
    payload: {
      name: 'Mails',
      scope: 'selection',
      selection: ['owner-1'],
      rpoHours: 4,
      rtoHours: null,
      retentionDays: 30,
      gdprJustification: 'Obligation de conservation.',
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
};

type Run = { status: string; durationMs: number | null; error: string | null };
const listRuns = async (target: FastifyInstance, id: string): Promise<Run[]> =>
  (await target.inject(`/api/plans/${id}/runs`)).json<{ items: Run[] }>().items;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'b365-exec-'));
  mkdirSync(join(dir, 'data'));
  logs = [];
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('plans et exécution réelle', () => {
  it('runs a plan through the SDK and records status and duration', async () => {
    const { api, backup } = backupApi();
    app = await start(env(m365), () => api);
    expect((await app.inject('/api/plans/execution')).json()).toEqual({
      configured: true,
      retention: 'not_enforced',
    });
    const id = await createPlan(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/plans/${id}/run`,
      payload: { reason: 'test' },
    });
    expect(res.statusCode).toBe(202);
    await vi.waitFor(async () => {
      expect((await listRuns(app!, id))[0]?.status).toBe('success');
    });
    const [run] = await listRuns(app, id);
    expect(run?.durationMs).toEqual(expect.any(Number));
    expect(backup).toHaveBeenCalledTimes(2); // mail puis OneDrive
  });

  it('records a 120-character run reason as typed in the audit log', async () => {
    const { api } = backupApi();
    app = await start(env(m365), () => api);
    const id = await createPlan(app);
    const reason = 'Ticket INC-1 : ' + 'x'.repeat(105);
    expect(reason).toHaveLength(120);
    const res = await app.inject({
      method: 'POST',
      url: `/api/plans/${id}/run`,
      payload: { reason },
    });
    expect(res.statusCode).toBe(202);
    const audit = await app.inject('/api/audit?action=plan.run');
    expect(audit.json<{ items: { reason: string }[] }>().items.map((e) => e.reason)).toEqual([
      reason,
    ]);
  });

  it('records a failure with its code only, and no credential leaks anywhere', async () => {
    const { api } = backupApi(true);
    app = await start(env(m365), () => api);
    const id = await createPlan(app);
    await app.inject({ method: 'POST', url: `/api/plans/${id}/run`, payload: { reason: 'test' } });
    await vi.waitFor(async () => {
      expect((await listRuns(app!, id))[0]?.status).toBe('failed');
    });
    const [run] = await listRuns(app, id);
    expect(run).toMatchObject({ error: 'ATLAS_AUTH_DENIED', durationMs: expect.any(Number) });

    const responses = [
      JSON.stringify(await listRuns(app, id)),
      (await app.inject('/api/plans')).body,
      (await app.inject('/api/plans/execution')).body,
      (await app.inject('/api/status')).body,
    ].join('\n');
    const dump = readFileSync(join(dir, 'data', 'plans.sqlite')).toString('latin1');
    for (const secret of [CLIENT_SECRET, CLIENT_ID]) {
      expect(responses).not.toContain(secret);
      expect(logs.join('\n')).not.toContain(secret);
      expect(dump).not.toContain(secret);
    }
    // Aucune base de l'application ne contient le secret.
    for (const file of ['audit', 'accounts', 'search']) {
      const raw = readFileSync(join(dir, 'data', `${file}.sqlite`)).toString('latin1');
      expect(raw).not.toContain(CLIENT_SECRET);
    }
  });

  it('without credentials: plans exist, "sauvegarde non configurée", nothing runs', async () => {
    const factory = vi.fn();
    app = await start(env(), factory);
    expect((await app.inject('/api/plans/execution')).json()).toEqual({
      configured: false,
      label: 'sauvegarde non configurée',
      retention: 'not_enforced',
    });
    const id = await createPlan(app);
    expect((await app.inject('/api/plans')).json<{ items: unknown[] }>().items).toHaveLength(1);
    const res = await app.inject({
      method: 'POST',
      url: `/api/plans/${id}/run`,
      payload: { reason: 'test' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'backup_not_configured' });
    expect(await listRuns(app, id)).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('without storage, credentials alone do not build the SDK: not configured', async () => {
    const factory = vi.fn();
    const bare = {
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      BACKUP365_DATA_DIR: join(dir, 'data'),
    };
    app = await start({ ...bare, ...m365 }, factory);
    expect((await app.inject('/api/plans/execution')).json()).toMatchObject({ configured: false });
    expect(factory).not.toHaveBeenCalled();
  });

  it('demo mode keeps the simulated executor and never builds the SDK', async () => {
    const factory = vi.fn();
    const demoEnv = {
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      BACKUP365_DATA_DIR: join(dir, 'data'),
      BACKUP365_DEMO: '1',
    };
    app = createServer(demoEnv, 't', noFile, undefined, undefined, factory);
    await app.ready();
    expect(factory).not.toHaveBeenCalled();
  });

  it('refuses a partial set of Microsoft 365 variables without echoing values', () => {
    expect(() => createServer(env({ BACKUP365_M365_CLIENT_ID: CLIENT_ID }), 't', noFile)).toThrow(
      /BACKUP365_M365_CLIENT_SECRET/,
    );
    expect(() =>
      createServer(env({ BACKUP365_M365_CLIENT_ID: CLIENT_ID }), 't', noFile),
    ).not.toThrow(new RegExp(CLIENT_ID));
  });

  it('does not leak the secret when the SDK rejects the configuration', () => {
    const failing = (): AtlasBackupApi => {
      throw Object.assign(new Error(`invalide ${CLIENT_SECRET}`), { code: 'ATLAS_CONFIG_INVALID' });
    };
    let message = '';
    try {
      createServer(env(m365), 't', noFile, readHandle, undefined, failing);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('ATLAS_CONFIG_INVALID');
    expect(message).not.toContain(CLIENT_SECRET);
  });

  it('releases the backup SDK instance on close', async () => {
    const { api, dispose } = backupApi();
    app = await start(env(m365), () => api);
    await app.close();
    app = undefined;
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe('parseM365Config', () => {
  it('is undefined without variables, complete with both, throws with one', () => {
    expect(parseM365Config({})).toBeUndefined();
    expect(parseM365Config(m365)).toEqual({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
    expect(() => parseM365Config({ BACKUP365_M365_CLIENT_SECRET: CLIENT_SECRET })).toThrow(
      /BACKUP365_M365_CLIENT_ID/,
    );
  });

  it('reads the secret from a mounted file', () => {
    const merged = withSecretFiles(
      { BACKUP365_M365_CLIENT_ID: CLIENT_ID, BACKUP365_M365_CLIENT_SECRET_FILE: '/run/secret' },
      () => `${CLIENT_SECRET}\n`,
    );
    expect(parseM365Config(merged)?.clientSecret).toBe(CLIENT_SECRET);
  });
});
