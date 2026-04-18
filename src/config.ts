import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EXIT } from "./exitCodes.ts";

export interface Config {
  apiKey: string;
  refreshToken: string;
  projectId: string;
  firestoreProject: string;
  lovableApiBase: string;
  outDir: string;
  since: string | undefined;
  envFilePath: string | undefined;
}

const DEFAULT_LOVABLE_API_BASE = "https://api.lovable.dev";
const DEFAULT_OUT_DIR = "./chat-history";

export function loadConfig(argv: string[]): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      "project-id": { type: "string" },
      out: { type: "string" },
      since: { type: "string" },
      "firestore-project": { type: "string" },
      "lovable-api-base": { type: "string" },
      "env-file": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const envFilePath = resolveEnvFile(values["env-file"]);

  const apiKey = requireString(
    "LOVABLE_FIREBASE_API_KEY",
    process.env.LOVABLE_FIREBASE_API_KEY,
  );
  const refreshToken = requireString(
    "LOVABLE_REFRESH_TOKEN",
    process.env.LOVABLE_REFRESH_TOKEN,
  );
  const projectId = requireString(
    "LOVABLE_PROJECT_ID (or --project-id)",
    values["project-id"] ?? process.env.LOVABLE_PROJECT_ID,
  );

  const firestoreProject = requireString(
    "LOVABLE_FIRESTORE_PROJECT (or --firestore-project)",
    values["firestore-project"] ?? process.env.LOVABLE_FIRESTORE_PROJECT,
  );
  const lovableApiBase =
    orUndefinedIfBlank(values["lovable-api-base"]) ??
    orUndefinedIfBlank(process.env.LOVABLE_API_BASE) ??
    DEFAULT_LOVABLE_API_BASE;
  const outDir = resolve(
    orUndefinedIfBlank(values.out) ??
      orUndefinedIfBlank(process.env.OUTPUT_DIR) ??
      DEFAULT_OUT_DIR,
  );

  return {
    apiKey,
    refreshToken,
    projectId,
    firestoreProject,
    lovableApiBase,
    outDir,
    since: values.since,
    envFilePath,
  };
}

function requireString(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    console.error(`error: ${name} is required`);
    process.exit(EXIT.CONFIG);
  }
  return value.trim();
}

function orUndefinedIfBlank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim().length > 0 ? value : undefined;
}

function resolveEnvFile(explicit: string | undefined): string | undefined {
  if (explicit) return resolve(explicit);
  const candidate = resolve(".env");
  return existsSync(candidate) ? candidate : undefined;
}

function printHelp(): void {
  console.log(`lovable-chat-export — export Lovable chat history

Usage:
  lovable-chat-export [options]

Options:
  --project-id <id>            Lovable project UUID (or env LOVABLE_PROJECT_ID)
  --out <dir>                  Output directory (default ./chat-history)
  --since <iso>                Only sync docs updated after this timestamp
  --firestore-project <id>     Firestore GCP project hosting Lovable data
  --lovable-api-base <url>     Lovable API base (default https://api.lovable.dev)
  --env-file <path>            Explicit path to .env (default ./.env if present)
  -h, --help                   Show this help

Required env:
  LOVABLE_FIREBASE_API_KEY     Firebase Web API key (AIzaSy...)
  LOVABLE_REFRESH_TOKEN        Refresh token from browser IndexedDB
  LOVABLE_PROJECT_ID           Lovable project UUID (fallback for --project-id)
  LOVABLE_FIRESTORE_PROJECT    Firestore GCP project (fallback for --firestore-project).
                               Discover in DevTools → Network: any firestore.googleapis.com
                               URL contains /projects/<id>/databases/.
`);
}
