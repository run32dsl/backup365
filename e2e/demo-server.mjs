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
 * Rend quand les comptes existent et que les 100 mails fictifs sont indexés.
 * `stop()` arrête le serveur et efface le dossier.
 */
export async function startDemoServer() {
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
  } catch (err) {
    await stop();
    throw err;
  }
  return { baseURL, stop };
}
