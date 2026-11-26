import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_ACCOUNTS,
  DEMO_DOMAIN,
  DEMO_MAILBOXES,
  DEMO_SITES,
  createDemoHandle,
  demoAuditEvents,
} from './demo.js';
import { createServer } from './server.js';

let dir: string;
let app: FastifyInstance | undefined;
const noFile = (): string => {
  throw new Error('aucun fichier attendu');
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'b365-demo-'));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const demoEnv = () => ({
  BACKUP365_DEMO: '1',
  LOG_LEVEL: 'silent',
  BACKUP365_DATA_DIR: dir,
});

async function login(target: FastifyInstance, username: string, password: string) {
  const res = await target.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return {
    cookie: String(res.headers['set-cookie']).split(';')[0]!,
    'x-csrf-token': res.json<{ csrfToken: string }>().csrfToken,
  };
}

describe('mode démo', () => {
  it('démarre sans S3, annonce le mode démo et indexe 125 mails', async () => {
    app = createServer(demoEnv(), '0.0.0', noFile);
    await app.ready();
    const health = await app.inject('/api/health');
    expect(health.json()).toMatchObject({ status: 'ok', demo: true });

    const admin = DEMO_ACCOUNTS.find((a) => a.role === 'admin')!;
    const headers = await login(app, admin.username, admin.password);
    const operator = DEMO_ACCOUNTS.find((a) => a.role === 'operator')!;
    await login(app, operator.username, operator.password);

    let total = 0;
    for (let i = 0; i < 50 && total < 125; i++) {
      const res = await app.inject({ url: '/api/search?limit=1', headers });
      total = res.json<{ total: number }>().total;
      if (total < 125) await new Promise((r) => setTimeout(r, 50));
    }
    expect(total).toBe(125);

    const audit = await app.inject({ url: '/api/audit', headers });
    expect(audit.statusCode).toBe(200);

    const status = await app.inject({ url: '/api/status', headers });
    expect(status.json<{ plans: { counts: object } }>().plans.counts).toEqual({
      compliant: 1,
      late: 1,
      failed: 1,
    });

    // Un compte OneDrive est en retard depuis 3 jours (issue #485) : le plan qui le couvre est en
    // retard, daté de la plus récente sauvegarde listée, jamais de son heure d'exécution.
    const plansReport = status.json<{
      plans: {
        nonCompliant: { name: string; state: string; lastRun: { finishedAt: string } }[];
        pending: number;
      };
      services: { service: string; lastSnapshotAt: string | null }[];
    }>();
    const files = plansReport.plans.nonCompliant.find(
      (p) => p.name === 'OneDrive et SharePoint Services',
    );
    expect(files?.state).toBe('late');
    const onedrive = plansReport.services.find((s) => s.service === 'onedrive');
    expect(Date.parse(files?.lastRun.finishedAt ?? '')).toBe(
      Date.parse(onedrive?.lastSnapshotAt ?? ''),
    );
    expect(plansReport.plans.pending).toBe(0);

    // Le plan de toute l'organisation a une exécution sur toutes ses sources, qui encadre les
    // dernières sauvegardes OneDrive et SharePoint (issue #598).
    const planList = (await app.inject({ url: '/api/plans', headers })).json<{
      items: { id: string; name: string }[];
    }>();
    const filesId = planList.items.find((p) => p.name === 'OneDrive et SharePoint Services')?.id;
    const runs = (await app.inject({ url: `/api/runs?planId=${filesId ?? ''}`, headers })).json<{
      items: { itemId: string; startedAt: string; finishedAt: string }[];
    }>().items;
    expect(runs.map((r) => r.itemId).sort()).toEqual(
      [...DEMO_MAILBOXES.map((m) => m.id), ...DEMO_SITES.map((s) => s.id)].sort(),
    );
    expect(new Set(runs.map((r) => r.startedAt)).size).toBe(1);
    const sharepoint = plansReport.services.find((s) => s.service === 'sharepoint');
    expect(Date.parse(runs[0]!.startedAt)).toBe(Date.parse(sharepoint?.lastSnapshotAt ?? ''));
    expect(Math.max(...runs.map((r) => Date.parse(r.finishedAt)))).toBe(
      Date.parse(onedrive?.lastSnapshotAt ?? ''),
    );

    // Accueil et Sources partent du même instant de démonstration pour la messagerie (issue
    // #445). Le planificateur peut inscrire, pendant le test, une exécution plus récente à
    // l'horloge réelle : l'accueil n'est donc jamais antérieur à Sources, à quelques secondes près.
    const overview = await app.inject({ url: '/api/overview', headers });
    // Le nombre de plans « à jour » de l'accueil est celui de la page Plans de protection.
    expect(overview.json<{ plans: { operational: number } }>().plans.operational).toBe(1);
    const lastBackupAt = Date.parse(overview.json<{ lastBackupAt: string }>().lastBackupAt);
    const mail = status
      .json<{ services: { service: string; lastSnapshotAt: string | null }[] }>()
      .services.find((s) => s.service === 'mail');
    const snapshotAt = Date.parse(mail?.lastSnapshotAt ?? '');
    expect(lastBackupAt).toBeGreaterThanOrEqual(snapshotAt);
    expect(lastBackupAt - snapshotAt).toBeLessThan(10_000);
  });

  it('ne signale pas le mode démo hors démo', async () => {
    app = createServer({ LOG_LEVEL: 'silent', BACKUP365_DATA_DIR: dir }, '0.0.0', noFile);
    expect((await app.inject('/api/health')).json()).not.toHaveProperty('demo');
  });

  it('refuse un dossier de données qui contient un compte réel', async () => {
    const first = createServer({ LOG_LEVEL: 'silent', BACKUP365_DATA_DIR: dir }, '0.0.0', noFile);
    await first.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'vrai-admin', password: 'un mot de passe réel' },
    });
    await first.close();
    expect(() => createServer(demoEnv(), '0.0.0', noFile)).toThrow(/comptes réels/);
  });

  it.each([
    [
      'configuration complète',
      {
        BACKUP365_TENANT_ID: 't',
        BACKUP365_S3_ENDPOINT: 'https://s3.example.test',
        BACKUP365_S3_ACCESS_KEY_ID: 'a',
        BACKUP365_S3_SECRET_ACCESS_KEY: 'b',
        BACKUP365_ENCRYPTION_PASSPHRASE: 'phrase-de-chiffrement',
      },
    ],
    ['configuration partielle', { BACKUP365_S3_ENDPOINT: 'https://s3.example.test' }],
    ['secret monté en fichier', { BACKUP365_S3_SECRET_ACCESS_KEY_FILE: '/run/secrets/x' }],
  ])('refuse de démarrer avec une %s du stockage', (_name, storage) => {
    expect(() => createServer({ ...demoEnv(), ...storage }, '0.0.0', noFile)).toThrow(
      /BACKUP365_DEMO=1 refusé/,
    );
  });
});

describe('journal de démonstration', () => {
  it('vise des mails au format boîte/identifiant et un vrai plan, sans identifiant fictif', () => {
    const events = demoAuditEvents(Date.now(), 'plan-uuid');
    const mails = events.filter((e) => e.resource === 'mail');
    expect(mails.length).toBeGreaterThan(0);
    for (const e of mails) expect(e.target).toBe(`${DEMO_MAILBOXES[0]!.id}/msg-1-004`);
    expect(events.find((e) => e.action === 'plan.create')?.target).toBe('plan-uuid');
    expect(JSON.stringify(demoAuditEvents(Date.now()))).not.toContain('plan-demo');
  });

  it('contient deux lancements manuels du plan, avec leur motif, dans l’ordre du temps', () => {
    const events = demoAuditEvents(Date.now(), 'plan-uuid');
    const runs = events.filter((e) => e.action === 'plan.run');
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const e of runs) {
      expect(e).toMatchObject({ resource: 'plan', target: 'plan-uuid' });
      expect(e.reason?.trim()).toBeTruthy();
    }
    const times = events.map((e) => e.at);
    expect(times).toEqual([...times].sort());
    expect(demoAuditEvents(Date.now()).some((e) => e.action === 'plan.run')).toBe(false);
  });
});

describe('jeu de démonstration', () => {
  it('ne contient que le domaine exemple.fr', async () => {
    const now = Date.now();
    const handle = createDemoHandle(now);
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') strings.push(value);
      else if (value instanceof Uint8Array) strings.push(Buffer.from(value).toString('utf8'));
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object' && !(value instanceof Date)) {
        Object.values(value).forEach(collect);
      }
    };
    const mailboxes = await handle.outlook.listMailboxes();
    collect(mailboxes);
    for (const { ownerId } of mailboxes) {
      collect(await handle.onedrive.listSnapshots(ownerId));
      for (const snap of await handle.outlook.listSnapshots(ownerId)) {
        const detail = (await handle.outlook.getSnapshotDetail(snap.snapshotId)) as
          { entries: { objectId: string }[] } | undefined;
        collect(detail);
        for (const entry of detail?.entries ?? []) {
          collect(await handle.outlook.readMessage(snap.snapshotId, entry.objectId));
        }
      }
    }
    for (const site of DEMO_SITES) collect(await handle.sharepoint.listSnapshots(site.id));
    collect(DEMO_MAILBOXES);
    collect(DEMO_SITES);
    collect(demoAuditEvents(now, 'plan-id'));
    collect(DEMO_ACCOUNTS.map((a) => a.username));

    const hosts = strings.flatMap((s) => [
      ...[...s.matchAll(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)].map((m) => m[1]!),
      ...[...s.matchAll(/https?:\/\/([^/\s"'<>]+)/g)].map((m) => m[1]!),
    ]);
    expect(hosts.length).toBeGreaterThan(100);
    expect(hosts.every((h) => h === DEMO_DOMAIN || h.endsWith(`.${DEMO_DOMAIN}`))).toBe(true);
  });
});
