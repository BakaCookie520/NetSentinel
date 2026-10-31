import { createCipheriv, createDecipheriv, randomBytes, scrypt as derive } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { configuredLimit, requireDiskSpace } from "./backup-storage.js";
import { dirname } from "node:path";

// Fixed, bounded header. Parameters are not attacker-controlled.
const MAGIC = Buffer.from("NSBACK01");
const HEADER_BYTES = 36;
const TAG_BYTES = 16;
const MAX_LINE = 4 * 1024 * 1024;
export const uploadLimit = () => configuredLimit("NETSENTINEL_BACKUP_UPLOAD_MAX_BYTES", 1024 ** 3);
export const expandedLimit = () => configuredLimit("NETSENTINEL_BACKUP_EXPANDED_MAX_BYTES", 10 * 1024 ** 3);
function keyFor(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => derive(password, salt, 32,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)));
}
export async function writeArchive(path: string, password: string, records: AsyncIterable<unknown>): Promise<void> {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await keyFor(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const header = Buffer.concat([MAGIC, salt, nonce]);
  cipher.setAAD(header);
  const handle = await open(path, "wx", 0o600);
  try { await handle.write(header); } finally { await handle.close(); }
  async function* lines() {
    let bytes = 0;
    let diskCheckAt = 0;
    for await (const record of records) {
      const line = Buffer.from(`${JSON.stringify(record)}\n`);
      bytes += line.length;
      if (line.length > MAX_LINE || bytes > expandedLimit()) throw new Error("BACKUP_EXPANDED_LIMIT");
      if (bytes >= diskCheckAt) {
        await requireDiskSpace(16 * 1024 * 1024, dirname(path));
        diskCheckAt = bytes + 16 * 1024 * 1024;
      }
      yield line;
    }
  }
  try {
    await pipeline(Readable.from(lines()), createGzip(), cipher, createWriteStream(path, { flags: "a" }));
    const output = await open(path, "a");
    try { await output.write(cipher.getAuthTag()); await output.sync(); } finally { await output.close(); }
  } finally { key.fill(0); }
}
export async function* readArchive(path: string, password: string): AsyncGenerator<unknown> {
  const size = (await stat(path)).size;
  if (size < HEADER_BYTES + TAG_BYTES || size > uploadLimit()) throw new Error("BACKUP_FILE_INVALID");
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  const handle = await open(path, "r");
  try { await handle.read(header, 0, header.length, 0); await handle.read(tag, 0, tag.length, size - TAG_BYTES); }
  finally { await handle.close(); }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error("BACKUP_FILE_INVALID");
  const key = await keyFor(password, header.subarray(8, 24));
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(24, 36));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  let expanded = 0;
  const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    expanded += chunk.length;
    callback(expanded > expandedLimit() ? new Error("BACKUP_EXPANDED_LIMIT") : null, chunk);
  } });
  const output = createGunzip();
  // Install rejection handling immediately; GCM authentication is only complete
  // at EOF. Callers must never commit records before this generator completes.
  const completion = pipeline(createReadStream(path, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }), decipher, output, limiter);
  void completion.catch(() => undefined);
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of limiter) {
      pending = Buffer.concat([pending, chunk as Buffer]);
      let newline: number;
      while ((newline = pending.indexOf(10)) !== -1) {
        if (newline > MAX_LINE) throw new Error("BACKUP_RECORD_TOO_LARGE");
        const line = pending.subarray(0, newline).toString("utf8");
        pending = pending.subarray(newline + 1);
        if (!line) throw new Error("BACKUP_FILE_INVALID");
        yield JSON.parse(line) as unknown;
      }
      if (pending.length > MAX_LINE) throw new Error("BACKUP_RECORD_TOO_LARGE");
    }
    await completion;
    if (pending.length) throw new Error("BACKUP_FILE_INVALID");
  } catch (error) {
    limiter.destroy();
    await completion.catch(() => undefined);
    if (error instanceof Error && error.message.startsWith("BACKUP_")) throw error;
    throw new Error("BACKUP_PASSWORD_OR_FILE_INVALID");
  } finally { limiter.destroy(); key.fill(0); }
}
