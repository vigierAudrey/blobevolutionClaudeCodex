"use client";
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '../../../../lib/apiClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Textarea } from '../../../../components/ui/textarea';
import { MdxRuntimePreview } from '@/components/blobosphere/MdxRuntimePreview';

type Category = 'surf'|'kitesurf'|'communaute'|'impact';

type BlobosphereListItem = { category: Category; slug: string; title: string; status: string };

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export default function BlobosphereEditorPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [items, setItems] = useState<BlobosphereListItem[]>([]);
  const [mode, setMode] = useState<'create'|'edit'>('create');
  const [category, setCategory] = useState<Category>('surf');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [status, setStatus] = useState<'draft'|'published'>('draft');
  const [tags, setTags] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string|null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const tokens = apiClient.getTokens();
        if (!tokens?.accessToken) {
          router.replace('/login');
          return;
        }
        const me = await apiClient.me();
        if (me.role !== 'ADMIN') {
          router.replace('/dashboard');
          return;
        }
        const list = await fetchJson<{ items: BlobosphereListItem[] }>('/api/blobosphere/posts', {
          cache: 'no-store',
        });
        setItems(list.items);

        const qCat = (params.get('category') as Category | null);
        const qSlug = params.get('slug');
        if (qCat && qSlug) {
          setMode('edit');
          setCategory(qCat);
          setSlug(qSlug);
          const raw = await fetchJson<{ raw: string }>(`/api/blobosphere/posts/${qCat}/${qSlug}`, {
            cache: 'no-store',
          });
          // crude parse: split frontmatter
          const start = raw.raw.indexOf('---');
          const end = raw.raw.indexOf('\n---', 3);
          const fm = start === 0 && end > 0 ? raw.raw.slice(3, end + 1) : '';
          const content = end > 0 ? raw.raw.slice(end + 4) : raw.raw;
          const meta: Record<string, string> = {};
          if (fm) {
            for (const line of fm.split(/\r?\n/)) {
              const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
              if (!m) continue;
              meta[m[1]] = m[2].replace(/^"|"$/g, '');
            }
          }
          setTitle(meta.title || '');
          setExcerpt(meta.excerpt || '');
          setStatus(meta.status === 'published' ? 'published' : 'draft');
          setTags(meta.tags || '');
          setBody(content);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erreur de chargement';
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, params]);

  const canSave = useMemo(() => title.trim().length > 0 && slug.trim().length > 0, [title, slug]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const payload = {
        title,
        slug,
        category,
        excerpt,
        status,
        tags: tags.split(',').map(s => s.trim()).filter(Boolean),
        body,
      };
      if (mode === 'create') {
        const res = await fetchJson<{ success: boolean; path: string }>('/api/blobosphere/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setInfo(`Article créé (${res.path})`);
      } else {
        const res = await fetchJson<{ success: boolean; path: string }>(`/api/blobosphere/posts/${category}/${slug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setInfo(`Article mis à jour (${res.path})`);
      }
      const updatedList = await fetchJson<{ items: BlobosphereListItem[] }>('/api/blobosphere/posts', {
        cache: 'no-store',
      });
      setItems(updatedList.items);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Chargement…</p>;
  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Blobosphère — Éditeur interne</h1>
          <p className="text-muted-foreground">Créer, modifier et publier des articles MDX</p>
        </div>
        <Button variant="outline" onClick={() => router.push('/admin/blobosphere')}>Retour</Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>{mode === 'create' ? 'Nouvel article' : 'Éditer l’article'}</CardTitle>
            <CardDescription>Frontmatter minimal + contenu MDX</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Titre</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label>Slug</Label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} />
              </div>
              <div>
                <Label>Catégorie</Label>
                <select className="h-9 w-full rounded-md border px-3" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                  <option value="surf">surf</option>
                  <option value="kitesurf">kitesurf</option>
                  <option value="communaute">communaute</option>
                  <option value="impact">impact</option>
                </select>
              </div>
              <div>
                <Label>Statut</Label>
                <select className="h-9 w-full rounded-md border px-3" value={status} onChange={(e) => setStatus(e.target.value as 'draft'|'published')}>
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Extrait</Label>
                <Input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label>Tags (séparés par des virgules)</Label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Contenu (MDX)</Label>
              <Textarea className="min-h-[320px]" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={!canSave || saving}>{saving ? 'Sauvegarde…' : 'Enregistrer'}</Button>
            </div>
            {info && <p className="text-green-700 text-sm">{info}</p>}
            {error && <p className="text-red-700 text-sm">{error}</p>}
          </CardContent>
        </Card>

        <MdxRuntimePreview
          className="md:col-span-1"
          markdown={body}
          frontmatter={{ title, tags: tags.split(',').map(s => s.trim()).filter(Boolean) }}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Articles existants</CardTitle>
          <CardDescription>Cliquer pour éditer</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((it) => (
            <button
              key={`${it.category}/${it.slug}`}
              className="w-full text-left rounded-md border px-3 py-2 hover:bg-muted"
              onClick={() => router.push(`/admin/blobosphere/editor?category=${it.category}&slug=${it.slug}`)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{it.title}</p>
                  <p className="text-xs text-muted-foreground">{it.category} · {it.slug}</p>
                </div>
                <span className="text-xs rounded-full px-2 py-1 border">{it.status}</span>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
