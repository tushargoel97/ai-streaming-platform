import { useState, useRef, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Search, User as UserIcon, Lock, LogOut, Shield, Bookmark } from "lucide-react";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuthStore } from "@/stores/authStore";
import SearchOverlay from "@/components/search/SearchOverlay";

export default function Navbar() {
  const config = useTenantStore((s) => s.config);
  const { user, isAuthenticated, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthPage = location.pathname === "/login" || location.pathname === "/signup";

  // Scroll-aware background
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Ctrl/Cmd+K to toggle search
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const handleLogout = () => {
    setOpen(false);
    logout();
    navigate("/");
  };

  return (
    <>
      <nav
        className="fixed top-0 z-50 flex h-16 w-full items-center justify-between px-6 transition-all duration-300"
        style={{
          background: scrolled
            ? "rgba(10,10,10,0.97)"
            : "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)",
          backdropFilter: scrolled ? "blur(8px)" : "none",
          borderBottom: scrolled ? "1px solid rgba(255,255,255,0.05)" : "none",
        }}
      >
        {/* Left: logo + nav links */}
        <div className="flex items-center gap-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-xl font-black tracking-tight"
            style={{ color: "var(--primary)" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            {config?.site_name || "StreamPlatform"}
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            <Link
              to="/"
              className="rounded px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-white"
            >
              Home
            </Link>
            <Link
              to="/browse"
              className="rounded px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-white"
            >
              Browse
            </Link>
            {config?.features?.live_streaming && (
              <Link
                to="/live"
                className="rounded px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-white"
              >
                Live
              </Link>
            )}
          </div>
        </div>

        {/* Right: search + user */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            title="Search (Ctrl+K)"
          >
            <Search size={18} />
          </button>

          {isAuthenticated ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 rounded-full transition-opacity hover:opacity-80"
              >
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover ring-2 ring-white/20"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white/20"
                    style={{ background: "var(--primary)" }}
                  >
                    {(user?.display_name || user?.username || "U").charAt(0).toUpperCase()}
                  </div>
                )}
              </button>

              {open && (
                <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] shadow-2xl shadow-black">
                  <div className="border-b border-white/10 px-4 py-3">
                    <p className="text-sm font-semibold text-white">{user?.display_name}</p>
                    <p className="text-xs text-gray-500">@{user?.username}</p>
                  </div>
                  <div className="py-1">
                    <Link to="/profile" onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-white">
                      <UserIcon size={15} /> My Profile
                    </Link>
                    <Link to="/watchlist" onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-white">
                      <Bookmark size={15} /> My Watchlist
                    </Link>
                    <Link to="/changePassword" onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-white">
                      <Lock size={15} /> Change Password
                    </Link>
                    {(user?.role === "admin" || user?.role === "superadmin") && (
                      <Link to="/admin" onClick={() => setOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-yellow-400 transition-colors hover:bg-white/5 hover:text-yellow-300">
                        <Shield size={15} /> Admin Panel
                      </Link>
                    )}
                  </div>
                  <div className="border-t border-white/10 py-1">
                    <button onClick={handleLogout}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-300 transition-colors hover:bg-white/5 hover:text-white">
                      <LogOut size={15} /> Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : !isAuthPage ? (
            <Link
              to="/login"
              className="rounded px-5 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-85"
              style={{ background: "var(--primary)" }}
            >
              Sign In
            </Link>
          ) : null}
        </div>
      </nav>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
