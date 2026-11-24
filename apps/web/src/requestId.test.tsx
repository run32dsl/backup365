import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createAccount, fetchAccounts, resetPassword } from './accounts.js';
import { requestIdOf } from './apiError.js';
import { AccountsView, CreateAccountForm } from './AccountsPage.js';
import { createPlan, emptyForm, fetchPlans } from './plans.js';
import { PlanFailure, PlansListView, RunBlocked, RunFeedback, isRunBlocked } from './PlansPage.js';

const failing = (): typeof fetch =>
  (() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: 'internal_error' }), {
        status: 500,
        headers: { 'x-request-id': 'req-5' },
      }),
    )) as typeof fetch;

describe('identifiant de requête des échecs', () => {
  it('is kept by a failed plan creation and a failed plan list', async () => {
    await expect(createPlan(emptyForm(), failing())).resolves.toMatchObject({
      ok: false,
      requestId: 'req-5',
    });
    const err = await fetchPlans(failing()).catch((e: unknown) => e);
    expect(requestIdOf(err)).toBe('req-5');
    expect(requestIdOf(new Error('x'))).toBeUndefined();
  });

  it('is kept by failed account actions and a failed accounts list', async () => {
    await expect(createAccount('a', 'b', 'operator', failing())).resolves.toMatchObject({
      ok: false,
      requestId: 'req-5',
    });
    await expect(resetPassword(1, 'motif', failing())).resolves.toMatchObject({
      ok: false,
      requestId: 'req-5',
    });
    const err = await fetchAccounts(failing()).catch((e: unknown) => e);
    expect(requestIdOf(err)).toBe('req-5');
  });

  it('is shown on the plan list, the accounts screen and the creation form', () => {
    const plans = renderToStaticMarkup(
      <PlansListView
        state="error"
        admin
        configured
        onRetry={() => undefined}
        onRun={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(plans).not.toContain('req-5');
    expect(plans).not.toContain('Identifiant de requête');
    expect(renderToStaticMarkup(<AccountsView state="error" loadRequestId="req-6" />)).toContain(
      '<code>req-6</code>',
    );
    const action = renderToStaticMarkup(
      <AccountsView state={[]} message={{ kind: 'error', text: 'Échec', requestId: 'req-7' }} />,
    );
    expect(action).toContain('<code>req-7</code>');
    const form = renderToStaticMarkup(
      <CreateAccountForm error={{ message: 'Échec', requestId: 'req-8' }} />,
    );
    expect(form).toContain('<code>req-8</code>');
  });

  it('is not shown by plan actions, which keep only the message', () => {
    const html = renderToStaticMarkup(
      <PlanFailure problem={{ message: 'Échec', code: 'internal_error', requestId: 'req-9' }} />,
    );
    expect(html).toContain('Échec');
    expect(html).not.toContain('req-9');
    expect(html).not.toContain('Identifiant de requête');
  });

  it('repeats a 120-character reason as typed in the summary', () => {
    const reason = 'r'.repeat(120);
    const html = renderToStaticMarkup(
      <RunBlocked
        problem={{ message: 'Sauvegarde indisponible', code: 'backup_not_configured' }}
        planName="Messagerie Direction"
        reason={reason}
        onClose={() => undefined}
      />,
    );
    expect(html).toContain(reason);
  });

  it('replaces the reason form with the result when the console is not linked', () => {
    const html = renderToStaticMarkup(
      <RunBlocked
        problem={{ message: 'Sauvegarde indisponible', code: 'backup_not_configured' }}
        planName="Messagerie Direction"
        reason="Contrôle de conformité"
        onClose={() => undefined}
      />,
    );
    expect(html).toContain('alert-warning');
    expect(html).toContain('Sauvegarde indisponible');
    expect(html).toMatch(/Plan<[\s\S]*Messagerie Direction/);
    expect(html).toMatch(/Motif<[\s\S]*Contrôle de conformité/);
    expect(html).toContain('Aucune sauvegarde n’a été lancée.');
    expect(html).toContain('Fermer');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('Lancer la sauvegarde');
    expect(html).not.toContain('Annuler');
    expect(isRunBlocked({ message: 'x', code: 'backup_not_configured' })).toBe(true);
    expect(isRunBlocked({ message: 'x', code: 'internal_error' })).toBe(false);
  });

  it('keeps the form buttons for a failure that can be retried', () => {
    const other = renderToStaticMarkup(
      <RunFeedback
        problem={{ message: 'x', code: 'internal_error' }}
        busy={false}
        onClose={() => undefined}
      />,
    );
    expect(other).toContain('alert-error');
    expect(other).toContain('Annuler');
    expect(other).toContain('Lancer la sauvegarde');
  });
});
