export const EXIT = {
  OK: 0,
  AUTH: 1,
  FETCH: 2,
  UNKNOWN: 3,
  CONFIG: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
