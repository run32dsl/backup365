import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createAccount, fetchAccounts, resetPassword } from './accounts.js';
import { requestIdOf } from './apiError.js';
import { AccountsView, CreateAccountForm } from './AccountsPage.js';
import { createPlan, emptyForm, fetchPlans } from './plans.js';
import { PlansListView } from './PlansPage.js';

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
        loadRequestId="req-5"
        onRetry={() => undefined}
        onRun={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(plans).toContain('<code>req-5</code>');
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
});
