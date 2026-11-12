import type { MailContent } from '@backup365/core';

/** Échec de construction d'un EML : la charge utile n'a pas la forme attendue. */
export class EmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmlError';
  }
}

export interface Eml {
  bytes: Uint8Array;
  /** Pièces jointes de l'ancien format, absentes de l'EML reconstruit. */
  omittedAttachments: number;
}

interface GraphAddress {
  emailAddress?: { name?: unknown; address?: unknown };
}

/** Retire les sauts de ligne : une valeur d'en-tête ne doit jamais pouvoir ouvrir un nouvel en-tête. */
function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** Mot encodé RFC 2047 pour tout texte non ASCII. */
function encodeWord(value: string): string {
  const clean = headerValue(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function address(entry: GraphAddress): string | null {
  const addr = entry.emailAddress?.address;
  if (typeof addr !== 'string' || addr.trim() === '') return null;
  const name = typeof entry.emailAddress?.name === 'string' ? entry.emailAddress.name : '';
  const bare = headerValue(addr).replace(/[<>"]/g, '');
  return name === '' ? bare : `${encodeWord(name).replace(/["\\]/g, '')} <${bare}>`;
}

function addressList(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const list = (value as GraphAddress[]).map(address).filter((a): a is string => a !== null);
  return list.length > 0 ? list.join(', ') : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Base 64 coupée en lignes de 76 caractères (RFC 2045). */
function base64Lines(text: string): string {
  return (
    Buffer.from(text, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g) ?? []
  ).join('\r\n');
}

/**
 * Fichier EML d'un mail sauvegardé. Le format `mime` est restitué tel que stocké (octets
 * d'origine). L'ancien format (charge utile Graph JSON) est reconstruit : en-têtes principaux et
 * corps, sans les pièces jointes, dont le contenu n'est pas lu (`omittedAttachments`).
 */
export function toEml(content: MailContent): Eml {
  if (content.format === 'mime') return { bytes: content.raw, omittedAttachments: 0 };
  const m = content.message;
  if (!m) throw new EmlError('Charge utile Graph absente');

  const headers: string[] = [];
  const from = m['from'] as GraphAddress | undefined;
  const fromLine = from ? address(from) : null;
  if (fromLine) headers.push(`From: ${fromLine}`);
  for (const [name, key] of [
    ['To', 'toRecipients'],
    ['Cc', 'ccRecipients'],
  ] as const) {
    const line = addressList(m[key]);
    if (line) headers.push(`${name}: ${line}`);
  }
  headers.push(`Subject: ${encodeWord(str(m['subject']) ?? '')}`);
  const sent = str(m['sentDateTime']) ?? str(m['receivedDateTime']);
  const date = sent ? new Date(sent) : undefined;
  if (date && !isNaN(date.getTime())) headers.push(`Date: ${date.toUTCString()}`);
  const messageId = str(m['internetMessageId']);
  if (messageId) headers.push(`Message-ID: ${headerValue(messageId)}`);

  const body = m['body'] as { contentType?: unknown; content?: unknown } | undefined;
  const html = typeof body?.contentType === 'string' && body.contentType.toLowerCase() === 'html';
  const text = typeof body?.content === 'string' ? body.content : '';
  headers.push(
    'MIME-Version: 1.0',
    `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=utf-8`,
    'Content-Transfer-Encoding: base64',
    'X-Backup365-Reconstructed: graph-json',
  );
  const eml = `${headers.join('\r\n')}\r\n\r\n${base64Lines(text)}\r\n`;
  return { bytes: Buffer.from(eml, 'utf8'), omittedAttachments: content.attachments.length };
}
