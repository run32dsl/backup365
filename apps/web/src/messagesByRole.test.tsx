import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { API_ERRORS, apiErrorFor, problemMessage } from './apiError.js';
import { ConfigurationLink } from './ConfigurationBlock.js';
import { FailureAlert } from './FailureAlert.js';
import { RestoreUnavailable } from './MailPage.js';
import { RunBlocked } from './PlansPage.js';
import { RestoreNotConfigured } from './RestoreAction.js';
import { AdminProvider } from './role.js';
import { StorageUnavailable } from './StorageUnavailable.js';

const ASK = 'Prévenez un administrateur';
const RESERVED = '(réservé aux administrateurs)';

const asAdmin = (node: ReactNode) =>
  renderToStaticMarkup(<AdminProvider value={true}>{node}</AdminProvider>);

describe('apiErrorFor', () => {
  it.each([
    'backup_not_configured',
    'restore_unavailable',
    'catalog_unavailable',
    'plans_unavailable',
    'scheduler_unavailable',
  ])('%s: the administrator is not told to warn an administrator', (code) => {
    expect(apiErrorFor(code, true)).not.toContain(ASK);
    expect(apiErrorFor(code, true)).not.toBe(API_ERRORS[code]);
    expect(apiErrorFor(code, false)).toBe(API_ERRORS[code]);
    expect(apiErrorFor(code, false)).toContain(ASK);
  });

  it('leaves other codes unchanged and unknown codes undefined', () => {
    expect(apiErrorFor('index_unavailable', true)).toBe(API_ERRORS['index_unavailable']);
    expect(apiErrorFor('inconnu', true)).toBeUndefined();
  });

  it('replaces the standard message of a known code for an administrator', () => {
    const standard = { message: API_ERRORS['plans_unavailable'] ?? '', code: 'plans_unavailable' };
    expect(problemMessage(standard, true)).toBe(apiErrorFor('plans_unavailable', true));
    expect(problemMessage(standard, false)).toBe(standard.message);
    expect(asAdmin(<FailureAlert problem={standard} />)).not.toContain(ASK);
    expect(renderToStaticMarkup(<FailureAlert problem={standard} />)).toContain(ASK);
  });

  it('shows the steps link for restore_unavailable, for an administrator only', () => {
    expect(asAdmin(<RestoreUnavailable />)).toContain('étapes de configuration');
    expect(renderToStaticMarkup(<RestoreUnavailable />)).not.toContain('href=');
    expect(asAdmin(<RestoreNotConfigured id="x" />)).not.toContain(ASK);
    expect(renderToStaticMarkup(<RestoreNotConfigured id="x" />)).toContain(ASK);
  });

  it('keeps a message specific to a screen', () => {
    expect(problemMessage({ message: 'Texte propre', code: 'plans_unavailable' }, true)).toBe(
      'Texte propre',
    );
  });
});

describe('messages by role', () => {
  it('ConfigurationLink: the steps link alone for an administrator, with the restriction for an operator', () => {
    const admin = asAdmin(<ConfigurationLink />);
    expect(admin).toContain('Voir les étapes de configuration sur la page d’accueil');
    expect(admin).not.toContain(RESERVED);
    expect(renderToStaticMarkup(<ConfigurationLink />)).toContain(RESERVED);
  });

  it('RunBlocked: no « Prévenez un administrateur » for an administrator', () => {
    const problem = {
      message: API_ERRORS['backup_not_configured'] ?? '',
      code: 'backup_not_configured',
    };
    const node = (
      <RunBlocked problem={problem} planName="Plan" reason="Test" onClose={() => undefined} />
    );
    const admin = asAdmin(node);
    expect(admin).toContain('La console n’est pas encore reliée à Microsoft 365.');
    expect(admin).not.toContain(ASK);
    expect(admin).not.toContain(RESERVED);
    const operator = renderToStaticMarkup(node);
    expect(operator).toContain(ASK);
    expect(operator).toContain(RESERVED);
  });

  it('StorageUnavailable: split by role', () => {
    const node = <StorageUnavailable onRetry={() => undefined} />;
    const admin = asAdmin(node);
    expect(admin).not.toContain(ASK);
    expect(admin).toContain('prévenez l’exploitant du serveur');
    expect(renderToStaticMarkup(node)).toContain(ASK);
  });
});
