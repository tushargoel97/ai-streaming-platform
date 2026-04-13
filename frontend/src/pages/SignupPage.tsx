import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { ApiError } from "@/api/client";
import { API_URL } from "@/lib/constants";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const { register, setTokens, loading } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Handle OAuth callback — tokens arrive as URL params
  useEffect(() => {
    const accessToken = searchParams.get("access_token");
    const refreshToken = searchParams.get("refresh_token");
    if (accessToken && refreshToken) {
      setTokens({ access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" });
      window.history.replaceState({}, "", "/signup");
      navigate("/");
    }
  }, [searchParams, setTokens, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      await register(email, username, password, displayName || undefined);
      navigate("/");
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.body);
          setError(parsed.detail || "Registration failed");
        } catch {
          setError("Registration failed");
        }
      } else {
        setError("Registration failed");
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center pt-[72px]">
      <div className="w-full max-w-md rounded-lg bg-[var(--card)] p-8">
        <h1 className="mb-6 text-2xl font-bold">Create Account</h1>

        {/* SSO Buttons */}
        <div className="mb-6 space-y-3">
          <a
            href={`${API_URL}/auth/google`}
            className="flex w-full items-center justify-center gap-3 rounded border border-[var(--border)] bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </a>
          <a
            href={`${API_URL}/auth/facebook`}
            className="flex w-full items-center justify-center gap-3 rounded border border-[var(--border)] bg-white/5 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 9a9 9 0 10-10.406 8.89v-6.29H5.309V9h2.285V7.017c0-2.258 1.344-3.504 3.4-3.504.985 0 2.015.176 2.015.176v2.215h-1.135c-1.118 0-1.467.694-1.467 1.406V9h2.496l-.399 2.6h-2.097v6.29A9.002 9.002 0 0018 9" fill="#1877F2"/>
              <path d="M12.497 11.6L12.896 9h-2.496V7.31c0-.712.349-1.406 1.467-1.406h1.135V3.69s-1.03-.176-2.015-.176c-2.056 0-3.4 1.246-3.4 3.504V9H5.31v2.6h2.285v6.29a9.07 9.07 0 002.812 0v-6.29h2.097" fill="#fff"/>
            </svg>
            Continue with Facebook
          </a>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--border)]" />
          <span className="text-xs text-gray-500">OR</span>
          <div className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-500">{error}</p>}

          <div>
            <label htmlFor="signup-email" className="mb-1 block text-xs text-gray-400">Email</label>
            <input
              id="signup-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
            />
          </div>

          <div>
            <label htmlFor="signup-username" className="mb-1 block text-xs text-gray-400">Username</label>
            <input
              id="signup-username"
              type="text"
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
            />
          </div>

          <div>
            <label htmlFor="signup-display-name" className="mb-1 block text-xs text-gray-400">
              Display Name <span className="text-gray-500">(optional)</span>
            </label>
            <input
              id="signup-display-name"
              type="text"
              placeholder="How others see you"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
            />
          </div>

          <div>
            <label htmlFor="signup-password" className="mb-1 block text-xs text-gray-400">Password</label>
            <input
              id="signup-password"
              type="password"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
              minLength={6}
            />
          </div>

          <div>
            <label htmlFor="signup-confirm-password" className="mb-1 block text-xs text-gray-400">Confirm Password</label>
            <input
              id="signup-confirm-password"
              type="password"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-[var(--primary)] py-3 font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          Already have an account?{" "}
          <Link to="/login" className="text-[var(--primary)] hover:underline">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}
