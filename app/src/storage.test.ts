import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteStorageObject,
  putStorageObject,
  storagePathFor,
} from "./storage";

describe("storage adapter", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "kioku-storage-"));
    process.env.STORAGE_DIR = root;
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it.each([
    "",
    "../escape.mp3",
    "nested/../../escape.mp3",
    "/absolute.mp3",
    "back\\slash.mp3",
    "nul\0byte.mp3",
  ])("refuses unsafe key %j", (key) => {
    expect(() => storagePathFor(key)).toThrow(/Invalid storage key/);
  });

  it("writes, reads, and deletes an object", async () => {
    const key = "workspace/meeting.mp3";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      },
    });

    const { size } = await putStorageObject(key, stream);

    expect(size).toBe(4);
    expect(await readFile(storagePathFor(key))).toEqual(Buffer.from([1, 2, 3, 4]));

    await deleteStorageObject(key);
    await expect(stat(storagePathFor(key))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Deleting twice is a no-op (cleanup paths call it defensively).
    await expect(deleteStorageObject(key)).resolves.toBeUndefined();
  });

  it("leaves no partial file when the stream errors", async () => {
    const key = "workspace/broken.mp3";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.error(new Error("stream failed"));
      },
    });

    await expect(putStorageObject(key, stream)).rejects.toThrow("stream failed");

    await expect(stat(storagePathFor(key))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // No temp file may linger beside the destination.
    expect(await readdir(path.dirname(storagePathFor(key)))).toEqual([]);
  });
});
