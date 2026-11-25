import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConfigurationLink, ConfigurationNotice, connectionLine } from './ConfigurationBlock.js';
import { FailureAlert } from './FailureAlert.js';
import { Home, OverviewView } from './Home.js';
import { PlanFailure, RunBlocked } from './PlansPage.js';
import { fetchConfiguration } from './configuration.js';

const NOT_CONFIGURED = { message: 'Sauvegarde indisponible', code: 'backup_not_configured' };
const unlinked = { microsoft: { connected: false }, workloads: ['mail', 'onedrive'] };
const linked = { microsoft: { connected: true }, workloads: ['mail', 'onedrive', 'sharepoint'] };
const operational = {
  state: 'operational' as const,
  plans: { total: 2, operational: 2, running: 0, queued: 0, failed: 0, late: 0 },
  lastBackupAt: '2026-11-18T14:02:00Z',
  lastBackupPlan: 'Boîtes mail, quotidien',
  lastFailure: null,
  lateBackups: [],
};

describe('Home without configuration block', () => {
  it('has no «\u202FConfiguration\u202F» title nor loose paragraph, for an administrator', () => {
    const html = renderToStaticMarkup(<Home admin />);
    expect(html).not.toContain('Configuration');
    expect(html).not.toContain('Lecture seule');
    expect(html).not.toContain('Charges configurées');
  });

  it('is unchanged for a non-administrator', () => {
    expect(renderToStaticMarkup(<Home />)).not.toContain('Configuration');
  });
});

describe('connectionLine', () => {
  it('gives one line for the Backup card once connected', () => {
    expect(connectionLine(linked)).toBe(
      'Microsoft 365 connecté · Messagerie, OneDrive, SharePoint',
    );
  });

  it('says so when no workload is configured', () => {
    expect(connectionLine({ ...linked, workloads: [] })).toBe(
      'Microsoft 365 connecté · aucune charge',
    );
  });

  it('is empty while loading, on error and when not connected', () => {
    expect(connectionLine('loading')).toBeNull();
    expect(connectionLine('error')).toBeNull();
    expect(connectionLine(unlinked)).toBeNull();
  });

  it('shows in the Backup card, before the Plans card', () => {
    const html = renderToStaticMarkup(
      <OverviewView
        state={operational}
        admin
        onRetry={() => undefined}
        connection={connectionLine(linked)}
      />,
    );
    expect(html).toContain('Microsoft 365 connecté · Messagerie, OneDrive, SharePoint');
    expect(html.indexOf('connecté')).toBeLessThan(html.indexOf('overview-plans'));
  });
});

describe('ConfigurationNotice', () => {
  it('is a titled warning with the three numbered steps in <code>', () => {
    const html = renderToStaticMarkup(<ConfigurationNotice config={unlinked} />);
    expect(html).toContain('alert-warning');
    expect(html).toContain('role="status"');
    expect(html).toContain('Connexion Microsoft 365 à configurer');
    expect(html).toContain('Les identifiants se renseignent sur le serveur, pas dans la console.');
    expect(html).toContain('<code>.env</code>');
    expect(html).toContain('<code>secrets/m365_client_secret</code>');
    expect(html).toContain('<code>docker compose up -d</code>');
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain('<ol');
    expect(html).not.toContain('Non configurée');
  });

  it('renders nothing once connected, nor while loading', () => {
    expect(renderToStaticMarkup(<ConfigurationNotice config={linked} />)).toBe('');
    expect(renderToStaticMarkup(<ConfigurationNotice config="loading" />)).toBe('');
  });

  it('renders no input, button or form, and no identifier', () => {
    const html = renderToStaticMarkup(<ConfigurationNotice config={unlinked} />);
    expect(html).not.toMatch(/<(input|textarea|select|button|form)\b/u);
    expect(html).not.toMatch(/tenant|client[_ ]?id|[0-9a-f]{8}-[0-9a-f]{4}-/iu);
  });

  it('shows an alert when the configuration cannot be read', () => {
    const html = renderToStaticMarkup(<ConfigurationNotice config="error" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Configuration indisponible');
  });
});

describe('fetchConfiguration', () => {
  it('sends a single GET request and nothing else', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({ microsoft: { connected: true }, workloads: [] }),
    );
    await fetchConfiguration(fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/configuration');
  });

  it('fails on a refusal', async () => {
    const fetchFn = async () => new Response('{}', { status: 403 });
    await expect(fetchConfiguration(fetchFn)).rejects.toMatchObject({ status: 403 });
  });
});

describe('backup_not_configured messages', () => {
  it('link the OneDrive message to the home page notice', () => {
    const html = renderToStaticMarkup(<FailureAlert problem={NOT_CONFIGURED} />);
    expect(html).toContain('<a href="#/">Voir les étapes sur la page d’accueil</a>');
    expect(html).not.toContain('docs/');
  });

  it('link the plans message to the home page notice', () => {
    expect(renderToStaticMarkup(<PlanFailure problem={NOT_CONFIGURED} />)).toContain('href="#/"');
    const blocked = renderToStaticMarkup(
      <RunBlocked
        problem={NOT_CONFIGURED}
        planName="Plan"
        reason="Test"
        onClose={() => undefined}
      />,
    );
    expect(blocked).toContain('href="#/"');
  });

  it('do not add the link to other errors', () => {
    const other = { message: 'Erreur', code: 'internal_error' };
    expect(renderToStaticMarkup(<FailureAlert problem={other} />)).not.toContain('href=');
    expect(renderToStaticMarkup(<PlanFailure problem={other} />)).not.toContain('href=');
    expect(renderToStaticMarkup(<ConfigurationLink />)).toContain('administrateurs');
  });
});
