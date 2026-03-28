import { create } from "zustand";
import type { TenantConfig } from "@/types/api";
import { api } from "@/api/client";

interface TenantState {
  config: TenantConfig | null;
  loading: boolean;
  error: string | null;
  loadConfig: () => Promise<void>;
}

export const useTenantStore = create<TenantState>((set) => ({
  config: null,
  loading: true,
  error: null,
  loadConfig: async () => {
    try {
      set({ loading: true, error: null });
      const config = await api.get<TenantConfig>("/tenant/config");
      set({ config, loading: false });

      // Apply tenant branding as CSS variables
      document.documentElement.style.setProperty("--primary", config.primary_color);
      document.documentElement.style.setProperty("--secondary", config.secondary_color);
      document.documentElement.style.setProperty("--background", config.background_color);
      if (config.site_name) document.title = config.site_name;
    } catch {
      set({ error: "Failed to load site configuration", loading: false });
    }
  },
}));
