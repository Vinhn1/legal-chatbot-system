"use client";

import { useContext } from "react";
import { Toaster as Sonner } from "sonner";
// Kiểu cấu hình của bộ thông báo được tách khỏi giá trị runtime.
import type { ToasterProps } from "sonner";
import { ThemeContext } from "../../context/theme-state";

const Toaster = ({ ...props }: ToasterProps) => {
  // Đồng bộ với giao diện thực tế của ứng dụng: chỉ tối khi đang ở khu vực quản trị.
  const theme = useContext(ThemeContext)?.applied ?? "light";

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
