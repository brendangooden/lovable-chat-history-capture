#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AuthError,
  exchangeRefreshToken,
  writeRotatedRefreshToken,
} from "./auth.ts";
import { loadConfig } from "./config.ts";
import { FirestoreError, listAllDocuments } from "./firestore.ts";
import { loadManifest, saveManifest } from "./manifest.ts";
import { syncEdits, syncTrajectory } from "./sync.ts";
import { buildTimeline, writeTimeline } from "./timeline.ts";

const EXIT_OK = 0;
const EXIT_AUTH = 1;
const EXIT_FETCH = 2;
const EXIT_UNKNOWN = 3;

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

  const messages = await buildTimeline({ rawDir, editsDir });
  await writeTimeline(timelinePath, messages);
  console.log(`Wrote timeline.md (${messages.length} messages)`);

  await saveManifest(manifestPath, manifest);
  console.log("Saved index.json");
}

main()
  .then(() => process.exit(EXIT_OK))
  .catch((err) => {
    if (err instanceof AuthError) {
      console.error(`auth: ${err.message}`);
      process.exit(EXIT_AUTH);
    }
    if (err instanceof FirestoreError) {
      console.error(`firestore: ${err.message}`);
      process.exit(EXIT_FETCH);
    }
    console.error(err);
    process.exit(EXIT_UNKNOWN);
  });
