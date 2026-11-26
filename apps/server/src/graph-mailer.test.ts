import { describe, expect, it } from 'vitest';
import { GraphMailer, MailSendError, parseReportSender, tokenRoles } from './graph-mailer.js';

/** Jeton factice dont la charge utile porte les rôles donnés (signature absente : non vérifiée). */
const tokenWith = (roles: string[]) =>
  `e30.${Buffer.from(JSON.stringify({ roles })).toString('base64url')}.sig`;

type Call = { url: string; init: RequestInit };

/** Faux `fetch` : le jeton, puis la réponse de Graph. Aucun appel réseau. */
function fakeFetch(roles: string[], graphStatus = 202, tokenStatus = 200) {
  const calls: Call[] = [];
  const fn = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (String(url).includes('/oauth2/')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: tokenWith(roles) }), { status: tokenStatus }),
      );
    }
    return Promise.resolve(new Response(null, { status: graphStatus }));
  };
  return { calls, fetch: fn as typeof fetch };
}

const options = {
  tenantId: 'tenant-test',
  clientId: 'client-test',
  clientSecret: 'secret-test',
  sender: 'sauvegardes@exemple.invalid',
};

describe('GraphMailer', () => {
  it('is ready only when the token carries the Mail.Send application role', async () => {
    const ready = new GraphMailer({ ...options, fetch: fakeFetch(['Mail.Send']).fetch });
    expect(await ready.status()).toEqual({ state: 'ready', sender: options.sender });
    const missing = new GraphMailer({ ...options, fetch: fakeFetch(['Files.Read.All']).fetch });
    expect(await missing.status()).toEqual({ state: 'permission', sender: options.sender });
    const refused = new GraphMailer({ ...options, fetch: fakeFetch([], 202, 401).fetch });
    expect((await refused.status()).state).toBe('refused');
    const down = new GraphMailer({
      ...options,
      fetch: (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch,
    });
    expect((await down.status()).state).toBe('unreachable');
  });

  it('sends plain text from the sender mailbox without keeping a copy', async () => {
    const fake = fakeFetch(['Mail.Send']);
    await new GraphMailer({ ...options, fetch: fake.fetch }).send({
      to: ['a@exemple.invalid'],
      subject: 'Sujet',
      text: 'Corps',
    });
    const graph = fake.calls[1]!;
    expect(graph.url).toBe(
      'https://graph.microsoft.com/v1.0/users/sauvegardes%40exemple.invalid/sendMail',
    );
    expect(JSON.parse(String(graph.init.body))).toEqual({
      message: {
        subject: 'Sujet',
        body: { contentType: 'Text', content: 'Corps' },
        toRecipients: [{ emailAddress: { address: 'a@exemple.invalid' } }],
      },
      saveToSentItems: false,
    });
    expect(String(fake.calls[0]!.init.body)).toContain('grant_type=client_credentials');
  });

  it('turns a Graph refusal into a code, never a Microsoft message', async () => {
    const mailer = new GraphMailer({ ...options, fetch: fakeFetch(['Mail.Send'], 403).fetch });
    await expect(
      mailer.send({ to: ['a@exemple.invalid'], subject: 's', text: 't' }),
    ).rejects.toEqual(new MailSendError('permission'));
    const broken = new GraphMailer({ ...options, fetch: fakeFetch(['Mail.Send'], 500).fetch });
    await expect(
      broken.send({ to: ['a@exemple.invalid'], subject: 's', text: 't' }),
    ).rejects.toEqual(new MailSendError('graph_500'));
  });
});

describe('report sender and token roles', () => {
  it('accepts an address, nothing, or refuses with the variable name only', () => {
    expect(parseReportSender(undefined)).toBeUndefined();
    expect(parseReportSender(' sauvegardes@exemple.invalid ')).toBe('sauvegardes@exemple.invalid');
    expect(() => parseReportSender('Nom <a@b.c>')).toThrow(/^BACKUP365_REPORT_SENDER invalide/u);
  });

  it('reads no role from an unreadable token', () => {
    expect(tokenRoles('pas-un-jeton')).toEqual([]);
    expect(tokenRoles(tokenWith(['Mail.Send']))).toEqual(['Mail.Send']);
  });
});
