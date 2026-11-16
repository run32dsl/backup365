import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEMO_BANNER_TEXT, DemoBanner } from './DemoBanner.js';

describe('DemoBanner', () => {
  it('affiche le bandeau en mode démo', () => {
    expect(renderToStaticMarkup(<DemoBanner demo />)).toContain(DEMO_BANNER_TEXT);
  });
  it('ne montre rien hors mode démo', () => {
    expect(renderToStaticMarkup(<DemoBanner demo={false} />)).toBe('');
  });
});
