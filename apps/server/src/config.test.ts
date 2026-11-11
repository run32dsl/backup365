import { describe, expect, it } from 'vitest';
import { parseLogLevel, parsePort } from './config.js';

describe('parsePort', () => {
  it('uses the default when unset or empty', () => {
    expect(parsePort(undefined)).toBe(3000);
    expect(parsePort('')).toBe(3000);
  });
  it('accepts valid ports', () => {
    expect(parsePort('8080')).toBe(8080);
    expect(parsePort('65535')).toBe(65535);
  });
  it.each(['abc', '0', '65536', '-1', '80.5'])('rejects %s', (raw) => {
    expect(() => parsePort(raw)).toThrow('PORT invalide');
  });
});

describe('parseLogLevel', () => {
  it('uses the default when unset or empty', () => {
    expect(parseLogLevel(undefined)).toBe('info');
    expect(parseLogLevel('')).toBe('info');
  });
  it('accepts known levels', () => {
    expect(parseLogLevel('debug')).toBe('debug');
  });
  it.each(['verbose', 'INFO', '3'])('rejects %s', (raw) => {
    expect(() => parseLogLevel(raw)).toThrow('LOG_LEVEL invalide');
  });
});
