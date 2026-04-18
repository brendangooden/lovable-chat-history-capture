import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isUnchanged,
  loadManifest,
  saveManifest,
  type Manifest,
} from "../src/manifest.ts";

describe("manifest", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lovable-manifest-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("loadManifest returns fresh when file missing", async () => {
    const manifest = await loadManifest(join(dir, "index.json"));
    expect(manifest.version).toBe(1);
    expect(manifest.entries).toEqual({});
    expect(typeof manifest.generatedAt).toBe("string");
  });

  test("round-trip preserves entries", async () => {
    const path = join(dir, "index.json");
    const seed: Manifest = {
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      entries: {
        umsg_a: {
          kind: "trajectory",
          updateTime: "2026-04-17T00:00:00Z",
          createdAt: "2026-04-16T23:59:00Z",
        },
        edt_b: { kind: "edit", updateTime: "2026-04-17T00:01:00Z" },
      },
    };

    await saveManifest(path, seed);
    const loaded = await loadManifest(path);

    expect(loaded.entries).toEqual(seed.entries);
    // saveManifest updates generatedAt — compare structure not equality.
    expect(loaded.version).toBe(1);
  });

  test("corrupt JSON is quarantined and fresh manifest returned", async () => {
    const path = join(dir, "index.json");
    await writeFile(path, "{this is not json", "utf8");

    const manifest = await loadManifest(path);

    expect(manifest.entries).toEqual({});
    const entries = await readdir(dir);
    const corrupt = entries.find((e) => e.includes("corrupt"));
    expect(corrupt).toBeDefined();
    const contents = await readFile(join(dir, corrupt!), "utf8");
    expect(contents).toBe("{this is not json");
  });

  test("wrong-version manifest is quarantined", async () => {
    const path = join(dir, "index.json");
    await writeFile(path, JSON.stringify({ version: 2, entries: {} }), "utf8");

    const manifest = await loadManifest(path);

    expect(manifest.entries).toEqual({});
    const entries = await readdir(dir);
    expect(entries.some((e) => e.includes("corrupt"))).toBe(true);
  });

  test("isUnchanged returns false when entry missing", () => {
    const manifest: Manifest = {
      version: 1,
      generatedAt: "x",
      entries: {},
    };
    expect(isUnchanged(manifest, "any", "2026-04-17T00:00:00Z")).toBe(false);
  });

  test("isUnchanged matches on updateTime", () => {
    const manifest: Manifest = {
      version: 1,
      generatedAt: "x",
      entries: {
        a: { kind: "trajectory", updateTime: "2026-04-17T00:00:00Z" },
      },
    };
    expect(isUnchanged(manifest, "a", "2026-04-17T00:00:00Z")).toBe(true);
    expect(isUnchanged(manifest, "a", "2026-04-17T00:00:01Z")).toBe(false);
  });

  test("isUnchanged returns false when updateTime missing", () => {
    const manifest: Manifest = {
      version: 1,
      generatedAt: "x",
      entries: {
        a: { kind: "trajectory", updateTime: "2026-04-17T00:00:00Z" },
      },
    };
    expect(isUnchanged(manifest, "a", undefined)).toBe(false);
  });
});
