import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function getEnv() {
  return {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET,
    publicBase: process.env.S3_PUBLIC_URL_BASE,
  } as const;
}

function getS3() {
  const { endpoint, region, accessKeyId, secretAccessKey } = getEnv();
  return new S3Client({
    region,
    forcePathStyle: true,
    endpoint,
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

export async function presignPutObject(key: string, contentType: string, expiresSeconds = 900) {
  const { bucket, endpoint, accessKeyId, secretAccessKey } = getEnv();
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) {
    if (process.env.NODE_ENV === 'test') {
      return `http://test.local/${encodeURIComponent(key)}?X-Amz-Signature=dummy`;
    }
    throw new Error('S3 configuration missing');
  }
  const s3 = getS3();
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  const url = await getSignedUrl(s3, cmd, { expiresIn: expiresSeconds });
  return url;
}

export function publicUrlForKey(key: string) {
  const { publicBase, endpoint, bucket } = getEnv();
  const base = publicBase || (endpoint && bucket ? `${endpoint.replace(/\/$/, '')}/${bucket}` : undefined);
  return base ? `${base}/${key}` : undefined;
}
