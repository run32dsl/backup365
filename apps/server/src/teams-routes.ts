import { CatalogUnavailableError, type AuditLog, type BackupCatalog } from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import { auditEvent, recordDenied } from './audit-events.js';
import { TeamExportTooLargeError, type TeamsArchive } from './atlas-teams.js';
import { sendError } from './errors.js';
import { cleanReason } from './mail-routes.js';

interface Params {
  teamId: string;
}

// Un identifiant d'équipe Teams est un GUID : ni contrôle ni barre oblique.
const id = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[^\\x00-\\x1f\\x7f/\\\\]+$' };
const params = {
  type: 'object',
  properties: { teamId: id },
  required: ['teamId'],
} as const;

const exportBody = {
  type: 'object',
  properties: {
    snapshotId: { type: 'string', minLength: 1, maxLength: 256 },
    channelId: { type: 'string', minLength: 1, maxLength: 512 },
    reason: { type: 'string' },
  },
  required: ['snapshotId', 'channelId'],
} as const;

/** Exports construits en même temps, au plus (mémoire du serveur). */
export const MAX_CONCURRENT_EXPORTS = 2;

interface ExportBody {
  snapshotId: string;
  channelId: string;
  reason?: string;
}

/**
 * Teams sauvegardé (docs/adr/0022). Lister les canaux d'une équipe est la lecture d'éléments
 * sauvegardés : consignée avant la réponse, 503 sans journal. L'export d'un canal exige un motif,
 * inscrit au journal une fois l'archive prête et avant son envoi. Le SDK 7.2.0 n'a pas de remise
 * dans le canal d'origine : l'export (zip) est la seule destination.
 */
export function registerTeamsRoutes(
  app: FastifyInstance,
  catalog: BackupCatalog | undefined,
  archive: TeamsArchive | undefined,
  audit: AuditLog | undefined,
) {
  const unavailable = { error: 'catalog_unavailable' };
  const auditMissing = { error: 'audit_unavailable' };
  let exporting = 0;

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof CatalogUnavailableError) {
      app.log.error({ errorName: err.name }, 'teams backup unavailable');
      if (audit) await recordDenied(audit, req, 'teams', 'catalog_unavailable');
      return reply.code(503).send(unavailable);
    }
    return sendError(err, reply);
  });

  app.get('/api/teams/teams', async (_req, reply) => {
    if (!catalog) return reply.code(503).send(unavailable);
    return { teams: (await catalog.listTeams?.()) ?? [] };
  });

  app.get<{ Params: Params }>(
    '/api/teams/:teamId/snapshots',
    { schema: { params } },
    async (req, reply) => {
      if (!audit) return reply.code(503).send(auditMissing);
      if (!archive) {
        await recordDenied(audit, req, 'teams.channels', 'catalog_unavailable');
        return reply.code(503).send(unavailable);
      }
      const snapshots = await archive.listSnapshots(req.params.teamId);
      await audit.record(
        auditEvent(req, 'list.view', 'teams.channels', {
          target: req.params.teamId,
          count: snapshots.length,
        }),
      );
      return { snapshots };
    },
  );

  app.post<{ Params: Params; Body: ExportBody }>(
    '/api/teams/:teamId/export',
    { schema: { params, body: exportBody } },
    async (req, reply) => {
      if (!audit) return reply.code(503).send(auditMissing);
      const reason = cleanReason(req.body.reason);
      if (reason === null) return reply.code(400).send({ error: 'reason_required' });
      if (!archive) {
        await recordDenied(audit, req, 'teams.export', 'catalog_unavailable');
        return reply.code(503).send(unavailable);
      }
      const { teamId } = req.params;
      const { snapshotId, channelId } = req.body;
      // L'instantané et le canal doivent exister dans la sauvegarde : le client ne dicte rien.
      const snapshot = (await archive.listSnapshots(teamId)).find((s) => s.id === snapshotId);
      if (!snapshot?.channels.some((c) => c.id === channelId)) {
        await recordDenied(audit, req, 'teams.export', 'item_not_found');
        return reply.code(404).send({ error: 'item_not_found' });
      }
      // Chaque archive est gardée en mémoire (jusqu'à 512 Mio) : deux à la fois au plus.
      if (exporting >= MAX_CONCURRENT_EXPORTS) {
        return reply.code(429).send({ error: 'export_busy' });
      }
      exporting += 1;
      let result;
      try {
        result = await archive.exportChannel(teamId, snapshotId, channelId);
      } catch (err) {
        if (err instanceof TeamExportTooLargeError) {
          await recordDenied(audit, req, 'teams.export', 'export_too_large');
          return reply.code(413).send({ error: 'export_too_large' });
        }
        throw err;
      } finally {
        exporting -= 1;
      }
      // Fail-closed : le motif est inscrit au journal avant que l'archive ne parte.
      await audit.record(
        auditEvent(req, 'item.export', 'teams', {
          target: `${teamId}/${channelId}`,
          count: result.messages,
          reason,
        }),
      );
      void reply
        .header('content-type', 'application/zip')
        .header('content-disposition', 'attachment; filename="teams.zip"')
        .header('x-backup365-messages', String(result.messages));
      if (result.missing > 0) {
        void reply.header('x-backup365-omitted-attachments', String(result.missing));
      }
      return reply.send(result.bytes);
    },
  );
}
