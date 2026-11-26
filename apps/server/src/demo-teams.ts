import type { Writable } from 'node:stream';
import { crc32 } from 'node:zlib';
import type { AtlasHandle } from './atlas-sdk.js';

const HOUR = 3_600_000;

/**
 * Équipes Teams fictives et leurs canaux. `ageHours` : âge du dernier instantané ; la seconde
 * équipe est en retard, comme la ligne « En retard » de la maquette (#34).
 */
export const DEMO_TEAMS = [
  {
    id: 'team-voirie',
    name: 'Équipe Voirie',
    ageHours: 5,
    channels: [
      { id: 'chan-voirie-general', name: 'Général', messages: 182 },
      { id: 'chan-voirie-chantiers', name: 'Chantiers', messages: 64 },
    ],
  },
  {
    id: 'team-accueil',
    name: 'Accueil du public',
    ageHours: 50,
    channels: [{ id: 'chan-accueil-general', name: 'Général', messages: 37 }],
  },
] as const;

/** Zip d'un seul fichier, sans compression : une archive valide, sans dépendance. */
export function singleFileZip(name: string, content: string): Buffer {
  const fileName = Buffer.from(name, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version
  local.writeUInt16LE(0x0800, 6); // noms en UTF-8
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  const centralOffset = local.length + fileName.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, fileName, data, central, fileName, end]);
}

/** Faux `teams` du SDK pour la démo : deux instantanés par équipe, export d'un canal en zip. */
export function demoTeamsApi(now: number): NonNullable<AtlasHandle['teams']> {
  const snapshotsOf = (teamId: string) => {
    const team = DEMO_TEAMS.find((t) => t.id === teamId);
    if (!team) return [];
    return [team.ageHours, team.ageHours + 24].map((age, k) => ({
      snapshotId: `snap-tm-${team.id}-${k + 1}`,
      createdAt: new Date(now - age * HOUR),
      teamDisplayName: team.name,
      channels: team.channels.map((c) => ({
        channelId: c.id,
        displayName: c.name,
        messageCount: c.messages - k * 4,
      })),
    }));
  };
  return {
    listSnapshots: (teamId) => Promise.resolve({ indexes: snapshotsOf(teamId) }),
    save: async (
      teamId,
      options: { snapshotId: string; channelId?: string; output?: Writable },
    ) => {
      const channel = snapshotsOf(teamId)
        .find((s) => s.snapshotId === options.snapshotId)
        ?.channels.find((c) => c.channelId === options.channelId);
      const zip = singleFileZip(
        'LISEZMOI.txt',
        'Archive de démonstration : aucun message réel. Une vraie archive contient team.json, ' +
          'les messages du canal (messages.json) et leur transcription HTML.\n',
      );
      await new Promise<void>((resolve, reject) => {
        options.output?.end(zip, () => {
          resolve();
        });
        if (!options.output) resolve();
        options.output?.once('error', reject);
      });
      return { messagesSaved: channel?.messageCount ?? 0, hostedMissing: [], interrupted: false };
    },
  };
}
