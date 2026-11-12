import { describe, expect, it } from 'vitest';
import { EmlError, toEml } from './eml.js';

/** Découpe un EML en en-têtes (dépliés) et corps, comme le ferait un client mail. */
function parse(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString('utf8');
  const [head = '', ...rest] = text.split('\r\n\r\n');
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const i = line.indexOf(':');
    headers.set(line.slice(0, i).toLowerCase(), line.slice(i + 1).trim());
  }
  return { headers, body: rest.join('\r\n\r\n') };
}

describe('toEml', () => {
  it('returns MIME content byte for byte', () => {
    const raw = Buffer.from('Subject: x\r\n\r\ncorps\r\n');
    const eml = toEml({ format: 'mime', raw, attachments: [] });
    expect(Buffer.from(eml.bytes).equals(raw)).toBe(true);
    expect(eml.omittedAttachments).toBe(0);
  });

  it('rebuilds a parseable message from the legacy Graph payload', () => {
    const eml = toEml({
      format: 'graph-json',
      raw: new Uint8Array(),
      message: {
        subject: 'Réunion équipe',
        from: { emailAddress: { name: 'Alice Ünï', address: 'alice@example.test' } },
        toRecipients: [{ emailAddress: { address: 'bob@example.test' } }],
        ccRecipients: [{ emailAddress: { name: 'Carol', address: 'carol@example.test' } }],
        sentDateTime: '2026-01-01T10:00:00Z',
        internetMessageId: '<m1@example.test>',
        body: { contentType: 'html', content: '<p>Bonjour é</p>' },
      },
      attachments: [],
    });
    const { headers, body } = parse(eml.bytes);
    expect(headers.get('to')).toBe('bob@example.test');
    expect(headers.get('cc')).toBe('Carol <carol@example.test>');
    expect(headers.get('date')).toBe('Thu, 01 Jan 2026 10:00:00 GMT');
    expect(headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(headers.get('mime-version')).toBe('1.0');
    const decode = (w: string) =>
      Buffer.from(/=\?UTF-8\?B\?(.*)\?=/.exec(w)?.[1] ?? '', 'base64').toString('utf8');
    expect(decode(headers.get('subject') ?? '')).toBe('Réunion équipe');
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(
      '<p>Bonjour é</p>',
    );
  });

  it('cannot inject a header through a subject or an address', () => {
    const eml = toEml({
      format: 'graph-json',
      raw: new Uint8Array(),
      message: {
        subject: 'a\r\nBcc: evil@example.test',
        from: { emailAddress: { address: 'x@example.test>\r\nBcc: evil@example.test' } },
        body: { contentType: 'text', content: '' },
      },
      attachments: [],
    });
    const { headers } = parse(eml.bytes);
    expect(headers.has('bcc')).toBe(false);
  });

  it('counts the attachments it cannot include', () => {
    const eml = toEml({
      format: 'graph-json',
      raw: new Uint8Array(),
      message: { subject: 's', body: { contentType: 'text', content: 'x' } },
      attachments: [{ name: 'a', contentType: 'text/plain', size: 1 }],
    });
    expect(eml.omittedAttachments).toBe(1);
  });

  it('rejects a legacy content without payload', () => {
    expect(() => toEml({ format: 'graph-json', raw: new Uint8Array(), attachments: [] })).toThrow(
      EmlError,
    );
  });
});
