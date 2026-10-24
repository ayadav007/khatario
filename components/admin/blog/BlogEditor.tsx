'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { BlogArticle } from '@/components/blog/BlogArticle';
import { BlogFigure } from '@/components/admin/blog/BlogFigure';
import { BlogMediaDialog } from '@/components/admin/blog/BlogMediaDialog';
import { useAdmin } from '@/context/AdminContext';
import type { AdminBlogPost, BlogCategory, BlogMedia } from '@/lib/blog/repo';
import { suggestSlug } from '@/lib/blog/slug';
import '@/components/blog/blog-content.css';

type Picker = 'inline' | 'featured' | 'og' | null;

const field = 'mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-base text-gray-900';
const label = 'block text-sm font-medium text-gray-700';

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function ToolbarButton({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 rounded-md px-2.5 text-sm font-medium ${active ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
    >
      {children}
    </button>
  );
}

export function BlogEditor({ postId }: { postId?: string }) {
  const { admin } = useAdmin();
  const [post, setPost] = useState<AdminBlogPost | null>(null);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [loading, setLoading] = useState(!!postId);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const categoryData = await readJson(await fetch('/api/admin/blog/categories', platformAdminFetchInit));
        if (!cancelled) setCategories(categoryData.categories || []);
        if (postId) {
          const data = await readJson(await fetch(`/api/admin/blog/${postId}`, platformAdminFetchInit));
          if (!cancelled) setPost(data.post);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the article');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (loading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary-600" /></div>;
  }
  if (error && postId && !post) {
    return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  }

  return (
    <BlogEditorForm
      key={post?.id || 'new'}
      initial={post}
      categories={categories}
      authorFallback={admin?.name || ''}
    />
  );
}

function BlogEditorForm({
  initial,
  categories,
  authorFallback,
}: {
  initial: AdminBlogPost | null;
  categories: BlogCategory[];
  authorFallback: string;
}) {
  const router = useRouter();
  const editorRef = useRef<Editor | null>(null);
  const [title, setTitle] = useState(initial?.title || '');
  const [slug, setSlug] = useState(initial?.slug || '');
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [excerpt, setExcerpt] = useState(initial?.excerpt || '');
  const [authorName, setAuthorName] = useState(initial?.author_name || authorFallback);
  const [categoryId, setCategoryId] = useState(initial?.category_id || '');
  const [categoryName, setCategoryName] = useState('');
  const [tags, setTags] = useState((initial?.tags || []).map((tag) => tag.name).join(', '));
  const [featured, setFeatured] = useState<BlogMedia | null>(initial?.featured_media || null);
  const [og, setOg] = useState<BlogMedia | null>(initial?.og_media || null);
  const [seoTitle, setSeoTitle] = useState(initial?.seo_title || '');
  const [metaDescription, setMetaDescription] = useState(initial?.meta_description || '');
  const [focusKeyword, setFocusKeyword] = useState(initial?.focus_keyword || '');
  const [canonicalUrl, setCanonicalUrl] = useState(initial?.canonical_url || '');
  const [status, setStatus] = useState(initial?.status || 'draft');
  const [publishedAt, setPublishedAt] = useState(initial?.published_at || null);
  const [postId, setPostId] = useState(initial?.id);
  const [picker, setPicker] = useState<Picker>(null);
  const [preview, setPreview] = useState(false);
  const [html, setHtml] = useState(initial?.content_html || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [slugNote, setSlugNote] = useState('');

  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } },
    }),
    Placeholder.configure({ placeholder: 'Write the article. Pasted text from Word or ChatGPT keeps headings, lists, and links.' }),
    BlogFigure.configure({ inline: false, allowBase64: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ], []);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions,
    content: initial?.content_html || '<p></p>',
    onUpdate: ({ editor: current }) => setHtml(current.getHTML()),
    editorProps: {
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void insertFiles(files);
        return true;
      },
      handleDrop(_view, event) {
        const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        void insertFiles(files);
        return true;
      },
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    if (slugTouched) return;
    setSlug(suggestSlug(title));
  }, [title, slugTouched]);

  useEffect(() => {
    if (!slug) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ slug });
      if (postId) params.set('exclude', postId);
      void fetch(`/api/admin/blog/slug?${params}`, platformAdminFetchInit)
        .then((response) => response.json())
        .then((data) => {
          if (data.available) setSlugNote('Slug is available.');
          else setSlugNote(`Slug is taken. Suggested: ${data.suggestion}`);
        })
        .catch(() => setSlugNote(''));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [slug, postId]);

  async function insertFiles(files: File[]) {
    const current = editorRef.current;
    if (!current) return;
    for (const file of files) {
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const body = new FormData();
      body.set('file', file);
      body.set('alt', alt);
      const data = await readJson(await fetch('/api/admin/blog/media', { ...platformAdminFetchInit, method: 'POST', body }));
      current.chain().focus().insertContent({
        type: 'image',
        attrs: {
          src: data.media.url,
          alt: data.media.alt_text,
          caption: '',
          align: 'center',
          size: 'large',
          wrap: 'none',
        },
      }).run();
    }
  }

  function payload(intent: 'save' | 'publish' | 'unpublish') {
    const tagList = tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    return {
      intent,
      title,
      slug,
      excerpt,
      content_html: editor?.getHTML() || html,
      author_name: authorName,
      category_id: categoryId || null,
      category_name: categoryId ? '' : categoryName,
      tags: tagList,
      featured_media_id: featured?.id || null,
      og_media_id: og?.id || null,
      seo_title: seoTitle,
      meta_description: metaDescription,
      focus_keyword: focusKeyword,
      canonical_url: canonicalUrl,
    };
  }

  async function save(intent: 'save' | 'publish' | 'unpublish') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(postId ? `/api/admin/blog/${postId}` : '/api/admin/blog', {
        ...platformAdminFetchInit,
        method: postId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(intent)),
      });
      const data = await readJson(response);
      const saved = data.post as AdminBlogPost;
      setPostId(saved.id);
      setStatus(saved.status);
      setPublishedAt(saved.published_at);
      setSlug(saved.slug);
      setMessage(intent === 'publish' ? 'Published.' : intent === 'unpublish' ? 'Unpublished. It is no longer public.' : saved.status === 'published' ? 'Saved. The article stays published.' : 'Draft saved.');
      if (!postId) router.replace(`/admin/blog/${saved.id}`);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!postId) return;
    setBusy(true);
    setError('');
    try {
      await readJson(await fetch(`/api/admin/blog/${postId}`, { ...platformAdminFetchInit, method: 'DELETE' }));
      router.push('/admin/blog');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setBusy(false);
    }
  }

  function applyImage(attrs: Record<string, string>) {
    editor?.chain().focus().updateAttributes('image', attrs).run();
  }

  const imageActive = !!editor?.isActive('image');
  const imageAttrs = imageActive ? editor?.getAttributes('image') : null;
  const featuredDuplicated = !!featured && html.includes(featured.url);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/blog" className="text-sm font-medium text-primary-700">← All articles</Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">{postId ? 'Edit article' : 'New article'}</h1>
          <p className="text-sm text-gray-500">{status === 'published' ? 'Published' : 'Draft'}{publishedAt ? ` · first published ${new Date(publishedAt).toLocaleString('en-IN')}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPreview((value) => !value)} className="h-11 rounded-lg border border-gray-300 px-3 text-sm font-semibold">{preview ? 'Edit' : 'Preview'}</button>
          {postId ? <Link href={`/admin/blog/${postId}/preview`} className="inline-flex h-11 items-center rounded-lg border border-gray-300 px-3 text-sm font-semibold">Secure preview</Link> : null}
          <button type="button" disabled={busy} onClick={() => void save('save')} className="h-11 rounded-lg border border-gray-300 px-3 text-sm font-semibold disabled:opacity-50">{status === 'published' ? 'Save' : 'Save draft'}</button>
          <button type="button" disabled={busy} onClick={() => void save('publish')} className="h-11 rounded-lg bg-primary-600 px-3 text-sm font-semibold text-white disabled:opacity-50">Publish</button>
          {status === 'published' ? <button type="button" disabled={busy} onClick={() => void save('unpublish')} className="h-11 rounded-lg border border-amber-300 px-3 text-sm font-semibold text-amber-800">Unpublish</button> : null}
        </div>
      </div>
      {message ? <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}
      {error ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {preview ? (
        <div className="rounded-2xl bg-white p-4 ring-1 ring-gray-200 sm:p-8">
          <BlogArticle
            title={title || 'Untitled'}
            excerpt={excerpt}
            author={authorName}
            publishedAt={publishedAt}
            categoryName={categories.find((item) => item.id === categoryId)?.name || categoryName}
            tags={tags.split(',').map((name) => name.trim()).filter(Boolean).map((name) => ({ id: name, name, slug: suggestSlug(name) }))}
            featuredUrl={featured?.url}
            featuredAlt={featured?.alt_text}
            html={editor?.getHTML() || html}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <label className={label}>Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} className={field} />
          </label>
          <label className={label}>Slug
            <input
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              className={field}
            />
          </label>
          {slugNote ? <p className="text-xs text-gray-500">{slugNote}</p> : null}
          <label className={label}>Excerpt
            <textarea value={excerpt} onChange={(event) => setExcerpt(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-gray-300 px-3 py-2 text-base" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Author
              <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} className={field} />
            </label>
            <label className={label}>Category
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={field}>
                <option value="">None</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
          </div>
          {!categoryId ? (
            <label className={label}>New category
              <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} className={field} placeholder="Leave blank to keep none" />
            </label>
          ) : null}
          <label className={label}>Tags
            <input value={tags} onChange={(event) => setTags(event.target.value)} className={field} placeholder="gst, invoices, stock" />
          </label>

          <div className="rounded-xl border border-gray-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-800">Featured image</p>
              <button type="button" onClick={() => setPicker('featured')} className="h-10 rounded-lg border border-gray-300 px-3 text-sm font-semibold">Choose</button>
            </div>
            {featured ? (
              <img src={featured.url} alt={featured.alt_text} className="mt-3 aspect-video w-full max-w-xl rounded-xl object-cover" />
            ) : <p className="mt-2 text-sm text-gray-500">Shown under the title, before the article. It is not copied into the body.</p>}
            {featuredDuplicated ? <p className="mt-2 text-sm text-amber-700">This featured image also appears in the article. Remove the inline copy if you do not want it twice.</p> : null}
          </div>

          <div className="blog-editor overflow-hidden rounded-xl border border-gray-200 bg-white">
            {editor ? (
              <div className="flex flex-wrap gap-1 border-b border-gray-200 p-2">
                <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })}>H1</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>H2</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })}>H3</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>Bold</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}>Italic</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')}>Quote</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>List</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}>Numbered</ToolbarButton>
                <ToolbarButton onClick={() => {
                  const previous = editor.getAttributes('link').href as string | undefined;
                  const next = window.prompt('Link URL', previous || 'https://');
                  if (next == null) return;
                  if (!next.trim()) editor.chain().focus().unsetLink().run();
                  else editor.chain().focus().extendMarkRange('link').setLink({ href: next.trim() }).run();
                }} active={editor.isActive('link')}>Link</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Table</ToolbarButton>
                <ToolbarButton onClick={() => setPicker('inline')}>Image</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().undo().run()}>Undo</ToolbarButton>
                <ToolbarButton onClick={() => editor.chain().focus().redo().run()}>Redo</ToolbarButton>
              </div>
            ) : null}
            {imageActive && imageAttrs ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50 px-2 py-2 text-xs">
                <span className="font-medium text-gray-600">Image</span>
                {(['left', 'center', 'right', 'full'] as const).map((align) => (
                  <button key={align} type="button" className="rounded border border-gray-300 px-2 py-1" onClick={() => applyImage({ align, wrap: align === 'left' || align === 'right' ? imageAttrs.wrap : 'none' })}>{align}</button>
                ))}
                {(['small', 'medium', 'large', 'original'] as const).map((size) => (
                  <button key={size} type="button" className="rounded border border-gray-300 px-2 py-1" onClick={() => applyImage({ size, wrap: size === 'small' ? imageAttrs.wrap : 'none' })}>{size}</button>
                ))}
                <button type="button" className="rounded border border-gray-300 px-2 py-1" onClick={() => applyImage({ align: 'left', size: 'small', wrap: 'left' })}>Wrap left</button>
                <button type="button" className="rounded border border-gray-300 px-2 py-1" onClick={() => applyImage({ align: 'right', size: 'small', wrap: 'right' })}>Wrap right</button>
                <button type="button" className="rounded border border-gray-300 px-2 py-1" onClick={() => applyImage({ wrap: 'none' })}>No wrap</button>
              </div>
            ) : null}
            <EditorContent editor={editor} className="px-4 py-3" />
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <h2 className="text-base font-semibold text-gray-900">SEO</h2>
            <label className={`${label} mt-3`}>SEO title
              <input value={seoTitle} maxLength={70} onChange={(event) => setSeoTitle(event.target.value)} className={field} placeholder={title || 'Search title'} />
            </label>
            <p className="mt-1 text-xs text-gray-500">{seoTitle.length}/60 recommended</p>
            <label className={`${label} mt-3`}>Meta description
              <textarea value={metaDescription} maxLength={200} onChange={(event) => setMetaDescription(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-gray-300 px-3 py-2 text-base" placeholder={excerpt || 'Search description'} />
            </label>
            <p className="mt-1 text-xs text-gray-500">{metaDescription.length}/160 recommended</p>
            <label className={`${label} mt-3`}>Focus keyword
              <input value={focusKeyword} onChange={(event) => setFocusKeyword(event.target.value)} className={field} />
            </label>
            <label className={`${label} mt-3`}>Canonical URL
              <input value={canonicalUrl} onChange={(event) => setCanonicalUrl(event.target.value)} className={field} placeholder="https://" />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-800">Open Graph image</p>
              <button type="button" onClick={() => setPicker('og')} className="h-10 rounded-lg border border-gray-300 px-3 text-sm font-semibold">{og ? 'Replace' : 'Choose'}</button>
            </div>
            {og ? <img src={og.url} alt={og.alt_text} className="mt-3 aspect-video w-full max-w-sm rounded-xl object-cover" /> : <p className="mt-2 text-sm text-gray-500">Falls back to the featured image when this is empty.</p>}
          </div>
        </div>
      )}

      {postId ? (
        <div className="mt-8 border-t border-gray-200 pt-4">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-gray-700">Delete this article permanently?</p>
              <button type="button" disabled={busy} onClick={() => void remove()} className="h-10 rounded-lg bg-red-600 px-3 text-sm font-semibold text-white">Delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-10 rounded-lg border border-gray-300 px-3 text-sm">Cancel</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-medium text-red-700">Delete article</button>
          )}
        </div>
      ) : null}

      <BlogMediaDialog
        open={picker != null}
        title={picker === 'featured' ? 'Featured image' : picker === 'og' ? 'Open Graph image' : 'Insert image'}
        onClose={() => setPicker(null)}
        onPick={(media) => {
          if (picker === 'featured') setFeatured(media);
          else if (picker === 'og') setOg(media);
          else {
            editor?.chain().focus().insertContent({
              type: 'image',
              attrs: {
                src: media.url,
                alt: media.alt_text,
                caption: '',
                align: 'center',
                size: 'large',
                wrap: 'none',
              },
            }).run();
            setHtml(editor?.getHTML() || html);
          }
          setPicker(null);
        }}
      />
    </div>
  );
}
