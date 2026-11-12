import { describe, expect, it } from 'vitest';
import { parseLogLevel, parsePort, parseStorageConfig } from './config.js';

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

describe('parseStorageConfig', () => {
  const full = {
    BACKUP365_S3_BUCKET: 'b',
    BACKUP365_S3_ACCESS_KEY_ID: 'id',
    BACKUP365_S3_SECRET_ACCESS_KEY: 'topsecret',
    BACKUP365_ENCRYPTION_PASSPHRASE: 'phrase',
  };
  it('returns undefined when nothing is set', () => {
    expect(parseStorageConfig({})).toBeUndefined();
  });
  it('reads a full configuration with defaults', () => {
    expect(parseStorageConfig(full)).toMatchObject({ bucket: 'b', region: 'eu-west-3' });
  });
  it('reads the optional endpoint and region', () => {
    expect(
      parseStorageConfig({
        ...full,
        BACKUP365_S3_ENDPOINT: 'https://s3.example.test',
        BACKUP365_S3_REGION: 'r1',
      }),
    ).toMatchObject({ endpoint: 'https://s3.example.test', region: 'r1' });
  });
  it('rejects a configuration with only optional variables', () => {
    expect(() => parseStorageConfig({ BACKUP365_S3_REGION: 'r1' })).toThrow('incomplète');
  });
  it('treats an empty required variable as missing', () => {
    expect(() => parseStorageConfig({ ...full, BACKUP365_S3_BUCKET: '' })).toThrow(
      'BACKUP365_S3_BUCKET',
    );
  });
  it('names the missing variables without echoing values', () => {
    const run = (): unknown =>
      parseStorageConfig({ BACKUP365_S3_BUCKET: 'b', BACKUP365_S3_SECRET_ACCESS_KEY: 'topsecret' });
    expect(run).toThrow('BACKUP365_S3_ACCESS_KEY_ID, BACKUP365_ENCRYPTION_PASSPHRASE');
    expect(run).not.toThrow('topsecret');
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
