import type { FastifyReply } from 'fastify';

/** Réponse d'erreur commune : les 4xx gardent leur message, tout 500 est générique. */
export function sendError(error: unknown, reply: FastifyReply) {
  const { statusCode = 500, message = '' } = error as { statusCode?: number; message?: string };
  if (statusCode >= 400 && statusCode < 500) {
    return reply.code(statusCode).send({ error: 'bad_request', message });
  }
  return reply.code(500).send({ error: 'internal_error' });
}
