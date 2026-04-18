import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

export type ManifestKind =
  | "trajectory"
  | "edit"
  | "attachment"
  | "attachment-denied";

export interface ManifestEntry {
  kind: ManifestKind;
  updateTime?: string;
  createdAt?: string;
  sourcePath?: string;
}

export interface Manifest {
  version: 1;
  generatedAt: string;
  entries: Record<string, ManifestEntry>;
}

export async function loadManifest(path: string): Promise<Manifest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    // File doesn't exist — that's the expected cold-start path, not an error.
    if (isFileNotFound(err)) return freshManifest();
    console.warn(
      `⚠ Could not read manifest at ${path}: ${describeErr(err)}. Starting fresh.`,
    );
    return freshManifest();
  }

  try {
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed.version === 1 && parsed.entries) return parsed;
    throw new Error(`unexpected manifest shape (version=${parsed.version})`);
  } catch (err) {
    const corruptPath = `${path}.corrupt-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`;
    console.warn(
      `⚠ Manifest at ${path} is corrupt (${describeErr(err)}). ` +
        `Renaming to ${corruptPath} and starting fresh — next run will re-download everything.`,
    );
    try {
      await rename(path, corruptPath);
    } catch (renameErr) {
      console.warn(
        `  (could not rename corrupt manifest: ${describeErr(renameErr)})`,
      );
    }
    return freshManifest();
  }
}

export async function saveManifest(
  path: string,
  manifest: Manifest,
): Promise<void> {
  manifest.generatedAt = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function isUnchanged(
  manifest: Manifest,
  id: string,
  updateTime: string | undefined,
): boolean {
  const existing = manifest.entries[id];
  if (!existing || !updateTime) return false;
  return existing.updateTime === updateTime;
}

function freshManifest(): Manifest {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries: {},
  };
}

function isFileNotFound(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

function describeErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
