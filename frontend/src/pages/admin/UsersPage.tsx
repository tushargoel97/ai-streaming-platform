import { useState, useEffect, useCallback } from "react";
import { Search, Plus, X, Loader2, Users, Edit3, UserX, UserCheck, Shield, Eye } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import type { AdminUser, PaginatedResponse } from "@/types/api";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

const ROLES = ["viewer", "admin", "superadmin"] as const;

const roleBadge = (role: string) => {
  const colors: Record<string, string> = {
    superadmin: "bg-red-500/20 text-red-400",
    admin: "bg-blue-500/20 text-blue-400",
    viewer: "bg-gray-500/20 text-gray-400",
  };
  return colors[role] || colors.viewer;
};

export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Create/Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [formEmail, setFormEmail] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState("viewer");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), page_size: String(pageSize) };
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      const data = await api.get<PaginatedResponse<AdminUser>>("/admin/users", params);
      setUsers(data.items);
      setTotal(data.total);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter]);

  const openCreate = () => {
    setEditing(null);
    setFormEmail("");
    setFormUsername("");
    setFormDisplayName("");
    setFormPassword("");
    setFormRole("viewer");
    setError("");
    setShowModal(true);
  };

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    setFormDisplayName(u.display_name);
    setFormRole(u.role);
    setError("");
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await api.patch(`/admin/users/${editing.id}`, {
          display_name: formDisplayName,
          role: formRole,
        });
      } else {
        await api.post("/admin/users", {
          email: formEmail,
          username: formUsername,
          display_name: formDisplayName || formUsername,
          password: formPassword,
          role: formRole,
        });
      }
      setShowModal(false);
      fetchUsers();
    } catch (err: unknown) {
      if (err && typeof err === "object" && "body" in err) {
        try {
          const parsed = JSON.parse((err as { body: string }).body);
          setError(parsed.detail || "Failed to save");
        } catch {
          setError("Failed to save");
        }
      } else {
        setError("Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = (u: AdminUser) => {
    const action = u.is_active ? "Deactivate" : "Reactivate";
    setConfirmMessage(`${action} user "${u.username}"?`);
    setConfirmAction(() => async () => {
      try {
        if (u.is_active) {
          await api.delete(`/admin/users/${u.id}`);
        } else {
          await api.patch(`/admin/users/${u.id}`, { is_active: true });
        }
        fetchUsers();
      } catch {
        // silent
      }
    });
    setConfirmOpen(true);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Users</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded bg-[var(--primary)] px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> Add User
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative max-w-xs flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[var(--primary)]"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none"
        >
          <option value="">All Roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Users size={40} className="mb-3 opacity-50" />
            <p>No users found.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Login</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-bold uppercase">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : (
                          u.username.slice(0, 2)
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-white">{u.display_name}</p>
                        <p className="text-xs text-gray-500">@{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${roleBadge(u.role)}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{u.auth_provider}</td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="text-xs text-green-400">Active</span>
                    ) : (
                      <span className="text-xs text-red-400">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="rounded p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                        title="Edit"
                      >
                        <Edit3 size={16} />
                      </button>
                      {u.id !== currentUser?.id && (
                        <button
                          onClick={() => toggleActive(u)}
                          className={`rounded p-1.5 text-gray-400 hover:bg-white/10 ${u.is_active ? "hover:text-red-400" : "hover:text-green-400"}`}
                          title={u.is_active ? "Deactivate" : "Activate"}
                        >
                          {u.is_active ? <UserX size={16} /> : <UserCheck size={16} />}
                        </button>
                      )}
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
          <span>{total} users total</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded border border-[var(--border)] px-3 py-1 hover:bg-white/10 disabled:opacity-30"
            >
              Prev
            </button>
            <span className="flex items-center px-2">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded border border-[var(--border)] px-3 py-1 hover:bg-white/10 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ===== Create/Edit Modal ===== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg bg-[var(--card)] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                {editing ? "Edit User" : "Create User"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

            <form onSubmit={handleSave} className="space-y-4">
              {!editing && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Email</label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Username</label>
                    <input
                      type="text"
                      value={formUsername}
                      onChange={(e) => setFormUsername(e.target.value)}
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-400">Password</label>
                    <input
                      type="password"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                      required
                      minLength={6}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="mb-1 block text-xs text-gray-400">Display Name</label>
                <input
                  type="text"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-400">Role</label>
                <div className="flex gap-2">
                  {ROLES.map((r) => {
                    const isSuperadminOption = r === "superadmin";
                    const canSelect = !isSuperadminOption || currentUser?.role === "superadmin";
                    return (
                      <button
                        key={r}
                        type="button"
                        disabled={!canSelect}
                        onClick={() => setFormRole(r)}
                        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                          formRole === r
                            ? "border-[var(--primary)] bg-[var(--primary)]/20 text-white"
                            : "border-[var(--border)] text-gray-400 hover:text-white"
                        } ${!canSelect ? "cursor-not-allowed opacity-30" : ""}`}
                      >
                        {r === "superadmin" ? <Shield size={14} /> : r === "admin" ? <Edit3 size={14} /> : <Eye size={14} />}
                        {r}
                      </button>
                    );
                  })}
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
                  {saving ? <Loader2 size={14} className="animate-spin" /> : editing ? <Edit3 size={14} /> : <Plus size={14} />}
                  {saving ? "Saving..." : editing ? "Save Changes" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm Action"
        message={confirmMessage}
        confirmLabel="Confirm"
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
