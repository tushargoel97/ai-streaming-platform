import { useState, useEffect, useCallback } from "react";
import { Search, Trash2, Edit3, Plus, X, Loader2, Users } from "lucide-react";
import { api } from "@/api/client";
import type { Talent, PaginatedResponse } from "@/types/api";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export default function TalentsPage() {
  const [talents, setTalents] = useState<Talent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create/Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingTalent, setEditingTalent] = useState<Talent | null>(null);
  const [formName, setFormName] = useState("");
  const [formBio, setFormBio] = useState("");
  const [formPhotoUrl, setFormPhotoUrl] = useState("");
  const [formBirthDate, setFormBirthDate] = useState("");
  const [saving, setSaving] = useState(false);

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Talent | null>(null);

  const pageSize = 20;

  const fetchTalents = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        page_size: String(pageSize),
      };
      if (search) params.search = search;
      const data = await api.get<PaginatedResponse<Talent>>("/admin/talents", params);
      setTalents(data.items);
      setTotal(data.total);
    } catch {
      setTalents([]);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchTalents();
  }, [fetchTalents]);

  const openCreate = () => {
    setEditingTalent(null);
    setFormName("");
    setFormBio("");
    setFormPhotoUrl("");
    setFormBirthDate("");
    setShowModal(true);
  };

  const openEdit = (talent: Talent) => {
    setEditingTalent(talent);
    setFormName(talent.name);
    setFormBio(talent.bio);
    setFormPhotoUrl(talent.photo_url);
    setFormBirthDate(talent.birth_date || "");
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: formName,
        bio: formBio,
        photo_url: formPhotoUrl,
      };
      if (formBirthDate) body.birth_date = formBirthDate;

      if (editingTalent) {
        await api.patch(`/admin/talents/${editingTalent.id}`, body);
      } else {
        await api.post("/admin/talents", body);
      }
      setShowModal(false);
      fetchTalents();
    } catch {
      // keep modal open
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (talent: Talent) => {
    setConfirmTarget(talent);
    setConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/admin/talents/${confirmTarget.id}`);
      fetchTalents();
    } catch {
      // silent
    } finally {
      setConfirmOpen(false);
      setConfirmTarget(null);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Talents</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Add Talent
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search talents..."
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
        ) : talents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Users size={40} className="mb-3 opacity-50" />
            <p>No talents found. Add your first talent to get started.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Photo</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Bio</th>
                <th className="px-4 py-3">Birth Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {talents.map((t) => (
                <tr key={t.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    {t.photo_url ? (
                      <img src={t.photo_url} alt={t.name} className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-gray-400">
                        {t.name[0]?.toUpperCase()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-white">{t.name}</td>
                  <td className="max-w-[300px] truncate px-4 py-3 text-gray-400">
                    {t.bio || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{t.birth_date || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(t)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                        title="Edit"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => requestDelete(t)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
            <span className="text-sm text-gray-400">
              {total} talent{total !== 1 ? "s" : ""} total
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

      {/* ===== Create/Edit Modal ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {editingTalent ? "Edit Talent" : "Add Talent"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Bio</label>
                <textarea
                  value={formBio}
                  onChange={(e) => setFormBio(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Photo URL</label>
                  <input
                    type="text"
                    value={formPhotoUrl}
                    onChange={(e) => setFormPhotoUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-gray-400">Birth Date</label>
                  <input
                    type="date"
                    value={formBirthDate}
                    onChange={(e) => setFormBirthDate(e.target.value)}
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
                  {saving ? <Loader2 size={14} className="animate-spin" /> : editingTalent ? <Edit3 size={14} /> : <Plus size={14} />}
                  {saving ? "Saving..." : editingTalent ? "Save Changes" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Talent"
        message={`Delete "${confirmTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => { setConfirmOpen(false); setConfirmTarget(null); }}
      />
    </div>
  );
}
