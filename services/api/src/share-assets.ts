import {
  DeleteObjectsCommand,
  GetObjectCommand,
  paginateListObjectsV2,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const PREFIX = "run-images";
const CURRENT_VERSION = "v2";
const BADGE_PREFIX = "badge-images";
const BADGE_VERSION = "v1";
const PROFILE_PREFIX = "profile-images";
const PROFILE_VERSION = "v1";

export function runShareAssetKey(playerId: string, runId: string): string {
  return `${PREFIX}/${playerId}/${runId}.${CURRENT_VERSION}.png`;
}

function legacyRunShareAssetKey(playerId: string, runId: string): string {
  return `${PREFIX}/${playerId}/${runId}.png`;
}

export function badgeShareAssetKey(
  playerId: string,
  slug: string,
  rungIndex: number,
): string {
  return `${BADGE_PREFIX}/${playerId}/${slug}/${rungIndex}.${BADGE_VERSION}.png`;
}

export function profileShareAssetKey(playerId: string): string {
  return `${PROFILE_PREFIX}/${playerId}.${PROFILE_VERSION}.png`;
}

async function putImage(bucket: string, key: string, image: Buffer) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: image,
      ContentType: "image/png",
      CacheControl: "private, no-store",
    }),
  );
}

async function getImage(
  bucket: string,
  key: string,
): Promise<Buffer | undefined> {
  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!result.Body) return undefined;
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NoSuchKey" || error.name === "NotFound")
    )
      return undefined;
    throw error;
  }
}

export async function putRunShareImage(
  bucket: string,
  playerId: string,
  runId: string,
  image: Buffer,
): Promise<void> {
  await putImage(bucket, runShareAssetKey(playerId, runId), image);
}

export async function getRunShareImage(
  bucket: string,
  playerId: string,
  runId: string,
): Promise<Buffer | undefined> {
  return getImage(bucket, runShareAssetKey(playerId, runId));
}

export async function putBadgeShareImage(
  bucket: string,
  playerId: string,
  slug: string,
  rungIndex: number,
  image: Buffer,
): Promise<void> {
  await putImage(bucket, badgeShareAssetKey(playerId, slug, rungIndex), image);
}

export async function getBadgeShareImage(
  bucket: string,
  playerId: string,
  slug: string,
  rungIndex: number,
): Promise<Buffer | undefined> {
  return getImage(bucket, badgeShareAssetKey(playerId, slug, rungIndex));
}

export async function putProfileShareImage(
  bucket: string,
  playerId: string,
  image: Buffer,
): Promise<void> {
  await putImage(bucket, profileShareAssetKey(playerId), image);
}

export async function getProfileShareImage(
  bucket: string,
  playerId: string,
): Promise<Buffer | undefined> {
  return getImage(bucket, profileShareAssetKey(playerId));
}

export async function deleteRunShareImage(
  bucket: string,
  playerId: string,
  runId: string,
): Promise<void> {
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: [
          { Key: runShareAssetKey(playerId, runId) },
          { Key: legacyRunShareAssetKey(playerId, runId) },
        ],
      },
    }),
  );
}

export async function deletePlayerShareImages(
  bucket: string,
  playerId: string,
): Promise<void> {
  for (const prefix of [
    `${PREFIX}/${playerId}/`,
    `${BADGE_PREFIX}/${playerId}/`,
    `${PROFILE_PREFIX}/${playerId}.`,
  ]) {
    for await (const page of paginateListObjectsV2(
      { client: s3 },
      { Bucket: bucket, Prefix: prefix },
    )) {
      const objects = (page.Contents ?? []).flatMap((item) =>
        item.Key ? [{ Key: item.Key }] : [],
      );
      if (objects.length)
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
    }
  }
}
