import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasHandle } from './atlas-sdk.js';
import { createServer } from './server.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';

// Ces tests rejouent, sans conteneur, ce que le job CI `image` et docs/installation.md
// demandent à l'image : mêmes variables que le Containerfile et compose.yaml.

let dir: string;
let app: FastifyInstance | undefined;
const noFile = (): string => {
  throw new Error('aucun fichier attendu');
};

/** Environnement fixé par le Containerfile, dans un dossier temporaire. */
function imageEnv(): Record<string, string> {
  return {
    NODE_ENV: 'production',
    LOG_LEVEL: 'silent',
    BACKUP365_DATA_DIR: join(dir, 'data'),
    BACKUP365_WEB_DIR: join(dir, 'web'),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'b365-server-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'web'));
  writeFileSync(join(dir, 'web', 'index.html'), '<div id="root"></div>');
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe('createServer, image sans configuration (job CI image)', () => {
  it('starts without storage, answers health and serves the console', async () => {
    app = createServer(imageEnv(), '1.2.3', noFile);
    const health = await app.inject('/api/health');
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok', version: '1.2.3' });
    const page = await app.inject('/');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<div id="root">');
  });

  it('creates both databases in the data directory and opens the audit log', async () => {
    app = createServer(imageEnv(), 't', noFile);
    expect(existsSync(join(dir, 'data', 'audit.sqlite'))).toBe(true);
    expect(existsSync(join(dir, 'data', 'search.sqlite'))).toBe(true);
    expect((await app.inject('/api/audit')).statusCode).toBe(200);
  });

  it('answers 503 on catalog routes while storage is not configured', async () => {
    app = createServer(imageEnv(), 't', noFile);
    expect((await app.inject('/api/mailboxes')).statusCode).toBe(503);
  });

  it('still starts when the data directory is unusable', async () => {
    // Un fichier à la place du dossier : aucune base ne peut y être créée.
    const unusable = join(dir, 'web', 'index.html');
    app = createServer({ ...imageEnv(), BACKUP365_DATA_DIR: unusable }, 't', noFile);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    expect((await app.inject('/api/audit')).statusCode).toBe(503);
  });
});

describe('createServer, environnement de compose.yaml', () => {
  /** compose.yaml pose toujours les trois `_FILE` ; .env fournit tenant et endpoint. */
  function composeEnv(extra: Record<string, string>): Record<string, string> {
    return {
      ...imageEnv(),
      BACKUP365_TENANT_ID: '',
      BACKUP365_S3_ENDPOINT: '',
      BACKUP365_S3_REGION: '',
      BACKUP365_STATUS_MAX_AGE_HOURS: '',
      BACKUP365_STATUS_WORKLOADS: '',
      BACKUP365_S3_ACCESS_KEY_ID_FILE: '/run/secrets/s3_access_key_id',
      BACKUP365_S3_SECRET_ACCESS_KEY_FILE: '/run/secrets/s3_secret_access_key',
      BACKUP365_ENCRYPTION_PASSPHRASE_FILE: '/run/secrets/encryption_passphrase',
      ...extra,
    };
  }
  const secrets: Record<string, string> = {
    '/run/secrets/s3_access_key_id': 'identifiant-de-test\n',
    '/run/secrets/s3_secret_access_key': 'valeur-secrete-de-test\n',
    '/run/secrets/encryption_passphrase': 'phrase-de-test-assez-longue\n',
  };
  const readSecret = (path: string): string => {
    const value = secrets[path];
    if (value === undefined) throw new Error('ENOENT');
    return value;
  };

  it('refuses to start with an empty .env, naming the variables and no secret', () => {
    let message = '';
    try {
      app = createServer(composeEnv({}), 't', readSecret);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('BACKUP365_TENANT_ID');
    expect(message).toContain('BACKUP365_S3_ENDPOINT');
    expect(message).not.toContain('BACKUP365_S3_ACCESS_KEY_ID');
    for (const value of Object.values(secrets)) expect(message).not.toContain(value.trim());
  });

  it('refuses to start when a mounted secret is unreadable, without its path', () => {
    const env = composeEnv({ BACKUP365_TENANT_ID: 'tenant-de-test' });
    expect(() => createServer(env, 't', noFile)).toThrow(
      /^BACKUP365_S3_ACCESS_KEY_ID_FILE illisible$/,
    );
  });
});

describe("branchement de l'indexeur de recherche", () => {
  const storageEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...imageEnv(),
    BACKUP365_TENANT_ID: 'tenant-de-test',
    BACKUP365_S3_ENDPOINT: 'https://s3.example.test',
    BACKUP365_S3_ACCESS_KEY_ID: 'identifiant-de-test',
    BACKUP365_S3_SECRET_ACCESS_KEY: 'valeur-secrete-de-test',
    BACKUP365_ENCRYPTION_PASSPHRASE: 'phrase-de-test-assez-longue',
    ...extra,
  });

  /** Faux SDK dont les manifestes restent bloqués jusqu'à `release()`. */
  function blockedAtlas() {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const getSnapshotDetail = vi.fn(async () => {
      await gate;
      return {
        snapshotId: 's1',
        totalObjects: 1,
        createdAt: new Date('2026-03-01T00:00:00Z'),
        entries: [{ objectId: 'obj-1', sizeBytes: 1, subject: 'Budget annuel' }],
      };
    });
    const handle: AtlasHandle = {
      outlook: {
        listMailboxes: () => Promise.resolve([{ ownerId: 'o1', ownerEmail: 'a@example.test' }]),
        listSnapshots: () =>
          Promise.resolve([{ snapshotId: 's1', createdAt: new Date('2026-03-01T00:00:00Z') }]),
        getSnapshotDetail,
        readMessage: () => Promise.resolve(undefined),
      },
      onedrive: { listSnapshots: () => Promise.resolve([]) },
      sharepoint: { listSnapshots: () => Promise.resolve([]) },
      getStorageUsage: () => Promise.resolve({ complete: true }),
      dispose: () => Promise.resolve(),
    };
    return { handle, release, getSnapshotDetail };
  }

  it('answers /api/health before the first cycle ends, then fills the index', async () => {
    const { handle, release, getSnapshotDetail } = blockedAtlas();
    app = createServer(storageEnv(), 't', noFile, () => handle);
    await app.ready();
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    await vi.waitFor(() => expect(getSnapshotDetail).toHaveBeenCalled());
    release();
    await vi.waitFor(async () => {
      const status = (await app!.inject('/api/status')).json<{ index: { mails: number } }>();
      expect(status.index.mails).toBe(1);
    });
  });

  it('does not start an indexer without storage', async () => {
    app = createServer(imageEnv(), 't', noFile);
    await app.ready();
    expect((await app.inject('/api/status')).statusCode).toBe(503);
  });

  it('refuses to start on an invalid index interval', () => {
    expect(() =>
      createServer(storageEnv({ BACKUP365_INDEX_INTERVAL_MINUTES: '0' }), 't', noFile, () => {
        throw new Error('le SDK ne doit pas être construit');
      }),
    ).toThrow(/BACKUP365_INDEX_INTERVAL_MINUTES/);
  });

  it('stops the indexer and releases the SDK on close', async () => {
    const { handle, release } = blockedAtlas();
    const dispose = vi.spyOn(handle, 'dispose');
    app = createServer(storageEnv(), 't', noFile, () => handle);
    await app.ready();
    release();
    await app.close();
    app = undefined;
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe("sauvegarde à chaud du journal d'audit (docs/installation.md)", () => {
  it('copies a consistent, verifiable log with VACUUM INTO while the server runs', async () => {
    app = createServer(imageEnv(), 't', noFile);
    const source = join(dir, 'data', 'audit.sqlite');
    const copy = join(dir, 'data', 'audit.backup.sqlite');
    const writer = SqliteAuditLog.open(source);
    await writer.record({
      at: '2026-01-01T00:00:00.000Z',
      actor: 'anonymous',
      action: 'list.view',
      resource: 'mailboxes',
    });
    writer.close();
    // Même instruction que la procédure documentée, depuis une seconde connexion.
    const db = new DatabaseSync(source);
    db.exec(`VACUUM INTO '${copy}'`);
    db.close();
    const restored = SqliteAuditLog.open(copy);
    expect(await restored.verify()).toMatchObject({ ok: true, entries: 1 });
    restored.close();
    expect((await app.inject('/api/audit')).statusCode).toBe(200);
  });
});

describe("ancrage du journal d'audit dans createServer", () => {
  const capture = (): { lines: string[]; stream: { write(msg: string): void } } => {
    const lines: string[] = [];
    return { lines, stream: { write: (msg) => void lines.push(msg) } };
  };
  const anchorEnv = (): Record<string, string> => ({
    ...imageEnv(),
    LOG_LEVEL: 'warn',
    BACKUP365_TENANT_ID: 'tenant-de-test',
    BACKUP365_S3_ENDPOINT: 'https://s3.example.test',
    BACKUP365_S3_ACCESS_KEY_ID: 'identifiant-de-test',
    BACKUP365_S3_SECRET_ACCESS_KEY: 'valeur-secrete-de-test',
    BACKUP365_ENCRYPTION_PASSPHRASE: 'phrase-de-test-assez-longue',
    BACKUP365_AUDIT_ANCHOR_DIR: join(dir, 'anchors'),
  });
  const emptyAtlas = (): AtlasHandle => ({
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
  const anchorFile = (): string => join(dir, 'anchors', 'audit-anchors.jsonl');

  it("journalise un avertissement au démarrage sans dossier d'ancres", () => {
    const { lines, stream } = capture();
    app = createServer({ ...imageEnv(), LOG_LEVEL: 'warn' }, 't', noFile, undefined, stream);
    expect(lines.join('')).toContain('ancrage du journal : non configuré');
  });

  it("refuse un intervalle d'ancrage invalide", () => {
    expect(() =>
      createServer({ ...anchorEnv(), BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN: '0' }, 't', noFile),
    ).toThrow('BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN');
  });

  it("écrit une ancre valide à l'arrêt propre", async () => {
    const { lines, stream } = capture();
    app = createServer(anchorEnv(), 't', noFile, emptyAtlas, stream);
    await app.ready();
    const writer = SqliteAuditLog.open(join(dir, 'data', 'audit.sqlite'));
    await writer.record({
      at: '2026-01-01T00:00:00.000Z',
      actor: 'anonymous',
      action: 'list.view',
      resource: 'mailboxes',
    });
    writer.close();
    await app.close();
    const log = SqliteAuditLog.open(join(dir, 'data', 'audit.sqlite'));
    const head = log.head()!;
    log.close();
    const last = JSON.parse(readFileSync(anchorFile(), 'utf8').trim().split('\n').at(-1)!) as {
      seq: number;
      headHash: string;
    };
    expect(last).toMatchObject({ seq: head.seq, headHash: head.hash });
    expect(lines.join('')).not.toContain('ancrage du journal : non configuré');
  });

  it("n'ancre rien et le signale quand le journal d'audit est indisponible", async () => {
    mkdirSync(join(dir, 'data', 'audit.sqlite'));
    const { lines, stream } = capture();
    app = createServer(anchorEnv(), 't', noFile, emptyAtlas, stream);
    await app.ready();
    await app.close();
    expect(lines.join('')).toContain("journal d'audit indisponible");
    expect(existsSync(anchorFile())).toBe(false);
  });
});
