import { useState, useEffect } from "react";
import {
  Loader2,
  Plus,
  Radio,
  Copy,
  Check,
  Trash2,
  Eye,
  RotateCcw,
  Square,
  Users,
  X,
} from "lucide-react";
import { api } from "@/api/client";
import type { LiveStreamAdmin, LiveStreamCreated, Category } from "@/types/api";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    idle: "bg-gray-500/20 text-gray-400",
    live: "bg-red-500/20 text-red-400",
    ended: "bg-yellow-500/20 text-yellow-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || styles.idle}`}>
      {status === "live" && (
        <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
      )}
      {status}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button onClick={copy} className="text-gray-400 hover:text-white" title="Copy">
      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
    </button>
  );
}

export default function LivePage() {
  const [streams, setStreams] = useState<LiveStreamAdmin[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState<LiveStreamCreated | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isPpv, setIsPpv] = useState(false);
  const [ppvPrice, setPpvPrice] = useState("");
  const [ppvCurrency, setPpvCurrency] = useState("USD");
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmStreamId, setConfirmStreamId] = useState<string | null>(null);

  const load = () => {
    api
      .get<LiveStreamAdmin[]>("/admin/live/streams")
      .then(setStreams)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get<Category[]>("/admin/categories").then(setCategories).catch(() => {});
  }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
      };
      if (categoryId) body.category_id = categoryId;
      body.is_ppv = isPpv;
      if (isPpv && ppvPrice) {
        body.ppv_price = ppvPrice;
        body.ppv_currency = ppvCurrency;
      }
      const result = await api.post<LiveStreamCreated>("/admin/live/streams", body);
      setCreated(result);
      setShowCreate(false);
      setTitle("");
      setDescription("");
      setCategoryId("");
      setIsPpv(false);
      setPpvPrice("");
      setPpvCurrency("USD");
      load();
    } catch {
      // handled
    } finally {
      setCreating(false);
    }
  };

  const handleEnd = async (id: string) => {
    setActionLoading(id);
    try {
      await api.post(`/admin/live/streams/${id}/end`);
      load();
    } catch {
    } finally {
      setActionLoading(null);
    }
  };

  const handleReset = async (id: string) => {
    setActionLoading(id);
    try {
      await api.post(`/admin/live/streams/${id}/reset`);
      load();
    } catch {
    } finally {
      setActionLoading(null);
    }
  };

  const requestDelete = (id: string) => {
    setConfirmStreamId(id);
    setConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!confirmStreamId) return;
    setActionLoading(confirmStreamId);
    try {
      await api.delete(`/admin/live/streams/${confirmStreamId}`);
      load();
    } catch {
    } finally {
      setActionLoading(null);
      setConfirmOpen(false);
      setConfirmStreamId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Live Streams</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Create Stream Key
        </button>
      </div>

      {/* Stream key created modal */}
      {created && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-green-400">Stream Key Created</h2>
              <button onClick={() => setCreated(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <p className="mb-4 text-sm text-gray-400">
              Save this information — the stream key will not be shown in full again.
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500">Title</label>
                <p className="text-sm font-medium">{created.title}</p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">Stream Key</label>
                <div className="flex items-center gap-2 rounded bg-black/40 px-3 py-2">
                  <code className="flex-1 text-sm text-green-400">{created.stream_key}</code>
                  <CopyButton text={created.stream_key} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">RTMP URL</label>
                <div className="flex items-center gap-2 rounded bg-black/40 px-3 py-2">
                  <code className="flex-1 truncate text-sm text-blue-400">{created.rtmp_url}</code>
                  <CopyButton text={created.rtmp_url} />
                </div>
              </div>
            </div>

            <div className="mt-4 rounded bg-yellow-500/10 p-3 text-xs text-yellow-400">
              <strong>OBS Setup:</strong> Go to Settings → Stream → set Service to "Custom",
              Server to <code>rtmp://your-server:1935/live</code>, and Stream Key to the key above.
            </div>

            <button
              onClick={() => setCreated(null)}
              className="mt-4 w-full rounded bg-[var(--primary)] py-2 text-sm font-medium hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Create form modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">New Live Stream</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-gray-400">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Stream title"
                  className="w-full rounded bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">Description (optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this stream about?"
                  rows={3}
                  className="w-full rounded bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-400">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full rounded bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
                >
                  <option value="">No category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              {/* PPV Toggle */}
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={isPpv}
                    onChange={(e) => setIsPpv(e.target.checked)}
                    className="rounded border-gray-600"
                  />
                  Pay-Per-View (PPV)
                </label>
              </div>

              {isPpv && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-sm text-gray-400">PPV Price</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={ppvPrice}
                      onChange={(e) => setPpvPrice(e.target.value)}
                      placeholder="9.99"
                      className="w-full rounded bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    />
                  </div>
                  <div className="w-24">
                    <label className="mb-1 block text-sm text-gray-400">Currency</label>
                    <input
                      type="text"
                      value={ppvCurrency}
                      onChange={(e) => setPpvCurrency(e.target.value.toUpperCase())}
                      maxLength={3}
                      className="w-full rounded bg-black/40 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded border border-[var(--border)] py-2 text-sm hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!title.trim() || creating}
                className="flex flex-1 items-center justify-center gap-2 rounded bg-[var(--primary)] py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {creating && <Loader2 size={14} className="animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Streams table */}
      {streams.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-12 text-center">
          <Radio size={40} className="mx-auto mb-3 text-gray-600" />
          <p className="text-gray-500">No live streams configured yet.</p>
          <p className="mt-1 text-sm text-gray-600">Create a stream key to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {streams.map((stream) => (
            <div
              key={stream.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="truncate font-medium text-white">{stream.title}</h3>
                    <StatusBadge status={stream.status} />
                    {stream.category_name && (
                      <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-gray-300">
                        {stream.category_name}
                      </span>
                    )}
                    {stream.is_ppv && (
                      <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400">
                        PPV {stream.ppv_price ? `${stream.ppv_currency} ${stream.ppv_price}` : ""}
                      </span>
                    )}
                  </div>
                  {stream.description && (
                    <p className="mt-1 text-sm text-gray-400">{stream.description}</p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-600">Key:</span>
                      <code className="rounded bg-black/30 px-1.5 py-0.5 text-gray-400">
                        {stream.stream_key.slice(0, 12)}...
                      </code>
                      <CopyButton text={stream.stream_key} />
                    </div>

                    {stream.status === "live" && (
                      <div className="flex items-center gap-1 text-green-400">
                        <Users size={12} />
                        {stream.viewer_count} viewers
                        {stream.peak_viewers > 0 && (
                          <span className="text-gray-500">(peak: {stream.peak_viewers})</span>
                        )}
                      </div>
                    )}

                    {stream.started_at && (
                      <span>
                        Started: {new Date(stream.started_at).toLocaleString()}
                      </span>
                    )}

                    {stream.ended_at && (
                      <span>
                        Ended: {new Date(stream.ended_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="ml-4 flex items-center gap-2">
                  {stream.status === "live" && (
                    <>
                      <a
                        href={`/live/${stream.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-[var(--border)] p-2 text-gray-400 hover:bg-white/5 hover:text-white"
                        title="Watch stream"
                      >
                        <Eye size={14} />
                      </a>
                      <button
                        onClick={() => handleEnd(stream.id)}
                        disabled={actionLoading === stream.id}
                        className="rounded border border-red-500/30 p-2 text-red-400 hover:bg-red-500/10"
                        title="End stream"
                      >
                        {actionLoading === stream.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Square size={14} />
                        )}
                      </button>
                    </>
                  )}

                  {stream.status === "ended" && (
                    <button
                      onClick={() => handleReset(stream.id)}
                      disabled={actionLoading === stream.id}
                      className="rounded border border-[var(--border)] p-2 text-gray-400 hover:bg-white/5 hover:text-white"
                      title="Reset to idle"
                    >
                      {actionLoading === stream.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RotateCcw size={14} />
                      )}
                    </button>
                  )}

                  <button
                    onClick={() => requestDelete(stream.id)}
                    disabled={actionLoading === stream.id}
                    className="rounded border border-[var(--border)] p-2 text-gray-400 hover:bg-red-500/10 hover:text-red-400"
                    title="Delete stream"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Stream Key"
        message="Delete this stream key? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => { setConfirmOpen(false); setConfirmStreamId(null); }}
      />
    </div>
  );
}
