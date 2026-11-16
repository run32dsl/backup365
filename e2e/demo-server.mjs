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

/** Longueur conservée de la sortie d'erreur du serveur (la fin suffit au diagnostic). */
const STDERR_TAIL = 4000;

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

/** Attend que `check` rende vrai. Une erreur de `abortIfDead` arrête l'attente tout de suite. */
async function waitFor(check, what, abortIfDead, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    abortIfDead();
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
 * Si le serveur s'arrête pendant le démarrage, l'erreur porte son code de sortie et la fin de sa
 * sortie d'erreur : sans cela, un échec dans la CI ne dirait que « délai dépassé ».
 * `extraEnv` ajoute des variables (tests du refus de démarrer).
 */
export async function startDemoServer({ extraEnv = {} } = {}) {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), 'b365-demo-'));
  const child = spawn(process.execPath, [join(root, 'apps/server/dist/main.js')], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      // Environnement minimal : aucune variable de stockage de l'appelant ne doit passer.
      PATH: process.env['PATH'],
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      BACKUP365_DEMO: '1',
      BACKUP365_DATA_DIR: dataDir,
      BACKUP365_WEB_DIR: join(root, 'apps/web/dist'),
      ...extraEnv,
    },
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL);
  });
  let exited = false;
  let exitCause = '';
  // `close` et non `exit` : la sortie d'erreur est alors entièrement lue.
  child.once('close', (code, signal) => {
    exited = true;
    exitCause = code === null ? `signal ${signal}` : `code ${code}`;
  });
  const abortIfDead = () => {
    if (!exited) return;
    const reason = stderr.trim() || 'aucune sortie d’erreur';
    throw new Error(`Le serveur de démonstration s’est arrêté (${exitCause}) : ${reason}`);
  };
  const baseURL = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (!exited) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('close', resolve));
    }
    rmSync(dataDir, { recursive: true, force: true });
  };
  try {
    await waitFor(
      async () => (await fetch(`${baseURL}/api/health`)).ok,
      'démarrage du serveur de démonstration',
      abortIfDead,
    );
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
    await waitFor(
      async () => {
        const res = await fetch(`${baseURL}/api/search?limit=1`, { headers });
        return (await res.json()).total >= DEMO_MAIL_COUNT;
      },
      'indexation des mails de démonstration',
      abortIfDead,
    );
  } catch (err) {
    await stop();
    throw err;
  }
  return { baseURL, stop };
}
