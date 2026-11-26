import type { Loaded } from './onedrive.js';
import { TEAMS_PRIVATE_CHATS } from './plans/model.js';
import { dateTimeOf, quoted } from './format.js';

/** Restaurer depuis Teams (issue #34, docs/adr/0022) : un canal, exporté en archive zip. */
export const TEAMS_HASH = '#/teams';

export interface Team {
  id: string;
  displayName: string;
}

export interface TeamChannel {
  id: string;
  name: string;
  messageCount: number;
}

export interface TeamSnapshot {
  id: string;
  createdAt: string;
  channels: TeamChannel[];
}

/** Ce que l'opérateur a choisi à l'étape 1. */
export interface TeamsChoice {
  team: Team;
  channel: TeamChannel;
  snapshot: TeamSnapshot;
}

/** Archive reçue : nom proposé au navigateur et nombre de messages. */
export interface TeamsExportDone {
  filename: string;
  messages: number;
  /** Pièces jointes que la sauvegarde n'avait pas copiées. */
  missing: number;
}

export const TEAMS_MESSAGES = {
  title: 'Restaurer depuis Teams',
  loading: 'Chargement des équipes…',
  loadingChannels: 'Chargement des canaux…',
  privateChats: TEAMS_PRIVATE_CHATS,
  notProtected: 'Teams n’est pas encore protégé.',
  askAdmin: 'Demandez à un administrateur de créer un plan.',
  createPlan: 'Créer un plan',
  readError: 'Impossible de lire les sauvegardes Teams.',
  readAdvice:
    'Réessayez ; si l’erreur persiste, prévenez l’exploitant du serveur avec l’heure de l’essai.',
  noChannel: 'Aucune sauvegarde Teams n’est disponible pour ce canal à cette date.',
  otherDate: 'Choisir une autre date',
  channelHelp: 'La liste des canaux suit l’équipe choisie.',
  content: 'Contenu : les messages du canal.',
  filesHint:
    'Les fichiers d’un canal sont dans le site SharePoint de l’équipe : restaurez-les depuis l’onglet « Sites SharePoint ».',
  destination: 'Destination : une archive à télécharger (.zip), messages et transcription HTML.',
  noReturn:
    'La remise des messages dans le canal d’origine n’existe pas encore dans le moteur de sauvegarde.',
  running: 'Restauration en cours…',
  done: 'Restauration terminée.',
  generic: 'La demande a échoué. Réessayez.',
} as const;

/** Phrase du récapitulatif (étape 3). */
export function teamsSummary(choice: TeamsChoice, reason: string): string {
  const at = dateTimeOf(choice.snapshot.createdAt);
  return (
    `Vous allez exporter les messages du canal ${quoted(choice.channel.name)} de l’équipe ` +
    `${quoted(choice.team.displayName)}, sauvegardés le ${at} UTC. Motif : ${quoted(reason)}. ` +
    'Cette action sera inscrite au journal d’audit.'
  );
}

/** Canaux connus d'une équipe, toutes dates confondues, avec le nom le plus récent. */
export function channelsOf(snapshots: readonly TeamSnapshot[]): TeamChannel[] {
  const seen = new Map<string, TeamChannel>();
  // Du plus récent au plus ancien : le premier nom rencontré est le plus récent.
  for (const snapshot of snapshots) {
    for (const channel of snapshot.channels)
      if (!seen.has(channel.id)) seen.set(channel.id, channel);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Nom de fichier de l'archive : canal et date, sans caractère réservé. */
export function archiveName(choice: TeamsChoice): string {
  const slug = choice.channel.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `teams-${slug || 'canal'}-${choice.snapshot.createdAt.slice(0, 10)}.zip`;
}

async function load<T>(
  url: string,
  pick: (body: never) => T,
  fetchFn: typeof fetch,
): Promise<Loaded<T>> {
  try {
    const res = await fetchFn(url);
    if (res.ok) return { status: 'ok', data: pick((await res.json()) as never) };
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (res.status === 503 && body?.error === 'catalog_unavailable')
      return { status: 'unconfigured' };
    if (res.status === 503 && body?.error === 'no_backup_found') return { status: 'no_backup' };
    return { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

const teamUrl = (id: string): string => `/api/teams/${encodeURIComponent(id)}`;

export function fetchTeams(fetchFn: typeof fetch = fetch): Promise<Loaded<Team[]>> {
  return load('/api/teams/teams', (b: { teams: Team[] }) => b.teams, fetchFn);
}

export function fetchTeamSnapshots(
  teamId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Loaded<TeamSnapshot[]>> {
  return load(
    `${teamUrl(teamId)}/snapshots`,
    (b: { snapshots: TeamSnapshot[] }) => b.snapshots,
    fetchFn,
  );
}

/** Cause d'un échec d'export, lisible : le code du serveur, jamais son message. */
const CAUSES: Record<string, string> = {
  reason_required: 'le motif est vide',
  item_not_found: 'ce canal n’est plus dans la sauvegarde à cette date',
  export_too_large: 'l’archive dépasse la taille qu’accepte le serveur',
  export_busy: 'deux exports Teams sont déjà en cours sur le serveur',
  audit_unavailable: 'le journal d’audit est indisponible',
  catalog_unavailable: 'le stockage des sauvegardes ne répond pas',
};

/** Erreur d'export : son message est la cause, déjà rédigée pour le bandeau d'échec. */
export class TeamsExportError extends Error {
  constructor(cause: string) {
    super(cause);
    this.name = 'TeamsExportError';
  }
}

/** Demande l'archive d'un canal ; lève `TeamsExportError` avec une cause lisible. */
export async function exportChannel(
  choice: TeamsChoice,
  reason: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ blob: Blob; done: TeamsExportDone }> {
  let res: Response;
  try {
    res = await fetchFn(`${teamUrl(choice.team.id)}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        snapshotId: choice.snapshot.id,
        channelId: choice.channel.id,
        reason: reason.trim(),
      }),
    });
  } catch {
    throw new TeamsExportError('le serveur ne répond pas');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const code = typeof body?.error === 'string' ? body.error : '';
    throw new TeamsExportError(CAUSES[code] ?? 'le serveur a refusé la demande');
  }
  const count = (name: string) => Number(res.headers.get(name) ?? 0) || 0;
  return {
    blob: await res.blob(),
    done: {
      filename: archiveName(choice),
      messages: count('x-backup365-messages'),
      missing: count('x-backup365-omitted-attachments'),
    },
  };
}
