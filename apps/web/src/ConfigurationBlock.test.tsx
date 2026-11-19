import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConfigurationLink, ConfigurationState, ConfigurationView } from './ConfigurationBlock.js';
import { FailureAlert } from './FailureAlert.js';
import { Home } from './Home.js';
import { PlanFailure, RunBlocked } from './PlansPage.js';
import { fetchConfiguration } from './configuration.js';

const NOT_CONFIGURED = { message: 'Sauvegarde indisponible', code: 'backup_not_configured' };

describe('Home configuration block', () => {
  it('is present for an administrator', () => {
    const html = renderToStaticMarkup(<Home admin />);
    expect(html).toContain('<h2 id="configuration-title">Configuration</h2>');
  });

  it('is absent for a non-administrator', () => {
    expect(renderToStaticMarkup(<Home />)).not.toContain('Configuration');
    expect(renderToStaticMarkup(<Home admin={false} />)).not.toContain('Configuration');
  });
});

describe('ConfigurationView', () => {
  const unlinked = { microsoft: { connected: false }, workloads: ['mail', 'onedrive'] };

  it('shows the connection, the workloads and the server steps', () => {
    const html = renderToStaticMarkup(<ConfigurationView config={unlinked} />);
    expect(html).toContain('Non configurée');
    expect(html).toContain('Messagerie, OneDrive');
    expect(html).toContain('secrets/m365_client_secret');
  });

  it('drops the steps once connected', () => {
    const html = renderToStaticMarkup(
      <ConfigurationView config={{ ...unlinked, microsoft: { connected: true } }} />,
    );
    expect(html).toContain('Connectée');
    expect(html).not.toContain('Étapes à suivre');
  });

  it('renders no input, button or form, and no identifier', () => {
    const html = renderToStaticMarkup(<ConfigurationView config={unlinked} />);
    expect(html).not.toMatch(/<(input|textarea|select|button|form)\b/u);
    expect(html).not.toMatch(/tenant|client[_ ]?id|[0-9a-f]{8}-[0-9a-f]{4}-/iu);
  });
});

describe('ConfigurationState', () => {
  it('shows an alert when the configuration cannot be read', () => {
    const html = renderToStaticMarkup(<ConfigurationState config="error" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Configuration indisponible');
  });

  it('shows a loading text first', () => {
    expect(renderToStaticMarkup(<ConfigurationState config="loading" />)).toContain('Chargement');
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
  it('link the OneDrive message to the home page block', () => {
    const html = renderToStaticMarkup(<FailureAlert problem={NOT_CONFIGURED} />);
    expect(html).toContain('<a href="#/">Voir le bloc « Configuration » de la page d’accueil</a>');
    expect(html).not.toContain('docs/');
  });

  it('link the plans message to the home page block', () => {
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
