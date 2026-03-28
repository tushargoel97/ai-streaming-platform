import { create } from "zustand";
import type { User, AuthTokens } from "@/types/api";
import { api } from "@/api/client";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  register: (email: string, username: string, password: string, displayName?: string) => Promise<void>;
  login: (identifier: string, credential: string, method: "password" | "otp") => Promise<void>;
  requestOtp: (identifier: string) => Promise<void>;
  logout: () => void;
  setTokens: (tokens: AuthTokens) => void;
  loadUser: () => Promise<void>;
  updateProfile: (data: { username?: string; display_name?: string; avatar_url?: string }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, _get) => ({
  user: null,
  isAuthenticated: !!localStorage.getItem("access_token"),
  loading: false,

  register: async (email, username, password, displayName) => {
    set({ loading: true });
    try {
      const tokens = await api.post<AuthTokens>("/auth/register", {
        email,
        username,
        password,
        display_name: displayName || username,
      });
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
      set({ isAuthenticated: true, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  login: async (identifier, credential, method) => {
    set({ loading: true });
    try {
      const body: Record<string, string> = { identifier };
      if (method === "otp") {
        body.otp = credential;
      } else {
        body.password = credential;
      }
      const tokens = await api.post<AuthTokens>("/auth/login", body);
      localStorage.setItem("access_token", tokens.access_token);
      localStorage.setItem("refresh_token", tokens.refresh_token);
      set({ isAuthenticated: true, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  requestOtp: async (identifier) => {
    await api.post("/auth/otp/request", { identifier });
  },

  logout: () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    set({ user: null, isAuthenticated: false });
  },

  setTokens: (tokens) => {
    localStorage.setItem("access_token", tokens.access_token);
    localStorage.setItem("refresh_token", tokens.refresh_token);
    set({ isAuthenticated: true });
  },

  loadUser: async () => {
    set({ loading: true });
    try {
      const user = await api.get<User>("/auth/me");
      set({ user, isAuthenticated: true, loading: false });
    } catch {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      set({ user: null, isAuthenticated: false, loading: false });
    }
  },

  updateProfile: async (data) => {
    const user = await api.patch<User>("/auth/me", data);
    set({ user });
  },

  changePassword: async (currentPassword, newPassword) => {
    await api.post("/auth/changePassword", {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },
}));
