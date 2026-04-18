import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  parseStoredEditRecord,
  parseStoredTrajectoryMessage,
  type EditRecord,
  type PatchEntry,
  type StoredDocument,
  type TrajectoryMessage,
} from "./messages.ts";

export interface TimelineMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  attachments: string[];
  filesTouched: PatchEntry[];
  commitSha: string | undefined;
  costCredits: number | undefined;
  currentPage: string | undefined;
}

export interface BuildTimelineArgs {
  rawDir: string;
  editsDir: string;
}

export async function buildTimeline(
  args: BuildTimelineArgs,
): Promise<TimelineMessage[]> {
  const editsById = await loadEditsIndex(args.editsDir);
  const files = await listJson(args.rawDir);
  const messages: TimelineMessage[] = [];

  for (const file of files) {
    const stored = await readStoredDoc(join(args.rawDir, file));
    if (!stored) continue;
    const msg = parseStoredTrajectoryMessage(stored);
    messages.push(buildTimelineMessage(msg, editsById));
  }

  return messages;
}

export async function writeTimeline(
  timelinePath: string,
  messages: TimelineMessage[],
): Promise<void> {
  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const lines: string[] = [
    "# Lovable chat timeline",
    "",
    `_${messages.length} messages_`,
    "",
  ];

  for (const msg of messages) {
    const ts = formatTimestamp(msg.createdAt);
    lines.push(`## ${ts} · ${msg.role || "unknown"} · \`${msg.id}\``);
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

function buildTimelineMessage(
  msg: TrajectoryMessage,
  editsById: Map<string, EditRecord>,
): TimelineMessage {
  const attachments = msg.images
    .map((img) => {
      const raw = img as ImageRefWithLocalPath;
      return typeof raw.local_path === "string" ? raw.local_path : undefined;
    })
    .filter((p): p is string => p !== undefined);

  let filesTouched: PatchEntry[] = msg.patch;
  let commitSha: string | undefined;

  if (msg.editId) {
    const edit = editsById.get(msg.editId);
    if (edit) {
      filesTouched = edit.diff.length > 0 ? edit.diff : msg.patch;
      commitSha = edit.commitSha;
    }
  }

  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
    attachments,
    filesTouched,
    commitSha,
    costCredits: msg.costCredits,
    currentPage: msg.currentPage,
  };
}

interface ImageRefWithLocalPath {
  local_path?: unknown;
}

async function loadEditsIndex(
  editsDir: string,
): Promise<Map<string, EditRecord>> {
  const map = new Map<string, EditRecord>();
  const files = await listJson(editsDir);
  for (const file of files) {
    const stored = await readStoredDoc(join(editsDir, file));
    if (!stored) continue;
    const record = parseStoredEditRecord(stored);
    map.set(record.id, record);
  }
  return map;
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

async function readStoredDoc(path: string): Promise<StoredDocument | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredDocument>;
    if (
      typeof parsed.id === "string" &&
      typeof parsed.name === "string" &&
      parsed.fields &&
      typeof parsed.fields === "object"
    ) {
      return {
        id: parsed.id,
        name: parsed.name,
        createTime: parsed.createTime,
        updateTime: parsed.updateTime,
        fields: parsed.fields as Record<string, unknown>,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function formatTimestamp(iso: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19);
  return `${date} ${time} UTC`;
}

function relForTimeline(timelinePath: string, target: string): string {
  return relative(dirname(timelinePath), target).replace(/\\/g, "/");
}
