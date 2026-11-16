import { expect, test } from '@playwright/test';
import { startDemoServer } from './demo-server.mjs';

// Ces tests lancent le vrai `main.js` construit, sans navigateur.

test('un serveur de démo qui refuse de démarrer échoue vite, avec sa raison', async () => {
  const started = Date.now();
  // Configuration de stockage partielle et fictive : le mode démo doit la refuser.
  await expect(
    startDemoServer({ extraEnv: { BACKUP365_S3_ENDPOINT: 'https://s3.exemple.fr' } }),
  ).rejects.toThrow(/arrêté \(code 1\)[^]*BACKUP365_DEMO=1 refusé/);
  // Sans arrêt immédiat, l'attente dure 30 s. Borne large pour une CI lente.
  expect(Date.now() - started).toBeLessThan(20_000);
});

test('le serveur de démo démarre, annonce le mode démo, puis s’arrête', async () => {
  const server = await startDemoServer();
  try {
    const res = await fetch(`${server.baseURL}/api/health`);
    expect(((await res.json()) as { demo?: boolean }).demo).toBe(true);
  } finally {
    await server.stop();
  }
  await expect(fetch(`${server.baseURL}/api/health`)).rejects.toThrow();
});
