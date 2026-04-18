import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTimeline, writeTimeline } from "../src/timeline.ts";

describe("timeline", () => {
  let dir: string;
  let rawDir: string;
  let editsDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lovable-timeline-"));
    rawDir = join(dir, "raw");
    editsDir = join(dir, "edits");
    await mkdir(rawDir, { recursive: true });
    await mkdir(editsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("builds deterministic timeline from stored docs", async () => {
    const attachmentsDir = join(dir, "attachments");
    await mkdir(attachmentsDir, { recursive: true });
    const attachmentAbs = join(attachmentsDir, "f-001__shot.png");

    await writeStored(rawDir, "umsg_001.json", {
      id: "umsg_001",
      name: "projects/p/databases/(default)/documents/projects/x/trajectory/umsg_001",
      createTime: "2026-04-17T00:00:00Z",
      updateTime: "2026-04-17T00:00:01Z",
      fields: {
        role: "user",
        content: "Please fix the bug.",
        created_at: "2026-04-17T10:00:00Z",
        current_page: "/dashboard",
        images: [
          {
            file_id: "f-001",
            file_name: "shot.png",
            dir_name: "u-abc",
            local_path: attachmentAbs,
          },
        ],
      },
    });
    await writeStored(rawDir, "aimsg_002.json", {
      id: "aimsg_002",
      name: "projects/p/databases/(default)/documents/projects/x/trajectory/aimsg_002",
      createTime: "2026-04-17T00:01:00Z",
      updateTime: "2026-04-17T00:01:01Z",
      fields: {
        role: "ai",
        content: "Done.",
        created_at: "2026-04-17T10:01:00Z",
        cost_credits: 1.3,
        edit_id: "edt-abc",
      },
    });
    await writeStored(editsDir, "edt-abc.json", {
      id: "edt-abc",
      name: "projects/p/databases/(default)/documents/projects/x/edits/edt-abc",
      createTime: "2026-04-17T00:01:00Z",
      updateTime: "2026-04-17T00:01:01Z",
      fields: {
        commit_sha: "4df6f3e",
        diff: [
          { file_path: "src/app.ts", action: "edited" },
          { file_path: "src/util.ts", action: "added" },
        ],
      },
    });

    const messages = await buildTimeline({ rawDir, editsDir });
    expect(messages).toHaveLength(2);

    const timelinePath = join(dir, "timeline.md");
    await writeTimeline(timelinePath, messages);
    const content = await readFile(timelinePath, "utf8");

    expect(content).toContain("## 2026-04-17 10:00:00 UTC · user · `umsg_001`");
    expect(content).toContain("_page: /dashboard_");
    expect(content).toContain("Please fix the bug.");
    expect(content).toContain(
      "**attachments:** `attachments/f-001__shot.png`",
    );

    expect(content).toContain("## 2026-04-17 10:01:00 UTC · ai · `aimsg_002`");
    expect(content).toContain("Done.");
    expect(content).toContain(
      "**files touched:** `src/app.ts` (edited), `src/util.ts` (added) · commit `4df6f3e`",
    );
    expect(content).toContain("_cost: 1.3 credits_");

    const umsgIdx = content.indexOf("umsg_001");
    const aimsgIdx = content.indexOf("aimsg_002");
    expect(umsgIdx).toBeGreaterThan(-1);
    expect(aimsgIdx).toBeGreaterThan(umsgIdx);
  });

  test("writeTimeline output contains no runtime-varying strings", async () => {
    await writeStored(rawDir, "umsg_stable.json", {
      id: "umsg_stable",
      name: "n",
      createTime: "2026-04-17T00:00:00Z",
      updateTime: "2026-04-17T00:00:00Z",
      fields: {
        role: "user",
        content: "hello",
        created_at: "2026-04-17T10:00:00Z",
      },
    });

    const timelinePath = join(dir, "timeline.md");
    const first = await buildTimeline({ rawDir, editsDir });
    await writeTimeline(timelinePath, first);
    const a = await readFile(timelinePath, "utf8");

    // Sleep a tick to ensure "now" would change.
    await new Promise((r) => setTimeout(r, 10));

    const second = await buildTimeline({ rawDir, editsDir });
    await writeTimeline(timelinePath, second);
    const b = await readFile(timelinePath, "utf8");

    expect(a).toBe(b);
  });

  test("drops malformed stored docs silently", async () => {
    await writeFile(join(rawDir, "garbage.json"), "{not json", "utf8");
    await writeStored(rawDir, "umsg_ok.json", {
      id: "umsg_ok",
      name: "n",
      fields: { role: "user", content: "ok", created_at: "2026-04-17T10:00:00Z" },
    });

    const messages = await buildTimeline({ rawDir, editsDir });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.id).toBe("umsg_ok");
  });
});

async function writeStored(
  dir: string,
  filename: string,
  doc: unknown,
): Promise<void> {
  await writeFile(join(dir, filename), JSON.stringify(doc, null, 2), "utf8");
}
