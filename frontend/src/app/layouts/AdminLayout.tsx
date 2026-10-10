import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  BarChart3,
  ExternalLink,
  Files,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Sun,
  Laptop,
  UserRound,
  Users,
  MessageSquare,
  MessagesSquare,
  Settings,
  UploadCloud,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { LegalLogo } from "../components/LegalLogo";
import { useTheme } from "../context/useTheme";

/**
 * Khung giao diện Quản trị Veritas Legal — Chuẩn Canvas Variant 03
 * Thanh bên (Sidebar) cố định bên trái, Header cố định, và vùng làm việc đa năng
 * Hỗ trợ chuyển đổi drawer trên Tablet và Mobile
 */
export function AdminLayout() {
  const { user, logout } = useAuth();
  const { mode, setMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Danh mục điều hướng theo Canvas Section 7 & 8
  const navItems = [
    { to: "/admin", label: "Tổng quan", icon: LayoutDashboard, end: true },
    { to: "/admin/documents", label: "Tài liệu", icon: Files, end: false },
    { to: "/admin/ingest", label: "Nạp tài liệu", icon: UploadCloud, end: false },
    { to: "/admin/chat", label: "Thử chatbot", icon: MessageSquare, end: false },
    { to: "/admin/conversations", label: "Cuộc hội thoại", icon: MessagesSquare, end: false },
    { to: "/admin/analytics", label: "Thống kê", icon: BarChart3, end: false },
    ...(user?.role === "admin" ? [{ to: "/admin/users", label: "Người dùng", icon: Users, end: false }] : []),
    { to: "/admin/settings", label: "Cài đặt", icon: Settings, end: false },
  ];

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  // Xác định tiêu đề trang hiện tại
  const currentNav = navItems.find((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
  );
  const currentTitle = location.pathname === "/admin/profile" ? "Hồ sơ cá nhân" : currentNav?.label || "Tổng quan";
  const isChatPlayground = location.pathname === "/admin/chat";

  return (
    <div className="admin-shell flex h-screen w-full overflow-hidden bg-[#faf9f6] text-[#142747] antialiased dark:bg-slate-900 dark:text-slate-100">
      {/* Sidebar Desktop */}
      <aside className="hidden w-[230px] shrink-0 border-r border-[#d8dee5] bg-[#f8f8f6] dark:border-slate-800 dark:bg-slate-900 flex-col justify-between p-4 md:flex h-full overflow-y-auto board-scroll">
        <div>
          {/* Logo Veritas Legal */}
          <Link
            to="/admin"
            className="flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-white/80 transition-colors"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#142747] text-white shadow-xs">
              <LegalLogo size={18} className="text-[#f6efe2]" />
            </div>
            <div className="flex flex-col justify-center">
              <div className="text-sm font-bold leading-tight tracking-tight text-[#142747]">
                Veritas <span className="font-medium text-[#56677c]">Legal</span>
              </div>
              <div className="text-[10px] uppercase leading-tight tracking-[0.16em] text-[#8b795f] font-bold mt-0.5">
                Cổng quản trị
              </div>
            </div>
          </Link>

          {/* Tiêu đề nhóm */}
          <div className="mt-6 px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#8a785d]">
            VẬN HÀNH
          </div>

          {/* Danh mục điều hướng */}
          <nav className="mt-3 space-y-1.5" aria-label="Điều hướng quản trị">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                    isActive
                      ? "bg-[#e9f0f7] text-[#1d4f88] shadow-2xs"
                      : "text-[#516278] hover:bg-white hover:text-[#142747]"
                  }`
                }
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* User Profile & Logout Bottom Box */}
        <div className="border-t border-[#d8dee5] pt-4">
          <div className="flex items-center justify-between px-2">
            <Link to="/admin/profile" className="flex items-center gap-2.5 min-w-0" aria-label="Hồ sơ cá nhân">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#142747] text-xs font-bold text-white uppercase">
                {user?.name ? user.name.slice(0, 2) : "AD"}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#142747] truncate">
                  {user?.name || "Quản trị viên"}
                </div>
                <div className="text-[10px] font-semibold text-[#718294] uppercase">
                  {user?.role === "admin" ? "Toàn quyền Admin" : "Chuyên viên pháp lý"}
                </div>
              </div>
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              title="Đăng xuất khỏi hệ thống"
              className="rounded-lg p-2 text-[#718294] hover:bg-white hover:text-rose-700 transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer Backdrop & Sidebar */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="presentation">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="relative flex w-[260px] flex-col justify-between bg-[#f8f8f6] dark:bg-slate-900 p-5 shadow-2xl z-10 animate-fade-in-up">
            <div>
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#142747] text-white">
                    <LegalLogo size={16} className="text-[#f6efe2]" />
                  </div>
                  <span className="text-sm font-bold text-[#142747]">Veritas Legal</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200"
                >
                  <X size={18} />
                </button>
              </div>

              <nav className="mt-5 space-y-1.5">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold transition-colors ${
                        isActive ? "bg-[#e9f0f7] text-[#1d4f88]" : "text-[#516278] hover:bg-white"
                      }`
                    }
                  >
                    <item.icon size={18} />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </nav>
            </div>

            <div className="border-t border-slate-200 pt-4 flex items-center justify-between">
              <Link to="/admin/profile" onClick={() => setMobileSidebarOpen(false)} className="text-xs font-bold text-[#142747] dark:text-slate-100">{user?.name || "Admin"}</Link>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1 text-xs font-bold text-rose-700"
              >
                <LogOut size={14} /> Đăng xuất
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        {/* Top Header Bar */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#d8dee5] bg-white/95 dark:border-slate-800 dark:bg-slate-900/95 px-5 backdrop-blur-md sm:px-8 z-30">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Mở menu quản trị"
              className="rounded-lg border border-[#cbd5df] p-2 text-[#142747] hover:bg-slate-100 md:hidden"
            >
              <Menu size={19} />
            </button>
            <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-[#66778c]">
              <span>Admin</span>
              <span>/</span>
              <span className="font-bold text-[#142747]">{currentTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMode(mode === "light" ? "dark" : mode === "dark" ? "system" : "light")}
              aria-label={`Chế độ giao diện: ${mode}. Bấm để chuyển`} title={`Giao diện: ${mode}`}
              className="rounded-xl border border-[#cbd5df] p-2 text-[#142747] dark:border-slate-700 dark:text-slate-100">
              {mode === "dark" ? <Moon size={17} /> : mode === "system" ? <Laptop size={17} /> : <Sun size={17} />}
            </button>
            <Link to="/admin/profile" aria-label="Hồ sơ cá nhân" className="rounded-xl border border-[#cbd5df] p-2 dark:border-slate-700"><UserRound size={17} /></Link>
            <Link
              to="/"
              target="_blank"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-[#cbd5df] bg-white px-3.5 py-1.5 text-xs font-bold text-[#516278] hover:bg-slate-50"
            >
              Xem Cổng công khai <ExternalLink size={13} />
            </Link>
            <span className="rounded-full bg-[#f4eddf] px-3 py-1 text-xs font-bold text-[#80643c]">
              {user?.role === "admin" ? "Quản trị viên" : "Chuyên viên"}
            </span>
          </div>
        </header>

        {/* Trang thử chatbot khóa cuộn ngoài; các trang khác vẫn cuộn theo nội dung. */}
        <main className={`min-h-0 flex-1 p-5 sm:p-8 min-w-0 board-scroll ${isChatPlayground ? "overflow-hidden" : "overflow-y-auto"}`}>
          <div className={`max-w-7xl mx-auto w-full ${isChatPlayground ? "h-full min-h-0" : "pb-16"}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
