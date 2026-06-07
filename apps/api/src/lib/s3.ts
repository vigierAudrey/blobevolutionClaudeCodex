import {
  S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand,
  GetObjectCommand, DeleteObjectCommand, HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { secureLogger } from '../utils/secure-logger';

function getEnv() {
  return {
    endpoint: process.env.S3_ENDPOINT,
    presignEndpoint: process.env.S3_PRESIGN_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET,
    publicBase: process.env.S3_PUBLIC_URL_BASE,
  } as const;
}

function getS3(customEndpoint?: string) {
  const { endpoint, region, accessKeyId, secretAccessKey } = getEnv();
  return new S3Client({
    region,
    forcePathStyle: true,
    endpoint: customEndpoint ?? endpoint,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  });
}

export const S3_PUBLIC_URL_BASE = process.env.S3_PUBLIC_URL_BASE as string | undefined;

export async function ensureBucket() {
  if (process.env.NODE_ENV === 'test') return; // skip in tests
  const { bucket } = getEnv();
  if (!bucket) throw new Error('S3_BUCKET missing');
  const s3 = getS3();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export async function presignPutObject(key: string, contentType: string, expiresSeconds = 180) {
  const { bucket, endpoint, presignEndpoint, accessKeyId, secretAccessKey } = getEnv();
  const targetEndpoint = presignEndpoint || endpoint;
  if (!bucket || !accessKeyId || !secretAccessKey || !targetEndpoint) {
    if (process.env.NODE_ENV === 'test') {
      return `http://test.local/${encodeURIComponent(key)}?X-Amz-Signature=dummy`;
    }
    throw new Error('S3 configuration missing');
  }
  const s3 = getS3(targetEndpoint);
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  const url = await getSignedUrl(s3, cmd, { expiresIn: expiresSeconds });
  return url;
}

const MAGIC_BYTES_READ = 12; // WebP = 12 octets, la signature la plus longue
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — cohérent avec nginx client_max_body_size

// Mock injectable en NODE_ENV=test uniquement
let _testMockFirstBytes: Buffer | null = null;
let _testMockObjectBuffer: Buffer | null = null;

/** Injecte des bytes fictifs pour les tests. Interdit en dehors de NODE_ENV=test. */
export function __setTestGetObjectMock(bytes: Buffer | null): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('__setTestGetObjectMock is test-only');
  _testMockFirstBytes = bytes;
}

/** Injecte un objet complet fictif pour les tests de lecture média privée. */
export function __setTestGetObjectBufferMock(bytes: Buffer | null): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('__setTestGetObjectBufferMock is test-only');
  _testMockObjectBuffer = bytes;
}

/**
 * Lit les 12 premiers octets réels d'un objet S3 via Range header.
 * Retourne null si l'objet est absent, vide, ou dépasse MAX_UPLOAD_BYTES.
 * Coût : 1 HeadObject + 1 GetObject Range bytes=0-11.
 */
export async function getObjectFirstBytes(key: string): Promise<Buffer | null> {
  if (process.env.NODE_ENV === 'test') return _testMockFirstBytes;

  const { bucket } = getEnv();
  if (!bucket) return null;
  const s3 = getS3();

  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const size = head.ContentLength ?? 0;
    if (size === 0 || size > MAX_UPLOAD_BYTES) return null;
  } catch {
    return null; // objet absent
  }

  try {
    const resp = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${MAGIC_BYTES_READ - 1}`,
    }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/**
 * Lit un objet S3 complet après vérification de taille.
 * Réservé aux médias utilisateur privés, plafonnés à MAX_UPLOAD_BYTES.
 */
export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  if (process.env.NODE_ENV === 'test') return _testMockObjectBuffer ?? _testMockFirstBytes;

  const { bucket } = getEnv();
  if (!bucket) return null;
  const s3 = getS3();

  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    const size = head.ContentLength ?? 0;
    if (size === 0 || size > MAX_UPLOAD_BYTES) return null;

    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/**
 * Supprime un objet S3. Utilisé pour cleanup post-finalize-rejeté.
 * Non-fatal : log en cas d'erreur, l'objet orphelin sera purgé par lifecycle rule.
 */
export async function deleteObject(key: string): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  const { bucket } = getEnv();
  if (!bucket) return;
  const s3 = getS3();
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    secureLogger.warn('S3_DELETE_OBJECT_FAILED', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function publicUrlForKey(key: string) {
  const { publicBase, endpoint, bucket } = getEnv();
  const base = publicBase || (endpoint && bucket ? `${endpoint.replace(/\/$/, '')}/${bucket}` : undefined);
  if (!base) return undefined;
  // Guard: refuse internal Docker/localhost URLs from reaching the client in production
  if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.\d|minio[:/]|::1/.test(base)) {
    throw new Error(
      `publicUrlForKey: S3_PUBLIC_URL_BASE resolves to an internal URL (${base}). ` +
      'Set S3_PUBLIC_URL_BASE explicitly to the public storage domain.'
    );
  }
  return `${base}/${key}`;
}

export function storageKeyFromPublicUrl(value: string): string | null {
  const candidate = value.trim();
  if (/^(users|pros)\//.test(candidate)) return candidate;

  const { publicBase, endpoint, bucket } = getEnv();
  const bases = [
    publicBase,
    endpoint && bucket ? `${endpoint.replace(/\/$/, '')}/${bucket}` : undefined,
  ].filter((base): base is string => Boolean(base));

  for (const base of bases) {
    const normalizedBase = base.replace(/\/$/, '');
    if (candidate.startsWith(`${normalizedBase}/`)) {
      return decodeURIComponent(candidate.slice(normalizedBase.length + 1));
    }
  }

  try {
    const parsed = new URL(candidate);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const usersIndex = parts.indexOf('users');
    if (usersIndex >= 0) return parts.slice(usersIndex).map((part) => decodeURIComponent(part)).join('/');
    const prosIndex = parts.indexOf('pros');
    if (prosIndex >= 0) return parts.slice(prosIndex).map((part) => decodeURIComponent(part)).join('/');
  } catch {
    return null;
  }

  return null;
}
