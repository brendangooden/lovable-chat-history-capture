#!/usr/bin/env bun
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, type Config } from "./config.ts";
import {
  AuthError,
  exchangeRefreshToken,
  writeRotatedRefreshToken,
} from "./auth.ts";
import {
  FirestoreError,
  decodeFields,
  docIdFromName,
  listAllDocuments,
  type FirestoreDocument,
} from "./firestore.ts";
import {
  downloadAttachmentIfMissing,
  type ImageRef,
} from "./storage.ts";
import {
  isUnchanged,
  loadManifest,
  saveManifest,
  type Manifest,
} from "./manifest.ts";
import { writeTimeline, type TimelineMessage } from "./timeline.ts";

async function main(): Promise<void> {
  const config = loadConfig(process.argv.slice(2));

  const rawDir = join(config.outDir, "raw");
  const editsDir = join(config.outDir, "edits");
  const attachmentsDir = join(config.outDir, "attachments");
  const timelinePath = join(config.outDir, "timeline.md");
  const manifestPath = join(config.outDir, "index.json");

  await mkdir(rawDir, { recursive: true });
  await mkdir(editsDir, { recursive: true });
  await mkdir(attachmentsDir, { recursive: true });

  const { idToken, refreshToken, rotated } = await exchangeRefreshToken(
    config.apiKey,
    config.refreshToken,
  );
  console.log("Exchanged token ✓");

  if (rotated) {
    if (config.envFilePath) {
      await writeRotatedRefreshToken(config.envFilePath, refreshToken);
      console.log(
        `Refresh token rotated — wrote new value to ${config.envFilePath}`,
      );
    } else {
      console.warn(
        "⚠ Refresh token rotated but no .env file to update. Re-capture from browser or update your secret.",
      );
    }
  }

  const encodedProjectId = encodeURIComponent(config.projectId);
  const trajectoryPath = `projects/${encodedProjectId}/trajectory`;
  const editsPath = `projects/${encodedProjectId}/edits`;

  const [trajectoryDocs, editDocs] = await Promise.all([
    listAllDocuments(config.firestoreProject, idToken, trajectoryPath),
    listAllDocuments(config.firestoreProject, idToken, editsPath),
  ]);
  console.log(
    `Fetched ${trajectoryDocs.length} trajectory, ${editDocs.length} edits`,
  );

  const manifest = await loadManifest(manifestPath);

  const trajectoryStats = await syncTrajectory({
    config,
    idToken,
    docs: trajectoryDocs,
    manifest,
    rawDir,
    attachmentsDir,
  });

  const editStats = await syncEdits({
    docs: editDocs,
    manifest,
    editsDir,
    since: config.since,
  });

  console.log(
    `Trajectory: ${trajectoryStats.wrote} new/updated, ${trajectoryStats.skipped} skipped · ` +
      `Edits: ${editStats.wrote} new/updated, ${editStats.skipped} skipped · ` +
      `Attachments: ${trajectoryStats.attachmentsDownloaded} downloaded, ` +
      `${trajectoryStats.attachmentsDenied} denied, ` +
      `${trajectoryStats.attachmentsFailed} failed`,
  );

  const messages = await assembleTimeline({ rawDir, editsDir });
  await writeTimeline(timelinePath, messages);
  console.log(`Wrote timeline.md (${messages.length} messages)`);

  await saveManifest(manifestPath, manifest);
  console.log("Saved index.json");
}

interface TrajectoryStats {
  wrote: number;
  skipped: number;
  attachmentsDownloaded: number;
  attachmentsDenied: number;
  attachmentsFailed: number;
}

async function syncTrajectory(args: {
  config: Config;
  idToken: string;
  docs: FirestoreDocument[];
  manifest: Manifest;
  rawDir: string;
  attachmentsDir: string;
}): Promise<TrajectoryStats> {
  const stats: TrajectoryStats = {
    wrote: 0,
    skipped: 0,
    attachmentsDownloaded: 0,
    attachmentsDenied: 0,
    attachmentsFailed: 0,
  };

  for (const doc of args.docs) {
    const id = docIdFromName(doc.name);

    if (
      !passesSinceFilter(doc.updateTime, args.config.since) ||
      isUnchanged(args.manifest, id, doc.updateTime)
    ) {
      stats.skipped++;
      continue;
    }

    const decoded = decodeFields(doc.fields);

    const images = Array.isArray((decoded as { images?: unknown }).images)
      ? ((decoded as { images: ImageRef[] }).images)
      : [];

    if (images.length > 0) {
      const enriched: Array<ImageRef & { local_path?: string }> = [];
      for (const img of images) {
        const result = await downloadAttachmentIfMissing(
          args.config.lovableApiBase,
          args.idToken,
          args.attachmentsDir,
          img,
        );
        if (result.kind === "ok") {
          stats.attachmentsDownloaded++;
          enriched.push({ ...img, local_path: result.download.localPath });
        } else if (result.kind === "denied") {
          stats.attachmentsDenied++;
          enriched.push(img);
        } else if (result.kind === "error") {
          stats.attachmentsFailed++;
          console.warn(
            `  ⚠ attachment ${result.sourcePath} failed (${result.status}): ${result.message}`,
          );
          enriched.push(img);
        } else {
          enriched.push(img);
        }
      }
      (decoded as Record<string, unknown>).images = enriched;
    }

    const payload = {
      id,
      name: doc.name,
      createTime: doc.createTime,
      updateTime: doc.updateTime,
      fields: decoded,
    };

    const filePath = join(args.rawDir, `${id}.json`);
    await writeFile(
      filePath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );

    args.manifest.entries[id] = {
      kind: "trajectory",
      updateTime: doc.updateTime,
      createdAt: typeof (decoded as { created_at?: unknown }).created_at ===
        "string"
        ? ((decoded as { created_at: string }).created_at)
        : undefined,
    };
    stats.wrote++;
  }

  return stats;
}

async function syncEdits(args: {
  docs: FirestoreDocument[];
  manifest: Manifest;
  editsDir: string;
  since: string | undefined;
}): Promise<{ wrote: number; skipped: number }> {
  let wrote = 0;
  let skipped = 0;

  for (const doc of args.docs) {
    const id = docIdFromName(doc.name);
    if (
      !passesSinceFilter(doc.updateTime, args.since) ||
      isUnchanged(args.manifest, id, doc.updateTime)
    ) {
      skipped++;
      continue;
    }

    const decoded = decodeFields(doc.fields);
    const slim = slimEdit(decoded);

    const payload = {
      id,
      name: doc.name,
      createTime: doc.createTime,
      updateTime: doc.updateTime,
      fields: slim,
    };

    const filePath = join(args.editsDir, `${id}.json`);
    await writeFile(
      filePath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );

    args.manifest.entries[id] = {
      kind: "edit",
      updateTime: doc.updateTime,
      createdAt: typeof (decoded as { created_at?: unknown }).created_at ===
        "string"
        ? ((decoded as { created_at: string }).created_at)
        : undefined,
    };
    wrote++;
  }

  return { wrote, skipped };
}

function slimEdit(decoded: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(decoded)) {
    if (k === "diff" && Array.isArray(v)) {
      out[k] = v.map((entry) => {
        if (entry && typeof entry === "object") {
          const { old_content, new_content, ...rest } = entry as Record<
            string,
            unknown
          >;
          return rest;
        }
        return entry;
      });
    } else {
      out[k] = v;
    }
  }
  return out;
}

function passesSinceFilter(
  updateTime: string | undefined,
  since: string | undefined,
): boolean {
  if (!since || !updateTime) return true;
  return updateTime >= since;
}

async function assembleTimeline(args: {
  rawDir: string;
  editsDir: string;
}): Promise<TimelineMessage[]> {
  const editsById = await loadEditsIndex(args.editsDir);

  const files = (await readdir(args.rawDir)).filter((f) => f.endsWith(".json"));
  const messages: TimelineMessage[] = [];

  for (const file of files) {
    const raw = await readFile(join(args.rawDir, file), "utf8");
    const parsed = JSON.parse(raw) as {
      id: string;
      fields: Record<string, unknown>;
    };
    const f = parsed.fields;
    const role = typeof f.role === "string" ? f.role : "unknown";
    const content = typeof f.content === "string" ? f.content : "";
    const createdAt = typeof f.created_at === "string" ? f.created_at : "";
    const currentPage =
      typeof f.current_page === "string" ? f.current_page : undefined;
    const editId = typeof f.edit_id === "string" ? f.edit_id : undefined;
    const costCredits =
      typeof f.cost_credits === "number" ? f.cost_credits : undefined;

    const attachments: string[] = [];
    if (Array.isArray(f.images)) {
      for (const img of f.images) {
        if (img && typeof img === "object") {
          const local = (img as { local_path?: unknown }).local_path;
          if (typeof local === "string") attachments.push(local);
        }
      }
    }

    const filesTouched: { path: string; action: string }[] = [];
    let commitSha: string | undefined;
    if (editId && editsById.has(editId)) {
      const edit = editsById.get(editId)!;
      commitSha =
        typeof edit.commit_sha === "string" ? edit.commit_sha : undefined;
      if (Array.isArray(edit.diff)) {
        for (const d of edit.diff) {
          if (d && typeof d === "object") {
            const p = (d as { file_path?: unknown }).file_path;
            const a = (d as { action?: unknown }).action;
            if (typeof p === "string") {
              filesTouched.push({
                path: p,
                action: typeof a === "string" ? a : "unknown",
              });
            }
          }
        }
      }
    } else if (Array.isArray(f.patch)) {
      for (const d of f.patch) {
        if (d && typeof d === "object") {
          const p = (d as { path?: unknown }).path;
          const a = (d as { action?: unknown }).action;
          if (typeof p === "string") {
            filesTouched.push({
              path: p,
              action: typeof a === "string" ? a : "unknown",
            });
          }
        }
      }
    }

    messages.push({
      id: parsed.id,
      role,
      content,
      createdAt,
      attachments,
      filesTouched,
      commitSha,
      costCredits,
      currentPage,
    });
  }

  return messages;
}

async function loadEditsIndex(
  editsDir: string,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  let files: string[];
  try {
    files = (await readdir(editsDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return map;
  }
  for (const file of files) {
    try {
      const raw = await readFile(join(editsDir, file), "utf8");
      const parsed = JSON.parse(raw) as {
        id: string;
        fields: Record<string, unknown>;
      };
      map.set(parsed.id, parsed.fields);
    } catch {
      /* skip malformed */
    }
  }
  return map;
}

main().catch((err) => {
  if (err instanceof AuthError) {
    console.error(`auth: ${err.message}`);
    process.exit(1);
  }
  if (err instanceof FirestoreError) {
    console.error(`firestore: ${err.message}`);
    process.exit(2);
  }
  console.error(err);
  process.exit(3);
});
