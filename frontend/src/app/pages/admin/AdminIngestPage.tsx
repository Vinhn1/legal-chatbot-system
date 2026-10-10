import { useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { Link } from "react-router";
import axios from "axios";
import { toast } from "sonner";
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Globe, Info, Loader2, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import { API_BASE } from "../../../config";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import {
  getInMemoryFiles,
  loadPendingReviewsFromDb,
  removePendingReviewFromDb,
  savePendingReviewToDb,
  setInMemoryFiles,
  syncFilesStorage,
} from "../../services/ingestStorage";

export type Mode = "file" | "text" | "url";
export type Result = {
  status: "indexed" | "duplicate" | "needs_review";
  doc_id: string;
  doc_title: string;
  doc_number: string;
  issuing_authority: string;
  issued_date: string;
  effective_status: string;
  article_count: number;
  chunk_count: number;
  warnings?: string[];
  document_type?: string;
  effective_date?: string | null;
  source_url?: string;
  scope?: string;
  raw_text_preview?: string;
};
export type FileItem = { id: string; file: File; state: "ready" | "loading" | "done" | "error"; result?: Result; error?: string };
type ReviewMetadata = { doc_title: string; doc_number: string; issuing_authority: string; issued_date: string; effective_status: string };
const statusLabels: Record<string, string> = {
  active: "Đang hiệu lực", expired: "Hết hiệu lực", partially_expired: "Hết hiệu lực một phần", unknown: "Chưa xác minh",
};

// Mẫu minh họa thể thức; nội dung điều khoản là chỗ điền, không phải toàn văn có hiệu lực.
const LEGAL_TEXT_SAMPLE = `CHÍNH PHỦ
Số: 13/2023/NĐ-CP

CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc

Hà Nội, ngày 17 tháng 04 năm 2023

NGHỊ ĐỊNH
Về bảo vệ dữ liệu cá nhân

Chương I
QUY ĐỊNH CHUNG

Điều 1. Phạm vi điều chỉnh
1. [Thay bằng nguyên văn khoản 1 đã đối chiếu nguồn chính thức.]
2. [Thay bằng nguyên văn khoản 2 đã đối chiếu nguồn chính thức.]

Điều 2. Đối tượng áp dụng
1. [Thay bằng nguyên văn điều khoản đã đối chiếu nguồn chính thức.]

TM. CHÍNH PHỦ
THỦ TƯỚNG
[Họ tên người ký]`;

/** Chỉ hiển thị lỗi an toàn từ API, không đưa nội dung tài liệu vào thông báo. */
function errorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.message ?? error.response?.data?.detail;
    if (typeof detail === "string") return detail;
  }
  return error instanceof Error ? error.message : "Không thể nạp tài liệu. Vui lòng thử lại.";
}

/** Nhận một nguồn đầu vào và hiển thị metadata do AI Core thực sự trả về. */
export function AdminIngestPage() {
  const [mode, setMode] = useState<Mode>("file");
  // Khởi tạo hàng đợi tệp từ bộ nhớ tạm để không mất dữ liệu khi chuyển trang
  const [files, setFiles] = useState<FileItem[]>(() => getInMemoryFiles());
  const [content, setContent] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [url, setUrl] = useState("");
  const [lastCompleted, setLastCompleted] = useState<{ url: string; status: "indexed" | "duplicate" } | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewMetadata, setReviewMetadata] = useState<ReviewMetadata | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const reviewItem = files.find((item) => item.id === reviewId && item.result?.status === "needs_review");
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const currentUrlCompleted = mode === "url" && !!lastCompleted && url.trim() === lastCompleted.url;

  // Lọc riêng danh sách tài liệu cần rà soát và danh sách tệp chờ nạp thông thường
  const reviewPendingItems = files.filter((item) => item.result?.status === "needs_review");
  const regularFileQueue = files.filter((item) => item.result?.status !== "needs_review");

  // Nạp lại các tệp cần rà soát đã lưu trong IndexedDB khi khởi tạo
  useEffect(() => {
    let isMounted = true;
    void loadPendingReviewsFromDb().then((stored) => {
      if (!isMounted || stored.length === 0) return;
      setFiles((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        const merged = [...current];
        for (const item of stored) {
          if (!existingIds.has(item.id)) {
            merged.push(item);
          }
        }
        setInMemoryFiles(merged);
        return merged;
      });
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Tự động đồng bộ trạng thái tệp sang bộ nhớ RAM và IndexedDB
  useEffect(() => {
    syncFilesStorage(files);
  }, [files]);

  /** Phân biệt nguồn mới và nguồn đã có để thông báo đúng kết quả nạp. */
  const notifyResult = (result: Result) => {
    if (result.status === "indexed") {
      toast.success("Nạp tri thức thành công", { description: result.doc_title || "Tài liệu đã được lập chỉ mục." });
    } else if (result.status === "duplicate") {
      toast.info("Tài liệu đã có trong kho tri thức", { description: result.doc_title || "Không cần nạp lại tài liệu này." });
    }
  };

  /** Xóa nguồn URL cũ và đưa tiêu điểm về ô nhập cho lần nạp tiếp theo. */
  const resetUrl = () => {
    setUrl("");
    setLastCompleted(null);
    setResults([]);
    setError("");
    urlInputRef.current?.focus();
  };

  /** Kiểm tra tệp trước khi đưa vào hàng đợi nhiều tệp. */
  const addFiles = (incoming: FileList | File[]) => {
    const accepted: FileItem[] = [];
    const invalid: string[] = [];
    for (const file of Array.from(incoming)) {
      if (!/\.(pdf|docx|txt)$/i.test(file.name) || file.size === 0 || file.size > 15 * 1024 * 1024) {
        invalid.push(file.name);
      } else if (!files.some((item) => item.file.name === file.name && item.file.size === file.size)) {
        accepted.push({ id: crypto.randomUUID(), file, state: "ready" });
      }
    }
    setFiles((current) => [...current, ...accepted]);
    setError(invalid.length ? `Tệp không hợp lệ hoặc vượt 15 MB: ${invalid.join(", ")}` : "");
    setResults([]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const updateFile = (id: string, change: Partial<FileItem>) => {
    setFiles((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  };

  /** Xóa hoàn toàn một tệp khỏi hàng đợi và kho lưu trữ */
  const removeFile = (id: string) => {
    setFiles((current) => current.filter((entry) => entry.id !== id));
    void removePendingReviewFromDb(id);
  };

  /** Mở nội dung trích xuất và metadata của đúng tệp đang chờ quản trị viên rà soát. */
  const openReview = (item: FileItem) => {
    if (!item.result || item.result.status !== "needs_review") return;
    toast.dismiss();
    setReviewMetadata({
      doc_title: item.result.doc_title || item.file.name.replace(/\.[^.]+$/, ""),
      doc_number: item.result.doc_number?.startsWith("CHUA-XAC-DINH-") ? "" : item.result.doc_number || "",
      issuing_authority: item.result.issuing_authority === "Chưa xác định" ? "" : item.result.issuing_authority || "",
      issued_date: item.result.issued_date || "",
      effective_status: item.result.effective_status || "unknown",
    });
    setReviewError("");
    setReviewId(item.id);
  };

  /** Chỉ gửi cờ cưỡng bức sau khi metadata đã được kiểm tra và người dùng xác nhận. */
  const forceIngest = async (event: FormEvent) => {
    event.preventDefault();
    if (!reviewItem?.result || !reviewMetadata || reviewBusy) return;
    const title = reviewMetadata.doc_title.trim();
    const number = reviewMetadata.doc_number.trim();
    const authority = reviewMetadata.issuing_authority.trim();
    if (!title || !number || !authority || !reviewMetadata.issued_date) {
      setReviewError("Vui lòng hoàn thiện tên, số hiệu, cơ quan và ngày ban hành.");
      return;
    }
    if (!reviewItem.result.raw_text_preview?.trim()) {
      setReviewError("Không trích xuất được nội dung để lập chỉ mục. Hãy cung cấp bản có thể đọc hoặc OCR lại tệp.");
      return;
    }
    setReviewBusy(true);
    setReviewError("");
    updateFile(reviewItem.id, { state: "loading", error: undefined });
    const form = new FormData();
    form.append("file", reviewItem.file);
    form.append("force_paragraph", "true");
    form.append("metadata", JSON.stringify({
      doc_id: reviewItem.result.doc_id,
      doc_title: title,
      doc_number: number,
      issuing_authority: authority,
      issued_date: reviewMetadata.issued_date,
      effective_status: reviewMetadata.effective_status,
      effective_date: reviewItem.result.effective_date || null,
      document_type: reviewItem.result.document_type || "law",
      source_url: reviewItem.result.source_url,
      scope: reviewItem.result.scope || "internal",
    }));
    try {
      const response = await axios.post<Result>(`${API_BASE}/legal/ingest`, form);
      const result = response.data;
      setResults((current) => [...current.filter((entry) => entry.doc_id !== reviewItem.result?.doc_id), result]);
      if (result.status === "indexed" || result.status === "duplicate") {
        setFiles((current) => current.filter((item) => item.id !== reviewItem.id));
        void removePendingReviewFromDb(reviewItem.id);
        setReviewId(null);
        setReviewMetadata(null);
        notifyResult(result);
      } else {
        updateFile(reviewItem.id, { state: "done", result });
        void savePendingReviewToDb({ ...reviewItem, state: "done", result });
        setReviewError(result.warnings?.join(" ") || "Tài liệu vẫn cần rà soát; vui lòng kiểm tra nội dung trích xuất.");
      }
    } catch (forceError) {
      updateFile(reviewItem.id, { state: "done", error: errorText(forceError) });
      setReviewError(errorText(forceError));
    } finally {
      setReviewBusy(false);
    }
  };

  /** Bỏ tệp chưa lập chỉ mục khỏi hàng đợi theo quyết định của quản trị viên. */
  const discardReview = () => {
    if (!reviewItem || reviewBusy) return;
    setFiles((current) => current.filter((item) => item.id !== reviewItem.id));
    void removePendingReviewFromDb(reviewItem.id);
    setResults((current) => current.filter((result) => result.doc_id !== reviewItem.result?.doc_id));
    setReviewId(null);
    setReviewMetadata(null);
  };

  /** Chỉ báo thành công khi API xác nhận tài liệu đã được lập chỉ mục. */
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || currentUrlCompleted) return;
    setError("");
    setResults([]);
    if (mode === "file" && !files.some((item) => item.state === "ready" || item.state === "error")) {
      setError(files.some((item) => item.result?.status === "needs_review")
        ? "Các tệp còn lại cần được rà soát trước khi lập chỉ mục."
        : "Vui lòng chọn ít nhất một tệp PDF, DOCX hoặc TXT.");
      return;
    }
    if (mode === "text" && !content.trim()) {
      setError("Vui lòng dán nội dung văn bản cần nạp.");
      return;
    }
    if (mode === "text" && (/\[Thay bằng nguyên văn|\[Họ tên người ký\]/.test(content))) {
      // Mẫu thể thức không được đưa vào kho tri thức khi còn chỗ điền minh họa.
      setError("Vui lòng thay toàn bộ nội dung mẫu trong ngoặc vuông bằng văn bản đã đối chiếu trước khi nạp.");
      return;
    }
    if (mode === "url") {
      try {
        const parsed = new URL(url.trim());
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      } catch {
        setError("Vui lòng nhập URL HTTP hoặc HTTPS hợp lệ.");
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "file") {
        const completed: Result[] = [];
        let failed = 0;
        const pendingItems = files.filter((entry) => entry.state === "ready" || entry.state === "error");
        for (const [index, item] of pendingItems.entries()) {
          setProgress({ current: index + 1, total: pendingItems.length });
          updateFile(item.id, { state: "loading", error: undefined });
          const form = new FormData();
          form.append("file", item.file);
          try {
            const response = await axios.post<Result>(`${API_BASE}/legal/ingest`, form);
            completed.push(response.data);
            notifyResult(response.data);
            if (response.data.status === "indexed" || response.data.status === "duplicate") {
              // Gỡ từng tệp đã xử lý xong để hàng đợi chỉ còn mục cần thao tác.
              setFiles((current) => current.filter((entry) => entry.id !== item.id));
              void removePendingReviewFromDb(item.id);
            } else {
              updateFile(item.id, { state: "done", result: response.data });
              void savePendingReviewToDb({ ...item, state: "done", result: response.data });
            }
          } catch (fileError) {
            failed++;
            updateFile(item.id, { state: "error", error: errorText(fileError) });
          }
        }
        setResults(completed);
        if (failed) setError(`${failed} tệp chưa nạp được. Kiểm tra lỗi tại từng tệp và thử lại.`);
      } else if (mode === "text") {
        const response = await axios.post<Result>(`${API_BASE}/legal/ingest-text`, {
          content: content.trim(), sourceUrl: sourceUrl.trim() || undefined,
        });
        setResults([response.data]);
        notifyResult(response.data);
      } else {
        const response = await axios.post<Result>(`${API_BASE}/legal/ingest-url`, { url: url.trim() });
        setResults([response.data]);
        if (response.data.status === "indexed" || response.data.status === "duplicate") {
          setLastCompleted({ url: url.trim(), status: response.data.status });
        }
        notifyResult(response.data);
      }
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <header className="border-b border-[#d8dee5] pb-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a785d]">TIẾP NHẬN NGUỒN MỚI</p>
        <h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747]">Nạp tài liệu pháp luật</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#56677c]">Cung cấp tệp, nội dung văn bản hoặc URL. AI tự nhận diện thông tin pháp lý và lập chỉ mục để tra cứu.</p>
      </header>
      <form onSubmit={submit} className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <div role="tablist" aria-label="Nguồn nạp tài liệu" className="grid grid-cols-3 gap-2 rounded-2xl border border-[#d3dbe4] bg-white p-2">
            {([{ id: "file", label: "Tệp", icon: UploadCloud }, { id: "text", label: "Văn bản", icon: FileText }, { id: "url", label: "URL", icon: Globe }] as const).map((tab) => {
              const Icon = tab.icon;
              return <button key={tab.id} type="button" role="tab" aria-selected={mode === tab.id}
                onClick={() => { setMode(tab.id); setError(""); setResults([]); }}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#1d4f88] ${mode === tab.id ? "bg-[#1d4f88] text-white" : "text-[#516278] hover:bg-[#eef4f9]"}`}>
                <Icon size={17} className="shrink-0" />
                <span>{tab.label}</span>
                {tab.id === "file" && reviewPendingItems.length > 0 && (
                  <span className={`ml-1 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ${mode === tab.id ? "bg-amber-400 text-amber-950" : "bg-amber-100 text-amber-900 border border-amber-300"}`}>
                    {reviewPendingItems.length}
                  </span>
                )}
              </button>;
            })}
          </div>
          {mode === "file" && <section className="min-w-0 space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-4 sm:p-6">
            <div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={onDrop}
              className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? "border-[#1d4f88] bg-[#eef4f9]" : "border-[#cbd5df] bg-[#fafaf9]"}`}>
              <UploadCloud size={32} className="mx-auto text-[#1d4f88]" />
              <p className="mt-3 text-sm font-semibold text-[#142747]">Kéo thả nhiều tệp vào đây</p>
              <p className="mt-1 text-xs text-[#718294]">PDF, DOCX, TXT; tối đa 15 MB mỗi tệp</p>
              <label className="mt-4 inline-flex cursor-pointer rounded-xl bg-[#1d4f88] px-4 py-2 text-sm font-semibold text-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#1d4f88]">Chọn tệp
                <input type="file" multiple accept=".pdf,.docx,.txt" className="sr-only" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }} />
              </label>
            </div>
            {/* Hàng đợi các tệp mới chọn chưa nạp hoặc nạp thất bại */}
            {regularFileQueue.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">Tệp chờ nạp ({regularFileQueue.length})</p>
                <ul className="space-y-2">
                  {regularFileQueue.map((item) => (
                    <li key={item.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-[#e2e7ec] p-3">
                      <FileText size={18} className="mt-0.5 shrink-0 text-[#1d4f88]" />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold text-[#142747]">{item.file.name}</p>
                        <p className="text-xs text-[#718294]">
                          {item.state === "loading" ? "Đang bóc tách và lập chỉ mục..." : item.state === "error" ? "Nạp thất bại" : "Sẵn sàng nạp"}
                        </p>
                        {item.error && <p className="mt-1 break-words text-xs text-rose-700">{item.error}</p>}
                      </div>
                      <button
                        type="button"
                        aria-label={`Bỏ tệp ${item.file.name}`}
                        disabled={busy || reviewBusy}
                        onClick={() => removeFile(item.id)}
                        className="shrink-0 rounded-lg p-2 text-[#718294] hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-[#1d4f88] disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {regularFileQueue.length === 0 && reviewPendingItems.length === 0 && (
              <p className="text-center text-sm text-[#718294]">Chưa có tệp trong hàng đợi.</p>
            )}
          </section>}
          {mode === "text" && <section className="space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-4 sm:p-6">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setContent(LEGAL_TEXT_SAMPLE)} className="rounded-xl border border-[#1d4f88] px-3 py-2 text-xs font-bold text-[#1d4f88]">Nạp văn bản mẫu chuẩn</button>
              <button type="button" onClick={() => setGuideOpen(true)} className="rounded-xl border border-[#cbd5df] px-3 py-2 text-xs font-bold text-[#142747]">Hướng dẫn Thể thức Chuẩn</button>
            </div>
            <p className="text-xs text-amber-800">Mẫu chỉ minh họa thể thức. Thay các đoạn trong ngoặc vuông bằng toàn văn đã đối chiếu trước khi nạp.</p>
            <div><label htmlFor="legal-text" className="text-sm font-semibold text-[#142747]">Nội dung văn bản</label>
              <textarea id="legal-text" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Dán toàn văn nội dung quy định, nghị định, thông tư hoặc điều khoản pháp luật vào đây..."
                className="mt-2 min-h-72 w-full resize-y rounded-xl border border-[#cbd5df] bg-[#fcfcfb] p-4 text-sm leading-6 text-[#142747] outline-none focus:border-[#1d4f88]" /></div>
            <div><label htmlFor="source-url" className="text-sm font-semibold text-[#142747]">Đường dẫn nguồn tham chiếu <span className="font-normal text-[#718294]">(tùy chọn)</span></label>
              <input id="source-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://congbao.chinhphu.vn/..."
                className="mt-2 h-11 w-full rounded-xl border border-[#cbd5df] px-3 text-sm outline-none focus:border-[#1d4f88]" /></div>
          </section>}
          <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle>Hướng dẫn Thể thức Chuẩn</DialogTitle><DialogDescription>Kiểm tra thông tin hành chính và phân cấp trước khi nạp văn bản.</DialogDescription></DialogHeader>
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">
                <li>Cơ quan ban hành: ghi rõ CHÍNH PHỦ, QUỐC HỘI hoặc cơ quan tương ứng.</li>
                <li>Số hiệu: dùng dạng “Số: 13/2023/NĐ-CP”.</li>
                <li>Quốc hiệu và tiêu ngữ: ghi đủ hai dòng theo thể thức chính thức.</li>
                <li>Địa danh và ngày ban hành: ghi ngày, tháng, năm đầy đủ.</li>
                <li>Tên loại và trích yếu: ví dụ NGHỊ ĐỊNH, Về bảo vệ dữ liệu cá nhân.</li>
                <li>Nội dung: phân cấp Chương I, Điều 1., khoản 1., khoản 2. rõ ràng.</li>
              </ol>
            </DialogContent>
          </Dialog>
          {mode === "url" && <section className="rounded-2xl border border-[#d3dbe4] bg-white p-4 sm:p-6">
            <label htmlFor="legal-url" className="text-sm font-semibold text-[#142747]">URL văn bản pháp luật</label>
            <input id="legal-url" ref={urlInputRef} type="url" value={url} disabled={busy}
              onChange={(event) => { setUrl(event.target.value); setError(""); if (!lastCompleted) setResults([]); }}
              placeholder="https://congbao.chinhphu.vn/..."
              className="mt-2 h-12 w-full rounded-xl border border-[#cbd5df] px-3 text-sm outline-none focus:border-[#1d4f88] disabled:bg-[#f1f4f7]" />
            <p className="mt-3 text-xs leading-5 text-[#718294]">Hệ thống tải trang công khai, trích xuất nội dung chính và nhận diện metadata từ văn bản.</p>
          </section>}

          {/* Danh sách tài liệu cần rà soát — duy trì liên tục qua các tab cho đến khi hoàn tất nạp vào ChromaDB */}
          {reviewPendingItems.length > 0 && (
            <section className="min-w-0 space-y-3 rounded-2xl border border-amber-200 bg-white p-4 sm:p-6 shadow-2xs">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between border-b border-amber-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                    {reviewPendingItems.length}
                  </span>
                  <h2 className="font-editorial text-lg font-semibold text-[#142747]">
                    Tài liệu cần rà soát &amp; hoàn thiện
                  </h2>
                </div>
                <p className="text-xs font-medium text-amber-800">
                  Chưa nạp vào ChromaDB Vector • Vui lòng xác nhận metadata để lập chỉ mục
                </p>
              </div>

              <ul className="space-y-2.5 pt-1">
                {reviewPendingItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex min-w-0 items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 transition-colors hover:bg-amber-50/70"
                  >
                    <FileText size={18} className="mt-0.5 shrink-0 text-amber-800" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-words text-sm font-bold text-[#142747]">{item.file.name}</p>
                        <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                          Cần rà soát
                        </span>
                      </div>
                      {item.result?.warnings && item.result.warnings.length > 0 && (
                        <p className="mt-1 text-xs text-amber-900 leading-relaxed">
                          {item.result.warnings.join(" ")}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-[#627385]">
                        Kích thước: {(item.file.size / 1024).toFixed(1)} KB • Cần quản trị viên kiểm tra cấu trúc Điều/Khoản
                      </p>
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy || reviewBusy}
                          onClick={() => openReview(item)}
                          className="rounded-lg border border-amber-300 bg-amber-100/90 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:opacity-50 transition-colors shadow-2xs"
                        >
                          Rà soát &amp; Hoàn thiện
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Bỏ tệp ${item.file.name}`}
                      disabled={busy || reviewBusy}
                      onClick={() => removeFile(item.id)}
                      title="Bỏ qua tệp này"
                      className="shrink-0 rounded-lg p-2 text-[#718294] hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-[#1d4f88] disabled:opacity-50 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="min-w-0 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6 xl:self-start" aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a785d]">TIẾN TRÌNH XỬ LÝ</p>
          <h2 className="font-editorial mt-1 text-xl font-semibold text-[#142747]">Tự động bóc tách</h2>
          <ol className="mt-5 space-y-4 text-sm text-[#56677c]"><li>1. Tiếp nhận và đọc nội dung</li><li>2. Nhận diện văn bản và Điều/Khoản</li><li>3. Lập chỉ mục và đồng bộ danh mục</li></ol>
          {busy && <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#1d4f88]"><Loader2 size={17} className="motion-safe:animate-spin" />{progress ? `Đang xử lý ${progress.current}/${progress.total} tệp...` : "Đang xử lý nguồn tri thức..."}</p>}
          {error && <p role="alert" className="mt-5 flex items-start gap-2 break-words rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</p>}
          <button type="submit" disabled={busy || currentUrlCompleted}
            className={`mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-center text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d4f88] ${currentUrlCompleted ? "cursor-not-allowed bg-[#e5f0f3] text-[#24556b]" : "bg-[#1d4f88] text-white hover:bg-[#153b66] disabled:opacity-50"}`}>
            {busy ? <><Loader2 size={17} className="motion-safe:animate-spin" />Đang xử lý...</> : currentUrlCompleted ? <><CheckCircle2 size={17} />{lastCompleted.status === "duplicate" ? "Dữ liệu đã có sẵn" : "Đã nạp vào kho tri thức"}</> : <>{mode === "file" ? "Bắt đầu nạp & Lập chỉ mục" : mode === "text" ? "Nạp vào nguồn tri thức" : "Cào dữ liệu & Lập chỉ mục"}<ArrowRight size={17} className="shrink-0" /></>}
          </button>
          {mode === "url" && currentUrlCompleted && <button type="button" onClick={resetUrl}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#b8cad8] bg-white px-3 text-sm font-semibold text-[#1d4f88] hover:bg-[#eef4f9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d4f88]">
            <RotateCcw size={16} />Nạp liên kết mới
          </button>}
        </aside>
      </form>
      {results.length > 0 && (mode !== "url" || !lastCompleted || currentUrlCompleted) && <section aria-live="polite" className="space-y-4">
        <h2 className="font-editorial text-xl font-semibold text-[#142747]">Tri thức đã nhận diện</h2>
        <div className="grid gap-4 lg:grid-cols-2">{results.map((result, index) =>
          <article key={`${result.doc_id}-${index}`} className="min-w-0 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">{result.status === "duplicate" ? <Info size={18} className="text-sky-700" /> : <CheckCircle2 size={18} className={result.status === "indexed" ? "text-emerald-700" : "text-amber-700"} />}
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${result.status === "indexed" ? "bg-emerald-50 text-emerald-800" : result.status === "duplicate" ? "bg-sky-50 text-sky-800" : "bg-amber-50 text-amber-800"}`}>
                {result.status === "indexed" ? "AI đã tự động bóc tách thành công" : result.status === "duplicate" ? "Dữ liệu đã có sẵn trong kho tri thức" : "Cần rà soát trước khi lập chỉ mục"}
              </span></div>
            <h3 className="mt-4 break-words font-editorial text-lg font-semibold text-[#142747]">{result.doc_title || "Chưa nhận diện tên văn bản"}</h3>
            {result.status === "duplicate" && <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm leading-6 text-sky-900">Tài liệu này đã được lập chỉ mục trước đó. Bạn có thể tra cứu ngay mà không cần nạp lại.</p>}
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-[#718294]">Số ký hiệu</dt><dd className="break-words font-semibold text-[#142747]">{result.doc_number?.startsWith("CHUA-XAC-DINH-") ? "Chưa xác định" : result.doc_number || "Chưa xác định"}</dd></div>
              <div><dt className="text-[#718294]">Cơ quan ban hành</dt><dd className="break-words font-semibold text-[#142747]">{result.issuing_authority || "Chưa xác định"}</dd></div>
              <div><dt className="text-[#718294]">Tình trạng hiệu lực</dt><dd className="font-semibold text-[#142747]">{statusLabels[result.effective_status] || "Chưa xác minh"}</dd></div>
              <div><dt className="text-[#718294]">Ngày ban hành</dt><dd className="font-semibold text-[#142747]">{result.issued_date || "Chưa xác định"}</dd></div>
              <div><dt className="text-[#718294]">Số Điều</dt><dd className="font-semibold text-[#142747]">{result.status === "duplicate" && !result.article_count ? "Chưa thống kê" : result.article_count ?? 0}</dd></div>
              <div><dt className="text-[#718294]">Vector chunks</dt><dd className="font-semibold text-[#142747]">{result.status === "duplicate" && !result.chunk_count ? "Chưa thống kê" : result.chunk_count ?? 0}</dd></div>
            </dl>
            {result.warnings && result.warnings.length > 0 && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{result.warnings.join(" ")}</p>}
            {(result.status === "indexed" || result.status === "duplicate") && <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3">
              <Link to="/admin/chat" className="inline-flex items-center gap-2 text-sm font-bold text-[#1d4f88] hover:underline focus-visible:outline-2 focus-visible:outline-[#1d4f88]">Thử hỏi Chatbot <ArrowRight size={16} /></Link>
              <Link to="/admin/documents" className="inline-flex items-center gap-2 text-sm font-bold text-[#1d4f88] hover:underline focus-visible:outline-2 focus-visible:outline-[#1d4f88]">Xem danh mục tài liệu <ArrowRight size={16} /></Link>
            </div>}
          </article>)}</div>
      </section>}
      <Dialog open={Boolean(reviewItem && reviewMetadata)} onOpenChange={(open) => { if (!open && !reviewBusy) { setReviewId(null); setReviewMetadata(null); } }}>
        <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); reviewHeadingRef.current?.focus(); }} className="max-h-[90dvh] overflow-y-auto bg-white sm:max-w-2xl motion-reduce:animate-none">
          {reviewItem?.result && reviewMetadata && <>
            <DialogHeader>
              <DialogTitle ref={reviewHeadingRef} tabIndex={-1} className="pr-6 text-[#142747]">Rà soát &amp; Hoàn thiện</DialogTitle>
              <DialogDescription className="text-slate-600">Không nhận diện được cấu trúc Điều/Khoản. Hãy kiểm tra nội dung, hoàn thiện metadata rồi quyết định có lập chỉ mục theo đoạn văn hay không.</DialogDescription>
            </DialogHeader>
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-[#142747]">{reviewItem.file.name}</p>
              {reviewItem.result.warnings?.length ? <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{reviewItem.result.warnings.join(" ")}</p> : null}
              <h3 className="mt-4 text-sm font-bold text-[#142747]">Nội dung đã trích xuất</h3>
              {reviewItem.result.raw_text_preview?.trim() ? <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-5 text-slate-800">{reviewItem.result.raw_text_preview}</pre>
                : <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Không có nội dung đọc được. Hãy OCR lại tệp trước khi lập chỉ mục.</p>}
              {reviewItem.result.raw_text_preview && reviewItem.result.raw_text_preview.length >= 4000 && <p className="mt-1 text-xs text-slate-600">Chỉ hiển thị 4.000 ký tự đầu để rà soát.</p>}
            </div>
            <form onSubmit={forceIngest} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-semibold text-[#142747] sm:col-span-2">Tên văn bản
                  <input required maxLength={300} value={reviewMetadata.doc_title} onChange={(event) => setReviewMetadata({ ...reviewMetadata, doc_title: event.target.value })} className="block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-[#1d4f88]" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-[#142747]">Số hiệu
                  <input required maxLength={100} value={reviewMetadata.doc_number} onChange={(event) => setReviewMetadata({ ...reviewMetadata, doc_number: event.target.value })} className="block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-[#1d4f88]" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-[#142747]">Cơ quan ban hành
                  <input required maxLength={200} value={reviewMetadata.issuing_authority} onChange={(event) => setReviewMetadata({ ...reviewMetadata, issuing_authority: event.target.value })} className="block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-[#1d4f88]" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-[#142747]">Ngày ban hành
                  <input required type="date" value={reviewMetadata.issued_date} onChange={(event) => setReviewMetadata({ ...reviewMetadata, issued_date: event.target.value })} className="block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-[#1d4f88]" />
                </label>
                <label className="space-y-1 text-sm font-semibold text-[#142747]">Tình trạng hiệu lực
                  <select value={reviewMetadata.effective_status} onChange={(event) => setReviewMetadata({ ...reviewMetadata, effective_status: event.target.value })} className="block h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-[#1d4f88]">
                    <option value="unknown">Chưa xác minh</option><option value="active">Còn hiệu lực</option><option value="partially_expired">Hết hiệu lực một phần</option><option value="expired">Hết hiệu lực</option>
                  </select>
                </label>
              </div>
              {reviewError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{reviewError}</p>}
              <DialogFooter className="sticky bottom-0 z-10 -mx-6 -mb-6 border-t border-slate-200 bg-white p-3 sm:-mx-6 sm:-mb-6 sm:px-6 sm:py-4">
                <button type="button" disabled={reviewBusy} onClick={discardReview} className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Bỏ qua tệp này</button>
                <button type="submit" disabled={reviewBusy || !reviewItem.result.raw_text_preview?.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#1d4f88] px-4 text-sm font-bold text-white hover:bg-[#153b66] disabled:cursor-not-allowed disabled:opacity-50">
                  {reviewBusy && <Loader2 size={16} className="motion-safe:animate-spin" />}Lập chỉ mục theo đoạn văn (Force Ingest)
                </button>
              </DialogFooter>
            </form>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
