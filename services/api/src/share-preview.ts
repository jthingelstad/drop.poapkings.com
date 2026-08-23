import { HttpError } from "./errors.js";

const MAX_PREVIEW_BYTES = 2_000_000;
const PNG_SIGNATURE = "89504e470d0a1a0a";

export function uploadedSharePng(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil((MAX_PREVIEW_BYTES * 4) / 3) + 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw new HttpError(
      400,
      "The share preview is invalid.",
      "invalid_share_preview",
    );
  const image = Buffer.from(value, "base64");
  if (
    image.length < 24 ||
    image.length > MAX_PREVIEW_BYTES ||
    image.subarray(0, 8).toString("hex") !== PNG_SIGNATURE ||
    image.subarray(12, 16).toString("ascii") !== "IHDR" ||
    image.readUInt32BE(16) !== 1_200 ||
    image.readUInt32BE(20) !== 630
  )
    throw new HttpError(
      400,
      "The share preview is invalid.",
      "invalid_share_preview",
    );
  return image;
}
