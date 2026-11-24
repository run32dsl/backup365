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
      initialPath="/"
      admin={admin}
      configured
      onSnapshot={noop}
      onContinue={noop}
    />,
  );

describe('SharePoint choose step', () => {
  it('has a named breadcrumb nav whose root stays a link even when it is the current level', () => {
    const out = html(true);
    expect(out).toContain('<nav aria-label="Fil d&#x27;Ariane">');
    expect(out).toMatch(
      /<a href="#\/sharepoint\/s1\/item"[^>]*aria-current="location"[^>]*>Équipe</,
    );
    expect(out).not.toContain('btn-secondary');
  });

  it('renders every ancestor as a link and the current folder as plain text', () => {
    const out = renderToStaticMarkup(
      <ContentTree
        siteId="s1"
        siteName="Équipe"
        snapshotId="p1"
        path="/Docs/Plans/2024"
        selected={null}
        onPath={noop}
        onSelect={noop}
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

  it('no longer asks for a kind before browsing', () => {
    const out = html(true);
    expect(out).not.toContain('<fieldset');
    expect(out).not.toContain('Un élément');
    expect(out).not.toContain('Aucune sélection');
  });

  it('offers the whole site as a separate checkbox, enabled for an administrator', () => {
    const input = /<input[^>]*type="checkbox"[^>]*>/.exec(html(true))?.[0] ?? '';
    expect(input).not.toContain('disabled');
    expect(html(true)).toContain('Restaurer le site entier');
  });

  it('does not render the whole site option nor its mention for an operator', () => {
    const out = html(false);
    expect(out).not.toContain('Restaurer le site entier');
    expect(out).not.toContain('Réservé aux administrateurs');
    expect(out).not.toContain('class="choice-item"');
  });

  it('shows the hint above « Continuer », never below', () => {
    const out = html(true);
    const hint = out.indexOf('Cochez un fichier, un dossier ou une bibliothèque pour continuer.');
    const button = out.indexOf('Continuer');
    expect(hint).toBeGreaterThan(-1);
    expect(hint).toBeLessThan(button);
  });
});
