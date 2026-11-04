import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import axios from "axios";
import { API_BASE } from "../../config";

export type AuthRole = "admin" | "staff";
export type AuthUser = {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: AuthRole;
  avatar?: string;
  address: string;
  dob: string;
  twoFaEnabled?: boolean;
};
type LoginResult = AuthRole | "require_2fa" | "invalid_credentials" | "rate_limited" | "server_error" | "error";
type AuthContextType = {
  user: AuthUser | null;
  token: string | null;
  login: (identifier: string, password: string) => Promise<LoginResult>;
  demoLogin: (role: "admin" | "staff" | "viewer") => Promise<AuthRole | "error">;
  verify2faLogin: (username: string, otpCode: string) => Promise<AuthRole | "error">;
  logout: () => void;
  updateUser: (patch: Partial<AuthUser>) => void;
};

const TOKEN_KEY = "legal_admin_token";
const USER_KEY = "legal_admin_user";
const AuthContext = createContext<AuthContextType>({
  user: null, token: null, login: async () => "error",
  demoLogin: async () => "error",
  verify2faLogin: async () => "error", logout: () => {}, updateUser: () => {},
});

function mapUser(data: any): AuthUser {
  return {
    id: String(data.id),
    name: data.name || "Người dùng",
    phone: data.phone || "",
    email: data.email || "",
    role: data.role === "staff" ? "staff" : "admin",
    address: data.address || "",
    dob: data.dob || "",
    avatar: data.avatar || undefined,
    twoFaEnabled: Boolean(data.twoFaEnabled),
  };
}

function parseJwtPayload(tokenStr: string): { exp?: number; [key: string]: any } | null {
  try {
    const parts = tokenStr.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

function isTokenExpired(tokenStr: string | null): boolean {
  if (!tokenStr) return true;
  const payload = parseJwtPayload(tokenStr);
  if (!payload || typeof payload.exp !== "number") return true;
  // Trừ hao 5 giây phòng ngừa độ lệch đồng hồ giữa client và server
  return payload.exp * 1000 <= Date.now() + 5000;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Challenge chỉ tồn tại trong bộ nhớ của bước đăng nhập hiện tại.
  const loginChallenge = useRef<string | null>(null);
  // Khởi tạo state: kiểm tra ngay xem token đã lưu có còn hạn hay không
  const [token, setToken] = useState<string | null>(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved || isTokenExpired(saved)) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    }
    return saved;
  });

  const [user, setUser] = useState<AuthUser | null>(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (!savedToken || isTokenExpired(savedToken)) {
      return null;
    }
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  });

  // Hàm tự động đăng xuất khi phiên làm việc hết hạn
  const handleAutoLogout = (reason = "expired") => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    // Nếu đang đứng trong khu vực admin, tự động điều hướng về màn hình đăng nhập
    if (window.location.pathname.startsWith("/admin")) {
      window.location.href = `/login?reason=${reason}`;
    }
  };

  function logout() {
    const currentToken = localStorage.getItem(TOKEN_KEY);
    // Login đợi thu hồi phiên cũ để tránh vô hiệu hóa JWT vừa được cấp do request chạy lệch thứ tự.
    const revoke = currentToken && !isTokenExpired(currentToken)
      ? fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${currentToken}` }, keepalive: true, signal: AbortSignal.timeout(5000) }).catch(() => undefined)
      : Promise.resolve();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    return revoke.then(() => undefined);
  }

  // 1. Theo dõi chủ động hạn sử dụng của JWT Token
  useEffect(() => {
    if (!token) return;

    const payload = parseJwtPayload(token);
    if (!payload || typeof payload.exp !== "number") {
      handleAutoLogout("invalid");
      return;
    }

    const remainingMs = payload.exp * 1000 - Date.now();
    if (remainingMs <= 0) {
      handleAutoLogout("expired");
      return;
    }

    // Tự động kích hoạt logout đúng vào thời điểm JWT hết hạn
    const timer = setTimeout(() => {
      handleAutoLogout("expired");
    }, remainingMs);

    // Kiểm tra định kỳ mỗi 10 giây
    const interval = setInterval(() => {
      const curToken = localStorage.getItem(TOKEN_KEY);
      if (isTokenExpired(curToken)) {
        handleAutoLogout("expired");
      }
    }, 10000);

    // Kiểm tra ngay khi người dùng quay lại tab hoặc mở lại màn hình máy tính
    const checkOnActive = () => {
      if (document.visibilityState === "visible") {
        const curToken = localStorage.getItem(TOKEN_KEY);
        if (isTokenExpired(curToken)) {
          handleAutoLogout("expired");
        }
      }
    };
    document.addEventListener("visibilitychange", checkOnActive);
    window.addEventListener("focus", checkOnActive);

    // Đồng bộ trạng thái đăng xuất giữa các tab đang mở
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY && !e.newValue) {
        logout();
        if (window.location.pathname.startsWith("/admin")) {
          window.location.href = "/login?reason=expired";
        }
      }
    };
    window.addEventListener("storage", handleStorageChange);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkOnActive);
      window.removeEventListener("focus", checkOnActive);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [token]);

  // 2. Interceptor xử lý request và response cho Axios
  useEffect(() => {
    // Interceptor gắn kèm JWT token vào mọi request gửi đi
    const reqInterceptor = axios.interceptors.request.use(config => {
      const saved = localStorage.getItem(TOKEN_KEY);
      if (saved) {
        // Kiểm tra trước khi gửi: nếu token đã hết hạn, tự động logout và chặn request
        if (isTokenExpired(saved)) {
          handleAutoLogout("expired");
          return Promise.reject(new Error("Phiên làm việc đã hết hạn."));
        }
        config.headers.Authorization = `Bearer ${saved}`;
      }
      return config;
    });

    // Interceptor bắt lỗi 401 khi token bị vô hiệu hóa hoặc hết hạn từ phía backend
    const resInterceptor = axios.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 401) {
          const url = error.config?.url || "";
          if (!url.includes("/auth/login") && !url.includes("/auth/verify-2fa")) {
            handleAutoLogout("expired");
          }
        }
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.request.eject(reqInterceptor);
      axios.interceptors.response.eject(resInterceptor);
    };
  }, []);

  function acceptLogin(data: any): AuthRole | "error" {
    if (!data?.access_token || !data?.user) return "error";
    const mapped = mapUser(data.user);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(mapped));
    setToken(data.access_token);
    setUser(mapped);
    return mapped.role;
  }

  async function login(identifier: string, password: string): Promise<LoginResult> {
    await logout();
    loginChallenge.current = null;
    try {
      const response = await axios.post(`${API_BASE}/auth/login`, {
        username: identifier.trim(), password,
      });
      if (response.data?.require2fa) { loginChallenge.current = response.data.challengeId; return "require_2fa"; }
      return acceptLogin(response.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 401) return "invalid_credentials";
        if (err.response?.status === 429) return "rate_limited";
        if (err.response && err.response.status >= 500) return "server_error";
      }
      return "error";
    }
  }

  async function demoLogin(role: "admin" | "staff" | "viewer"): Promise<AuthRole | "error"> {
    await logout();
    loginChallenge.current = null;
    try {
      const response = await axios.post(`${API_BASE}/auth/demo-login`, { role });
      return acceptLogin(response.data);
    } catch {
      return "error";
    }
  }

  async function verify2faLogin(username: string, otpCode: string): Promise<AuthRole | "error"> {
    try {
      const response = await axios.post(`${API_BASE}/auth/verify-2fa`, { username, otpCode, challengeId: loginChallenge.current });
      return acceptLogin(response.data);
    } catch { return "error"; }
  }

  function updateUser(patch: Partial<AuthUser>) {
    setUser(previous => {
      if (!previous) return null;
      const updated = { ...previous, ...patch };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  return <AuthContext.Provider value={{ user, token, login, demoLogin, verify2faLogin, logout, updateUser }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
