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
  ScanSearch,
} from "lucide-react";
import { api } from "@/api/client";
import type { Video, Category, PaginatedResponse, AdminTenant } from "@/types/api";
import { formatDuration, formatBytes } from "@/lib/utils";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

type VideoStatus = Video["status"];

import { API_URL } from "@/lib/constants";

const STATUS_CONFIG: Record<VideoStatus, { label: string; color: string; icon: React.ReactNode }> = {
  uploading: { label: "Uploading", color: "text-blue-400", icon: <Loader2 size={14} className="animate-spin" /> },
  processing: { label: "Processing", color: "text-yellow-400", icon: <Clock size={14} /> },
  ready: { label: "Ready", color: "text-green-400", icon: <CheckCircle2 size={14} /> },
  failed: { label: "Failed", color: "text-red-400", icon: <AlertCircle size={14} /> },
  deleted: { label: "Deleted", color: "text-gray-500", icon: <Trash2 size={14} /> },
};

function TranscodeProgress({
  videoId,
  onComplete,
  onStageChange,
}: {
  videoId: string;
  onComplete: () => void;
  onStageChange?: (stage: string) => void;
}) {
  const [progress, setProgress] = useState<{ percent: number; stage: string }>({ percent: 0, stage: "queued" });

  // Use refs so callbacks never appear in effect deps — prevents SSE reconnect on every progress update
  const onCompleteRef = useRef(onComplete);
  const onStageChangeRef = useRef(onStageChange);
  onCompleteRef.current = onComplete;
  onStageChangeRef.current = onStageChange;

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const url = `${API_URL}/admin/transcode/${videoId}/status`;
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    async function connectSSE() {
      try {
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok || !response.body) return;

        reader = response.body.getReader();
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
                onStageChangeRef.current?.(data.stage);
                if (data.percent >= 100 || data.stage === "failed") {
                  cancelled = true;
                  onCompleteRef.current();
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

    connectSSE();

    return () => {
      cancelled = true;
      reader?.cancel().catch(() => {});
    };
  }, [videoId]); // only reconnect when videoId changes, not on every callback update

  const stageLabels: Record<string, string> = {
    queued: "Queued",
    starting: "Starting",
    downloading: "Preparing",
    probing: "Analyzing",
    transcoding: "Transcoding",
    uploading: "Saving files",
    thumbnails: "Thumbnails",
    embedding: "Embedding",
    enriching: "Enriching",
    scene_analysis: "Preview scan",
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

function SceneAnalysisProgress({ videoId, onComplete }: { videoId: string; onComplete: () => void }) {
  const [progress, setProgress] = useState<{ percent: number; stage: string }>({ percent: 0, stage: "queued" });

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const url = `${API_URL}/admin/transcode/analyze/${videoId}/status`;
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    async function connectSSE() {
      try {
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok || !response.body) return;

        reader = response.body.getReader();
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
                  onCompleteRef.current();
                  return;
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      } catch { /* connection lost */ }
    }

    connectSSE();
    return () => {
      cancelled = true;
      reader?.cancel().catch(() => {});
    };
  }, [videoId]); // only reconnect when videoId changes

  const stageLabels: Record<string, string> = {
    queued: "Queued",
    detecting: "Detecting scenes",
    extracting: "Extracting frames",
    asking_ai: "AI analysis",
    finalizing: "Finalizing",
    completed: "Complete",
    failed: "Failed",
  };

  const percent = Math.max(0, progress.percent);
  const label = stageLabels[progress.stage] || progress.stage;

  return (
    <div className="w-32">
      <div className="mb-0.5 flex justify-between text-[10px] text-purple-400">
        <span>{label}</span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-purple-400 transition-all duration-500"
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

  // Categories, Tenants & Subscription Tiers
  const [categories, setCategories] = useState<Category[]>([]);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [subscriptionTiers, setSubscriptionTiers] = useState<{ id: string; name: string; tier_level: number; slug: string; tenant_id: string }[]>([]);

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

  // Unified action confirm dialog
  type ActionType = "delete" | "retranscode" | "analyze";
  const [pendingAction, setPendingAction] = useState<{ video: Video; action: ActionType } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Track active transcode stages (videoId → stage from SSE) and active analyses
  const [transcodeStages, setTranscodeStages] = useState<Record<string, string>>({});
  const [activeAnalyzeIds, setActiveAnalyzeIds] = useState<Set<string>>(new Set());

  // Inline notification toast
  const [notification, setNotification] = useState<{ msg: string; ok: boolean } | null>(null);
  const notifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tracks the preview_start_time at the time analysis was triggered (to detect completion)
  const analyzeSnapshotRef = useRef<Record<string, number | null>>({});
  const pageSize = 20;

  const fetchVideos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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
      // Clear analyze-in-progress for any video whose preview_start_time changed since we started watching
      setActiveAnalyzeIds((analyzing) => {
        if (analyzing.size === 0) return analyzing;
        const snapshot = analyzeSnapshotRef.current;
        const updated = new Set(analyzing);
        for (const v of data.items) {
          if (updated.has(v.id) && v.preview_start_time !== snapshot[v.id]) {
            updated.delete(v.id);
            delete snapshot[v.id];
          }
        }
        return updated.size === analyzing.size ? analyzing : updated;
      });
    } catch {
      setVideos([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // Fetch categories, tenants and subscription tiers for dropdowns
  useEffect(() => {
    api.get<Category[]>("/admin/categories").then(setCategories).catch(() => {});
    api.get<{ items: AdminTenant[] }>("/admin/tenants").then((d) => setTenants(d.items)).catch(() => {});
    api.get<{ items: { id: string; name: string; tier_level: number; slug: string; tenant_id: string }[] }>("/admin/subscriptions/tiers").then((d) => setSubscriptionTiers(d.items)).catch(() => {});
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

  const showNotification = (msg: string, ok: boolean) => {
    if (notifyTimer.current) clearTimeout(notifyTimer.current);
    setNotification({ msg, ok });
    notifyTimer.current = setTimeout(() => setNotification(null), 3500);
  };

  const handleFeatureToggle = async (video: Video) => {
    // Optimistic update for instant visual feedback
    setVideos((prev) => prev.map((v) => v.id === video.id ? { ...v, is_featured: !v.is_featured } : v));
    try {
      await api.post(`/admin/videos/${video.id}/feature`);
      showNotification(
        video.is_featured ? `"${video.title}" unfeatured.` : `"${video.title}" featured.`,
        true,
      );
      fetchVideos();
    } catch (err) {
      // Revert optimistic update on failure
      setVideos((prev) => prev.map((v) => v.id === video.id ? { ...v, is_featured: video.is_featured } : v));
      if (err instanceof Error && err.name === "AbortError") return;
      const detail = err instanceof Error ? err.message : String(err);
      showNotification(detail || `Failed to update "${video.title}".`, false);
    }
  };

  const requestAction = (video: Video, action: "delete" | "retranscode" | "analyze") => {
    setPendingAction({ video, action });
  };

  const ACTION_META: Record<ActionType, {
    title: string;
    message: (v: Video) => string;
    confirmLabel: string;
    variant: "danger" | "default";
  }> = {
    delete: {
      title: "Delete Video",
      message: (v) => `Delete "${v.title}"? This permanently removes the video and all transcoded files. This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "danger",
    },
    retranscode: {
      title: "Retranscode Video",
      message: (v) => `Re-transcode "${v.title}" to HLS? The existing transcoded files will be replaced.`,
      confirmLabel: "Retranscode",
      variant: "default",
    },
    analyze: {
      title: "Analyze Preview Scene",
      message: (v) => `Run AI scene analysis on "${v.title}" to pick the best preview timestamp? This runs in the background.`,
      confirmLabel: "Analyze",
      variant: "default",
    },
  };

  const executeAction = async () => {
    if (!pendingAction) return;
    const { video, action } = pendingAction;

    if (action === "retranscode") {
      setPendingAction(null);
      showNotification(`Retranscode queued for "${video.title}".`, true);
      api.post(`/admin/videos/${video.id}/retranscode`).then(() => fetchVideos()).catch(() => {});
      return;
    }

    if (action === "analyze") {
      setPendingAction(null);
      showNotification(`Scene analysis started for "${video.title}".`, true);
      analyzeSnapshotRef.current[video.id] = video.preview_start_time ?? null;
      setActiveAnalyzeIds((prev) => new Set([...prev, video.id]));
      api.post(`/admin/videos/${video.id}/analyze-preview`).catch(() => {});
      return;
    }

    // delete — await so errors can be shown
    setActionLoading(true);
    try {
      await api.delete(`/admin/videos/${video.id}`);
      showNotification(`"${video.title}" deleted.`, true);
      fetchVideos();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      showNotification(detail || `Failed to delete "${video.title}".`, false);
    } finally {
      setActionLoading(false);
      setPendingAction(null);
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
                <th className="px-4 py-3">Tenants</th>
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
                        <TranscodeProgress
                          videoId={v.id}
                          onComplete={() => fetchVideos(true)}
                          onStageChange={(stage) =>
                            setTranscodeStages((prev) => ({ ...prev, [v.id]: stage }))
                          }
                        />
                      ) : activeAnalyzeIds.has(v.id) ? (
                        <SceneAnalysisProgress
                          videoId={v.id}
                          onComplete={() => {
                            setActiveAnalyzeIds((prev) => {
                              const next = new Set(prev);
                              next.delete(v.id);
                              return next;
                            });
                            fetchVideos(true);
                          }}
                        />
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
                    <td className="px-4 py-3">
                      {v.tenant_ids && v.tenant_ids.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {v.tenant_ids.map((tid) => {
                            const tenant = tenants.find((t) => t.id === tid);
                            return tenant ? (
                              <span key={tid} className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[11px] font-medium text-blue-300">
                                {tenant.site_name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{formatBytes(v.file_size || 0)}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDuration(v.duration)}</td>
                    <td className="px-4 py-3 text-gray-400">{v.view_count.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {v.status !== "deleted" && (() => {
                          const activeStage = transcodeStages[v.id];
                          const transcoding = v.status === "processing" && !!activeStage && activeStage !== "queued" && activeStage !== "completed" && activeStage !== "failed";
                          return (
                            <button
                              onClick={() => !transcoding && requestAction(v, "retranscode")}
                              disabled={transcoding}
                              className={`rounded p-1.5 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${v.status === "failed" ? "text-red-400 hover:text-red-300" : v.status === "processing" ? "text-yellow-400 hover:text-yellow-300" : "text-gray-400 hover:text-blue-400"}`}
                              title={transcoding ? "Transcoding in progress…" : v.status === "failed" ? "Retry Transcode" : v.status === "processing" ? "Force Retranscode" : "Transcode to HLS"}
                            >
                              <RefreshCw size={16} />
                            </button>
                          );
                        })()}
                        {v.source_path && (() => {
                          const analyzing = activeAnalyzeIds.has(v.id);
                          return (
                            <button
                              onClick={() => !analyzing && requestAction(v, "analyze")}
                              disabled={analyzing}
                              className={`rounded p-1.5 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 hover:text-purple-400 ${v.preview_start_time != null ? "text-purple-400" : "text-gray-400"}`}
                              title={analyzing ? "Scene analysis in progress…" : v.preview_start_time != null ? `Re-analyze preview (current: ${v.preview_start_time}s)` : "Analyze preview scene (AI)"}
                            >
                              <ScanSearch size={16} />
                            </button>
                          );
                        })()}
                        <button
                          onClick={() => handleFeatureToggle(v)}
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
                          onClick={() => requestAction(v, "delete")}
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

              {/* Min Subscription Tier */}
              <div>
                <label className="mb-1 block text-xs text-gray-400">Min Subscription Tier</label>
                {(() => {
                  const relevantTiers = [...subscriptionTiers]
                    .filter((t) => uploadTenantIds.length === 0 || uploadTenantIds.includes(t.tenant_id))
                    .sort((a, b) => a.tier_level - b.tier_level);
                  return (
                    <>
                      <select
                        value={uploadMinTierLevel}
                        onChange={(e) => setUploadMinTierLevel(Number(e.target.value))}
                        className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                      >
                        <option value={0}>Free (all users)</option>
                        {relevantTiers.map((tier) => {
                          const tenant = tenants.find((t) => t.id === tier.tenant_id);
                          return (
                            <option key={tier.id} value={tier.tier_level}>
                              {tier.name} (Level {tier.tier_level}){tenant ? ` — ${tenant.site_name}` : ""}
                            </option>
                          );
                        })}
                      </select>
                      {uploadTenantIds.length === 0 && subscriptionTiers.length > 0 && (
                        <p className="mt-1 text-[11px] text-gray-500">Select tenants above to filter available tiers.</p>
                      )}
                    </>
                  );
                })()}
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

              {/* Min Subscription Tier */}
              <div>
                <label className="mb-1 block text-xs text-gray-400">Min Subscription Tier</label>
                {(() => {
                  const relevantTiers = [...subscriptionTiers]
                    .filter((t) => editTenantIds.length === 0 || editTenantIds.includes(t.tenant_id))
                    .sort((a, b) => a.tier_level - b.tier_level);
                  return (
                    <>
                      <select
                        value={editMinTierLevel}
                        onChange={(e) => setEditMinTierLevel(Number(e.target.value))}
                        className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                      >
                        <option value={0}>Free (all users)</option>
                        {relevantTiers.map((tier) => {
                          const tenant = tenants.find((t) => t.id === tier.tenant_id);
                          return (
                            <option key={tier.id} value={tier.tier_level}>
                              {tier.name} (Level {tier.tier_level}){tenant ? ` — ${tenant.site_name}` : ""}
                            </option>
                          );
                        })}
                      </select>
                      {editTenantIds.length === 0 && subscriptionTiers.length > 0 && (
                        <p className="mt-1 text-[11px] text-gray-500">Select tenants above to filter available tiers.</p>
                      )}
                    </>
                  );
                })()}
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

      {/* ── Notification toast ── */}
      {notification && (
        <div
          className={`fixed bottom-6 right-6 z-[300] flex items-center gap-2 rounded-lg border px-4 py-3 text-sm shadow-xl transition-all ${
            notification.ok
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}
        >
          {notification.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {notification.msg}
        </div>
      )}

      {/* ── Unified confirm dialog ── */}
      {pendingAction && (() => {
        const { video, action } = pendingAction;
        const meta = ACTION_META[action];
        return (
          <ConfirmDialog
            open
            title={meta.title}
            message={meta.message(video)}
            confirmLabel={actionLoading ? "Working…" : meta.confirmLabel}
            variant={meta.variant}
            onConfirm={executeAction}
            onCancel={() => setPendingAction(null)}
          />
        );
      })()}
    </div>
  );
}
