import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, X, Loader2, Edit3, Trash2, Trophy, Calendar } from "lucide-react";
import { api } from "@/api/client";
import type { Competition, Category, PaginatedResponse } from "@/types/api";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

const COMPETITION_TYPES = [
  "tournament", "championship", "league", "cup", "series", "grand_prix_series",
] as const;
const STATUSES = ["upcoming", "active", "completed"] as const;

export default function CompetitionsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Competition[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [categories, setCategories] = useState<Category[]>([]);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Competition | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form
  const [formName, setFormName] = useState("");
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formType, setFormType] = useState("tournament");
  const [formSeason, setFormSeason] = useState("");
  const [formYear, setFormYear] = useState("");
  const [formStatus, setFormStatus] = useState("upcoming");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formLogoUrl, setFormLogoUrl] = useState("");

  // Confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Competition | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), page_size: String(pageSize) };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const data = await api.get<PaginatedResponse<Competition>>("/admin/competitions", params);
      setItems(data.items);
      setTotal(data.total);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  const fetchCategories = useCallback(async () => {
    try {
      const cats = await api.get<Category[]>("/admin/categories");
      setCategories(cats);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchCategories(); }, [fetchCategories]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setFormName(""); setFormCategoryId(""); setFormDescription("");
    setFormType("tournament"); setFormSeason(""); setFormYear("");
    setFormStatus("upcoming"); setFormStartDate(""); setFormEndDate("");
    setFormLogoUrl("");
    setError(""); setShowModal(true);
  };

  const openEdit = (c: Competition) => {
    setEditing(c);
    setFormName(c.name); setFormCategoryId(c.category_id);
    setFormDescription(c.description); setFormType(c.competition_type);
    setFormSeason(c.season || ""); setFormYear(c.year ? String(c.year) : "");
    setFormStatus(c.status);
    setFormStartDate(c.start_date ? c.start_date.slice(0, 16) : "");
    setFormEndDate(c.end_date ? c.end_date.slice(0, 16) : "");
    setFormLogoUrl(c.logo_url);
    setError(""); setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      const body: Record<string, unknown> = {
        name: formName,
        category_id: formCategoryId,
        description: formDescription,
        competition_type: formType,
        season: formSeason || null,
        year: formYear ? parseInt(formYear) : null,
        status: formStatus,
        start_date: formStartDate || null,
        end_date: formEndDate || null,
        logo_url: formLogoUrl,
      };
      if (editing) {
        await api.patch(`/admin/competitions/${editing.id}`, body);
      } else {
        await api.post("/admin/competitions", body);
      }
      setShowModal(false);
      fetchItems();
    } catch (err: unknown) {
      if (err && typeof err === "object" && "body" in err) {
        try {
          const parsed = JSON.parse((err as { body: string }).body);
          setError(parsed.detail || "Failed to save");
        } catch { setError("Failed to save"); }
      } else { setError("Failed to save"); }
    } finally { setSaving(false); }
  };

  const requestDelete = (c: Competition) => {
    setDeleteTarget(c);
    setConfirmAction(() => async () => {
      await api.delete(`/admin/competitions/${c.id}`);
      fetchItems();
    });
    setConfirmOpen(true);
  };

  const statusBadge = (s: string) => {
    const m: Record<string, string> = {
      upcoming: "bg-blue-500/20 text-blue-400",
      active: "bg-green-500/20 text-green-400",
      completed: "bg-gray-500/20 text-gray-400",
    };
    return m[s] || m.upcoming;
  };

  const typeBadge = () => {
    return "bg-purple-500/20 text-purple-400";
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Competitions</h1>
        <button onClick={openCreate} className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90">
          <Plus size={16} /> Add Competition
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search competitions..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[var(--primary)]" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Trophy size={40} className="mb-3 opacity-50" />
            <p>No competitions found. Create one to schedule events.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Season</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Events</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <button onClick={() => navigate(`/admin/events?competition_id=${c.id}`)} className="font-medium text-white hover:text-[var(--primary)]">
                      {c.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{c.category_name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${typeBadge()}`}>
                      {c.competition_type.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{c.season || c.year || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(c.status)}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{c.event_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => navigate(`/admin/events?competition_id=${c.id}`)} className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white" title="View Events">
                        <Calendar size={16} />
                      </button>
                      <button onClick={() => openEdit(c)} className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white" title="Edit">
                        <Edit3 size={16} />
                      </button>
                      <button onClick={() => requestDelete(c)} className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400" title="Delete">
                        <Trash2 size={16} />
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
          <span>{total} competitions total</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded border border-[var(--border)] px-3 py-1 hover:bg-white/10 disabled:opacity-30">Prev</button>
            <span className="flex items-center px-2">{page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded border border-[var(--border)] px-3 py-1 hover:bg-white/10 disabled:opacity-30">Next</button>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">{editing ? "Edit Competition" : "Create Competition"}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            {error && <p className="mb-4 text-sm text-red-500">{error}</p>}
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Name</label>
                  <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="FIFA World Cup 2026" required
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Category</label>
                  <select value={formCategoryId} onChange={(e) => setFormCategoryId(e.target.value)} required
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
                    <option value="">Select category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Type</label>
                  <select value={formType} onChange={(e) => setFormType(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
                    {COMPETITION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Status</label>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Season</label>
                  <input type="text" value={formSeason} onChange={(e) => setFormSeason(e.target.value)} placeholder="2025-26"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Year</label>
                  <input type="number" value={formYear} onChange={(e) => setFormYear(e.target.value)} placeholder="2026"
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Start Date</label>
                  <input type="datetime-local" value={formStartDate} onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-400">End Date</label>
                  <input type="datetime-local" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Description</label>
                <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={2}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]" />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Logo URL</label>
                <input type="text" value={formLogoUrl} onChange={(e) => setFormLogoUrl(e.target.value)} placeholder="https://..."
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

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Competition"
        message={`Permanently delete "${deleteTarget?.name}"? All events under this competition will also be deleted.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => { if (confirmAction) await confirmAction(); setConfirmOpen(false); setConfirmAction(null); }}
        onCancel={() => { setConfirmOpen(false); setConfirmAction(null); }}
      />
    </div>
  );
}
