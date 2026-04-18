import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

export interface TimelineMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  attachments: string[];
  filesTouched: { path: string; action: string }[];
  commitSha: string | undefined;
  costCredits: number | undefined;
  currentPage: string | undefined;
}

export async function writeTimeline(
  timelinePath: string,
  messages: TimelineMessage[],
): Promise<void> {
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const lines: string[] = [
    "# Lovable chat timeline",
    "",
    `_Generated ${new Date().toISOString()} · ${messages.length} messages_`,
    "",
  ];

  for (const msg of messages) {
    const ts = formatTimestamp(msg.createdAt);
    const roleLabel = msg.role === "ai" ? "ai" : msg.role;
    lines.push(`## ${ts} · ${roleLabel} · \`${msg.id}\``);
    if (msg.currentPage) {
      lines.push(`_page: ${msg.currentPage}_`);
    }
    lines.push("");
    lines.push(msg.content.trim() || "_(empty)_");
    lines.push("");

    if (msg.attachments.length > 0) {
      const rels = msg.attachments.map((p) => relForTimeline(timelinePath, p));
      lines.push(`**attachments:** ${rels.map((r) => `\`${r}\``).join(", ")}`);
      lines.push("");
    }

    if (msg.filesTouched.length > 0) {
      const bits = msg.filesTouched.map(
        (f) => `\`${f.path}\` (${f.action})`,
      );
      const commit = msg.commitSha ? ` · commit \`${msg.commitSha}\`` : "";
      lines.push(`**files touched:** ${bits.join(", ")}${commit}`);
      lines.push("");
    }

    if (msg.costCredits !== undefined) {
      lines.push(`_cost: ${msg.costCredits} credits_`);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  await mkdir(dirname(timelinePath), { recursive: true });
  await writeFile(timelinePath, lines.join("\n"), "utf8");
}

function formatTimestamp(iso: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time} UTC`;
}

function relForTimeline(timelinePath: string, target: string): string {
  return relative(dirname(timelinePath), target).replace(/\\/g, "/");
}
