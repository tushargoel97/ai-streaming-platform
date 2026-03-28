import { useState, useEffect, useCallback, useRef } from "react";
import {
  Upload,
  Search,
  Trash2,
  Edit3,
  Star,
  StarOff,
  X,
  Film,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  RefreshCw,
} from "lucide-react";
import { api } from "@/api/client";
import type { Video, Category, PaginatedResponse, AdminTenant } from "@/types/api";
import { formatDuration } from "@/lib/utils";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

type VideoStatus = Video["status"];

const API_URL = import.meta.env.VITE_API_URL || "/api/v1";

const STATUS_CONFIG: Record<VideoStatus, { label: string; color: string; icon: React.ReactNode }> = {
  uploading: { label: "Uploading", color: "text-blue-400", icon: <Loader2 size={14} className="animate-spin" /> },
  processing: { label: "Processing", color: "text-yellow-400", icon: <Clock size={14} /> },
  ready: { label: "Ready", color: "text-green-400", icon: <CheckCircle2 size={14} /> },
  failed: { label: "Failed", color: "text-red-400", icon: <AlertCircle size={14} /> },
  deleted: { label: "Deleted", color: "text-gray-500", icon: <Trash2 size={14} /> },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function TranscodeProgress({ videoId, onComplete }: { videoId: string; onComplete: () => void }) {
  const [progress, setProgress] = useState<{ percent: number; stage: string }>({ percent: 0, stage: "queued" });

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const url = `${API_URL}/admin/transcode/${videoId}/status`;

    const eventSource = new EventSource(url);

    // EventSource doesn't support auth headers natively, so we use fetch-based SSE
    let cancelled = false;

    async function connectSSE() {
      try {
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                setProgress(data);
                if (data.percent >= 100 || data.stage === "failed") {
                  cancelled = true;
                  onComplete();
                  return;
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        }
      } catch {
        // connection lost, will refresh on next list fetch
      }
    }

    // Close native EventSource (not used, we use fetch-based)
    eventSource.close();
    connectSSE();

    return () => {
      cancelled = true;
      eventSource.close();
    };
  }, [videoId, onComplete]);

  const stageLabels: Record<string, string> = {
    queued: "Queued",
    starting: "Starting",
    downloading: "Preparing",
    probing: "Analyzing",
    transcoding: "Transcoding",
    uploading: "Saving files",
    thumbnails: "Thumbnails",
    finalizing: "Finalizing",
    completed: "Complete",
    failed: "Failed",
  };

  const percent = Math.max(0, progress.percent);
  const label = stageLabels[progress.stage] || progress.stage;

  return (
    <div className="w-32">
      <div className="mb-0.5 flex justify-between text-[10px] text-yellow-400">
        <span>{label}</span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-yellow-400 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function VideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  // Categories & Tenants
  const [categories, setCategories] = useState<Category[]>([]);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);

  // Upload state
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadClassification, setUploadClassification] = useState("safe");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadCategoryIds, setUploadCategoryIds] = useState<string[]>([]);
  const [uploadTenantIds, setUploadTenantIds] = useState<string[]>([]);
  const [uploadMinTierLevel, setUploadMinTierLevel] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // Edit state
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editClassification, setEditClassification] = useState("safe");
  const [editTags, setEditTags] = useState("");
  const [editCategoryIds, setEditCategoryIds] = useState<string[]>([]);
  const [editTenantIds, setEditTenantIds] = useState<string[]>([]);
  const [editMinTierLevel, setEditMinTierLevel] = useState(0);
  const [saving, setSaving] = useState(false);

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmVideo, setConfirmVideo] = useState<Video | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageSize = 20;

  const fetchVideos = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        page_size: String(pageSize),
      };
      if (statusFilter) params.status_filter = statusFilter;
      if (search) params.search = search;

      const data = await api.get<PaginatedResponse<Video>>("/admin/videos", params);
      setVideos(data.items);
      setTotal(data.total);
    } catch {
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // Fetch categories and tenants for dropdowns
  useEffect(() => {
    api.get<Category[]>("/admin/categories").then(setCategories).catch(() => {});
    api.get<{ items: AdminTenant[] }>("/admin/tenants").then((d) => setTenants(d.items)).catch(() => {});
  }, []);

  // Upload handlers
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  };

  const selectFile = (file: File) => {
    setUploadFile(file);
    if (!uploadTitle) {
      // Auto-fill title from filename
      const name = file.name.replace(/\.[^.]+$/, "").replace(/[_.-]+/g, " ");
      setUploadTitle(name);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploadError("");
    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("title", uploadTitle);
      formData.append("description", uploadDesc);
      formData.append("content_classification", uploadClassification);
      formData.append("tags", uploadTags);
      if (uploadCategoryIds.length > 0) {
        formData.append("category_ids", uploadCategoryIds.join(","));
      }
      if (uploadTenantIds.length > 0) {
        formData.append("tenant_ids", uploadTenantIds.join(","));
      }
      formData.append("min_tier_level", String(uploadMinTierLevel));

      // Use XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${import.meta.env.VITE_API_URL || "/api/v1"}/admin/videos/upload`);

        const token = localStorage.getItem("access_token");
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(xhr.responseText));
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(formData);
      });

      // Reset upload form and refresh list
      setShowUpload(false);
      resetUploadForm();
      fetchVideos();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadTitle("");
    setUploadDesc("");
    setUploadClassification("safe");
    setUploadTags("");
    setUploadCategoryIds([]);
    setUploadTenantIds([]);
    setUploadMinTierLevel(0);
    setUploadError("");
    setUploadProgress(0);
  };

  // Edit handlers
  const openEdit = (video: Video) => {
    setEditingVideo(video);
    setEditTitle(video.title);
    setEditDesc(video.description);
    setEditClassification(video.content_classification);
    setEditTags(video.tags.join(", "));
    setEditCategoryIds(video.category_ids || []);
    setEditTenantIds(video.tenant_ids || []);
    setEditMinTierLevel(video.min_tier_level || 0);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVideo) return;
    setSaving(true);
    try {
      await api.patch(`/admin/videos/${editingVideo.id}`, {
        title: editTitle,
        description: editDesc,
        content_classification: editClassification,
        tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
        category_ids: editCategoryIds,
        tenant_ids: editTenantIds,
        min_tier_level: editMinTierLevel,
      });
      setEditingVideo(null);
      fetchVideos();
    } catch {
      // keep modal open
    } finally {
      setSaving(false);
    }
  };

  // Feature toggle
  const toggleFeatured = async (video: Video) => {
    try {
      await api.post(`/admin/videos/${video.id}/feature`);
      fetchVideos();
    } catch {
      // silent
    }
  };

  // Retranscode failed video
  const handleRetranscode = async (video: Video) => {
    try {
      await api.post(`/admin/videos/${video.id}/retranscode`);
      fetchVideos();
    } catch {
      // silent
    }
  };

  // Delete
  const requestDelete = (video: Video) => {
    setConfirmVideo(video);
    setConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!confirmVideo) return;
    try {
      await api.delete(`/admin/videos/${confirmVideo.id}`);
      fetchVideos();
    } catch {
      // silent
    } finally {
      setConfirmOpen(false);
      setConfirmVideo(null);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Videos</h1>
        <button
          onClick={() => { setShowUpload(true); resetUploadForm(); }}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Upload size={16} /> Upload Video
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search videos..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[var(--primary)]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none"
        >
          <option value="">All Statuses</option>
          <option value="uploading">Uploading</option>
          <option value="processing">Processing</option>
          <option value="ready">Ready</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Video List */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Film size={40} className="mb-3 opacity-50" />
            <p>No videos found. Upload your first video to get started.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Classification</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Views</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {videos.map((v) => {
                const st = STATUS_CONFIG[v.status];
                return (
                  <tr key={v.id} className="hover:bg-white/5">
                    <td className="max-w-[300px] truncate px-4 py-3 font-medium text-white">
                      {v.title}
                    </td>
                    <td className="px-4 py-3">
                      {v.status === "processing" ? (
                        <TranscodeProgress videoId={v.id} onComplete={fetchVideos} />
                      ) : (
                        <span className={`flex items-center gap-1.5 ${st.color}`}>
                          {st.icon} {st.label}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                        v.content_classification === "explicit"
                          ? "bg-red-500/20 text-red-400"
                          : v.content_classification === "mature"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-green-500/20 text-green-400"
                      }`}>
                        {v.content_classification}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatBytes(v.file_size || 0)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDuration(v.duration)}</td>
                    <td className="px-4 py-3 text-gray-400">{v.view_count.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {v.status === "failed" && (
                          <button
                            onClick={() => handleRetranscode(v)}
                            className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-blue-400"
                            title="Retry Transcode"
                          >
                            <RefreshCw size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => toggleFeatured(v)}
                          className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-yellow-400"
                          title={v.is_featured ? "Unfeature" : "Feature"}
                        >
                          {v.is_featured ? <Star size={16} className="fill-yellow-400 text-yellow-400" /> : <StarOff size={16} />}
                        </button>
                        <button
                          onClick={() => openEdit(v)}
                          className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                          title="Edit"
                        >
                          <Edit3 size={16} />
                        </button>
                        <button
                          onClick={() => requestDelete(v)}
                          className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
            <span className="text-sm text-gray-400">
              {total} video{total !== 1 ? "s" : ""} total
            </span>
            <div className="flex gap-1">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i + 1)}
                  className={`rounded px-3 py-1 text-sm ${
                    page === i + 1
                      ? "bg-[var(--primary)] text-white"
                      : "text-gray-400 hover:bg-white/10"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ===== Upload Modal ===== */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Upload Video</h2>
              <button onClick={() => setShowUpload(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleUpload} className="space-y-4">
              {uploadError && (
                <p className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">{uploadError}</p>
              )}

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 transition-colors ${
                  dragOver
                    ? "border-[var(--primary)] bg-[var(--primary)]/10"
                    : "border-[var(--border)] hover:border-gray-500"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) selectFile(f);
                  }}
                />
                {uploadFile ? (
                  <div className="text-center">
                    <Film size={32} className="mx-auto mb-2 text-[var(--primary)]" />
                    <p className="font-medium text-white">{uploadFile.name}</p>
                    <p className="text-sm text-gray-400">{formatBytes(uploadFile.size)}</p>
                  </div>
                ) : (
                  <>
                    <Upload size={32} className="mb-2 text-gray-500" />
                    <p className="text-sm text-gray-400">
                      Drag & drop a video file, or <span className="text-[var(--primary)]">browse</span>
                    </p>
                  </>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Title</label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Description</label>
                <textarea
                  value={uploadDesc}
                  onChange={(e) => setUploadDesc(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Content Classification</label>
                  <select
                    value={uploadClassification}
                    onChange={(e) => setUploadClassification(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="safe">Safe</option>
                    <option value="mature">Mature</option>
                    <option value="explicit">Explicit</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={uploadTags}
                    onChange={(e) => setUploadTags(e.target.value)}
                    placeholder="action, drama"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              {/* Category multi-select */}
              <div>
                <label className="mb-1 block text-xs text-gray-400">Categories</label>
                {categories.length > 0 ? (
                  <div className="flex flex-wrap gap-2 rounded border border-[var(--border)] bg-[var(--secondary)] p-2">
                    {categories.map((cat) => {
                      const selected = uploadCategoryIds.includes(cat.id);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() =>
                            setUploadCategoryIds((prev) =>
                              selected ? prev.filter((id) => id !== cat.id) : [...prev, cat.id]
                            )
                          }
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            selected
                              ? "bg-[var(--primary)] text-white"
                              : "bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white"
                          }`}
                        >
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    No categories yet.{" "}
                    <a href="/admin/categories" className="text-[var(--primary)] hover:underline">
                      Create categories
                    </a>{" "}
                    first.
                  </p>
                )}
              </div>

              {/* Tenant multi-select */}
              <div>
                <label className="mb-1 block text-xs text-gray-400">Publish to Tenants</label>
                {tenants.length > 0 ? (
                  <div className="flex flex-wrap gap-2 rounded border border-[var(--border)] bg-[var(--secondary)] p-2">
                    {tenants.map((t) => {
                      const selected = uploadTenantIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() =>
                            setUploadTenantIds((prev) =>
                              selected ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                            )
                          }
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            selected
                              ? "bg-blue-500 text-white"
                              : "bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white"
                          }`}
                        >
                          {t.site_name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No tenants available.</p>
                )}
              </div>

              {/* Min Tier Level */}
              <div>
                <label className="mb-1 block text-xs text-gray-400">
                  Min Subscription Tier Level (0 = free)
                </label>
                <input
                  type="number"
                  min={0}
                  value={uploadMinTierLevel}
                  onChange={(e) => setUploadMinTierLevel(Number(e.target.value))}
                  className="w-32 rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              {/* Progress bar */}
              {uploading && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-gray-400">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--secondary)]">
                    <div
                      className="h-full rounded-full bg-[var(--primary)] transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUpload(false)}
                  className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!uploadFile || uploading}
                  className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {uploading ? (
                    <><Loader2 size={14} className="animate-spin" /> Uploading...</>
                  ) : (
                    <><Upload size={14} /> Upload</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== Edit Modal ===== */}
      {editingVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Edit Video</h2>
              <button onClick={() => setEditingVideo(null)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Description</label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Content Classification</label>
                  <select
                    value={editClassification}
                    onChange={(e) => setEditClassification(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="safe">Safe</option>
                    <option value="mature">Mature</option>
                    <option value="explicit">Explicit</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              {/* Category multi-select */}
              <div>
                <label className="mb-1 block text-xs text-gray-400">Categories</label>
                {categories.length > 0 ? (
                  <div className="flex flex-wrap gap-2 rounded border border-[var(--border)] bg-[var(--secondary)] p-2">
                    {categories.map((cat) => {
                      const selected = editCategoryIds.includes(cat.id);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() =>
                            setEditCategoryIds((prev) =>
                              selected ? prev.filter((id) => id !== cat.id) : [...prev, cat.id]
                            )
                          }
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            selected
                              ? "bg-[var(--primary)] text-white"
                              : "bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white"
                          }`}
                        >
                          {cat.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    No categories yet.{" "}
                    <a href="/admin/categories" className="text-[var(--primary)] hover:underline">
                      Create categories
                    </a>{" "}
                    first.
                  </p>
                )}
              </div>

              {/* Tenant multi-select */}
              <div>
                <label className="mb-1 block text-xs text-gray-400">Publish to Tenants</label>
                {tenants.length > 0 ? (
                  <div className="flex flex-wrap gap-2 rounded border border-[var(--border)] bg-[var(--secondary)] p-2">
                    {tenants.map((t) => {
                      const selected = editTenantIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() =>
                            setEditTenantIds((prev) =>
                              selected ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                            )
                          }
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            selected
                              ? "bg-blue-500 text-white"
                              : "bg-white/10 text-gray-400 hover:bg-white/20 hover:text-white"
                          }`}
                        >
                          {t.site_name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No tenants available.</p>
                )}
              </div>

              {/* Min Tier Level */}
              <div>
                <label className="mb-1 block text-xs text-gray-400">
                  Min Subscription Tier Level (0 = free)
                </label>
                <input
                  type="number"
                  min={0}
                  value={editMinTierLevel}
                  onChange={(e) => setEditMinTierLevel(Number(e.target.value))}
                  className="w-32 rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingVideo(null)}
                  className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Edit3 size={14} />}
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Video"
        message={`Delete "${confirmVideo?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => { setConfirmOpen(false); setConfirmVideo(null); }}
      />
    </div>
  );
}
