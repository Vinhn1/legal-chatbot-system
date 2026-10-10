import { createContext } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ThemeContextValue = { mode: ThemeMode; setMode: (mode: ThemeMode) => void; resolved: "light" | "dark" };

/** Giá trị ngữ cảnh dùng chung cho bộ cấp giao diện và hook. */
export const ThemeContext = createContext<ThemeContextValue | null>(null);
