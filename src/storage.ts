import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ImageRef {
  file_id?: unknown;
  file_name?: unknown;
  dir_name?: unknown;
}

export interface AttachmentDownload {
  localPath: string;
  sourcePath: string;
  fileId: string;
  fileName: string;
}

export type AttachmentResult =
  | { kind: "ok"; download: AttachmentDownload }
  | { kind: "invalid-ref" }
  | { kind: "denied"; sourcePath: string; status: number }
  | { kind: "error"; sourcePath: string; status: number; message: string };

export async function downloadAttachmentIfMissing(
  lovableApiBase: string,
  idToken: string,
  attachmentsDir: string,
  ref: ImageRef,
): Promise<AttachmentResult> {
  const fileId = typeof ref.file_id === "string" ? ref.file_id : undefined;
  const fileName =
    typeof ref.file_name === "string" ? ref.file_name : undefined;
  const dirName = typeof ref.dir_name === "string" ? ref.dir_name : undefined;
  if (!fileId || !fileName || !dirName) {
    return { kind: "invalid-ref" };
  }

  const safeName = sanitizeFileName(fileName);
  const localPath = join(attachmentsDir, `${fileId}__${safeName}`);
  const sourcePath = `${dirName}/${fileId}`;

  if (await exists(localPath)) {
    return {
      kind: "ok",
      download: { localPath, sourcePath, fileId, fileName },
    };
  }

  const signed = await requestSignedUrl(
    lovableApiBase,
    idToken,
    dirName,
    fileId,
  );
  if (signed.kind !== "ok") return { ...signed, sourcePath };

  const res = await fetch(signed.url);
  if (!res.ok) {
    const text = await res.text();
    return {
      kind: "error",
      sourcePath,
      status: res.status,
      message: text.slice(0, 300),
    };
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, buf);
  return {
    kind: "ok",
    download: { localPath, sourcePath, fileId, fileName },
  };
}

type SignResult =
  | { kind: "ok"; url: string }
  | { kind: "denied"; status: number }
  | { kind: "error"; status: number; message: string };

async function requestSignedUrl(
  lovableApiBase: string,
  idToken: string,
  dirName: string,
  fileId: string,
): Promise<SignResult> {
  const url = `${lovableApiBase.replace(/\/$/, "")}/files/generate-download-url`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ dir_name: dirName, file_name: fileId }),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return { kind: "denied", status: res.status };
    }
    const text = await res.text();
    return {
      kind: "error",
      status: res.status,
      message: text.slice(0, 300),
    };
  }

  const contentType = res.headers.get("content-type") ?? "";
  let signedUrl: string | undefined;
  if (contentType.includes("json")) {
    const body = (await res.json()) as Record<string, unknown>;
    signedUrl = firstString(body, [
      "url",
      "download_url",
      "downloadUrl",
      "signed_url",
      "signedUrl",
    ]);
  } else {
    const text = (await res.text()).trim();
    if (text.startsWith("http")) signedUrl = text;
  }

  if (!signedUrl) {
    return {
      kind: "error",
      status: 200,
      message: "signed URL missing from response",
    };
  }
  return { kind: "ok", url: signedUrl };
}

function firstString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

const RESERVED_WINDOWS_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export function sanitizeFileName(name: string): string {
  let safe = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
  safe = safe.replace(/\.{2,}/g, "_");
  safe = safe.replace(/_+/g, "_");
  safe = safe.replace(/^[_.\s]+/, "");
  safe = safe.replace(/[_.\s]+$/, "");

  const base = safe.split(".")[0] ?? "";
  if (RESERVED_WINDOWS_NAMES.has(base.toUpperCase())) {
    safe = `_${safe}`;
  }

  return safe.length > 0 ? safe : "_";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
