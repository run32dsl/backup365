import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DialogPanel } from './Dialog.js';
import { closeOnEscape, initialFocus, makeInert, trapTab } from './dialog-focus.js';

const key = (k: string, shiftKey = false) => ({ key: k, shiftKey, preventDefault: vi.fn() });
const el = () => ({ focus: vi.fn() });

describe('DialogPanel', () => {
  it('is a modal dialog labelled by its title', () => {
    const html = renderToStaticMarkup(
      <DialogPanel titleId="t" title="Exporter cette boîte ?" onClose={() => undefined}>
        <p>Corps</p>
      </DialogPanel>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="t"');
    expect(html).toContain('<h2 id="t">Exporter cette boîte ?</h2>');
    expect(html).toContain('aria-label="Fermer"');
  });
});

describe('trapTab', () => {
  it('wraps Tab from the last element to the first', () => {
    const [a, b, c] = [el(), el(), el()];
    const e = key('Tab');
    expect(trapTab(e, [a, b, c], c)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(a.focus).toHaveBeenCalled();
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    const [a, b, c] = [el(), el(), el()];
    const e = key('Tab', true);
    expect(trapTab(e, [a, b, c], a)).toBe(true);
    expect(c.focus).toHaveBeenCalled();
  });

  it('lets Tab move naturally in the middle of the box', () => {
    const [a, b, c] = [el(), el(), el()];
    const e = key('Tab');
    expect(trapTab(e, [a, b, c], b)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('brings a focus that escaped back into the box', () => {
    const [a, b] = [el(), el()];
    const e = key('Tab');
    trapTab(e, [a, b], {});
    expect(a.focus).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('keeps the focus on a box with nothing focusable and ignores other keys', () => {
    const e = key('Tab');
    expect(trapTab(e, [], null)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(trapTab(key('a'), [el()], null)).toBe(false);
  });
});

describe('closeOnEscape', () => {
  it('closes on Escape only', () => {
    const close = vi.fn();
    expect(closeOnEscape({ key: 'Enter', stopPropagation: vi.fn() }, close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(closeOnEscape({ key: 'Escape', stopPropagation: vi.fn() }, close)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('initialFocus', () => {
  const [field, safe, first] = [el(), el(), el()];
  it('prefers the first field, then the least destructive button, then the first focusable', () => {
    const query = (map: Record<string, typeof field | null>) => ({
      querySelector: (s: string) => (s.startsWith('input') ? map['field']! : map['safe']!),
    });
    expect(initialFocus(query({ field, safe }), [first])).toBe(field);
    expect(initialFocus(query({ field: null, safe }), [first])).toBe(safe);
    expect(initialFocus(query({ field: null, safe: null }), [first])).toBe(first);
  });
});

describe('makeInert', () => {
  it('makes the background inert and restores only what it changed', () => {
    const page = { inert: false };
    const already = { inert: true };
    const restore = makeInert([page, already]);
    expect(page.inert).toBe(true);
    restore();
    expect(page.inert).toBe(false);
    expect(already.inert).toBe(true);
  });
});

describe('mobile dialog rule', () => {
  const css = readFileSync(new URL('../charte.css', import.meta.url), 'utf8');
  const mobile = css.slice(css.indexOf('/* Feuille ancrée en bas'));
  const block = mobile.slice(0, mobile.indexOf('/* Boutons empilés'));

  it('no longer forces a full-height panel', () => {
    expect(block).not.toMatch(/(^|[^-])height: 100%/m);
    expect(block).toContain('height: auto');
    expect(block).toContain('max-height: 100%');
  });

  it('anchors the sheet at the bottom with rounded top corners', () => {
    expect(block).toContain('align-items: flex-end');
    expect(block).toContain('border-radius: var(--radius) var(--radius) 0 0');
    expect(block).toContain('overscroll-behavior: contain');
  });
});
