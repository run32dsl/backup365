import type {
  AuditEvent,
  DataType,
  DriveRestorer,
  MailRestorer,
  SiteRestorer,
} from '@backup365/core';
import type { AtlasFactory, AtlasHandle } from './atlas-sdk.js';
import type { StorageConfig } from './config.js';
import { parseStorageConfig } from './config.js';
import type { AuthService } from './auth.js';
import {
  OIDC_CALLBACK_PATH,
  OidcService,
  entraEndpoints,
  type OidcConfig,
  type OidcEndpoints,
} from './oidc.js';
import { SimulatedOidcProvider } from './oidc-simulated.js';
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

/** Compte du fournisseur Microsoft simulé de la démo (ADR 0015) ; il reçoit le rôle `operator`. */
export const DEMO_OIDC_USERNAME = `compte-microsoft@${DEMO_DOMAIN}`;
const DEMO_OIDC_GROUP = '00000000-0000-4000-8000-00000000d3a0';

/** Connexion Microsoft de la démo : fournisseur simulé en mémoire, aucun appel réseau. */
export function createDemoOidc(): { service: OidcService; provider: SimulatedOidcProvider } {
  const config: OidcConfig = {
    tenantId: '00000000-0000-4000-8000-000000000001',
    clientId: 'demo-client',
    clientSecret: 'demo-secret',
    redirectUri: `http://localhost${OIDC_CALLBACK_PATH}`,
    adminGroups: [],
    operatorGroups: [DEMO_OIDC_GROUP],
  };
  const endpoints: OidcEndpoints = {
    ...entraEndpoints(config.tenantId),
    // Le « fournisseur » est la console elle-même (route `demo-authorize`).
    authorization: '/api/auth/oidc/demo-authorize',
  };
  const provider = new SimulatedOidcProvider(config, endpoints, {
    oid: 'demo-oid-1',
    preferred_username: DEMO_OIDC_USERNAME,
    groups: [DEMO_OIDC_GROUP],
  });
  return { service: new OidcService(config, endpoints, provider.fetch), provider };
}

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
/** Âge de la dernière sauvegarde OneDrive fictive : la réussite du plan des fichiers a la même heure. */
const ONEDRIVE_SNAPSHOT_AGE_HOURS = 4;

interface DemoMailbox {
  id: string;
  name: string;
}

export const DEMO_MAILBOXES: readonly DemoMailbox[] = [
  { id: `claire.durand@${DEMO_DOMAIN}`, name: 'Claire Durand' },
  { id: `marc.lefevre@${DEMO_DOMAIN}`, name: 'Marc Lefèvre' },
  { id: `sophie.bernard@${DEMO_DOMAIN}`, name: 'Sophie Bernard' },
  // Adresse longue (plus de 60 caractères) : elle doit se couper après le « @ », sans faire déborder le tableau.
  {
    id: `direction.administrative.rh@filiale-europe-centrale.${DEMO_DOMAIN}`,
    name: 'Direction administrative et financière',
  },
  // La dernière boîte reste Paul Moreau : c'est elle qui n'a pas été sauvegardée depuis trois jours.
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

/** Arborescence OneDrive fictive, la même pour chaque compte (heures de modification : plus récent d'abord). */
const DEMO_DRIVE = [
  {
    parent: '/Documents/Budget',
    name: 'budget.xlsx',
    sizeBytes: 84_000,
    versionHours: [30, 130, 250],
  },
  { parent: '/Documents/Budget', name: 'previsions.xlsx', sizeBytes: 41_000, versionHours: [60] },
  {
    parent: '/Documents/Budget/2025',
    name: 'bilan-2025.xlsx',
    sizeBytes: 66_000,
    versionHours: [300],
  },
  { parent: '/Documents', name: 'notes.docx', sizeBytes: 12_000, versionHours: [90, 200] },
  { parent: '/Images', name: 'logo.png', sizeBytes: 23_000, versionHours: [500] },
] as const;

/** Bibliothèques fictives, les mêmes pour chaque site (`plan-b.pdf` échoue à la restauration). */
const DEMO_SITE_FILES = [
  { library: 'Documents partagés', parent: '/Plans 2024', name: 'plan-a.pdf', sizeBytes: 820_000 },
  { library: 'Documents partagés', parent: '/Plans 2024', name: 'plan-b.pdf', sizeBytes: 640_000 },
  { library: 'Documents partagés', parent: '/Plans 2024', name: 'notice.docx', sizeBytes: 31_000 },
  {
    library: 'Documents partagés',
    parent: '/Contrats',
    name: 'contrat-type.docx',
    sizeBytes: 52_000,
  },
  { library: 'Documents partagés', parent: '/', name: 'accueil.docx', sizeBytes: 18_000 },
  { library: 'Archives', parent: '/2023', name: 'rapport-annuel.pdf', sizeBytes: 1_900_000 },
] as const;

function siteEntries(now: number, backupHoursAgo: number) {
  return DEMO_SITE_FILES.map((f, i) => ({
    libraryName: f.library,
    fileName: f.name,
    parentPath: f.parent,
    sizeBytes: f.sizeBytes,
    lastModifiedAt: new Date(now - (40 + i * 20) * HOUR).toISOString(),
    backupAt: new Date(now - backupHoursAgo * HOUR).toISOString(),
    changeType: 'updated',
  }));
}

function driveEntries(now: number, backupHoursAgo: number) {
  return DEMO_DRIVE.map((f) => ({
    fileName: f.name,
    parentPath: f.parent,
    sizeBytes: f.sizeBytes,
    lastModifiedAt: new Date(now - f.versionHours[0] * HOUR).toISOString(),
    backupAt: new Date(now - backupHoursAgo * HOUR).toISOString(),
    changeType: 'updated',
  }));
}

/**
 * Faux SDK Atlas : quatre instantanés mail par boîte (les deux plus anciens sont incomplets), un instantané
 * OneDrive (périmé pour une boîte, ce qui allume une alerte sur le tableau de bord) et quelques
 * sites SharePoint. Aucun accès réseau ni disque.
 */
export function createDemoHandle(now: number = Date.now()): AtlasHandle {
  const mailboxIndex = (snapshotId: string) => {
    const index = Number(/^snap-mail-(\d+)-/.exec(snapshotId)?.[1]) - 1;
    return Number.isInteger(index) && DEMO_MAILBOXES[index] ? index : undefined;
  };
  // Le plus récent est daté de l'instant de démonstration, comme les exécutions des plans semés :
  // la carte « Dernière sauvegarde » de l'accueil et la page Sources donnent la même heure.
  // Le quatrième, vieux de 120 jours, dépasse la durée de conservation du premier plan semé
  // (90 jours) : la simulation de conservation a quelque chose à montrer (issue #79).
  const snapshotAges = [0, 24, 48, 120 * 24]; // heures
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
                totalSizeBytes: (k === 3 ? 1_850_000_000 : 42_000_000) + i * 7_000_000,
              })),
        );
      },
      getSnapshotDetail: (snapshotId) => {
        const i = mailboxIndex(snapshotId);
        const k = Number(/-(\d+)$/.exec(snapshotId)?.[1]);
        if (i === undefined || !(k >= 1 && k <= snapshotAges.length))
          return Promise.resolve(undefined);
        const all = mailsOf(i, now);
        // Les plus anciens instantanés n'ont que les deux tiers des mails.
        const entries = k >= 3 ? all.slice(0, Math.floor(all.length * 0.66)) : all;
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
        const age = i === DEMO_MAILBOXES.length - 1 ? 75 : ONEDRIVE_SNAPSHOT_AGE_HOURS;
        return Promise.resolve(
          [age, age + 30].map((hours, k) => ({
            snapshotId: `snap-od-${i + 1}-${k + 1}`,
            createdAt: new Date(now - hours * HOUR),
            totalFiles: 120 + i * 40 - k * 5,
            totalSizeBytes: 640_000_000 + i * 90_000_000,
            // Le plus ancien instantané n'a pas encore le dossier 2025.
            entries: driveEntries(now, hours).filter(
              (e) => k === 0 || !e.parentPath.includes('2025'),
            ),
          })),
        );
      },
      listFileVersions: (ownerId, fileRef) => {
        const i = DEMO_MAILBOXES.findIndex((m) => m.id === ownerId);
        const file = DEMO_DRIVE.find((f) => `${f.parent}/${f.name}` === fileRef);
        if (i < 0 || !file) return Promise.resolve([]);
        const age = i === DEMO_MAILBOXES.length - 1 ? 75 : ONEDRIVE_SNAPSHOT_AGE_HOURS;
        // Une version par instantané, plus une version antérieure propre à Microsoft 365.
        return Promise.resolve(
          file.versionHours.map((hours, k) => ({
            snapshotId: `snap-od-${i + 1}-${Math.min(k + 1, 2)}`,
            backupAt: new Date(now - (age + k * 30) * HOUR).toISOString(),
            ...(k === 0 ? {} : { versionId: `v${k + 1}` }),
            sizeBytes: file.sizeBytes - k * 3_000,
            lastModifiedAt: new Date(now - hours * HOUR).toISOString(),
            changeType: 'updated',
          })),
        );
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
            totalSizeBytes: 1_200_000_000 + i * 150_000_000,
            // Le plus ancien instantané n'a pas encore la bibliothèque Archives.
            entries: siteEntries(now, k === 0 ? 5 : 29).filter(
              (e) => k === 0 || e.libraryName !== 'Archives',
            ),
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

/**
 * Entrées de journal d'audit fictives, de la plus ancienne à la plus récente. Avec un plan, deux
 * lancements manuels `plan.run` le visent, motif compris.
 */
export function demoAuditEvents(now: number, planId?: string): AuditEvent[] {
  const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString();
  const run = (hoursAgo: number, reason: string): AuditEvent[] =>
    planId === undefined
      ? []
      : [
          {
            at: at(hoursAgo),
            actor: 'admin-demo',
            action: 'plan.run',
            resource: 'plan',
            target: planId,
            reason,
          },
        ];
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
      ...(planId === undefined ? {} : { target: planId }),
    },
    ...run(27, 'Premier essai après création du plan'),
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
      action: 'list.view',
      resource: 'mail.search',
      target: DEMO_MAILBOXES.at(-1)!.id,
      count: 25,
    },
    {
      at: at(21),
      actor: 'operateur-demo',
      action: 'list.view',
      resource: 'mail.search',
      target: '*',
      count: 10,
    },
    {
      at: at(21),
      actor: 'operateur-demo',
      action: 'list.view',
      resource: 'audit',
      count: 25,
    },
    {
      at: at(21),
      actor: 'operateur-demo',
      action: 'list.view',
      resource: 'audit',
      target: 'action=restore.request',
      count: 3,
    },
    {
      at: at(21),
      actor: 'operateur-demo',
      action: 'list.view',
      resource: 'sharepoint.items',
      target: `${DEMO_SITES[0].id}/Documents`,
      count: 10,
    },
    {
      at: at(21),
      actor: 'operateur-demo',
      action: 'item.open',
      resource: 'mail',
      target: `${DEMO_MAILBOXES[0]!.id}/msg-1-004`,
    },
    {
      at: at(20),
      actor: 'operateur-demo',
      action: 'item.export',
      resource: 'mail',
      target: `${DEMO_MAILBOXES[0]!.id}/msg-1-004`,
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
    ...run(1, 'Ticket INC-10002 : copie avant migration de la boîte'),
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
  // Le compte Microsoft simulé se crée à la première connexion de démonstration.
  const known = [...DEMO_ACCOUNTS.map((a) => a.username), DEMO_OIDC_USERNAME].filter((name) =>
    store.findByUsername(name),
  ).length;
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
    for (const event of demoAuditEvents(now, plans?.list()[0]?.id)) await audit.record(event);
  }
}

/** Durée simulée d'une restauration de démonstration. */
export const DEMO_RESTORE_MS = 2000;

/**
 * Restaurateur factice : attend `delayMs`, puis réussit ; le dernier mail de chaque boîte
 * (`…-025`) échoue, pour montrer l'écran d'échec. Ne touche à aucune boîte.
 */
export function createDemoRestorer(delayMs: number = DEMO_RESTORE_MS): MailRestorer {
  return {
    restoreMessage: async (_snapshotId, messageRef) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return messageRef.endsWith(`-${String(MAILS_PER_MAILBOX).padStart(3, '0')}`)
        ? { restored: 0, errors: 1 }
        : { restored: 1, errors: 0 };
    },
  };
}

/**
 * Restaurateur OneDrive factice : attend `delayMs`, puis réussit ; `previsions.xlsx` échoue, pour
 * montrer l'écran d'échec. Ne touche à aucun OneDrive.
 */
export function createDemoDriveRestorer(delayMs: number = DEMO_RESTORE_MS): DriveRestorer {
  return {
    restore: async (req) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return req.path.endsWith('/previsions.xlsx')
        ? { restored: 0, errors: 1 }
        : { restored: 1, errors: 0 };
    },
  };
}

/**
 * Restaurateur SharePoint factice : attend `delayMs`, puis réussit (un fichier : 1 restauré ; plus
 * large : 3 restaurés, 1 conservé) ; `plan-b.pdf` échoue, pour montrer l'écran d'échec. Ne touche
 * à aucun site.
 */
export function createDemoSiteRestorer(delayMs: number = DEMO_RESTORE_MS): SiteRestorer {
  return {
    restore: async (req) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (req.path.endsWith('/plan-b.pdf')) return { restored: 0, skipped: 0, errors: 1 };
      return req.scope === 'item'
        ? { restored: 1, skipped: 0, errors: 0 }
        : { restored: 3, skipped: 1, errors: 0 };
    },
  };
}

/**
 * Deux plans fictifs avec une exécution déjà inscrite dans le créneau courant (le planificateur
 * ne la relance donc pas) : l'un conforme, l'autre en échec, pour peupler le tableau de bord.
 */
function seedDemoPlans(plans: SqlitePlanStore, now: number): void {
  const base = { rtoHours: null, gdprJustification: 'Démonstration : données fictives.' } as const;
  const dataTypes: DataType[] = ['mail'];
  const at = new Date(now).toISOString();
  const [first, second] = DEMO_MAILBOXES;
  const compliant = plans.create({
    ...base,
    dataTypes,
    name: 'Boîtes mail, quotidien',
    scope: 'selection',
    selection: [first!.id],
    rpoHours: 24,
    retentionDays: 90,
  });
  const failing = plans.create({
    ...base,
    dataTypes,
    name: 'Boîte direction, quotidien',
    scope: 'selection',
    selection: [second!.id],
    rpoHours: 24,
    retentionDays: 365,
  });
  // Historique des nuits précédentes (page « Activités ») : réussites avec volume, un échec et une
  // interruption. Antérieures au créneau courant, elles ne changent ni l'état des plans ni l'accueil.
  const past = (
    planId: string,
    itemId: string,
    days: number,
    minutes: number,
    end: { error?: string; itemsSaved?: number; sourceBytes?: number },
  ) => {
    const start = now - days * 24 * HOUR;
    const id = plans.startRun(planId, itemId, new Date(start).toISOString());
    if (id === undefined) return;
    const finished = new Date(start + minutes * 60_000).toISOString();
    if (end.error) plans.finishRun(id, 'failed', finished, end.error);
    else plans.finishRun(id, 'success', finished, undefined, end);
  };
  past(compliant.id, first!.id, 4, 14, { itemsSaved: 1284, sourceBytes: 3_435_973_837 });
  past(compliant.id, first!.id, 3, 9, { error: 'interrupted' });
  past(compliant.id, first!.id, 2, 16, { itemsSaved: 412, sourceBytes: 3_445_973_837 });
  past(compliant.id, first!.id, 1, 3, { itemsSaved: 37, sourceBytes: 3_447_000_000 });
  past(failing.id, second!.id, 2, 65, { itemsSaved: 7712, sourceBytes: 4_144_643_031 });
  past(failing.id, second!.id, 1, 3, { error: 'backup_errors' });
  const ok = plans.startRun(compliant.id, first!.id, at);
  if (ok !== undefined) {
    plans.finishRun(ok, 'success', at, undefined, { itemsSaved: 52, sourceBytes: 3_448_000_000 });
  }
  const ko = plans.startRun(failing.id, second!.id, at);
  if (ko !== undefined) plans.finishRun(ko, 'failed', at, 'backup_errors');
  // Le plan des fichiers a produit les sauvegardes OneDrive et SharePoint du faux SDK : sa
  // réussite est datée de la plus récente (OneDrive), pour que la page Sources et les plans
  // en tirent le même constat.
  const files = plans.create({
    ...base,
    dataTypes: ['onedrive', 'sharepoint'],
    name: 'OneDrive et SharePoint Services',
    scope: 'all',
    selection: [],
    rpoHours: 24,
    rtoHours: 72,
    retentionDays: 1095,
    gdprJustification: 'Besoin métier : archives de projets',
  });
  const done = new Date(now - ONEDRIVE_SNAPSHOT_AGE_HOURS * HOUR).toISOString();
  const filesRun = plans.startRun(files.id, first!.id, done);
  if (filesRun !== undefined) {
    plans.finishRun(filesRun, 'success', done, undefined, { itemsSaved: 318 });
  }
}
