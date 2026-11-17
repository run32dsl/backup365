import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChooseStep, ContentTree } from './SharePointPage.js';

const site = { id: 's1', displayName: 'Équipe' };
const noop = () => undefined;
const html = (admin: boolean) =>
  renderToStaticMarkup(
    <ChooseStep
      sites={[site]}
      site={site}
      snapshots={[]}
      snapshotId=""
      initialScope="item"
      admin={admin}
      configured
      onSnapshot={noop}
      onContinue={noop}
    />,
  );

describe('SharePoint choose step', () => {
  it('has a named breadcrumb nav with aria-current on the last level', () => {
    const out = html(true);
    expect(out).toContain('<nav aria-label="Fil d&#x27;Ariane">');
    expect(out).toMatch(/aria-current="location"[^>]*>Équipe</);
    expect(out).not.toContain('btn-secondary');
  });

  it('renders every ancestor as a link and the current folder as plain text', () => {
    const out = renderToStaticMarkup(
      <ContentTree
        siteId="s1"
        siteName="Équipe"
        snapshotId="p1"
        scope="item"
        path="/Docs/Plans/2024"
        file={null}
        onPath={noop}
        onFile={noop}
      />,
    );
    // Comme OneDrive : chaque lien porte son niveau (clic milieu, copie du lien).
    expect([...out.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      '#/sharepoint/s1/item',
      '#/sharepoint/s1/item/Docs',
      '#/sharepoint/s1/item/Docs/Plans',
    ]);
    expect(out).not.toContain('<button');
    expect(out).toMatch(/aria-current="location"[^>]*>2024</);
  });

  it('groups scopes in a fieldset and links the disabled option to its help', () => {
    const out = html(false);
    expect(out).toMatch(/<fieldset[^>]*>\s*<legend>Restaurer<\/legend>/);
    const input = /<input[^>]*value="site"[^>]*>/.exec(out)?.[0] ?? '';
    expect(input).toContain('disabled');
    const id = /aria-describedby="([^"]+)"/.exec(input)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`id="${id}"`);
    expect(out).toMatch(/class="field-help choice-help"[^>]*>Réservé aux administrateurs</);
  });
});
