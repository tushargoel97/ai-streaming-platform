import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

export default function ProfilePage() {
  const { user, isAuthenticated, loadUser, updateProfile } = useAuthStore();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    if (!user) loadUser();
  }, [isAuthenticated, user, loadUser, navigate]);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setDisplayName(user.display_name);
      setAvatarUrl(user.avatar_url);
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await updateProfile({ username, display_name: displayName, avatar_url: avatarUrl });
      setMessage("Profile updated successfully");
    } catch {
      setError("Failed to update profile. Username may already be taken.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center pt-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center pt-20 pb-8">
      <div className="w-full max-w-lg rounded-lg bg-[var(--card)] p-8">
        <h1 className="mb-6 text-2xl font-bold">My Profile</h1>

        <form onSubmit={handleSubmit} className="space-y-5">
          {message && <p className="text-sm text-green-400">{message}</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}

          {/* Avatar preview */}
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--primary)] text-2xl font-bold text-white">
                {(displayName || username || "U").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <label className="mb-1 block text-xs text-gray-400">Avatar URL</label>
              <input
                type="text"
                placeholder="https://example.com/avatar.jpg"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-3 py-2 text-sm text-white outline-none focus:border-[var(--primary)]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">Email</label>
            <input
              type="text"
              value={user.email}
              disabled
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-gray-500 outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">Email cannot be changed</p>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">Role</label>
            <input
              type="text"
              value={user.role}
              disabled
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-gray-500 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded bg-[var(--primary)] py-3 font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </form>
      </div>
    </div>
  );
}
