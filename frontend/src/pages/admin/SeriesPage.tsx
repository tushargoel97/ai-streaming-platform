import { useState, useEffect, useCallback } from "react";
import { Search, Trash2, Edit3, Plus, X, Loader2, Tv, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/api/client";
import type { Series, Season, PaginatedResponse } from "@/types/api";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface SeriesDetail extends Series {
  seasons?: Season[];
}

export default function SeriesPage() {
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Expanded series (show seasons inline)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<SeriesDetail | null>(null);

  // Create/Edit series modal
  const [showModal, setShowModal] = useState(false);
  const [editingSeries, setEditingSeries] = useState<Series | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPosterUrl, setFormPosterUrl] = useState("");
  const [formBannerUrl, setFormBannerUrl] = useState("");
  const [formClassification, setFormClassification] = useState("safe");
  const [formStatus, setFormStatus] = useState("ongoing");
  const [formYearStarted, setFormYearStarted] = useState("");
  const [formTags, setFormTags] = useState("");
  const [saving, setSaving] = useState(false);

  // Add season modal
  const [showSeasonModal, setShowSeasonModal] = useState(false);
  const [seasonSeriesId, setSeasonSeriesId] = useState<string>("");
  const [seasonNumber, setSeasonNumber] = useState("");
  const [seasonTitle, setSeasonTitle] = useState("");
  const [seasonDesc, setSeasonDesc] = useState("");
  const [savingSeason, setSavingSeason] = useState(false);

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);

  const pageSize = 20;

  const fetchSeries = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        page_size: String(pageSize),
      };
      if (search) params.search = search;
      const data = await api.get<PaginatedResponse<Series>>("/admin/series", params);
      setSeriesList(data.items);
      setTotal(data.total);
    } catch {
      setSeriesList([]);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchSeries();
  }, [fetchSeries]);

  const toggleExpand = async (seriesId: string) => {
    if (expandedId === seriesId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    try {
      const detail = await api.get<SeriesDetail>(`/admin/series/${seriesId}`);
      setExpandedDetail(detail);
      setExpandedId(seriesId);
    } catch {
      // silent
    }
  };

  const openCreate = () => {
    setEditingSeries(null);
    setFormTitle("");
    setFormDesc("");
    setFormPosterUrl("");
    setFormBannerUrl("");
    setFormClassification("safe");
    setFormStatus("ongoing");
    setFormYearStarted("");
    setFormTags("");
    setShowModal(true);
  };

  const openEdit = (s: Series) => {
    setEditingSeries(s);
    setFormTitle(s.title);
    setFormDesc(s.description);
    setFormPosterUrl(s.poster_url);
    setFormBannerUrl(s.banner_url);
    setFormClassification(s.content_classification);
    setFormStatus(s.status);
    setFormYearStarted(s.year_started?.toString() || "");
    setFormTags(s.tags.join(", "));
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        title: formTitle,
        description: formDesc,
        poster_url: formPosterUrl,
        banner_url: formBannerUrl,
        content_classification: formClassification,
        status: formStatus,
        tags: formTags.split(",").map((t) => t.trim()).filter(Boolean),
      };
      if (formYearStarted) body.year_started = parseInt(formYearStarted);

      if (editingSeries) {
        await api.patch(`/admin/series/${editingSeries.id}`, body);
      } else {
        await api.post("/admin/series", body);
      }
      setShowModal(false);
      fetchSeries();
    } catch {
      // keep modal open
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteSeries = (s: Series) => {
    setConfirmMessage(`Delete "${s.title}"? This will delete all seasons too.`);
    setConfirmAction(() => async () => {
      try {
        await api.delete(`/admin/series/${s.id}`);
        if (expandedId === s.id) {
          setExpandedId(null);
          setExpandedDetail(null);
        }
        fetchSeries();
      } catch {
        // silent
      }
    });
    setConfirmOpen(true);
  };

  // Season handlers
  const openAddSeason = (seriesId: string) => {
    setSeasonSeriesId(seriesId);
    setSeasonNumber("");
    setSeasonTitle("");
    setSeasonDesc("");
    setShowSeasonModal(true);
  };

  const handleAddSeason = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSeason(true);
    try {
      await api.post(`/admin/series/${seasonSeriesId}/seasons`, {
        season_number: parseInt(seasonNumber),
        title: seasonTitle,
        description: seasonDesc,
      });
      setShowSeasonModal(false);
      // Refresh expanded detail
      if (expandedId === seasonSeriesId) {
        const detail = await api.get<SeriesDetail>(`/admin/series/${seasonSeriesId}`);
        setExpandedDetail(detail);
      }
    } catch {
      // keep modal open
    } finally {
      setSavingSeason(false);
    }
  };

  const requestDeleteSeason = (seriesId: string, seasonId: string) => {
    setConfirmMessage("Delete this season? This cannot be undone.");
    setConfirmAction(() => async () => {
      try {
        await api.delete(`/admin/series/${seriesId}/seasons/${seasonId}`);
        if (expandedId === seriesId) {
          const detail = await api.get<SeriesDetail>(`/admin/series/${seriesId}`);
          setExpandedDetail(detail);
        }
      } catch {
        // silent
      }
    });
    setConfirmOpen(true);
  };

  const totalPages = Math.ceil(total / pageSize);
  const statusColors: Record<string, string> = {
    ongoing: "bg-blue-500/20 text-blue-400",
    completed: "bg-green-500/20 text-green-400",
    cancelled: "bg-gray-500/20 text-gray-400",
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Series</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Add Series
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search series..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {/* List */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : seriesList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Tv size={40} className="mb-3 opacity-50" />
            <p>No series found. Create your first series to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {seriesList.map((s) => (
              <div key={s.id}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/5">
                  <button
                    onClick={() => toggleExpand(s.id)}
                    className="text-gray-400 hover:text-white"
                  >
                    {expandedId === s.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{s.title}</span>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusColors[s.status] || ""}`}>
                        {s.status}
                      </span>
                      {s.year_started && (
                        <span className="text-xs text-gray-500">({s.year_started})</span>
                      )}
                    </div>
                    {s.description && (
                      <p className="mt-0.5 max-w-[500px] truncate text-sm text-gray-400">{s.description}</p>
                    )}
                  </div>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                    s.content_classification === "explicit"
                      ? "bg-red-500/20 text-red-400"
                      : s.content_classification === "mature"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : "bg-green-500/20 text-green-400"
                  }`}>
                    {s.content_classification}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openAddSeason(s.id)}
                      className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                      title="Add Season"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      onClick={() => openEdit(s)}
                      className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                      title="Edit"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      onClick={() => requestDeleteSeries(s)}
                      className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Expanded seasons */}
                {expandedId === s.id && expandedDetail?.seasons && (
                  <div className="border-t border-[var(--border)] bg-white/[0.02] px-4 py-3 pl-12">
                    {expandedDetail.seasons.length === 0 ? (
                      <p className="text-sm text-gray-500">No seasons yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {expandedDetail.seasons
                          .sort((a, b) => a.season_number - b.season_number)
                          .map((season) => (
                            <div
                              key={season.id}
                              className="flex items-center justify-between rounded bg-white/5 px-3 py-2"
                            >
                              <div>
                                <span className="text-sm font-medium text-white">
                                  Season {season.season_number}
                                </span>
                                {season.title && (
                                  <span className="ml-2 text-sm text-gray-400">— {season.title}</span>
                                )}
                              </div>
                              <button
                                onClick={() => requestDeleteSeason(s.id, season.id)}
                                className="rounded p-1 text-gray-500 hover:text-red-400"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
            <span className="text-sm text-gray-400">
              {total} series total
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

      {/* ===== Create/Edit Series Modal ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {editingSeries ? "Edit Series" : "Create Series"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Title</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Description</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Poster URL</label>
                  <input
                    type="text"
                    value={formPosterUrl}
                    onChange={(e) => setFormPosterUrl(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Banner URL</label>
                  <input
                    type="text"
                    value={formBannerUrl}
                    onChange={(e) => setFormBannerUrl(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Classification</label>
                  <select
                    value={formClassification}
                    onChange={(e) => setFormClassification(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="safe">Safe</option>
                    <option value="mature">Mature</option>
                    <option value="explicit">Explicit</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Status</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Year Started</label>
                  <input
                    type="number"
                    value={formYearStarted}
                    onChange={(e) => setFormYearStarted(e.target.value)}
                    placeholder="2024"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Tags (comma-separated)</label>
                  <input
                    type="text"
                    value={formTags}
                    onChange={(e) => setFormTags(e.target.value)}
                    placeholder="anime, action"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : editingSeries ? <Edit3 size={14} /> : <Plus size={14} />}
                  {saving ? "Saving..." : editingSeries ? "Save Changes" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== Add Season Modal ===== */}
      {showSeasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Add Season</h2>
              <button onClick={() => setShowSeasonModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddSeason} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Season Number</label>
                <input
                  type="number"
                  value={seasonNumber}
                  onChange={(e) => setSeasonNumber(e.target.value)}
                  min="1"
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Title (optional)</label>
                <input
                  type="text"
                  value={seasonTitle}
                  onChange={(e) => setSeasonTitle(e.target.value)}
                  placeholder='e.g. "Shippuden"'
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Description</label>
                <textarea
                  value={seasonDesc}
                  onChange={(e) => setSeasonDesc(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSeasonModal(false)}
                  className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSeason}
                  className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {savingSeason ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {savingSeason ? "Adding..." : "Add Season"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete"
        message={confirmMessage}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (confirmAction) await confirmAction();
          setConfirmOpen(false);
          setConfirmAction(null);
        }}
        onCancel={() => { setConfirmOpen(false); setConfirmAction(null); }}
      />
    </div>
  );
}
