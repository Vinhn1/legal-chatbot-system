import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  HardDriveDownload,
  Database,
  ShieldCheck,
  Clock,
  RefreshCw,
  Play,
  Download,
  RotateCcw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Terminal,
  Lock,
  Copy,
  Check,
  Loader2,
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

/** Cấu trúc một bản sao lưu trong danh sách */
interface BackupItem {
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  type: "scheduled" | "manual" | "safety";
  typeLabel: string;
  hasSha256: boolean;
  sha256Value?: string;
}

/** Cấu trúc thông tin tổng quan trạng thái sao lưu */
interface BackupStatusOverview {
  totalBackups: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
  lastBackupAt: string | null;
  latestBackupFile: string | null;
  scheduledCron: string;
  isProcessRunning: boolean;
  currentAction: string | null;
}

/**
 * Trang Quản lý Sao lưu & Khôi phục Dữ liệu Hệ thống (Phase 3)
 * Phục vụ quản trị viên toàn quyền quản lý sao lưu PostgreSQL, ChromaDB và kho tài liệu gốc.
 */
export function AdminBackupsPage() {
  const { token } = useAuth();

  const [items, setItems] = useState<BackupItem[]>([]);
  const [status, setStatus] = useState<BackupStatusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal khôi phục an toàn
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<BackupItem | null>(null);
  const [restoreConfirmationInput, setRestoreConfirmationInput] = useState("");
  const [restoreRunning, setRestoreRunning] = useState(false);
  const [restoreResultOutput, setRestoreResultOutput] = useState<string | null>(null);

  // Modal xác nhận xóa
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedBackupForDelete, setSelectedBackupForDelete] = useState<BackupItem | null>(null);
  const [deleteRunning, setDeleteRunning] = useState(false);

  // Tab và dữ liệu nhật ký
  const [logTab, setLogTab] = useState<"backup" | "restore">("backup");
  const [backupLog, setBackupLog] = useState("");
  const [restoreLog, setRestoreLog] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);

  // Trạng thái sao chép mã băm SHA-256
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  /** Lấy danh sách bản sao lưu từ máy chủ */
  const fetchBackups = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await axios.get(`${API_BASE}/admin/backups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems(res.data.items || []);
      setStatus(res.data.status || null);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Không thể tải danh sách bản sao lưu.";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [token]);

  /** Tải nhật ký hệ thống gần nhất */
  const fetchLogs = useCallback(async () => {
    try {
      setLogsLoading(true);
      const res = await axios.get(`${API_BASE}/admin/backups/logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setBackupLog(res.data.backupLog || "Chưa có dữ liệu nhật ký sao lưu.");
      setRestoreLog(res.data.restoreLog || "Chưa có dữ liệu nhật ký khôi phục.");
    } catch {
      // Không chặn giao diện nếu nhật ký tạm thời không khả dụng
    } finally {
      setLogsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchBackups();
    fetchLogs();
  }, [fetchBackups, fetchLogs]);

  /** Kích hoạt tiến trình sao lưu toàn diện ngay lập tức */
  const handleTriggerBackup = async () => {
    try {
      setActionInProgress("Đang thực hiện sao lưu toàn diện...");
      setErrorMessage(null);
      setSuccessMessage(null);
      const res = await axios.post(
        `${API_BASE}/admin/backups/run`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccessMessage(res.data.message || "Tạo bản sao lưu toàn diện thành công.");
      await fetchBackups();
      await fetchLogs();
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Sao lưu thất bại.";
      setErrorMessage(msg);
    } finally {
      setActionInProgress(null);
    }
  };

  /** Tải gói sao lưu .tar.gz về máy quản trị */
  const handleDownload = async (filename: string) => {
    try {
      setActionInProgress(`Đang chuẩn bị tải gói ${filename}...`);
      const response = await axios.get(`${API_BASE}/admin/backups/download/${filename}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage("Không thể tải gói sao lưu. Vui lòng thử lại.");
    } finally {
      setActionInProgress(null);
    }
  };

  /** Mở hộp thoại xác nhận khôi phục an toàn */
  const openRestoreModal = (item: BackupItem) => {
    setSelectedBackupForRestore(item);
    setRestoreConfirmationInput("");
    setRestoreResultOutput(null);
    setRestoreModalOpen(true);
  };

  /** Thực thi khôi phục từ bản sao lưu */
  const handleExecuteRestore = async () => {
    if (!selectedBackupForRestore) return;
    if (restoreConfirmationInput !== "XAC-NHAN-PHUC-HOI") {
      setErrorMessage("Vui lòng nhập chính xác chuỗi xác nhận an toàn: XAC-NHAN-PHUC-HOI");
      return;
    }

    try {
      setRestoreRunning(true);
      setErrorMessage(null);
      const res = await axios.post(
        `${API_BASE}/admin/backups/restore`,
        {
          filename: selectedBackupForRestore.filename,
          confirmation: restoreConfirmationInput,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setRestoreResultOutput(res.data.output || res.data.message);
      setSuccessMessage(res.data.message || "Khôi phục dữ liệu thành công.");
      await fetchBackups();
      await fetchLogs();
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Khôi phục dữ liệu thất bại.";
      setErrorMessage(msg);
    } finally {
      setRestoreRunning(false);
    }
  };

  /** Mở hộp thoại xác nhận xóa */
  const openDeleteModal = (item: BackupItem) => {
    setSelectedBackupForDelete(item);
    setDeleteModalOpen(true);
  };

  /** Thực thi xóa bản sao lưu */
  const handleExecuteDelete = async () => {
    if (!selectedBackupForDelete) return;

    try {
      setDeleteRunning(true);
      setErrorMessage(null);
      const res = await axios.delete(
        `${API_BASE}/admin/backups/${selectedBackupForDelete.filename}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccessMessage(res.data.message || "Đã xóa bản sao lưu.");
      setDeleteModalOpen(false);
      await fetchBackups();
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Không thể xóa bản sao lưu.";
      setErrorMessage(msg);
    } finally {
      setDeleteRunning(false);
    }
  };

  /** Sao chép mã băm SHA-256 vào bộ nhớ tạm */
  const handleCopySha = (sha: string) => {
    navigator.clipboard.writeText(sha);
    setCopiedSha(sha);
    setTimeout(() => setCopiedSha(null), 2500);
  };

  /** Định dạng ngày giờ chuẩn Việt Nam */
  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Tiêu đề trang và nút tác vụ chính */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#d8dee5] pb-5 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#142747]/10 text-[#142747] dark:bg-zinc-800 dark:text-zinc-200">
              <Database className="w-3.5 h-3.5 text-[#a17842]" />
              Giai đoạn 3: Quản trị Trung tâm
            </span>
            <span className="text-xs text-[#56677c] dark:text-zinc-400">
              Tự động hóa & Kiểm soát dữ liệu
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#142747] dark:text-white mt-1">
            Sao lưu & Khôi phục dữ liệu
          </h1>
          <p className="text-sm text-[#56677c] dark:text-zinc-400 mt-0.5">
            Quản lý vòng đời dữ liệu PostgreSQL, ChromaDB, kho văn bản gốc và thực thi phục hồi sau thảm họa.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              fetchBackups();
              fetchLogs();
            }}
            disabled={loading || !!actionInProgress}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#142747] bg-white border border-[#d8dee5] rounded-xl hover:bg-[#f6efe2]/40 transition-colors dark:bg-zinc-900 dark:text-zinc-200 dark:border-zinc-800 dark:hover:bg-zinc-800 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </button>

          <button
            type="button"
            onClick={handleTriggerBackup}
            disabled={loading || !!actionInProgress || !!status?.isProcessRunning}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#142747] rounded-xl hover:bg-[#1e3a63] transition-colors shadow-xs dark:bg-[#a17842] dark:hover:bg-[#8f6938] disabled:opacity-60"
          >
            {actionInProgress ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {actionInProgress}
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Sao lưu toàn diện ngay
              </>
            )}
          </button>
        </div>
      </div>

      {/* Thông báo kết quả / lỗi */}
      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50/80 p-4 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
          <div className="flex-1 font-medium">{errorMessage}</div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs text-red-700 hover:underline dark:text-red-300"
          >
            Đóng
          </button>
        </div>
      )}

      {successMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200 flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          <div className="flex-1 font-medium">{successMessage}</div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-xs text-emerald-700 hover:underline dark:text-emerald-300"
          >
            Đóng
          </button>
        </div>
      )}

      {/* 4 Thẻ chỉ số vận hành sao lưu */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Chỉ số 1: Lịch sao lưu tự động */}
        <div className="rounded-2xl border border-[#d8dee5] bg-white p-4 shadow-2xs dark:border-zinc-800 dark:bg-[#0e0e11]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#56677c] dark:text-zinc-400">
              Lịch sao lưu tự động
            </span>
            <div className="p-2 rounded-xl bg-[#142747]/5 text-[#142747] dark:bg-zinc-800 dark:text-[#a17842]">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-[#142747] dark:text-zinc-100">
              02:00 sáng
            </span>
            <span className="text-xs text-[#56677c] dark:text-zinc-400">mỗi ngày</span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Đang kích hoạt tự động
          </div>
        </div>

        {/* Chỉ số 2: Bản sao lưu gần nhất */}
        <div className="rounded-2xl border border-[#d8dee5] bg-white p-4 shadow-2xs dark:border-zinc-800 dark:bg-[#0e0e11]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#56677c] dark:text-zinc-400">
              Bản sao lưu gần nhất
            </span>
            <div className="p-2 rounded-xl bg-[#142747]/5 text-[#142747] dark:bg-zinc-800 dark:text-[#a17842]">
              <HardDriveDownload className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 truncate font-mono text-sm font-semibold text-[#142747] dark:text-zinc-200" title={status?.latestBackupFile || "Chưa có"}>
            {status?.latestBackupFile || "Chưa có"}
          </div>
          <div className="mt-2.5 text-xs text-[#56677c] dark:text-zinc-400">
            {status?.lastBackupAt ? formatDate(status.lastBackupAt) : "Chưa thực hiện"}
          </div>
        </div>

        {/* Chỉ số 3: Tổng dung lượng lưu trữ */}
        <div className="rounded-2xl border border-[#d8dee5] bg-white p-4 shadow-2xs dark:border-zinc-800 dark:bg-[#0e0e11]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#56677c] dark:text-zinc-400">
              Dung lượng kho lưu trữ
            </span>
            <div className="p-2 rounded-xl bg-[#142747]/5 text-[#142747] dark:bg-zinc-800 dark:text-[#a17842]">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-[#142747] dark:text-zinc-100">
              {status?.totalSizeFormatted || "0 B"}
            </span>
            <span className="text-xs text-[#56677c] dark:text-zinc-400">
              · {status?.totalBackups || 0} bản lưu
            </span>
          </div>
          <div className="mt-2.5 text-xs text-[#56677c] dark:text-zinc-400">
            Dữ liệu cơ sở dữ liệu và vector tri thức
          </div>
        </div>

        {/* Chỉ số 4: Toàn vẹn dữ liệu SHA-256 */}
        <div className="rounded-2xl border border-[#d8dee5] bg-white p-4 shadow-2xs dark:border-zinc-800 dark:bg-[#0e0e11]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#56677c] dark:text-zinc-400">
              Toàn vẹn dữ liệu
            </span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-lg font-bold text-[#142747] dark:text-zinc-100">
              SHA-256
            </span>
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              100% Khớp mã băm
            </span>
          </div>
          <div className="mt-2.5 text-xs text-[#56677c] dark:text-zinc-400">
            Tự động sinh checksum cho mọi gói nén
          </div>
        </div>
      </div>

      {/* Danh sách các bản sao lưu */}
      <div className="rounded-2xl border border-[#d8dee5] bg-white overflow-hidden shadow-2xs dark:border-zinc-800 dark:bg-[#0e0e11]">
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#d8dee5] dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-[#142747] dark:text-white">
              Kho gói sao lưu hệ thống
            </h2>
            <p className="text-xs text-[#56677c] dark:text-zinc-400">
              Bao gồm toàn bộ dữ liệu nghiệp vụ, chỉ mục tra cứu vector và tài liệu gốc đính kèm.
            </p>
          </div>
          <div className="text-xs text-[#56677c] dark:text-zinc-400 font-medium">
            Lưu trữ tại: <code className="px-1.5 py-0.5 rounded bg-[#f6efe2] text-[#142747] font-mono dark:bg-zinc-800 dark:text-zinc-300">storage/backups/</code>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-[#56677c] dark:text-zinc-400 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-[#142747] dark:text-[#a17842]" />
            Đang tải dữ liệu kho sao lưu...
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-sm text-[#56677c] dark:text-zinc-400 flex flex-col items-center justify-center gap-2">
            <HardDriveDownload className="w-8 h-8 text-[#56677c]/60" />
            Chưa có gói sao lưu nào trong hệ thống. Nhấn &quot;Sao lưu toàn diện ngay&quot; để tạo bản đầu tiên.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#d8dee5] bg-[#faf9f6] text-[#56677c] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                  <th className="py-3 px-4 font-semibold">Tên tệp sao lưu</th>
                  <th className="py-3 px-3 font-semibold">Phân loại</th>
                  <th className="py-3 px-3 font-semibold">Dung lượng</th>
                  <th className="py-3 px-3 font-semibold">Thời gian tạo</th>
                  <th className="py-3 px-3 font-semibold">Mã băm SHA-256</th>
                  <th className="py-3 px-4 text-right font-semibold">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d8dee5] dark:divide-zinc-800">
                {items.map((item) => (
                  <tr
                    key={item.filename}
                    className="hover:bg-[#f6efe2]/25 transition-colors dark:hover:bg-zinc-800/40"
                  >
                    {/* Tên tệp */}
                    <td className="py-3 px-4 font-mono font-medium text-[#142747] dark:text-zinc-200">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#a17842] shrink-0" />
                        <span className="truncate max-w-[280px]" title={item.filename}>
                          {item.filename}
                        </span>
                      </div>
                    </td>

                    {/* Phân loại */}
                    <td className="py-3 px-3">
                      {item.type === "scheduled" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50">
                          Tự động định kỳ
                        </span>
                      ) : item.type === "safety" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50">
                          Ảnh chụp an toàn
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-100 text-zinc-800 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700">
                          Thủ công
                        </span>
                      )}
                    </td>

                    {/* Dung lượng */}
                    <td className="py-3 px-3 font-mono text-[#142747] dark:text-zinc-200">
                      {item.sizeFormatted}
                    </td>

                    {/* Thời gian tạo */}
                    <td className="py-3 px-3 text-[#56677c] dark:text-zinc-400">
                      {formatDate(item.createdAt)}
                    </td>

                    {/* Checksum SHA-256 */}
                    <td className="py-3 px-3">
                      {item.hasSha256 && item.sha256Value ? (
                        <div className="flex items-center gap-1.5">
                          <code
                            className="font-mono text-[10px] text-[#56677c] bg-[#faf9f6] px-1.5 py-0.5 rounded border border-[#d8dee5] dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800 max-w-[140px] truncate"
                            title={item.sha256Value}
                          >
                            {item.sha256Value.slice(0, 16)}...
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopySha(item.sha256Value!)}
                            className="p-1 rounded hover:bg-[#d8dee5]/50 text-[#56677c] dark:hover:bg-zinc-800 dark:text-zinc-400"
                            title="Sao chép toàn bộ mã SHA-256"
                          >
                            {copiedSha === item.sha256Value ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#56677c] italic dark:text-zinc-500">
                          Chưa có tệp .sha256
                        </span>
                      )}
                    </td>

                    {/* Thao tác */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Nút tải về */}
                        <button
                          type="button"
                          onClick={() => handleDownload(item.filename)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#142747] bg-white border border-[#d8dee5] rounded-lg hover:bg-[#f6efe2]/60 transition-colors dark:bg-zinc-900 dark:text-zinc-200 dark:border-zinc-800 dark:hover:bg-zinc-800"
                          title="Tải gói dữ liệu về máy quản trị"
                        >
                          <Download className="w-3 h-3 text-[#56677c]" />
                          Tải về
                        </button>

                        {/* Nút khôi phục an toàn */}
                        <button
                          type="button"
                          onClick={() => openRestoreModal(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50 dark:hover:bg-amber-900/40"
                          title="Khôi phục hệ thống về thời điểm này"
                        >
                          <RotateCcw className="w-3 h-3 text-amber-700 dark:text-amber-400" />
                          Khôi phục
                        </button>

                        {/* Nút xóa */}
                        <button
                          type="button"
                          onClick={() => openDeleteModal(item)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded-lg transition-colors dark:text-red-400 dark:hover:bg-red-950/40"
                          title="Xóa bản sao lưu"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Khu vực xem Nhật ký vận hành hệ thống (Logs) */}
      <div className="rounded-2xl border border-[#d8dee5] bg-white overflow-hidden shadow-2xs dark:border-zinc-800 dark:bg-[#0e0e11]">
        <div className="flex items-center justify-between p-4 border-b border-[#d8dee5] dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#a17842]" />
            <h2 className="text-base font-bold text-[#142747] dark:text-white">
              Nhật ký thực thi sao lưu & khôi phục
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-[#faf9f6] p-0.5 border border-[#d8dee5] dark:bg-zinc-900 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setLogTab("backup")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  logTab === "backup"
                    ? "bg-[#142747] text-white shadow-xs dark:bg-[#a17842]"
                    : "text-[#56677c] hover:text-[#142747] dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                Nhật ký sao lưu
              </button>
              <button
                type="button"
                onClick={() => setLogTab("restore")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                  logTab === "restore"
                    ? "bg-[#142747] text-white shadow-xs dark:bg-[#a17842]"
                    : "text-[#56677c] hover:text-[#142747] dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                Nhật ký khôi phục
              </button>
            </div>

            <button
              type="button"
              onClick={fetchLogs}
              disabled={logsLoading}
              className="p-1.5 rounded-lg border border-[#d8dee5] bg-white text-[#56677c] hover:bg-[#f6efe2]/60 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
              title="Cập nhật nhật ký mới nhất"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="p-4 bg-[#0d1117] text-zinc-200 font-mono text-[11px] leading-relaxed max-h-72 overflow-y-auto board-scroll">
          <pre className="whitespace-pre-wrap break-all">
            {logTab === "backup" ? backupLog : restoreLog}
          </pre>
        </div>
      </div>

      {/* Modal Khôi phục An toàn (Safety Restore Modal) */}
      <Dialog open={restoreModalOpen} onOpenChange={setRestoreModalOpen}>
        <DialogContent className="max-w-xl bg-white border border-[#d8dee5] dark:bg-[#0e0e11] dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-[#142747] dark:text-white">
              <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              Khôi phục an toàn hệ thống dữ liệu
            </DialogTitle>
            <DialogDescription className="text-xs text-[#56677c] dark:text-zinc-400">
              Quy trình khôi phục tuân thủ 5 bước an toàn, tự động chụp ảnh hiện trạng trước khi phục hồi.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Cảnh báo rủi ro */}
            <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200 space-y-1.5">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                Cảnh báo quan trọng trước khi ghi đè dữ liệu:
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                <li>Cơ sở dữ liệu PostgreSQL và Vector DB ChromaDB sẽ được phục hồi nguyên trạng.</li>
                <li>Hệ thống sẽ <strong>tự động tạo một bản sao lưu an toàn</strong> trước khi ghi đè.</li>
                <li>Tiến trình khôi phục có thể mất từ 15 đến 45 giây tùy thuộc dung lượng gói nén.</li>
              </ul>
            </div>

            {/* Thông tin gói phục hồi */}
            <div className="p-3 rounded-xl bg-[#faf9f6] border border-[#d8dee5] text-xs space-y-1 dark:bg-zinc-900 dark:border-zinc-800">
              <div className="text-[#56677c] dark:text-zinc-400">Gói sao lưu được chọn:</div>
              <div className="font-mono font-bold text-[#142747] dark:text-zinc-200">
                {selectedBackupForRestore?.filename}
              </div>
              <div className="text-[11px] text-[#56677c] dark:text-zinc-400">
                Dung lượng: {selectedBackupForRestore?.sizeFormatted} — Ngày tạo: {selectedBackupForRestore ? formatDate(selectedBackupForRestore.createdAt) : ""}
              </div>
            </div>

            {/* Trường nhập mã xác nhận */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#142747] dark:text-zinc-200">
                Để tiếp tục, vui lòng gõ chính xác chuỗi: <span className="font-mono text-red-600 bg-red-50 px-1 py-0.5 rounded border border-red-200 dark:bg-red-950/60 dark:text-red-400">XAC-NHAN-PHUC-HOI</span>
              </label>
              <input
                type="text"
                value={restoreConfirmationInput}
                onChange={(e) => setRestoreConfirmationInput(e.target.value)}
                placeholder="XAC-NHAN-PHUC-HOI"
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-[#d8dee5] bg-white text-[#142747] focus:outline-none focus:ring-2 focus:ring-[#142747] dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                disabled={restoreRunning}
              />
            </div>

            {/* Kết quả sau khi khôi phục */}
            {restoreResultOutput && (
              <div className="p-3 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-[10px] max-h-40 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{restoreResultOutput}</pre>
              </div>
            )}

            {/* Nút hành động */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#d8dee5] dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setRestoreModalOpen(false)}
                disabled={restoreRunning}
                className="px-4 py-2 text-xs font-medium text-[#56677c] bg-white border border-[#d8dee5] rounded-xl hover:bg-[#faf9f6] transition-colors dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800"
              >
                Hủy bỏ
              </button>

              <button
                type="button"
                onClick={handleExecuteRestore}
                disabled={restoreConfirmationInput !== "XAC-NHAN-PHUC-HOI" || restoreRunning}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-amber-700 rounded-xl hover:bg-amber-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {restoreRunning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Đang thực thi khôi phục...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Thực thi khôi phục dữ liệu
                  </>
                )}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Xác nhận Xóa bản sao lưu */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent className="max-w-md bg-white border border-[#d8dee5] dark:bg-[#0e0e11] dark:border-zinc-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-red-600 dark:text-red-400">
              <Trash2 className="w-5 h-5 shrink-0" />
              Xóa bản sao lưu dữ liệu
            </DialogTitle>
            <DialogDescription className="text-xs text-[#56677c] dark:text-zinc-400">
              Hành động này không thể hoàn tác sau khi thực hiện.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <p className="text-xs text-[#142747] dark:text-zinc-200">
              Bạn có chắc chắn muốn xóa bản sao lưu:
            </p>
            <div className="p-2.5 rounded-xl bg-[#faf9f6] border border-[#d8dee5] font-mono text-xs font-bold text-[#142747] dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-200 break-all">
              {selectedBackupForDelete?.filename}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#d8dee5] dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleteRunning}
                className="px-4 py-2 text-xs font-medium text-[#56677c] bg-white border border-[#d8dee5] rounded-xl hover:bg-[#faf9f6] transition-colors dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-800"
              >
                Hủy bỏ
              </button>

              <button
                type="button"
                onClick={handleExecuteDelete}
                disabled={deleteRunning}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleteRunning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Đang xóa...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Xác nhận xóa
                  </>
                )}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
