import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Console, ForbiddenView, screenFor, screenOf } from './App.js';
import { AccountsPage, AccountsView } from './AccountsPage.js';
import { AuditPage } from './AuditPage.js';
import { CredentialsView, ErrorView, Field, PasswordView } from './LoginPage.js';
import { createAccount, isLastAdmin, resetPassword } from './accounts.js';
import { Button, DataTable } from './ui/index.js';
import {
  ADMIN_ONLY,
  RETRY_NOW,
  formatCountdown,
  lockedMessage,
  AUDIT_NOTICE,
  setupRecap,
  UNREACHABLE,
  LOGIN_HASH,
  authenticate,
  errorMessage,
  loadGate,
  lossMessage,
  requestedPage,
  withSession,
} from './session.js';

const reply = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));

describe('CredentialsView', () => {
  it('shows the first-start screen with a password confirmation', () => {
    const html = renderToString(<CredentialsView mode="setup" />);
    expect(html).toContain('Créer le compte administrateur');
    expect(html).toContain('name="confirm"');
    expect(html).toContain('autoComplete="new-password"');
  });

  it('shows the sober login screen, in French, with no prefilled value', () => {
    const html = renderToString(<CredentialsView mode="login" error="Nom incorrect" />);
    expect(html).toContain('Connexion');
    expect(html).toContain('Se connecter');
    expect(html).toContain('type="password"');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('value=');
    expect(html).not.toContain('name="confirm"');
  });
});

describe('PasswordView', () => {
  it('explains the forced change after a reset', () => {
    expect(renderToString(<PasswordView forced />)).toContain('temporaire');
    expect(renderToString(<PasswordView forced={false} />)).not.toContain('temporaire');
  });
});

describe('AccountsView', () => {
  const accounts = [
    {
      id: 1,
      username: 'root',
      role: 'admin' as const,
      disabled: false,
      mustChangePassword: false,
      createdAt: '',
    },
    {
      id: 2,
      username: 'bob',
      role: 'operator' as const,
      disabled: true,
      mustChangePassword: false,
      createdAt: '',
    },
  ];
  it('lists accounts with their role and state, and escapes names', () => {
    const html = renderToString(
      <AccountsView state={[...accounts, { ...accounts[0]!, id: 3, username: '<img src=x>' }]} />,
    );
    expect(html).toContain('Administrateur');
    expect(html).toContain('Désactivé');
    expect(html).toContain('Réactiver');
    expect(html).not.toContain('<img');
  });
  it('shows each account state as a badge with icon and text', () => {
    const html = renderToString(
      <AccountsView
        state={[...accounts, { ...accounts[0]!, id: 3, username: 'eve', mustChangePassword: true }]}
      />,
    );
    expect(html.replaceAll('<!-- -->', '')).toContain('<span aria-hidden="true">✔</span> Actif');
    expect(html.replaceAll('<!-- -->', '')).toContain(
      '<span aria-hidden="true">✖</span> Désactivé',
    );
    expect(html.replaceAll('<!-- -->', '')).toContain(
      '<span aria-hidden="true">⚠</span> Mot de passe à changer',
    );
  });
  it('shows loading and error states', () => {
    expect(renderToString(<AccountsView state="loading" />)).toContain('Chargement');
    expect(renderToString(<AccountsView state="error" />)).toContain('indisponibles');
    // La boîte du mot de passe temporaire survit à un rechargement en erreur ou en cours.
    for (const state of ['error', 'loading'] as const) {
      expect(renderToString(<AccountsView state={state} dialog={<p>BOITE-MDP</p>} />)).toContain(
        'BOITE-MDP',
      );
    }
  });
});

describe('screenOf', () => {
  it('knows the accounts and password screens', () => {
    expect(screenOf('#/comptes')).toBe('accounts');
    expect(screenOf('#/password')).toBe('password');
  });
});

describe('loadGate', () => {
  it('returns the session when /me answers 200', async () => {
    const fetchFn = vi.fn(() =>
      reply({ csrfToken: 't', user: { username: 'alice', role: 'operator' } }),
    ) as unknown as typeof fetch;
    await expect(loadGate(fetchFn)).resolves.toMatchObject({ status: 'ready' });
  });

  it('shows the login screen on 401, or the first-start screen when no account exists', async () => {
    const make = (needsSetup: boolean) =>
      vi.fn((url: string) =>
        url.endsWith('/me') ? reply({ error: 'unauthenticated' }, 401) : reply({ needsSetup }),
      ) as unknown as typeof fetch;
    await expect(loadGate(make(false))).resolves.toEqual({ status: 'login' });
    await expect(loadGate(make(true))).resolves.toEqual({ status: 'setup' });
  });

  it('reports an error on any other answer', async () => {
    const fetchFn = (() => reply({}, 503)) as typeof fetch;
    await expect(loadGate(fetchFn)).resolves.toEqual({ status: 'error' });
  });
});

describe('authenticate', () => {
  it('posts the credentials and returns the session', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      reply({ csrfToken: 't', user: { username: 'alice', role: 'admin' } }),
    );
    const out = await authenticate('login', 'alice', 'secret secret', fetchFn);
    expect(out).toMatchObject({ ok: true, value: { csrfToken: 't' } });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/auth/login');
    expect(init?.body).toBe(JSON.stringify({ username: 'alice', password: 'secret secret' }));
  });

  it('explains failures in French', async () => {
    const bad = (() => reply({ error: 'invalid_credentials' }, 401)) as typeof fetch;
    await expect(authenticate('login', 'a', 'b', bad)).resolves.toEqual({
      ok: false,
      message: 'Identifiant ou mot de passe incorrect.',
    });
    const locked = (() =>
      reply({ error: 'too_many_attempts', retryAfterSec: 30 }, 429)) as typeof fetch;
    const out = await authenticate('login', 'a', 'b', locked);
    expect(out).toMatchObject({
      ok: false,
      message: expect.stringContaining('30 secondes'),
      retryAfterSec: 30,
    });
  });

  it('falls back on the Retry-After header for the lock delay', async () => {
    const locked = (() =>
      Promise.resolve(
        new Response('{}', { status: 429, headers: { 'retry-after': '12' } }),
      )) as typeof fetch;
    expect(await authenticate('login', 'a', 'b', locked)).toMatchObject({ retryAfterSec: 12 });
  });
});

describe('connexion verrouillée (#56)', () => {
  it('formats the countdown as mm:ss', () => {
    expect(formatCountdown(272)).toBe('04:32');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(61.2)).toBe('01:02');
    expect(lockedMessage(272)).toBe(
      'Connexion impossible pour le moment. Nouvel essai possible dans 04:32.',
    );
  });

  it('shows the countdown, disables the button and keeps the typed fields', () => {
    const html = renderToString(
      <CredentialsView
        mode="login"
        error="Identifiant ou mot de passe incorrect."
        lockedSec={272}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('04:32');
    expect(html).toContain(
      'Connexion impossible pour le moment. Nouvel essai possible dans 04:32.',
    );
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Se connecter/);
    expect(html).not.toContain('Identifiant ou mot de passe incorrect.');
    // L'annonce périodique vit dans une région `status` distincte de l'alerte.
    expect(html).toContain('role="status"');
  });

  it('keeps the alert text fixed while the countdown runs', () => {
    const at = (left: number) =>
      renderToString(<CredentialsView mode="login" lockedSec={left} lockedStartSec={272} />);
    const sr = (html: string) => /class="sr-only">(Connexion impossible[^<]*)</.exec(html)?.[1];
    expect(sr(at(272))).toBe(sr(at(100)));
    expect(sr(at(100))).toContain('04:32');
  });

  it('is a plain login form when not locked', () => {
    const html = renderToString(<CredentialsView mode="login" announcement={RETRY_NOW} />);
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('Connexion impossible');
    expect(html).toContain('Vous pouvez réessayer.');
  });
});

describe('maquette de l’issue #22', () => {
  it('labels the login field « Identifiant », never « Nom d’utilisateur »', () => {
    for (const mode of ['login', 'setup'] as const) {
      const html = renderToString(<CredentialsView mode={mode} />);
      expect(html).toContain('Identifiant');
      expect(html).not.toContain('utilisateur');
    }
    const accounts = renderToString(<AccountsView state={[]} />);
    expect(accounts).toContain('Identifiant');
    expect(accounts).not.toContain('Nom d’utilisateur');
  });

  it('offers Afficher / Masquer on password fields only', () => {
    const hidden = renderToString(
      <Field label="Mot de passe" name="password" type="password" autoComplete="off" />,
    );
    expect(hidden).toContain('type="password"');
    expect(hidden).toContain('aria-pressed="false"');
    expect(hidden).toContain('Afficher');
    const shown = renderToString(
      <Field label="Mot de passe" name="password" type="password" autoComplete="off" revealed />,
    );
    expect(shown).toContain('type="text"');
    expect(shown).toContain('aria-pressed="true"');
    expect(shown).toContain('Masquer');
    const plain = renderToString(<Field label="Identifiant" name="username" autoComplete="off" />);
    expect(plain).not.toContain('Afficher');
    // Chaque mot de passe de chaque écran a son bouton.
    expect(renderToString(<CredentialsView mode="setup" />).match(/Afficher</g)).toHaveLength(2);
    expect(renderToString(<PasswordView forced />).match(/Afficher</g)).toHaveLength(3);
  });

  it('gives each lost session its message on the login screen', () => {
    expect(lossMessage('expired')).toBe(
      'Votre session a expiré. Reconnectez-vous pour revenir à la page demandée.',
    );
    expect(lossMessage('invalid')).toBe('Votre session n’est plus valide. Reconnectez-vous.');
    const html = renderToString(<CredentialsView mode="login" notice={lossMessage('expired')} />);
    expect(html).toContain(`<p role="status">${lossMessage('expired')}</p>`);
    expect(renderToString(<CredentialsView mode="login" />)).not.toContain('expiré');
  });

  it('remembers the requested page, never the login anchor itself', () => {
    expect(requestedPage('#/audit')).toBe('#/audit');
    expect(requestedPage('#/mail/boite/message')).toBe('#/mail/boite/message');
    expect(requestedPage(LOGIN_HASH)).toBeNull();
    expect(LOGIN_HASH).toBe('#/connexion');
    expect(requestedPage('')).toBeNull();
    expect(requestedPage('#autre')).toBeNull();
  });

  it('sends the typed password on creation and only a reason on reset', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => reply({ password: 'Tz7k-Qp3m-Vx9d-Lw2h' }));
    await createAccount('bob', 'un mot de passe long', 'operator', fetchFn);
    const reset = await resetPassword(2, 'Oubli', fetchFn);
    expect(reset).toEqual({ ok: true, value: 'Tz7k-Qp3m-Vx9d-Lw2h' });
    expect(fetchFn.mock.calls.map(([url, init]) => [url, init?.body])).toEqual([
      [
        '/api/accounts',
        JSON.stringify({ username: 'bob', password: 'un mot de passe long', role: 'operator' }),
      ],
      ['/api/accounts/2/reset-password', JSON.stringify({ reason: 'Oubli' })],
    ]);
  });

  it('gives the account creation form an Afficher / Masquer button', () => {
    const html = renderToString(<AccountsView state={[]} />);
    expect(html.match(/Afficher</g)).toHaveLength(1);
    expect(html).toContain('Identifiant');
  });

  it('takes the titles and buttons of the mock-up', () => {
    expect(renderToString(<CredentialsView mode="login" />)).toContain('Connexion à la console');
    const setup = renderToString(<CredentialsView mode="setup" />);
    expect(setup).toContain('>Créer le compte administrateur</button>');
    expect(setup).toContain('12 caractères minimum. Une phrase de passe convient.');
    const password = renderToString(<PasswordView forced={false} />);
    expect(password).toContain('Choisissez un nouveau mot de passe');
    expect(password).toContain('>Enregistrer et continuer</button>');
    const view = renderToString(<AccountsView state={[]} />);
    expect(view).toContain('>Nouveau compte</button>');
  });

  it('names the console in the accounts title and says the journal is audited', () => {
    expect(renderToString(<AccountsPage />)).toContain('<h1>Administration</h1>');
    expect(renderToString(<AccountsView state={[]} />)).toContain('<h2>Comptes de la console</h2>');
    for (const html of [
      renderToString(<CredentialsView mode="login" />),
      renderToString(<AccountsView state={[]} />),
    ])
      expect(html).toContain(AUDIT_NOTICE);
    expect(renderToString(<AuditPage />)).toContain(
      'La consultation de ce journal est elle-même journalisée.',
    );
    expect(UNREACHABLE).toBe('Impossible de joindre la console. Réessayez.');
  });
});

describe('textes restants de la maquette de #22', () => {
  const account = (id: number, role: 'admin' | 'operator', disabled = false) => ({
    id,
    username: `u${id}`,
    role,
    disabled,
    mustChangePassword: false,
    createdAt: '',
  });

  it('decides the screen from the anchor and the role, as a pure function', () => {
    expect(screenFor('#/comptes', true)).toBe('accounts');
    expect(screenFor('#/comptes', false)).toBe('forbidden');
    expect(screenFor('#/audit', false)).toBe('audit');
    expect(screenFor('', false)).toBe('home');
  });

  it('tells an operator that the accounts page is reserved, with a link home', () => {
    const html = renderToString(<ForbiddenView />);
    expect(html).toContain('Cette page est réservée aux administrateurs.');
    expect(html).toContain('href="#/"');
    expect(ADMIN_ONLY).toBe('Cette page est réservée aux administrateurs.');
  });

  it('shows the empty state when there is no operator', () => {
    const empty = renderToString(<AccountsView state={[account(1, 'admin')]} />);
    expect(empty).toContain('Aucun opérateur pour l’instant.');
    const some = renderToString(
      <AccountsView state={[account(1, 'admin'), account(2, 'operator')]} />,
    );
    expect(some).not.toContain('Aucun opérateur');
  });

  it('flags the last active administrator and marks its actions aria-disabled', () => {
    const only = [account(1, 'admin'), account(2, 'operator')];
    expect(isLastAdmin(only, only[0]!)).toBe(true);
    expect(isLastAdmin(only, only[1]!)).toBe(false);
    const html = renderToString(<AccountsView state={only} />);
    expect(html).toContain('Dernier administrateur : ce compte ne peut pas être désactivé.');
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(html.match(/aria-describedby="last-admin-1"/g)).toHaveLength(2);
    expect(html).toContain('id="last-admin-1"');
    // La mention n'est plus dans la cellule « Actions ».
    const cells = [...html.matchAll(/<td[^>]*data-label="Actions"[^>]*>(.*?)<\/td>/g)].map(
      (m) => m[1],
    );
    expect(cells).toHaveLength(2);
    expect(cells.join()).not.toContain('Dernier administrateur');
    const two = [account(1, 'admin'), account(2, 'admin'), account(3, 'admin', true)];
    expect(isLastAdmin(two, two[0]!)).toBe(false);
    expect(renderToString(<AccountsView state={two} />)).not.toContain('Dernier administrateur');
    // Un administrateur désactivé ne compte pas : l'autre est le dernier.
    const left = [account(1, 'admin'), account(2, 'admin', true)];
    expect(isLastAdmin(left, left[0]!)).toBe(true);
  });

  it('describes each role in the create form', () => {
    const html = renderToString(<AccountsView state={[]} />);
    expect(html).toContain('gère les comptes, les plans et les restaurations.');
    expect(html).toContain('consulte, exporte et restaure, avec un motif.');
  });

  it('recaps the first start inside the form, before the validation', () => {
    expect(setupRecap('root')).toBe(
      'Compte « root », rôle administrateur. Ses actions sont inscrites au journal d’audit.',
    );
    expect(setupRecap('')).toBe(
      'Rôle administrateur. Ses actions sont inscrites au journal d’audit.',
    );
    const html = renderToString(<CredentialsView mode="setup" />);
    expect(html).toContain('administrateur. Ses actions sont inscrites au journal d’audit.');
    expect(html.indexOf('Ses actions sont')).toBeLessThan(html.indexOf('type="submit"'));
    expect(html).toContain(
      'Aucun compte n’existe encore. Ce compte gère les comptes, les plans et les restaurations.',
    );
    expect(renderToString(<CredentialsView mode="login" />)).not.toContain('Ses actions sont');
  });

  it('says « Mot de passe temporaire » on the account forms, never « provisoire »', () => {
    const html = renderToString(<AccountsView state={[]} />);
    expect(html).toContain('>Mot de passe temporaire (12 caractères au minimum)</label>');
    expect(html).not.toContain('provisoire');
  });

  it('shows the account menu as « identifiant (rôle) » then « Se déconnecter »', () => {
    const user = { id: 1, username: 'marie', role: 'operator' as const, mustChangePassword: false };
    vi.stubGlobal('window', { location: { hash: '' }, addEventListener: () => undefined });
    const html = renderToString(<Console user={user} onLogout={() => undefined} />);
    vi.unstubAllGlobals();
    expect(html).toContain('marie (opérateur)');
    expect(html).toContain('>Se déconnecter</button>');
  });

  it('passes the health response to the footer and shows nothing on #/composants while it is unknown', () => {
    const user = { id: 1, username: 'marie', role: 'operator' as const, mustChangePassword: false };
    const render = (hash: string, health: Parameters<typeof Console>[0]['health']) => {
      vi.stubGlobal('window', { location: { hash }, addEventListener: () => undefined });
      const html = renderToString(
        <Console user={user} onLogout={() => undefined} health={health} />,
      );
      vi.unstubAllGlobals();
      return html;
    };
    const demo = render('', { demo: true, version: '1.2.3' } as never);
    expect(demo.replaceAll('<!-- -->', '')).toContain('Version 1.2.3');
    expect(demo).toContain('Composants</a>');
    expect(render('#/composants', null)).not.toContain('Page non disponible');
    expect(render('#/composants', 'failed')).toContain('Page non disponible');
  });

  it('renders a labelled main navigation with one current entry and a closed menu', () => {
    const user = { id: 1, username: 'marie', role: 'operator' as const, mustChangePassword: false };
    vi.stubGlobal('window', { location: { hash: '' }, addEventListener: () => undefined });
    const html = renderToString(<Console user={user} onLogout={() => undefined} />);
    vi.unstubAllGlobals();
    expect(html).toContain('<nav aria-label="Navigation principale">');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="skip-link"');
  });

  it('clears an account form only when the request succeeded', async () => {
    type El = { type?: unknown; props?: { children?: unknown; [k: string]: unknown } };
    vi.stubGlobal('FormData', class {});
    const submitWith = async (result: boolean) => {
      const reset = vi.fn();
      const tree = AccountsView({
        state: [],
        actions: { onCreate: () => Promise.resolve(result) },
      });
      const forms: El[] = [];
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === 'object') {
          const el = n as El;
          if (el.type === 'form') forms.push(el);
          walk(el.props?.children);
        }
      };
      walk(tree);
      (forms[0]!.props!.onSubmit as (e: unknown) => void)({
        preventDefault: () => undefined,
        currentTarget: { reset },
      });
      await new Promise((r) => setTimeout(r, 0));
      return reset;
    };
    try {
      expect(await submitWith(false)).not.toHaveBeenCalled();
      expect(await submitWith(true)).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers Annuler on the account forms and on a voluntary password change', () => {
    expect(renderToString(<AccountsView state={[]} />).match(/>Annuler</g)).toHaveLength(1);
    expect(renderToString(<PasswordView forced={false} />)).toContain('>Annuler</button>');
    expect(renderToString(<PasswordView forced />)).not.toContain('Annuler');
  });

  it('wires the handlers: a locked account does nothing, Réessayer and Annuler call back', () => {
    type El = { type?: unknown; props?: { children?: unknown; [k: string]: unknown } };
    // Les boutons sont désormais le composant commun `Button`, et les cellules du tableau sont
    // produites par `DataTable` : le parcours les développe, les assertions restent les mêmes.
    const find = (node: unknown, match: (e: El) => boolean, out: El[] = []): El[] => {
      if (Array.isArray(node)) node.forEach((n) => find(n, match, out));
      else if (node && typeof node === 'object') {
        const el = node as El;
        if (match(el)) out.push(el);
        if (el.type === DataTable) {
          const { rows, columns } = el.props as unknown as {
            rows: unknown[];
            columns: { cell: (row: unknown) => unknown }[];
          };
          for (const row of rows) for (const c of columns) find(c.cell(row), match, out);
        }
        find(el.props?.children, match, out);
        find(el.props?.['action'], match, out);
      }
      return out;
    };
    const isButton = (e: El) => e.type === Button;
    const onDisabled = vi.fn();
    const only = [account(1, 'admin'), account(2, 'operator')];
    const tree = AccountsView({ state: only, actions: { onDisabled } });
    const disable = find(tree, (e) => isButton(e) && e.props?.['aria-disabled'] === true);
    expect(disable).toHaveLength(1);
    (disable[0]!.props!.onClick as () => void)();
    expect(onDisabled).not.toHaveBeenCalled();
    const other = find(tree, (e) => isButton(e) && e.props?.children === 'Désactiver');
    (other.find((e) => e.props?.['aria-disabled'] === undefined)!.props!.onClick as () => void)();
    expect(onDisabled).toHaveBeenCalledWith(2, true);

    const onRetry = vi.fn();
    const retry = find(ErrorView({ message: 'x', onRetry }), isButton);
    (retry[0]!.props!.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();

    const onCancel = vi.fn();
    const cancel = find(
      PasswordView({ forced: false, onCancel }),
      (e) => isButton(e) && e.props?.children === 'Annuler',
    );
    (cancel[0]!.props!.onClick as () => void)();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('offers Réessayer after a network or server error', () => {
    const html = renderToString(<ErrorView message={UNREACHABLE} />);
    expect(html).toContain('Impossible de joindre la console. Réessayez.');
    expect(html).toContain('>Réessayer</button>');
    expect(renderToString(<AccountsView state="error" />)).toContain('>Réessayer</button>');
  });
});

describe('errorMessage', () => {
  it('uses the PO wording for a taken identifier', async () => {
    const res = await reply({ error: 'username_taken' }, 409);
    expect(await errorMessage(res)).toBe('Cet identifiant est déjà utilisé.');
  });
});

describe('withSession', () => {
  it('adds the CSRF token to requests that change state, not to reads', async () => {
    const base = vi.fn<typeof fetch>(() => reply({}));
    const wrapped = withSession(
      base,
      () => 'jeton',
      () => undefined,
    );
    await wrapped('/api/x');
    await wrapped('/api/x', { method: 'POST' });
    await wrapped('/api/x', { method: 'delete' });
    const sent = base.mock.calls.map(([, init]) => new Headers(init?.headers).get('x-csrf-token'));
    expect(sent).toEqual([null, 'jeton', 'jeton']);
  });

  it('signals an expired session on a 401, except for the login routes', async () => {
    const expired = vi.fn();
    const wrapped = withSession((() => reply({}, 401)) as typeof fetch, () => null, expired);
    await wrapped('/api/audit');
    expect(expired).toHaveBeenCalledTimes(1);
    await wrapped('/api/auth/login', { method: 'POST' });
    await wrapped('/api/auth/me');
    await wrapped('/api/auth/logout', { method: 'POST' });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired).toHaveBeenCalledWith('expired');
  });

  it('signals an invalid session on a CSRF refusal, leaving the body readable', async () => {
    const lost = vi.fn();
    const refused = (() => reply({ error: 'csrf_invalid' }, 403)) as typeof fetch;
    const res = await withSession(refused, () => 'jeton', lost)('/api/x', { method: 'POST' });
    expect(lost).toHaveBeenCalledExactlyOnceWith('invalid');
    await expect(res.json()).resolves.toEqual({ error: 'csrf_invalid' });
    // Les autres refus 403 ne ferment pas la session.
    const other = (() => reply({ error: 'password_change_required' }, 403)) as typeof fetch;
    await withSession(other, () => 'jeton', lost)('/api/x', { method: 'POST' });
    expect(lost).toHaveBeenCalledTimes(1);
    // Un 403 sans corps JSON n'est pas un refus CSRF et ne casse pas la requête.
    const empty = (() => Promise.resolve(new Response('', { status: 403 }))) as typeof fetch;
    const res403 = await withSession(empty, () => 'jeton', lost)('/api/x', { method: 'POST' });
    expect(res403.status).toBe(403);
    expect(lost).toHaveBeenCalledTimes(1);
  });
});
