import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import axios from "axios";
import { Loader2, Plus, Trash2, UploadCloud } from "lucide-react";
import { API_BASE } from "../../../config";
import { useAuth } from "../../context/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";

type UserRow = { id: number; username: string; name: string; email: string; phone: string; role: "admin" | "staff"; createdAt: string };
type ImportRow = Omit<UserRow, "id" | "createdAt"> & { password: string };
type ImportResult = { total: number; successCount: number; failedCount: number; results: { row: number; username: string; status: string; message: string }[] };
const columns = ["username", "name", "email", "phone", "role", "password"];
const blank: ImportRow = { username: "", name: "", email: "", phone: "", role: "staff", password: "" };

/** Đọc CSV có dấu ngoặc kép và xuống dòng trong ô, không thực thi nội dung công thức. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field); if (row.some((cell) => cell !== "")) rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("Tệp CSV có dấu ngoặc kép chưa đóng.");
  row.push(field); if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

/** Chặn công thức CSV, ký tự điều khiển và dữ liệu tài khoản sai định dạng. */
function validate(row: ImportRow): string {
  if (Object.values(row).some((value) => /^[\s]*[=+\-@]/.test(value) || Array.from(value).some((char) => char.charCodeAt(0) < 32 && char !== "\n" && char !== "\r"))) return "Dữ liệu có công thức hoặc ký tự không an toàn.";
  if (!/^[a-zA-Z][a-zA-Z0-9_.]{2,39}$/.test(row.username)) return "Tên đăng nhập không hợp lệ.";
  if (!row.name.trim() || row.name.length > 120 || /[<>]/.test(row.name)) return "Họ tên không hợp lệ.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) return "Email không hợp lệ.";
  if (row.phone && !/^0\d{9}$/.test(row.phone)) return "Số điện thoại không hợp lệ.";
  if (!["admin", "staff"].includes(row.role)) return "Vai trò không hợp lệ.";
  if (row.password.length < 8 || row.password.length > 128) return "Mật khẩu phải có từ 8 đến 128 ký tự.";
  return "";
}

/** Quản lý người dùng và xem trước dữ liệu CSV trước khi gửi đến API. */
export function AdminUsersPage() {
  const { user } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ImportRow>(blank);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true);
    try { const response = await axios.get<UserRow[]>(`${API_BASE}/users`); setUsers(response.data); }
    catch { setError("Không thể tải danh sách tài khoản."); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (user?.role !== "admin") return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [user?.role]);

  const create = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setNotice("");
    const issue = validate(form);
    if (issue) { setError(issue); return; }
    setBusy(true);
    try { await axios.post(`${API_BASE}/users`, form); setOpen(false); setForm(blank); setNotice("Đã tạo tài khoản."); await load(); }
    catch { setError("Không thể tạo tài khoản. Kiểm tra tên đăng nhập hoặc email đã tồn tại."); }
    finally { setBusy(false); }
  };

  const generatePassword = () => {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*";
    const bytes = new Uint32Array(20); crypto.getRandomValues(bytes);
    setForm({ ...form, password: "Aa1!" + Array.from(bytes, (byte) => characters[byte % characters.length]).join("") });
  };
  const download = () => {
    const body = columns.join(",") + "\n" + "nhanvien01,Nguyễn Văn Mẫu,mau@example.invalid,0900000000,staff,Aa1!MauMatKhau\n";
    const url = URL.createObjectURL(new Blob(["\uFEFF", body], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "template_admin_users.csv"; anchor.click();
    URL.revokeObjectURL(url);
  };
  const readFile = async (file?: File) => {
    setError(""); setResult(null); setRows([]); setFileName("");
    if (!file) return;
    if (!/\.csv$/i.test(file.name) || !["", "text/csv", "application/vnd.ms-excel"].includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError("Chỉ chấp nhận tệp CSV không rỗng, tối đa 5 MB."); return;
    }
    try {
      const data = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
      if (data[0]?.join(",") !== columns.join(",")) throw new Error("Tiêu đề cột phải là username,name,email,phone,role,password.");
      if (data.length < 2 || data.length > 501) throw new Error("Tệp phải có từ 1 đến 500 dòng tài khoản.");
      const parsed = data.slice(1).map((cells) => {
        if (cells.length !== 6) throw new Error("Mỗi dòng phải có đúng 6 cột.");
        return Object.fromEntries(columns.map((key, index) => [key, cells[index].trim()])) as ImportRow;
      });
      setRows(parsed); setFileName(file.name);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể đọc tệp CSV."); }
  };
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void readFile(event.dataTransfer.files[0]); };
  const seen = new Set<string>();
  const issues = rows.map((row) => {
    const key = row.username.toLowerCase();
    const duplicate = seen.has(key) || users.some((existing) => existing.username.toLowerCase() === key);
    seen.add(key);
    return duplicate ? "Tên đăng nhập đã tồn tại." : validate(row);
  });
  const importRows = async () => {
    if (issues.some(Boolean) || !rows.length) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await axios.post<ImportResult>(`${API_BASE}/users/bulk-import`, { users: rows });
      setResult(response.data); await load();
    } catch { setError("Không thể nhập tài khoản. Vui lòng thử lại."); }
    finally { setBusy(false); }
  };
  const remove = async (entry: UserRow) => {
    if (!window.confirm(`Xóa tài khoản ${entry.username}?`)) return;
    setBusy(true); setError("");
    try { await axios.delete(`${API_BASE}/users/${entry.id}`); setNotice("Đã xóa tài khoản."); await load(); }
    catch { setError("Không thể xóa tài khoản này."); }
    finally { setBusy(false); }
  };

  if (user?.role !== "admin") return <p className="rounded-xl border p-6">Chỉ quản trị viên toàn quyền được quản lý tài khoản.</p>;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-[#8a785d]">Quản trị truy cập</p><h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747]">Người dùng</h1></div><button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#1d4f88] px-4 py-2 text-sm font-bold text-white"><Plus size={16} /> Tạo tài khoản</button></header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <section className="overflow-hidden rounded-2xl border border-[#d3dbe4] bg-white"><h2 className="border-b p-4 text-lg font-bold">Danh sách tài khoản</h2>{loading ? <p role="status" className="p-6"><Loader2 className="inline animate-spin" size={18} /> Đang tải...</p> : users.length === 0 ? <p className="p-6 text-sm text-[#718294]">Chưa có tài khoản nào.</p> : <div className="overflow-x-auto"><table className="min-w-[650px] w-full text-left text-sm"><thead className="bg-slate-50 text-[#56677c]"><tr>{["Tên", "Tên đăng nhập", "Email", "Vai trò", "Ngày tạo", ""].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody>{users.map((entry) => <tr key={entry.id} className="border-t"><td className="max-w-44 truncate p-3">{entry.name}</td><td className="p-3">{entry.username}</td><td className="max-w-56 truncate p-3">{entry.email}</td><td className="p-3">{entry.role === "admin" ? "Quản trị viên" : "Chuyên viên"}</td><td className="p-3">{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString("vi-VN") : "—"}</td><td className="p-3"><button type="button" aria-label={`Xóa ${entry.username}`} disabled={busy || entry.id === Number(user?.id) || entry.username === "admin"} onClick={() => void remove(entry)} className="rounded-lg p-2 text-rose-700 disabled:opacity-30"><Trash2 size={17} /></button></td></tr>)}</tbody></table></div>}</section>
    <section className="space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-bold">Nhập tài khoản từ CSV</h2><p className="text-sm text-[#718294]">Kiểm tra dữ liệu trước khi xác nhận nhập.</p></div><button type="button" onClick={download} className="rounded-xl border px-3 py-2 text-sm font-semibold">Tải file CSV mẫu</button></div><input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])} /><div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }} onClick={() => fileInput.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop} className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center text-sm ${dragging ? "border-blue-500 bg-blue-50" : "border-[#cbd5df]"}`}><UploadCloud className="mx-auto mb-2" size={24} /> Kéo thả hoặc chọn tệp CSV tối đa 5 MB</div>{fileName && <p className="text-sm">Tệp: {fileName} · {rows.length} dòng</p>}{rows.length > 0 && <><div className="max-h-72 overflow-auto rounded-xl border"><table className="min-w-[700px] w-full text-left text-xs"><thead><tr>{["Dòng", "Tên đăng nhập", "Họ tên", "Email", "Vai trò", "Kiểm tra"].map((heading) => <th key={heading} className="p-2">{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t"><td className="p-2">{index + 2}</td><td className="p-2">{row.username}</td><td className="max-w-36 truncate p-2">{row.name}</td><td className="max-w-44 truncate p-2">{row.email}</td><td className="p-2">{row.role}</td><td className={`p-2 ${issues[index] ? "text-rose-700" : "text-emerald-700"}`}>{issues[index] || "Hợp lệ"}</td></tr>)}</tbody></table></div><button type="button" disabled={busy || issues.some(Boolean)} onClick={() => void importRows()} className="rounded-xl bg-[#1d4f88] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Xác nhận nhập {rows.length} tài khoản</button></>}{result && <div role="status" className="rounded-xl border p-3 text-sm"><p>Đã tạo {result.successCount}/{result.total} tài khoản; lỗi {result.failedCount} dòng.</p>{result.results.filter((item) => item.status === "failed").map((item) => <p key={item.row}>Dòng {item.row}: {item.message}</p>)}</div>}</section>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Tạo tài khoản quản trị</DialogTitle><DialogDescription>Điền thông tin tài khoản và mật khẩu khởi tạo.</DialogDescription></DialogHeader><form onSubmit={create} className="space-y-3">{(["username", "name", "email", "phone", "password"] as const).map((key) => <label key={key} className="block text-sm font-semibold">{({ username: "Tên đăng nhập", name: "Họ và tên", email: "Email", phone: "Số điện thoại", password: "Mật khẩu" })[key]}<input type={key === "password" ? "password" : key === "email" ? "email" : "text"} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required={key !== "phone"} autoComplete="off" className="mt-1 block w-full rounded-xl border p-2" /></label>)}<button type="button" onClick={generatePassword} className="text-sm font-semibold text-[#1d4f88] underline">Tạo mật khẩu mạnh</button><label className="block text-sm font-semibold">Vai trò<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as ImportRow["role"] })} className="mt-1 block w-full rounded-xl border p-2"><option value="staff">Chuyên viên</option><option value="admin">Quản trị viên</option></select></label><button disabled={busy} className="w-full rounded-xl bg-[#1d4f88] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Tạo tài khoản</button></form></DialogContent></Dialog>
  </div>;
}
