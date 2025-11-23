import crypto from 'node:crypto';
import { createSign } from 'node:crypto';

type Mode = 'app' | 'token';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function normalizePrivateKey(raw: string) {
  // Allow env with \n literals
  return raw.includes('\n') ? raw : raw.replace(/\\n/g, '\n');
}

async function getAppJwt(appId: string, privateKeyPem: string) {
  // Build a JWT for GitHub App authentication (RS256)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const iat = nowSeconds() - 60; // backdate 60s
  const exp = iat + 9 * 60; // 9 minutes
  const payload = Buffer.from(JSON.stringify({ iat, exp, iss: appId })).toString('base64url');
  const data = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(data);
  sign.end();
  const signature = sign.sign(normalizePrivateKey(privateKeyPem)).toString('base64url');
  return `${data}.${signature}`;
}

async function getInstallationToken(): Promise<string> {
  const mode = (process.env.GITHUB_MODE || 'token') as Mode;
  if (mode === 'token') {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN missing for token mode');
    return token;
  }

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_INSTALLATION_ID;
  if (!appId || !privateKey || !installationId) {
    throw new Error('GitHub App configuration missing (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_INSTALLATION_ID)');
  }
  const jwt = await getAppJwt(appId, privateKey);
  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'blobinfini-api'
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub App token error: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { token: string };
  return json.token;
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'blobinfini-api'
  } as Record<string, string>;
}

async function ensureBranch(owner: string, repo: string, token: string, base: string, branch: string) {
  const refBase = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(base)}`, {
    headers: ghHeaders(token),
  });
  if (!refBase.ok) throw new Error(`Base ref fetch failed: ${refBase.status}`);
  const baseJson = (await refBase.json()) as { object: { sha: string } };
  const baseSha = (baseJson as any).object?.sha || (baseJson as any).sha;

  const createRef = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  if (createRef.status === 422) {
    return; // already exists
  }
  if (!createRef.ok) {
    const text = await createRef.text();
    throw new Error(`Create ref failed: ${createRef.status} ${text}`);
  }
}

function toBase64(str: string) {
  return Buffer.from(str, 'utf8').toString('base64');
}

async function upsertContent(owner: string, repo: string, token: string, path: string, content: string, message: string, branch: string) {
  // Check if file exists on branch
  let sha: string | undefined;
  const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, {
    headers: ghHeaders(token),
  });
  if (getRes.ok) {
    const json = (await getRes.json()) as { sha?: string };
    sha = (json as any).sha;
  }
  const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64(content),
      branch,
      sha,
    }),
  });
  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`Upsert content failed: ${putRes.status} ${text}`);
  }
}

async function openPr(owner: string, repo: string, token: string, head: string, base: string, title: string, body?: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head, base, body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Open PR failed: ${res.status} ${text}`);
  }
  return (await res.json()) as { html_url: string; number: number };
}

function parseListEnv(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function decoratePr(owner: string, repo: string, token: string, prNumber: number) {
  // Labels
  const labels = parseListEnv('GITHUB_PR_LABELS');
  if (labels.length) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/labels`, {
      method: 'POST',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[github] add labels failed: ${res.status} ${text}`);
    }
  }

  // Assignees
  const assignees = parseListEnv('GITHUB_PR_ASSIGNEES');
  if (assignees.length) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/assignees`, {
      method: 'POST',
      headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignees }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[github] add assignees failed: ${res.status} ${text}`);
    }
  }
}

export async function pushBlobosphereChange({
  fileRelPath,
  content,
  message,
  branchName,
}: {
  fileRelPath: string; // e.g. apps/web/content/blobosphere/surf/slug.mdx
  content: string;
  message: string;
  branchName: string;
}): Promise<{ prUrl?: string; prNumber?: number; branchName?: string } | null> {
  if (String(process.env.BLOBOSPHERE_GITHUB_PUSH || 'false').toLowerCase() !== 'true') {
    return null;
  }
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  const base = process.env.GITHUB_DEFAULT_BASE_BRANCH || 'main';
  if (!owner || !repo) throw new Error('Missing GITHUB_REPO_OWNER or GITHUB_REPO_NAME');
  const token = await getInstallationToken();

  await ensureBranch(owner, repo, token, base, branchName);
  await upsertContent(owner, repo, token, fileRelPath, content, message, branchName);
  const prTitle = message;
  const prBody = 'Automated editorial change from Blobinfini Admin UI';
  const pr = await openPr(owner, repo, token, branchName, base, prTitle, prBody);
  try {
    await decoratePr(owner, repo, token, pr.number);
  } catch (e) {
    console.warn('[github] decorate PR skipped', (e as Error)?.message);
  }
  return { prUrl: pr.html_url, prNumber: pr.number, branchName };
}
