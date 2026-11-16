import {
  CatalogUnavailableError,
  baseName,
  isPathOfScope,
  normalizeDrivePath,
  parentOf,
  SITE_SCOPES,
  type AuditLog,
  type BackupCatalog,
  type SiteBrowser,
  type SiteScope,
} from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import { auditEvent, recordDenied } from './audit-events.js';
import { sendError } from './errors.js';
import { cleanReason } from './mail-routes.js';
import type { SiteRestoreService } from './site-restore-service.js';

interface Params {
  siteId: string;
}

// L'identifiant d'un site contient des virgules (`hôte,id,id`) : ni contrôle ni barre oblique.
const params = {
  type: 'object',
  properties: {
    siteId: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      pattern: '^[^\\x00-\\x1f\\x7f/\\\\]+$',
    },
  },
  required: ['siteId'],
} as const;

const itemQuery = {
  type: 'object',
  properties: {
    snapshot: { type: 'string', minLength: 1, maxLength: 256 },
    path: { type: 'string', maxLength: 1024 },
  },
  required: ['snapshot'],
} as const;

interface RestoreBody {
  snapshotId?: unknown;
  scope?: unknown;
  path?: unknown;
  confirmName?: unknown;
  reason?: unknown;
}

/**
 * SharePoint sauvegardé (docs/adr/0014). Lire l'arborescence ou le périmètre d'une restauration
 * est la lecture d'éléments sauvegardés : consignée avant la réponse, 503 sans journal. Restaurer
 * est réservé à `admin` et `operator`, avec motif ; le site entier à `admin` seul, avec le nom du
 * site retapé (revérifié ici, pas seulement dans l'interface).
 */
export function registerSharePointRoutes(
  app: FastifyInstance,
  catalog: BackupCatalog | undefined,
  browser: SiteBrowser | undefined,
  service: SiteRestoreService | undefined,
  audit: AuditLog | undefined,
) {
  const unavailable = { error: 'catalog_unavailable' };
  const auditMissing = { error: 'audit_unavailable' };

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof CatalogUnavailableError) {
      app.log.error({ errorName: err.name }, 'sharepoint backup unavailable');
      if (audit) await recordDenied(audit, req, 'sharepoint', 'catalog_unavailable');
      return reply.code(503).send(unavailable);
    }
    return sendError(err, reply);
  });

  app.get('/api/sharepoint/status', () => ({ configured: service !== undefined }));

  app.get('/api/sharepoint/sites', async (_req, reply) => {
    if (!catalog) return reply.code(503).send(unavailable);
    return { sites: await catalog.listSites() };
  });

  app.get<{ Params: Params }>(
    '/api/sharepoint/:siteId/snapshots',
    { schema: { params } },
    async (req, reply) => {
      if (!catalog) return reply.code(503).send(unavailable);
      return { snapshots: await catalog.listSiteSnapshots(req.params.siteId) };
    },
  );

  app.get<{ Params: Params; Querystring: { snapshot: string; path?: string } }>(
    '/api/sharepoint/:siteId/items',
    { schema: { params, querystring: itemQuery } },
    async (req, reply) => {
      if (!audit) return reply.code(503).send(auditMissing);
      const path = normalizeDrivePath(req.query.path ?? '/');
      if (path === null) return reply.code(400).send({ error: 'invalid_path' });
      if (!browser) {
        await recordDenied(audit, req, 'sharepoint.items', 'catalog_unavailable');
        return reply.code(503).send(unavailable);
      }
      const entries = await browser.listFolder(req.params.siteId, req.query.snapshot, path);
      if (!entries) {
        await recordDenied(audit, req, 'sharepoint.items', 'snapshot_not_found');
        return reply.code(404).send({ error: 'snapshot_not_found' });
      }
      await audit.record(
        auditEvent(req, 'list.view', 'sharepoint.items', {
          target: `${req.params.siteId}${path}`,
          count: entries.length,
        }),
      );
      return { entries };
    },
  );

  app.get<{ Params: Params; Querystring: { snapshot: string; path?: string } }>(
    '/api/sharepoint/:siteId/scope',
    { schema: { params, querystring: itemQuery } },
    async (req, reply) => {
      if (!audit) return reply.code(503).send(auditMissing);
      const path = normalizeDrivePath(req.query.path ?? '/');
      if (path === null) return reply.code(400).send({ error: 'invalid_path' });
      if (!browser) {
        await recordDenied(audit, req, 'sharepoint.scope', 'catalog_unavailable');
        return reply.code(503).send(unavailable);
      }
      const summary = await browser.summarize(req.params.siteId, req.query.snapshot, path);
      if (!summary) {
        await recordDenied(audit, req, 'sharepoint.scope', 'snapshot_not_found');
        return reply.code(404).send({ error: 'snapshot_not_found' });
      }
      await audit.record(
        auditEvent(req, 'list.view', 'sharepoint.scope', {
          target: `${req.params.siteId}${path}`,
          count: summary.items,
        }),
      );
      return summary;
    },
  );

  app.get<{ Params: Params }>('/api/sharepoint/:siteId/restore', { schema: { params } }, (req) => ({
    last: service?.last(req.params.siteId) ?? null,
  }));

  app.post<{ Params: Params; Body: RestoreBody | null }>(
    '/api/sharepoint/:siteId/restore',
    { schema: { params, body: { type: ['object', 'null'] } } },
    async (req, reply) => {
      const role = req.session?.role;
      const body = req.body ?? {};
      const scope: SiteScope | undefined = SITE_SCOPES.find((s) => s === body.scope);
      if (role !== 'admin' && role !== 'operator') {
        if (audit) await recordDenied(audit, req, 'sharepoint.restore', 'forbidden');
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (scope === 'site' && role !== 'admin') {
        if (audit) await recordDenied(audit, req, 'sharepoint.restore', 'admin_required');
        return reply.code(403).send({ error: 'admin_required' });
      }
      if (!audit) return reply.code(503).send(auditMissing);
      if (!service || !browser || !catalog) {
        return reply.code(503).send({ error: 'restore_unavailable' });
      }
      const reason = cleanReason(body.reason);
      if (reason === null) return reply.code(400).send({ error: 'reason_required' });
      const path = normalizeDrivePath(body.path);
      const { snapshotId } = body;
      if (
        scope === undefined ||
        path === null ||
        typeof snapshotId !== 'string' ||
        snapshotId === '' ||
        !isPathOfScope(scope, path)
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const siteId = req.params.siteId;

      // Le site, l'instantané et l'élément doivent exister dans la sauvegarde : le client ne dicte rien.
      const site = (await catalog.listSites()).find((s) => s.id === siteId);
      const summary = await browser.summarize(siteId, snapshotId, path);
      let known = site !== undefined && summary !== null;
      if (known && (scope === 'item' || scope === 'folder' || scope === 'library')) {
        const wanted = scope === 'item' ? 'file' : scope;
        const siblings = await browser.listFolder(siteId, snapshotId, parentOf(path));
        known = siblings?.some((e) => e.path === path && e.kind === wanted) ?? false;
      }
      if (!known || !site || !summary) {
        await recordDenied(audit, req, 'sharepoint.restore', 'item_not_found');
        return reply.code(404).send({ error: 'item_not_found' });
      }
      if (scope === 'site' && body.confirmName !== site.displayName) {
        await recordDenied(audit, req, 'sharepoint.restore', 'confirmation_mismatch');
        return reply.code(400).send({ error: 'confirmation_mismatch' });
      }
      // Rien à restaurer : un 202 suivi d'un « échec » tromperait.
      if (summary.items === 0) return reply.code(400).send({ error: 'empty_scope' });
      const job = await service.start(
        req.session?.username ?? 'anonymous',
        {
          siteId,
          snapshotId,
          scope,
          path,
          name: baseName(path),
          total: summary.items,
        },
        reason,
      );
      if (job === 'in_progress') return reply.code(409).send({ error: 'restore_in_progress' });
      return reply.code(202).send({ job });
    },
  );
}
