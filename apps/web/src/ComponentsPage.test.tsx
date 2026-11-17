import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { screenFor, screenOf } from './App.js';
import { demoOf } from './DemoBanner.js';
import { ComponentsPage, SECTIONS, UnavailableView, goToSection } from './ComponentsPage.js';

describe('#/composants', () => {
  it('exists in demo mode only, for any role', () => {
    expect(screenOf('#/composants')).toBe('components');
    expect(screenFor('#/composants', true, true)).toBe('components');
    expect(screenFor('#/composants', false, true)).toBe('components');
    expect(screenFor('#/composants', true, false)).toBe('unavailable');
    expect(screenFor('#/composants', true)).toBe('unavailable');
  });

  it('shows nothing until the server has said whether it is in demo mode', () => {
    expect(screenFor('#/composants', true, null)).toBe('pending');
    expect(screenFor('#/comptes', true, null)).toBe('accounts');
  });

  it('keeps the page unavailable when the health request failed', () => {
    expect(demoOf('failed')).toBe(false);
    expect(demoOf(null)).toBeNull();
    expect(screenFor('#/composants', true, demoOf('failed'))).toBe('unavailable');
  });

  it('shows the page unavailable outside demo mode, with a way home', () => {
    const html = renderToString(<UnavailableView />);
    expect(html).toContain('Page non disponible');
    expect(html).toContain('href="#/"');
  });

  it('shows every component with a table of contents of anchor links', () => {
    const html = renderToString(<ComponentsPage />);
    expect(html).toContain('<h1>Composants</h1>');
    expect(html).toContain('aria-label="Sommaire"');
    for (const s of SECTIONS) {
      expect(html).toContain(`id="${s.id}"`);
      expect(html).toContain(`>${s.title}</h2>`);
    }
    expect(html).toContain('Ouvrir l’exemple de dialogue');
    expect(html).toContain('Étape 1 sur 3 : Choisir');
    expect(html).toContain('Information : la sauvegarde de ce soir démarrera à 22 h.');
    expect(html).toContain('Motif de l’export (obligatoire)');
    expect(html).toContain('Indiquez un motif pour continuer.');
    expect(html).not.toContain('/ 200');
    expect(html).toContain('aria-busy="true"');
  });

  it('keeps the dialog closed until the trigger is used', () => {
    expect(renderToString(<ComponentsPage />)).not.toContain('role="dialog"');
  });
});

describe('goToSection', () => {
  it('scrolls to the section and focuses it without changing the URL hash', () => {
    const section = { scrollIntoView: vi.fn(), focus: vi.fn() };
    const e = { preventDefault: vi.fn() };
    goToSection(e, 'tableau', { getElementById: () => section });
    expect(e.preventDefault).toHaveBeenCalled();
    expect(section.scrollIntoView).toHaveBeenCalled();
    expect(section.focus).toHaveBeenCalled();
  });
});
