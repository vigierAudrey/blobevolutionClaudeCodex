export function isBlobosphereFrontmatterPublished(frontmatter: Record<string, unknown>): boolean {
  if (typeof frontmatter.published === 'boolean') {
    return frontmatter.published;
  }

  return typeof frontmatter.status === 'string' && frontmatter.status.toLowerCase() === 'published';
}

export function validatePublishedBlobosphereCoverImage(frontmatter: Record<string, unknown>): string | null {
  if (!isBlobosphereFrontmatterPublished(frontmatter)) {
    return null;
  }

  const coverImage = typeof frontmatter.coverImage === 'string' ? frontmatter.coverImage.trim() : '';
  if (!coverImage) {
    return 'coverImage is required for published articles';
  }

  if (/^javascript:/i.test(coverImage)) {
    return 'coverImage must not use javascript:';
  }

  if (/^https:\/\//i.test(coverImage)) {
    try {
      const parsed = new URL(coverImage);
      if (parsed.protocol !== 'https:') {
        return 'coverImage URL must use https://';
      }
      return null;
    } catch {
      return 'coverImage must be a valid https URL';
    }
  }

  if (coverImage.startsWith('/images/blobosphere/')) {
    return null;
  }

  if (coverImage.startsWith('/')) {
    return 'relative coverImage must start with /images/blobosphere/';
  }

  return 'coverImage must start with /images/blobosphere/ or https://';
}

export function isBlobosphereRelativeCoverImage(coverImage: string): boolean {
  return coverImage.startsWith('/images/blobosphere/');
}
