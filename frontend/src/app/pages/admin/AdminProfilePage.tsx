import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { Loader2 } from "lucide-react";
import { API_BASE } from "../../../config";
import { useAuth } from "../../context/AuthContext";

type Profile = { id: number; username: string; name: string; email: string; phone: string; role: string; createdAt: string; twoFaEnabled: boolean };

/** Hồ sơ cá nhân, thay đổi mật khẩu và xác thực hai lớp trên các endpoint đã bảo vệ. */
export function AdminProfilePage() {
  const { updateUser, logout } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  // Mỗi thao tác bảo mật sử dụng challenge riêng do server cấp.
  const [phoneChallenge, setPhoneChallenge] = useState("");
  const [pendingPhone, setPendingPhone] = useState("");
  const [twoFaChallenge, setTwoFaChallenge] = useState("");
  const [phonePending, setPhonePending] = useState(false);
  const [otpPending, setOtpPending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const strength = [newPassword.length >= 8, /[A-Z]/.test(newPassword), /[a-z]/.test(newPassword), /\d/.test(newPassword), /[^A-Za-z0-9]/.test(newPassword)].filter(Boolean).length;

  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await axios.get<Profile>(`${API_BASE}/users/me`);
      setProfile(response.data); setName(response.data.name || ""); setPhone(response.data.phone || "");
    } catch { setError("Không thể tải hồ sơ. Vui lòng thử lại."); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const action = async (request: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await request(); setNotice(success); await load(); }
    catch { setError("Thao tác không thành công. Kiểm tra dữ liệu và thử lại."); }
    finally { setBusy(false); }
  };

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || name.length > 120) { setError("Họ tên phải có từ 1 đến 120 ký tự."); return; }
    void action(async () => {
      await axios.patch(`${API_BASE}/users/profile`, { name: name.trim() });
      updateUser({ name: name.trim() });
    }, "Đã cập nhật họ tên.");
  };
  const changePassword = (event: FormEvent) => {
    event.preventDefault();
    if (strength < 5 || newPassword !== confirmPassword) { setError("Mật khẩu mới phải mạnh và trùng với xác nhận."); return; }
    void action(async () => {
      await axios.post(`${API_BASE}/users/change-password`, { currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      logout();
      window.location.href = "/login";
    }, "Đã đổi mật khẩu. Vui lòng đăng nhập lại.");
  };

  if (loading && !profile) return <p role="status" className="p-6"><Loader2 className="inline animate-spin" size={18} /> Đang tải hồ sơ...</p>;
  return <div className="max-w-4xl space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-widest text-[#8a785d]">Tài khoản</p><h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747]">Hồ sơ cá nhân</h1></header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {profile && <>
      <section className="space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6">
        <h2 className="text-lg font-bold text-[#142747]">Thông tin cá nhân</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-[#718294]">Tên đăng nhập</dt><dd>{profile.username}</dd></div><div><dt className="text-[#718294]">Email</dt><dd className="break-all">{profile.email || "Chưa có"}</dd></div><div><dt className="text-[#718294]">Vai trò</dt><dd>{profile.role === "admin" ? "Quản trị viên" : "Chuyên viên pháp lý"}</dd></div><div><dt className="text-[#718294]">Ngày tạo</dt><dd>{profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("vi-VN") : "Chưa rõ"}</dd></div></dl>
        <form onSubmit={saveProfile} className="space-y-3"><label className="block text-sm font-semibold">Họ và tên<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required className="mt-1 block w-full rounded-xl border p-2" /></label><button disabled={busy} className="rounded-xl bg-[#1d4f88] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Lưu thông tin</button></form>
        <div className="border-t pt-4"><label className="block text-sm font-semibold">Số điện thoại<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" className="mt-1 block w-full rounded-xl border p-2" /></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || !/^0\d{9}$/.test(phone)} onClick={() => void action(async () => { const response = await axios.post(`${API_BASE}/users/phone/request`, { phone }); setPhoneChallenge(response.data.challengeId); setPendingPhone(phone); setPhonePending(true); }, "Mã xác nhận đã gửi qua email.")} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50">Yêu cầu đổi số</button>{phonePending && <><span className="w-full text-sm">Số mới chờ xác nhận: {pendingPhone}</span><input aria-label="Mã xác nhận đổi số" value={phoneOtp} onChange={(event) => setPhoneOtp(event.target.value)} maxLength={6} inputMode="numeric" className="w-36 rounded-xl border p-2" /><button type="button" disabled={busy || !/^\d{6}$/.test(phoneOtp)} onClick={() => void action(async () => { await axios.post(`${API_BASE}/users/phone/verify`, { phone: pendingPhone, otpCode: phoneOtp, challengeId: phoneChallenge }); updateUser({ phone: pendingPhone }); setPhonePending(false); setPhoneOtp(""); }, "Đã cập nhật số điện thoại.")} className="rounded-xl bg-[#1d4f88] px-3 py-2 text-sm text-white disabled:opacity-50">Xác nhận số</button></>}</div></div>
      </section>
      <section className="space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6"><h2 className="text-lg font-bold text-[#142747]">Đổi mật khẩu</h2><form onSubmit={changePassword} className="space-y-3">{[["Mật khẩu hiện tại", currentPassword, setCurrentPassword], ["Mật khẩu mới", newPassword, setNewPassword], ["Xác nhận mật khẩu mới", confirmPassword, setConfirmPassword]].map(([label, value, setter]) => <label key={label as string} className="block text-sm font-semibold">{label as string}<input type="password" autoComplete={label === "Mật khẩu hiện tại" ? "current-password" : "new-password"} value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} required className="mt-1 block w-full rounded-xl border p-2" /></label>)}<div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${strength * 20}%` }} /></div><p className="mt-1 text-xs text-[#718294]">Tối thiểu 8 ký tự, chữ hoa, chữ thường, số và ký tự đặc biệt.</p></div><button disabled={busy} className="rounded-xl bg-[#1d4f88] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Đổi mật khẩu</button></form></section>
      <section className="space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6"><h2 className="text-lg font-bold text-[#142747]">Xác thực hai lớp</h2><p className="text-sm">Trạng thái: <strong>{profile.twoFaEnabled ? "Đang bật" : "Đang tắt"}</strong></p><button type="button" disabled={busy || !profile.email} onClick={() => void action(async () => { const response = await axios.post(`${API_BASE}/users/2fa/request`); setTwoFaChallenge(response.data.challengeId); setOtpPending(true); }, "Mã OTP đã gửi qua email.")} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-50">Gửi mã OTP</button>{otpPending && <div className="flex flex-wrap gap-2"><input aria-label="Mã OTP" value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" maxLength={6} className="w-36 rounded-xl border p-2" /><button type="button" disabled={busy || !/^\d{6}$/.test(otp)} onClick={() => void action(async () => { await axios.post(`${API_BASE}/users/2fa/toggle`, { otpCode: otp, challengeId: twoFaChallenge }); setOtp(""); setOtpPending(false); logout(); window.location.href = "/login"; }, "Đã cập nhật xác thực hai lớp.")} className="rounded-xl bg-[#1d4f88] px-4 py-2 text-sm text-white disabled:opacity-50">Xác nhận thay đổi</button></div>}</section>
    </>}
  </div>;
}
