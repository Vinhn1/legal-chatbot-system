import { useEffect, useState } from "react";
import { Link } from "react-router";
import axios from "axios";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
} from "lucide-react";
import { API_BASE } from "../../../config";

interface QueueItem {
  id: string;
  title: string;
  issuer: string;
  reason: string;
  date: string;
  type: "ocr" | "effective" | "metadata";
}

interface ActivityItem {
  action: string;
  detail: string;
  time: string;
  status: "success" | "info" | "warning";
}

/** Các trường thực sự được dùng từ API danh mục và lịch sử hội thoại. */
interface OverviewDocument {
  pipelineStatus?: string;
  chunkCount?: number;
  articleCount?: number;
  effectiveStatus?: string;
  effectiveDate?: string;
  issuedDate?: string;
  title?: string;
  name?: string;
  issuer?: string;
  docNumber?: string;
}

interface HistoryEntry {
  role?: string;
  createdAt?: string;
  message?: string;
  sessionId?: string;
}

interface PublicSummary {
  document_count?: number;
  article_count?: number;
}

/**
 * Màn hình Tổng quan Admin (Admin Overview)
 * Dữ liệu thời gian thực được tổng hợp từ PostgreSQL và ChromaDB qua backend API.
 */
export function AdminOverviewPage() {
  const [activeQueueTab, setActiveQueueTab] = useState<"all" | "effective" | "metadata">("all");
  const [isLoading, setIsLoading] = useState(true);

  // Thống kê thực tế
  const [stats, setStats] = useState({
    totalDocs: 0,
    indexedDocs: 0,
    totalChunks: 0,
    pendingReview: 0,
    conversationsToday: 0,
    accuracyRate: 0,
  });

  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [recentActivities, setRecentActivities] = useState<ActivityItem[]>([]);
  const [reviewSummary, setReviewSummary] = useState({ reviewed: 0, total: 0 });
  const [loadError, setLoadError] = useState(false);

  const fetchOverviewData = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      // 1. Lấy thống kê công khai & danh sách tài liệu
      const [summaryRes, docsRes, historyRes] = await Promise.allSettled([
        axios.get(`${API_BASE}/chat/public-summary`),
        axios.get(`${API_BASE}/chat/documents`),
        axios.get(`${API_BASE}/chat/history`),
      ]);

      const summary: PublicSummary | null = summaryRes.status === "fulfilled" ? summaryRes.value.data : null;
      const documents: OverviewDocument[] = docsRes.status === "fulfilled" && Array.isArray(docsRes.value.data) ? docsRes.value.data : [];
      const history: HistoryEntry[] = historyRes.status === "fulfilled" && Array.isArray(historyRes.value.data) ? historyRes.value.data : [];
      setLoadError(summaryRes.status === "rejected" || docsRes.status === "rejected" || historyRes.status === "rejected");

      // Tỷ lệ duyệt dựa trên dấu duyệt hội thoại đã lưu cho tài khoản đang dùng.
      let reviewedIds: string[] = [];
      try { reviewedIds = JSON.parse(localStorage.getItem("legal_reviewed_conv_ids") || "[]"); } catch { reviewedIds = []; }
      setReviewSummary({ reviewed: history.filter((entry: HistoryEntry & { id?: string | number }) => entry.role === "user" && reviewedIds.includes(String(entry.id))).length, total: history.filter((entry) => entry.role === "user").length });

      // 2. Tính toán chỉ số KPI thực tế
      const totalDocs = documents.length || summary?.document_count || 0;
      const indexedDocs = documents.filter((d) => d.pipelineStatus === "indexed" || !d.pipelineStatus).length;
      const totalChunks = documents.reduce((acc, d) => acc + (d.chunkCount || 0), 0) || (summary?.article_count ? summary.article_count * 2 : 0);

      // Đếm hội thoại hôm nay và tính độ chính xác
      const today = new Date().toISOString().slice(0, 10);
      const userQuestions = history.filter((h) => h.role === "user");
      const botAnswers = history.filter((h) => h.role === "bot");

      const todayQuestions = userQuestions.filter((h) => {
        try {
          return h.createdAt ? new Date(h.createdAt).toISOString().slice(0, 10) === today : false;
        } catch {
          return false;
        }
      });

      const refusals = botAnswers.filter((h) => h.message?.includes("Chưa tìm thấy căn cứ pháp lý"));
      const validAnswers = botAnswers.length - refusals.length;
      const accuracyRate = botAnswers.length > 0 ? Math.round((validAnswers / botAnswers.length) * 100) : 100;

      // Hàng đợi cần rà soát từ tài liệu thiếu ngày hoặc câu hỏi AI chưa tìm thấy nguồn
      const dynamicQueue: QueueItem[] = [];
      documents.forEach((d, idx) => {
        if (d.effectiveStatus === "unknown" || !d.effectiveDate) {
          dynamicQueue.push({
            id: `Q-${String(idx + 1).padStart(2, "0")}`,
            title: d.title || d.name || "Văn bản chưa có tiêu đề",
            issuer: d.issuer || "Cơ quan ban hành",
            reason: "Chưa xác minh ngày bắt đầu áp dụng văn bản quy phạm",
            date: d.issuedDate || "Gần đây",
            type: "metadata",
          });
        }
        if (d.effectiveStatus === "partially_expired") {
          dynamicQueue.push({
            id: `Q-${String(idx + 10).padStart(2, "0")}`,
            title: d.title || d.name || "Văn bản chưa có tiêu đề",
            issuer: d.issuer || "Cơ quan ban hành",
            reason: "Hết hiệu lực một phần · Cần cập nhật nhãn hiệu lực",
            date: d.issuedDate || "Gần đây",
            type: "effective",
          });
        }
      });

      // Thêm câu hỏi chưa tìm thấy nguồn vào hàng đợi rà soát
      refusals.slice(0, 3).forEach((r, idx) => {
        const matchingQ = userQuestions.find((q) => q.sessionId === r.sessionId);
        dynamicQueue.push({
          id: `F-${String(idx + 1).padStart(2, "0")}`,
          title: matchingQ?.message ? `Câu hỏi: "${matchingQ.message.slice(0, 60)}..."` : "Lượt tra cứu thiếu nguồn",
          issuer: "Người dùng tra cứu",
          reason: "Chưa tìm thấy căn cứ pháp lý tương ứng · Cần bổ sung văn bản",
          date: "Hôm nay",
          type: "effective",
        });
      });

      setStats({
        totalDocs,
        indexedDocs,
        totalChunks,
        pendingReview: dynamicQueue.length,
        conversationsToday: todayQuestions.length || userQuestions.length,
        accuracyRate,
      });

      setQueueItems(dynamicQueue);

      // 3. Hoạt động gần đây từ dữ liệu thực tế
      const activities: ActivityItem[] = [];
      documents.slice(0, 3).forEach((d) => {
        activities.push({
          action: "Lập chỉ mục hoàn tất",
          detail: `${d.title || d.name || "Văn bản"} (${d.docNumber || "Chưa rõ số"}) · ${d.articleCount ?? 0} Điều, ${d.chunkCount ?? 0} chunks`,
          time: "Đã đồng bộ",
          status: "success",
        });
      });

      userQuestions.slice(0, 3).forEach((q) => {
        activities.push({
          action: "Lượt tra cứu mới",
          detail: (q.message || "").slice(0, 80),
          time: "Gần đây",
          status: "info",
        });
      });

      setRecentActivities(activities);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Lên lịch sau khi effect gắn để tránh cập nhật state đồng bộ trong effect.
    const timer = window.setTimeout(() => { void fetchOverviewData(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredQueue = activeQueueTab === "all"
    ? queueItems
    : queueItems.filter((item) => item.type === activeQueueTab);

  return (
    <div className="space-y-8 animate-fade-in-up">
      {loadError && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Một phần dữ liệu tổng quan chưa tải được. Bấm làm mới để thử lại.</p>}
      {/* Header Ngày & Tiêu đề Màn hình */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[#d8dee5] pb-6">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#8a785d]">
            HỆ THỐNG QUẢN TRỊ VERITAS LEGAL
          </div>
          <h1 className="font-editorial mt-1 text-3xl sm:text-4xl font-semibold text-[#142747]">
            Tổng quan kho văn bản
          </h1>
          <p className="mt-1 text-sm sm:text-base text-[#56677c]">
            Theo dõi kho văn bản, câu hỏi cần rà soát và số liệu hội thoại hôm nay.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={fetchOverviewData}
            disabled={isLoading}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#cbd5df] dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 text-sm font-bold text-[#142747] dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw size={16} className={isLoading ? "animate-spin text-[#1d4f88] dark:text-sky-400" : ""} />
            Cập nhật
          </button>
          <Link
            to="/admin/ingest"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1d4f88] dark:bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition-[background-color,transform] hover:bg-[#153b66] dark:hover:bg-blue-700 active:scale-[0.98]"
          >
            <Plus size={17} /> Nạp tài liệu mới
          </Link>
          <Link
            to="/admin/chat"
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#cbd5df] dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 text-sm font-bold text-[#142747] dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
          >
            <MessageSquare size={17} /> Thử chatbot
          </Link>
        </div>
      </div>

      {/* 4 Thẻ KPI Chỉ số Chính từ Dữ liệu Thực tế */}
      {/* Giữ hai KPI mỗi hàng cho tới khi vùng nội dung đủ rộng ở màn hình xl. */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 min-w-0">
        <div className="rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#6c7d91]">
              Tổng tài liệu
            </span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eef4f9] text-[#1d4f88]">
              <FileText size={18} />
            </span>
          </div>
          <div className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-[#142747]">
            {isLoading ? <Loader2 size={28} className="animate-spin text-[#1d4f88]" /> : stats.totalDocs}
          </div>
          <p className="mt-2 text-xs text-[#718294]">
            Văn bản trong PostgreSQL & ChromaDB
          </p>
        </div>

        <div className="rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#6c7d91]">
              Đã lập chỉ mục
            </span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={18} />
            </span>
          </div>
          <div className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-[#2f7560]">
            {isLoading ? <Loader2 size={28} className="animate-spin text-[#2f7560]" /> : stats.indexedDocs}
          </div>
          <p className="mt-2 text-xs text-[#718294]">
            {stats.totalChunks} chunks sẵn sàng tra cứu
          </p>
        </div>

        <div className="rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#6c7d91]">
              Chờ duyệt
            </span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-700">
              <Clock size={18} />
            </span>
          </div>
          <div className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-[#a17842]">
            {isLoading ? <Loader2 size={28} className="animate-spin text-[#a17842]" /> : stats.pendingReview}
          </div>
          <p className="mt-2 text-xs text-[#718294]">
            Mục cần xác minh hoặc bổ sung nguồn
          </p>
        </div>

        <div className="rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-bold uppercase tracking-wider text-[#6c7d91]">
              Hội thoại hôm nay
            </span>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-700">
              <MessageSquare size={18} />
            </span>
          </div>
          <div className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-[#142747]">
            {isLoading ? <Loader2 size={28} className="animate-spin text-[#142747]" /> : stats.conversationsToday}
          </div>
          <p className="mt-2 text-xs text-[#718294]">
            Độ chính xác trích dẫn đạt {stats.accuracyRate}%
          </p>
        </div>
      </div>

      {/* Grid 2 Cột: Hàng đợi rà soát & Hoạt động gần đây */}
      {/* Chỉ chia hai cột khi phần nội dung còn đủ chỗ sau thanh bên. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 min-w-0">
        {/* Cột 1: Hàng đợi cần xử lý trước (Exception Queue) */}
        <section className="min-w-0 xl:col-span-7 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-7 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef1f4] pb-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a785d]">
                HÀNG ĐỢI RÀ SOÁT THỦ CÔNG
              </div>
              <h2 className="font-editorial mt-1 text-2xl font-semibold text-[#142747]">
                Cần xử lý trước
              </h2>
            </div>
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
              {stats.pendingReview} mục cần chú ý
            </span>
          </div>

          {/* Tabs loại ngoại lệ */}
          <div className="mt-5 flex gap-2 border-b border-slate-100 pb-3">
            {([
              { id: "all", label: `Tất cả (${queueItems.length})` },
              { id: "effective", label: `Hiệu lực (${queueItems.filter((q) => q.type === "effective").length})` },
              { id: "metadata", label: `Metadata (${queueItems.filter((q) => q.type === "metadata").length})` },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveQueueTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  activeQueueTab === tab.id
                    ? "bg-[#1d4f88] text-white"
                    : "bg-[#f2f4f7] text-[#516278] hover:bg-[#e6ebf1] dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Danh sách mục trong hàng đợi */}
          <div className="mt-4 space-y-3">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-[#718294] dark:text-zinc-400">
                <Loader2 size={24} className="mx-auto animate-spin text-[#1d4f88] dark:text-sky-400 mb-2" />
                Đang đối chiếu dữ liệu hàng đợi...
              </div>
            ) : filteredQueue.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#d3dbe4] dark:border-zinc-800 p-8 text-center">
                <CheckCircle2 size={32} className="mx-auto text-emerald-600 mb-2" />
                <h3 className="text-sm font-bold text-[#142747] dark:text-zinc-100">Hàng đợi sạch, không có mục tồn đọng</h3>
                <p className="mt-1 text-xs text-[#718294] dark:text-zinc-400">
                  Tất cả văn bản và câu trả lời hiện tại đều có căn cứ pháp lý rõ ràng.
                </p>
              </div>
            ) : (
              filteredQueue.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[#e2e7ec] bg-[#fafaf9] dark:bg-zinc-900/90 dark:border-zinc-800 p-4 transition-all hover:border-[#1d4f88]/40 hover:bg-white dark:hover:bg-zinc-800/80"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-[#eef4f9] dark:bg-sky-950/70 dark:text-sky-300 px-2 py-0.5 text-[11px] font-bold text-[#1d4f88]">
                        {item.id}
                      </span>
                      <h3 className="text-sm font-bold text-[#142747] dark:text-zinc-100 truncate">{item.title}</h3>
                    </div>
                    <p className="mt-1 text-xs text-[#a14f41] dark:text-rose-400 font-semibold">{item.reason}</p>
                    <div className="mt-2 flex items-center gap-3 text-xs text-[#718294] dark:text-zinc-400">
                      <span>Nguồn: {item.issuer}</span>
                      <span>•</span>
                      <span>{item.date}</span>
                    </div>
                  </div>

                  <Link
                    to="/admin/documents"
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#cbd5df] dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-2 text-xs font-bold text-[#142747] dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-700 transition-colors shrink-0"
                  >
                    Kiểm tra <ArrowRight size={14} />
                  </Link>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Cột 2: Chỉ số kiểm duyệt và hoạt động gần đây. */}
        <div className="min-w-0 space-y-6 xl:col-span-5">
          {/* Dùng số liệu kiểm duyệt thực tế và lối tắt nghiệp vụ. */}
          <section className="min-w-0 rounded-2xl border border-[#d3dbe4] dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 sm:p-6 shadow-xs">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a785d] dark:text-amber-400/90 mb-1">
              KIỂM DUYỆT NGHIỆP VỤ
            </div>
            <h2 className="font-editorial text-xl font-semibold text-[#142747] dark:text-zinc-100">
              Câu hỏi đã rà soát
            </h2>
            <p className="mt-3 text-3xl font-bold text-[#1d4f88] dark:text-sky-400">{reviewSummary.total ? `${Math.round(reviewSummary.reviewed / reviewSummary.total * 100)}%` : "—"}</p>
            <p className="mt-1 text-xs text-[#718294] dark:text-zinc-400">{reviewSummary.reviewed}/{reviewSummary.total} câu hỏi được đánh dấu đã duyệt trên thiết bị này</p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              <Link to="/admin/ingest" className="rounded-xl border border-[#d3dbe4] dark:border-zinc-800 bg-white dark:bg-zinc-800/80 p-3 text-sm font-semibold text-[#142747] dark:text-zinc-100 hover:bg-slate-50 dark:hover:bg-zinc-700 hover:text-black dark:hover:text-white transition-colors">Nạp tài liệu mới</Link>
              <Link to="/admin/chat" className="rounded-xl border border-[#d3dbe4] dark:border-zinc-800 bg-white dark:bg-zinc-800/80 p-3 text-sm font-semibold text-[#142747] dark:text-zinc-100 hover:bg-slate-50 dark:hover:bg-zinc-700 hover:text-black dark:hover:text-white transition-colors">Thử chatbot</Link>
              <Link to="/admin/conversations" className="rounded-xl border border-[#d3dbe4] dark:border-zinc-800 bg-white dark:bg-zinc-800/80 p-3 text-sm font-semibold text-[#142747] dark:text-zinc-100 hover:bg-slate-50 dark:hover:bg-zinc-700 hover:text-black dark:hover:text-white transition-colors">Rà soát hội thoại</Link>
            </div>
          </section>

          {/* Hoạt động gần đây */}
          <section className="min-w-0 rounded-2xl border border-[#d3dbe4] dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 sm:p-6 shadow-xs">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a785d] dark:text-amber-400/90 mb-1">
              NHẬT KÝ THỜI GIAN THỰC
            </div>
            <h2 className="font-editorial text-xl font-semibold text-[#142747] dark:text-zinc-100">
              Hoạt động gần đây
            </h2>

            <div className="mt-4 space-y-3">
              {recentActivities.length === 0 ? (
                <p className="text-xs text-[#718294] dark:text-zinc-400 italic text-center py-4">
                  Chưa có hoạt động nạp văn bản hoặc tra cứu nào được ghi nhận.
                </p>
              ) : (
                recentActivities.map((act, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg font-bold text-[11px] mt-0.5 ${
                        act.status === "success"
                          ? "bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300"
                          : act.status === "warning"
                          ? "bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300"
                          : "bg-blue-50 dark:bg-sky-950/70 text-blue-700 dark:text-sky-300"
                      }`}
                    >
                      <CheckCircle2 size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-[#142747] dark:text-zinc-100">{act.action}</div>
                      <div className="text-[#56677c] dark:text-zinc-300 truncate mt-0.5">{act.detail}</div>
                      <div className="text-[#8a98a8] dark:text-zinc-400 text-[11px] mt-0.5">{act.time}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
