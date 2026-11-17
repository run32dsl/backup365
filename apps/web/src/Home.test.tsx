import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsoleFooter } from './ConsoleFooter.js';
import { Home } from './Home.js';
import { fetchHealth } from './health.js';

describe('Home', () => {
  it('no longer shows the technical server line', () => {
    const html = renderToString(<Home />);
    expect(html).toContain('Tableau de bord');
    expect(html).not.toContain('Serveur');
  });
});

describe('ConsoleFooter', () => {
  it('shows the server version', () => {
    expect(renderToStaticMarkup(<ConsoleFooter version="1.4.2" demo={false} />)).toContain(
      'Version 1.4.2',
    );
  });

  it('links to the components page in demo mode only', () => {
    const demo = renderToStaticMarkup(<ConsoleFooter version="1.4.2" demo />);
    expect(demo).toContain('href="#/composants"');
    expect(demo).toContain(
      '<span class="console-footer-item console-footer-link"><a href="#/composants">Composants</a> (démo seulement)</span>',
    );
    expect(renderToStaticMarkup(<ConsoleFooter version="1.4.2" demo={false} />)).not.toContain(
      'Composants',
    );
  });

  it('renders nothing before the version is known', () => {
    expect(renderToStaticMarkup(<ConsoleFooter demo={false} />)).toBe('');
  });
});

describe('fetchHealth', () => {
  it('parses the health response', async () => {
    const fake = (() =>
      Promise.resolve(Response.json({ status: 'ok', version: '2.0.0' }))) as typeof fetch;
    await expect(fetchHealth(fake)).resolves.toEqual({ status: 'ok', version: '2.0.0' });
  });

  it('rejects on a non-2xx response', async () => {
    const fake = (() => Promise.resolve(new Response('', { status: 500 }))) as typeof fetch;
    await expect(fetchHealth(fake)).rejects.toThrow('HTTP 500');
  });
});
