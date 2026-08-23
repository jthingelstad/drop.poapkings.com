import { beforeEach, describe, expect, it, vi } from "vitest";

const aws = vi.hoisted(() => ({
  send: vi.fn(),
  pages: [] as Array<{ Contents?: Array<{ Key?: string }> }>,
  lists: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      send = aws.send;
    },
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    DeleteObjectsCommand: Command,
    async *paginateListObjectsV2(
      _config: unknown,
      input: Record<string, unknown>,
    ) {
      aws.lists.push(input);
      for (const page of aws.pages) yield page;
    },
  };
});

import {
  badgeShareAssetKey,
  deletePlayerShareImages,
  deleteRunShareImage,
  getBadgeShareImage,
  getProfileShareImage,
  getRunShareImage,
  putBadgeShareImage,
  putProfileShareImage,
  putRunShareImage,
  runShareAssetKey,
  profileShareAssetKey,
} from "../src/share-assets.js";

describe("private run share assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aws.pages.length = 0;
    aws.lists.length = 0;
  });

  it("uses a retained versioned PNG key for each earned badge rung", async () => {
    expect(badgeShareAssetKey("player", "clockbreaker", 3)).toBe(
      "badge-images/player/clockbreaker/3.v1.png",
    );
    aws.send.mockResolvedValueOnce({}).mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([4, 5, 6]) },
    });

    await putBadgeShareImage(
      "bucket",
      "player",
      "clockbreaker",
      3,
      Buffer.from("png"),
    );
    await expect(
      getBadgeShareImage("bucket", "player", "clockbreaker", 3),
    ).resolves.toEqual(Buffer.from([4, 5, 6]));

    expect(aws.send.mock.calls[0]?.[0].input).toMatchObject({
      Bucket: "bucket",
      Key: "badge-images/player/clockbreaker/3.v1.png",
      ContentType: "image/png",
      CacheControl: "private, no-store",
    });
    expect(aws.send.mock.calls[1]?.[0].input).toEqual({
      Bucket: "bucket",
      Key: "badge-images/player/clockbreaker/3.v1.png",
    });
  });

  it("uses the permanent player/run PNG key for writes and reads", async () => {
    expect(runShareAssetKey("player", "run")).toBe(
      "run-images/player/run.v2.png",
    );
    aws.send.mockResolvedValueOnce({}).mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });

    await putRunShareImage("bucket", "player", "run", Buffer.from("png"));
    await expect(getRunShareImage("bucket", "player", "run")).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );

    expect(aws.send.mock.calls[0]?.[0].input).toMatchObject({
      Bucket: "bucket",
      Key: "run-images/player/run.v2.png",
      ContentType: "image/png",
      CacheControl: "private, no-store",
    });
    expect(aws.send.mock.calls[1]?.[0].input).toEqual({
      Bucket: "bucket",
      Key: "run-images/player/run.v2.png",
    });
  });

  it("uses one retained profile PNG key per player", async () => {
    expect(profileShareAssetKey("player")).toBe("profile-images/player.v1.png");
    aws.send.mockResolvedValueOnce({}).mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([7, 8, 9]) },
    });

    await putProfileShareImage("bucket", "player", Buffer.from("png"));
    await expect(getProfileShareImage("bucket", "player")).resolves.toEqual(
      Buffer.from([7, 8, 9]),
    );

    expect(aws.send.mock.calls[0]?.[0].input).toMatchObject({
      Bucket: "bucket",
      Key: "profile-images/player.v1.png",
      ContentType: "image/png",
    });
  });

  it("treats a missing object as a regenerable cache miss", async () => {
    const missing = new Error("missing");
    missing.name = "NoSuchKey";
    aws.send.mockRejectedValueOnce(missing);

    await expect(
      getRunShareImage("bucket", "player", "run"),
    ).resolves.toBeUndefined();
  });

  it("deletes one run or every page under a deleted player's prefix", async () => {
    aws.send.mockResolvedValue({});
    await deleteRunShareImage("bucket", "player", "run");
    expect(aws.send.mock.calls[0]?.[0].input).toMatchObject({
      Bucket: "bucket",
      Delete: {
        Objects: [
          { Key: "run-images/player/run.v2.png" },
          { Key: "run-images/player/run.png" },
        ],
      },
    });

    aws.pages.push(
      { Contents: [{ Key: "run-images/player/a.png" }, {}] },
      { Contents: [{ Key: "run-images/player/b.png" }] },
    );
    await deletePlayerShareImages("bucket", "player");
    expect(aws.lists).toEqual([
      { Bucket: "bucket", Prefix: "run-images/player/" },
      { Bucket: "bucket", Prefix: "badge-images/player/" },
      { Bucket: "bucket", Prefix: "profile-images/player." },
    ]);
    expect(aws.send).toHaveBeenCalledTimes(7);
    expect(aws.send.mock.calls[6]?.[0].input).toMatchObject({
      Delete: {
        Objects: [{ Key: "run-images/player/b.png" }],
        Quiet: true,
      },
    });
  });
});
