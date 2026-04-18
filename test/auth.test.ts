import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRotatedRefreshToken } from "../src/auth.ts";

describe("writeRotatedRefreshToken", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lovable-auth-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("replaces the token line when key already present", async () => {
    const envPath = join(dir, ".env");
    await Bun.write(
      envPath,
      [
        "LOVABLE_FIREBASE_API_KEY=keep-me",
        "LOVABLE_REFRESH_TOKEN=old-token",
        "LOVABLE_PROJECT_ID=abc",
        "",
      ].join("\n"),
    );

    await writeRotatedRefreshToken(envPath, "new-token");

    const contents = await readFile(envPath, "utf8");
    expect(contents).toContain("LOVABLE_REFRESH_TOKEN=new-token");
    expect(contents).not.toContain("old-token");
    expect(contents).toContain("LOVABLE_FIREBASE_API_KEY=keep-me");
    expect(contents).toContain("LOVABLE_PROJECT_ID=abc");
  });

  test("appends the token line when key absent", async () => {
    const envPath = join(dir, ".env");
    await Bun.write(envPath, "LOVABLE_FIREBASE_API_KEY=x\n");

    await writeRotatedRefreshToken(envPath, "brand-new-token");

    const contents = await readFile(envPath, "utf8");
    expect(contents).toContain("LOVABLE_FIREBASE_API_KEY=x");
    expect(contents).toMatch(/LOVABLE_REFRESH_TOKEN=brand-new-token\n$/);
  });

  test("creates file when missing", async () => {
    const envPath = join(dir, ".env");

    await writeRotatedRefreshToken(envPath, "first-token");

    const contents = await readFile(envPath, "utf8");
    expect(contents).toMatch(/LOVABLE_REFRESH_TOKEN=first-token\n$/);
  });

  test("is idempotent on repeat calls with same value", async () => {
    const envPath = join(dir, ".env");
    await Bun.write(envPath, "LOVABLE_REFRESH_TOKEN=stable\n");

    await writeRotatedRefreshToken(envPath, "stable");
    await writeRotatedRefreshToken(envPath, "stable");

    const contents = await readFile(envPath, "utf8");
    expect(contents).toBe("LOVABLE_REFRESH_TOKEN=stable\n");
  });

  test("leaves no temp file behind on success", async () => {
    const envPath = join(dir, ".env");
    await Bun.write(envPath, "LOVABLE_REFRESH_TOKEN=old\n");

    await writeRotatedRefreshToken(envPath, "new");

    const entries = await readdir(dir);
    expect(entries).toEqual([".env"]);
  });
});
