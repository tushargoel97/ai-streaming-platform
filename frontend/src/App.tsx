import { Routes, Route } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import AdminLayout from "@/components/layout/AdminLayout";
import HomePage from "@/pages/HomePage";
import BrowsePage from "@/pages/BrowsePage";
import WatchPage from "@/pages/WatchPage";
import SeriesPage from "@/pages/SeriesPage";
import TalentPage from "@/pages/TalentPage";
import LivePage from "@/pages/LivePage";
import LiveDirectoryPage from "@/pages/LiveDirectoryPage";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import ProfilePage from "@/pages/ProfilePage";
import ChangePasswordPage from "@/pages/ChangePasswordPage";
import WatchlistPage from "@/pages/WatchlistPage";
import PricingPage from "@/pages/PricingPage";
import AdminDashboard from "@/pages/admin/DashboardPage";
import AdminVideos from "@/pages/admin/VideosPage";
import AdminCategories from "@/pages/admin/CategoriesPage";
import AdminTalents from "@/pages/admin/TalentsPage";
import AdminSeries from "@/pages/admin/SeriesPage";
import AdminLive from "@/pages/admin/LivePage";
import AdminUsers from "@/pages/admin/UsersPage";
import AdminTenants from "@/pages/admin/TenantsPage";
import AdminSubscriptions from "@/pages/admin/SubscriptionsPage";
import AdminCompetitions from "@/pages/admin/CompetitionsPage";
import AdminEvents from "@/pages/admin/EventsPage";
import AdminAISettings from "@/pages/admin/AISettingsPage";

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/watch/:id" element={<WatchPage />} />
        <Route path="/series/:id" element={<SeriesPage />} />
        <Route path="/talent/:id" element={<TalentPage />} />
        <Route path="/live" element={<LiveDirectoryPage />} />
        <Route path="/live/:id" element={<LivePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/changePassword" element={<ChangePasswordPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/pricing" element={<PricingPage />} />
      </Route>

      {/* Admin routes */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="videos" element={<AdminVideos />} />
        <Route path="categories" element={<AdminCategories />} />
        <Route path="talents" element={<AdminTalents />} />
        <Route path="series" element={<AdminSeries />} />
        <Route path="live" element={<AdminLive />} />
        <Route path="competitions" element={<AdminCompetitions />} />
        <Route path="events" element={<AdminEvents />} />
        <Route path="ai" element={<AdminAISettings />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="tenants" element={<AdminTenants />} />
        <Route path="subscriptions" element={<AdminSubscriptions />} />
      </Route>
    </Routes>
  );
}
