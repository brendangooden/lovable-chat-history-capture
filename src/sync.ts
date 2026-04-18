import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { FirestoreDocument } from "./firestore.ts";
import {
  decodeEditRecord,
  decodeTrajectoryMessage,
  type TrajectoryMessage,
} from "./messages.ts";
import {
  downloadAttachmentIfMissing,
  type ImageRef,
} from "./storage.ts";
import { isUnchanged, type Manifest } from "./manifest.ts";

export interface TrajectoryStats {
  wrote: number;
  skipped: number;
  attachmentsDownloaded: number;
  attachmentsDenied: number;
  attachmentsFailed: number;
}

export interface EditStats {
  wrote: number;
  skipped: number;
}

export interface SyncTrajectoryArgs {
  config: Config;
  idToken: string;
  docs: FirestoreDocument[];
  manifest: Manifest;
  rawDir: string;
  attachmentsDir: string;
}

export interface SyncEditsArgs {
  docs: FirestoreDocument[];
  manifest: Manifest;
  editsDir: string;
  since: string | undefined;
}

export async function syncTrajectory(
  args: SyncTrajectoryArgs,
): Promise<TrajectoryStats> {
  const stats: TrajectoryStats = {
    wrote: 0,
    skipped: 0,
    attachmentsDownloaded: 0,
    attachmentsDenied: 0,
    attachmentsFailed: 0,
  };

  for (const doc of args.docs) {
    const msg = decodeTrajectoryMessage(doc);

    if (
      !passesSinceFilter(msg.updateTime, args.config.since) ||
      isUnchanged(args.manifest, msg.id, msg.updateTime)
    ) {
      stats.skipped++;
      continue;
    }

    if (msg.images.length > 0) {
      const enriched = await enrichAttachments(msg, args, stats);
      msg.raw.images = enriched;
    }

    await writeDoc(args.rawDir, msg.id, msg);

    args.manifest.entries[msg.id] = {
      kind: "trajectory",
      updateTime: msg.updateTime,
      createdAt: msg.createdAt || undefined,
    };
    stats.wrote++;
  }

  return stats;
}

export async function syncEdits(args: SyncEditsArgs): Promise<EditStats> {
  const stats: EditStats = { wrote: 0, skipped: 0 };

  for (const doc of args.docs) {
    const record = decodeEditRecord(doc);

    if (
      !passesSinceFilter(record.updateTime, args.since) ||
      isUnchanged(args.manifest, record.id, record.updateTime)
    ) {
      stats.skipped++;
      continue;
    }

    await writeDoc(args.editsDir, record.id, record);

    args.manifest.entries[record.id] = {
      kind: "edit",
      updateTime: record.updateTime,
    };
    stats.wrote++;
  }

  return stats;
}

export function passesSinceFilter(
  updateTime: string | undefined,
  since: string | undefined,
): boolean {
  if (!since || !updateTime) return true;
  const updateMs = Date.parse(updateTime);
  const sinceMs = Date.parse(since);
  if (Number.isFinite(updateMs) && Number.isFinite(sinceMs)) {
    return updateMs >= sinceMs;
  }
  return updateTime >= since;
}

async function enrichAttachments(
  msg: TrajectoryMessage,
  args: SyncTrajectoryArgs,
  stats: TrajectoryStats,
): Promise<Array<ImageRef & { local_path?: string }>> {
  const enriched: Array<ImageRef & { local_path?: string }> = [];

  for (const img of msg.images) {
    const manifestKey = attachmentKey(img);
    const prior = args.manifest.entries[manifestKey];
    if (prior?.kind === "attachment-denied") {
      stats.attachmentsDenied++;
      enriched.push(img);
      continue;
    }

    const result = await downloadAttachmentIfMissing(
      args.config.lovableApiBase,
      args.idToken,
      args.attachmentsDir,
      img,
    );
    if (result.kind === "ok") {
      stats.attachmentsDownloaded++;
      enriched.push({ ...img, local_path: result.download.localPath });
      args.manifest.entries[manifestKey] = {
        kind: "attachment",
        sourcePath: result.download.sourcePath,
      };
    } else if (result.kind === "denied") {
      stats.attachmentsDenied++;
      enriched.push(img);
      args.manifest.entries[manifestKey] = {
        kind: "attachment-denied",
        sourcePath: result.sourcePath,
        updateTime: new Date().toISOString(),
      };
    } else {
      stats.attachmentsFailed++;
      console.warn(
        `  ⚠ attachment ${result.sourcePath} failed (${result.status}): ${result.message}`,
      );
      enriched.push(img);
    }
  }

  return enriched;
}

function attachmentKey(img: ImageRef): string {
  return `attachment:${img.dir_name}/${img.file_id}`;
}

async function writeDoc(
  dir: string,
  id: string,
  record: { name: string; createTime?: string; updateTime?: string; raw: Record<string, unknown> },
): Promise<void> {
  const payload = {
    id,
    name: record.name,
    createTime: record.createTime,
    updateTime: record.updateTime,
    fields: record.raw,
  };
  await writeFile(
    join(dir, `${id}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}
