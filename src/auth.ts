import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { fetchWithRetry } from "./retry.ts";

export interface TokenExchange {
  idToken: string;
  refreshToken: string;
  rotated: boolean;
  expiresInSeconds: number;
}

export async function exchangeRefreshToken(
  apiKey: string,
  refreshToken: string,
): Promise<TokenExchange> {
  const url = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    { label: "securetoken/v1/token" },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new AuthError(
      `Token exchange failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: string;
  };

  const idToken = json.id_token ?? json.access_token;
  const newRefresh = json.refresh_token;
  if (!idToken || !newRefresh) {
    throw new AuthError("Token response missing id_token or refresh_token");
  }

  return {
    idToken,
    refreshToken: newRefresh,
    rotated: newRefresh !== refreshToken,
    expiresInSeconds: json.expires_in ? Number(json.expires_in) : 3600,
  };
}

export async function writeRotatedRefreshToken(
  envFilePath: string,
  newToken: string,
): Promise<void> {
  let existing: string;
  try {
    existing = await readFile(envFilePath, "utf8");
  } catch {
    existing = "";
  }

  const line = `LOVABLE_REFRESH_TOKEN=${newToken}`;
  const re = /^LOVABLE_REFRESH_TOKEN=.*$/m;
  const updated = re.test(existing)
    ? existing.replace(re, line)
    : `${existing.replace(/\s*$/, "")}\n${line}\n`;

  const tmpPath = `${envFilePath}.tmp-${process.pid}`;
  try {
    await writeFile(tmpPath, updated, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, envFilePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export class AuthError extends Error {
  override name = "AuthError";
}
