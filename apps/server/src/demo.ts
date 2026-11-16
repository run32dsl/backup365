import type { AuditEvent } from '@backup365/core';
import type { AtlasFactory, AtlasHandle } from './atlas-sdk.js';
import type { StorageConfig } from './config.js';
import { parseStorageConfig } from './config.js';
import type { AuthService } from './auth.js';
import type { Role } from './sqlite/sqlite-account-store.js';
import type { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';

/**
 * Mode démo (`BACKUP365_DEMO=1`) : un faux SDK Atlas en mémoire et un jeu de données entièrement
 * fictives, pour voir la console (captures, tests de navigateur) sans S3 ni Microsoft 365. Tout
 * ce qui est inventé ici l'est dans le domaine réservé `exemple.fr` ; rien ne vient d'un tenant.
 */
export const DEMO_DOMAIN = 'exemple.fr';

export const DEMO_ACCOUNTS: readonly { username: string; role: Role; password: string }[] = [
  { username: 'admin-demo', role: 'admin', password: 'demonstration-admin' },
  { username: 'operateur-demo', role: 'operator', password: 'demonstration-operateur' },
];

/** Valeurs de façade : le faux SDK ne les lit pas, elles n'ouvrent aucun stockage. */
export const DEMO_STORAGE: StorageConfig = {
  tenantId: 'demo',
  endpoint: 'http://demo.invalid',
  region: 'demo',
  accessKeyId: 'demo',
  secretAccessKey: 'demo',
  encryptionPassphrase: 'demonstration-fictive',
};

/** `BACKUP365_DEMO=1` demandé ? Toute autre valeur (y compris absente) laisse le mode réel. */
export function isDemo(env: Record<string, string | undefined>): boolean {
  return env['BACKUP365_DEMO'] === '1';
}

/** Refuse le mode démo si une configuration de stockage réelle est présente (même partielle). */
export function assertNoRealStorage(env: Record<string, string | undefined>): void {
  let present: boolean;
  try {
    present = parseStorageConfig(env) !== undefined;
  } catch {
    present = true; // configuration partielle : des variables de stockage existent
  }
  const files = [
    'BACKUP365_S3_ACCESS_KEY_ID_FILE',
    'BACKUP365_S3_SECRET_ACCESS_KEY_FILE',
    'BACKUP365_ENCRYPTION_PASSPHRASE_FILE',
  ].some((name) => env[name]);
  if (present || files) {
    throw new Error(
      'BACKUP365_DEMO=1 refusé : une configuration de stockage réelle est présente (BACKUP365_S3_*, BACKUP365_TENANT_ID, BACKUP365_ENCRYPTION_PASSPHRASE)',
    );
  }
}

const HOUR = 3_600_000;

interface DemoMailbox {
  id: string;
  name: string;
}

export const DEMO_MAILBOXES: readonly DemoMailbox[] = [
  { id: `claire.durand@${DEMO_DOMAIN}`, name: 'Claire Durand' },
  { id: `marc.lefevre@${DEMO_DOMAIN}`, name: 'Marc Lefèvre' },
  { id: `sophie.bernard@${DEMO_DOMAIN}`, name: 'Sophie Bernard' },
  { id: `paul.moreau@${DEMO_DOMAIN}`, name: 'Paul Moreau' },
];

export const DEMO_SITES = [
  {
    id: 'site-equipe-commerciale',
    name: 'Équipe commerciale',
    url: `https://exemple.fr/sites/commercial`,
  },
  {
    id: 'site-ressources-humaines',
    name: 'Ressources humaines',
    url: `https://exemple.fr/sites/rh`,
  },
  { id: 'site-projet-atelier', name: 'Projet Atelier', url: `https://exemple.fr/sites/atelier` },
] as const;

const MAILS_PER_MAILBOX = 25;
const SUBJECTS = [
  'Réunion de lundi',
  'Devis atelier à valider',
  'Compte rendu du comité',
  'Planning des congrès',
  'Facture de novembre',
  'Question sur le contrat',
  'Livraison reportée',
  'Invitation : point d’équipe',
  'Relance du dossier Moreau',
  'Offre de formation',
];
const SENDERS = [
  { name: 'Hélène Petit', address: `helene.petit@${DEMO_DOMAIN}` },
  { name: 'Julien Roux', address: `julien.roux@${DEMO_DOMAIN}` },
  { name: 'Service achats', address: `achats@${DEMO_DOMAIN}` },
  { name: 'Nadia Girard', address: `nadia.girard@${DEMO_DOMAIN}` },
];
const FOLDERS = ['inbox', 'archive', 'sent'];

interface DemoMail {
  objectId: string;
  subject: string;
  from: { name: string; address: string };
  folderId: string;
  receivedAt: string;
  sizeBytes: number;
  attachments: { name: string }[];
  body: string;
}

/** Le jeu de mails d'une boîte : déterministe, daté par rapport à `now`. */
function mailsOf(mailboxIndex: number, now: number): DemoMail[] {
  return Array.from({ length: MAILS_PER_MAILBOX }, (_, i) => {
    const n = mailboxIndex * MAILS_PER_MAILBOX + i;
    const sender = SENDERS[n % SENDERS.length]!;
    const subject = `${SUBJECTS[n % SUBJECTS.length]!} (${n + 1})`;
    const body = `Bonjour,\r\n\r\nCeci est un message fictif de démonstration n° ${n + 1}.\r\n\r\nCordialement,\r\n${sender.name}\r\n`;
    return {
      objectId: `msg-${mailboxIndex + 1}-${String(i + 1).padStart(3, '0')}`,
      subject,
      from: sender,
      folderId: FOLDERS[n % FOLDERS.length]!,
      receivedAt: new Date(now - (n + 3) * 5 * HOUR).toISOString(),
      sizeBytes: 2_000 + n * 137,
      attachments: n % 7 === 0 ? [{ name: 'document-fictif.pdf' }] : [],
      body,
    };
  });
}

function eml(mail: DemoMail, to: string): Uint8Array {
  const lines = [
    `From: "${mail.from.name}" <${mail.from.address}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(mail.subject, 'utf8').toString('base64')}?=`,
    `Date: ${new Date(mail.receivedAt).toUTCString()}`,
    `Message-ID: <${mail.objectId}@${DEMO_DOMAIN}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(mail.body, 'utf8').toString('base64'),
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

/**
 * Faux SDK Atlas : trois instantanés mail par boîte (le plus ancien est incomplet), un instantané
 * OneDrive (périmé pour une boîte, ce qui allume une alerte sur le tableau de bord) et quelques
 * sites SharePoint. Aucun accès réseau ni disque.
 */
export function createDemoHandle(now: number = Date.now()): AtlasHandle {
  const mailboxIndex = (snapshotId: string) => {
    const index = Number(/^snap-mail-(\d+)-/.exec(snapshotId)?.[1]) - 1;
    return Number.isInteger(index) && DEMO_MAILBOXES[index] ? index : undefined;
  };
  const snapshotAges = [3, 27, 51]; // heures
  return {
    outlook: {
      listMailboxes: () =>
        Promise.resolve(DEMO_MAILBOXES.map((m) => ({ ownerId: m.id, ownerEmail: m.id }))),
      listSnapshots: (ownerId) => {
        const i = DEMO_MAILBOXES.findIndex((m) => m.id === ownerId);
        return Promise.resolve(
          i < 0
            ? []
            : snapshotAges.map((age, k) => ({
                snapshotId: `snap-mail-${i + 1}-${k + 1}`,
                createdAt: new Date(now - age * HOUR),
              })),
        );
      },
      getSnapshotDetail: (snapshotId) => {
        const i = mailboxIndex(snapshotId);
        const k = Number(/-(\d+)$/.exec(snapshotId)?.[1]);
        if (i === undefined || !(k >= 1 && k <= snapshotAges.length))
          return Promise.resolve(undefined);
        const all = mailsOf(i, now);
        // Le plus ancien instantané n'a que les deux tiers des mails.
        const entries = k === 3 ? all.slice(0, Math.floor(all.length * 0.66)) : all;
        return Promise.resolve({
          snapshotId,
          createdAt: new Date(now - snapshotAges[k - 1]! * HOUR),
          totalObjects: entries.length,
          entries: entries.map((m) => ({
            objectId: m.objectId,
            subject: m.subject,
            from: m.from,
            folderId: m.folderId,
            receivedAt: m.receivedAt,
            sizeBytes: m.sizeBytes,
            attachments: m.attachments,
          })),
        });
      },
      readMessage: (snapshotId, messageRef) => {
        const i = mailboxIndex(snapshotId);
        const mail =
          i === undefined ? undefined : mailsOf(i, now).find((m) => m.objectId === messageRef);
        if (i === undefined || !mail) return Promise.resolve(undefined);
        return Promise.resolve({
          raw: eml(mail, DEMO_MAILBOXES[i]!.id),
          attachments: mail.attachments.map((a) => ({
            name: a.name,
            contentType: 'application/pdf',
            sizeBytes: 12_000,
          })),
          payloadFormat: 'mime' as const,
        });
      },
    },
    onedrive: {
      listSnapshots: (ownerId) => {
        const i = DEMO_MAILBOXES.findIndex((m) => m.id === ownerId);
        if (i < 0) return Promise.resolve([]);
        // La dernière boîte n'a pas été sauvegardée depuis trois jours.
        const age = i === DEMO_MAILBOXES.length - 1 ? 75 : 4;
        return Promise.resolve([
          {
            snapshotId: `snap-od-${i + 1}-1`,
            createdAt: new Date(now - age * HOUR),
            totalFiles: 120 + i * 40,
          },
        ]);
      },
    },
    sharepoint: {
      listSnapshots: (siteId) => {
        const i = DEMO_SITES.findIndex((s) => s.id === siteId);
        const site = DEMO_SITES[i];
        if (!site) return Promise.resolve([]);
        return Promise.resolve(
          [5, 29].map((age, k) => ({
            siteUrl: site.url,
            siteDisplayName: site.name,
            snapshotId: `snap-sp-${i + 1}-${k + 1}`,
            createdAt: new Date(now - age * HOUR),
            totalFiles: 300 + i * 90 - k * 10,
          })),
        );
      },
    },
    getStorageUsage: () =>
      Promise.resolve({
        complete: true,
        byOwner: DEMO_SITES.map((s) => ({ workload: 'sharepoint', ownerId: s.id })),
      }),
    dispose: () => Promise.resolve(),
  };
}

/** Fabrique à passer à `createAtlasCatalog` : ignore la configuration, renvoie le faux SDK. */
export function demoFactory(now: number = Date.now()): AtlasFactory {
  return () => createDemoHandle(now);
}

/** Entrées de journal d'audit fictives, de la plus ancienne à la plus récente. */
export function demoAuditEvents(now: number): AuditEvent[] {
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();
  return [
    { at: at(30), actor: 'admin-demo', action: 'auth.login', resource: 'session' },
    {
      at: at(29),
      actor: 'admin-demo',
      action: 'account.create',
      resource: 'account',
      target: 'operateur-demo',
    },
    {
      at: at(28),
      actor: 'admin-demo',
      action: 'plan.create',
      resource: 'plan',
      target: 'plan-demo',
    },
    { at: at(26), actor: 'admin-demo', action: 'auth.logout', resource: 'session' },
    { at: at(22), actor: 'operateur-demo', action: 'auth.login', resource: 'session' },
    {
      at: at(21),
      actor: 'operateur-demo',
      action: 'list.view',
      resource: 'mailboxes',
      count: DEMO_MAILBOXES.length,
    },
    {
      at: at(21),
      actor: 'operateur-demo',
      action: 'item.open',
      resource: 'mail',
      target: 'msg-1-004',
    },
    {
      at: at(20),
      actor: 'operateur-demo',
      action: 'item.export',
      resource: 'mail',
      target: 'msg-1-004',
      reason: 'Ticket INC-10001',
    },
    { at: at(12), actor: 'anonymous', action: 'auth.login_failed', resource: 'session' },
    {
      at: at(11),
      actor: 'operateur-demo',
      action: 'access.denied',
      resource: 'accounts',
      reason: 'forbidden',
    },
    { at: at(2), actor: 'admin-demo', action: 'auth.login', resource: 'session' },
  ];
}

/**
 * Vrai si la base des comptes est vide ou ne contient que les comptes de démonstration : sinon le
 * dossier de données est réel, et y ajouter un administrateur au mot de passe public l'exposerait.
 */
export function onlyDemoAccounts(store: {
  count(): number;
  findByUsername(name: string): unknown;
}): boolean {
  const known = DEMO_ACCOUNTS.filter((a) => store.findByUsername(a.username)).length;
  return store.count() === known;
}

/**
 * Crée les comptes de démonstration et l'historique d'audit, une seule fois (base encore vide).
 * Les mots de passe sont publics : le mode démo ne doit jamais servir de vraies données.
 */
export async function seedDemo(
  auth: AuthService,
  audit: { record(event: AuditEvent): Promise<void>; head(): unknown } | undefined,
  now: number = Date.now(),
  plans?: SqlitePlanStore,
): Promise<void> {
  if (plans && plans.list().length === 0) seedDemoPlans(plans, now);
  for (const { username, role, password } of DEMO_ACCOUNTS) {
    if (!auth.accounts.findByUsername(username)) {
      auth.accounts.create({ username, role, passwordHash: await auth.hash(password) });
    }
  }
  if (audit && audit.head() === undefined) {
    for (const event of demoAuditEvents(now)) await audit.record(event);
  }
}

/**
 * Deux plans fictifs avec une exécution déjà inscrite dans le créneau courant (le planificateur
 * ne la relance donc pas) : l'un conforme, l'autre en échec, pour peupler le tableau de bord.
 */
function seedDemoPlans(plans: SqlitePlanStore, now: number): void {
  const base = { rtoHours: null, gdprJustification: 'Démonstration : données fictives.' } as const;
  const at = new Date(now).toISOString();
  const [first, second] = DEMO_MAILBOXES;
  const compliant = plans.create({
    ...base,
    name: 'Boîtes mail, quotidien',
    scope: 'selection',
    selection: [first!.id],
    rpoHours: 24,
    retentionDays: 90,
  });
  const failing = plans.create({
    ...base,
    name: 'Boîte direction, quotidien',
    scope: 'selection',
    selection: [second!.id],
    rpoHours: 24,
    retentionDays: 365,
  });
  const ok = plans.startRun(compliant.id, first!.id, at);
  if (ok !== undefined) plans.finishRun(ok, 'success', at);
  const ko = plans.startRun(failing.id, second!.id, at);
  if (ko !== undefined) plans.finishRun(ko, 'failed', at, 'demo_failure');
}
