import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HealthView } from './Home.js';
import { fetchHealth } from './health.js';

describe('HealthView', () => {
  it('shows the server status and version', () => {
    const html = renderToString(<HealthView state={{ status: 'ok', version: '1.0.0' }} />);
    expect(html).toContain('ok');
    expect(html).toContain('1.0.0');
  });

  it('shows an error when the server is unreachable', () => {
    expect(renderToString(<HealthView state="error" />)).toContain('injoignable');
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
