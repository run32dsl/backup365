import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AuditEvent } from '@backup365/core';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ANCHOR_FILE,
  AuditAnchorer,
  appendAnchor,
  deriveAnchorKey,
  parseAnchorIntervalMs,
  resolveAnchorConfig,
} from './audit-anchor.js';
import { main, runAuditVerify } from './audit-verify.js';
import { SqliteAuditLog } from './sqlite/sqlite-audit-log.js';

const root = mkdtempSync(join(tmpdir(), 'backup365-anchor-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

let counter = 0;
const key = deriveAnchorKey('phrase-de-test-assez-longue');
const event = (n: number): AuditEvent => ({
  at: '2026-01-01T00:00:00.000Z',
  actor: 'anonymous',
  action: 'list.view',
  resource: `res-${n}`,
});

/** Un journal de `n` entrées dans un dossier neuf, avec son dossier d'ancres distinct. */
async function setup(n: number, tag = '') {
  const base = join(root, `case-${++counter}`);
  const dataDir = join(base, 'data');
  const anchorDir = join(base, 'anchors');
  const path = join(dataDir, 'audit.sqlite');
  const log = SqliteAuditLog.open(path);
  for (let i = 1; i <= n; i += 1) await log.record({ ...event(i), resource: `res-${i}${tag}` });
  return { log, path, dataDir, anchorDir };
}

const run = async (log: SqliteAuditLog, anchorDir: string) => {
  const lines: string[] = [];
  const code = await runAuditVerify(log, (l) => lines.push(l), { dir: anchorDir, key });
  return { code, text: lines.join('\n') };
};

describe("ancrage du journal d'audit", () => {
  it('nominal : ancres cohérentes, exit 0, ancre sans contenu', async () => {
    const { log, anchorDir } = await setup(3);
    const anchorer = new AuditAnchorer(log, anchorDir, key, 60_000, () => undefined);
    anchorer.anchorNow();
    await log.record(event(4));
    anchorer.anchorNow();
    const { code, text } = await run(log, anchorDir);
    expect(code).toBe(0);
    expect(text).toContain('2 ancre(s) cohérente(s)');
    const file = join(anchorDir, ANCHOR_FILE);
    const first = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]!) as Record<string, unknown>;
    expect(Object.keys(first).sort()).toEqual(['at', 'headHash', 'mac', 'seq']);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    log.close();
  });

  it("n'écrit une ancre que si la tête a changé, et à l'arrêt", async () => {
    const { log, anchorDir } = await setup(1);
    const anchorer = new AuditAnchorer(log, anchorDir, key, 60_000, () => undefined);
    anchorer.anchorNow();
    anchorer.anchorNow();
    const count = () =>
      readFileSync(join(anchorDir, ANCHOR_FILE), 'utf8').trim().split('\n').length;
    expect(count()).toBe(1);
    await log.record(event(2));
    anchorer.stop();
    expect(count()).toBe(2);
    log.close();
  });

  it('détecte la troncature de fin', async () => {
    const { log, path, anchorDir } = await setup(5);
    new AuditAnchorer(log, anchorDir, key, 60_000, () => undefined).anchorNow();
    log.close();
    const db = new DatabaseSync(path);
    db.exec('DROP TRIGGER audit_log_no_delete');
    db.exec('DELETE FROM audit_log WHERE seq > 3');
    db.close();
    const reopened = SqliteAuditLog.open(path);
    expect((await reopened.verify()).ok).toBe(true); // la chaîne seule ne voit rien
    const { code, text } = await run(reopened, anchorDir);
    expect(code).toBe(1);
    expect(text).toContain('journal tronqué');
    reopened.close();
  });

  it('détecte la réécriture complète de la base', async () => {
    const { log, path, anchorDir } = await setup(4);
    new AuditAnchorer(log, anchorDir, key, 60_000, () => undefined).anchorNow();
    log.close();
    // Un attaquant remplace la base par une chaîne cohérente de même longueur.
    rmSync(path);
    const forged = SqliteAuditLog.open(path);
    for (let i = 1; i <= 4; i += 1) await forged.record({ ...event(i), resource: 'forge' });
    expect((await forged.verify()).ok).toBe(true);
    const { code, text } = await run(forged, anchorDir);
    expect(code).toBe(1);
    expect(text).toContain('journal réécrit');
    forged.close();
  });

  it('détecte une ancre falsifiée (signature)', async () => {
    const { log, anchorDir } = await setup(3);
    new AuditAnchorer(log, anchorDir, key, 60_000, () => undefined).anchorNow();
    const file = join(anchorDir, ANCHOR_FILE);
    writeFileSync(file, readFileSync(file, 'utf8').replace('"seq":3', '"seq":2'));
    const { code, text } = await run(log, anchorDir);
    expect(code).toBe(1);
    expect(text).toContain('signature invalide');
    log.close();
  });

  it('signe avec une clé liée à la phrase : une autre phrase est refusée', async () => {
    const { log, anchorDir } = await setup(2);
    appendAnchor(anchorDir, deriveAnchorKey('autre-phrase-de-test'), {
      seq: 2,
      headHash: log.head()!.hash,
      at: '2026-01-01T00:00:00.000Z',
    });
    expect((await run(log, anchorDir)).code).toBe(1);
    log.close();
  });

  it("refuse un fichier d'ancres absent ou une ligne illisible", async () => {
    const { log, anchorDir } = await setup(1);
    expect((await run(log, anchorDir)).text).toContain('illisible');
    appendAnchor(anchorDir, key, { seq: 1, headHash: log.head()!.hash, at: 'x' });
    appendFileSync(join(anchorDir, ANCHOR_FILE), 'pas du json\n');
    expect((await run(log, anchorDir)).code).toBe(1);
    log.close();
  });

  it("refuse un fichier d'ancres vidé", async () => {
    const { log, anchorDir } = await setup(2);
    new AuditAnchorer(log, anchorDir, key, 60_000, () => undefined).anchorNow();
    writeFileSync(join(anchorDir, ANCHOR_FILE), '');
    const { code, text } = await run(log, anchorDir);
    expect(code).toBe(1);
    expect(text).toContain('vide');
    log.close();
  });

  it('main : sortie non nulle sur troncature, 0 sur le cas nominal', async () => {
    const { log, path, dataDir, anchorDir } = await setup(3);
    new AuditAnchorer(log, anchorDir, key, 60_000, () => undefined).anchorNow();
    log.close();
    const env = {
      BACKUP365_DATA_DIR: dataDir,
      BACKUP365_AUDIT_ANCHOR_DIR: anchorDir,
      BACKUP365_ENCRYPTION_PASSPHRASE: 'phrase-de-test-assez-longue',
    };
    expect(await main(env)).toBe(0);
    const db = new DatabaseSync(path);
    db.exec('DROP TRIGGER audit_log_no_delete');
    db.exec('DELETE FROM audit_log WHERE seq = 3');
    db.close();
    expect(await main(env)).toBe(1);
  });
});

describe('configuration', () => {
  it('signale un répertoire absent, identique au dossier de données ou contenu dedans', () => {
    const p = 'phrase-de-test-assez-longue';
    expect(resolveAnchorConfig(undefined, '/data', p).configured).toBe(false);
    expect(resolveAnchorConfig('/data', '/data', p).configured).toBe(false);
    expect(resolveAnchorConfig('/data/anchors', '/data', p).configured).toBe(false);
    expect(resolveAnchorConfig('./data/../data/a', './data', p).configured).toBe(false);
    expect(resolveAnchorConfig('/data-anchors', '/data', p).configured).toBe(true);
    expect(resolveAnchorConfig('/anchors', '/data', p).configured).toBe(true);
    expect(resolveAnchorConfig('/anchors', '/data', undefined).configured).toBe(false);
  });

  it("lit l'intervalle (60 par défaut) et refuse une valeur invalide", () => {
    expect(parseAnchorIntervalMs(undefined)).toBe(3_600_000);
    expect(parseAnchorIntervalMs('5')).toBe(300_000);
    expect(() => parseAnchorIntervalMs('0')).toThrow('BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN');
  });
});
