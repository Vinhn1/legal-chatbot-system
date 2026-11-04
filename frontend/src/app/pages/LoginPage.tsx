import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, Link, useSearchParams } from "react-router";
import { Lock, Eye, EyeOff, ArrowRight, ChevronLeft, Mail, Shield, KeyRound, ShieldCheck, FileSearch } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/useTheme";
import { LegalLogo } from "../components/LegalLogo";

/**
 * 6 Ô nhập mã OTP cho bước xác thực 2 lớp (2FA)
 */
function OTPBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2 sm:gap-3 justify-center my-2">
      {Array(6)
        .fill("")
        .map((_, i) => (
          <input
            key={i}
            id={`otp-box-${i}`}
            aria-label={`Chữ số OTP thứ ${i + 1}`}
            maxLength={1}
            value={value[i] || ""}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/, "");
              const digits = value.split("");
              digits[i] = val;
              const nextVal = digits.join("").slice(0, 6);
              onChange(nextVal);
              if (val && i < 5) {
                document.getElementById(`otp-box-${i + 1}`)?.focus();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !value[i] && i > 0) {
                document.getElementById(`otp-box-${i - 1}`)?.focus();
              }
            }}
            className={`w-11 h-14 sm:w-12 sm:h-16 rounded-xl text-center text-xl sm:text-2xl font-bold outline-none transition-all duration-200 ${
              value[i]
                ? "bg-[#eef4f9] border-2 border-[#1d4f88] text-[#142747]"
                : "bg-[#f8f9fa] border border-[#cbd5df] text-[#142747] focus:border-[#1d4f88] focus:bg-white focus:ring-2 focus:ring-[#1d4f88]/20"
            }`}
          />
        ))}
    </div>
  );
}

/**
 * Trang Đăng nhập Veritas Legal — Chuẩn thiết kế Canvas Variant 03
 * Đảm bảo font chữ to, rõ ràng, hiển thị tối ưu trên Desktop và Mobile
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isSessionExpired = searchParams.get("reason") === "expired";
  const { login, verify2faLogin } = useAuth();
  const { setDarkScopeActive } = useTheme();

  // Đảm bảo trang đăng nhập luôn luôn giữ giao diện sáng tiêu chuẩn
  useEffect(() => {
    setDarkScopeActive(false);
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
  }, [setDarkScopeActive]);

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // 2FA state
  const [is2faRequired, setIs2faRequired] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [otp, setOtp] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  /** Xử lý gửi biểu mẫu đăng nhập */
  const handleLogin = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!id.trim() || !pw) {
      setError("Vui lòng nhập đầy đủ tài khoản và mật khẩu.");
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      const role = await login(id.trim(), pw);
      setIsLoading(false);
      if (role === "admin" || role === "staff") {
        navigate("/admin");
      } else if (role === "require_2fa") {
        setLoginId(id.trim());
        setIs2faRequired(true);
      } else if (role === "rate_limited") {
        setError("Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.");
      } else if (role === "server_error") {
        setError("Dịch vụ xác thực đang bận hoặc chưa sẵn sàng. Vui lòng thử lại sau.");
      } else {
        setError("Thông tin đăng nhập chưa chính xác. Vui lòng kiểm tra lại.");
      }
    } catch {
      setIsLoading(false);
      setError("Không thể kết nối đến máy chủ xác thực.");
    }
  };

  /** Xử lý xác thực OTP 2FA */
  const handleVerify2fa = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (otp.length !== 6) {
      setError("Vui lòng nhập đủ 6 chữ số mã OTP.");
      return;
    }
    setIsVerifying(true);
    setError("");
    try {
      const role = await verify2faLogin(loginId, otp);
      if (role === "admin" || role === "staff") {
        navigate("/admin");
      } else {
        setError("Mã OTP không chính xác hoặc đã hết hiệu lực.");
        setIsVerifying(false);
      }
    } catch {
      setIsVerifying(false);
      setError("Lỗi xác thực OTP. Vui lòng thử lại.");
    }
  };

  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#142747] flex flex-col justify-between antialiased">
      {/* Top Navbar Back Link */}
      <header className="border-b border-[#ccd4dd] bg-[#faf9f6] px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-bold text-[#142747] hover:text-[#1d4f88] transition-colors focus-visible:outline-2 focus-visible:outline-[#1d4f88] rounded-lg p-1"
          >
            <ChevronLeft size={18} />
            <span>Về trang chủ</span>
          </Link>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#66778c]">
            <FileSearch size={16} className="text-[#a17842]" />
            <span>Veritas DocAI · Cổng xác thực an toàn</span>
          </div>
        </div>
      </header>

      {/* Main Content: 2 Columns according to Canvas Section 6 */}
      <main className="flex-1 flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-5xl grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center">
          {/* Cột trái: Thông tin nhận diện & chính sách bảo mật */}
          <div className="flex flex-col justify-center">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#8a785d]">
              CỔNG QUẢN TRỊ NỘI BỘ
            </div>
            <h1 className="font-editorial mt-3 text-3xl sm:text-4xl lg:text-5xl font-semibold leading-tight text-[#172c4a]">
              Một lối vào rõ ràng cho người vận hành.
            </h1>
            <p className="mt-4 text-base sm:text-lg leading-relaxed text-[#56677c]">
              Dành riêng cho Quản trị viên và Chuyên viên vận hành hệ thống. Hệ thống bảo vệ dữ liệu với phân quyền nghiêm ngặt và cơ chế xác thực hai lớp bảo mật.
            </p>

            <div className="mt-8 flex flex-wrap gap-3 text-xs sm:text-sm text-[#4d5e72]">
              <span className="inline-flex items-center gap-2 rounded-xl border border-[#d5dce2] bg-white px-4 py-2.5 shadow-2xs font-semibold">
                <KeyRound size={17} className="text-[#1d4f88]" />
                Phân quyền Quản trị & Chuyên viên
              </span>
              <span className="inline-flex items-center gap-2 rounded-xl border border-[#d5dce2] bg-white px-4 py-2.5 shadow-2xs font-semibold">
                <ShieldCheck size={17} className="text-[#2f7560]" />
                Bảo vệ xác thực hai lớp
              </span>
            </div>

            <div className="mt-8 border-l-2 border-[#c29a5b] pl-4 text-xs sm:text-sm text-[#738196] leading-relaxed">
              Mọi lượt truy cập quản trị đều được ghi nhật ký an ninh. Nghiêm cấm chia sẻ tài khoản vận hành ra bên ngoài.
            </div>
          </div>

          {/* Cột phải: Thẻ Form Đăng Nhập / 2FA */}
          <div className="w-full max-w-[420px] mx-auto rounded-2xl border border-[#d3dbe4] bg-white p-6 sm:p-8 shadow-[0_20px_50px_-25px_rgba(20,42,72,.25)] animate-fade-in-up">
            {/* Header Thẻ */}
            <div className="mb-6 flex items-center gap-3 border-b border-[#eef1f4] pb-5">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#142747] text-white shadow-xs">
                <LegalLogo size={20} className="text-[#f6efe2]" />
              </div>
              <div>
                <div className="text-base font-bold text-[#142747]">Veritas DocAI</div>
                <div className="text-xs text-[#718294]">
                  {is2faRequired ? "Bước 2 · Xác thực OTP" : "Không gian đăng nhập quản trị"}
                </div>
              </div>
            </div>

            {/* Bước 2FA */}
            {is2faRequired ? (
              <form onSubmit={handleVerify2fa} className="flex flex-col gap-4">
                <div className="text-center mb-1">
                  <div className="w-12 h-12 rounded-2xl bg-[#eef4f9] border border-[#c9d8e9] flex items-center justify-center mx-auto mb-2 text-[#1d4f88]">
                    <Shield size={24} />
                  </div>
                  <h2 className="font-editorial text-xl font-bold text-[#142747]">Xác thực hai lớp</h2>
                  <p className="text-xs text-[#5e6f82] mt-1">
                    Nhập mã xác thực 6 chữ số đã được gửi tới tài khoản của bạn.
                  </p>
                </div>

                <OTPBoxes value={otp} onChange={setOtp} />

                {error && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#efc7bd] bg-[#fff6f3] px-3.5 py-2.5 text-xs font-semibold text-[#a14f41]"
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={otp.length !== 6 || isVerifying}
                  className="mt-2 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#1d4f88] text-sm font-bold text-white shadow-sm transition-[background-color,transform] hover:bg-[#153b66] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isVerifying ? "Đang kiểm tra OTP..." : "Xác thực OTP"} <ArrowRight size={17} />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIs2faRequired(false);
                    setOtp("");
                    setError("");
                  }}
                  className="mt-2 text-center text-xs font-bold text-[#56677c] hover:text-[#1d4f88] transition-colors"
                >
                  Quay lại bước đăng nhập
                </button>
              </form>
            ) : (
              /* Bước đăng nhập thông thường */
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                {/* Thông báo tự động logout khi phiên làm việc hết hạn */}
                {isSessionExpired && !error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs font-semibold text-amber-900 leading-relaxed"
                  >
                    <Lock size={15} className="text-amber-700 shrink-0 mt-0.5" />
                    <span>Phiên làm việc đã hết hạn để đảm bảo an toàn. Hệ thống đã tự động đăng xuất, vui lòng đăng nhập lại.</span>
                  </div>
                )}

                {/* Trường tài khoản */}
                <div>
                  <label htmlFor="login-username" className="block text-xs sm:text-sm font-bold text-[#35485e] mb-1.5">
                    Email hoặc tên đăng nhập
                  </label>
                  <div className="flex h-13 items-center gap-3 rounded-xl border border-[#cbd5df] bg-[#fcfcfb] px-3.5 focus-within:border-[#1d4f88] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#1d4f88]/20 transition-all">
                    <Mail size={18} className="text-[#7c8b9d] shrink-0" />
                    <input
                      id="login-username"
                      type="text"
                      placeholder="ten@donvi.vn hoặc admin"
                      value={id}
                      onChange={(e) => {
                        setId(e.target.value);
                        setError("");
                      }}
                      className="w-full bg-transparent text-sm sm:text-base font-semibold text-[#142747] outline-none placeholder:text-[#9aa5b2]"
                    />
                  </div>
                </div>

                {/* Trường mật khẩu */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="block text-xs sm:text-sm font-bold text-[#35485e]">
                      Mật khẩu
                    </label>
                    <Link
                      to="/forgot-password"
                      className="text-xs font-bold text-[#1d4f88] hover:underline"
                    >
                      Quên mật khẩu?
                    </Link>
                  </div>
                  <div className="flex h-13 items-center justify-between gap-3 rounded-xl border border-[#cbd5df] bg-[#fcfcfb] px-3.5 focus-within:border-[#1d4f88] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#1d4f88]/20 transition-all">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Lock size={18} className="text-[#7c8b9d] shrink-0" />
                      <input
                        id="login-password"
                        type={showPw ? "text" : "password"}
                        placeholder="Nhập mật khẩu"
                        value={pw}
                        onChange={(e) => {
                          setPw(e.target.value);
                          setError("");
                        }}
                        className="w-full bg-transparent text-sm sm:text-base font-semibold text-[#142747] outline-none placeholder:text-[#9aa5b2]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPw((p) => !p)}
                      aria-label={showPw ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                      className="text-[#7c8b9d] hover:text-[#142747] transition-colors p-1"
                    >
                      {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {/* Thông báo lỗi validation */}
                {error && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#efc7bd] bg-[#fff6f3] px-3.5 py-2.5 text-xs font-semibold text-[#a14f41] animate-fade-in-up"
                  >
                    {error}
                  </div>
                )}

                {/* Nút gửi */}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="mt-2 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#1d4f88] text-sm sm:text-base font-bold text-white shadow-sm transition-[background-color,transform] hover:bg-[#153b66] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
                >
                  {isLoading ? "Đang xác thực..." : "Đăng nhập hệ thống"} {!isLoading && <ArrowRight size={18} />}
                </button>

                {/* Khu vực truy cập tài khoản dùng thử nhanh */}
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3.5 text-center">
                  <div className="text-xs font-bold text-[#1d4f88]">
                    Bạn muốn thử nghiệm các tính năng?
                  </div>
                  <p className="mt-1 text-[11px] text-[#56677c]">
                    Sử dụng các tài khoản demo được cấp sẵn để trải nghiệm toàn diện hệ thống.
                  </p>
                  <Link
                    to="/demo-accounts"
                    className="mt-2.5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-[#1d4f88]/30 bg-white text-xs font-bold text-[#1d4f88] hover:bg-blue-50 transition-colors shadow-2xs"
                  >
                    <KeyRound size={13} />
                    <span>Xem danh sách tài khoản thử nghiệm</span>
                    <ArrowRight size={13} />
                  </Link>
                </div>
              </form>
            )}

            <div className="mt-5 border-t border-[#f0f2f5] pt-4 text-center text-xs text-[#8291a1]">
              Mẫu chuẩn hóa Veritas Design · Focus viền nổi 2px
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#ccd4dd] bg-[#faf9f6] py-5 px-5 text-center text-xs text-[#718294]">
        © 2026 Veritas DocAI · Hệ thống tra cứu & phân tích văn bản thông minh
      </footer>
    </div>
  );
}
