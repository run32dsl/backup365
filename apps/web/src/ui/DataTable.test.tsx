import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable, isCardClick } from './DataTable.js';

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

  it('applies a column class to its header and to its cells', () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Comptes"
        columns={[{ ...columns[0]!, className: 'num' }, columns[1]!]}
        rows={rows}
        rowKey={(r) => r.n}
      />,
    );
    expect(html).toMatch(/<th[^>]*class="num"[^>]*>Nom/);
    expect(html).toMatch(/<td[^>]*class="num"[^>]*>Camille/);
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

  it('selects the row when the card is clicked, but not when a link or button is', () => {
    type Node = { props: { children?: unknown; onClick?: (ev: unknown) => void } };
    const walk = (node: unknown, found: Node[] = []): Node[] => {
      if (Array.isArray(node)) node.forEach((n) => walk(n, found));
      else if (node && typeof node === 'object' && 'props' in node) {
        const el = node as Node;
        if (el.props.onClick) found.push(el);
        walk(el.props.children, found);
      }
      return found;
    };
    const chosen: string[] = [];
    const tree = DataTable({
      caption: 'Éléments',
      columns,
      rows,
      rowKey: (r) => r.n,
      onRowClick: (r) => chosen.push(r.n),
    });
    const [row] = walk(tree);
    row?.props.onClick?.({ target: { closest: () => null } });
    row?.props.onClick?.({ target: { closest: () => ({}) } });
    expect(chosen).toEqual(['Camille Durand']);
  });

  it('ignores clicks on links, buttons, fields and labels (isCardClick)', () => {
    const closest = (selector: string) => (tag: string) =>
      selector.split(',').includes(tag) ? {} : null;
    for (const tag of ['a', 'button', 'input', 'label']) {
      expect(isCardClick({ closest: (s) => closest(s)(tag) })).toBe(false);
    }
    expect(isCardClick({ closest: (s) => closest(s)('td') })).toBe(true);
  });

  it('marks clickable rows and keeps the radio name accessible', () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Éléments"
        columns={[
          {
            header: 'Nom',
            cell: (r: { n: string }) => (
              <label>
                <input type="radio" /> {r.n}
              </label>
            ),
          },
        ]}
        rows={[{ n: 'budget.xlsx' }]}
        rowKey={(r) => r.n}
        onRowClick={() => undefined}
      />,
    );
    expect(html).toContain('class="row-clickable"');
    expect(html).toMatch(/<label><input type="radio"\/> budget\.xlsx<\/label>/u);
  });

  it('announces loading in a status region', () => {
    const html = renderToStaticMarkup(
      <DataTable caption="Comptes" columns={columns} rows={[]} rowKey={(r) => r.n} loading />,
    );
    expect(html).toContain('<p role="status">Chargement…</p>');
  });
});
