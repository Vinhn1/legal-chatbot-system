import { useContext } from "react";
import { ThemeContext } from "./theme-state";

/** Truy cập chế độ giao diện từ thành phần nằm dưới ThemeProvider. */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Thiếu ThemeProvider.");
  return context;
}
