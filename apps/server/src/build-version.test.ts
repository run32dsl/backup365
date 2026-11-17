import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { displayVersion } from './build-version.js';

describe('displayVersion', () => {
  it('combines the package version and the short commit of a built image', () => {
    expect(displayVersion('0.3.0', '8f4fb49')).toBe('0.3.0 · 8f4fb49');
  });
  it('falls back to dev without a commit or with an invalid one', () => {
    expect(displayVersion('0.3.0', undefined)).toBe('dev');
    expect(displayVersion('0.3.0', '')).toBe('dev');
    expect(displayVersion('0.3.0', 'not a sha')).toBe('dev');
  });
  it('never returns 0.0.0', () => {
    expect(displayVersion('0.0.0', '8f4fb49')).toBe('dev');
    expect(displayVersion('', '8f4fb49')).toBe('dev');
  });
  it('is not the version of the server package, which must not be 0.0.0', () => {
    const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
    expect(version).not.toBe('0.0.0');
    expect(displayVersion(version, '8f4fb49')).not.toBe('dev');
  });
});
