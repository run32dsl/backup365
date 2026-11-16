import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditView } from './AuditPage.js';
import { DataTable } from './ui/index.js';
import { RESOURCE_LABELS, reasonLabel, resourceLabel, targetLabel } from './auditLabels.js';

const ID = '778493ab-e08a-45fc-9d3e-0a1b2c3d4e5f';

describe('audit labels', () => {
  it('translates every resource code and never shows an unknown one', () => {
    expect(resourceLabel('auth')).toBe('Connexion');
    expect(resourceLabel('mail.search')).toBe('Recherche de mails');
    expect(resourceLabel('mailboxes')).toBe('Boîtes');
    expect(resourceLabel('something.new')).toBe('Autre ressource');
    for (const label of Object.values(RESOURCE_LABELS)) expect(label).not.toMatch(/[a-z]\.[a-z]/);
  });

  it('writes system reasons in plain French or leaves them empty', () => {
    expect(reasonLabel('scope:all,rpo:24')).toBe('Création : toute l’organisation, RPO 24 h');
    expect(reasonLabel('forbidden')).toBe('Accès refusé');
    expect(reasonLabel('changed:name,rpoHours')).toBe('Modifié : nom, RPO');
    expect(reasonLabel('outcome=ok;duration_ms=5;reason=Demande du DPO')).toBe('Demande du DPO');
    expect(reasonLabel('unknown_code')).toBe('');
    expect(reasonLabel(undefined)).toBe('');
  });

  it('shows a plan by its name, never by its UUID', () => {
    const names = new Map([[ID, 'Plan standard']]);
    expect(targetLabel(ID, 'plan', names)).toBe('Plan standard');
    expect(targetLabel(ID, 'plan', new Map())).toBe('Plan supprimé');
    expect(targetLabel(ID, 'plan', null)).toBe('');
    expect(targetLabel(ID, 'mail', new Map())).toBe('');
    expect(targetLabel('operateur-demo', 'account', names)).toBe('operateur-demo');
  });
});

describe('DataTable compact', () => {
  it('adds the compact class and the column classes', () => {
    const html = renderToString(
      <DataTable
        caption="t"
        compact
        columns={[{ header: 'A', className: 'card-hidden', cell: (r: string) => r }]}
        rows={['x']}
        rowKey={(r) => r}
      />,
    );
    expect(html).toContain('data-table-compact');
    expect(html).toContain('class="card-hidden"');
  });
});

describe('AuditView labels', () => {
  it('shows no internal code or UUID in the table', () => {
    const base = {
      at: '2026-01-15T10:00:00.000Z',
      previousHash: 'a'.repeat(64),
      hash: 'c'.repeat(64),
    };
    const html = renderToString(
      <AuditView
        planNames={new Map([[ID, 'Plan standard']])}
        state={{
          total: 3,
          limit: 50,
          offset: 0,
          items: [
            {
              ...base,
              seq: 1,
              actor: 'admin',
              action: 'plan.create',
              resource: 'plan',
              target: ID,
              reason: 'scope:all,rpo:24',
            },
            {
              ...base,
              seq: 2,
              actor: 'anonymous',
              action: 'access.denied',
              resource: 'accounts',
              reason: 'forbidden',
            },
            { ...base, seq: 3, actor: 'admin', action: 'item.open', resource: 'mail.search' },
          ],
        }}
      />,
    );
    expect(html).toContain('Plan standard');
    expect(html).toContain('Accès refusé');
    expect(html).toContain('Recherche de mails');
    expect(html).not.toMatch(/forbidden|scope:|mail\.search|>auth<|>accounts<|778493ab/);
  });
});
