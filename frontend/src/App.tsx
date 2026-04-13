import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import AppShell from "@/components/layout/AppShell";
import AdminLayout from "@/components/layout/AdminLayout";
import HomePage from "@/pages/HomePage";
import BrowsePage from "@/pages/BrowsePage";
import LoginPage from "@/pages/LoginPage";
import SignupPage from "@/pages/SignupPage";
import NotFoundPage from "@/pages/NotFoundPage";

// Lazy-loaded pages
const WatchPage = lazy(() => import("@/pages/WatchPage"));
const SeriesPage = lazy(() => import("@/pages/SeriesPage"));
const TalentPage = lazy(() => import("@/pages/TalentPage"));
const LivePage = lazy(() => import("@/pages/LivePage"));
const LiveDirectoryPage = lazy(() => import("@/pages/LiveDirectoryPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const ChangePasswordPage = lazy(() => import("@/pages/ChangePasswordPage"));
const WatchlistPage = lazy(() => import("@/pages/WatchlistPage"));
const PricingPage = lazy(() => import("@/pages/PricingPage"));

// Admin pages
const AdminDashboard = lazy(() => import("@/pages/admin/DashboardPage"));
const AdminVideos = lazy(() => import("@/pages/admin/VideosPage"));
const AdminCategories = lazy(() => import("@/pages/admin/CategoriesPage"));
const AdminTalents = lazy(() => import("@/pages/admin/TalentsPage"));
const AdminSeries = lazy(() => import("@/pages/admin/SeriesPage"));
const AdminLive = lazy(() => import("@/pages/admin/LivePage"));
const AdminUsers = lazy(() => import("@/pages/admin/UsersPage"));
const AdminTenants = lazy(() => import("@/pages/admin/TenantsPage"));
const AdminSubscriptions = lazy(() => import("@/pages/admin/SubscriptionsPage"));
const AdminCompetitions = lazy(() => import("@/pages/admin/CompetitionsPage"));
const AdminEvents = lazy(() => import("@/pages/admin/EventsPage"));
const AdminAISettings = lazy(() => import("@/pages/admin/AISettingsPage"));

function PageLoader() {
  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-white" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Watch page — no navbar, full-screen player */}
        <Route path="/watch/:id" element={<WatchPage />} />

        {/* Public routes */}
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/browse" element={<BrowsePage />} />
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

        {/* 404 catch-all */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
