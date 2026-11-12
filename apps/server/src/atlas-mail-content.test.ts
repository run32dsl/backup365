import { MailContentUnavailableError } from '@backup365/core';
import { describe, expect, it } from 'vitest';
import { AtlasSdkMailContentReader, type AtlasMessageReader } from './atlas-mail-content.js';

type Read = AtlasMessageReader['outlook']['readMessage'];
const reader = (readMessage: Read) => new AtlasSdkMailContentReader({ outlook: { readMessage } });

describe('AtlasSdkMailContentReader', () => {
  it('maps a MIME result and passes the snapshot and message references', async () => {
    const calls: string[][] = [];
    const raw = Buffer.from('Subject: x\r\n\r\n');
    const content = await reader((s, m) => {
      calls.push([s, m]);
      return Promise.resolve({
        raw,
        payloadFormat: 'mime',
        attachments: [{ name: 'a.pdf', contentType: 'application/pdf', sizeBytes: 9 }],
      });
    }).readMessage('snap-1', 'm1');
    expect(calls).toEqual([['snap-1', 'm1']]);
    expect(content).toEqual({
      format: 'mime',
      raw,
      attachments: [{ name: 'a.pdf', contentType: 'application/pdf', size: 9 }],
    });
  });

  it('treats an absent payload format as the legacy Graph JSON', async () => {
    const content = await reader(() =>
      Promise.resolve({ raw: Buffer.from('{}'), message: { subject: 's' }, attachments: [] }),
    ).readMessage('s', 'm');
    expect(content).toMatchObject({ format: 'graph-json', message: { subject: 's' } });
  });

  it('returns null for an unknown message', async () => {
    expect(await reader(() => Promise.resolve(undefined)).readMessage('s', 'm')).toBeNull();
  });

  it('converts SDK failures without exposing their message', async () => {
    const err = await reader(() => Promise.reject(new Error('bucket secret')))
      .readMessage('s', 'm')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailContentUnavailableError);
    expect((err as Error).message).not.toContain('secret');
  });
});
