import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('colonne Expéditeur nowrap', () => {
  it('ne force la ligne unique que dans le tableau, pas dans les cartes sous 900 px', () => {
    const css = readFileSync(new URL('./charte.css', import.meta.url), 'utf8');
    const base = css.indexOf('.data-table td.address.nowrap {');
    const table = css.indexOf('.data-table td.address.nowrap:not(:has(.addr-long)) {');
    expect(base).toBeGreaterThan(-1);
    expect(base).toBeLessThan(table);
    // La règle « normal » précède l'ouverture de la media query du bureau qui contient le nowrap.
    expect(css.lastIndexOf('@media (min-width', table)).toBeGreaterThan(base);
    expect(css.slice(base, base + 120)).toContain('white-space: normal');
  });
});
