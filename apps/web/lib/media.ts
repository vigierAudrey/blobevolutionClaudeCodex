const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

const USER_STORAGE_PHOTO_RE =
  /(?:^|\/)users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpeg|jpg|png|webp)(?:$|[?#])/i;

const API_USER_MEDIA_RE =
  /^\/media\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/photo$/i;

export function isPrivateUserStoragePhotoUrl(photoUrl: string | null | undefined): boolean {
  if (!photoUrl) return false;
  return USER_STORAGE_PHOTO_RE.test(photoUrl);
}

export function resolveProfilePhotoSrc(photoUrl: string | null | undefined): string | null {
  if (!photoUrl) return null;
  const trimmed = photoUrl.trim();
  if (!trimmed) return null;

  const mediaPathMatch = trimmed.match(API_USER_MEDIA_RE);
  if (mediaPathMatch) {
    return `${API_URL}${trimmed}`;
  }

  const privateUserMatch = trimmed.match(USER_STORAGE_PHOTO_RE);
  if (privateUserMatch?.[1]) {
    return `${API_URL}/media/users/${privateUserMatch[1]}/photo`;
  }

  return trimmed;
}
