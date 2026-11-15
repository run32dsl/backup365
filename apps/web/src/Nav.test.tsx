import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ForbiddenView, navEntries } from './App.js';

describe('skip link target', () => {
  it('renders the screen main as a focusable target', () => {
    expect(renderToString(<ForbiddenView />)).toContain('<main tabindex="-1"');
  });
});

describe('navEntries', () => {
  it('lists only delivered screens, with Administration for admins only', () => {
    expect(navEntries('home', false).map((e) => e.label)).toEqual([
      'Tableau de bord',
      'Rechercher et restaurer',
      'Journal d’audit',
    ]);
    const admin = navEntries('home', true).map((e) => e.label);
    expect(admin).toHaveLength(4);
    expect(admin.at(-1)).toBe('Administration');
  });

  it('marks exactly one entry as current, the search entry for a mail sheet', () => {
    const current = navEntries('mail', true).filter((e) => e.current);
    expect(current.map((e) => e.href)).toEqual(['#/search']);
  });
});
