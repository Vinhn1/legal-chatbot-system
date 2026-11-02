import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import axios from "axios";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileDown,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UploadCloud,
  UserCheck,
  Users,
} from "lucide-react";
import { API_BASE } from "../../../config";
import { useAuth } from "../../context/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { FilterDropdown } from "../../components/ui/FilterDropdown";

/** Cấu trúc một bản ghi tài khoản người dùng từ PostgreSQL */
interface UserRow {
  id: number;
  username: string;
  name: string;
  email: string;
  phone: string;
  role: "admin" | "staff";
  createdAt: string;
}

/** Cấu trúc dữ liệu nhập tài khoản từ file CSV */
interface ImportRow {
  username: string;
  name: string;
  email: string;
  phone: string;
  role: "admin" | "staff";
  password: string;
}

/** Kết quả trả về từ API nạp người dùng hàng loạt */
interface ImportResult {
  total: number;
  successCount: number;
  failedCount: number;
  results: {
    row: number;
    username: string;
    status: string;
    message: string;
  }[];
}

const CSV_COLUMNS = ["username", "name", "email", "phone", "role", "password"] as const;

const BLANK_CREATE_FORM: ImportRow = {
  username: "",
  name: "",
  email: "",
  phone: "",
  role: "staff",
  password: "",
};

interface EditFormState {
  id: number;
  username: string;
  name: string;
  email: string;
  phone: string;
  role: "admin" | "staff";
  newPassword: string;
}

/** Đọc tệp CSV hỗ trợ dấu ngoặc kép và xuống dòng an toàn */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("Tệp CSV có dấu ngoặc kép chưa được đóng đúng thể thức.");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

/** Kiểm tra tính hợp lệ của một dòng tài khoản trước khi gửi API */
function validateRow(row: ImportRow): string {
  if (
    Object.values(row).some(
      (value) =>
        typeof value !== "string" || /^[\s]*[=+\-@]/.test(value) ||
        Array.from(value).some((c) => c.charCodeAt(0) < 32 && c !== "\n" && c !== "\r")
    )
  ) {
    return "Dữ liệu chứa ký tự điều khiển hoặc công thức không an toàn.";
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_.]{2,39}$/.test(row.username)) {
    return "Tên đăng nhập phải từ 3-40 ký tự, bắt đầu bằng chữ cái.";
  }
  if (!row.name.trim() || row.name.length > 120 || /[<>]/.test(row.name)) {
    return "Họ tên không được để trống và không chứa ký tự HTML.";
  }
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
    return "Địa chỉ email không đúng định dạng.";
  }
  if (row.phone && !/^0\d{9}$/.test(row.phone)) {
    return "Số điện thoại phải gồm 10 chữ số bắt đầu bằng 0.";
  }
  if (!["admin", "staff"].includes(row.role)) {
    return "Vai trò chỉ được là 'admin' hoặc 'staff'.";
  }
  if (row.password.length < 8 || row.password.length > 128) {
    return "Mật khẩu khởi tạo phải từ 8 đến 128 ký tự.";
  }
  return "";
}

/** Tạo chuỗi mật khẩu mạnh ngẫu nhiên */
function makeStrongPassword(): string {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#$%&*";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return "Aa1!" + Array.from(bytes, (byte) => characters[byte % characters.length]).join("");
}

/**
 * Màn hình Quản trị Người dùng & Phân quyền (Admin Users Page)
 * Hỗ trợ tạo mới, chỉnh sửa tài khoản, đổi vai trò admin/staff, và nạp tài khoản hàng loạt từ CSV.
 */
export function AdminUsersPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab chuyển đổi: "list" (Danh sách) hoặc "csv" (Nạp CSV)
  const [activeTab, setActiveTab] = useState<"list" | "csv">("list");

  // Dữ liệu danh sách tài khoản
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [globalNotice, setGlobalNotice] = useState("");

  // Bộ lọc và tìm kiếm
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "staff">("all");

  // Quản lý Modal Tạo tài khoản mới
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ImportRow>(BLANK_CREATE_FORM);

  // Quản lý Modal Sửa tài khoản
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);

  // Dữ liệu xem trước và xử lý tệp CSV
  const [csvRows, setCsvRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [csvFilter, setCsvFilter] = useState<"all" | "valid" | "invalid">("all");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Tải danh sách người dùng từ máy chủ
  const fetchUsers = async () => {
    setIsLoading(true);
    setGlobalError("");
    try {
      const response = await axios.get<UserRow[]>(`${API_BASE}/users`);
      setUsers(Array.isArray(response.data) ? response.data : []);
    } catch {
      setGlobalError("Không thể tải danh sách tài khoản từ máy chủ.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") {
      fetchUsers();
    }
  }, [user?.role]);

  // Xử lý tạo tài khoản thủ công
  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    setGlobalError("");
    setGlobalNotice("");

    const issue = validateRow(createForm);
    if (issue) {
      setGlobalError(issue);
      return;
    }

    setIsSubmitting(true);
    try {
      await axios.post(`${API_BASE}/users`, createForm);
      setIsCreateOpen(false);
      setCreateForm(BLANK_CREATE_FORM);
      setGlobalNotice(`Đã tạo thành công tài khoản "${createForm.username}".`);
      await fetchUsers();
    } catch {
      setGlobalError("Không thể tạo tài khoản. Tên đăng nhập hoặc email có thể đã tồn tại.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Mở modal sửa tài khoản với dữ liệu hiện tại
  const openEditModal = (entry: UserRow) => {
    setEditForm({
      id: entry.id,
      username: entry.username,
      name: entry.name || "",
      email: entry.email || "",
      phone: entry.phone || "",
      role: entry.role,
      newPassword: "",
    });
    setIsEditOpen(true);
  };

  // Xử lý lưu thông tin chỉnh sửa tài khoản
  const handleUpdateUser = async (event: FormEvent) => {
    event.preventDefault();
    if (!editForm) return;

    setGlobalError("");
    setGlobalNotice("");

    if (!editForm.name.trim()) {
      setGlobalError("Họ và tên không được để trống.");
      return;
    }
    if (editForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email)) {
      setGlobalError("Địa chỉ email không đúng định dạng.");
      return;
    }
    if (editForm.phone && !/^0\d{9}$/.test(editForm.phone)) {
      setGlobalError("Số điện thoại phải gồm 10 chữ số bắt đầu bằng 0.");
    }
    if (editForm.newPassword && (editForm.newPassword.length < 8 || editForm.newPassword.length > 128)) {
      setGlobalError("Mật khẩu mới phải từ 8 đến 128 ký tự.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Record<string, any> = {
        name: editForm.name.trim(),
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        role: editForm.role,
      };
      if (editForm.newPassword.trim()) {
        payload.password = editForm.newPassword.trim();
      }

      await axios.patch(`${API_BASE}/users/${editForm.id}`, payload);
      setIsEditOpen(false);
      setEditForm(null);
      setGlobalNotice(`Đã cập nhật thành công tài khoản "${editForm.username}".`);
      await fetchUsers();
    } catch {
      setGlobalError("Không thể cập nhật tài khoản. Vui lòng kiểm tra lại thông tin.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Xóa tài khoản
  const handleDeleteUser = async (entry: UserRow) => {
    if (entry.username === "admin") {
      alert("Không thể xóa tài khoản Quản trị viên hệ thống mặc định.");
      return;
    }
    if (entry.id === Number(user?.id)) {
      alert("Bạn không thể tự xóa tài khoản đang đăng nhập.");
      return;
    }

    if (!window.confirm(`Bạn có chắc chắn muốn xóa tài khoản "${entry.username}" (${entry.name})?`)) {
      return;
    }

    setIsSubmitting(true);
    setGlobalError("");
    setGlobalNotice("");
    try {
      await axios.delete(`${API_BASE}/users/${entry.id}`);
      setGlobalNotice(`Đã xóa tài khoản "${entry.username}".`);
      await fetchUsers();
    } catch {
      setGlobalError("Không thể xóa tài khoản này. Vui lòng thử lại sau.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Tải tệp CSV mẫu chuẩn
  const handleDownloadCsvTemplate = () => {
    const header = CSV_COLUMNS.join(",");
    const sampleRow = "nhanvien01,Nguyen Van Mau,nhanvien01@example.com,0912345678,staff,Aa1!MatKhauMoi\n";
    const content = "\uFEFF" + header + "\n" + sampleRow;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tai_khoan_mau_chuan.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  // Đọc nội dung tệp CSV tải lên
  const handleReadCsvFile = async (file?: File) => {
    setGlobalError("");
    setImportResult(null);
    setCsvRows([]);
    setFileName("");

    if (!file) return;

    if (
      !/\.csv$/i.test(file.name) ||
      file.size === 0 ||
      file.size > 5 * 1024 * 1024
    ) {
      setGlobalError("Chỉ chấp nhận tệp định dạng CSV không rỗng, dung lượng tối đa 5 MB.");
      return;
    }

    try {
      const rawText = await file.text();
      const parsedData = parseCsv(rawText.replace(/^\uFEFF/, ""));

      if (!parsedData.length || parsedData[0]?.join(",") !== CSV_COLUMNS.join(",")) {
        throw new Error(
          `Tiêu đề cột trong tệp CSV không hợp lệ. Yêu cầu: ${CSV_COLUMNS.join(",")}`
        );
      }

      if (parsedData.length < 2) {
        throw new Error("Tệp CSV phải chứa ít nhất 1 dòng tài khoản sau hàng tiêu đề.");
      }
      if (parsedData.length > 501) {
        throw new Error("Mỗi lần nạp chỉ hỗ trợ tối đa 500 tài khoản.");
      }

      const parsedRows: ImportRow[] = parsedData.slice(1).map((cells) => {
        if (cells.length !== 6) {
          throw new Error("Mỗi dòng trong file CSV phải có đầy đủ đúng 6 cột thông tin.");
        }
        return {
          username: cells[0].trim(),
          name: cells[1].trim(),
          email: cells[2].trim(),
          phone: cells[3].trim(),
          role: (cells[4].trim() === "admin" ? "admin" : "staff") as "admin" | "staff",
          password: cells[5].trim(),
        };
      });

      setCsvRows(parsedRows);
      setFileName(file.name);
    } catch (err: any) {
      setGlobalError(err?.message || "Không thể đọc nội dung tệp CSV.");
    }
  };

  const handleDropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile) {
      handleReadCsvFile(droppedFile);
    }
  };

  // Kiểm tra tính hợp lệ của từng dòng CSV đối chiếu với DB
  const seenUsernames = new Set<string>();
  const csvIssues = csvRows.map((row) => {
    const key = row.username.toLowerCase();
    const isDuplicateInFile = seenUsernames.has(key);
    seenUsernames.add(key);

    const isDuplicateInDb = users.some(
      (existing) => existing.username.toLowerCase() === key
    );

    if (isDuplicateInDb) {
      return "Tên đăng nhập đã tồn tại trong hệ thống.";
    }
    if (isDuplicateInFile) {
      return "Tên đăng nhập bị trùng lặp trong chính tệp CSV này.";
    }
    return validateRow(row);
  });

  // Tách riêng các dòng hợp lệ và dòng lỗi
  const validCsvIndices = csvRows
    .map((_, idx) => idx)
    .filter((idx) => !csvIssues[idx]);
  const validCsvRows = validCsvIndices.map((idx) => csvRows[idx]);
  const invalidCount = csvRows.length - validCsvRows.length;

  // Thực hiện nạp các dòng hợp lệ (Tự động bỏ qua các dòng lỗi)
  const handleImportValidRows = async () => {
    if (!validCsvRows.length) return;

    setIsSubmitting(true);
    setGlobalError("");
    setImportResult(null);

    try {
      const response = await axios.post<ImportResult>(`${API_BASE}/users/bulk-import`, {
        users: validCsvRows,
      });

      setImportResult(response.data);
      setGlobalNotice(
        `Nạp thành công ${response.data.successCount} tài khoản vào hệ thống.`
      );
      await fetchUsers();
      // Reset danh sách preview sau khi nạp xong
      setCsvRows([]);
      setFileName("");
    } catch {
      setGlobalError("Không thể nạp tài khoản. Vui lòng kiểm tra lại kết nối máy chủ.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Bộ lọc danh sách người dùng hiển thị
  const filteredUsers = users.filter((u) => {
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    const term = searchTerm.toLowerCase().trim();
    if (!term) return matchesRole;

    const matchesTerm =
      u.name.toLowerCase().includes(term) ||
      u.username.toLowerCase().includes(term) ||
      (u.email && u.email.toLowerCase().includes(term)) ||
      (u.phone && u.phone.includes(term));

    return matchesRole && matchesTerm;
  });

  // Thống kê số lượng
  const totalCount = users.length;
  const adminCount = users.filter((u) => u.role === "admin").length;
  const staffCount = users.filter((u) => u.role === "staff").length;

  if (user?.role !== "admin") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800 font-semibold">
        Bạn không có quyền truy cập trang này. Chức năng Quản trị người dùng chỉ dành riêng cho Quản trị viên hệ thống.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Tiêu đề trang & Nút Thêm tài khoản */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#d8dee5] pb-5">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a785d]">
            QUẢN TRỊ TRUY CẬP & PHÂN QUYỀN
          </div>
          <h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747]">
            Người dùng
          </h1>
          <p className="mt-1 text-sm text-[#56677c]">
            Quản lý danh sách nhân sự, phân định vai trò Quản trị viên và Chuyên viên, nạp danh sách tài khoản hàng loạt.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchUsers}
            disabled={isLoading}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-3.5 text-sm font-bold text-[#142747] hover:bg-slate-50 transition-colors"
            title="Làm mới danh sách"
          >
            <RefreshCw size={16} className={isLoading ? "animate-spin text-[#1d4f88]" : ""} />
            <span className="hidden sm:inline">Làm mới</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreateForm(BLANK_CREATE_FORM);
              setIsCreateOpen(true);
            }}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1d4f88] px-4 text-sm font-bold text-white hover:bg-[#153b66] transition-colors shadow-xs"
          >
            <Plus size={16} />
            <span>Tạo tài khoản</span>
          </button>
        </div>
      </div>

      {/* Thẻ thống kê nhanh */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[#d8dee5] bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-[#64748b] uppercase tracking-wider">
            <span>Tổng tài khoản</span>
            <Users size={16} className="text-[#1d4f88]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#142747]">{totalCount}</div>
        </div>

        <div className="rounded-2xl border border-[#d8dee5] bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-[#64748b] uppercase tracking-wider">
            <span>Quản trị viên</span>
            <Shield size={16} className="text-[#8a785d]" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#142747]">{adminCount}</div>
        </div>

        <div className="rounded-2xl border border-[#d8dee5] bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-[#64748b] uppercase tracking-wider">
            <span>Chuyên viên</span>
            <UserCheck size={16} className="text-emerald-700" />
          </div>
          <div className="mt-2 text-2xl font-bold text-[#142747]">{staffCount}</div>
        </div>
      </div>

      {/* Thông báo lỗi hoặc thành công */}
      {globalError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-700 shrink-0" />
            <span>{globalError}</span>
          </div>
          <button
            type="button"
            onClick={() => setGlobalError("")}
            className="text-rose-900 font-bold hover:opacity-80"
          >
            Đóng
          </button>
        </div>
      )}

      {globalNotice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-700 shrink-0" />
            <span>{globalNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setGlobalNotice("")}
            className="text-emerald-900 font-bold hover:opacity-80"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Điều hướng 2 Tab */}
      <div className="flex items-center gap-2 border-b border-[#d8dee5]">
        <button
          type="button"
          onClick={() => setActiveTab("list")}
          className={`inline-flex items-center gap-2 pb-3 px-3 text-sm font-bold transition-colors border-b-2 ${
            activeTab === "list"
              ? "border-[#1d4f88] text-[#1d4f88]"
              : "border-transparent text-[#64748b] hover:text-[#142747]"
          }`}
        >
          <Users size={16} />
          <span>Danh sách tài khoản · {totalCount}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("csv")}
          className={`inline-flex items-center gap-2 pb-3 px-3 text-sm font-bold transition-colors border-b-2 ${
            activeTab === "csv"
              ? "border-[#1d4f88] text-[#1d4f88]"
              : "border-transparent text-[#64748b] hover:text-[#142747]"
          }`}
        >
          <UploadCloud size={16} />
          <span>Nhập tài khoản từ CSV</span>
        </button>
      </div>

      {/* NỘI DUNG TAB 1: DANH SÁCH TÀI KHOẢN */}
      {activeTab === "list" && (
        <div className="space-y-4">
          {/* Thanh công cụ tìm kiếm & lọc theo vai trò */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-3.5 py-2.5 max-w-md w-full shadow-2xs">
              <Search size={18} className="text-[#7c8b9d]" />
              <input
                type="text"
                placeholder="Tìm theo tên, tên đăng nhập, email, số điện thoại..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-transparent text-sm font-semibold text-[#142747] outline-none"
              />
            </div>

            <FilterDropdown
              label="Vai trò"
              value={roleFilter}
              options={[
                { value: "all", label: `Tất cả vai trò · ${totalCount}` },
                { value: "admin", label: `Quản trị viên · ${adminCount}`, dotColor: "bg-[#142747]" },
                { value: "staff", label: `Chuyên viên · ${staffCount}`, dotColor: "bg-emerald-600" },
              ]}
              onChange={(val) => setRoleFilter(val as any)}
              icon={Shield}
              ariaLabel="Lọc theo vai trò"
            />
          </div>

          {/* Bảng danh sách người dùng */}
          <div className="w-full rounded-2xl border border-[#d3dbe4] bg-white shadow-xs overflow-hidden">
            {isLoading ? (
              <div className="p-12 text-center text-[#66778c]">
                <Loader2 size={32} className="mx-auto animate-spin text-[#1d4f88] mb-3" />
                <p className="text-sm font-semibold">Đang tải danh sách tài khoản...</p>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-12 text-center text-[#66778c]">
                <p className="text-sm font-semibold">Không tìm thấy tài khoản nào phù hợp.</p>
              </div>
            ) : (
              <div className="overflow-x-auto board-scroll">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="border-b border-[#e2e7ec] bg-[#f8f9fa] text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">
                    <tr>
                      <th className="py-3.5 px-5">Nhân sự & Tên đăng nhập</th>
                      <th className="py-3.5 px-4">Email</th>
                      <th className="py-3.5 px-4">Số điện thoại</th>
                      <th className="py-3.5 px-4">Vai trò</th>
                      <th className="py-3.5 px-4">Ngày tạo</th>
                      <th className="py-3.5 px-5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf1f4]">
                    {filteredUsers.map((entry) => {
                      const isDefaultAdmin = entry.username === "admin";
                      const isCurrentUser = entry.id === Number(user?.id);

                      return (
                        <tr key={entry.id} className="hover:bg-slate-100/70 dark:hover:bg-zinc-900/80 transition-colors">
                          {/* Cột Tên & Tên đăng nhập */}
                          <td className="py-3.5 px-5 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#142747] text-xs font-bold text-white uppercase">
                                {entry.name ? entry.name.slice(0, 2) : "NV"}
                              </div>
                              <div>
                                <div className="font-bold text-[#142747]">
                                  {entry.name || "Chưa đặt tên"}
                                </div>
                                <div className="text-xs font-mono text-[#718294]">
                                  @{entry.username}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Cột Email */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {entry.email ? (
                              <span className="font-medium text-[#334155]">{entry.email}</span>
                            ) : (
                              <span className="text-xs italic text-[#94a3b8]">Chưa cập nhật</span>
                            )}
                          </td>

                          {/* Cột Số điện thoại */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {entry.phone ? (
                              <span className="font-mono text-xs font-semibold text-[#334155]">
                                {entry.phone}
                              </span>
                            ) : (
                              <span className="text-xs italic text-[#94a3b8]">Chưa cập nhật</span>
                            )}
                          </td>

                          {/* Cột Vai trò */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {entry.role === "admin" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#142747] px-3 py-1 text-xs font-bold text-white shadow-2xs">
                                <Shield size={11} className="text-[#f6efe2]" />
                                Quản trị viên
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-800">
                                <UserCheck size={11} className="text-emerald-700" />
                                Chuyên viên
                              </span>
                            )}
                          </td>

                          {/* Cột Ngày tạo */}
                          <td className="py-3.5 px-4 whitespace-nowrap text-xs text-[#718294]">
                            {entry.createdAt
                              ? new Date(entry.createdAt).toLocaleDateString("vi-VN")
                              : "—"}
                          </td>

                          {/* Cột Thao tác: Sửa và Xóa */}
                          <td className="py-3.5 px-5 whitespace-nowrap text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditModal(entry)}
                                title={`Chỉnh sửa tài khoản ${entry.username}`}
                                className="rounded-lg p-2 text-[#1d4f88] hover:bg-[#eef4f9] transition-colors"
                              >
                                <Pencil size={16} />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteUser(entry)}
                                disabled={isSubmitting || isDefaultAdmin || isCurrentUser}
                                title={
                                  isDefaultAdmin
                                    ? "Không thể xóa Admin mặc định"
                                    : isCurrentUser
                                    ? "Không thể tự xóa chính mình"
                                    : `Xóa tài khoản ${entry.username}`
                                }
                                className="rounded-lg p-2 text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* NỘI DUNG TAB 2: NHẬP TÀI KHOẢN TỪ CSV */}
      {activeTab === "csv" && (
        <div className="space-y-5 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#edf1f4] pb-4">
            <div>
              <h2 className="text-lg font-bold text-[#142747]">Nhập tài khoản từ tệp CSV</h2>
              <p className="text-sm text-[#718294]">
                Tải lên tệp CSV chứa danh sách nhân viên để nạp hàng loạt vào hệ thống.
              </p>
            </div>

            <button
              type="button"
              onClick={handleDownloadCsvTemplate}
              className="inline-flex items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-3.5 py-2 text-xs font-bold text-[#142747] hover:bg-slate-50 transition-colors self-start sm:self-auto"
            >
              <FileDown size={15} className="text-[#1d4f88]" />
              Tải file CSV mẫu chuẩn
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => handleReadCsvFile(e.target.files?.[0])}
          />

          {/* Vùng kéo thả file CSV */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDropFile}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragging
                ? "border-blue-500 bg-blue-50/70"
                : "border-[#cbd5df] hover:border-[#1d4f88] bg-[#fcfdfe]"
            }`}
          >
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#eef4f9] text-[#1d4f88] mb-3">
              <UploadCloud size={24} />
            </div>
            <div className="text-sm font-bold text-[#142747]">
              Kéo thả hoặc nhấp để chọn tệp CSV từ máy tính
            </div>
            <div className="mt-1 text-xs text-[#718294]">
              Hỗ trợ định dạng .csv chuẩn UTF-8, tối đa 500 tài khoản cho mỗi lượt nạp
            </div>
          </div>

          {/* Bảng xem trước dữ liệu CSV nếu có */}
          {fileName && csvRows.length > 0 && (
            <div className="space-y-4 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#f8fafc] border border-[#e2e8f0] p-4 rounded-xl">
                <div>
                  <div className="text-xs font-bold text-[#64748b]">TỆP ĐANG XỬ LÝ</div>
                  <div className="text-sm font-bold text-[#142747]">
                    {fileName} · Tổng {csvRows.length} dòng
                  </div>
                </div>

                {/* Thống kê phân loại hợp lệ / lỗi */}
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-800">
                    <CheckCircle2 size={13} />
                    {validCsvRows.length} hợp lệ
                  </span>
                  {invalidCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs font-bold text-rose-800">
                      <AlertTriangle size={13} />
                      {invalidCount} lỗi
                    </span>
                  )}
                </div>
              </div>

              {/* Bộ lọc xem nhanh các dòng trong CSV */}
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-[#64748b]">Hiển thị:</span>
                <button
                  type="button"
                  onClick={() => setCsvFilter("all")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                    csvFilter === "all"
                      ? "bg-[#1d4f88] text-white"
                      : "bg-slate-100 text-[#475569] hover:bg-slate-200"
                  }`}
                >
                  Tất cả · {csvRows.length}
                </button>
                <button
                  type="button"
                  onClick={() => setCsvFilter("valid")}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                    csvFilter === "valid"
                      ? "bg-emerald-700 text-white"
                      : "bg-slate-100 text-[#475569] hover:bg-slate-200"
                  }`}
                >
                  Dòng hợp lệ · {validCsvRows.length}
                </button>
                {invalidCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setCsvFilter("invalid")}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                      csvFilter === "invalid"
                        ? "bg-rose-700 text-white"
                        : "bg-slate-100 text-[#475569] hover:bg-slate-200"
                    }`}
                  >
                    Dòng lỗi · {invalidCount}
                  </button>
                )}
              </div>

              {/* Bảng xem trước dữ liệu CSV */}
              <div className="max-h-80 overflow-y-auto board-scroll rounded-xl border border-[#d3dbe4]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#f8f9fa] border-b border-[#e2e7ec] text-[#6a7b8e] font-bold uppercase sticky top-0">
                    <tr>
                      <th className="p-2.5">Dòng</th>
                      <th className="p-2.5">Tên đăng nhập</th>
                      <th className="p-2.5">Họ và tên</th>
                      <th className="p-2.5">Email</th>
                      <th className="p-2.5">Vai trò</th>
                      <th className="p-2.5">Trạng thái tiền kiểm</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf1f4]">
                    {csvRows.map((row, index) => {
                      const issue = csvIssues[index];
                      const isRowValid = !issue;

                      if (csvFilter === "valid" && !isRowValid) return null;
                      if (csvFilter === "invalid" && isRowValid) return null;

                      return (
                        <tr
                          key={index}
                          className={isRowValid ? "hover:bg-slate-100/70 dark:hover:bg-zinc-900/80" : "bg-rose-50/40 hover:bg-rose-50/70 dark:bg-rose-950/30 dark:hover:bg-rose-950/50"}
                        >
                          <td className="p-2.5 font-mono text-[#718294]">{index + 2}</td>
                          <td className="p-2.5 font-mono font-bold text-[#142747]">
                            {row.username}
                          </td>
                          <td className="p-2.5 font-medium text-[#334155]">{row.name}</td>
                          <td className="p-2.5 text-[#516278]">{row.email || "—"}</td>
                          <td className="p-2.5">
                            <span className="font-semibold uppercase text-[11px] text-[#516278]">
                              {row.role}
                            </span>
                          </td>
                          <td className="p-2.5">
                            {isRowValid ? (
                              <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                <CheckCircle2 size={13} />
                                Hợp lệ
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-bold text-rose-700">
                                <AlertTriangle size={13} />
                                {issue}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Nút hành động nạp dữ liệu thông minh */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                <div className="text-xs text-[#64748b]">
                  {invalidCount > 0 ? (
                    <span className="text-amber-800 font-semibold">
                      Lưu ý: Có {invalidCount} dòng bị lỗi. Khi xác nhận, hệ thống sẽ tự động bỏ qua các dòng lỗi và chỉ tạo {validCsvRows.length} tài khoản hợp lệ.
                    </span>
                  ) : (
                    <span className="text-emerald-800 font-semibold">
                      Toàn bộ {csvRows.length} dòng tài khoản đều hợp lệ và sẵn sàng nạp.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCsvRows([]);
                      setFileName("");
                    }}
                    className="h-11 rounded-xl border border-[#cbd5df] bg-white px-4 text-xs font-bold text-[#64748b] hover:bg-slate-50 transition-colors"
                  >
                    Hủy tệp này
                  </button>

                  <button
                    type="button"
                    disabled={isSubmitting || validCsvRows.length === 0}
                    onClick={handleImportValidRows}
                    className="h-11 inline-flex items-center gap-2 rounded-xl bg-[#1d4f88] px-5 text-xs font-bold text-white hover:bg-[#153b66] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
                  >
                    {isSubmitting ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={15} />
                    )}
                    <span>
                      {invalidCount > 0
                        ? `Xác nhận nạp ${validCsvRows.length} tài khoản hợp lệ`
                        : `Xác nhận nạp toàn bộ ${csvRows.length} tài khoản`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Kết quả sau khi nạp */}
          {importResult && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-4 space-y-2">
              <div className="font-bold text-sm text-emerald-950 flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-700" />
                Đã nạp thành công {importResult.successCount}/{importResult.total} tài khoản.
              </div>
              {importResult.failedCount > 0 && (
                <div className="text-xs text-rose-800 space-y-1 pt-1 border-t border-emerald-200">
                  <div className="font-bold">Chi tiết dòng không nạp được:</div>
                  {importResult.results
                    .filter((r) => r.status === "failed")
                    .map((r) => (
                      <div key={r.row}>
                        Dòng {r.row} · Tài khoản {r.username}: {r.message}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* DIALOG 1: TẠO TÀI KHOẢN MỚI */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-lg p-6 bg-white rounded-2xl border border-[#d3dbe4] shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-editorial text-2xl font-semibold text-[#142747]">
              Tạo tài khoản quản trị
            </DialogTitle>
            <DialogDescription className="text-xs text-[#64748b]">
              Điền thông tin nhân sự và thiết lập vai trò thẩm quyền trong hệ thống.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-4 mt-2">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                Tên đăng nhập <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={createForm.username}
                onChange={(e) => setCreateForm({ ...createForm, username: e.target.value.trim() })}
                placeholder="VD: nguyenvanan"
                className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-semibold text-[#142747] outline-none focus:border-[#1d4f88]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                Họ và tên <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="VD: Nguyễn Văn An"
                className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-semibold text-[#142747] outline-none focus:border-[#1d4f88]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                  Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value.trim() })}
                  placeholder="an.nguyen@example.com"
                  className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-semibold text-[#142747] outline-none focus:border-[#1d4f88]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                  Số điện thoại
                </label>
                <input
                  type="text"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value.trim() })}
                  placeholder="0912345678"
                  className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-semibold text-[#142747] outline-none focus:border-[#1d4f88]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                Vai trò phân quyền <span className="text-rose-500">*</span>
              </label>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as any })}
                className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-bold text-[#142747] outline-none focus:border-[#1d4f88]"
              >
                <option value="staff">Chuyên viên — Quản lý văn bản và đối chiếu</option>
                <option value="admin">Quản trị viên — Toàn quyền hệ thống</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                  Mật khẩu khởi tạo <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setCreateForm({ ...createForm, password: makeStrongPassword() })
                  }
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#1d4f88] hover:underline"
                >
                  <KeyRound size={12} />
                  Tạo mật khẩu mạnh
                </button>
              </div>
              <input
                type="text"
                required
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                placeholder="Tối thiểu 8 ký tự"
                className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-mono font-semibold text-[#142747] outline-none focus:border-[#1d4f88]"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#edf1f4]">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="h-10 rounded-xl border border-[#cbd5df] px-4 text-xs font-bold text-[#64748b] hover:bg-slate-50 transition-colors"
              >
                Hủy bỏ
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="h-10 inline-flex items-center gap-2 rounded-xl bg-[#1d4f88] px-5 text-xs font-bold text-white hover:bg-[#153b66] transition-colors disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Tạo tài khoản
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: CHỈNH SỬA TÀI KHOẢN */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg p-6 bg-white rounded-2xl border border-[#d3dbe4] shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-editorial text-2xl font-semibold text-[#142747]">
              Chỉnh sửa tài khoản
            </DialogTitle>
            <DialogDescription className="text-xs text-[#64748b]">
              Cập nhật thông tin cá nhân, vai trò thẩm quyền hoặc cấp mật khẩu mới.
            </DialogDescription>
          </DialogHeader>

          {editForm && (
            <form onSubmit={handleUpdateUser} className="space-y-4 mt-2">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                  Tên đăng nhập · Cố định
                </label>
                <input
                  type="text"
                  disabled
                  value={editForm.username}
                  className="mt-1 w-full rounded-xl border border-[#e2e8f0] bg-slate-100 p-2.5 text-sm font-mono font-bold text-[#64748b] cursor-not-allowed outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                  Họ và tên <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-semibold text-[#142747] outline-none focus:border-[#1d4f88]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value.trim() })}
                    placeholder="email@example.com"
                    className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-semibold text-[#142747] outline-none focus:border-[#1d4f88]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                    Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value.trim() })}
                    placeholder="0912345678"
                    className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-semibold text-[#142747] outline-none focus:border-[#1d4f88]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                  Vai trò phân quyền
                </label>
                <select
                  disabled={editForm.username === "admin"}
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value as any })}
                  className="mt-1 w-full rounded-xl border border-[#cbd5df] bg-white p-2.5 text-sm font-bold text-[#142747] outline-none focus:border-[#1d4f88] disabled:bg-slate-100 disabled:cursor-not-allowed"
                >
                  <option value="staff">Chuyên viên — Quản lý văn bản và đối chiếu</option>
                  <option value="admin">Quản trị viên — Toàn quyền hệ thống</option>
                </select>
                {editForm.username === "admin" && (
                  <p className="mt-1 text-[11px] text-[#8a785d] font-medium">
                    Không thể thay đổi vai trò của tài khoản Quản trị viên hệ thống mặc định.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-[#e2e8f0] bg-slate-50/70 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#64748b]">
                    Đổi mật khẩu mới · Tùy chọn
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setEditForm({ ...editForm, newPassword: makeStrongPassword() })
                    }
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#1d4f88] hover:underline"
                  >
                    <KeyRound size={12} />
                    Tạo mật khẩu ngẫu nhiên
                  </button>
                </div>
                <input
                  type="text"
                  value={editForm.newPassword}
                  onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })}
                  placeholder="Để trống nếu muốn giữ nguyên mật khẩu cũ"
                  className="w-full rounded-xl border border-[#cbd5df] bg-white p-2 text-sm font-mono text-[#142747] outline-none focus:border-[#1d4f88]"
                />
                {editForm.newPassword && (
                  <div className="flex items-center justify-between text-[11px] text-[#64748b]">
                    <span>Mật khẩu mới đã sẵn sàng. Hãy lưu ý sao chép gửi cho nhân viên.</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(editForm.newPassword);
                        alert("Đã sao chép mật khẩu mới vào clipboard.");
                      }}
                      className="inline-flex items-center gap-1 font-bold text-[#1d4f88] hover:underline"
                    >
                      <Copy size={11} />
                      Sao chép
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#edf1f4]">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="h-10 rounded-xl border border-[#cbd5df] px-4 text-xs font-bold text-[#64748b] hover:bg-slate-50 transition-colors"
                >
                  Hủy bỏ
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-10 inline-flex items-center gap-2 rounded-xl bg-[#1d4f88] px-5 text-xs font-bold text-white hover:bg-[#153b66] transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                  Lưu thay đổi
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
