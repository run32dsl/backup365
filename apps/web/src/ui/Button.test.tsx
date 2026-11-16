import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Button, guardClick } from './Button.js';

describe('Button', () => {
  it('is a native button of type button, primary by default', () => {
    const html = renderToStaticMarkup(<Button>Enregistrer</Button>);
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('btn-primary');
    expect(html).not.toContain('aria-busy');
  });

  it('offers secondary and danger variants and keeps a submit type', () => {
    expect(renderToStaticMarkup(<Button variant="secondary">Annuler</Button>)).toContain(
      'btn-secondary',
    );
    expect(renderToStaticMarkup(<Button variant="danger">Supprimer</Button>)).toContain(
      'btn-danger',
    );
    expect(renderToStaticMarkup(<Button type="submit">Ok</Button>)).toContain('type="submit"');
  });

  it('busy sets aria-busy and aria-disabled without removing the focus (no disabled)', () => {
    const html = renderToStaticMarkup(<Button busy>Enregistrement…</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/\sdisabled(=|>|\s)/);
    expect(html).toContain('Enregistrement…');
  });

  it('keeps the native disabled state for a disabled button', () => {
    expect(renderToStaticMarkup(<Button disabled>Désactivé</Button>)).toMatch(/\sdisabled/);
  });
});

describe('guardClick', () => {
  it('ignores the click while busy', () => {
    const handler = vi.fn();
    const preventDefault = vi.fn();
    guardClick(true, handler)({ preventDefault });
    expect(handler).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });

  it('forwards the click when idle', () => {
    const handler = vi.fn();
    const event = { preventDefault: vi.fn() };
    guardClick(false, handler)(event);
    expect(handler).toHaveBeenCalledWith(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
