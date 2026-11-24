import {
  AUDIT_ACTIONS,
  type AuditAction,
  type AuditEntry,
  type AuditLog,
  type BackupCatalog,
  type SearchIndex,
} from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import { auditEvent } from './audit-events.js';

interface AuditQuerystring {
  from?: string;
  to?: string;
  actor?: string;
  action?: AuditAction;
  limit: number;
  offset: number;
}

const date = { type: 'string', format: 'date-time' } as const;

const MAIL_RESOURCES: ReadonlySet<string> = new Set(['mail', 'mail.restore']);

/** Entrée du journal, avec l'objet et la boîte du mail visé quand l'index les connaît encore. */
export type AuditItem = AuditEntry & { targetName?: string; targetMailbox?: string };

/**
 * Ajoute à l'entrée l'objet du mail visé (`<boîte>/<identifiant>`), lu dans l'index à la
 * consultation : le journal chaîné n'est pas modifié (ADR 0004). Mail absent de l'index : rien.
 */
async function withMailName(entry: AuditEntry, index: SearchIndex | undefined): Promise<AuditItem> {
  const slash = entry.target?.indexOf('/') ?? -1;
  if (!index || !MAIL_RESOURCES.has(entry.resource) || !entry.target || slash <= 0) return entry;
  const mailbox = entry.target.slice(0, slash);
  try {
    const mail = await index.getMail(mailbox, entry.target.slice(slash + 1));
    return mail ? { ...entry, targetName: mail.subject, targetMailbox: mailbox } : entry;
  } catch {
    // Enrichissement facultatif : une erreur de l'index ne doit pas rendre le journal illisible.
    return entry;
  }
}

const SITE_RESOURCES: ReadonlySet<string> = new Set(['sharepoint.items', 'sharepoint.scope']);

/**
 * Ajoute à la consultation d'un site (`<site>/<dossier>`) le nom du site, lu dans le catalogue ;
 * site absent du catalogue : rien.
 */
function withSiteName(entry: AuditItem, sites: ReadonlyMap<string, string> | undefined): AuditItem {
  const name = SITE_RESOURCES.has(entry.resource)
    ? sites?.get(entry.target?.split('/')[0] ?? '')
    : undefined;
  return name ? { ...entry, targetName: name } : entry;
}

/** Consultation du journal d'audit (lecture seule). Sans journal configuré, elle répond 503. */
export function registerAuditRoutes(
  app: FastifyInstance,
  audit: AuditLog | undefined,
  index?: SearchIndex,
  catalog?: BackupCatalog,
) {
  app.get<{ Querystring: AuditQuerystring }>(
    '/api/audit',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            from: date,
            to: date,
            actor: { type: 'string', minLength: 1, maxLength: 256 },
            action: { type: 'string', enum: [...AUDIT_ACTIONS] },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, maximum: 1_000_000, default: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!audit) return reply.code(503).send({ error: 'audit_unavailable' });
      // Le format `date-time` accepte des dates que JavaScript refuse (seconde intercalaire).
      if ([req.query.from, req.query.to].some((d) => d !== undefined && isNaN(Date.parse(d)))) {
        return reply.code(400).send({ error: 'invalid_date' });
      }
      const page = await audit.list(req.query);
      // La lecture du journal est elle-même journalisée (décision du 2026-11-12), avant la réponse.
      // Cible : les filtres de période et d'action (valeurs validées par le schéma). Jamais
      // l'acteur, texte libre saisi par l'utilisateur.
      const { from, to, action } = req.query;
      const filters = [
        from && `from=${from}`,
        to && `to=${to}`,
        action && `action=${action}`,
      ].filter(Boolean);
      await audit.record(
        auditEvent(req, 'list.view', 'audit', {
          ...(filters.length > 0 ? { target: filters.join(';') } : {}),
          count: page.items.length,
        }),
      );
      let sites: Map<string, string> | undefined;
      if (catalog && page.items.some((e) => SITE_RESOURCES.has(e.resource))) {
        try {
          sites = new Map((await catalog.listSites()).map((s) => [s.id, s.displayName]));
        } catch {
          // Enrichissement facultatif, comme pour les mails.
        }
      }
      return {
        total: page.total,
        limit: req.query.limit,
        offset: req.query.offset,
        items: (await Promise.all(page.items.map((e) => withMailName(e, index)))).map((e) =>
          withSiteName(e, sites),
        ),
      };
    },
  );
}
