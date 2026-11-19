import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusPage } from './StatusPage.js';

describe('StatusPage', () => {
  it('shows its title and the loading state first', () => {
    const html = renderToString(<StatusPage />);
    expect(html).toContain('<main tabindex="-1"');
    expect(html).toContain('État détaillé');
    expect(html).toContain('Chargement de l’état des sauvegardes');
  });
});
