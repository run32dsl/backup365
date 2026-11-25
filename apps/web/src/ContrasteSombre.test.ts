import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./charte.css', import.meta.url), 'utf8');
const fromDark = css.slice(css.indexOf('prefers-color-scheme: dark'));
const darkBlock = fromDark.slice(0, fromDark.indexOf('\n}\n'));

const token = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(darkBlock);
  if (!m) throw new Error(`jeton sombre manquant : ${name}`);
  return m[1]!;
};

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('contraste AA des jetons sombres (WCAG 2.1, texte normal : 4,5:1)', () => {
  const pairs: [string, string][] = [
    ['text', 'bg'],
    ['text', 'surface'],
    ['muted', 'bg'],
    ['muted', 'surface'],
    ['accent', 'bg'],
    ['accent', 'surface'],
    ['accent-text', 'accent'],
    ['ok-fg', 'ok-bg'],
    ['warn-fg', 'warn-bg'],
    ['err-fg', 'err-bg'],
    ['info-fg', 'info-bg'],
  ];
  for (const [fg, bg] of pairs) {
    const r = ratio(token(fg), token(bg));
    it(`${fg} sur ${bg} : ${r.toFixed(2)}:1`, () => {
      expect(r).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('bordure de composant sur le fond : 3:1', () => {
    expect(ratio(token('border'), token('bg'))).toBeGreaterThanOrEqual(3);
  });
});
