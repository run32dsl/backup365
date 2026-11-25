import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AccountChangeForm, changeDone, changeTitle, type AccountChange } from './AccountChange.js';
import { AccountsView } from './AccountsPage.js';
import { updateAccount } from './accounts.js';

const account = (id: number, username: string, role: 'admin' | 'operator') => ({
  id,
  username,
  role,
  disabled: false,
  mustChangePassword: false,
  createdAt: '',
});
const operator: AccountChange = {
  id: 2,
  kind: 'role',
  username: 'operateur-demo',
  role: 'operator',
};

describe('account table', () => {
  const html = renderToString(
    <AccountsView
      state={[account(1, 'root', 'admin'), account(2, 'operateur-demo', 'operator')]}
    />,
  );
  it('shows the role as text, on every row, and three outlined buttons', () => {
    expect(html).not.toContain('<select');
    expect(html).toMatch(/data-label="Rôle"[^>]*>Opérateur</);
    expect(html).toMatch(/data-label="Rôle"[^>]*>Administrateur</);
    expect(html.match(/btn-secondary[^>]*>Modifier le rôle</g)).toHaveLength(2);
    expect(html.match(/btn-danger[^>]*>Désactiver</g)).toHaveLength(2);
    expect(html).toContain('aria-label="Modifier le rôle : operateur-demo"');
  });
  it('greys both buttons of the last administrator and explains why', () => {
    const last = html.match(/<td[^>]*data-label="Actions"[^>]*>(.*?)<\/td>/g) ?? [];
    expect(last[0]!.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(last[0]).toContain('ni désactivé ni rétrogradé');
    expect(last[1]).not.toContain('aria-disabled');
  });
});

describe('AccountChangeForm', () => {
  it('names the account and asks for a mandatory reason with a counter, for a role change', () => {
    const html = renderToString(<AccountChangeForm change={operator} role="operator" />);
    expect(changeTitle(operator)).toBe('Modifier le rôle');
    expect(html).toContain('<dt>Compte</dt><dd>operateur-demo</dd>');
    expect(html.match(/operateur-demo/g)).toHaveLength(1);
    expect(html).toContain('Administrateur : gère les comptes');
    expect(html).toContain('Opérateur : consulte');
    expect(html).toContain('Motif du changement de rôle (obligatoire)');
    expect(html).toContain('Ce motif sera inscrit au journal d’audit');
    expect(html).toContain('field-counter');
    expect(html).toContain('Annuler');
    expect(html).toContain('Enregistrer');
  });
  it('states the consequence of a deactivation', () => {
    const change = { ...operator, kind: 'disable' as const };
    const html = renderToString(<AccountChangeForm change={change} role="operator" />);
    expect(changeTitle(change)).toBe('Désactiver ce compte\u202F?');
    expect(html.replaceAll('<!-- -->', '')).toContain('Ce compte ne pourra plus se connecter');
    expect(html).toContain('Motif de la désactivation (obligatoire)');
    expect(html).not.toContain('type="radio"');
    expect(html).toMatch(/btn btn-danger[^>]*>Désactiver<\/button>/);
    expect(html).not.toContain('btn-primary');
  });
  it('names the account in the success message', () => {
    expect(changeDone(operator, 'admin')).toBe('Rôle de operateur-demo : Administrateur.');
    expect(changeDone({ ...operator, kind: 'disable' }, 'operator')).toBe(
      'operateur-demo est désactivé.',
    );
  });
});

describe('updateAccount', () => {
  it('sends the reason with the change', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})));
    await updateAccount(2, { role: 'admin', reason: 'Congés' }, fetchFn);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('/api/accounts/2');
    expect(JSON.parse(init!.body as string)).toEqual({ role: 'admin', reason: 'Congés' });
  });
});
