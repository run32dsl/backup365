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
});
