import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormField, counterAnnouncement, describedBy } from './FormField.js';

describe('FormField', () => {
  it('links a visible label to the input with for/id', () => {
    const html = renderToStaticMarkup(<FormField label="Motif" name="reason" />);
    const id = /<label for="([^"]+)">Motif<\/label>/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('aria-describedby');
  });

  it('links help and error with aria-describedby and flags the invalid input', () => {
    const html = renderToStaticMarkup(
      <FormField label="Motif" help="Aide." error="Indiquez un motif d’au moins 10 caractères." />,
    );
    expect(html).toContain('aria-invalid="true"');
    const ids = /aria-describedby="([^"]+)"/.exec(html)?.[1]?.split(' ') ?? [];
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('Indiquez un motif d’au moins 10 caractères.');
  });

  it('shows a character counter, hidden from screen readers, with a polite live region', () => {
    const html = renderToStaticMarkup(
      <FormField label="Motif" counterMax={200} value="Contrôle" onChange={() => undefined} />,
    );
    expect(html).toMatch(/aria-hidden="true">8 \/ 200</);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('maxLength="200"');
  });

  it('passes the input id to the adornment', () => {
    const html = renderToStaticMarkup(
      <FormField label="Mot de passe" adornment={(id) => <i data-for={id} />} />,
    );
    const id = /<label for="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`data-for="${id}"`);
  });
});

describe('counter announcement', () => {
  it('stays silent far from the limit and speaks near it', () => {
    expect(counterAnnouncement(23, 200)).toBe('');
    expect(counterAnnouncement(179, 200)).toBe('');
    expect(counterAnnouncement(180, 200)).toBe('180 sur 200 caractères');
  });

  it('describedBy lists help then error', () => {
    expect(describedBy({}, 'x')).toBeUndefined();
    expect(describedBy({ help: 'a', error: 'b' }, 'x')).toBe('x-help x-error');
    expect(describedBy({ error: 'b' }, 'x')).toBe('x-error');
  });
});
