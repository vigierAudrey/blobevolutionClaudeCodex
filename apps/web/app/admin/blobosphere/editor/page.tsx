"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import matter from 'gray-matter';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '../../../../lib/apiClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Textarea } from '../../../../components/ui/textarea';
import { MdxRuntimePreview } from '@/components/blobosphere/MdxRuntimePreview';
import type { BlobosphereArticlePreview } from '@/lib/blobosphere/loadBlobospherePreviews';

type Category = 'surf'|'kitesurf'|'communaute'|'impact';

type BlobosphereListItem = { category: Category; slug: string; title: string; status: string };
type SaveResponse = {
  success: boolean;
  path: string;
  item?: {
    title: string;
    slug: string;
    category: Category;
    excerpt?: string;
    tags?: string[];
    status?: 'draft' | 'published';
  };
};

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
  const [deleting, setDeleting] = useState(false);
  const [previewArticle, setPreviewArticle] = useState<BlobosphereArticlePreview | null>(null);
  const [previewError, setPreviewError] = useState<string|null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const hydrateFromRaw = useCallback((raw: string, fallbackCategory: Category, fallbackSlug: string) => {
    const { data, content } = matter(raw);
    const resolvedCategory = (typeof data.category === 'string' ? data.category : fallbackCategory) as Category;
    const resolvedSlug = typeof data.slug === 'string' ? data.slug : fallbackSlug;
    setCategory(resolvedCategory);
    setSlug(resolvedSlug);
    setTitle(typeof data.title === 'string' ? data.title : resolvedSlug);
    setExcerpt(typeof data.excerpt === 'string' ? data.excerpt : '');
    setStatus(data.status === 'published' ? 'published' : 'draft');
    const tagValue = Array.isArray(data.tags) ? data.tags.join(', ') : typeof data.tags === 'string' ? data.tags : '';
    setTags(tagValue);
    setBody(content);
  }, []);

  const loadArticle = useCallback(async (targetCategory: Category, targetSlug: string) => {
    const raw = await fetchJson<{ raw: string }>(`/api/blobosphere/posts/${targetCategory}/${targetSlug}`, {
      cache: 'no-store',
    });
    hydrateFromRaw(raw.raw, targetCategory, targetSlug);
  }, [hydrateFromRaw]);

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
          await loadArticle(qCat, qSlug);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Erreur de chargement';
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, params, loadArticle]);

  const canSave = useMemo(() => title.trim().length > 0 && slug.trim().length > 0, [title, slug]);

  const resetForm = () => {
    setMode('create');
    setCategory('surf');
    setSlug('');
    setTitle('');
    setExcerpt('');
    setStatus('draft');
    setTags('');
    setBody('');
    setPreviewArticle(null);
    setPreviewError(null);
  };

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
      let response: SaveResponse;
      if (mode === 'create') {
        response = await fetchJson<SaveResponse>('/api/blobosphere/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setInfo(`Article créé (${response.path})`);
      } else {
        response = await fetchJson<SaveResponse>(`/api/blobosphere/posts/${category}/${slug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setInfo(`Article mis à jour (${response.path})`);
      }
      const targetCategory = (response.item?.category ?? category) as Category;
      const targetSlug = response.item?.slug ?? slug;
      await loadArticle(targetCategory, targetSlug);
      const updatedList = await fetchJson<{ items: BlobosphereListItem[] }>('/api/blobosphere/posts', {
        cache: 'no-store',
      });
      setItems(updatedList.items);
      setPreviewArticle(null);
      setPreviewError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (mode !== 'edit' || !slug) return;
    const confirmed = typeof window === 'undefined' ? true : window.confirm(`Supprimer ${slug} ?`);
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    setInfo(null);
    try {
      await fetchJson<{ success: boolean }>(`/api/blobosphere/posts/${category}/${slug}`, {
        method: 'DELETE',
      });
      const updatedList = await fetchJson<{ items: BlobosphereListItem[] }>('/api/blobosphere/posts', {
        cache: 'no-store',
      });
      setItems(updatedList.items);
      resetForm();
      setInfo('Article supprimé.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      setError(message);
    } finally {
      setDeleting(false);
    }
  };

  const refreshPublishedPreview = async () => {
    if (!slug) {
      setPreviewError('Définis un slug avant de prévisualiser.');
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const preview = await fetchJson<{ item: BlobosphereArticlePreview | null }>(
        `/api/blobosphere/previews?slug=${encodeURIComponent(slug)}`,
      );
      setPreviewArticle(preview.item ?? null);
      if (!preview.item) {
        setPreviewError('Aucun article publié pour ce slug (status = draft ?).');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Impossible de charger la prévisualisation';
      setPreviewError(message);
      setPreviewArticle(null);
    } finally {
      setPreviewLoading(false);
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
              {mode === 'edit' && slug && (
                <Button type="button" variant="destructive" onClick={remove} disabled={deleting}>
                  {deleting ? 'Suppression…' : 'Supprimer l’article'}
                </Button>
              )}
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
        <div className="md:col-span-2 space-y-3 border rounded-lg p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-medium">Prévisualisation depuis les fichiers (via `/blobosphere`).</p>
            <Button variant="outline" size="sm" onClick={refreshPublishedPreview} disabled={previewLoading || !slug}>
              {previewLoading ? 'Chargement…' : 'Prévisualiser l’article final'}
            </Button>
          </div>
          {previewError && <p className="text-sm text-red-600">{previewError}</p>}
          {previewArticle && (
            <Card>
              <CardContent className="space-y-2 py-4">
                <p className="text-sm text-muted-foreground">
                  Publié le {previewArticle.publishedAt} — {previewArticle.readingTime}
                </p>
                <p className="text-lg font-semibold">{previewArticle.title}</p>
                <p className="text-sm text-muted-foreground">{previewArticle.excerpt}</p>
                <div className="flex flex-wrap gap-2">
                  {previewArticle.tags.map((tag) => (
                    <span key={tag} className="rounded-full border px-3 py-1 text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
                <Button asChild size="sm" variant="outline">
                  <a href={`/blobosphere?topic=${previewArticle.topic}#${previewArticle.slug}`} target="_blank" rel="noreferrer">
                    Ouvrir sur /blobosphere
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
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
