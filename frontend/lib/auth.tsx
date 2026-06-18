"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, User, clearToken, getToken } from "./api";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (perm: string) => boolean;
  isProductionRole: boolean;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (getToken()) {
      api.getCurrentUser()
        .then((r) => setUser(r.user))
        .catch(() => clearToken())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  async function login(username: string, password: string) {
    const r = await api.login(username, password);
    setUser(r.user);
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  const PRODUCTION_ROLES = ["operator_smd", "montažnik", "operator_3d", "operator_engraving"];

  function hasPermission(perm: string) {
    if (!user) return false;
    if (user.role === "admin") return true;
    return user.user_permissions?.[perm] === true;
  }

  const isProductionRole = !!user && PRODUCTION_ROLES.includes(user.role);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission, isProductionRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
