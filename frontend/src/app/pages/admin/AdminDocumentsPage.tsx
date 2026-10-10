import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import axios from "axios";
import {
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Eye,
  FileQuestion,
  FileText,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { API_BASE } from "../../../config";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";

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
  chapters: { title: string; articles: string[] }[];
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
          docNumber: item.docNumber || item.doc_number || "Chưa có số hiệu",
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
    const docName = doc.name || doc.title;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa văn bản "${doc.title}" khỏi hệ thống tra cứu?`)) {
      return;
    }
    setIsDeleting(true);
    try {
      await axios.delete(`${API_BASE}/chat/documents`, {
        params: { name: docName },
      });
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

      {/* Thanh Tìm kiếm & Bộ lọc nhanh */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-3.5 py-2.5 shadow-2xs focus-within:border-[#1d4f88]">
          <Search size={18} className="text-[#7c8b9d]" />
          <input
            type="text"
            placeholder="Tìm theo số hiệu, tên văn bản, cơ quan..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent text-sm font-semibold text-[#142747] outline-none placeholder:text-[#9aa5b2]"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Lọc theo loại văn bản"
          className="h-11 rounded-xl border border-[#cbd5df] bg-white px-3 text-xs sm:text-sm font-semibold text-[#142747] outline-none"
        >
          <option value="all">Tất cả loại văn bản</option>
          <option value="Luật">Luật</option>
          <option value="Nghị định">Nghị định</option>
          <option value="Thông tư">Thông tư</option>
          <option value="Nghị quyết">Nghị quyết</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Lọc theo tình trạng hiệu lực"
          className="h-11 rounded-xl border border-[#cbd5df] bg-white px-3 text-xs sm:text-sm font-semibold text-[#142747] outline-none"
        >
          <option value="all">Tất cả hiệu lực</option>
          <option value="active">Còn hiệu lực</option>
          <option value="partially_expired">Hết hiệu lực một phần</option>
          <option value="expired">Hết hiệu lực</option>
          <option value="unknown">Chưa xác minh</option>
        </select>

        <select
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
          aria-label="Lọc theo nguồn nạp"
          className="h-11 rounded-xl border border-[#cbd5df] bg-white px-3 text-xs font-semibold text-[#142747] outline-none sm:text-sm"
        >
          <option value="all">Tất cả nguồn</option>
          <option value="pdf">Tệp PDF</option>
          <option value="web">Trang Web</option>
          <option value="docx">Tệp DOCX</option>
          <option value="txt">Văn bản TXT</option>
        </select>
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
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-[#e2e7ec] bg-[#f8f9fa] text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">
                <tr>
                  <th className="py-3.5 px-5">Tài liệu & Trích yếu</th>
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
                      onClick={() => {
                        setSelectedDoc(doc);
                        setIsDetailOpen(true);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected && isDetailOpen ? "bg-[#f0f5fa]" : "hover:bg-slate-50"
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
                          <span>{doc.articleCount} Điều</span>
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
                            setSelectedDoc(doc);
                            setIsDetailOpen(true);
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
                    <span className="text-[#718294]">Tổng Điều bóc tách:</span>
                    <div className="font-bold text-[#1d4f88] mt-0.5">
                      {displayedDoc.articleCount} Điều {displayedDoc.chunkCount ? `(${displayedDoc.chunkCount} chunks)` : ""}
                    </div>
                  </div>
                </div>

                {/* Cấu trúc nhận diện */}
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-[#6a7b8e] mb-2.5">
                    Cấu trúc Điều / Khoản nhận diện
                  </div>
                  {displayedDoc.chapters && displayedDoc.chapters.length > 0 ? (
                    <div className="space-y-3 max-h-[380px] overflow-y-auto board-scroll pr-1">
                      {displayedDoc.chapters.map((chap, i) => (
                        <div key={i} className="rounded-xl border border-[#e2e7ec] bg-[#fafafa] p-3.5 text-xs">
                          <div className="font-bold text-[#142747] mb-2">{chap.title}</div>
                          <div className="space-y-1.5 pl-2.5 border-l-2 border-[#cbd5df]">
                            {chap.articles && chap.articles.length > 0 ? (
                              chap.articles.map((art, j) => (
                                <div key={j} className="text-[#415367] leading-relaxed">{art}</div>
                              ))
                            ) : (
                              <div className="text-[#8997a6] italic">Đang tổng hợp danh sách Điều</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[#d3dbe4] p-6 text-xs text-[#718294] text-center">
                      Chưa bóc tách cấu trúc Chương phân cấp cho văn bản này.
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
