import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router";
import { Lock, Eye, EyeOff, ArrowRight, CheckCircle2, ChevronLeft, Shield, Mail } from "lucide-react";
import { LegalLogo } from "../components/LegalLogo";
import axios from "axios";
import { API_BASE } from "../../config";

type Step = 1 | 2 | 3 | 4;

function BrandInput({
  icon: Icon,
  placeholder,
  type = "text",
  value,
  onChange,
}: {
  icon: React.ElementType;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const isPw = type === "password";

  return (
    <div
      className={`flex items-center bg-[#fcfcfb] border ${
        focused ? "border-[#1d4f88] ring-2 ring-[#1d4f88]/20" : "border-[#cbd5df]"
      } rounded-xl px-4 h-13 gap-3 transition-all duration-200`}
    >
      <Icon size={18} className={`shrink-0 transition-colors duration-200 ${focused ? "text-[#1d4f88]" : "text-[#7c8b9d]"}`} />
      <input
        type={isPw && !showPw ? "password" : "text"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="flex-1 bg-transparent border-none outline-none text-[#142747] text-sm sm:text-base font-semibold placeholder:text-[#9aa5b2]"
      />
      {isPw && (
        <button
          type="button"
          onClick={() => setShowPw((p) => !p)}
          className="text-[#7c8b9d] hover:text-[#142747] p-1 transition-colors"
        >
          {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      )}
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const labels = ["Email", "OTP", "Mật khẩu", "Hoàn tất"];
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                  done
                    ? "bg-emerald-600 text-white"
                    : active
                    ? "bg-[#1d4f88] text-white shadow-xs"
                    : "bg-[#eef1f4] text-[#718294] border border-[#cbd5df]"
                }`}
              >
                {done ? <CheckCircle2 size={16} /> : n}
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${
                  active ? "text-[#1d4f88]" : "text-[#718294]"
                }`}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                className={`w-8 h-[2px] mx-1 mb-4 transition-colors duration-300 ${
                  done ? "bg-emerald-600" : "bg-[#d8dee5]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OTPBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2 sm:gap-2.5 justify-center">
      {Array(6)
        .fill("")
        .map((_, i) => (
          <input
            key={i}
            maxLength={1}
            value={value[i] || ""}
            onChange={(e) => {
              const d = value.split("");
              d[i] = e.target.value.replace(/\D/, "");
              onChange(d.join("").slice(0, 6));
            }}
            className={`w-11 h-14 sm:w-12 sm:h-15 rounded-xl text-center text-xl font-bold outline-none transition-all duration-200 ${
              value[i]
                ? "bg-[#eef4f9] border border-[#1d4f88] text-[#142747]"
                : "bg-[#fcfcfb] border border-[#cbd5df] text-[#142747] focus:border-[#1d4f88] focus:bg-white"
            }`}
          />
        ))}
    </div>
  );
}

export function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [timer, setTimer] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (timer > 0) {
      interval = setInterval(() => {
        setTimer((t) => t - 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timer]);

  const pwStrength =
    password.length === 0
      ? 0
      : password.length < 6
      ? 1
      : password.length < 10
      ? 2
      : password.match(/[A-Z]/) && password.match(/[0-9]/)
      ? 4
      : 3;
  const strengthColors = ["", "bg-rose-500", "bg-amber-500", "bg-[#1d4f88]", "bg-emerald-600"];
  const strengthTextColors = ["", "text-rose-600", "text-amber-600", "text-[#1d4f88]", "text-emerald-700"];
  const strengthLabels = ["", "Yếu", "Trung bình", "Mạnh", "Rất mạnh"];

  const handleSendOtp = async () => {
    if (!email || !email.includes("@")) {
      setError("Vui lòng nhập địa chỉ email hợp lệ.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await axios.post(`${API_BASE}/auth/forgot-password`, { email });
      setStep(2);
      setTimer(60);
    } catch {
      setError("Không thể gửi mã xác thực. Vui lòng kiểm tra lại email.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) {
      setError("Vui lòng nhập đầy đủ mã OTP 6 chữ số.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await axios.post(`${API_BASE}/auth/verify-otp`, { email, otp });
      setStep(3);
    } catch {
      setError("Mã OTP không chính xác hoặc đã hết hạn.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (password.length < 6) {
      setError("Mật khẩu mới phải có ít nhất 6 ký tự.");
      return;
    }
    if (password !== confirmPw) {
      setError("Mật khẩu xác nhận không khớp.");
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await axios.post(`${API_BASE}/auth/reset-password`, { email, otp, newPassword: password });
      setStep(4);
    } catch {
      setError("Yêu cầu khôi phục mật khẩu không hợp lệ hoặc đã hết hạn.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#faf9f6] text-[#142747] relative overflow-hidden antialiased">
      {/* Back to Login Button */}
      <Link
        to="/login"
        className="fixed top-6 left-6 bg-white border border-[#cbd5df] hover:bg-slate-50 rounded-xl px-4 py-2 text-[#142747] flex items-center gap-1.5 text-xs font-bold shadow-2xs transition-colors"
      >
        <ChevronLeft size={16} /> Đăng nhập
      </Link>

      <div className="flex gap-16 items-center justify-center max-w-[440px] w-full relative z-10 animate-fade-in-up">
        <div className="w-full bg-white border border-[#d3dbe4] rounded-2xl p-7 sm:p-8 shadow-[0_20px_50px_-25px_rgba(20,42,72,.25)]">
          <div className="flex justify-center mb-5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#142747] text-white">
              <LegalLogo size={22} className="text-[#f6efe2]" />
            </div>
          </div>

          <h1 className="font-editorial text-center text-[#142747] text-2xl font-bold mb-1">
            Khôi phục mật khẩu
          </h1>
          <p className="text-center text-xs text-[#718294] mb-5">
            Veritas Legal · Cổng khôi phục quyền truy cập an toàn
          </p>

          <StepDots step={step} />

          {/* Bước 1: Nhập Email */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <p className="text-[#516278] text-xs sm:text-sm font-semibold mb-1">
                Nhập địa chỉ Email đăng ký để nhận mã xác thực OTP khôi phục mật khẩu.
              </p>
              <BrandInput icon={Mail} placeholder="Địa chỉ Email của bạn" value={email} onChange={setEmail} />

              {error && (
                <div className="text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded-xl p-3 font-semibold">
                  {error}
                </div>
              )}

              <button
                disabled={!email.includes("@") || isLoading}
                onClick={handleSendOtp}
                className="w-full h-13 rounded-xl bg-[#1d4f88] hover:bg-[#153b66] text-white font-bold text-sm shadow-sm transition-[background-color,transform] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? "Đang gửi OTP..." : "Gửi mã OTP"} <ArrowRight size={17} />
              </button>
            </div>
          )}

          {/* Bước 2: Xác thực mã OTP */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="text-center">
                <p className="text-[#516278] text-xs sm:text-sm font-semibold mb-3">
                  Mã OTP khôi phục mật khẩu đã được gửi đến email <span className="text-[#142747] font-bold">{email}</span>.
                </p>
              </div>

              <OTPBoxes value={otp} onChange={setOtp} />

              {error && (
                <div className="text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded-xl p-3 font-semibold">
                  {error}
                </div>
              )}

              <button
                disabled={otp.length !== 6 || isLoading}
                onClick={handleVerifyOtp}
                className="w-full h-13 rounded-xl bg-[#1d4f88] hover:bg-[#153b66] text-white font-bold text-sm shadow-sm transition-[background-color,transform] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? "Đang xác thực..." : "Xác thực mã OTP"} <ArrowRight size={17} />
              </button>

              <div className="text-center mt-2 flex flex-col gap-2">
                {timer > 0 ? (
                  <span className="text-[#718294] text-xs font-semibold">
                    Gửi lại mã sau <span className="text-[#1d4f88] font-bold">{timer}s</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={handleSendOtp}
                    className="text-[#1d4f88] hover:underline text-xs font-bold"
                  >
                    Gửi lại mã OTP qua Email
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setError("");
                  }}
                  className="text-[#718294] hover:text-[#142747] text-xs font-bold flex items-center gap-1 justify-center self-center mt-1"
                >
                  <ChevronLeft size={14} /> Quay lại nhập Email
                </button>
              </div>
            </div>
          )}

          {/* Bước 3: Đổi mật khẩu */}
          {step === 3 && (
            <div className="flex flex-col gap-4">
              <p className="text-[#516278] text-xs sm:text-sm font-semibold mb-1">
                Thiết lập mật khẩu mới cho tài khoản của bạn.
              </p>
              <BrandInput
                icon={Lock}
                placeholder="Mật khẩu mới (ít nhất 6 ký tự)"
                type="password"
                value={password}
                onChange={setPassword}
              />

              {password.length > 0 && (
                <div>
                  <div className="flex gap-1 mb-1.5">
                    {[1, 2, 3, 4].map((n) => (
                      <div
                        key={n}
                        className={`flex-1 h-[3px] rounded-full transition-colors duration-300 ${
                          n <= pwStrength ? strengthColors[pwStrength] : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`text-xs font-bold ${strengthTextColors[pwStrength]}`}>
                    Độ mạnh: {strengthLabels[pwStrength]}
                  </span>
                </div>
              )}

              <BrandInput
                icon={Shield}
                placeholder="Xác nhận mật khẩu"
                type="password"
                value={confirmPw}
                onChange={setConfirmPw}
              />

              {error && (
                <div className="text-rose-700 text-xs bg-rose-50 border border-rose-200 rounded-xl p-3 font-semibold">
                  {error}
                </div>
              )}

              <button
                disabled={password.length < 6 || password !== confirmPw || isLoading}
                onClick={handleResetPassword}
                className="w-full h-13 rounded-xl bg-[#1d4f88] hover:bg-[#153b66] text-white font-bold text-sm shadow-sm transition-[background-color,transform] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isLoading ? "Đang cập nhật..." : "Đặt lại mật khẩu"} <ArrowRight size={17} />
              </button>
            </div>
          )}

          {/* Bước 4: Hoàn tất */}
          {step === 4 && (
            <div className="flex flex-col items-center gap-5 text-center py-2 animate-fade-in-up">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                <CheckCircle2 size={36} />
              </div>
              <div>
                <h2 className="font-editorial text-[#142747] text-2xl font-bold mb-1">
                  Cập nhật thành công!
                </h2>
                <p className="text-[#516278] text-xs sm:text-sm font-semibold">
                  Mật khẩu tài khoản đã được thay đổi. Hãy sử dụng mật khẩu mới để đăng nhập.
                </p>
              </div>
              <button
                onClick={() => navigate("/login")}
                className="w-full h-13 rounded-xl bg-[#1d4f88] hover:bg-[#153b66] text-white font-bold text-sm shadow-sm active:scale-[0.98] transition-[background-color,transform] flex items-center justify-center gap-2"
              >
                Đến trang đăng nhập <ArrowRight size={17} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
