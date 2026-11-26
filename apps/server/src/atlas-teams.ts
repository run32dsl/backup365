import { PassThrough, type Writable } from 'node:stream';
import { CatalogUnavailableError } from '@backup365/core';

/** Canal d'une équipe dans un instantané : nom et nombre de messages, jamais leur contenu. */
export interface TeamChannel {
  id: string;
  name: string;
  messageCount: number;
}

/** Instantané d'une équipe, avec ses canaux (docs/adr/0022). */
export interface TeamSnapshot {
  id: string;
  /** UTC, ISO 8601. */
  createdAt: string;
  channels: TeamChannel[];
}

/** Archive zip d'un canal et ce qu'elle contient. */
export interface TeamExport {
  bytes: Buffer;
  messages: number;
  /** Pièces jointes que la sauvegarde n'avait pas pu copier : absentes de l'archive. */
  missing: number;
}

/** Lecture des sauvegardes Teams : stockage seul, sans Graph. */
export interface TeamsArchive {
  /** Instantanés d'une équipe, du plus récent au plus ancien ; vide si l'équipe est inconnue. */
  listSnapshots(teamId: string): Promise<TeamSnapshot[]>;
  /** Archive d'un canal d'un instantané (messages en JSON et transcription HTML). */
  exportChannel(teamId: string, snapshotId: string, channelId: string): Promise<TeamExport>;
}

/**
 * Sous-ensemble de `AtlasInstance.teams` (SDK 7.2.0) : `listSnapshots` lit les index, `save`
 * écrit le zip « Reads storage only; never calls Graph » (`TeamsSaveService`).
 */
export interface AtlasTeamsReader {
  teams: {
    listSnapshots(teamId: string): Promise<{
      indexes: readonly {
        snapshotId: string;
        createdAt: Date;
        channels: readonly {
          channelId: string;
          displayName?: string | undefined;
          messageCount: number;
        }[];
      }[];
    }>;
    save(
      teamId: string,
      options: { snapshotId: string; channelId?: string; output?: Writable },
    ): Promise<{ messagesSaved: number; hostedMissing: readonly string[]; interrupted: boolean }>;
  };
}

/** Plafond d'une archive gardée en mémoire avant l'envoi : au-delà, refus plutôt qu'épuisement. */
export const MAX_EXPORT_BYTES = 512 * 1024 * 1024;

/** L'archive dépasse `MAX_EXPORT_BYTES`. */
export class TeamExportTooLargeError extends Error {
  constructor() {
    super('Archive Teams trop volumineuse');
    this.name = 'TeamExportTooLargeError';
  }
}

export class AtlasSdkTeamsArchive implements TeamsArchive {
  constructor(
    private readonly atlas: AtlasTeamsReader,
    private readonly maxBytes: number = MAX_EXPORT_BYTES,
  ) {}

  async listSnapshots(teamId: string): Promise<TeamSnapshot[]> {
    const listing = await this.call(() => this.atlas.teams.listSnapshots(teamId));
    return listing.indexes
      .map((index) => ({
        id: index.snapshotId,
        createdAt: index.createdAt.toISOString(),
        channels: index.channels.map((c) => ({
          id: c.channelId,
          name: c.displayName || c.channelId,
          messageCount: c.messageCount,
        })),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * L'archive est construite en entier avant l'envoi : une erreur en cours de route rend un code
   * d'erreur au lieu d'un zip tronqué, et l'export n'est consigné qu'une fois l'archive prête.
   */
  async exportChannel(teamId: string, snapshotId: string, channelId: string): Promise<TeamExport> {
    const chunks: Buffer[] = [];
    let size = 0;
    const output = new PassThrough();
    output.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > this.maxBytes) output.destroy(new TeamExportTooLargeError());
      else chunks.push(chunk);
    });
    const ended = new Promise<void>((resolve, reject) => {
      output.on('end', resolve);
      output.on('close', resolve);
      output.on('error', reject);
    });
    // Si `save` échoue aussi, c'est son erreur qui remonte : celle du flux ne doit pas rester orpheline.
    ended.catch(() => undefined);
    let result;
    try {
      result = await this.call(() =>
        this.atlas.teams.save(teamId, { snapshotId, channelId, output }),
      );
    } catch (err) {
      // Flux coupé pour taille : le SDK rejette alors avec sa propre erreur, la vraie cause est la taille.
      if (size > this.maxBytes) throw new TeamExportTooLargeError();
      throw err;
    }
    // Le SDK ferme le flux qu'on lui confie ; sinon, on le ferme pour ne jamais attendre sans fin.
    if (!output.writableEnded && !output.destroyed) output.end();
    await ended;
    if (size > this.maxBytes) throw new TeamExportTooLargeError();
    if (result.interrupted) throw new CatalogUnavailableError('Export Teams interrompu');
    return {
      bytes: Buffer.concat(chunks),
      messages: result.messagesSaved,
      missing: result.hostedMissing.length,
    };
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TeamExportTooLargeError) throw err;
      // Le message d'origine peut contenir des détails de stockage : il reste dans `cause`.
      throw new CatalogUnavailableError('Sauvegardes Teams indisponibles', { cause: err });
    }
  }
}
