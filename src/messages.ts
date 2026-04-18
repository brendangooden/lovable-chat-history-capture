import {
  decodeFields,
  docIdFromName,
  type FirestoreDocument,
} from "./firestore.ts";
import { isImageRef, type ImageRef } from "./storage.ts";

export interface PatchEntry {
  path: string;
  action: string;
}

export interface TrajectoryMessage {
  id: string;
  name: string;
  role: string;
  content: string;
  createdAt: string;
  createTime: string | undefined;
  updateTime: string | undefined;
  currentPage: string | undefined;
  editId: string | undefined;
  costCredits: number | undefined;
  images: ImageRef[];
  patch: PatchEntry[];
  raw: Record<string, unknown>;
}

export interface EditRecord {
  id: string;
  name: string;
  createTime: string | undefined;
  updateTime: string | undefined;
  commitSha: string | undefined;
  number: number | undefined;
  diff: PatchEntry[];
  raw: Record<string, unknown>;
}

export interface StoredDocument {
  id: string;
  name: string;
  createTime?: string;
  updateTime?: string;
  fields: Record<string, unknown>;
}

export function decodeTrajectoryMessage(
  doc: FirestoreDocument,
): TrajectoryMessage {
  return buildTrajectoryMessage({
    id: docIdFromName(doc.name),
    name: doc.name,
    createTime: doc.createTime,
    updateTime: doc.updateTime,
    fields: decodeFields(doc.fields),
  });
}

export function decodeEditRecord(doc: FirestoreDocument): EditRecord {
  return buildEditRecord({
    id: docIdFromName(doc.name),
    name: doc.name,
    createTime: doc.createTime,
    updateTime: doc.updateTime,
    fields: slimEdit(decodeFields(doc.fields)),
  });
}

export function parseStoredTrajectoryMessage(
  stored: StoredDocument,
): TrajectoryMessage {
  return buildTrajectoryMessage(stored);
}

export function parseStoredEditRecord(stored: StoredDocument): EditRecord {
  return buildEditRecord(stored);
}

function buildTrajectoryMessage(stored: StoredDocument): TrajectoryMessage {
  const fields = stored.fields;
  return {
    id: stored.id,
    name: stored.name,
    role: asString(fields.role) ?? "",
    content: asString(fields.content) ?? "",
    createdAt: asString(fields.created_at) ?? "",
    createTime: stored.createTime,
    updateTime: stored.updateTime,
    currentPage: asString(fields.current_page),
    editId: asString(fields.edit_id),
    costCredits: asNumber(fields.cost_credits),
    images: asArray(fields.images).filter(isImageRef),
    patch: asArray(fields.patch).flatMap((entry) =>
      toPatchEntry(entry, "path"),
    ),
    raw: fields,
  };
}

function buildEditRecord(stored: StoredDocument): EditRecord {
  const fields = stored.fields;
  return {
    id: stored.id,
    name: stored.name,
    createTime: stored.createTime,
    updateTime: stored.updateTime,
    commitSha: asString(fields.commit_sha),
    number: asNumber(fields.number),
    diff: asArray(fields.diff).flatMap((entry) =>
      toPatchEntry(entry, "file_path"),
    ),
    raw: fields,
  };
}

/**
 * Strip `old_content` and `new_content` bodies from diff entries — git history
 * already has the file contents; no need to duplicate them in the export.
 */
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
          void old_content;
          void new_content;
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

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function toPatchEntry(entry: unknown, pathKey: "path" | "file_path"): PatchEntry[] {
  if (!entry || typeof entry !== "object") return [];
  const o = entry as Record<string, unknown>;
  const path = asString(o[pathKey]);
  const action = asString(o.action) ?? "unknown";
  return path ? [{ path, action }] : [];
}
