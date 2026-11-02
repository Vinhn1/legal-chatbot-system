import { useEffect, useState } from "react";
import axios from "axios";
import {
  Loader2,
  RefreshCw,
} from "lucide-react";
import { API_BASE } from "../../../config";

/**
 * Màn hình Thống kê Chất lượng Đối chiếu (Canvas Section 12)
 * Tính toán số liệu trực tiếp từ dữ liệu hội thoại và văn bản thực tế trong hệ thống.
 */
export function AdminAnalyticsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [unknownCount, setUnknownCount] = useState(0);
  const [stats, setStats] = useState({
    totalQuestions: 0,
    withCitations: 0,
    citationRate: null as number | null,
    refusalCount: 0,
    refusalRate: 0,
    totalDocuments: 0,
    unverifiedDocs: 0,
    verifiedDocsRate: null as number | null,
  });

  const fetchAnalytics = async () => {
    setIsLoading(true);
    try {
      // Một API lỗi phải hiện rõ phần thiếu dữ liệu, không đổi thành tỷ lệ 100%.
      setError("");
      const [analyticsRes, docsRes] = await Promise.allSettled([
        axios.get(`${API_BASE}/chat/analytics`), axios.get(`${API_BASE}/chat/documents`),
      ]);
      const metrics = analyticsRes.status === "fulfilled" ? analyticsRes.value.data : null;
      const documents = docsRes.status === "fulfilled" && Array.isArray(docsRes.value.data) ? docsRes.value.data : [];
      if (!metrics || docsRes.status === "rejected") setError("Thiếu dữ liệu thống kê hoặc danh mục tài liệu. Vui lòng thử lại.");
      setUnknownCount(metrics?.unknown || 0);
      const refusals = metrics?.refused || 0;
      const withCitations = metrics?.cited || 0;
      const citationRate = metrics?.citation_rate ?? null;
      const refusalRate = metrics?.refusal_rate ?? 0;
      const unverifiedDocs = documents.filter((d: { effectiveDate?: string; effectiveStatus?: string }) => !d.effectiveDate || d.effectiveStatus === "unknown").length;
      const verifiedDocsRate = documents.length > 0 ? Math.round(((documents.length - unverifiedDocs) / documents.length) * 100) : null;

      setStats({
        totalQuestions: metrics?.measured || 0,
        withCitations,
        citationRate,
        refusalCount: refusals,
        refusalRate,
        totalDocuments: documents.length,
        unverifiedDocs,
        verifiedDocsRate,
      });
    } catch {
      setError("Không thể tải thống kê. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchAnalytics(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#d8dee5] pb-5">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a785d]">
            ĐÁNH GIÁ CHẤT LƯỢNG RAG
          </div>
          <h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747]">
            Chất lượng đối chiếu nguồn
          </h1>
          <p className="mt-1 text-sm text-[#56677c]">
            Chỉ số phục vụ quyết định rà soát dữ liệu và tối ưu pipeline, dựa trên căn cứ đối chiếu thực tế.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchAnalytics}
          disabled={isLoading}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-4 text-sm font-bold text-[#142747] hover:bg-slate-50 transition-colors self-start sm:self-auto"
        >
          <RefreshCw size={16} className={isLoading ? "animate-spin text-[#1d4f88]" : ""} />
          Làm mới số liệu
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {unknownCount > 0 && <p className="text-sm text-[#56677c]">{unknownCount} phản hồi cũ thiếu trạng thái, chưa đưa vào mẫu đo.</p>}
      {/* Các chỉ số có cấu trúc không đại diện độ đúng của lập luận pháp lý. */}
      <div className="grid gap-6 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#d3dbe4] bg-white p-6 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">
            Trích dẫn có đoạn nguồn gốc
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-4xl font-bold text-[#1d4f88]">
              {isLoading ? <Loader2 size={24} className="animate-spin text-[#1d4f88]" /> : stats.citationRate === null ? "N/A" : `${stats.citationRate === null ? "N/A" : `${stats.citationRate}%`}`}
            </span>
            <span className="text-xs font-semibold text-emerald-700">
              {stats.withCitations} / {stats.totalQuestions} lượt hỏi
            </span>
          </div>
          <p className="mt-2 text-xs text-[#718294]">
            Tỷ lệ phản hồi có citation đã kiểm chứng; không đo độ đúng pháp lý.
          </p>
        </div>

        <div className="rounded-2xl border border-[#d3dbe4] bg-white p-6 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">
            Câu hỏi thiếu căn cứ nguồn
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-4xl font-bold text-[#a17842]">
              {isLoading ? <Loader2 size={24} className="animate-spin text-[#a17842]" /> : stats.refusalCount}
            </span>
            <span className="text-xs font-semibold text-[#8a97a6]">lượt từ chối an toàn</span>
          </div>
          <p className="mt-2 text-xs text-[#718294]">
            AI từ chối suy đoán khi kho vector chưa đủ dữ liệu
          </p>
        </div>

        <div className="rounded-2xl border border-[#d3dbe4] bg-white p-6 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">
            Văn bản chưa xác minh
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-4xl font-bold text-[#56677c]">
              {isLoading ? <Loader2 size={24} className="animate-spin text-[#56677c]" /> : stats.unverifiedDocs}
            </span>
            <span className="text-xs font-semibold text-[#8a97a6]">tài liệu</span>
          </div>
          <p className="mt-2 text-xs text-[#718294]">
            Cần bổ sung ngày bắt đầu áp dụng trong metadata ban hành
          </p>
        </div>
      </div>

      {/* Phân loại Lý do Rà soát */}
      <section className="rounded-2xl border border-[#d3dbe4] bg-white p-6 sm:p-8 shadow-xs">
        <h2 className="font-editorial text-2xl font-semibold text-[#142747]">
          Phân bố chất lượng dữ liệu thời gian thực
        </h2>
        <p className="mt-1 text-sm text-[#5a6c80]">
          Thống kê các yếu tố chất lượng câu trả lời và độ hoàn thiện của kho văn bản pháp luật.
        </p>

        <div className="mt-6 space-y-5">
          <div>
            <div className="flex justify-between text-xs sm:text-sm font-bold text-[#142747] mb-1.5">
              <span>Tỷ lệ phản hồi có trích dẫn đã xác minh</span>
              <span>{stats.citationRate}%</span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-[#1d4f88] rounded-full transition-all duration-500"
                style={{ width: `${stats.citationRate ?? 0}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs sm:text-sm font-bold text-[#142747] mb-1.5">
              <span>Tỷ lệ văn bản đầy đủ thông tin hiệu lực pháp lý</span>
              <span>{stats.verifiedDocsRate === null ? "N/A" : `${stats.verifiedDocsRate}%`}</span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-[#2f7560] rounded-full transition-all duration-500"
                style={{ width: `${stats.verifiedDocsRate ?? 0}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs sm:text-sm font-bold text-[#142747] mb-1.5">
              <span>Kho dữ liệu chưa chứa văn bản được hỏi — Cần nạp bổ sung</span>
              <span>{stats.refusalRate}%</span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-[#a17842] rounded-full transition-all duration-500"
                style={{ width: `${stats.refusalRate}%` }}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
