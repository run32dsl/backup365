import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable } from './DataTable.js';

const columns = [
  { header: 'Nom', cell: (r: { n: string; r: string }) => r.n },
  { header: 'Rôle', cell: (r: { n: string; r: string }) => r.r },
];
const rows = [{ n: 'Camille Durand', r: 'Administrateur' }];

describe('DataTable', () => {
  it('has a caption, column headers with scope and one labelled cell per header', () => {
    const html = renderToStaticMarkup(
      <DataTable caption="Comptes" columns={columns} rows={rows} rowKey={(r) => r.n} />,
    );
    expect(html).toContain('<caption class="table-caption">Comptes</caption>');
    expect(html).toContain('scope="col"');
    expect(html).toContain('data-label="Nom"');
    expect(html).toContain('data-label="Rôle"');
    expect(html).toContain('Camille Durand');
  });

  it('keeps the table semantics with explicit roles for the stacked layout', () => {
    const html = renderToStaticMarkup(
      <DataTable caption="Comptes" columns={columns} rows={rows} rowKey={(r) => r.n} />,
    );
    for (const role of ['table', 'rowgroup', 'row', 'columnheader', 'cell'])
      expect(html).toContain(`role="${role}"`);
  });

  it('can hide the caption visually while keeping it for screen readers', () => {
    const html = renderToStaticMarkup(
      <DataTable caption="Comptes" hideCaption columns={columns} rows={rows} rowKey={(r) => r.n} />,
    );
    expect(html).toContain('<caption class="sr-only">');
  });

  it('shows the empty state, with its action, instead of an empty table', () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Comptes"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.n}
        empty={{ message: 'Aucun compte pour l’instant.', action: <button>Ajouter</button> }}
      />,
    );
    expect(html).not.toContain('<table');
    expect(html).toContain('role="status"');
    expect(html).toContain('Aucun compte pour l’instant.');
    expect(html).toContain('Ajouter');
  });

  it('announces loading in a status region', () => {
    const html = renderToStaticMarkup(
      <DataTable caption="Comptes" columns={columns} rows={[]} rowKey={(r) => r.n} loading />,
    );
    expect(html).toContain('<p role="status">Chargement…</p>');
  });
});
