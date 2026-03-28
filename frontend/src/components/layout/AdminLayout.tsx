import { useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Video,
  FolderOpen,
  Users,
  Star,
  Radio,
  Shield,
  Clapperboard,
  CreditCard,
  Trophy,
  Calendar,
  Brain,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";

const navItems = [
  { path: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { path: "/admin/videos", label: "Videos", icon: Video },
  { path: "/admin/series", label: "Series", icon: Clapperboard },
  { path: "/admin/categories", label: "Categories", icon: FolderOpen },
  { path: "/admin/talents", label: "Talents", icon: Star },
  { path: "/admin/live", label: "Live Streams", icon: Radio },
  { path: "/admin/competitions", label: "Competitions", icon: Trophy },
  { path: "/admin/events", label: "Event Schedule", icon: Calendar },
  { path: "/admin/ai", label: "AI Settings", icon: Brain },
  { path: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { path: "/admin/users", label: "Users", icon: Users },
  { path: "/admin/tenants", label: "Tenants", icon: Shield },
];

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, loading, loadUser, logout } = useAuthStore();

  useEffect(() => {
    if (isAuthenticated && !user) {
      loadUser();
    }
  }, [isAuthenticated, user, loadUser]);

  useEffect(() => {
    // Wait for user to finish loading before redirecting
    if (loading) return;
    if (!isAuthenticated) {
      navigate("/login", { replace: true });
      return;
    }
    if (user && user.role !== "admin" && user.role !== "superadmin") {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, user, loading, navigate]);

  if (loading || !isAuthenticated || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
      </div>
    );
  }

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex h-screen bg-[#0a0a0a]">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-r border-[var(--border)] bg-[var(--secondary)]">
        <div className="flex h-16 items-center px-6">
          <Link to="/" className="text-lg font-bold" style={{ color: "var(--primary)" }}>
            Admin Panel
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                location.pathname === path
                  ? "bg-white/10 text-white"
                  : "text-gray-400 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-[var(--border)] p-4">
          <div className="mb-3 px-1">
            <p className="text-sm text-gray-300">{user.display_name}</p>
            <p className="text-xs text-gray-500">{user.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white"
          >
            <LogOut size={16} />
            Sign out
          </button>
          <Link to="/" className="mt-2 block text-xs text-gray-500 hover:text-gray-300 px-3">
            Back to site
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
