import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./charte.css', import.meta.url), 'utf8');

function variables(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)) {
    out[m[1]!] = m[2]!.toLowerCase();
  }
  return out;
}

const light = variables(/:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '');
const darkOverrides = variables(
  /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '',
);
const dark = { ...light, ...darkOverrides };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** [premier plan, fond, seuil WCAG AA] : 4,5 pour le texte, 3 pour les composants graphiques. */
const PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'border-soft', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'border-soft', 4.5],
  ['muted', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accent-text', 'accent', 4.5],
  ['ok-fg', 'ok-bg', 4.5],
  ['warn-fg', 'warn-bg', 4.5],
  ['err-fg', 'err-bg', 4.5],
  ['info-fg', 'info-bg', 4.5],
  ['border', 'bg', 3],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
];

describe('charte.css contrast (WCAG AA)', () => {
  it('parses both palettes', () => {
    expect(Object.keys(light).length).toBeGreaterThan(15);
    expect(Object.keys(darkOverrides).length).toBeGreaterThan(15);
  });

  for (const [name, palette] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const [fg, bg, min] of PAIRS) {
      it(`${name}: ${fg} on ${bg} >= ${min}`, () => {
        expect(ratio(palette[fg]!, palette[bg]!)).toBeGreaterThanOrEqual(min);
      });
    }
  }
});

describe('charte.css footer', () => {
  it('colors the footer text with --muted, measured on --bg in both themes above', () => {
    expect(/\.console-footer\s*\{[^}]*color:\s*var\(--muted\);/.test(css)).toBe(true);
    expect(/\.console-footer\s*\{[^}]*background/.test(css)).toBe(false);
  });

  it('never cuts the version or the link, which keeps a 44 px target', () => {
    expect(/\.console-footer-item\s*\{\s*white-space:\s*nowrap;/.test(css)).toBe(true);
    expect(/\.console-footer-link a\s*\{[^}]*min-height:\s*2\.75rem;/.test(css)).toBe(true);
  });
});

describe('charte.css data tables', () => {
  it('hides the label of action cells in cards', () => {
    expect(/\.data-table td\.card-action::before\s*\{\s*display:\s*none;/.test(css)).toBe(true);
  });

  it('separates card actions from the data and keeps badges at their natural width', () => {
    expect(/\.data-table td\.card-action\s*\{[^}]*padding-top:\s*var\(--space-2\);/.test(css)).toBe(
      true,
    );
    expect(/\.data-table td > \.badge\s*\{\s*justify-self:\s*start;/.test(css)).toBe(true);
  });

  it('keeps addresses and subjects on one line on desktop', () => {
    expect(/\.data-table \.address\s*\{\s*white-space:\s*nowrap;/.test(css)).toBe(true);
    expect(/\.data-table \.subject a\s*\{[^}]*text-overflow:\s*ellipsis;/.test(css)).toBe(true);
  });

  it('keeps words whole in keep-words cells', () => {
    expect(/\.data-table \.keep-words\s*\{\s*overflow-wrap:\s*break-word;/.test(css)).toBe(true);
  });
});

describe('charte.css wizard actions', () => {
  it('keeps the primary action on the right on desktop, even alone', () => {
    expect(/\.wizard-actions > :last-child\s*\{\s*margin-left:\s*auto;/.test(css)).toBe(true);
    expect(css).not.toMatch(/\.wizard-actions > :only-child/);
  });

  it('aligns the help under the primary action only where the buttons are not full width', () => {
    expect(
      /@media \(min-width: 40\.01rem\)\s*\{\s*\.wizard-actions \+ \.field-help\s*\{\s*text-align:\s*right;/.test(
        css,
      ),
    ).toBe(true);
    expect(
      /@media \(max-width: 40rem\)\s*\{[\s\S]*?\.wizard-actions\s*\{\s*flex-direction:\s*column-reverse;/.test(
        css,
      ),
    ).toBe(true);
  });
});

describe('charte.css steps indicator', () => {
  it('never hides the list of steps, whatever the width or the journey', () => {
    const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)];
    const stepsRules = rules.filter((m) => /\.steps\b/.test(m[1]!));
    expect(stepsRules.length).toBeGreaterThan(0);
    for (const m of stepsRules) {
      expect(m[2]).not.toMatch(/display:\s*none/);
    }
  });
});

describe('charte.css collapsible menu (keyboard access)', () => {
  const narrow = /@media \(max-width: 56\.25rem\)\s*\{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? '';

  it('shows the Menu button below 900 px only', () => {
    expect(/\.menu-toggle\s*\{\s*display:\s*none;/.test(css)).toBe(true);
    expect(/\.menu-toggle\s*\{\s*display:\s*inline-flex;/.test(narrow)).toBe(true);
  });

  it('hides the links below 900 px until the button opens them', () => {
    expect(/\.sidebar-collapsible\s*\{\s*display:\s*none;/.test(narrow)).toBe(true);
    expect(/\.sidebar-collapsible\[data-open='true'\]\s*\{\s*display:\s*flex;/.test(narrow)).toBe(
      true,
    );
  });
});
