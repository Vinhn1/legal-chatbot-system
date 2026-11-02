import { useEffect, useState, type ReactNode } from "react";
import { ThemeContext, type ThemeMode } from "./theme-state";

const STORAGE_KEY = "veritas_theme_mode";

/**
 * Lưu lựa chọn giao diện của người dùng và chỉ áp dụng chế độ tối khi khu vực quản trị đang hiển thị.
 * Các trang công khai (landing, đăng nhập, quên mật khẩu, widget nhúng) luôn giữ giao diện sáng.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  // Chỉ AdminLayout bật cờ này; mặc định tắt để trang công khai không bao giờ nhận class dark.
  const [darkScopeActive, setDarkScopeActive] = useState(false);
  const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  // Đảm bảo chế độ tối CHỈ có thể kích hoạt khi đang thực sự ở trong phân vùng /admin
  const onAdminRoute = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
  const applied = darkScopeActive && onAdminRoute && resolved === "dark" ? "dark" : "light";

  useEffect(() => {
    const checkRoute = () => {
      const onAdmin = window.location.pathname.startsWith("/admin");
      if (!onAdmin) {
        setDarkScopeActive(false);
      }
    };
    window.addEventListener("popstate", checkRoute);
    return () => window.removeEventListener("popstate", checkRoute);
  }, []);

  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);
  useEffect(() => {
    // Gắn class trên thẻ html để cả nội dung render qua portal (modal, dropdown, toast) cũng đồng bộ.
    const root = document.documentElement;
    root.classList.toggle("dark", applied === "dark");
    root.style.colorScheme = applied;
  }, [applied]);

  return (
    <ThemeContext.Provider value={{ mode, setMode, resolved, applied, setDarkScopeActive }}>
      {children}
    </ThemeContext.Provider>
  );
}
