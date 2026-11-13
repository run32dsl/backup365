import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Nom du fichier d'ancres, en ajout seul, dans `BACKUP365_AUDIT_ANCHOR_DIR`. */
export const ANCHOR_FILE = 'audit-anchors.jsonl';

/** Une ancre : ni contenu de mail ni motif, seulement le rang, l'empreinte de tête et la date. */
export interface Anchor {
  seq: number;
  headHash: string;
  at: string;
}

/** Source de la tête du journal (implémentée par `SqliteAuditLog`). */
export interface AnchorHead {
  head(): { seq: number; hash: string } | undefined;
  hashAt(seq: number): string | undefined;
}

/** Clé de signature dérivée de la phrase de chiffrement (HKDF-SHA256), contexte dédié. */
export function deriveAnchorKey(passphrase: string): Buffer {
  return Buffer.from(hkdfSync('sha256', passphrase, '', 'backup365-audit-anchor', 32));
}

const sign = (key: Buffer, a: Anchor): string =>
  createHmac('sha256', key).update(`${a.seq}\n${a.headHash}\n${a.at}`).digest('hex');

/** Intervalle d'ancrage, en millisecondes (`BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN`, 60 par défaut). */
export function parseAnchorIntervalMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 3_600_000;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error('BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN invalide : attendu un entier de 1 à 1440');
  }
  return minutes * 60_000;
}

/** Vrai si `child` est `parent` ou se trouve dedans. */
function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export type AnchorConfig =
  { configured: true; dir: string; key: Buffer } | { configured: false; reason: string };

/**
 * Ancrage utilisable ou non, avec la raison (sans chemin ni secret). Un répertoire absent, égal à
 * `BACKUP365_DATA_DIR` ou contenu dedans n'ancre rien hors de la base ; sans phrase de
 * chiffrement, pas de clé de signature.
 */
export function resolveAnchorConfig(
  anchorDir: string | undefined,
  dataDir: string,
  passphrase: string | undefined,
): AnchorConfig {
  if (!anchorDir) {
    return { configured: false, reason: 'BACKUP365_AUDIT_ANCHOR_DIR absent' };
  }
  if (isInside(anchorDir, dataDir)) {
    return {
      configured: false,
      reason: 'BACKUP365_AUDIT_ANCHOR_DIR égal à BACKUP365_DATA_DIR ou contenu dedans',
    };
  }
  if (!passphrase) {
    return {
      configured: false,
      reason: 'BACKUP365_ENCRYPTION_PASSPHRASE absente (clé de signature)',
    };
  }
  return { configured: true, dir: anchorDir, key: deriveAnchorKey(passphrase) };
}

/** Ajoute une ancre signée au fichier (ouverture en ajout seul, droits 0600, dossier 0700). */
export function appendAnchor(dir: string, key: Buffer, anchor: Anchor): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const line = JSON.stringify({ ...anchor, mac: sign(key, anchor) });
  appendFileSync(join(dir, ANCHOR_FILE), `${line}\n`, { flag: 'a', mode: 0o600 });
}

export type ReadAnchors =
  { anchors: Anchor[]; error?: undefined } | { anchors?: undefined; error: string };

/** Lit les ancres ; la première ligne illisible ou à signature fausse invalide tout le fichier. */
export function readAnchors(dir: string, key: Buffer): ReadAnchors {
  let text: string;
  try {
    text = readFileSync(join(dir, ANCHOR_FILE), 'utf8');
  } catch (err) {
    return {
      error: `fichier d'ancres illisible (${(err as NodeJS.ErrnoException).code ?? 'erreur'})`,
    };
  }
  const anchors: Anchor[] = [];
  const lines = text.split('\n').filter((l) => l !== '');
  for (const [i, line] of lines.entries()) {
    const n = i + 1;
    let raw: Partial<Anchor & { mac: string }>;
    try {
      raw = JSON.parse(line) as typeof raw;
    } catch {
      return { error: `ancre ${n} illisible` };
    }
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !Number.isInteger(raw.seq) ||
      typeof raw.headHash !== 'string' ||
      typeof raw.at !== 'string' ||
      typeof raw.mac !== 'string'
    ) {
      return { error: `ancre ${n} mal formée` };
    }
    const anchor = { seq: raw.seq!, headHash: raw.headHash, at: raw.at };
    const expected = Buffer.from(sign(key, anchor), 'hex');
    const given = Buffer.from(raw.mac, 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { error: `ancre ${n} : signature invalide (falsifiée ou clé différente)` };
    }
    anchors.push(anchor);
  }
  return { anchors };
}

/**
 * Compare les ancres à la base : `seq` ancré ≤ dernier `seq` local (sinon troncature), et
 * empreinte locale à ce `seq` = `headHash` (sinon réécriture). Renvoie le message d'écart.
 */
export function checkAnchors(log: AnchorHead, anchors: readonly Anchor[]): string | undefined {
  const head = log.head();
  const last = head?.seq ?? 0;
  for (const [i, a] of anchors.entries()) {
    if (a.seq > last) {
      return `ancre ${i + 1} : rang ${a.seq} au-delà du dernier rang local ${last} (journal tronqué)`;
    }
    if (log.hashAt(a.seq) !== a.headHash) {
      return `ancre ${i + 1} : empreinte du rang ${a.seq} différente de l'ancre (journal réécrit)`;
    }
  }
  return undefined;
}

/** Écrit une ancre si la tête a changé depuis la dernière, périodiquement et à l'arrêt. */
export class AuditAnchorer {
  private timer: NodeJS.Timeout | undefined;
  private lastHash: string | undefined;

  constructor(
    private readonly log: AnchorHead,
    private readonly dir: string,
    private readonly key: Buffer,
    private readonly intervalMs: number,
    private readonly onError: (code: string | undefined) => void,
  ) {}

  /** Ancre la tête actuelle si elle diffère de la dernière ancre écrite. */
  anchorNow(now: Date = new Date()): void {
    try {
      const head = this.log.head();
      if (!head || head.hash === this.lastHash) return;
      appendAnchor(this.dir, this.key, {
        seq: head.seq,
        headHash: head.hash,
        at: now.toISOString(),
      });
      this.lastHash = head.hash;
    } catch (err) {
      this.onError((err as NodeJS.ErrnoException).code);
    }
  }

  start(): void {
    this.anchorNow();
    this.timer = setInterval(() => {
      this.anchorNow();
    }, this.intervalMs);
    this.timer.unref();
  }

  /** Arrêt propre : dernière ancre si la tête a changé. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.anchorNow();
  }
}
