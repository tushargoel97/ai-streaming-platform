import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, X, Loader2, Edit3, Trash2, Calendar, Link2, Video, Radio } from "lucide-react";
import { api } from "@/api/client";
import type { SportEvent, Competition, PaginatedResponse, LiveStreamAdmin, Video as VideoType } from "@/types/api";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

const EVENT_TYPES = ["match", "race", "grand_prix", "bout", "round", "qualifier", "practice", "ceremony"] as const;
const EVENT_STATUSES = ["scheduled", "live", "completed", "cancelled", "postponed"] as const;
const HIGHLIGHT_TYPES = ["goal", "save", "red_card", "penalty", "overtake", "crash", "podium", "knockout", "other"] as const;

export default function EventsPage() {
  const [searchParams] = useSearchParams();
  const presetCompetitionId = searchParams.get("competition_id") || "";

  const [items, setItems] = useState<SportEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [competitionFilter, setCompetitionFilter] = useState(presetCompetitionId);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [competitions, setCompetitions] = useState<Competition[]>([]);

  // Event modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SportEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form fields
  const [formCompetitionId, setFormCompetitionId] = useState(presetCompetitionId);
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formEventType, setFormEventType] = useState("match");
  const [formRoundLabel, setFormRoundLabel] = useState("");
  const [formParticipant1, setFormParticipant1] = useState("");
  const [formParticipant2, setFormParticipant2] = useState("");
  const [formVenue, setFormVenue] = useState("");
  const [formScheduledAt, setFormScheduledAt] = useState("");
  const [formStatus, setFormStatus] = useState("scheduled");
  const [formScore1, setFormScore1] = useState("");
  const [formScore2, setFormScore2] = useState("");

  // Link modals
  const [linkStreamOpen, setLinkStreamOpen] = useState(false);
  const [linkReplayOpen, setLinkReplayOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<SportEvent | null>(null);
  const [streams, setStreams] = useState<LiveStreamAdmin[]>([]);
  const [videos, setVideos] = useState<VideoType[]>([]);
  const [linkSaving, setLinkSaving] = useState(false);

  // Highlight modal
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [highlightTarget, setHighlightTarget] = useState<SportEvent | null>(null);
  const [hlTitle, setHlTitle] = useState("");
  const [hlVideoId, setHlVideoId] = useState("");
  const [hlType, setHlType] = useState("other");
  const [hlTimestamp, setHlTimestamp] = useState("");
  const [hlSaving, setHlSaving] = useState(false);

  // Confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SportEvent | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), page_size: String(pageSize) };
      if (competitionFilter) params.competition_id = competitionFilter;
      if (statusFilter) params.status = statusFilter;
      const data = await api.get<PaginatedResponse<SportEvent>>("/admin/events", params);
      setItems(data.items);
      setTotal(data.total);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [competitionFilter, statusFilter, page]);

  const fetchCompetitions = useCallback(async () => {
    try {
      const data = await api.get<PaginatedResponse<Competition>>("/admin/competitions", { page_size: "100" });
      setCompetitions(data.items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchCompetitions(); }, [fetchCompetitions]);
  useEffect(() => { setPage(1); }, [competitionFilter, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setFormCompetitionId(competitionFilter || "");
    setFormTitle(""); setFormDescription("");
    setFormEventType("match"); setFormRoundLabel("");
    setFormParticipant1(""); setFormParticipant2("");
    setFormVenue(""); setFormScheduledAt("");
    setFormStatus("scheduled"); setFormScore1(""); setFormScore2("");
    setError(""); setShowModal(true);
  };

  const openEdit = (e: SportEvent) => {
    setEditing(e);
    setFormCompetitionId(e.competition_id);
    setFormTitle(e.title); setFormDescription(e.description);
    setFormEventType(e.event_type); setFormRoundLabel(e.round_label);
    setFormParticipant1(e.participant_1); setFormParticipant2(e.participant_2);
    setFormVenue(e.venue);
    setFormScheduledAt(e.scheduled_at ? e.scheduled_at.slice(0, 16) : "");
    setFormStatus(e.status);
    setFormScore1(e.score_1 != null ? String(e.score_1) : "");
    setFormScore2(e.score_2 != null ? String(e.score_2) : "");
    setError(""); setShowModal(true);
  };

  const handleSave = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true); setError("");
    try {
      const body: Record<string, unknown> = {
        title: formTitle,
        description: formDescription,
        event_type: formEventType,
        round_label: formRoundLabel,
        participant_1: formParticipant1,
        participant_2: formParticipant2,
        venue: formVenue,
        scheduled_at: formScheduledAt,
        status: formStatus,
        score_1: formScore1 ? parseInt(formScore1) : null,
        score_2: formScore2 ? parseInt(formScore2) : null,
      };
      if (!editing) body.competition_id = formCompetitionId;
      if (editing) {
        await api.patch(`/admin/events/${editing.id}`, body);
      } else {
        await api.post("/admin/events", body);
      }
      setShowModal(false);
      fetchItems();
    } catch (err: unknown) {
      if (err && typeof err === "object" && "body" in err) {
        try { setError(JSON.parse((err as { body: string }).body).detail || "Failed to save"); }
        catch { setError("Failed to save"); }
      } else { setError("Failed to save"); }
    } finally { setSaving(false); }
  };

  const requestDelete = (e: SportEvent) => {
    setDeleteTarget(e);
    setConfirmAction(() => async () => { await api.delete(`/admin/events/${e.id}`); fetchItems(); });
    setConfirmOpen(true);
  };

  // Link stream
  const openLinkStream = async (e: SportEvent) => {
    setLinkTarget(e);
    try {
      const data = await api.get<PaginatedResponse<LiveStreamAdmin>>("/admin/live/streams", { page_size: "50" });
      setStreams(data.items);
    } catch { setStreams([]); }
    setLinkStreamOpen(true);
  };

  const doLinkStream = async (streamId: string) => {
    if (!linkTarget) return;
    setLinkSaving(true);
    try {
      await api.post(`/admin/events/${linkTarget.id}/link-stream`, { live_stream_id: streamId });
      setLinkStreamOpen(false);
      fetchItems();
    } catch { /* ignore */ } finally { setLinkSaving(false); }
  };

  // Link replay
  const openLinkReplay = async (e: SportEvent) => {
    setLinkTarget(e);
    try {
      const data = await api.get<PaginatedResponse<VideoType>>("/admin/videos", { page_size: "50", status: "ready" });
      setVideos(data.items);
    } catch { setVideos([]); }
    setLinkReplayOpen(true);
  };

  const doLinkReplay = async (videoId: string) => {
    if (!linkTarget) return;
    setLinkSaving(true);
    try {
      await api.post(`/admin/events/${linkTarget.id}/link-replay`, { video_id: videoId });
      setLinkReplayOpen(false);
      fetchItems();
    } catch { /* ignore */ } finally { setLinkSaving(false); }
  };

  // Add highlight
  const openAddHighlight = async (e: SportEvent) => {
    setHighlightTarget(e);
    setHlTitle(""); setHlVideoId(""); setHlType("other"); setHlTimestamp("");
    try {
      const data = await api.get<PaginatedResponse<VideoType>>("/admin/videos", { page_size: "50", status: "ready" });
      setVideos(data.items);
    } catch { setVideos([]); }
    setHighlightOpen(true);
  };

  const doAddHighlight = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!highlightTarget) return;
    setHlSaving(true);
    try {
      await api.post(`/admin/events/${highlightTarget.id}/highlights`, {
        video_id: hlVideoId,
        title: hlTitle,
        highlight_type: hlType,
        timestamp_in_event: hlTimestamp ? parseInt(hlTimestamp) : null,
      });
      setHighlightOpen(false);
      fetchItems();
    } catch { /* ignore */ } finally { setHlSaving(false); }
  };

  const statusBadge = (s: string) => {
    const m: Record<string, string> = {
      scheduled: "bg-blue-500/20 text-blue-400",
      live: "bg-red-500/20 text-red-400",
      completed: "bg-green-500/20 text-green-400",
      cancelled: "bg-gray-500/20 text-gray-500 line-through",
      postponed: "bg-yellow-500/20 text-yellow-400",
    };
    return m[s] || m.scheduled;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  const totalPages = Math.ceil(total / pageSize);
  const currentCompName = competitions.find((c) => c.id === competitionFilter)?.name;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Event Schedule</h1>
          {currentCompName && <p className="text-sm text-gray-400 mt-1">{currentCompName}</p>}
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90">
          <Plus size={16} /> Add Event
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <select value={competitionFilter} onChange={(e) => setCompetitionFilter(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
          <option value="">All Competitions</option>
          {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
          <option value="">All Statuses</option>
          {EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Calendar size={40} className="mb-3 opacity-50" />
            <p>No events found. Add an event to the schedule.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Date / Time</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Round</th>
                <th className="px-4 py-3">Venue</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Links</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((e) => (
                <tr key={e.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{formatDate(e.scheduled_at)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{e.title}</p>
                    {e.participant_1 && e.participant_2 && (
                      <p className="text-xs text-gray-500">{e.participant_1} vs {e.participant_2}</p>
                    )}
                    {!competitionFilter && <p className="text-xs text-gray-600">{e.competition_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{e.round_label || "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{e.venue || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(e.status)}`}>
                      {e.status === "live" ? "● LIVE" : e.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-sm">
                    {e.score_1 != null && e.score_2 != null ? `${e.score_1} - ${e.score_2}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {e.live_stream_id && <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">Stream</span>}
                      {e.replay_video_id && <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-400">Replay</span>}
                      {e.highlight_count > 0 && <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">{e.highlight_count} clips</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openLinkStream(e)} className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400" title="Link Live Stream">
                        <Radio size={14} />
                      </button>
                      <button onClick={() => openLinkReplay(e)} className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-blue-400" title="Link Replay">
                        <Video size={14} />
                      </button>
                      <button onClick={() => openAddHighlight(e)} className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-yellow-400" title="Add Highlight">
                        <Link2 size={14} />
                      </button>
                      <button onClick={() => openEdit(e)} className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white" title="Edit">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => requestDelete(e)} className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
          <span>{total} events total</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded border border-[var(--border)] px-3 py-1 hover:bg-white/10 disabled:opacity-30">Prev</button>
            <span className="flex items-center px-2">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded border border-[var(--border)] px-3 py-1 hover:bg-white/10 disabled:opacity-30">Next</button>
          </div>
        </div>
      )}

      {/* ===== Create/Edit Event Modal ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editing ? "Edit Event" : "Create Event"}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
            <form onSubmit={handleSave} className="space-y-4">
              {!editing && (
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Competition</label>
                  <select value={formCompetitionId} onChange={(e) => setFormCompetitionId(e.target.value)} required
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
                    <option value="">Select competition</option>
                    {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs text-gray-400">Title</label>
                <input type="text" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Japan Grand Prix" required
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Type</label>
                  <select value={formEventType} onChange={(e) => setFormEventType(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
                    {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Round / Stage</label>
                  <input type="text" value={formRoundLabel} onChange={(e) => setFormRoundLabel(e.target.value)} placeholder="Quarter-Final"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Status</label>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
                    {EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Participant 1</label>
                  <input type="text" value={formParticipant1} onChange={(e) => setFormParticipant1(e.target.value)} placeholder="Real Madrid / Verstappen"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Participant 2</label>
                  <input type="text" value={formParticipant2} onChange={(e) => setFormParticipant2(e.target.value)} placeholder="Bayern Munich / Hamilton"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Venue</label>
                  <input type="text" value={formVenue} onChange={(e) => setFormVenue(e.target.value)} placeholder="Wembley Stadium"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Scheduled At</label>
                  <input type="datetime-local" value={formScheduledAt} onChange={(e) => setFormScheduledAt(e.target.value)} required
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
              </div>

              {(formStatus === "completed" || editing?.status === "completed") && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Score 1</label>
                    <input type="number" value={formScore1} onChange={(e) => setFormScore1(e.target.value)}
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Score 2</label>
                    <input type="number" value={formScore2} onChange={(e) => setFormScore2(e.target.value)}
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs text-gray-400">Description</label>
                <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={2}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : editing ? <Edit3 size={14} /> : <Plus size={14} />}
                  {saving ? "Saving..." : editing ? "Save Changes" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== Link Stream Modal ===== */}
      {linkStreamOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Link Live Stream</h2>
              <button onClick={() => setLinkStreamOpen(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <p className="mb-3 text-xs text-gray-400">Select a live stream to link to "{linkTarget?.title}"</p>
            {streams.length === 0 ? (
              <p className="text-sm text-gray-500">No streams available</p>
            ) : (
              <div className="space-y-2">
                {streams.map((s) => (
                  <button key={s.id} onClick={() => doLinkStream(s.id)} disabled={linkSaving}
                    className="flex w-full items-center justify-between rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50">
                    <span className="text-white">{s.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${s.status === "live" ? "bg-red-500/20 text-red-400" : "bg-gray-500/20 text-gray-400"}`}>{s.status}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== Link Replay Modal ===== */}
      {linkReplayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Link Replay Video</h2>
              <button onClick={() => setLinkReplayOpen(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <p className="mb-3 text-xs text-gray-400">Select a video as full replay for "{linkTarget?.title}"</p>
            {videos.length === 0 ? (
              <p className="text-sm text-gray-500">No videos available</p>
            ) : (
              <div className="space-y-2">
                {videos.map((v) => (
                  <button key={v.id} onClick={() => doLinkReplay(v.id)} disabled={linkSaving}
                    className="flex w-full items-center justify-between rounded border border-[var(--border)] px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50">
                    <span className="text-white truncate">{v.title}</span>
                    <span className="text-xs text-gray-500 ml-2 shrink-0">{Math.round(v.duration / 60)}m</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== Add Highlight Modal ===== */}
      {highlightOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Add Highlight</h2>
              <button onClick={() => setHighlightOpen(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={doAddHighlight} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Title</label>
                <input type="text" value={hlTitle} onChange={(e) => setHlTitle(e.target.value)} placeholder="Mbappe Goal 45'" required
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Video</label>
                <select value={hlVideoId} onChange={(e) => setHlVideoId(e.target.value)} required
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
                  <option value="">Select video</option>
                  {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Type</label>
                  <select value={hlType} onChange={(e) => setHlType(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
                    {HIGHLIGHT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Timestamp (sec)</label>
                  <input type="number" value={hlTimestamp} onChange={(e) => setHlTimestamp(e.target.value)} placeholder="2700"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setHighlightOpen(false)} className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
                <button type="submit" disabled={hlSaving}
                  className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  {hlSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  {hlSaving ? "Adding..." : "Add Highlight"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Event"
        message={`Permanently delete "${deleteTarget?.title}"? All highlights will also be deleted.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => { if (confirmAction) await confirmAction(); setConfirmOpen(false); setConfirmAction(null); }}
        onCancel={() => { setConfirmOpen(false); setConfirmAction(null); }}
      />
    </div>
  );
}
