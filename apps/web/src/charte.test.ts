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

describe('charte.css filters', () => {
  it('reserves no minimum height on a filter field', () => {
    expect(/\.filters \.field\s*\{[^}]*min-height/.test(css)).toBe(false);
  });

  it('keeps the submit button 16 px under the fields and 24 px above the results on desktop', () => {
    expect(/\.filters > \.btn\s*\{[^}]*margin-top:\s*var\(--space-2\);/.test(css)).toBe(true);
    expect(/\n\s+\.filters\s*\{\s*margin-bottom:\s*var\(--space-4\);/.test(css)).toBe(true);
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

  it('lets the sub-navigation wrap, with 44 px targets, under 900 px', () => {
    const narrow = /@media \(max-width: 56\.25rem\)\s*\{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? '';
    const rule = /\.subnav a \{([^}]*)\}/.exec(narrow)?.[1];
    expect(rule).toMatch(/padding:\s*0 var\(--space-2\)/);
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(/\.subnav a \{[^}]*min-height:\s*2\.75rem;/.test(css)).toBe(true);
  });

  it('gives the link under a card state badge a 44 px target', () => {
    expect(
      /\.data-table td\.card-nolabel \.state-link\s*\{[^}]*min-height:\s*2\.75rem;/.test(css),
    ).toBe(true);
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

describe('charte.css heading scale', () => {
  const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim().replace(/\/\*[\s\S]*?\*\/\s*/g, ''),
    size: /font-size:\s*([0-9.]+)rem/.exec(m[2]!)?.[1],
  }));
  const sizeOf = (selector: string) => Number(rules.find((r) => r.selector === selector)?.size);

  it('gives h2 and h3 a rem size strictly below the h1, in decreasing order', () => {
    expect(sizeOf('h1')).toBe(1.5);
    expect(sizeOf('h2')).toBeLessThan(sizeOf('h1'));
    expect(sizeOf('h3')).toBeLessThan(sizeOf('h2'));
  });

  it('sets heading sizes only on the bare h1, h2 and h3 rules (no component redefines them)', () => {
    for (const r of rules) {
      if (/\bh[1-6]\b/.test(r.selector) && r.size !== undefined) {
        expect(['h1', 'h2', 'h3'], r.selector).toContain(r.selector);
      }
    }
  });
});

describe('mail search cards on mobile', () => {
  const start = css.indexOf('/* Recherche : objet');
  const mail = css.slice(start, css.indexOf('.data-table td.card-only {', start));

  it('keeps the touch target and the card spacing of the other cards', () => {
    expect(mail).not.toMatch(/min-height:\s*0/);
    expect(mail).not.toMatch(/margin-bottom:\s*0\.25rem/);
    expect(mail).toMatch(/td\.card-action \.btn \{\s*width: 100%;/);
  });

  it('glues the separator to the previous item instead of starting a line', () => {
    expect(mail).not.toMatch(/::before\s*\{\s*content:\s*'\\00a0·/);
    expect(mail).toMatch(/td\.mail-date::after[^{]*\{\s*content: '\\00a0·'/);
  });
});

describe('charte.css lone actions', () => {
  it('stretches the mail actions and the storage retry below 900 px', () => {
    const rule =
      /@media \(max-width: 56\.25rem\) \{\s*\.mail-section > \.btn,\s*\.storage-unavailable > \.btn \{([^}]*)\}/;
    expect(rule.exec(css)?.[1]).toMatch(/width:\s*100%;/);
  });
});

describe('charte.css breadcrumb', () => {
  it('keeps each separator with the level after it, never alone at a line end', () => {
    expect(/\.breadcrumb li\s*\{[^}]*display:\s*inline-flex;/.test(css)).toBe(true);
    expect(/\.breadcrumb li::before\s*\{[^}]*content:\s*'>';/.test(css)).toBe(true);
    expect(/\.breadcrumb li:first-child::before\s*\{[^}]*display:\s*none;/.test(css)).toBe(true);
    expect(/\.breadcrumb li::after/.test(css)).toBe(false);
  });

  it('keeps the levels compact, with a 44 px target only on the links, and bolds the current one', () => {
    expect(/\.breadcrumb li\s*\{[^}]*min-height/.test(css)).toBe(false);
    expect(/\.breadcrumb a\s*\{[^}]*min-height/.test(css)).toBe(false);
    expect(/\.breadcrumb a::after\s*\{[^}]*height:\s*2\.75rem;/.test(css)).toBe(true);
    expect(/\.breadcrumb \[aria-current='location'\]\s*\{[^}]*font-weight:\s*700;/.test(css)).toBe(
      true,
    );
    expect(/\.breadcrumb\s*\{[^}]*gap:\s*0 var\(--space-1\);/.test(css)).toBe(true);
  });
});
