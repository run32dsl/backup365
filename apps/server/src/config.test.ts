import { describe, expect, it } from 'vitest';
import {
  parseDataDir,
  parseIndexIntervalMs,
  parseLogLevel,
  parseM365Config,
  parsePort,
  parseStorageConfig,
  parseTrustProxy,
  withSecretFiles,
} from './config.js';

describe('parseTrustProxy', () => {
  it('is off by default and takes proxy addresses, never a blanket "true"', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('172.18.0.1')).toBe('172.18.0.1');
    expect(parseTrustProxy(' 10.0.0.0/8 , ::1 ')).toBe('10.0.0.0/8,::1');
    for (const bad of ['true', '1', '10.0.0.0/33', '10.0.0.1/8/8', 'x', '10.0.0.1,']) {
      expect(() => parseTrustProxy(bad), bad).toThrow('BACKUP365_TRUST_PROXY');
    }
  });
});

describe('withSecretFiles', () => {
  const files: Record<string, string> = { '/run/secrets/pass': 'une-phrase-de-test\n' };
  const read = (path: string): string => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT ${path}`);
    return content;
  };

  it('fills the variable from the file, without the trailing newline', () => {
    const env = withSecretFiles(
      { BACKUP365_ENCRYPTION_PASSPHRASE_FILE: '/run/secrets/pass' },
      read,
    );
    expect(env['BACKUP365_ENCRYPTION_PASSPHRASE']).toBe('une-phrase-de-test');
  });
  it('leaves the environment alone without _FILE variables', () => {
    expect(withSecretFiles({ PORT: '80' }, read)).toEqual({ PORT: '80' });
  });
  it('rejects a variable given both directly and by file', () => {
    const env = {
      BACKUP365_ENCRYPTION_PASSPHRASE: 'x',
      BACKUP365_ENCRYPTION_PASSPHRASE_FILE: '/run/secrets/pass',
    };
    expect(() => withSecretFiles(env, read)).toThrow('exclusifs');
  });
  it('names the variable, never the path, when the file is unreadable', () => {
    const run = () =>
      withSecretFiles({ BACKUP365_S3_SECRET_ACCESS_KEY_FILE: '/chemin-secret' }, read);
    expect(run).toThrow('BACKUP365_S3_SECRET_ACCESS_KEY_FILE illisible');
    expect(run).not.toThrow('/chemin-secret');
  });
});

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

describe('parseDataDir', () => {
  it('uses ./data when unset or empty', () => {
    expect(parseDataDir(undefined)).toBe('./data');
    expect(parseDataDir('')).toBe('./data');
  });
  it('uses the given folder', () => {
    expect(parseDataDir('/var/lib/backup365')).toBe('/var/lib/backup365');
  });
});

describe('parseStorageConfig', () => {
  const full = {
    BACKUP365_TENANT_ID: 'tenant-test',
    BACKUP365_S3_ENDPOINT: 'https://s3.example.test',
    BACKUP365_S3_ACCESS_KEY_ID: 'id',
    BACKUP365_S3_SECRET_ACCESS_KEY: 'topsecret',
    BACKUP365_ENCRYPTION_PASSPHRASE: 'phrase',
  };
  it('returns undefined when nothing is set', () => {
    expect(parseStorageConfig({})).toBeUndefined();
  });
  it('reads a full configuration with defaults', () => {
    expect(parseStorageConfig(full)).toMatchObject({
      tenantId: 'tenant-test',
      endpoint: 'https://s3.example.test',
      region: 'eu-west-3',
    });
  });
  it('reads the optional region', () => {
    expect(parseStorageConfig({ ...full, BACKUP365_S3_REGION: 'r1' })).toMatchObject({
      region: 'r1',
    });
  });
  it('rejects a configuration with only the region', () => {
    expect(() => parseStorageConfig({ BACKUP365_S3_REGION: 'r1' })).toThrow('incomplète');
  });
  it('treats an empty required variable as missing', () => {
    expect(() => parseStorageConfig({ ...full, BACKUP365_S3_ENDPOINT: '' })).toThrow(
      'BACKUP365_S3_ENDPOINT',
    );
  });
  it('names the missing variables without echoing values', () => {
    const run = (): unknown =>
      parseStorageConfig({
        BACKUP365_TENANT_ID: 'tenant-test',
        BACKUP365_S3_ENDPOINT: 'https://s3.example.test',
        BACKUP365_S3_SECRET_ACCESS_KEY: 'topsecret',
      });
    expect(run).toThrow('BACKUP365_S3_ACCESS_KEY_ID, BACKUP365_ENCRYPTION_PASSPHRASE');
    expect(run).not.toThrow('topsecret');
  });
});

describe('parseM365Config (compose.yaml par défaut)', () => {
  it('treats an empty client id and an empty secret file as not configured', () => {
    const env = withSecretFiles(
      {
        BACKUP365_M365_CLIENT_ID: '',
        BACKUP365_M365_CLIENT_SECRET_FILE: '/run/secrets/m365_client_secret',
      },
      () => '',
    );
    expect(parseM365Config(env)).toBeUndefined();
  });

  it('refuses a client id without a secret, and the reverse, naming the variable', () => {
    expect(() => parseM365Config({ BACKUP365_M365_CLIENT_ID: 'id' })).toThrow(
      'BACKUP365_M365_CLIENT_SECRET',
    );
    expect(() => parseM365Config({ BACKUP365_M365_CLIENT_SECRET: 's' })).toThrow(
      'BACKUP365_M365_CLIENT_ID',
    );
  });

  it('reads the secret from the mounted file', () => {
    const env = withSecretFiles(
      { BACKUP365_M365_CLIENT_ID: 'id', BACKUP365_M365_CLIENT_SECRET_FILE: '/f' },
      () => 's\n',
    );
    expect(parseM365Config(env)).toEqual({ clientId: 'id', clientSecret: 's' });
  });
});

describe('parseIndexIntervalMs', () => {
  it('defaults to 60 minutes and converts minutes to milliseconds', () => {
    expect(parseIndexIntervalMs(undefined)).toBe(3_600_000);
    expect(parseIndexIntervalMs('5')).toBe(300_000);
  });
  it.each(['0', '1441', '1.5', 'abc'])('rejects %s', (raw) => {
    expect(() => parseIndexIntervalMs(raw)).toThrow('BACKUP365_INDEX_INTERVAL_MINUTES invalide');
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
