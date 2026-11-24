import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditView } from './AuditPage.js';
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
      'bad_credentials',
      'oidc_no_group',
      'password_change_failed',
      'role:operator,disabled:true',
    ]) {
      expect(reasonLabel(system)).toBe('');
    }
    // Un texte saisi qui ressemble à un code reste affiché.
    for (const typed of ['inc-10001', 'ticket-123', 'rgpd-2026', 'unknown_code']) {
      expect(reasonLabel(typed)).toBe(typed);
    }
    expect(reasonLabel('password_reset: inc-10001')).toBe('inc-10001');
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
    expect(detailLabel('inc-10001')).toBe('');
    expect(detailLabel('password_reset: inc-10001')).toBe('Mot de passe réinitialisé');
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

  it('names the source and scope of a list view, never the search terms', () => {
    expect(targetView({ resource: 'mail.search', target: 'paul@x.test' }, null)).toEqual({
      name: 'Messagerie',
      secondary: 'paul@x.test',
    });
    expect(targetView({ resource: 'mail.search', target: '*' }, null)).toEqual({
      name: 'Messagerie',
      secondary: 'toutes les boîtes',
    });
    expect(targetView({ resource: 'mail.search' }, null)).toEqual({ name: 'Messagerie' });
    expect(
      targetView({ resource: 'onedrive.items', target: 'claire@x.test/Documents/Budget' }, null),
    ).toEqual({ name: 'OneDrive', secondary: 'claire@x.test' });
    expect(
      targetView(
        { resource: 'sharepoint.items', target: 'site-1/Docs', targetName: 'Équipe commerciale' },
        null,
      ),
    ).toEqual({ name: 'SharePoint', secondary: 'Équipe commerciale' });
    expect(targetView({ resource: 'sharepoint.scope', target: 'gone/Docs' }, null)).toEqual({
      name: 'SharePoint',
    });
  });

  it('names the audit log and its filters when it is itself consulted', () => {
    expect(targetView({ resource: 'audit' }, null)).toEqual({
      name: 'Journal d’audit',
      secondary: 'sans filtre',
    });
    expect(
      targetView(
        {
          resource: 'audit',
          target:
            'from=2026-11-18T00:00:00.000Z;to=2026-11-21T00:00:00.000Z;action=restore.request',
        },
        null,
      ),
    ).toEqual({
      name: 'Journal d’audit',
      secondary: 'du 18/11/2026 au 20/11/2026, action : Demande de restauration',
    });
    expect(
      targetView({ resource: 'audit', target: 'from=2026-11-18T00:00:00.000Z' }, null).secondary,
    ).toBe('depuis le 18/11/2026');
    expect(
      targetView({ resource: 'audit', target: 'to=2026-11-20T00:00:00.000Z' }, null).secondary,
    ).toBe('jusqu’au 19/11/2026');
    expect(targetView({ resource: 'audit', target: 'action=plan.delete' }, null).secondary).toBe(
      'action : Suppression de plan',
    );
  });

  it('gives every resource the server records with list.view a non-empty target', () => {
    const dir = join(import.meta.dirname, '../../server/src');
    const resources = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.test\./.test(f))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const m of source.matchAll(/auditEvent\(\s*req,\s*'list\.view',\s*'([^']+)'/g)) {
        resources.add(m[1]!);
      }
    }
    expect([...resources].sort()).toEqual(
      expect.arrayContaining(['audit', 'mail.search', 'onedrive.items', 'sharepoint.items']),
    );
    for (const resource of resources) {
      expect(targetView({ resource }, null).name, resource).not.toBe('—');
    }
  });

  it('writes the unidentified actor in French and the date with its year', () => {
    expect(actorLabel('anonymous')).toBe('Inconnu');
    expect(actorLabel('admin')).toBe('admin');
    expect(auditDate('2026-11-17T10:26:00.000Z')).toBe('17/11/2026 10:26');
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
