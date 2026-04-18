import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type ManifestKind = "trajectory" | "edit" | "attachment";

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
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed.version === 1 && parsed.entries) return parsed;
  } catch {
    /* fall through to fresh manifest */
  }
  return { version: 1, generatedAt: new Date().toISOString(), entries: {} };
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
