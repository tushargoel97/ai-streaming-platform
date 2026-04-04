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
        className="fixed top-0 z-50 flex h-[72px] w-full items-center justify-between px-6"
        style={{
          background: "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)",
        }}
      >
        {/* Solid background overlay — fades in on scroll */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "rgba(10,10,10,0.97)",
            backdropFilter: "blur(10px)",
            opacity: scrolled ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
        />
        {/* Bottom border — fades in on scroll, no layout shift */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
          style={{
            background: "rgba(255,255,255,0.08)",
            opacity: scrolled ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
        />

        {/* Left: logo + nav links */}
        <div className="relative z-10 flex items-center gap-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-2xl font-black tracking-tight"
            style={{ color: "var(--primary)" }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            {config?.site_name || "StreamPlatform"}
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            <Link
              to="/"
              className="rounded px-3 py-2 text-[15px] text-gray-300 transition-colors hover:text-white"
            >
              Home
            </Link>
            <Link
              to="/browse"
              className="rounded px-3 py-2 text-[15px] text-gray-300 transition-colors hover:text-white"
            >
              Browse
            </Link>
            {config?.features?.live_streaming && (
              <Link
                to="/live"
                className="rounded px-3 py-2 text-[15px] text-gray-300 transition-colors hover:text-white"
              >
                Live
              </Link>
            )}
          </div>
        </div>

        {/* Right: search + user */}
        <div className="relative z-10 flex items-center gap-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            title="Search (Ctrl+K)"
          >
            <Search size={21} />
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
                    className="h-9 w-9 rounded-full object-cover ring-2 ring-white/20"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-white/20"
                    style={{ background: "var(--primary)" }}
                  >
                    {(user?.display_name || user?.username || "U").charAt(0).toUpperCase()}
                  </div>
                )}
              </button>

              {open && (
                <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a] shadow-2xl shadow-black">
                  <div className="border-b border-white/10 px-4 py-3">
                    <p className="text-[15px] font-semibold text-white">{user?.display_name}</p>
                    <p className="text-[13px] text-gray-500">@{user?.username}</p>
                  </div>
                  <div className="py-1">
                    <Link to="/profile" onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-[15px] text-gray-300 transition-colors hover:bg-white/5 hover:text-white">
                      <UserIcon size={17} /> My Profile
                    </Link>
                    <Link to="/watchlist" onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-[15px] text-gray-300 transition-colors hover:bg-white/5 hover:text-white">
                      <Bookmark size={17} /> My Watchlist
                    </Link>
                    <Link to="/changePassword" onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-[15px] text-gray-300 transition-colors hover:bg-white/5 hover:text-white">
                      <Lock size={17} /> Change Password
                    </Link>
                    {(user?.role === "admin" || user?.role === "superadmin") && (
                      <Link to="/admin" onClick={() => setOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-[15px] text-yellow-400 transition-colors hover:bg-white/5 hover:text-yellow-300">
                        <Shield size={17} /> Admin Panel
                      </Link>
                    )}
                  </div>
                  <div className="border-t border-white/10 py-1">
                    <button onClick={handleLogout}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-[15px] text-gray-300 transition-colors hover:bg-white/5 hover:text-white">
                      <LogOut size={17} /> Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : !isAuthPage ? (
            <Link
              to="/login"
              className="rounded px-6 py-2 text-[15px] font-semibold text-white transition-opacity hover:opacity-85"
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
