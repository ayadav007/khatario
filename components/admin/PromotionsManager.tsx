'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Megaphone, Plus, Edit2, Trash2, Eye, MousePointer2, 
  XCircle, CheckCircle, Clock, Filter, Search,
  ChevronRight, BarChart2, Calendar, Layout,
  Type, Palette, Target, Settings as SettingsIcon, Upload
} from 'lucide-react';
import { format } from 'date-fns';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { useToastContext } from '@/contexts/ToastContext';
import {
  PromotionFormPreview,
  promotionPreviewLabel,
} from '@/components/admin/PromotionFormPreview';

interface Promotion {
  id: string;
  title: string;
  description?: string;
  message_type: 'banner' | 'carousel' | 'modal' | 'sidebar' | 'topbar';
  image_url?: string;
  button_text?: string;
  button_url?: string;
  button_action: string;
  display_position: number;
  priority: number;
  is_active: boolean;
  target_audience: string;
  start_date: string;
  end_date?: string;
  background_color: string;
  text_color: string;
  dismissible: boolean;
  show_once_per_business: boolean;
  topbar_mode?: 'single' | 'vertical_carousel';
  topbar_image_urls?: string[] | unknown;
  topbar_carousel_interval_ms?: number;
  carousel_image_urls?: string[] | unknown;
  carousel_advance_ms?: number;
  view_count?: number;
  click_count?: number;
  dismiss_count?: number;
}

function topbarUrlsToText(urls: unknown): string {
  if (!Array.isArray(urls)) return '';
  return urls.filter((u) => typeof u === 'string').join('\n');
}

function linesToTopbarUrls(text: string): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function carouselLinesFromPromo(p: Promotion): string {
  if (Array.isArray(p.carousel_image_urls) && p.carousel_image_urls.length > 0) {
    return p.carousel_image_urls.filter((u) => typeof u === 'string').join('\n');
  }
  return p.image_url || '';
}

export function PromotionsManager() {
  const { admin } = useAdmin();
  const toast = useToastContext();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'form' | 'analytics'>('list');
  const [selectedPromo, setSelectedPromo] = useState<Promotion | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const topbarFileInputRef = useRef<HTMLInputElement>(null);
  const carouselFileInputRef = useRef<HTMLInputElement>(null);
  const [topbarUploading, setTopbarUploading] = useState(false);
  const [carouselUploading, setCarouselUploading] = useState(false);

  // Form State
  const [formData, setFormData] = useState<
    Partial<Promotion> & { topbar_image_urls_lines?: string; carousel_image_urls_lines?: string }
  >({
    title: '',
    description: '',
    message_type: 'banner',
    button_text: '',
    button_url: '',
    button_action: 'link',
    display_position: 0,
    priority: 0,
    is_active: true,
    target_audience: 'all',
    start_date: new Date().toISOString().slice(0, 16),
    background_color: '#3b82f6',
    text_color: '#ffffff',
    dismissible: true,
    show_once_per_business: false,
    topbar_mode: 'single',
    topbar_image_urls_lines: '',
    topbar_carousel_interval_ms: 5000,
    carousel_image_urls_lines: '',
    carousel_advance_ms: 6000,
  });

  useEffect(() => {
    fetchPromotions();
  }, []);

  const fetchPromotions = async () => {
    if (!admin?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/promotions`, {
        ...platformAdminFetchInit,
      });
      if (res.ok) {
        const data = await res.json();
        setPromotions(data.promotions || []);
      }
    } catch (err) {
      console.error('Failed to fetch promotions', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setSelectedPromo(null);
    setFormData({
      title: '',
      description: '',
      message_type: 'banner',
      button_text: 'Learn More',
      button_url: '',
      button_action: 'link',
      display_position: 0,
      priority: 0,
      is_active: true,
      target_audience: 'all',
      start_date: new Date().toISOString().slice(0, 16),
      background_color: '#3b82f6',
      text_color: '#ffffff',
      dismissible: true,
      show_once_per_business: false,
      topbar_mode: 'single',
      topbar_image_urls_lines: '',
      topbar_carousel_interval_ms: 5000,
      carousel_image_urls_lines: '',
      carousel_advance_ms: 6000,
    });
    setView('form');
  };

  const handleEdit = (promo: Promotion) => {
    setSelectedPromo(promo);
    setFormData({
      ...promo,
      start_date: promo.start_date ? new Date(promo.start_date).toISOString().slice(0, 16) : '',
      end_date: promo.end_date ? new Date(promo.end_date).toISOString().slice(0, 16) : '',
      topbar_image_urls_lines: topbarUrlsToText(promo.topbar_image_urls),
      carousel_image_urls_lines: carouselLinesFromPromo(promo),
      carousel_advance_ms: promo.carousel_advance_ms ?? 6000,
    });
    setView('form');
  };

  const handleViewAnalytics = async (promo: Promotion) => {
    setSelectedPromo(promo);
    setView('analytics');
    setLoadingAnalytics(true);
    try {
      const res = await fetch(`/api/admin/promotions/${promo.id}/analytics`, {
        ...platformAdminFetchInit,
      });
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } catch (err) {
      console.error('Failed to fetch analytics', err);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this promotion?')) return;
    try {
      const res = await fetch(`/api/admin/promotions/${id}`, {
        ...platformAdminFetchInit,
        method: 'DELETE',
      });
      if (res.ok) {
        fetchPromotions();
      }
    } catch (err) {
      console.error('Failed to delete promotion', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admin?.id) return;

    const topbarLines = linesToTopbarUrls(formData.topbar_image_urls_lines || '');
    const carouselLines = linesToTopbarUrls(formData.carousel_image_urls_lines || '');
    let imageUrl = formData.image_url || undefined;
    if (formData.message_type === 'topbar') {
      if (topbarLines.length > 0 && !imageUrl) {
        imageUrl = topbarLines[0];
      }
    }
    if (formData.message_type === 'carousel' && carouselLines.length > 0) {
      imageUrl = carouselLines[0];
    }

    const payload: Record<string, unknown> = {
      ...formData,
      image_url: imageUrl ?? formData.image_url,
    };
    delete payload.topbar_image_urls_lines;
    delete payload.carousel_image_urls_lines;

    if (formData.message_type === 'topbar') {
      payload.topbar_mode = formData.topbar_mode || 'single';
      payload.topbar_image_urls = topbarLines;
      payload.topbar_carousel_interval_ms = Math.min(
        120000,
        Math.max(2000, Number(formData.topbar_carousel_interval_ms) || 5000)
      );
    } else {
      delete payload.topbar_mode;
      delete payload.topbar_image_urls;
      delete payload.topbar_carousel_interval_ms;
    }

    if (formData.message_type === 'carousel') {
      if (carouselLines.length > 0) {
        payload.carousel_image_urls = carouselLines;
        payload.image_url = carouselLines[0];
      } else {
        payload.carousel_image_urls = [];
        payload.image_url = formData.image_url || null;
      }
      payload.carousel_advance_ms = Math.min(
        120000,
        Math.max(2000, Number(formData.carousel_advance_ms) || 6000)
      );
    } else {
      delete payload.carousel_image_urls;
      delete payload.carousel_advance_ms;
    }

    const url = selectedPromo 
      ? `/api/admin/promotions/${selectedPromo.id}` 
      : '/api/admin/promotions';
    const method = selectedPromo ? 'PATCH' : 'POST';

    try {
      const res = await fetch(url, {
        ...platformAdminFetchInit,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setView('list');
        fetchPromotions();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save promotion');
      }
    } catch (err) {
      console.error('Error saving promotion', err);
    }
  };

  const handleTopbarImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setTopbarUploading(true);
    const newLines: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} is not a supported image type`);
          continue;
        }
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'promo');
        const res = await fetch('/api/upload/image', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Upload failed');
        }
        if (data.url) {
          newLines.push(data.url);
        }
      }
      if (newLines.length > 0) {
        setFormData((prev) => {
          const cur = (prev.topbar_image_urls_lines || '').trim();
          const append = newLines.join('\n');
          return {
            ...prev,
            topbar_image_urls_lines: cur ? `${cur}\n${append}` : append,
          };
        });
        toast.success(
          newLines.length === 1
            ? 'Image uploaded — URL added below'
            : `${newLines.length} images uploaded — URLs added below`
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setTopbarUploading(false);
      e.target.value = '';
    }
  };

  const handleCarouselImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setCarouselUploading(true);
    const newLines: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} is not a supported image type`);
          continue;
        }
        const formDataUpload = new FormData();
        formDataUpload.append('file', file);
        formDataUpload.append('type', 'promo');
        const res = await fetch('/api/upload/image', { method: 'POST', body: formDataUpload });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Upload failed');
        }
        if (data.url) {
          newLines.push(data.url);
        }
      }
      if (newLines.length > 0) {
        setFormData((prev) => {
          const cur = (prev.carousel_image_urls_lines || '').trim();
          const append = newLines.join('\n');
          return {
            ...prev,
            carousel_image_urls_lines: cur ? `${cur}\n${append}` : append,
          };
        });
        toast.success(
          newLines.length === 1
            ? 'Image uploaded — URL added below'
            : `${newLines.length} images uploaded — URLs added below`
        );
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setCarouselUploading(false);
      e.target.value = '';
    }
  };

  const getStatusBadge = (promo: Promotion) => {
    const now = new Date();
    const start = new Date(promo.start_date);
    const end = promo.end_date ? new Date(promo.end_date) : null;

    if (!promo.is_active) return <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">Inactive</span>;
    if (start > now) return <span className="px-2 py-1 bg-slate-100 text-primary-600 rounded-full text-xs font-medium">Scheduled</span>;
    if (end && end < now) return <span className="px-2 py-1 bg-red-100 text-red-600 rounded-full text-xs font-medium">Expired</span>;
    return <span className="px-2 py-1 bg-green-100 text-green-600 rounded-full text-xs font-medium">Active</span>;
  };

  if (view === 'form') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">
            {selectedPromo ? 'Edit Promotion' : 'Create New Promotion'}
          </h3>
          <button 
            onClick={() => setView('list')}
            className="text-gray-500 hover:text-gray-700 font-medium"
          >
            Cancel
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Form sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Basic Info */}
            <div className="space-y-4 bg-gray-50 p-6 rounded-2xl border border-gray-100">
              <div className="flex items-center gap-2 text-primary-600 font-bold mb-2">
                <Type className="w-5 h-5" />
                <h4>Basic Information</h4>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input 
                  type="text" 
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                  placeholder="Upgrade to Professional Plan"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea 
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                  rows={3}
                  placeholder="Get 20% off on yearly subscription..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Message Type</label>
                <select 
                  value={formData.message_type}
                  onChange={(e) => setFormData({...formData, message_type: e.target.value as Promotion['message_type']})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                >
                  <option value="banner">Top Banner</option>
                  <option value="carousel">Dashboard Carousel</option>
                  <option value="modal">Popup Modal</option>
                  <option value="sidebar">Sidebar Banner</option>
                  <option value="topbar">App top bar (center, desktop)</option>
                </select>
                {formData.message_type === 'carousel' && (
                  <p className="text-xs text-primary-800 dark:text-primary-200/90 mt-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2 border border-primary-200/80 dark:border-primary-800/50">
                    <strong>How it works:</strong> Each <strong>carousel</strong> promotion is one or more{' '}
                    <strong>visual slides</strong> with the <strong>same</strong> title, description, and
                    button. Add <strong>one URL per line</strong> below for multiple art slides,{' '}
                    <strong>or</strong> create <strong>separate</strong> dashboard carousel promotions to
                    rotate different messages. <strong>Background and text colors</strong> are under{' '}
                    <em>Style &amp; Behavior</em> (next column / below on small screens).
                  </p>
                )}
              </div>

              {formData.message_type === 'topbar' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Top bar display</label>
                    <select
                      value={formData.topbar_mode || 'single'}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          topbar_mode: e.target.value as 'single' | 'vertical_carousel',
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="single">Single image</option>
                      <option value="vertical_carousel">Vertical carousel (slides move upward)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Slides use a vertical strip (each image steps up; not left-right). Use 2+ URLs for
                      carousel. Desktop app header only.
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Images — upload or paste URLs (one per line)
                      </label>
                      <div>
                        <input
                          ref={topbarFileInputRef}
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                          multiple
                          className="hidden"
                          onChange={handleTopbarImageUpload}
                          disabled={topbarUploading}
                        />
                        <button
                          type="button"
                          onClick={() => topbarFileInputRef.current?.click()}
                          disabled={topbarUploading}
                          className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-primary-700 transition hover:bg-slate-100 disabled:opacity-50"
                        >
                          <Upload className="h-4 w-4" />
                          {topbarUploading ? 'Uploading…' : 'Upload image(s)'}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mb-1">
                      Uploads are embedded (max ~2MB each) and appear as long lines in the field — you
                      can also paste <span className="whitespace-nowrap">https://…</span> links instead.
                    </p>
                    <p className="text-xs text-amber-800 dark:text-amber-200/90 mb-1 rounded bg-amber-50 dark:bg-amber-950/50 px-2 py-1.5 border border-amber-200/80 dark:border-amber-800/50">
                      <strong>Sharpness:</strong> The bar is a short, full-width strip with{' '}
                      <span className="whitespace-nowrap">object-fit: cover</span> — the image is scaled
                      and cropped to fill. Use a <strong>high-resolution</strong> file (e.g. height{' '}
                      <strong>≥ 128px</strong> for the part of the art you care about) and{' '}
                      <strong>PNG or WebP</strong>; heavy JPEG or tiny sources will look soft when
                      scaled.
                    </p>
                    <textarea
                      value={formData.topbar_image_urls_lines || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, topbar_image_urls_lines: e.target.value })
                      }
                      rows={4}
                      className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                      placeholder={'https://example.com/offer-1.png\nhttps://example.com/offer-2.png'}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Carousel interval (ms)
                    </label>
                    <input
                      type="number"
                      min={2000}
                      max={120000}
                      step={1000}
                      value={formData.topbar_carousel_interval_ms ?? 5000}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          topbar_carousel_interval_ms: parseInt(e.target.value, 10) || 5000,
                        })
                      }
                      className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">2–120 seconds. Ignored for single image.</p>
                  </div>
                </div>
              ) : formData.message_type === 'carousel' ? (
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Carousel images — one URL per line (or upload)
                      </label>
                      <div>
                        <input
                          ref={carouselFileInputRef}
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                          multiple
                          className="hidden"
                          onChange={handleCarouselImageUpload}
                          disabled={carouselUploading}
                        />
                        <button
                          type="button"
                          onClick={() => carouselFileInputRef.current?.click()}
                          disabled={carouselUploading}
                          className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-primary-700 transition hover:bg-slate-100 disabled:opacity-50"
                        >
                          <Upload className="h-4 w-4" />
                          {carouselUploading ? 'Uploading…' : 'Upload image(s)'}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mb-1">
                      Same copy and CTA for every slide; only the right-side art changes. Use{' '}
                      <strong>high-resolution</strong> images (e.g. PNG/WebP) without watermarks for best
                      results. Paste <span className="whitespace-nowrap">https://…</span> links or upload.
                    </p>
                    <textarea
                      value={formData.carousel_image_urls_lines || ''}
                      onChange={(e) =>
                        setFormData({ ...formData, carousel_image_urls_lines: e.target.value })
                      }
                      rows={4}
                      className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                      placeholder={
                        'https://example.com/slide-1.png\nhttps://example.com/slide-2.png\nhttps://example.com/slide-3.png'
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Time per slide (ms)
                    </label>
                    <input
                      type="number"
                      min={2000}
                      max={120000}
                      step={1000}
                      value={formData.carousel_advance_ms ?? 6000}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          carousel_advance_ms: parseInt(e.target.value, 10) || 6000,
                        })
                      }
                      className="w-full max-w-xs px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      2–120 seconds. Applies to this promotion&apos;s slides (and matches other promotions
                      in the same rotator; each can set its own value).
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Image URL (Optional)</label>
                  <input 
                    type="text" 
                    value={formData.image_url || ''}
                    onChange={(e) => setFormData({...formData, image_url: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                    placeholder="https://example.com/promo.png"
                  />
                </div>
              )}
            </div>

            {/* CTA Settings */}
            <div className="space-y-4 bg-gray-50 p-6 rounded-2xl border border-gray-100">
              <div className="flex items-center gap-2 text-primary-600 font-bold mb-2">
                <Layout className="w-5 h-5" />
                <h4>Call to Action</h4>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Button Text</label>
                <input 
                  type="text" 
                  value={formData.button_text || ''}
                  onChange={(e) => setFormData({...formData, button_text: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                  placeholder="Get Offer"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
                <select 
                  value={formData.button_action}
                  onChange={(e) => setFormData({...formData, button_action: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                >
                  <option value="link">External Link</option>
                  <option value="route">Internal Route</option>
                  <option value="upgrade_modal">Trigger Upgrade Modal</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target URL / Route</label>
                <input 
                  type="text" 
                  value={formData.button_url || ''}
                  onChange={(e) => setFormData({...formData, button_url: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                  placeholder={formData.button_action === 'link' ? 'https://...' : '/settings/plan'}
                />
              </div>
            </div>

            {/* Targeting & Scheduling */}
            <div className="space-y-4 bg-gray-50 p-6 rounded-2xl border border-gray-100">
              <div className="flex items-center gap-2 text-primary-600 font-bold mb-2">
                <Target className="w-5 h-5" />
                <h4>Targeting & Schedule</h4>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
                <select 
                  value={formData.target_audience}
                  onChange={(e) => setFormData({...formData, target_audience: e.target.value})}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                >
                  <option value="all">All Businesses</option>
                  <option value="free">Free Plan Users</option>
                  <option value="professional">Professional Plan Users</option>
                  <option value="business">Business Plan Users</option>
                  <option value="enterprise">Enterprise Plan Users</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input 
                    type="datetime-local" 
                    required
                    value={formData.start_date}
                    onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date (Optional)</label>
                  <input 
                    type="datetime-local" 
                    value={formData.end_date || ''}
                    onChange={(e) => setFormData({...formData, end_date: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
            </div>

            {/* Display & Behavior */}
            <div className="space-y-4 bg-gray-50 p-6 rounded-2xl border border-gray-100">
              <div className="flex items-center gap-2 text-primary-600 font-bold mb-2">
                <Palette className="w-5 h-5" />
                <h4>Style & Behavior</h4>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Background Color</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="color" 
                      value={formData.background_color}
                      onChange={(e) => setFormData({...formData, background_color: e.target.value})}
                      className="h-10 w-12 rounded border border-gray-300 p-1"
                    />
                    <input 
                      type="text" 
                      value={formData.background_color}
                      onChange={(e) => setFormData({...formData, background_color: e.target.value})}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Text Color</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="color" 
                      value={formData.text_color}
                      onChange={(e) => setFormData({...formData, text_color: e.target.value})}
                      className="h-10 w-12 rounded border border-gray-300 p-1"
                    />
                    <input 
                      type="text" 
                      value={formData.text_color}
                      onChange={(e) => setFormData({...formData, text_color: e.target.value})}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority (0-10)</label>
                  <input 
                    type="number" 
                    min="0" max="10"
                    value={formData.priority}
                    onChange={(e) => setFormData({...formData, priority: parseInt(e.target.value)})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Position Index</label>
                  <input 
                    type="number" 
                    min="0"
                    value={formData.display_position}
                    onChange={(e) => setFormData({...formData, display_position: parseInt(e.target.value)})}
                    className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={formData.is_active}
                    onChange={(e) => setFormData({...formData, is_active: e.target.checked})}
                    className="w-4 h-4 rounded text-primary-600"
                  />
                  <span className="text-sm font-medium">Is Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={formData.dismissible}
                    onChange={(e) => setFormData({...formData, dismissible: e.target.checked})}
                    className="w-4 h-4 rounded text-primary-600"
                  />
                  <span className="text-sm font-medium">Dismissible</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={formData.show_once_per_business}
                    onChange={(e) => setFormData({...formData, show_once_per_business: e.target.checked})}
                    className="w-4 h-4 rounded text-primary-600"
                  />
                  <span className="text-sm font-medium">Show Once Only</span>
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-primary-200 bg-gradient-to-b from-slate-50/60 to-white dark:from-slate-900/20 dark:to-gray-900/30 p-6 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2 text-primary-700 dark:text-primary-300 font-bold">
                <Eye className="w-5 h-5 shrink-0" />
                <h4 className="text-base">Live preview</h4>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 sm:text-right max-w-md">
                {promotionPreviewLabel(formData.message_type ?? 'banner')}
              </p>
            </div>
            <p className="text-xs text-gray-500">
              Approximate look in the app. Saving is unchanged — this is for layout and colors only.
            </p>
            <div className="pt-1">
              <PromotionFormPreview
                form={{
                  message_type: formData.message_type ?? 'banner',
                  title: formData.title ?? '',
                  description: formData.description,
                  image_url: formData.image_url,
                  button_text: formData.button_text,
                  button_url: formData.button_url,
                  button_action: formData.button_action,
                  background_color: formData.background_color || '#3b82f6',
                  text_color: formData.text_color || '#ffffff',
                  dismissible: formData.dismissible,
                  topbar_mode: formData.topbar_mode,
                  topbar_image_urls_lines: formData.topbar_image_urls_lines,
                  carousel_image_urls_lines: formData.carousel_image_urls_lines,
                  carousel_advance_ms: formData.carousel_advance_ms,
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-4 pt-6 border-t">
            <button 
              type="button"
              onClick={() => setView('list')}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-all"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="px-10 py-2 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 shadow-lg shadow-primary-200 transition-all"
            >
              {selectedPromo ? 'Update Promotion' : 'Create Promotion'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (view === 'analytics') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Analytics: {selectedPromo?.title}</h3>
            <p className="text-sm text-gray-500">Performance tracking for the last 30 days</p>
          </div>
          <button 
            onClick={() => setView('list')}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700 font-medium"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back to List
          </button>
        </div>

        {loadingAnalytics ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3 text-primary-600 mb-2">
                  <Eye className="w-5 h-5" />
                  <span className="text-sm font-medium uppercase tracking-wider">Total Views</span>
                </div>
                <p className="text-3xl font-black">{analytics?.summary?.total_views || 0}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3 text-green-600 mb-2">
                  <MousePointer2 className="w-5 h-5" />
                  <span className="text-sm font-medium uppercase tracking-wider">Total Clicks</span>
                </div>
                <p className="text-3xl font-black">{analytics?.summary?.total_clicks || 0}</p>
                <p className="text-xs text-green-600 mt-1 font-bold">
                  {analytics?.summary?.total_views > 0 
                    ? ((analytics.summary.total_clicks / analytics.summary.total_views) * 100).toFixed(1)
                    : 0}% CTR
                </p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3 text-red-600 mb-2">
                  <XCircle className="w-5 h-5" />
                  <span className="text-sm font-medium uppercase tracking-wider">Dismissals</span>
                </div>
                <p className="text-3xl font-black">{analytics?.summary?.total_dismissals || 0}</p>
              </div>
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3 text-purple-600 mb-2">
                  <Clock className="w-5 h-5" />
                  <span className="text-sm font-medium uppercase tracking-wider">Unique Orgs</span>
                </div>
                <p className="text-3xl font-black">{analytics?.summary?.unique_businesses || 0}</p>
              </div>
            </div>

            {/* Plan Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Target className="w-5 h-5 text-primary-500" />
                  Views by Subscription Plan
                </h4>
                <div className="space-y-4">
                  {analytics?.plan_breakdown?.length > 0 ? analytics.plan_breakdown.map((plan: any) => (
                    <div key={plan.plan_id}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium capitalize">{plan.plan_id}</span>
                        <span className="text-gray-500">{plan.view_count} views</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div 
                          className="bg-primary-500 h-2 rounded-full" 
                          style={{ width: `${(plan.view_count / analytics.summary.total_views) * 100}%` }}
                        />
                      </div>
                    </div>
                  )) : (
                    <p className="text-center py-10 text-gray-400">No plan data available</p>
                  )}
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary-500" />
                  Daily Impressions (Last 30 Days)
                </h4>
                {analytics?.daily_views?.length > 0 ? (
                  <div className="flex items-end gap-1 h-48 pt-4">
                    {analytics.daily_views.map((day: any, idx: number) => {
                      const max = Math.max(...analytics.daily_views.map((d: any) => parseInt(d.count)));
                      const height = (parseInt(day.count) / max) * 100;
                      return (
                        <div 
                          key={idx} 
                          className="flex-1 bg-primary-200 hover:bg-primary-400 rounded-t transition-all group relative"
                          style={{ height: `${height}%` }}
                        >
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-800 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">
                            {format(new Date(day.date), 'MMM d')}: {day.count}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-400">
                    No daily data available
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-primary-600" />
            Promotional Messages
          </h3>
          <p className="text-sm text-gray-500">Manage in-app banners, carousels, and popups</p>
        </div>
        <button 
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 shadow-md shadow-primary-100 transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Create Promotion
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <div className="overflow-hidden border border-gray-200 rounded-2xl bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Promotion</th>
                <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest text-center">Stats</th>
                <th className="px-6 py-4 text-xs font-black text-gray-500 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {promotions.length > 0 ? promotions.map((promo) => (
                <tr key={promo.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-gray-900">{promo.title}</span>
                      <span className="text-xs text-gray-500 line-clamp-1">{promo.description || 'No description'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="capitalize text-sm font-medium text-gray-700 px-2 py-1 bg-gray-100 rounded-lg">
                      {promo.message_type === 'topbar'
                        ? 'Top bar'
                        : promo.message_type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {getStatusBadge(promo)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-center gap-4 text-xs text-gray-600">
                      <div className="flex flex-col items-center">
                        <span className="font-bold">{promo.view_count || 0}</span>
                        <span className="text-[10px] uppercase text-gray-400">Views</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="font-bold text-green-600">{promo.click_count || 0}</span>
                        <span className="text-[10px] uppercase text-gray-400">Clicks</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button 
                        onClick={() => handleViewAnalytics(promo)}
                        className="p-2 hover:bg-slate-50 text-primary-600 rounded-lg transition-colors"
                        title="Analytics"
                      >
                        <BarChart2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleEdit(promo)}
                        className="p-2 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(promo.id)}
                        className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center gap-2">
                      <Megaphone className="w-10 h-10 opacity-20" />
                      <p>No promotions found. Create your first campaign!</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

