import {
  DeleteObjectsCommand,
  GetObjectCommand,
  paginateListObjectsV2,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const PREFIX = "run-images";

export function runShareAssetKey(playerId: string, runId: string): string {
  return `${PREFIX}/${playerId}/${runId}.png`;
}

export async function putRunShareImage(
  bucket: string,
  playerId: string,
  runId: string,
  image: Buffer,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: runShareAssetKey(playerId, runId),
      Body: image,
      ContentType: "image/png",
      CacheControl: "private, no-store",
    }),
  );
}

export async function getRunShareImage(
  bucket: string,
  playerId: string,
  runId: string,
): Promise<Buffer | undefined> {
  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: runShareAssetKey(playerId, runId),
      }),
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

export async function deleteRunShareImage(
  bucket: string,
  playerId: string,
  runId: string,
): Promise<void> {
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: [{ Key: runShareAssetKey(playerId, runId) }] },
    }),
  );
}

export async function deletePlayerShareImages(
  bucket: string,
  playerId: string,
): Promise<void> {
  const prefix = `${PREFIX}/${playerId}/`;
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
