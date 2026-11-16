import {
  CatalogUnavailableError,
  baseName,
  normalizeDrivePath,
  parentOf,
  type AuditLog,
  type DriveBrowser,
} from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import { auditEvent, recordDenied } from './audit-events.js';
import type { DriveRestoreService } from './drive-restore-service.js';
import { sendError } from './errors.js';
import { cleanReason } from './mail-routes.js';

interface Params {
  ownerId: string;
}

// `ownerId` est une adresse ou un identifiant : ni espace de contrôle ni barre oblique.
const params = {
  type: 'object',
  properties: {
    ownerId: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      pattern: '^[^\\x00-\\x1f\\x7f/\\\\]+$',
    },
  },
  required: ['ownerId'],
} as const;

interface RestoreBody {
  snapshotId?: unknown;
  path?: unknown;
  kind?: unknown;
  mode?: unknown;
  versionId?: unknown;
  reason?: unknown;
}

/**
 * OneDrive sauvegardé (docs/adr/0013). Lire l'arborescence ou les versions est la lecture
 * d'éléments sauvegardés : consignée avant la réponse (sinon rien n'est renvoyé), 503 sans
 * journal. Restaurer est réservé aux rôles `admin` et `operator`, avec motif obligatoire ; la
 * demande est consignée avant le lancement, le résultat à la fin (`DriveRestoreService`).
 */
export function registerOneDriveRoutes(
  app: FastifyInstance,
  browser: DriveBrowser | undefined,
  service: DriveRestoreService | undefined,
  audit: AuditLog | undefined,
) {
  const unavailable = { error: 'catalog_unavailable' };
  const auditMissing = { error: 'audit_unavailable' };

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof CatalogUnavailableError) {
      app.log.error({ errorName: err.name }, 'onedrive backup unavailable');
      if (audit) await recordDenied(audit, req, 'onedrive', 'catalog_unavailable');
      return reply.code(503).send(unavailable);
    }
    return sendError(err, reply);
  });

  // État de la restauration OneDrive, distinct de celle des mails (ADR 0013).
  app.get('/api/onedrive/status', () => ({ configured: service !== undefined }));

  app.get<{ Params: Params }>(
    '/api/onedrive/:ownerId/snapshots',
    { schema: { params } },
    async (req, reply) => {
      if (!browser) return reply.code(503).send(unavailable);
      return { snapshots: await browser.listSnapshots(req.params.ownerId) };
    },
  );

  app.get<{ Params: Params; Querystring: { snapshot: string; path?: string } }>(
    '/api/onedrive/:ownerId/items',
    {
      schema: {
        params,
        querystring: {
          type: 'object',
          properties: {
            snapshot: { type: 'string', minLength: 1, maxLength: 256 },
            path: { type: 'string', maxLength: 1024 },
          },
          required: ['snapshot'],
        },
      },
    },
    async (req, reply) => {
      if (!audit) return reply.code(503).send(auditMissing);
      const path = normalizeDrivePath(req.query.path ?? '/');
      if (path === null) return reply.code(400).send({ error: 'invalid_path' });
      if (!browser) {
        await recordDenied(audit, req, 'onedrive.items', 'catalog_unavailable');
        return reply.code(503).send(unavailable);
      }
      const entries = await browser.listFolder(req.params.ownerId, req.query.snapshot, path);
      if (!entries) {
        await recordDenied(audit, req, 'onedrive.items', 'snapshot_not_found');
        return reply.code(404).send({ error: 'snapshot_not_found' });
      }
      await audit.record(
        auditEvent(req, 'list.view', 'onedrive.items', {
          target: `${req.params.ownerId}${path}`,
          count: entries.length,
        }),
      );
      return { entries };
    },
  );

  app.get<{ Params: Params; Querystring: { path: string } }>(
    '/api/onedrive/:ownerId/versions',
    {
      schema: {
        params,
        querystring: {
          type: 'object',
          properties: { path: { type: 'string', minLength: 1, maxLength: 1024 } },
          required: ['path'],
        },
      },
    },
    async (req, reply) => {
      if (!audit) return reply.code(503).send(auditMissing);
      const path = normalizeDrivePath(req.query.path);
      if (path === null || path === '/') return reply.code(400).send({ error: 'invalid_path' });
      if (!browser) {
        await recordDenied(audit, req, 'onedrive.versions', 'catalog_unavailable');
        return reply.code(503).send(unavailable);
      }
      const versions = await browser.listVersions(req.params.ownerId, path);
      await audit.record(
        auditEvent(req, 'item.open', 'onedrive.versions', {
          target: `${req.params.ownerId}${path}`,
          count: versions.length,
        }),
      );
      return { versions };
    },
  );

  app.get<{ Params: Params; Querystring: { path: string } }>(
    '/api/onedrive/:ownerId/restore',
    {
      schema: {
        params,
        querystring: {
          type: 'object',
          properties: { path: { type: 'string', minLength: 1, maxLength: 1024 } },
          required: ['path'],
        },
      },
    },
    (req, reply) => {
      const path = normalizeDrivePath(req.query.path);
      if (path === null) return reply.code(400).send({ error: 'invalid_path' });
      return { last: service?.last(req.params.ownerId, path) ?? null };
    },
  );

  app.post<{ Params: Params; Body: RestoreBody | null }>(
    '/api/onedrive/:ownerId/restore',
    {
      schema: {
        params,
        body: { type: ['object', 'null'] },
      },
    },
    async (req, reply) => {
      const role = req.session?.role;
      if (role !== 'admin' && role !== 'operator') {
        if (audit) await recordDenied(audit, req, 'onedrive.restore', 'forbidden');
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (!audit) return reply.code(503).send(auditMissing);
      if (!service || !browser) return reply.code(503).send({ error: 'restore_unavailable' });
      const body = req.body ?? {};
      const reason = cleanReason(body.reason);
      if (reason === null) return reply.code(400).send({ error: 'reason_required' });
      const path = normalizeDrivePath(body.path);
      const { snapshotId, kind, mode, versionId } = body;
      const valid =
        path !== null &&
        path !== '/' &&
        typeof snapshotId === 'string' &&
        snapshotId !== '' &&
        (kind === 'file' || kind === 'folder') &&
        (mode === 'copy' || mode === 'replace') &&
        (versionId === undefined || (typeof versionId === 'string' && versionId !== '')) &&
        // Remplacer un dossier entier et restaurer une version d'un dossier n'existent pas.
        !(kind === 'folder' && (mode === 'replace' || versionId !== undefined));
      if (!valid) return reply.code(400).send({ error: 'invalid_request' });

      // L'élément (et la version) doivent exister dans la sauvegarde : rien n'est supposé du client.
      const siblings = await browser.listFolder(req.params.ownerId, snapshotId, parentOf(path));
      const listed = siblings?.find((e) => e.path === path && e.kind === kind);
      let versionAt = listed?.versionAt ?? null;
      let known = listed !== undefined && versionId === undefined;
      if (!known && kind === 'file') {
        // Une version choisie dans le panneau : l'instantané et l'identifiant doivent s'y trouver.
        const version = (await browser.listVersions(req.params.ownerId, path)).find(
          (v) =>
            v.snapshotId === snapshotId &&
            (versionId === undefined ? v.versionId === null : v.versionId === versionId),
        );
        if (version) {
          known = true;
          versionAt = version.at;
        }
      }
      if (!known) {
        await recordDenied(audit, req, 'onedrive.restore', 'item_not_found');
        return reply.code(404).send({ error: 'item_not_found' });
      }
      const job = await service.start(
        req.session?.username ?? 'anonymous',
        {
          ownerId: req.params.ownerId,
          snapshotId,
          path,
          name: baseName(path),
          kind,
          mode,
          versionId,
          versionAt,
        },
        reason,
      );
      if (job === 'in_progress') return reply.code(409).send({ error: 'restore_in_progress' });
      return reply.code(202).send({ job });
    },
  );
}
