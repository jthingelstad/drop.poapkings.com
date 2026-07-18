export interface AvatarCrop {
  x: number
  y: number
  scale: number
}

const DEFAULT_AVATAR_CROP: AvatarCrop = {
  x: 50,
  y: 48,
  scale: 1.06
}

const AVATAR_CROP_OVERRIDES: Partial<Record<number, Partial<AvatarCrop>>> = {
  // Bring the face forward while keeping the helmet readable.
  26000037: { y: 44, scale: 1.1 },
  // The official release image has a wider canvas than standard API card art.
  26000106: { y: 43, scale: 1.65 }
}

export function avatarCrop(cardId: number): AvatarCrop {
  return { ...DEFAULT_AVATAR_CROP, ...AVATAR_CROP_OVERRIDES[cardId] }
}

export function hasAvatarCropOverride(cardId: number): boolean {
  return AVATAR_CROP_OVERRIDES[cardId] !== undefined
}
