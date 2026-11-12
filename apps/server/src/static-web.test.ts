import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'b365-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(dir, 'notes.txt'), 'non servi');
  writeFileSync(join(dir, 'assets', 'mon fichier é.js'), 'console.log(2)');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('interface statique', () => {
  it('serves index.html at the root with a CSP allowing own scripts', async () => {
    const res = await buildApp({ version: 't', webDir: dir }).inject('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it('serves assets with their type', async () => {
    const res = await buildApp({ version: 't', webDir: dir }).inject('/assets/app.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.body).toBe('console.log(1)');
  });
  it('falls back to index.html for client routes only', async () => {
    const app = buildApp({ version: 't', webDir: dir });
    expect((await app.inject('/statut')).body).toContain('id="root"');
    expect((await app.inject('/notes.txt')).statusCode).toBe(404);
    expect((await app.inject('/assets/ancien.js')).statusCode).toBe(404);
  });
  it('decodes the path before looking the file up', async () => {
    const app = buildApp({ version: 't', webDir: dir });
    const res = await app.inject('/assets/mon%20fichier%20%C3%A9.js');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(2)');
    expect((await app.inject('/assets/%E0%A4%A.js')).statusCode).toBe(400);
  });
  it('answers HEAD on the root', async () => {
    const res = await buildApp({ version: 't', webDir: dir }).inject({ method: 'HEAD', url: '/' });
    expect(res.statusCode).toBe(200);
  });
  it('does not escape the directory', async () => {
    const res = await buildApp({ version: 't', webDir: dir }).inject('/..%2f..%2fetc/passwd');
    expect(res.body).not.toContain('root:');
  });
  it('keeps a JSON 404 and the API CSP for unknown API routes', async () => {
    const app = buildApp({ version: 't', webDir: dir });
    const res = await app.inject('/api/inconnu');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect((await app.inject('/api/health')).statusCode).toBe(200);
  });
  it('fails at startup without index.html', () => {
    rmSync(join(dir, 'index.html'));
    expect(() => buildApp({ version: 't', webDir: dir })).toThrow('index.html');
  });
  it('serves nothing without webDir', async () => {
    expect((await buildApp({ version: 't' }).inject('/')).statusCode).toBe(404);
  });
});
