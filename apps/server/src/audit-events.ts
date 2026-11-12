import type { AuditAction, AuditEvent, AuditLog } from '@backup365/core';
import type { FastifyRequest } from 'fastify';

/** Auteur d'une requête. Aucune authentification pour l'instant (ADR 0002) : un seul point à changer. */
export function actorOf(): string {
  return 'anonymous';
}

/** Événement d'audit d'une requête, daté maintenant. */
export function auditEvent(
  action: AuditAction,
  resource: string,
  extra: Pick<AuditEvent, 'target' | 'count' | 'reason'> = {},
): AuditEvent {
  return { at: new Date().toISOString(), actor: actorOf(), action, resource, ...extra };
}

/**
 * Consigne un accès refusé ou en échec. L'échec de consignation est journalisé sans bloquer la
 * réponse d'erreur : rien n'a été renvoyé à l'appelant.
 */
export async function recordDenied(
  audit: AuditLog,
  req: FastifyRequest,
  resource: string,
  reason: string,
): Promise<void> {
  try {
    await audit.record(auditEvent('access.denied', resource, { reason }));
  } catch {
    req.log.error('consignation de l’accès refusé en échec');
  }
}
