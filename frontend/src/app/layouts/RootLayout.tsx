import { useEffect } from "react";
import { Outlet } from "react-router";
import { Navbar } from "../components/Navbar";
import { ChatWidget } from "../components/ChatWidget";
import { useTheme } from "../context/useTheme";

/**
 * Khung giao diện trang công khai:
 * - Giữ Navbar luôn cố định ở đỉnh màn hình (fixed header) không bao giờ bị mất đi.
 * - main được đệm khoảng trống pt-[72px] bù đắp chiều cao của header.
 * - Cuộn trang tự nhiên trên window để điều hướng section mượt mà.
 * - Tuyệt đối duy trì giao diện sáng (Light Mode), không bao giờ áp dụng Dark Mode.
 */
export function RootLayout() {
  const { setDarkScopeActive } = useTheme();

  useEffect(() => {
    setDarkScopeActive(false);
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  }, [setDarkScopeActive]);

  return (
    <div className="min-h-screen w-full bg-[#faf9f6] text-[#142747]">
      <Navbar />
      <main className="pt-[72px]">
        <Outlet />
      </main>
      <ChatWidget />
    </div>
  );
}
