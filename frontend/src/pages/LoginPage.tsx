import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { ApiError } from "@/api/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api/v1";

type LoginMethod = "password" | "otp";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [method, setMethod] = useState<LoginMethod>("password");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [error, setError] = useState("");
  const { login, requestOtp, setTokens, loading } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Handle OAuth callback — tokens arrive as URL params
  useEffect(() => {
    const accessToken = searchParams.get("access_token");
    const refreshToken = searchParams.get("refresh_token");
    if (accessToken && refreshToken) {
      setTokens({ access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" });
      // Clean URL and redirect
      window.history.replaceState({}, "", "/login");
      navigate("/");
    }
  }, [searchParams, setTokens, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const credential = method === "otp" ? otp : password;
      await login(identifier, credential, method);
      navigate("/");
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        try {
          const parsed = JSON.parse(err.body);
          setError(parsed.detail || "Invalid credentials");
        } catch {
          setError("Invalid credentials");
        }
      } else {
        setError(method === "otp" ? "Invalid or expired OTP" : "Invalid credentials");
      }
    }
  };

  const handleRequestOtp = async () => {
    if (!identifier) {
      setError("Enter your email or username first");
      return;
    }
    setError("");
    setOtpLoading(true);
    try {
      await requestOtp(identifier);
      setOtpSent(true);
    } catch {
      setError("Failed to send OTP");
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center pt-16">
      <div className="w-full max-w-md rounded-lg bg-[var(--card)] p-8">
        <h1 className="mb-6 text-2xl font-bold">Sign In</h1>

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

        {/* Method toggle */}
        <div className="mb-6 flex rounded-lg border border-[var(--border)] p-1">
          <button
            type="button"
            onClick={() => { setMethod("password"); setError(""); }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              method === "password"
                ? "bg-[var(--primary)] text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Password
          </button>
          <button
            type="button"
            onClick={() => { setMethod("otp"); setError(""); }}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              method === "otp"
                ? "bg-[var(--primary)] text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Email OTP
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-500">{error}</p>}

          <div>
            <label className="mb-1 block text-xs text-gray-400">Email or Username</label>
            <input
              type="text"
              placeholder="Enter email or username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
              required
            />
          </div>

          {method === "password" ? (
            <div>
              <label className="mb-1 block text-xs text-gray-400">Password</label>
              <input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
                required
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-gray-400">One-Time Password</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter 6-digit code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="flex-1 rounded border border-[var(--border)] bg-[var(--secondary)] px-4 py-3 text-white outline-none focus:border-[var(--primary)]"
                  maxLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  disabled={otpLoading}
                  className="whitespace-nowrap rounded bg-white/10 px-4 py-3 text-sm font-medium text-gray-300 hover:bg-white/20 disabled:opacity-50"
                >
                  {otpLoading ? "Sending..." : otpSent ? "Resend" : "Send OTP"}
                </button>
              </div>
              {otpSent && (
                <p className="mt-2 text-xs text-green-400">OTP sent to your email. Check your inbox.</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-[var(--primary)] py-3 font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          Don't have an account?{" "}
          <Link to="/signup" className="text-[var(--primary)] hover:underline">
            Sign Up
          </Link>
        </p>
      </div>
    </div>
  );
}
