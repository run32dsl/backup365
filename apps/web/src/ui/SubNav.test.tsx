import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RestoreSourceNav, SourcesNav } from './SubNav.js';

describe('RestoreSourceNav', () => {
  it('lists the three sources as native links, in order, marking the current one', () => {
    const html = renderToStaticMarkup(<RestoreSourceNav current="onedrive" />);
    expect(html).toContain('aria-label="Source à restaurer"');
    expect(
      [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => m.slice(1)),
    ).toEqual([
      ['#/search', 'Mails'],
      ['#/onedrive', 'Fichiers OneDrive'],
      ['#/sharepoint', 'Sites SharePoint'],
    ]);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('<a href="#/onedrive" aria-current="page">Fichiers OneDrive</a>');
    expect(html).not.toContain('role="tab"');
  });
});

describe('SourcesNav', () => {
  it('offers the plans and the status to an administrator', () => {
    const html = renderToStaticMarkup(<SourcesNav current="status" admin />);
    expect(html).toContain('<a href="#/plans">Plans de protection</a>');
    expect(html).toContain('<a href="#/sources" aria-current="page">État des sources</a>');
  });

  it('shows nothing to an operator, who only has the plans', () => {
    expect(renderToStaticMarkup(<SourcesNav current="plans" admin={false} />)).toBe('');
  });
});
