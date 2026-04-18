export interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

export type FirestoreValue =
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { nullValue: null }
  | { bytesValue: string }
  | { referenceValue: string }
  | { geoPointValue: { latitude: number; longitude: number } }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

export interface ListDocumentsResponse {
  documents?: FirestoreDocument[];
  nextPageToken?: string;
}

const PAGE_SIZE = 300;

export async function listAllDocuments(
  firestoreProject: string,
  idToken: string,
  collectionPath: string,
): Promise<FirestoreDocument[]> {
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firestoreProject,
  )}/databases/(default)/documents/${collectionPath}`;
  const all: FirestoreDocument[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(base);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new FirestoreError(
        `listDocuments ${collectionPath} failed (${res.status}): ${text.slice(0, 500)}`,
      );
    }

    const body = (await res.json()) as ListDocumentsResponse;
    if (body.documents) all.push(...body.documents);
    pageToken = body.nextPageToken;
  } while (pageToken);

  return all;
}

export function decodeFields(
  fields: Record<string, FirestoreValue> | undefined,
): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeValue(v);
  }
  return out;
}

export function decodeValue(value: FirestoreValue): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) {
    const n = Number(value.integerValue);
    return Number.isSafeInteger(n) ? n : value.integerValue;
  }
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("bytesValue" in value) return value.bytesValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) {
    return (value.arrayValue.values ?? []).map(decodeValue);
  }
  if ("mapValue" in value) return decodeFields(value.mapValue.fields);
  return undefined;
}

export function docIdFromName(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

export class FirestoreError extends Error {
  override name = "FirestoreError";
}
