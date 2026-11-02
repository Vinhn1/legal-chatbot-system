import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import axios from "axios";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  FileQuestion,
  FileText,
  Globe,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { API_BASE } from "../../../config";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import { FilterDropdown, type FilterOption } from "../../components/ui/FilterDropdown";

/** Định nghĩa kiểu dữ liệu tài liệu pháp lý từ backend RAG */
export interface LegalDocumentItem {
  id: string;
  name?: string;
  docNumber: string;
  title: string;
  docType: string;
  issuer: string;
  issuedDate: string;
  effectiveDate?: string;
  effectiveStatus: "active" | "expired" | "partially_expired" | "unknown";
  pipelineStatus: "indexed" | "pending_review" | "error";
  articleCount: number;
  chunkCount?: number;
  scope: "public" | "restricted" | "internal";
  sourceUrl?: string;
  sourceType?: string;
  structureStatus?: string;
  coverage?: number;
  chapters: { title: string; articles: string[]; sections?: string[]; chunkCount?: number }[];
}

type SourceKind = "pdf" | "docx" | "txt" | "web" | "unknown";
type ApiDocument = Partial<LegalDocumentItem> & {
  doc_number?: string;
  issuing_authority?: string;
  issued_date?: string;
  effective_date?: string;
  source_url?: string;
  source_type?: string;
};
// Cấu hình huy hiệu và biểu tượng trực quan cho từng nguồn nạp
const sourceBadges: Record<SourceKind, { label: string; className: string; Icon: typeof FileText }> = {
  pdf: { label: "Tệp PDF", className: "border-rose-200 bg-rose-50 text-rose-800", Icon: FileText },
  docx: { label: "Tệp DOCX", className: "border-indigo-200 bg-indigo-50 text-indigo-800", Icon: FileText },
  txt: { label: "Văn bản TXT", className: "border-slate-300 bg-slate-100 text-slate-800", Icon: FileText },
  web: { label: "Trang Web", className: "border-sky-200 bg-sky-50 text-sky-800", Icon: Globe },
  unknown: { label: "Chưa rõ", className: "border-slate-300 bg-white text-slate-700", Icon: FileQuestion },
};
const effectiveStatusLabels: Record<LegalDocumentItem["effectiveStatus"], string> = {
  active: "Còn hiệu lực", expired: "Hết hiệu lực",
  partially_expired: "Hết hiệu lực một phần", unknown: "Chưa xác minh",
};

/** Ưu tiên loại nguồn do AI Core lưu; chỉ suy luận cho dữ liệu cũ khi có bằng chứng. */
function getSourceKind(doc: LegalDocumentItem): SourceKind {
  const stored = doc.sourceType?.toLowerCase();
  if (stored === "pdf" || stored === "docx" || stored === "txt" || stored === "web") return stored;
  const source = (doc.sourceUrl || "").toLowerCase();
  const name = (doc.name || doc.title).toLowerCase();
  if (/\.pdf(?:[?#]|$)/.test(source) || /\.pdf$/.test(name)) return "pdf";
  if (/\.docx(?:[?#]|$)/.test(source) || /\.docx$/.test(name)) return "docx";
  if (/\.txt(?:[?#]|$)/.test(source) || /\.txt$/.test(name)) return "txt";
  if (/^https?:\/\//.test(source) && !/^https?:\/\/congbao\.chinhphu\.vn\/?$/.test(source)) return "web";
  return "unknown";
}

/** Tùy chọn lọc loại văn bản quy phạm pháp luật */
const typeFilterOptions: FilterOption[] = [
  { value: "all", label: "Tất cả loại văn bản" },
  { value: "Luật", label: "Luật" },
  { value: "Chuyên đề", label: "Chuyên đề" },
  { value: "Nghị định", label: "Nghị định" },
  { value: "Thông tư", label: "Thông tư" },
  { value: "Nghị quyết", label: "Nghị quyết" },
];

/** Tùy chọn lọc tình trạng hiệu lực pháp lý */
const statusFilterOptions: FilterOption[] = [
  { value: "all", label: "Tất cả hiệu lực" },
  { value: "active", label: "Còn hiệu lực", dotColor: "bg-emerald-500" },
  { value: "partially_expired", label: "Hết hiệu lực một phần", dotColor: "bg-amber-500" },
  { value: "expired", label: "Hết hiệu lực", dotColor: "bg-rose-500" },
  { value: "unknown", label: "Chưa xác minh", dotColor: "bg-slate-400" },
];

/** Tùy chọn lọc định dạng nguồn nạp */
const sourceFilterOptions: FilterOption[] = [
  { value: "all", label: "Tất cả nguồn" },
  { value: "pdf", label: "Tệp PDF", icon: FileText, iconColor: "text-rose-600" },
  { value: "web", label: "Trang Web", icon: Globe, iconColor: "text-sky-600" },
  { value: "docx", label: "Tệp DOCX", icon: FileText, iconColor: "text-indigo-600" },
  { value: "txt", label: "Văn bản TXT", icon: FileText, iconColor: "text-slate-600" },
];

/** Giữ mã hiển thị dễ đọc cho các bản ghi được nạp trước khi đổi quy tắc số hiệu. */
function readableNumber(number: string, title: string): string {
  if (!number.startsWith("CHUA-XAC-DINH-")) return number || "Chưa có số hiệu";
  const topic = title.match(/^Chuyên đề\s+(\d+)/i);
  return topic ? `CD-${topic[1].padStart(2, "0")}` : "Chưa có số hiệu";
}

/** Định nghĩa đoạn văn bản hoặc Điều/Khoản thực tế đã lập chỉ mục trong kho vector */
interface IndexedDocumentChunk {
  chunkId: string;
  index: number;
  unitType: string;
  chapter: string;
  section: string;
  articleNumber: string;
  articleTitle: string;
  clauseNumber: string;
  pointId: string;
  content: string;
}

interface DocumentChunksResponse {
  docId: string;
  total: number;
  chunks: IndexedDocumentChunk[];
}

/** Hiển thị cấu trúc theo số Điều hoặc phân đoạn thực tế, tránh gắn nhãn Chuyên đề sai loại văn bản. */
function structureSummary(doc: LegalDocumentItem): string {
  if (doc.articleCount > 0) {
    return `${doc.articleCount} Điều${doc.chunkCount ? ` (${doc.chunkCount} chunks)` : ""}`;
  }
  if (doc.docType === "Chuyên đề") {
    return `Chuyên đề (${doc.chunkCount ?? 0} chunks)`;
  }
  return `Phân đoạn văn bản (${doc.chunkCount ?? 0} chunks)`;
}

/** Tạo tiêu đề định vị ngắn gọn cho từng đoạn đã lập chỉ mục trong ngăn kéo chi tiết. */
function formatChunkHeading(chunk: IndexedDocumentChunk): string {
  const parts: string[] = [];
  if (chunk.articleNumber) {
    parts.push(
      chunk.articleTitle
        ? `Điều ${chunk.articleNumber}. ${chunk.articleTitle}`
        : `Điều ${chunk.articleNumber}`
    );
  }
  if (chunk.clauseNumber) {
    parts.push(`Khoản ${chunk.clauseNumber}`);
  }
  if (chunk.pointId) {
    parts.push(`Điểm ${chunk.pointId}`);
  }
  return parts.length > 0 ? parts.join(" · ") : `Phân đoạn #${chunk.index}`;
}

/**
 * Màn hình Quản lý Tài liệu & Cấu trúc Nguồn
 * Kết nối API trực tiếp từ backend NestJS và AI Core, không sử dụng dữ liệu giả.
 */
export function AdminDocumentsPage() {
  const [documents, setDocuments] = useState<LegalDocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selectedDoc, setSelectedDoc] = useState<LegalDocumentItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const [docChunks, setDocChunks] = useState<IndexedDocumentChunk[]>([]);
  const [docChunksTotal, setDocChunksTotal] = useState(0);
  const [loadedChunksDocId, setLoadedChunksDocId] = useState<string | null>(null);
  const [isChunksLoading, setIsChunksLoading] = useState(false);
  const [chunksError, setChunksError] = useState<string | null>(null);
  const [chunkSearchTerm, setChunkSearchTerm] = useState("");

  const isAnyFilterActive =
    typeFilter !== "all" || statusFilter !== "all" || sourceFilter !== "all" || searchTerm.trim() !== "";

  const activeFilterCount =
    (typeFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (sourceFilter !== "all" ? 1 : 0) +
    (searchTerm.trim() !== "" ? 1 : 0);

  const handleResetFilters = () => {
    setTypeFilter("all");
    setStatusFilter("all");
    setSourceFilter("all");
    setSearchTerm("");
  };

  // Tải danh sách văn bản thực tế từ backend
  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await axios.get(`${API_BASE}/chat/documents`);
      const rawData = response.data;
      if (Array.isArray(rawData)) {
        const mappedDocs: LegalDocumentItem[] = (rawData as ApiDocument[]).map((item, index) => ({
          id: item.id || `doc-${index}`,
          name: item.name || item.title || "Văn bản pháp luật",
          docNumber: readableNumber(item.docNumber || item.doc_number || "", item.title || item.name || ""),
          title: item.title || item.name || "Văn bản pháp luật",
          docType: item.docType || "Luật",
          issuer: item.issuer || item.issuing_authority || "Cơ quan ban hành",
          issuedDate: item.issuedDate || item.issued_date || "Chưa rõ",
          effectiveDate: item.effectiveDate || item.effective_date,
          effectiveStatus: item.effectiveStatus || "active",
          pipelineStatus: item.pipelineStatus || "indexed",
          articleCount: typeof item.articleCount === "number" ? item.articleCount : (item.chapters?.reduce((acc, chapter) => acc + (chapter.articles?.length || 0), 0) || 0),
          chunkCount: item.chunkCount || 0,
          scope: item.scope || "public",
          sourceUrl: item.sourceUrl || item.source_url || "",
          sourceType: item.sourceType || item.source_type || "",
          structureStatus: item.structureStatus || "",
          coverage: typeof item.coverage === "number" ? item.coverage : undefined,
          chapters: Array.isArray(item.chapters) ? item.chapters : [],
        }));
        setDocuments(mappedDocs);
        if (mappedDocs.length > 0) {
          setSelectedDoc(mappedDocs[0]);
        } else {
          setSelectedDoc(null);
        }
      } else {
        setDocuments([]);
        setSelectedDoc(null);
      }
    } catch {
      setErrorMessage("Không thể kết nối tới máy chủ backend để tải danh sách tài liệu.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Bắt đầu tải sau khi màn hình đã gắn để tránh cập nhật state trong pha effect.
  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchDocuments(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchDocuments]);

  // Xóa tài liệu khỏi kho vector
  const handleDeleteDocument = async (doc: LegalDocumentItem) => {
    // ID ổn định tránh xóa nhầm hai văn bản trùng tiêu đề.
    const docName = doc.id;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa văn bản "${doc.title}" khỏi hệ thống tra cứu?`)) {
      return;
    }
    setIsDeleting(true);
    try {
      const response = await axios.delete(`${API_BASE}/chat/documents`, {
        params: { name: docName },
      });
      if (!response.data.success) {
        alert(`Xóa chưa hoàn tất. Mã phục hồi: ${response.data.job_id || "chưa có"}`);
        return;
      }
      if (selectedDoc?.id === doc.id) {
        setIsDetailOpen(false);
      }
      await fetchDocuments();
    } catch {
      alert("Xảy ra lỗi khi xóa tài liệu khỏi hệ thống.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Tải nội dung các phân đoạn đã lập chỉ mục của văn bản đang mở trong ngăn kéo chi tiết
  const fetchDocumentChunks = useCallback(async (docId: string, signal?: AbortSignal) => {
    setIsChunksLoading(true);
    setChunksError(null);
    try {
      const response = await axios.get<DocumentChunksResponse>(
        `${API_BASE}/chat/documents/${encodeURIComponent(docId)}/chunks`,
        { params: { limit: 300 }, signal }
      );
      if (signal?.aborted) return;
      const items = Array.isArray(response.data?.chunks) ? response.data.chunks : [];
      setDocChunks(items);
      setDocChunksTotal(typeof response.data?.total === "number" ? response.data.total : items.length);
      setLoadedChunksDocId(docId);
    } catch (err) {
      if (axios.isCancel(err) || signal?.aborted) return;
      setDocChunks([]);
      setDocChunksTotal(0);
      setLoadedChunksDocId(docId);
      setChunksError("Không thể tải nội dung đã lập chỉ mục của tài liệu này.");
    } finally {
      if (!signal?.aborted) {
        setIsChunksLoading(false);
      }
    }
  }, []);

  // Mở ngăn kéo chi tiết của tài liệu được chọn và đặt lại ô lọc nội dung
  const openDocumentDetail = (doc: LegalDocumentItem) => {
    setSelectedDoc(doc);
    setChunkSearchTerm("");
    setIsDetailOpen(true);
  };

  // Bộ lọc danh sách
  const filteredDocs = documents.filter((doc) => {
    const matchSearch =
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.docNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.issuer.toLowerCase().includes(searchTerm.toLowerCase());
    const matchType = typeFilter === "all" || doc.docType.toLowerCase() === typeFilter.toLowerCase();
    const matchStatus = statusFilter === "all" || doc.effectiveStatus === statusFilter;
    const matchSource = sourceFilter === "all" || getSourceKind(doc) === sourceFilter;
    return matchSearch && matchType && matchStatus && matchSource;
  });
  const displayedDoc = filteredDocs.find((doc) => doc.id === selectedDoc?.id) || filteredDocs[0] || null;
  const activeDrawerDocId = isDetailOpen && displayedDoc ? displayedDoc.id : null;

  // Tự động tải các phân đoạn thực tế từ ChromaDB khi mở ngăn kéo chi tiết tài liệu
  useEffect(() => {
    if (!activeDrawerDocId) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchDocumentChunks(activeDrawerDocId, controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeDrawerDocId, fetchDocumentChunks]);

  const showChunksLoading = Boolean(
    activeDrawerDocId && (isChunksLoading || loadedChunksDocId !== activeDrawerDocId)
  );
  const normalizedChunkQuery = chunkSearchTerm.trim().toLowerCase();
  const filteredChunks = normalizedChunkQuery
    ? docChunks.filter((chunk) => {
        const heading = formatChunkHeading(chunk).toLowerCase();
        return (
          heading.includes(normalizedChunkQuery) ||
          chunk.chapter.toLowerCase().includes(normalizedChunkQuery) ||
          chunk.section.toLowerCase().includes(normalizedChunkQuery) ||
          chunk.content.toLowerCase().includes(normalizedChunkQuery)
        );
      })
    : docChunks;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header & Nút Nạp mới */}
      <div className="flex flex-col gap-4 border-b border-[#d8dee5] pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a785d]">
            KHO QUY PHẠM PHÁP LUẬT
          </div>
          <h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747]">
            Tài liệu & Cấu trúc nguồn
          </h1>
          <p className="mt-1 text-sm text-[#56677c]">
            Tìm kiếm, phân loại hiệu lực và rà soát cấu trúc Điều/Khoản thực tế đã bóc tách từ ChromaDB.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={fetchDocuments}
            disabled={isLoading}
            className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-xl border border-[#cbd5df] bg-white px-4 text-sm font-bold text-[#142747] hover:bg-slate-50 transition-colors"
          >
            <RefreshCw size={16} className={isLoading ? "animate-spin text-[#1d4f88]" : ""} />
            Làm mới
          </button>
          <Link
            to="/admin/ingest"
            className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-xl bg-[#1d4f88] px-5 text-sm font-bold text-white shadow-sm hover:bg-[#153b66] transition-colors"
          >
            <Plus size={17} /> Nạp tài liệu
          </Link>
        </div>
      </div>

      {/* Thanh Tìm kiếm & Bộ lọc nâng cao */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-3.5 py-2.5 shadow-2xs transition-all focus-within:border-[#1d4f88] focus-within:ring-2 focus-within:ring-[#1d4f88]/15">
          <Search size={17} className="text-[#7c8b9d] shrink-0" />
          <input
            type="text"
            placeholder="Tìm theo số hiệu, tên văn bản, cơ quan..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent text-xs sm:text-sm font-semibold text-[#142747] outline-none placeholder:text-[#9aa5b2]"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="text-slate-400 hover:text-slate-600 transition-colors p-0.5 rounded-full hover:bg-slate-100"
              aria-label="Xóa từ khóa tìm kiếm"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <FilterDropdown
          label="Loại văn bản"
          value={typeFilter}
          options={typeFilterOptions}
          onChange={setTypeFilter}
          icon={FileText}
          ariaLabel="Lọc theo loại văn bản"
        />

        <FilterDropdown
          label="Hiệu lực"
          value={statusFilter}
          options={statusFilterOptions}
          onChange={setStatusFilter}
          icon={ShieldCheck}
          ariaLabel="Lọc theo tình trạng hiệu lực"
        />

        <FilterDropdown
          label="Nguồn nạp"
          value={sourceFilter}
          options={sourceFilterOptions}
          onChange={setSourceFilter}
          icon={Layers}
          ariaLabel="Lọc theo nguồn nạp"
        />

        {isAnyFilterActive && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 transition-colors"
            title="Đặt lại tất cả bộ lọc về mặc định"
          >
            <RotateCcw size={13} />
            <span>Đặt lại</span>
            <span className="flex size-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700">
              {activeFilterCount}
            </span>
          </button>
        )}
      </div>

      {/* Thông báo lỗi nếu có */}
      {errorMessage && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-xs font-semibold text-rose-800 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={fetchDocuments}
            className="underline font-bold text-rose-900 ml-4 hover:opacity-80"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Phần chính: Bảng danh sách văn bản hiển thị toàn màn hình (Full-Width) */}
      <div className="w-full rounded-2xl border border-[#d3dbe4] bg-white shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-[#66778c]">
            <Loader2 size={32} className="mx-auto animate-spin text-[#1d4f88] mb-3" />
            <p className="text-sm font-semibold">Đang tải danh sách tài liệu từ cơ sở dữ liệu...</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#eef4f9] text-[#1d4f88] mb-4">
              <BookOpen size={30} />
            </div>
            <h3 className="text-lg font-bold text-[#142747]">Kho văn bản hiện đang trống</h3>
            <p className="mt-1 text-sm text-[#66778c] max-w-md mx-auto">
              Chưa có văn bản quy phạm pháp luật nào được nạp vào hệ thống. Hãy tải lên tệp văn bản đầu tiên để kích hoạt pipeline tra cứu AI.
            </p>
            <div className="mt-6">
              <Link
                to="/admin/ingest"
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1d4f88] px-6 text-sm font-bold text-white shadow-sm hover:bg-[#153b66] transition-colors"
              >
                <Plus size={17} /> Nạp tài liệu mới ngay
              </Link>
            </div>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="p-12 text-center text-[#66778c]">
            <FileText size={32} className="mx-auto text-[#9aa5b2] mb-3" />
            <p className="text-sm font-semibold">Không tìm thấy tài liệu phù hợp với bộ lọc hiện tại.</p>
            <button
              type="button"
              onClick={() => {
                setSearchTerm("");
                setTypeFilter("all");
                setStatusFilter("all");
                setSourceFilter("all");
              }}
              className="mt-3 text-xs font-bold text-[#1d4f88] underline"
            >
              Xóa bộ lọc
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto board-scroll">
            <p className="px-5 py-2 text-xs text-[#66778c] lg:hidden">Vuốt ngang để xem đầy đủ các cột tài liệu.</p>
            <table className="w-full min-w-[880px] text-left text-xs sm:text-sm">
              <thead className="border-b border-[#e2e7ec] bg-[#f8f9fa] text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">
                <tr>
                  <th className="min-w-[320px] py-3.5 px-5">Tài liệu & Trích yếu</th>
                  <th className="py-3.5 px-4">Hình thức nạp</th>
                  <th className="py-3.5 px-4">Hiệu lực</th>
                  <th className="py-3.5 px-4">Lập chỉ mục</th>
                  <th className="py-3.5 px-5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf1f4]">
                {filteredDocs.map((doc) => {
                  const isSelected = displayedDoc?.id === doc.id;
                  const sourceBadge = sourceBadges[getSourceKind(doc)];
                  const SourceIcon = sourceBadge.Icon;
                  return (
                    <tr
                      key={doc.id}
                      onClick={() => openDocumentDetail(doc)}
                      className={`cursor-pointer transition-colors ${
                        isSelected && isDetailOpen
                          ? "bg-[#f0f5fa] dark:bg-zinc-800"
                          : "hover:bg-slate-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <td className="py-4 px-5">
                        <div className="min-w-0 break-words font-bold leading-snug text-[#142747] text-sm sm:text-base">
                          {doc.title}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#718294]">
                          <span className="font-semibold text-[#1d4f88]">{doc.docNumber}</span>
                          <span>•</span>
                          <span>{doc.issuer}</span>
                          <span>•</span>
                          <span>{structureSummary(doc)}</span>
                        </div>
                      </td>

                      {/* Cột hiển thị hình thức nạp tài liệu với biểu tượng trực quan */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${sourceBadge.className}`}>
                          <SourceIcon size={13} className="shrink-0" />
                          {sourceBadge.label}
                        </span>
                      </td>

                      <td className="py-4 px-4 whitespace-nowrap">
                        {doc.effectiveStatus === "active" && (
                          <span className="inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-800">
                            Còn hiệu lực
                          </span>
                        )}
                        {doc.effectiveStatus === "partially_expired" && (
                          <span className="inline-flex rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold text-amber-800">
                            Hết một phần
                          </span>
                        )}
                        {doc.effectiveStatus === "expired" && (
                          <span className="inline-flex rounded-full bg-rose-50 border border-rose-200 px-3 py-1 text-xs font-bold text-rose-800">
                            Hết hiệu lực
                          </span>
                        )}
                        {doc.effectiveStatus === "unknown" && (
                          <span className="inline-flex rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                            Chưa xác minh
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-4 whitespace-nowrap">
                        {doc.pipelineStatus === "indexed" && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-[#2f7560]">
                            <CheckCircle2 size={14} /> Đã chỉ mục
                          </span>
                        )}
                        {doc.pipelineStatus === "pending_review" && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-[#a17842]">
                            <Clock size={14} /> Chờ duyệt
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-5 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDocumentDetail(doc);
                          }}
                          title="Xem chi tiết"
                          className="rounded-lg p-2 text-[#1d4f88] hover:bg-[#eef4f9] transition-colors"
                        >
                          <Eye size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDocument(doc);
                          }}
                          disabled={isDeleting}
                          title="Xóa tài liệu"
                          className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 transition-colors ml-1"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Slide-Over Drawer: Chi tiết nguồn văn bản */}
      <Sheet open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col gap-0 border-l border-[#d3dbe4] bg-white shadow-2xl"
        >
          {displayedDoc ? (
            <div className="flex flex-col h-full">
              <SheetHeader className="p-5 sm:p-6 border-b border-[#eef1f4] bg-slate-50/70">
                <div className="flex items-center justify-between pr-7">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a785d]">
                    Chi tiết nguồn văn bản
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(() => {
                      const badge = sourceBadges[getSourceKind(displayedDoc)];
                      const BadgeIcon = badge.Icon;
                      return (
                        <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-bold ${badge.className}`}>
                          <BadgeIcon size={12} className="shrink-0" />
                          {badge.label}
                        </span>
                      );
                    })()}
                    <span className="rounded-md bg-[#eef4f9] px-2 py-0.5 text-xs font-bold text-[#1d4f88]">
                      {displayedDoc.docType}
                    </span>
                  </div>
                </div>

                <SheetTitle className="font-editorial mt-2 text-2xl font-semibold text-[#142747] leading-snug">
                  {displayedDoc.title}
                </SheetTitle>
                <SheetDescription className="mt-1 text-xs font-semibold text-[#66778c]">
                  Số hiệu: {displayedDoc.docNumber} · Cơ quan: {displayedDoc.issuer}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto board-scroll p-5 sm:p-6 space-y-5">
                {/* Thông số metadata */}
                <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-[#f8f9fa] border border-[#e8ecef] text-xs">
                  <div>
                    <span className="text-[#718294]">Ngày ban hành:</span>
                    <div className="font-bold text-[#142747] mt-0.5">{displayedDoc.issuedDate}</div>
                  </div>
                  <div>
                    <span className="text-[#718294]">Phạm vi:</span>
                    <div className="font-bold text-[#142747] mt-0.5 uppercase">
                      {displayedDoc.scope === "public" ? "Công khai" : "Nội bộ"}
                    </div>
                  </div>
                  <div>
                    <span className="text-[#718294]">Trạng thái hiệu lực:</span>
                    <div className="font-bold text-[#142747] mt-0.5">
                      {effectiveStatusLabels[displayedDoc.effectiveStatus]}
                    </div>
                  </div>
                  <div>
                    <span className="text-[#718294]">{displayedDoc.articleCount > 0 ? "Tổng Điều bóc tách:" : "Nội dung lập chỉ mục:"}</span>
                    <div className="font-bold text-[#1d4f88] mt-0.5">
                      {structureSummary(displayedDoc)}
                    </div>
                  </div>
                </div>

                {displayedDoc.structureStatus === "mixed_reference_document" && (displayedDoc.coverage ?? 0) >= 0.95 && (
                  <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
                    Chuyên đề đã được lập chỉ mục theo nội dung với độ bao phủ {Math.round((displayedDoc.coverage ?? 0) * 100)}%.
                    Các Điều được trích dẫn trong tài liệu không được tính là Điều của văn bản gốc.
                  </p>
                )}

                {displayedDoc.docType !== "Chuyên đề" && displayedDoc.articleCount === 0 && (displayedDoc.chunkCount ?? 0) <= 1 && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-900">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700" />
                    <div>
                      <span className="font-bold">Cảnh báo dữ liệu trích xuất chưa đầy đủ: </span>
                      Văn bản quy phạm này hiện chỉ có {displayedDoc.chunkCount ?? 0} phân đoạn và chưa nhận diện được Điều/Khoản (thường xảy ra khi tệp PDF scan chỉ mới được nhận diện trang đầu ở bản nạp cũ). Bạn nên xóa bản ghi này và nạp lại bằng AI OCR đa trang để lập chỉ mục toàn văn.
                    </div>
                  </div>
                )}

                {/* Cấu trúc nhận diện */}
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-[#6a7b8e] mb-2.5">
                    {displayedDoc.articleCount > 0 ? "Cấu trúc Phần / Mục / Điều" : "Cấu trúc Phần / Mục nhận diện"}
                  </div>
                  {displayedDoc.chapters && displayedDoc.chapters.length > 0 ? (
                    <div className="space-y-3 max-h-[300px] overflow-y-auto board-scroll pr-1">
                      {displayedDoc.chapters.map((chap, i) => (
                        <div key={i} className="rounded-xl border border-[#e2e7ec] bg-[#fafafa] p-3.5 text-xs">
                          <div className="font-bold text-[#142747] mb-2">{chap.title}</div>
                          <div className="space-y-1.5 pl-2.5 border-l-2 border-[#cbd5df]">
                            {chap.sections?.map((section, j) => (
                              <div key={`section-${j}`} className="text-[#415367] leading-relaxed">{section}</div>
                            ))}
                            {chap.articles && chap.articles.length > 0 ? (
                              chap.articles.map((art, j) => (
                                <div key={j} className="text-[#415367] leading-relaxed">{art}</div>
                              ))
                            ) : (
                              <div className="text-[#66778c]">{chap.chunkCount ?? 0} đoạn đã lập chỉ mục</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[#d3dbe4] p-5 text-xs text-[#718294] text-center">
                      Chưa nhận diện được tiêu đề Phần hoặc Mục trong nội dung đã lập chỉ mục.
                    </div>
                  )}
                </div>

                {/* Danh sách nội dung phân đoạn thực tế trong kho vector */}
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">
                      Nội dung đã lập chỉ mục
                    </div>
                    {!showChunksLoading && !chunksError && (
                      <span className="rounded-full bg-[#eef4f9] px-2.5 py-0.5 text-[11px] font-bold text-[#1d4f88]">
                        {docChunksTotal > docChunks.length
                          ? `Hiển thị ${docChunks.length}/${docChunksTotal} phân đoạn`
                          : `${docChunksTotal} phân đoạn`}
                      </span>
                    )}
                  </div>

                  {!showChunksLoading && !chunksError && docChunks.length > 3 && (
                    <div className="flex items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-3 py-2 focus-within:border-[#1d4f88]">
                      <Search size={14} className="shrink-0 text-[#7c8b9d]" />
                      <input
                        type="text"
                        value={chunkSearchTerm}
                        onChange={(event) => setChunkSearchTerm(event.target.value)}
                        placeholder="Lọc nhanh theo số Điều hoặc từ khóa nội dung..."
                        className="w-full bg-transparent text-xs font-medium text-[#142747] outline-none placeholder:text-[#9aa5b2]"
                      />
                      {chunkSearchTerm && (
                        <button
                          type="button"
                          onClick={() => setChunkSearchTerm("")}
                          aria-label="Xóa từ khóa lọc nội dung"
                          className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  )}

                  {showChunksLoading ? (
                    <div className="rounded-xl border border-[#e2e7ec] bg-[#fafafa] p-6 text-center text-xs text-[#66778c]">
                      <Loader2 size={20} className="mx-auto mb-2 motion-safe:animate-spin text-[#1d4f88]" />
                      <p className="font-semibold">Đang tải nội dung các phân đoạn từ kho vector...</p>
                    </div>
                  ) : chunksError ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
                      <span className="font-medium">{chunksError}</span>
                      <button
                        type="button"
                        onClick={() => void fetchDocumentChunks(displayedDoc.id)}
                        className="shrink-0 font-bold text-rose-900 underline hover:opacity-80"
                      >
                        Thử lại
                      </button>
                    </div>
                  ) : docChunks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#d3dbe4] p-5 text-center text-xs text-[#718294]">
                      Không có phân đoạn nội dung nào được lưu trong kho vector cho tài liệu này.
                    </div>
                  ) : filteredChunks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#d3dbe4] p-5 text-center text-xs text-[#718294]">
                      <p>Không có phân đoạn nào khớp với từ khóa lọc hiện tại.</p>
                      <button
                        type="button"
                        onClick={() => setChunkSearchTerm("")}
                        className="mt-2 font-bold text-[#1d4f88] underline"
                      >
                        Xóa từ khóa lọc
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[420px] overflow-y-auto board-scroll pr-1">
                      {filteredChunks.map((chunk) => {
                        const breadcrumb = [chunk.chapter, chunk.section].filter(Boolean).join(" · ");
                        return (
                          <article
                            key={chunk.chunkId}
                            className="rounded-xl border border-[#e2e7ec] bg-[#fafafa] p-3.5 text-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="min-w-0 break-words font-bold text-[#142747]">
                                {formatChunkHeading(chunk)}
                              </h4>
                              <span className="shrink-0 rounded bg-[#eef4f9] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#1d4f88]">
                                #{chunk.index}
                              </span>
                            </div>
                            {breadcrumb && (
                              <p className="mt-1 break-words text-[11px] font-semibold text-[#66778c]">
                                {breadcrumb}
                              </p>
                            )}
                            <p className="mt-2 whitespace-pre-line break-words leading-relaxed text-[#334155]">
                              {chunk.content}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 sm:p-5 border-t border-[#edf1f4] bg-white flex gap-3">
                <Link
                  to="/admin/chat"
                  className="flex-1 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#1d4f88] text-xs font-bold text-white hover:bg-[#153b66] transition-colors"
                >
                  Thử nghiệm hỏi đáp <ArrowUpRight size={15} />
                </Link>
                <button
                  type="button"
                  onClick={() => handleDeleteDocument(displayedDoc)}
                  disabled={isDeleting}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 text-xs font-bold text-rose-700 hover:bg-rose-100 transition-colors"
                >
                  <Trash2 size={15} /> Xóa
                </button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
