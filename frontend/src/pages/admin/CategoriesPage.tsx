import { useState, useEffect, useCallback } from "react";
import { Search, Trash2, Edit3, Plus, X, Loader2, FolderOpen, Copy } from "lucide-react";
import { api } from "@/api/client";
import { useTenantStore } from "@/stores/tenantStore";
import type { AdminTenant } from "@/types/api";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface Category {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  created_at: string;
}

export default function CategoriesPage() {
  const tenantConfig = useTenantStore((s) => s.config);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Create/Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [formTenantIds, setFormTenantIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Tenants for multi-select
  const [tenants, setTenants] = useState<AdminTenant[]>([]);

  // Copy modal
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySource, setCopySource] = useState<Category | null>(null);
  const [copyTenantIds, setCopyTenantIds] = useState<string[]>([]);

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Category | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const data = await api.get<Category[]>("/admin/categories", params);
      setCategories(data);
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    api.get<{ items: AdminTenant[] }>("/admin/tenants").then((d) => setTenants(d.items)).catch(() => {})
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFormName("");
    setFormDescription("");
    setFormSortOrder(0);
    setFormTenantIds(tenantConfig?.id ? [tenantConfig.id] : []);
    setShowModal(true);
  };

  const openEdit = (cat: Category) => {
    setEditing(cat);
    setFormName(cat.name);
    setFormDescription(cat.description);
    setFormSortOrder(cat.sort_order);
    setFormTenantIds([cat.tenant_id]);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/admin/categories/${editing.id}`, {
          name: formName,
          description: formDescription,
          sort_order: formSortOrder,
        });
      } else {
        await api.post("/admin/categories", {
          name: formName,
          description: formDescription,
          sort_order: formSortOrder,
          tenant_ids: formTenantIds,
        });
      }
      setShowModal(false);
      fetchCategories();
    } catch {
      // keep modal open
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (cat: Category) => {
    setConfirmTarget(cat);
    setConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!confirmTarget) return;
    try {
      await api.delete(`/admin/categories/${confirmTarget.id}`);
      fetchCategories();
    } catch {
      // silent
    } finally {
      setConfirmOpen(false);
      setConfirmTarget(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Categories</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Add Category
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <FolderOpen size={40} className="mb-3 opacity-50" />
            <p>No categories found. Add your first category to get started.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-medium text-white">{cat.name}</td>
                  <td className="px-4 py-3 text-gray-400">{cat.slug}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
                      {tenants.find((t) => t.id === cat.tenant_id)?.site_name || cat.tenant_id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="max-w-[300px] truncate px-4 py-3 text-gray-400">
                    {cat.description || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{cat.sort_order}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(cat)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                        title="Edit"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        onClick={() => {
                          setCopySource(cat);
                          setCopyTenantIds([]);
                          setShowCopyModal(true);
                        }}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-blue-400"
                        title="Copy to other tenants"
                      >
                        <Copy size={16} />
                      </button>
                      <button
                        onClick={() => requestDelete(cat)}
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
      </div>

      {/* ===== Create/Edit Modal ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {editing ? "Edit Category" : "Add Category"}
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
                  placeholder="e.g. Action, Comedy, Drama..."
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Sort Order</label>
                <input
                  type="number"
                  value={formSortOrder}
                  onChange={(e) => setFormSortOrder(Number(e.target.value))}
                  className="w-32 rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              {!editing && tenants.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Create in Tenants</label>
                  <div className="flex flex-wrap gap-2 rounded border border-[var(--border)] bg-[var(--secondary)] p-2">
                    {tenants.map((t) => {
                      const selected = formTenantIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() =>
                            setFormTenantIds((prev) =>
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
                </div>
              )}

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
        title="Delete Category"
        message={`Delete category "${confirmTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => { setConfirmOpen(false); setConfirmTarget(null); }}
      />

      {/* Copy to Tenants Modal */}
      {showCopyModal && copySource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Copy "{copySource.name}" to Tenants</h2>
              <button onClick={() => setShowCopyModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <p className="mb-4 text-sm text-gray-400">
              Select which tenants to copy this category to. If it already exists there, it will be skipped.
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              {tenants
                .filter((t) => t.id !== copySource.tenant_id)
                .map((t) => {
                  const selected = copyTenantIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() =>
                        setCopyTenantIds((prev) =>
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
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCopyModal(false)}
                className="rounded px-4 py-2 text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                disabled={copyTenantIds.length === 0}
                onClick={async () => {
                  try {
                    await api.post(`/admin/categories/${copySource.id}/copy-to-tenants`, copyTenantIds);
                    setShowCopyModal(false);
                    fetchCategories();
                  } catch {
                    // silent
                  }
                }}
                className="flex items-center gap-2 rounded bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Copy size={14} /> Copy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
