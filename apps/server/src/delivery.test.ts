import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WEB_CSP } from './static-web.js';

// Contrôles statiques des fichiers de livraison : ils ne remplacent pas le job CI `image`
// (construction et démarrage réels), ils attrapent les régressions visibles sans conteneur.

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

/** Bloc d'un service de compose.yaml (indentation de deux espaces), jusqu'au service suivant. */
function service(compose: string, name: string): string {
  const block = new RegExp(`^  ${name}:\\n((?:(?:    .*|\\s*#.*|)\\n)+)`, 'm').exec(compose);
  if (!block?.[1]) throw new Error(`service ${name} introuvable`);
  return block[1];
}

describe('Containerfile', () => {
  const stages = read('Containerfile')
    .split(/^FROM /m)
    .slice(1);

  it('has a build stage and a runtime stage', () => {
    expect(stages).toHaveLength(2);
    expect(stages[0]).toMatch(/^\S+ AS build\n/);
  });

  it('runs as a non-root user, set before the command', () => {
    const runtime = stages[1] ?? '';
    const user = /^USER (\S+)$/m.exec(runtime);
    expect(user?.[1]).toBe('node');
    expect(runtime.indexOf('\nUSER ')).toBeLessThan(runtime.indexOf('\nCMD '));
    // Hors commentaires : l'étape d'exécution n'installe ni n'appelle pnpm.
    expect(runtime.replace(/^\s*#.*$/gm, '')).not.toContain('pnpm');
  });
});

describe('compose.yaml', () => {
  const compose = read('compose.yaml');

  it('publishes the console on the loopback interface only', () => {
    const ports = /ports:\n((?: {6}- .*\n)+)/.exec(service(compose, 'console'))?.[1] ?? '';
    expect(ports.trim().split('\n')).toEqual([`- '127.0.0.1:\${BACKUP365_PORT:-3000}:3000'`]);
  });

  // La forme seulement : ce test accepte le digest marqueur, il ne prouve pas une image réelle.
  it('keeps MinIO optional, unpublished and referenced by digest, never by tag', () => {
    const minio = service(compose, 'minio');
    expect(minio).toContain('profiles: [minio]');
    expect(minio).not.toMatch(/^\s+ports:/m);
    expect(/^\s+image: (\S+)$/m.exec(minio)?.[1]).toMatch(/^[\w./-]+@sha256:[0-9a-f]{64}$/);
  });

  it('gives secrets by mounted files only, each one declared', () => {
    const declared = [...compose.matchAll(/^ {2}(\w+):\n {4}file: \.\/secrets\/\1$/gm)].map(
      (match) => match[1],
    );
    const mounted = [...compose.matchAll(/_FILE: \/run\/secrets\/(\w+)$/gm)].map((m) => m[1]);
    expect(mounted.length).toBeGreaterThan(0);
    for (const name of mounted) expect(declared).toContain(name);
    // Un secret désigné par `_FILE` dans un service doit aussi lui être monté.
    for (const name of ['console', 'minio']) {
      const block = service(compose, name);
      for (const [, secret] of block.matchAll(/_FILE: \/run\/secrets\/(\w+)$/gm)) {
        expect(block, `${name} : ${secret}`).toMatch(new RegExp(`^ {6}- ${secret}$`, 'm'));
      }
    }
    expect(compose).not.toMatch(/^\s+\w*(SECRET_ACCESS_KEY|PASSPHRASE|PASSWORD|ACCESS_KEY_ID):/m);
  });
});

describe('deploy/synology', () => {
  const compose = read('deploy/synology/compose.yaml');
  const console_ = service(compose, 'console');

  // La forme seulement : le digest marqueur (64 zéros) est accepté.
  it('references the ghcr.io image by digest', () => {
    expect(/^\s+image: (\S+)$/m.exec(console_)?.[1]).toMatch(
      /^ghcr\.io\/run32dsl\/backup365@sha256:[0-9a-f]{64}$/,
    );
  });

  it('requires an explicit bind address, never defaulting to all interfaces', () => {
    const ports = /ports:\n((?: {6}- .*\n)+)/.exec(console_)?.[1] ?? '';
    expect(ports.trim()).toMatch(/^- '\$\{BACKUP365_BIND_ADDRESS:\?[^}]+\}:/);
    expect(ports).not.toContain('0.0.0.0');
  });

  it('reads an unversioned .env and keeps data on a bind mount, without secret values', () => {
    expect(console_).toMatch(/^ {4}env_file: \.env$/m);
    expect(console_).toMatch(/^ {6}- \$\{BACKUP365_DATA_PATH:-\/volume1\/[^}]+\}:\/data$/m);
    expect(compose).not.toMatch(/^\s+\w*(SECRET_ACCESS_KEY|PASSPHRASE|ACCESS_KEY_ID):/m);
    expect(read('.gitignore')).toMatch(/^\.env$/m);
  });

  it('gives only generic example addresses in the guide and the .env example', () => {
    for (const file of ['docs/installation-synology.md', 'deploy/synology/.env.example']) {
      const text = read(file);
      for (const [ip] of text.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)) {
        expect(ip, file).toMatch(/^192\.168\.1\.\d+$|^0\.0\.0\.0$/);
      }
    }
    expect(read('docs/installation-synology.md').split('\n').slice(0, 3).join(' ')).toContain(
      'Réseau local uniquement',
    );
  });
});

describe('interface sous la CSP des pages', () => {
  const web = join(root, 'apps', 'web');
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? sources(join(dir, entry.name)) : [join(dir, entry.name)],
    );

  it("forbids inline styles and scripts, so the console's sources must not use any", () => {
    expect(WEB_CSP).toContain("style-src 'self'");
    expect(WEB_CSP).toContain("script-src 'self'");
    expect(WEB_CSP).not.toContain('unsafe');
    const files = [join(web, 'index.html'), ...sources(join(web, 'src'))].filter(
      (file) => !/\.test\.tsx?$/.test(file),
    );
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // Attribut style (React l'écrit en ligne), balise style, HTML injecté, script en ligne.
      expect(text, file).not.toMatch(/\bstyle=|<style\b|dangerouslySetInnerHTML|\.style\./);
      expect(text, file).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
      // Aucune ressource distante : la politique n'autorise que l'origine de la console.
      expect(text, file).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    }
  });
});
