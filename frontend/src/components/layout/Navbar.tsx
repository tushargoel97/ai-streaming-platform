import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, ChevronDown, User as UserIcon, Lock, LogOut, Shield, Bookmark } from "lucide-react";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuthStore } from "@/stores/authStore";
import SearchOverlay from "@/components/search/SearchOverlay";

export default function Navbar() {
  const config = useTenantStore((s) => s.config);
  const { user, isAuthenticated, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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
      <nav className="fixed top-0 z-50 flex h-16 w-full items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-6">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-xl font-bold" style={{ color: "var(--primary)" }}>
            {config?.site_name || "StreamPlatform"}
          </Link>
          <div className="hidden gap-4 md:flex">
            <Link to="/" className="text-sm text-gray-300 hover:text-white">Home</Link>
            <Link to="/browse" className="text-sm text-gray-300 hover:text-white">Browse</Link>
            {config?.features?.live_streaming && (
              <Link to="/live" className="text-sm text-gray-300 hover:text-white">Live</Link>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => setSearchOpen(true)}
            className="text-gray-300 transition-colors hover:text-white"
            title="Search (Ctrl+K)"
          >
            <Search size={20} />
          </button>
          {isAuthenticated ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-white/10 hover:text-white"
              >
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-bold text-white">
                    {(user?.display_name || user?.username || "U").charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="hidden sm:inline">{user?.display_name || user?.username}</span>
                <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
              </button>

              {open && (
                <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl">
                  <div className="border-b border-[var(--border)] px-4 py-3">
                    <p className="text-sm font-medium text-white">{user?.display_name}</p>
                    <p className="text-xs text-gray-400">@{user?.username}</p>
                  </div>
                  <div className="py-1">
                    <Link
                      to="/profile"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 hover:text-white"
                    >
                      <UserIcon size={16} />
                      My Profile
                    </Link>
                    <Link
                      to="/watchlist"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 hover:text-white"
                    >
                      <Bookmark size={16} />
                      My Watchlist
                    </Link>
                    <Link
                      to="/changePassword"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 hover:text-white"
                    >
                      <Lock size={16} />
                      Change Password
                    </Link>
                    {(user?.role === "admin" || user?.role === "superadmin") && (
                      <Link
                        to="/admin"
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-yellow-400 hover:bg-white/5 hover:text-yellow-300"
                      >
                        <Shield size={16} />
                        Admin Panel
                      </Link>
                    )}
                  </div>
                  <div className="border-t border-[var(--border)] py-1">
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 hover:text-white"
                    >
                      <LogOut size={16} />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="rounded bg-[var(--primary)] px-4 py-1.5 text-sm font-medium hover:opacity-90">
              Sign In
            </Link>
          )}
        </div>
      </nav>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
