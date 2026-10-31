import { mkdir, open, readFile, readdir, rename, rm, statfs, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const dataDirectory = () => process.env.NETSENTINEL_DATA_DIR ?? "/app/data";
export const backupDirectory = () => join(dataDirectory(), "backups");
export function backupPath(id: string, extension = "nsbackup"): string {
  if (!/^[a-f0-9-]{36}$/u.test(id) || !/^[a-z]+$/u.test(extension)) throw new Error("Invalid backup identifier");
  return join(backupDirectory(), `${id}.${extension}`);
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    const handle = await open(temporary, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
    // fsync the containing directory as well as the file: recovery journals
    // must survive power loss, not merely an orderly process restart.
    if (process.platform !== "win32") {
      const directory = await open(dirname(path), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally { await rm(temporary, { force: true }); }
}
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error; }
}
export async function ensureBackupDirectory(): Promise<void> {
  await mkdir(backupDirectory(), { recursive: true, mode: 0o700 });
}
export async function requireDiskSpace(bytes: number, path = backupDirectory()): Promise<void> {
  const info = await statfs(path);
  if (info.bavail * info.bsize < bytes + 64 * 1024 * 1024) throw new Error("BACKUP_DISK_FULL");
}
export async function syncAvatarStage(stage: string): Promise<void> {
  if (process.platform === "win32") return;
  const avatars = join(stage, "avatars");
  for (const name of await readdir(avatars)) {
    const handle = await open(join(avatars, name), "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  for (const path of [avatars, stage, backupDirectory()]) {
    const handle = await open(path, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
}
export function configuredLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}
