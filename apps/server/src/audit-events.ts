import type { AuditAction, AuditEvent, AuditLog } from '@backup365/core';
import type { FastifyRequest } from 'fastify';

/**
 * Auteur d'une requête : le compte de la session. Les routes d'API exigent une session
 * (auth-hook.ts) ; `anonymous` ne sert qu'aux routes publiques, qui ne consignent que des échecs.
 */
export function actorOf(req: FastifyRequest): string {
  return req.session?.username ?? 'anonymous';
}

/** Événement d'audit d'une requête, daté maintenant. */
export function auditEvent(
  req: FastifyRequest,
  action: AuditAction,
  resource: string,
  extra: Pick<AuditEvent, 'target' | 'count' | 'reason'> = {},
): AuditEvent {
  return { at: new Date().toISOString(), actor: actorOf(req), action, resource, ...extra };
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
    await audit.record(auditEvent(req, 'access.denied', resource, { reason }));
  } catch {
    req.log.error('consignation de l’accès refusé en échec');
  }
}
