import { readFileSync } from 'node:fs';
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

  it('keeps aria-disabled on a primary button so the greyed rendering applies', () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" aria-disabled="true">
        Terminer
      </Button>,
    );
    expect(html).toContain('class="btn btn-primary"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('aria-busy');
    const css = readFileSync(new URL('../charte.css', import.meta.url), 'utf8');
    const rule = /\.btn\[aria-disabled='true'\]:not\(\[aria-busy='true'\]\)[^{]*\{([^}]*)\}/.exec(
      css,
    );
    expect(rule?.[1]).toMatch(/background:\s*transparent/);
  });

  it('greys disabled and aria-disabled buttons with one single rule, busy excluded', () => {
    const css = readFileSync(new URL('../charte.css', import.meta.url), 'utf8');
    const selectors = [...css.matchAll(/([^{}]+)\{[^}]*\}/g)]
      .map((m) => m[1]?.replace(/\/\*[\s\S]*?\*\//g, '').trim() ?? '')
      .filter((s) => /button:disabled|\.btn:disabled|\.btn\[aria-disabled/.test(s));
    expect(selectors).toEqual([
      "button:disabled,\n.btn:disabled,\n.btn[aria-disabled='true']:not([aria-busy='true'])",
    ]);
    const body = /\.btn\[aria-disabled='true'\]:not\(\[aria-busy='true'\]\)\s*\{([^}]*)\}/.exec(
      css,
    );
    expect(body?.[1]).toMatch(/color:\s*var\(--muted\)/);
    expect(body?.[1]).toMatch(/border-color:\s*var\(--border\)/);
    expect(body?.[1]).toMatch(/opacity:\s*0\.6/);
    expect(body?.[1]).toMatch(/cursor:\s*not-allowed/);
    expect(css).not.toContain('is-inactive');
    expect(renderToStaticMarkup(<Button disabled>Désactivé</Button>)).toContain(
      'class="btn btn-primary"',
    );
    const focusable = renderToStaticMarkup(
      <Button aria-disabled aria-describedby="why">
        Modifier le rôle
      </Button>,
    );
    expect(focusable).toContain('class="btn btn-primary"');
    expect(focusable).toContain('aria-disabled="true"');
    expect(focusable).toContain('aria-describedby="why"');
    expect(focusable).not.toMatch(/\sdisabled(=|>|\s)/);
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
