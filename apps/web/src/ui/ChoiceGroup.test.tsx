import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChoiceGroup } from './ChoiceGroup.js';

const render = (help?: string) =>
  renderToStaticMarkup(
    <ChoiceGroup
      legend="Restaurer"
      name="scope"
      value="a"
      help={help}
      onChange={() => undefined}
      options={[
        { value: 'a', label: 'Un élément' },
        { value: 'b', label: 'Un dossier' },
        {
          value: 'c',
          label: 'Le site entier',
          disabled: true,
          hint: 'Réservé aux administrateurs',
        },
      ]}
    />,
  );

describe('ChoiceGroup', () => {
  it('announces the legend in a fieldset and spaces the options with .choice-row', () => {
    expect(render()).toMatch(
      /^<fieldset class="choices"[^>]*><legend>Restaurer<\/legend><div class="choice-row">/,
    );
  });

  it('gives every radio the same name so the arrow keys move between them, one checked', () => {
    const html = render();
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/checked="" value="a"/);
  });

  it('disables an option and keeps its explanation inside its label, linked by aria-describedby', () => {
    const html = render();
    const labels = html.match(/<label class="choice">.*?<\/label>/g) ?? [];
    const label = labels.find((l) => l.includes('Le site entier')) ?? '';
    expect(label).toContain('disabled=""');
    expect(label).toContain('(Réservé aux administrateurs)');
    const id = /aria-describedby="([^"]+)"/.exec(label)?.[1];
    expect(id).toBeDefined();
    expect(label).toContain(`id="${id}"`);
  });

  it('links a help sentence to the group', () => {
    const html = render('Aide.');
    const id = /<fieldset[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<p id="${id}" class="field-help">Aide.</p>`);
  });
});
