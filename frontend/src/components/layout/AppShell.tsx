import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "./Navbar";
import AgeGate from "./AgeGate";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuthStore } from "@/stores/authStore";

const AGE_VERIFIED_KEY = "age_verified";

export default function AppShell() {
  const { config, loadConfig, loading, error } = useTenantStore();
  const { isAuthenticated, user, loadUser } = useAuthStore();
  const [ageVerified, setAgeVerified] = useState(() => {
    return sessionStorage.getItem(AGE_VERIFIED_KEY) === "1";
  });

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Load user profile if authenticated but user data not yet fetched
  useEffect(() => {
    if (isAuthenticated && !user) {
      loadUser();
    }
  }, [isAuthenticated, user, loadUser]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
      </div>
    );
  }

  if (error) {
    console.warn("Tenant config failed, using defaults:", error);
  }

  // Show age gate if tenant requires it and user hasn't verified yet
  const needsAgeGate =
    config && config.age_verification !== "none" && !ageVerified;

  if (needsAgeGate) {
    return (
      <AgeGate
        config={config}
        onVerified={() => {
          sessionStorage.setItem(AGE_VERIFIED_KEY, "1");
          setAgeVerified(true);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-white">
      <Navbar />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
