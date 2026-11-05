/**
 * Private object storage behind a small interface.
 * Local-disk adapter for development/demo. Files live outside /public and are
 * only ever served through an authorized route (no permanent public URLs).
 * Swap for an S3-compatible adapter with server-side encryption and short-lived
 * signed URLs before any real-patient deployment (see docs/LAUNCH_READINESS.md).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export { UPLOAD_RULES, INLINE_PLAYABLE, classifyUpload } from "@/lib/upload-rules";

export interface StorageProvider {
  write(key: string, body: ReadableStream<Uint8Array>, expectedBytes: number): Promise<number>;
  stat(key: string): Promise<number | null>;
  read(key: string, range?: { start: number; end: number }): Readable;
  remove(key: string): Promise<void>;
}

class LocalDiskStorage implements StorageProvider {
  constructor(private root: string) {
    fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  }
  private p(key: string) {
    if (!/^[a-zA-Z0-9/_-]+$/.test(key) || key.includes("..")) throw new Error("Bad storage key");
    return path.join(this.root, key);
  }
  /** Writes to a temp file first, then renames — partial uploads never look complete. */
  async write(key: string, body: ReadableStream<Uint8Array>, expectedBytes: number) {
    const final = this.p(key);
    const tmp = path.join(this.root, "tmp", `${path.basename(final)}.${Date.now()}.part`);
    await fsp.mkdir(path.dirname(final), { recursive: true });
    let bytes = 0;
    const counter = Readable.fromWeb(body as never);
    counter.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes > expectedBytes) counter.destroy(new Error("Upload larger than declared size"));
    });
    try {
      await pipeline(counter, fs.createWriteStream(tmp, { mode: 0o600 }));
      if (bytes !== expectedBytes) throw new Error(`Upload incomplete (${bytes}/${expectedBytes} bytes)`);
      await fsp.rename(tmp, final);
      return bytes;
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw e;
    }
  }
  async stat(key: string) {
    try {
      return (await fsp.stat(this.p(key))).size;
    } catch {
      return null;
    }
  }
  read(key: string, range?: { start: number; end: number }) {
    return fs.createReadStream(this.p(key), range);
  }
  async remove(key: string) {
    await fsp.rm(this.p(key), { force: true });
  }
}

const g = globalThis as unknown as { __cadenceStorage?: StorageProvider };
export function storage(): StorageProvider {
  if (!g.__cadenceStorage) g.__cadenceStorage = new LocalDiskStorage(path.resolve(process.env.STORAGE_DIR || "./.data/uploads"));
  return g.__cadenceStorage;
}
