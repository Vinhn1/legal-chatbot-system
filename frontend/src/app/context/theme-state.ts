import { createContext } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Giao diện người dùng đã chọn cho khu vực quản trị (đã quy đổi chế độ hệ thống). */
  resolved: "light" | "dark";
  /** Giao diện thực sự đang hiển thị: chỉ là "dark" khi đang ở khu vực quản trị. */
  applied: "light" | "dark";
  /** Khu vực quản trị đăng ký/hủy phạm vi cho phép áp dụng chế độ tối. */
  setDarkScopeActive: (active: boolean) => void;
};

/** Giá trị ngữ cảnh dùng chung cho bộ cấp giao diện và hook. */
export const ThemeContext = createContext<ThemeContextValue | null>(null);
