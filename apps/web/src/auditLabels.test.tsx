import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditView } from './AuditPage.js';
import { DataTable } from './ui/index.js';
import { actorLabel, auditDate, detailLabel, reasonLabel, targetView } from './auditLabels.js';

const ID = '778493ab-e08a-45fc-9d3e-0a1b2c3d4e5f';

describe('audit labels', () => {
  it('keeps only typed reasons in the Motif column', () => {
    expect(reasonLabel('Ticket INC-10001')).toBe('Ticket INC-10001');
    expect(reasonLabel('scope=library;reason=Ticket #9')).toBe('Ticket #9');
    expect(reasonLabel('outcome=succeeded;duration_ms=5;mode=copy;reason=Ticket #7')).toBe(
      'Ticket #7',
    );
    for (const system of [
      'oidc',
      'forbidden',
      'scope:all,rpo:24',
      'changed:name',
      'outcome=failed;duration_ms=9',
      'unknown_code',
    ]) {
      expect(reasonLabel(system)).toBe('');
    }
    expect(reasonLabel(undefined)).toBe('');
  });

  it('writes system details in plain French, without the RPO acronym', () => {
    expect(detailLabel('oidc')).toBe('Compte Microsoft');
    expect(detailLabel('forbidden')).toBe('Accès refusé');
    expect(detailLabel('scope:all,rpo:24')).toBe(
      'Création : toute l’organisation, sauvegarde toutes les 24 h',
    );
    expect(detailLabel('changed:name,rpoHours,rtoHours')).toBe(
      'Modifié : nom, fréquence de sauvegarde, délai de reprise',
    );
    expect(detailLabel('outcome=succeeded;duration_ms=5;mode=copy;reason=Ticket #7')).toBe(
      'Réussie, 5 ms, copie',
    );
    expect(detailLabel('outcome=failed;duration_ms=2300')).toBe('Échouée, 2 s');
    expect(detailLabel('Ticket INC-10001')).toBe('');
    expect(detailLabel('unknown_code')).toBe('');
    for (const r of ['scope:selection,rpo:12', 'changed:rpoHours,rtoHours']) {
      expect(detailLabel(r)).not.toMatch(/RPO|RTO/);
    }
  });

  it('names the target, never an internal identifier', () => {
    const names = new Map([[ID, 'Plan standard']]);
    expect(targetView({ resource: 'plan', target: ID }, names)).toEqual({ name: 'Plan standard' });
    expect(targetView({ resource: 'plan', target: ID }, new Map())).toEqual({
      name: 'Plan supprimé',
    });
    expect(targetView({ resource: 'plan', target: ID }, null)).toEqual({ name: '—' });
    expect(
      targetView(
        {
          resource: 'mail',
          target: 'a@x.test/msg-1',
          targetName: 'Devis',
          targetMailbox: 'a@x.test',
        },
        null,
      ),
    ).toEqual({ name: 'Devis', secondary: 'a@x.test' });
    expect(targetView({ resource: 'mail', target: 'a@x.test/msg-1' }, null)).toEqual({
      name: 'Élément supprimé',
    });
    expect(targetView({ resource: 'snapshot', target: 'snap-1' }, null)).toEqual({ name: '—' });
    expect(targetView({ resource: 'mailboxes' }, null)).toEqual({ name: '—' });
    expect(targetView({ resource: 'account', target: 'operateur' }, null)).toEqual({
      name: 'operateur',
    });
  });

  it('writes the unidentified actor in French and the date with its year', () => {
    expect(actorLabel('anonymous')).toBe('Inconnu');
    expect(actorLabel('admin')).toBe('admin');
    expect(auditDate('2026-11-17T10:26:00.000Z')).toBe('17/11/2026 10:26');
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
    expect(html).toContain('data-label="A"');
  });
});

describe('AuditView labels', () => {
  it('shows no internal code or identifier and no repeated action', () => {
    const base = {
      at: '2026-01-15T10:00:00.000Z',
      previousHash: 'a'.repeat(64),
      hash: 'c'.repeat(64),
    };
    const html = renderToString(
      <AuditView
        planNames={new Map([[ID, 'Plan standard']])}
        state={{
          total: 5,
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
              action: 'auth.login_failed',
              resource: 'session',
              reason: 'bad_credentials',
            },
            {
              ...base,
              seq: 3,
              actor: 'op',
              action: 'item.export',
              resource: 'mail',
              target: 'claire@x.test/msg-1-004',
              targetName: 'Devis atelier (12)',
              targetMailbox: 'claire@x.test',
              reason: 'Ticket INC-10001',
            },
            {
              ...base,
              seq: 4,
              actor: 'op',
              action: 'item.open',
              resource: 'mail',
              target: 'claire@x.test/msg-9-009',
            },
            {
              ...base,
              seq: 5,
              actor: 'op',
              action: 'auth.login',
              resource: 'session',
              reason: 'oidc',
            },
          ],
        }}
      />,
    );
    expect(html).toContain('Plan standard');
    expect(html).toContain('Devis atelier (12)');
    expect(html).toContain('Élément supprimé');
    expect(html).toContain('Compte Microsoft');
    expect(html).toContain('Ticket INC-10001');
    expect(html).toContain('Inconnu');
    expect(html).toContain('Date (UTC)');
    expect(html).toContain('15/01/2026 10:00');
    expect(html).not.toContain('Ressource');
    expect(html).not.toMatch(
      /msg-|plan-demo|anonymous|RPO|forbidden|scope:|778493ab|bad_credentials/,
    );
  });
});
