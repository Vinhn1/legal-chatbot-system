import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { Shield, Users, FileSearch, ArrowRight, CheckCircle2, Sparkles, ChevronLeft, Loader2, KeyRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { LegalLogo } from "../components/LegalLogo";

interface DemoRoleConfig {
  id: "admin" | "staff" | "viewer";
  title: string;
  roleBadge: string;
  badgeColor: string;
  description: string;
  username: string;
  targetPath: string;
  features: string[];
  buttonText: string;
  buttonClass: string;
}

const DEMO_ROLES: DemoRoleConfig[] = [
  {
    id: "admin",
    title: "Quản trị viên (Admin)",
    roleBadge: "Toàn quyền quản trị",
    badgeColor: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800",
    description: "Trải nghiệm bảng điều khiển trung tâm với đầy đủ quyền cấu hình hệ thống, quản lý tài liệu và giám sát vận hành.",
    username: "demo_admin",
    targetPath: "/admin",
    features: [
      "Quản lý kho văn bản: Nạp file, dán text, nạp URL",
      "Xóa tài liệu tức thì và xóa đồng loạt nhiều mục",
      "Cấu hình tham số AI (Temperature, Top-K, Chunks)",
      "Quản lý danh sách người dùng và phân quyền",
      "Theo dõi thống kê hội thoại và nhật ký audit",
    ],
    buttonText: "1-Click Đăng nhập Admin",
    buttonClass: "bg-[#1d4f88] hover:bg-[#153b66] text-white shadow-sm",
  },
  {
    id: "staff",
    title: "Biên tập viên (Staff)",
    roleBadge: "Vận hành tài liệu",
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    description: "Thích hợp cho chuyên viên phụ trách nạp dữ liệu, kiểm duyệt phân đoạn văn bản và thử nghiệm độ chính xác của câu trả lời.",
    username: "demo_staff",
    targetPath: "/admin/ingest",
    features: [
      "Nạp tài liệu mới vào kho dữ liệu quy chuẩn",
      "Rà soát và chỉnh sửa tài liệu cần kiểm duyệt",
      "Kiểm tra câu trả lời và đối chiếu nguồn trích dẫn",
      "Xem chi tiết phân đoạn (chunks) đã lập chỉ mục",
    ],
    buttonText: "1-Click Đăng nhập Biên tập viên",
    buttonClass: "bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm",
  },
  {
    id: "viewer",
    title: "Khách tra cứu (Viewer)",
    roleBadge: "Trải nghiệm người dùng",
    badgeColor: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
    description: "Dành cho người dùng thông thường cần tra cứu văn bản nhanh chóng, minh bạch và có căn cứ xác thực rõ ràng.",
    username: "demo_viewer",
    targetPath: "/",
    features: [
      "Đặt câu hỏi tự nhiên không giới hạn chủ đề",
      "Nhận câu trả lời kèm thẻ trích dẫn chính xác",
      "Mở xem nguyên văn đoạn văn bản đối chiếu",
      "Kiểm tra hiệu lực pháp lý và ngày ban hành",
    ],
    buttonText: "Trải nghiệm Cổng tra cứu ngay",
    buttonClass: "bg-[#142747] hover:bg-[#0b172a] text-white shadow-sm",
  },
];

export function DemoAccountsPage() {
  const navigate = useNavigate();
  const { demoLogin } = useAuth();
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleQuickLogin = async (roleConfig: DemoRoleConfig) => {
    if (roleConfig.id === "viewer") {
      navigate("/");
      return;
    }

    setLoadingRole(roleConfig.id);
    setErrorMsg(null);
    try {
      const res = await demoLogin(roleConfig.id);
      if (res === "admin" || res === "staff") {
        navigate(roleConfig.targetPath);
      } else {
        setErrorMsg("Không thể thiết lập phiên đăng nhập thử nghiệm. Vui lòng thử lại sau.");
      }
    } catch {
      setErrorMsg("Máy chủ backend đang bận hoặc chưa sẵn sàng.");
    } finally {
      setLoadingRole(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fb] dark:bg-[#0d1117] text-[#142747] dark:text-zinc-100 flex flex-col">
      {/* Thanh điều hướng tối giản */}
      <header className="border-b border-[#e3e8ee] dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md sticky top-0 z-20 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 hover:opacity-90 transition-opacity">
            <LegalLogo size={22} showText={true} />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#1d4f88] dark:text-sky-400 hover:underline"
            >
              <span>Về màn hình Đăng nhập</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* Nội dung chính */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 sm:py-14">
        {/* Tiêu đề & Giới thiệu */}
        <div className="text-center max-w-2xl mx-auto mb-10 sm:mb-12">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 dark:bg-blue-950/50 dark:border-blue-900/60 px-3.5 py-1 text-xs font-bold text-[#1d4f88] dark:text-sky-300 mb-4">
            <KeyRound size={13} />
            <span>Môi trường thử nghiệm trực tiếp</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-[#142747] dark:text-zinc-100">
            Tài khoản Trải nghiệm Veritas DocAI
          </h1>
          <p className="mt-3 text-sm sm:text-base text-[#56677c] dark:text-zinc-400 leading-relaxed">
            Chọn một vai trò bên dưới để đăng nhập ngay chỉ với 1 cú nhấp chuột. Không yêu cầu đăng ký tài khoản hay nhập mật khẩu.
          </p>
          {errorMsg && (
            <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Lưới các thẻ tài khoản dùng thử */}
        <div className="grid gap-6 md:grid-cols-3">
          {DEMO_ROLES.map((role) => {
            const isLoading = loadingRole === role.id;
            return (
              <div
                key={role.id}
                className="flex flex-col rounded-2xl border border-[#d6dfeb] dark:border-zinc-800 bg-white dark:bg-zinc-900/90 p-6 shadow-xs hover:shadow-md transition-shadow relative overflow-hidden"
              >
                {/* Header Thẻ */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h2 className="text-lg font-bold text-[#142747] dark:text-zinc-100">
                    {role.title}
                  </h2>
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${role.badgeColor}`}>
                    {role.roleBadge}
                  </span>
                </div>

                <p className="text-xs text-[#5f7185] dark:text-zinc-400 mb-6 leading-relaxed">
                  {role.description}
                </p>

                {/* Danh sách tính năng */}
                <div className="flex-1 border-t border-[#edf2f7] dark:border-zinc-800/80 pt-4 mb-6">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#8b98a8] dark:text-zinc-500 mb-3">
                    Quyền hạn & Tính năng
                  </div>
                  <ul className="space-y-2.5">
                    {role.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-[#33475b] dark:text-zinc-300">
                        <CheckCircle2 size={14} className="shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Nút hành động */}
                <button
                  type="button"
                  disabled={Boolean(loadingRole)}
                  onClick={() => handleQuickLogin(role)}
                  className={`w-full inline-flex h-11 items-center justify-center gap-2 rounded-xl text-xs sm:text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${role.buttonClass}`}
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Đang khởi tạo phiên...</span>
                    </>
                  ) : (
                    <>
                      <span>{role.buttonText}</span>
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Khung ghi chú an toàn dữ liệu */}
        <div className="mt-12 rounded-2xl border border-[#d6dfeb] dark:border-zinc-800 bg-[#edf3fa]/60 dark:bg-zinc-900/40 p-5 sm:p-6 text-xs text-[#516377] dark:text-zinc-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-white dark:bg-zinc-800 border border-[#c9d8e9] dark:border-zinc-700 grid place-items-center shrink-0 text-[#1d4f88] dark:text-sky-400">
              <Shield size={18} />
            </div>
            <div>
              <div className="font-bold text-[#142747] dark:text-zinc-200 text-sm">Chế độ Thử nghiệm An toàn (Sandbox)</div>
              <div className="mt-0.5 text-xs">Các tài khoản dùng thử được cấu hình an toàn, không thể thay đổi mật khẩu quản trị gốc hoặc xóa dữ liệu hệ thống ngoài kho demo.</div>
            </div>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 font-bold text-[#1d4f88] dark:text-sky-400 hover:underline shrink-0"
          >
            <ChevronLeft size={14} />
            <span>Quay lại trang chủ</span>
          </Link>
        </div>
      </main>
    </div>
  );
}

