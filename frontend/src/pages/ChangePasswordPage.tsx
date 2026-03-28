import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

export default function ChangePasswordPage() {
  const { isAuthenticated, changePassword } = useAuthStore();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated) navigate("/login");
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setMessage("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Current password is incorrect");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center pt-20 pb-8">
      <div className="w-full max-w-md rounded-lg bg-[var(--card)] p-8">
        <h1 className="mb-6 text-2xl font-bold">Change Password</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {message && <p className="text-sm text-green-400">{message}</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}

          <div>
            <label className="mb-1 block text-xs text-gray-400">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
              minLength={6}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-400">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded bg-[var(--primary)] py-3 font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Changing..." : "Change Password"}
          </button>
        </form>
      </div>
    </div>
  );
}
