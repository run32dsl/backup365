import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Nombre de mails fictifs que le mode démo indexe (4 boîtes de 25). */
export const DEMO_MAIL_COUNT = 100;

export const DEMO_LOGINS = {
  admin: { username: 'admin-demo', password: 'demonstration-admin' },
  operator: { username: 'operateur-demo', password: 'demonstration-operateur' },
};

/** Plans fictifs créés au démarrage (noms d'exemple, aucune donnée réelle). */
export const DEMO_PLANS = [
  {
    name: 'Messagerie Direction',
    scope: 'all',
    dataTypes: ['mail'],
    rpoHours: 12,
    rtoHours: 24,
    retentionDays: 365,
    gdprJustification: 'Obligation légale',
  },
  {
    name: 'Fichiers Services',
    scope: 'all',
    dataTypes: ['files', 'calendar'],
    rpoHours: 24,
    rtoHours: 72,
    retentionDays: 1095,
    gdprJustification: 'Besoin métier : archives de projets',
  },
];

/** Port TCP libre sur la boucle locale. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitFor(check, what, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // le serveur n'écoute pas encore
    }
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Lance la console construite en mode démo, sur un port libre et un dossier de données jetable.
 * Rend quand les comptes existent, que les 100 mails fictifs sont indexés et que les plans fictifs
 * sont créés. Avec `settled`, attend aussi leur première exécution (jusqu'à une minute : le
 * planificateur passe toutes les 30 s), pour des captures où ils sont « Conformes ».
 * `stop()` arrête le serveur et efface le dossier.
 */
export async function startDemoServer({ settled = false } = {}) {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'b365-demo-'));
  const child = spawn(process.execPath, [join(root, 'apps/server/dist/main.js')], {
    cwd: root,
    stdio: 'ignore',
    env: {
      // Environnement minimal : aucune variable de stockage de l'appelant ne doit passer.
      PATH: process.env['PATH'],
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      BACKUP365_DEMO: '1',
      BACKUP365_DATA_DIR: dataDir,
      BACKUP365_WEB_DIR: join(root, 'apps/web/dist'),
    },
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const baseURL = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (!exited) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    rmSync(dataDir, { recursive: true, force: true });
  };
  try {
    await waitFor(async () => {
      if (exited) throw new Error('Le serveur de démonstration s’est arrêté');
      return (await fetch(`${baseURL}/api/health`)).ok;
    }, 'démarrage du serveur de démonstration');
    const login = await fetch(`${baseURL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(DEMO_LOGINS.admin),
    });
    if (!login.ok) throw new Error(`Connexion de démonstration refusée (${login.status})`);
    const headers = {
      cookie: login.headers.get('set-cookie').split(';')[0],
      'x-csrf-token': (await login.json()).csrfToken,
    };
    await waitFor(async () => {
      const res = await fetch(`${baseURL}/api/search?limit=1`, { headers });
      return (await res.json()).total >= DEMO_MAIL_COUNT;
    }, 'indexation des mails de démonstration');
    // Deux plans fictifs : l'écran des plans n'est pas vide, et le planificateur simulé les exécute.
    for (const plan of DEMO_PLANS) {
      const res = await fetch(`${baseURL}/api/plans`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(plan),
      });
      if (!res.ok) throw new Error(`Plan de démonstration refusé (${res.status})`);
    }
    if (settled) {
      await waitFor(
        async () => {
          const res = await fetch(`${baseURL}/api/plans`, { headers });
          const { items } = await res.json();
          return items.every((p) => p.lastRun !== null);
        },
        'première exécution des plans de démonstration',
        60_000,
      );
    }
  } catch (err) {
    await stop();
    throw err;
  }
  return { baseURL, stop };
}
