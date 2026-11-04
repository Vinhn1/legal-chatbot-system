import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import axios from "axios";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  FileSearch,
  FileText,
  Globe,
  Info,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { API_BASE } from "../../../config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";
import { Switch } from "../../components/ui/switch";
import { formatOcrStageLabel, useIngestJobs } from "../../context/ingest-jobs-state";
import {
  getInMemoryFiles,
  loadPendingReviewsFromDb,
  removePendingReviewFromDb,
  savePendingReviewToDb,
  setInMemoryFiles,
  subscribeInMemoryFiles,
  syncFilesStorage,
} from "../../services/ingestStorage";
import { showVeritasToast } from "../../services/veritasToast";

export type Mode = "file" | "text" | "url";
export type Result = {
  status: "indexed" | "duplicate" | "needs_review" | "partial";
  job_id?: string;
  doc_id: string;
  doc_title: string;
  doc_number: string;
  issuing_authority: string;
  issued_date: string;
  effective_status: string;
  article_count: number;
  chunk_count: number;
  structure_status?: string;
  coverage?: number;
  warnings?: string[];
  document_type?: string;
  effective_date?: string | null;
  source_url?: string;
  scope?: string;
  raw_text_preview?: string;
};
export type FileItem = {
  id: string;
  file: File;
  state: "ready" | "loading" | "done" | "error";
  result?: Result;
  error?: string;
};
type DocumentTypeCode = "law" | "decree" | "circular" | "resolution";
type ReviewMetadata = {
  doc_title: string;
  doc_number: string;
  document_type: DocumentTypeCode;
  issuing_authority: string;
  issued_date: string;
  effective_date: string | null;
  effective_status: string;
  scope: "public" | "internal";
  raw_text: string;
};

/** Chuẩn hóa mã loại văn bản quy phạm pháp luật hợp lệ cho biểu mẫu rà soát. */
function normalizeDocumentType(value?: string): DocumentTypeCode {
  if (value === "law" || value === "decree" || value === "circular" || value === "resolution") {
    return value;
  }
  return "law";
}

/** Chuẩn hóa tiêu đề văn bản hiển thị sạch đẹp, tránh dính gạch dưới thô. */
function cleanItemTitle(raw: string): string {
  if (!raw) return "";
  let cleaned = raw.replace(/[_\-]+/g, " ").trim();
  cleaned = cleaned.replace(/^(?:BC|Bc)\s+/i, "Báo cáo ");
  cleaned = cleaned.replace(/^(?:QC|Qc)\s+/i, "Quy chế ");
  cleaned = cleaned.replace(/^(?:QD|Qd)\s+/i, "Quy định ");
  cleaned = cleaned.replace(/^(?:HD|Hd)\s+/i, "Hướng dẫn ");
  cleaned = cleaned.replace(/^(?:GT|Gt)\s+/i, "Giáo trình ");
  cleaned = cleaned.replace(/^(?:ST|St)\s+/i, "Sổ tay ");
  return cleaned.replace(/\s+/g, " ").trim() || raw;
}

/** Xây dựng đối tượng metadata rà soát từ kết quả phân tích của một tệp. */
function buildReviewMetadataFromItem(item: FileItem): ReviewMetadata {
  const res = item.result;
  return {
    doc_title: cleanItemTitle(res?.doc_title || item.file.name.replace(/\.[^.]+$/, "")),
    doc_number:
      res?.doc_number?.startsWith("CHUA-XAC-DINH-") || res?.doc_number?.startsWith("TL-")
        ? ""
        : res?.doc_number || "",
    document_type: normalizeDocumentType(res?.document_type),
    issuing_authority: res?.issuing_authority === "Chưa xác định" ? "" : res?.issuing_authority || "",
    issued_date: res?.issued_date || "",
    effective_date: res?.effective_date || null,
    effective_status: res?.effective_status || "unknown",
    scope: res?.scope === "internal" ? "internal" : "public",
    raw_text: res?.raw_text_preview || "",
  };
}

const statusLabels: Record<string, string> = {
  active: "Đang hiệu lực",
  expired: "Hết hiệu lực",
  partially_expired: "Hết hiệu lực một phần",
  unknown: "Chưa xác minh",
};

// Mẫu thể thức cấu trúc tài liệu quy chuẩn; nội dung điều khoản là chỗ điền.
const LEGAL_TEXT_SAMPLE = `CƠ QUAN / ĐƠN VỊ BAN HÀNH
Số: QC-2024/01

QUY CHẾ QUẢN TRỊ NỘI BỘ
Về tiêu chuẩn và quy trình vận hành

Chương I
QUY ĐỊNH CHUNG

Điều 1. Phạm vi áp dụng
1. [Thay bằng nguyên văn khoản 1 theo tài liệu đối chiếu chính thức.]
2. [Thay bằng nguyên văn khoản 2 theo tài liệu đối chiếu chính thức.]

Điều 2. Trách nhiệm và quyền hạn
1. [Thay bằng nguyên văn nội dung trách nhiệm các bên liên quan.]

ĐẠI DIỆN ĐƠN VỊ BAN HÀNH
[Họ tên người ký]`;

/** Chỉ hiển thị lỗi an toàn từ API, không đưa nội dung tài liệu vào thông báo. */
function errorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.message ?? error.response?.data?.detail;
    if (typeof detail === "string") return detail;
  }
  return error instanceof Error ? error.message : "Không thể nạp tài liệu. Vui lòng thử lại.";
}

/** Nhận nguồn đầu vào pháp luật, hỗ trợ chạy ngầm AI OCR cho PDF scan và đồng bộ thông báo toàn cục. */
export function AdminIngestPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    runningJobs,
    completedResults,
    startBackgroundOcrJob,
    notifySyncIngestResult,
  } = useIngestJobs();

  const [mode, setMode] = useState<Mode>("file");
  // Khởi tạo hàng đợi tệp từ bộ nhớ tạm để không mất dữ liệu khi chuyển trang
  const [files, setFiles] = useState<FileItem[]>(() => getInMemoryFiles());
  const [autoBackgroundOcr, setAutoBackgroundOcr] = useState(true);
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
  const [recoveryBusy, setRecoveryBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewMetadata, setReviewMetadata] = useState<ReviewMetadata | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const reviewIdRef = useRef<string | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    reviewIdRef.current = reviewId;
  }, [reviewId]);

  const reviewItem = files.find((item) => item.id === reviewId && item.result?.status === "needs_review");
  const activeModalJob = useMemo(
    () => (reviewItem ? runningJobs.find((job) => job.reviewFileId === reviewItem.id) : undefined),
    [reviewItem, runningJobs],
  );
  const currentUrlCompleted = mode === "url" && !!lastCompleted && url.trim() === lastCompleted.url;

  // Lọc riêng danh sách tài liệu cần rà soát và danh sách tệp chờ nạp thông thường
  const reviewPendingItems = files.filter((item) => item.result?.status === "needs_review");
  const regularFileQueue = files.filter((item) => item.result?.status !== "needs_review");

  // Hợp nhất kết quả nạp trực tiếp và kết quả chạy ngầm (chỉ hiển thị tài liệu đã xử lý thực sự, loại bỏ needs_review)
  const displayedResults = useMemo(() => {
    const merged: Result[] = [];
    const seen = new Set<string>();
    for (const entry of [...completedResults, ...results]) {
      if (entry.status === "needs_review") continue;
      const key = entry.doc_id || `${entry.doc_number}-${entry.doc_title}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(entry);
      }
    }
    return merged;
  }, [completedResults, results]);

  /** Mở hộp thoại rà soát cho một tệp cụ thể mà không khóa giao diện khi cần chạy OCR. */
  const openReview = useCallback(
    (item: FileItem, triggerPreviewOcr = true) => {
      if (!item.result || item.result.status !== "needs_review") return;
      const initialMeta = buildReviewMetadataFromItem(item);
      setReviewMetadata(initialMeta);
      setReviewError("");
      setReviewId(item.id);

      const alreadyRunning = runningJobs.some((job) => job.reviewFileId === item.id);
      if (triggerPreviewOcr && !initialMeta.raw_text.trim() && /\.pdf$/i.test(item.file.name) && !alreadyRunning) {
        void startBackgroundOcrJob(item.file, {
          autoIngest: false,
          reviewFileId: item.id,
          silentStartToast: true,
        }).catch(() => undefined);
      }
    },
    [runningJobs, startBackgroundOcrJob],
  );

  // Lắng nghe cập nhật từ tiến trình chạy ngầm toàn cục để tự điền văn bản OCR vào form hoặc gỡ tệp đã nạp xong
  useEffect(() => {
    return subscribeInMemoryFiles((updatedFiles) => {
      setFiles(updatedFiles);
      const activeId = reviewIdRef.current;
      if (!activeId) return;
      const matched = updatedFiles.find((item) => item.id === activeId);
      if (!matched) {
        setReviewId(null);
        setReviewMetadata(null);
        return;
      }
      if (matched.result?.raw_text_preview) {
        const nextMeta = buildReviewMetadataFromItem(matched);
        setReviewMetadata((prev) => {
          if (!prev) return nextMeta;
          return {
            ...prev,
            raw_text: prev.raw_text.trim() ? prev.raw_text : nextMeta.raw_text,
            doc_title: nextMeta.doc_title || prev.doc_title,
            doc_number: prev.doc_number || nextMeta.doc_number,
            document_type: nextMeta.document_type || prev.document_type,
            issuing_authority: prev.issuing_authority || nextMeta.issuing_authority,
            issued_date: nextMeta.issued_date || prev.issued_date,
            effective_date: nextMeta.effective_date ?? prev.effective_date,
            effective_status:
              nextMeta.effective_status !== "unknown" ? nextMeta.effective_status : prev.effective_status,
          };
        });
      }
    });
  }, []);

  // Nạp lại các tệp cần rà soát đã lưu trong IndexedDB khi khởi tạo và hỗ trợ mở nhanh từ thông báo (?review=...)
  useEffect(() => {
    let isMounted = true;
    void loadPendingReviewsFromDb().then((stored) => {
      if (!isMounted) return;
      let combined = getInMemoryFiles();
      if (stored.length > 0) {
        const existingIds = new Set(combined.map((item) => item.id));
        const merged = [...combined];
        for (const item of stored) {
          if (!existingIds.has(item.id)) {
            merged.push(item);
          }
        }
        combined = merged;
        setInMemoryFiles(merged);
        setFiles(merged);
      }
      const requestedReviewId = searchParams.get("review");
      if (requestedReviewId) {
        const target = combined.find((entry) => entry.id === requestedReviewId && entry.result?.status === "needs_review");
        if (target) {
          openReview(target, false);
        }
        setSearchParams({}, { replace: true });
      }
    });
    return () => {
      isMounted = false;
    };
  }, [openReview, searchParams, setSearchParams]);

  // Tự động đồng bộ trạng thái tệp sang bộ nhớ RAM và IndexedDB
  useEffect(() => {
    syncFilesStorage(files);
  }, [files]);

  /** Retry chỉ đồng bộ metadata đã lưu, giữ dữ liệu nhập khi API gặp lỗi. */
  const recoverSync = async (result: Result) => {
    if (!result.job_id || recoveryBusy) return;
    setRecoveryBusy(result.job_id);
    try {
      await axios.post(`${API_BASE}/legal/jobs/${result.job_id}/retry`);
      setResults((current) => current.map((row) => (row.job_id === result.job_id ? { ...row, status: "indexed" } : row)));
      setFiles((current) => current.filter((row) => row.result?.job_id !== result.job_id));
      showVeritasToast({
        variant: "success",
        title: "Đã phục hồi đồng bộ metadata",
        description: "Bản ghi PostgreSQL và kho vector ChromaDB đã khớp hoàn toàn.",
        docTitle: result.doc_title,
        durationMs: 6500,
      });
    } catch {
      setError("Chưa thể phục hồi đồng bộ. Vui lòng kiểm tra công việc và thử lại.");
    } finally {
      setRecoveryBusy(null);
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
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const updateFile = (id: string, change: Partial<FileItem>) => {
    setFiles((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));
  };

  /** Xóa hoàn toàn một tệp khỏi hàng đợi và kho lưu trữ. */
  const removeFile = (id: string) => {
    setFiles((current) => current.filter((entry) => entry.id !== id));
    void removePendingReviewFromDb(id);
  };

  /** Kích hoạt quét AI OCR theo dõi tiến độ theo trang cho tệp đang mở trong hộp thoại rà soát. */
  const runPreviewAiOcrInModal = async () => {
    if (!reviewItem || activeModalJob || reviewBusy) return;
    setReviewError("");
    try {
      await startBackgroundOcrJob(reviewItem.file, {
        autoIngest: false,
        reviewFileId: reviewItem.id,
        silentStartToast: true,
      });
    } catch (ocrErr) {
      setReviewError(errorText(ocrErr));
    }
  };

  /** Chuyển tệp PDF scan sang luồng quét AI OCR & tự động lập chỉ mục hoàn toàn trong nền và đóng hộp thoại ngay. */
  const dispatchAutoIngestInBackground = async (item: FileItem, currentMeta?: ReviewMetadata | null) => {
    const metaPayload = currentMeta
      ? {
          doc_id: item.result?.doc_id,
          doc_title: currentMeta.doc_title.trim(),
          doc_number: currentMeta.doc_number.trim(),
          document_type: currentMeta.document_type,
          issuing_authority: currentMeta.issuing_authority.trim(),
          issued_date: currentMeta.issued_date,
          effective_status: currentMeta.effective_status,
          scope: currentMeta.scope,
        }
      : undefined;

    if (reviewId === item.id) {
      setReviewId(null);
      setReviewMetadata(null);
    }

    try {
      await startBackgroundOcrJob(item.file, {
        autoIngest: true,
        reviewFileId: item.id,
        metadata: metaPayload,
        scope: currentMeta?.scope || "public",
      });
    } catch {
      // Thông báo lỗi đã được phát bởi IngestJobsContext
    }
  };

  /** Chỉ gửi cờ cưỡng bức sau khi metadata đã được kiểm tra và người dùng xác nhận. */
  const forceIngest = async (event: FormEvent) => {
    event.preventDefault();
    if (!reviewItem?.result || !reviewMetadata || reviewBusy || Boolean(activeModalJob)) return;
    const title = reviewMetadata.doc_title.trim();
    const number = reviewMetadata.doc_number.trim();
    const authority = reviewMetadata.issuing_authority.trim();
    const textContent = reviewMetadata.raw_text.trim();
    if (!title || !number || !authority || !reviewMetadata.issued_date) {
      setReviewError("Vui lòng hoàn thiện đầy đủ Tên văn bản, Số hiệu, Cơ quan ban hành và Ngày ban hành.");
      return;
    }
    if (!textContent) {
      setReviewError(
        "Chưa có nội dung văn bản để lập chỉ mục. Hãy bấm Quét AI OCR hoặc chuyển tệp sang Chạy ngầm & Tự động nạp.",
      );
      return;
    }
    setReviewBusy(true);
    setReviewError("");
    updateFile(reviewItem.id, { state: "loading", error: undefined });
    const form = new FormData();
    form.append("file", reviewItem.file);
    form.append("force_paragraph", "true");
    form.append("override_text", textContent);
    form.append(
      "metadata",
      JSON.stringify({
        doc_id: reviewItem.result.doc_id,
        doc_title: title,
        doc_number: number,
        issuing_authority: authority,
        issued_date: reviewMetadata.issued_date,
        effective_status: reviewMetadata.effective_status,
        effective_date: reviewMetadata.effective_date || null,
        document_type: reviewMetadata.document_type,
        source_url: reviewItem.result.source_url || "https://congbao.chinhphu.vn",
        scope: reviewMetadata.scope,
      }),
    );
    try {
      const response = await axios.post<Result>(`${API_BASE}/legal/ingest`, form, { timeout: 600000 });
      const result = response.data;
      if (result.status === "indexed" || result.status === "duplicate" || result.status === "partial") {
        setResults((current) => [result, ...current.filter((entry) => entry.doc_id !== result.doc_id)]);
        setFiles((current) => current.filter((item) => item.id !== reviewItem.id));
        void removePendingReviewFromDb(reviewItem.id);
        setReviewId(null);
        setReviewMetadata(null);
        notifySyncIngestResult(result);
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

  /** Nạp nguồn đầu vào và tự động đẩy tệp PDF scan sang luồng OCR chạy ngầm khi tùy chọn được bật. */
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || currentUrlCompleted) return;
    setError("");
    if (mode === "file" && !files.some((item) => item.state === "ready" || item.state === "error")) {
      setError(
        files.some((item) => item.result?.status === "needs_review")
          ? "Các tệp còn lại đang chờ rà soát hoặc đang chạy ngầm AI OCR ở khung bên dưới."
          : "Vui lòng chọn ít nhất một tệp PDF, DOCX hoặc TXT.",
      );
      return;
    }
    if (mode === "text" && !content.trim()) {
      setError("Vui lòng dán nội dung văn bản cần nạp.");
      return;
    }
    if (mode === "text" && /\[Thay bằng nguyên văn|\[Họ tên người ký\]/.test(content)) {
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

          // Khi là tệp PDF và người dùng bật tùy chọn tự động chạy ngầm (AI OCR / LlamaParse)
          if (/\.pdf$/i.test(item.file.name) && autoBackgroundOcr) {
            updateFile(item.id, { state: "loading", error: undefined });
            try {
              await startBackgroundOcrJob(item.file, {
                autoIngest: true,
                reviewFileId: item.id,
              });
              setFiles((current) => current.filter((entry) => entry.id !== item.id));
              void removePendingReviewFromDb(item.id);
            } catch (jobErr) {
              failed++;
              updateFile(item.id, { state: "error", error: errorText(jobErr) });
            }
            continue;
          }

          updateFile(item.id, { state: "loading", error: undefined });
          const form = new FormData();
          form.append("file", item.file);
          try {
            const response = await axios.post<Result>(`${API_BASE}/legal/ingest`, form);
            const resData = response.data;
            if (resData.status === "indexed" || resData.status === "duplicate" || resData.status === "partial") {
              completed.push(resData);
              notifySyncIngestResult(resData);
              if (resData.status === "indexed" || resData.status === "duplicate") {
                setFiles((current) => current.filter((entry) => entry.id !== item.id));
                void removePendingReviewFromDb(item.id);
              } else {
                updateFile(item.id, { state: "done", result: resData });
              }
            } else if (resData.status === "needs_review") {
              const savedItem: FileItem = { ...item, state: "done", result: resData };
              updateFile(item.id, { state: "done", result: resData });
              void savePendingReviewToDb(savedItem);

              const isScannedPdfWithoutText =
                /\.pdf$/i.test(item.file.name) && !(resData.raw_text_preview || "").trim();
              if (isScannedPdfWithoutText && autoBackgroundOcr) {
                void startBackgroundOcrJob(item.file, {
                  autoIngest: true,
                  reviewFileId: item.id,
                }).catch(() => undefined);
              }
            }
          } catch (fileError) {
            failed++;
            updateFile(item.id, { state: "error", error: errorText(fileError) });
          }
        }
        if (completed.length > 0) {
          setResults((prev) => [...completed, ...prev]);
        }
        if (failed) setError(`${failed} tệp chưa nạp được. Kiểm tra lỗi tại từng tệp và thử lại.`);
      } else if (mode === "text") {
        const response = await axios.post<Result>(`${API_BASE}/legal/ingest-text`, {
          content: content.trim(),
          sourceUrl: sourceUrl.trim() || undefined,
        });
        if (response.data.status !== "needs_review") {
          setResults([response.data]);
          notifySyncIngestResult(response.data);
        }
      } else {
        const response = await axios.post<Result>(`${API_BASE}/legal/ingest-url`, { url: url.trim() });
        if (response.data.status !== "needs_review") {
          setResults([response.data]);
        }
        if (response.data.status === "indexed" || response.data.status === "duplicate") {
          setLastCompleted({ url: url.trim(), status: response.data.status });
        }
        notifySyncIngestResult(response.data);
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
      <header className="border-b border-[#d8dee5] pb-5 dark:border-slate-800">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a785d]">TIẾP NHẬN NGUỒN MỚI</p>
        <h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747] dark:text-slate-100">
          Nạp tài liệu & văn bản
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#56677c] dark:text-slate-400">
          Tiếp nhận tệp PDF, DOCX, TXT hoặc URL tài liệu. Tệp PDF scan nhiều trang được hỗ trợ quét AI OCR và lập chỉ mục chạy ngầm kèm thông báo tự động khi hoàn tất.
        </p>
      </header>

      <form onSubmit={submit} className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <div
            role="tablist"
            aria-label="Nguồn nạp tài liệu"
            className="grid grid-cols-3 gap-2 rounded-2xl border border-[#d3dbe4] bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
          >
            {(
              [
                { id: "file", label: "Tệp", icon: UploadCloud },
                { id: "text", label: "Văn bản", icon: FileText },
                { id: "url", label: "URL", icon: Globe },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === tab.id}
                  onClick={() => {
                    setMode(tab.id);
                    setError("");
                  }}
                  className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#1d4f88] ${
                    mode === tab.id
                      ? "bg-[#1d4f88] text-white"
                      : "text-[#516278] hover:bg-[#eef4f9] dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon size={17} className="shrink-0" />
                  <span>{tab.label}</span>
                  {tab.id === "file" && (reviewPendingItems.length > 0 || runningJobs.length > 0) && (
                    <span
                      className={`ml-1 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ${
                        mode === tab.id
                          ? "bg-amber-400 text-amber-950"
                          : "border border-amber-300 bg-amber-100 text-amber-900"
                      }`}
                    >
                      {runningJobs.length > 0 ? runningJobs.length : reviewPendingItems.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {mode === "file" && (
            <section className="min-w-0 space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragging(false);
                }}
                onDrop={onDrop}
                className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
                  dragging
                    ? "border-[#1d4f88] bg-[#eef4f9] dark:bg-blue-950/30"
                    : "border-[#cbd5df] bg-[#fafaf9] dark:border-slate-700 dark:bg-slate-800/50"
                }`}
              >
                <UploadCloud size={32} className="mx-auto text-[#1d4f88] dark:text-blue-400" />
                <p className="mt-3 text-sm font-semibold text-[#142747] dark:text-slate-100">
                  Kéo thả nhiều tệp vào đây
                </p>
                <p className="mt-1 text-xs text-[#718294] dark:text-slate-400">
                  PDF (văn bản số hoặc bản scan), DOCX, TXT; tối đa 15 MB mỗi tệp
                </p>
                <label className="mt-4 inline-flex cursor-pointer rounded-xl bg-[#1d4f88] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#153b66] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#1d4f88]">
                  Chọn tệp
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt"
                    className="sr-only"
                    onChange={(event) => {
                      if (event.target.files) addFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>

              {/* Công tắc tự động chạy ngầm AI OCR cho các tệp PDF scan nặng */}
              <div className="flex items-start justify-between gap-4 rounded-xl border border-[#d5e2ef] bg-[#f4f8fc] p-3.5 dark:border-slate-800 dark:bg-slate-800/70">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e2edf8] text-[#1d4f88] dark:bg-blue-950 dark:text-blue-300">
                    <Cpu size={16} />
                  </div>
                  <div>
                    <label
                      htmlFor="auto-bg-ocr-switch"
                      className="cursor-pointer text-xs sm:text-sm font-bold text-[#142747] dark:text-slate-100"
                    >
                      Tự động chạy ngầm AI OCR &amp; LlamaParse cho tệp PDF
                    </label>
                    <p className="mt-0.5 text-xs leading-relaxed text-[#56677c] dark:text-slate-400">
                      Khi nạp tệp PDF, hệ thống tự động bóc tách cấu trúc và dấu đỏ trong nền để bạn tiếp tục làm việc khác và nhận thông báo khi nạp xong.
                    </p>
                  </div>
                </div>
                <Switch
                  id="auto-bg-ocr-switch"
                  checked={autoBackgroundOcr}
                  onCheckedChange={setAutoBackgroundOcr}
                />
              </div>

              {/* Hàng đợi các tệp mới chọn chưa nạp hoặc nạp thất bại */}
              {regularFileQueue.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#6a7b8e] dark:text-slate-400">
                    Tệp chờ nạp ({regularFileQueue.length})
                  </p>
                  <ul className="space-y-2">
                    {regularFileQueue.map((item) => (
                      <li
                        key={item.id}
                        className="flex min-w-0 items-start gap-3 rounded-xl border border-[#e2e7ec] p-3 dark:border-slate-800"
                      >
                        <FileText size={18} className="mt-0.5 shrink-0 text-[#1d4f88] dark:text-blue-400" />
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold text-[#142747] dark:text-slate-100">
                            {item.file.name}
                          </p>
                          <p className="text-xs text-[#718294] dark:text-slate-400">
                            {item.state === "loading"
                              ? "Đang kiểm tra cấu trúc và bóc tách..."
                              : item.state === "error"
                                ? "Nạp thất bại"
                                : `Sẵn sàng nạp • ${(item.file.size / 1024).toFixed(1)} KB`}
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
              {regularFileQueue.length === 0 && reviewPendingItems.length === 0 && runningJobs.length === 0 && (
                <p className="text-center text-sm text-[#718294] dark:text-slate-400">Chưa có tệp trong hàng đợi.</p>
              )}
            </section>
          )}

          {mode === "text" && (
            <section className="space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setContent(LEGAL_TEXT_SAMPLE)}
                  className="rounded-xl border border-[#1d4f88] px-3 py-2 text-xs font-bold text-[#1d4f88] dark:border-blue-400 dark:text-blue-300"
                >
                  Nạp văn bản mẫu chuẩn
                </button>
                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="rounded-xl border border-[#cbd5df] px-3 py-2 text-xs font-bold text-[#142747] dark:border-slate-700 dark:text-slate-200"
                >
                  Hướng dẫn Thể thức Chuẩn
                </button>
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Mẫu chỉ minh họa thể thức. Thay các đoạn trong ngoặc vuông bằng toàn văn đã đối chiếu trước khi nạp.
              </p>
              <div>
                <label htmlFor="legal-text" className="text-sm font-semibold text-[#142747] dark:text-slate-100">
                  Nội dung văn bản
                </label>
                <textarea
                  id="legal-text"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  placeholder="Dán toàn văn nội dung quy định, nghị định, thông tư hoặc điều khoản pháp luật vào đây..."
                  className="mt-2 min-h-72 w-full resize-y rounded-xl border border-[#cbd5df] bg-[#fcfcfb] p-4 text-sm leading-6 text-[#142747] outline-none focus:border-[#1d4f88] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="source-url" className="text-sm font-semibold text-[#142747] dark:text-slate-100">
                  Đường dẫn nguồn tham chiếu <span className="font-normal text-[#718294]">· Không bắt buộc</span>
                </label>
                <input
                  id="source-url"
                  type="url"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://congbao.chinhphu.vn/..."
                  className="mt-2 h-11 w-full rounded-xl border border-[#cbd5df] px-3 text-sm outline-none focus:border-[#1d4f88] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </section>
          )}

          <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Hướng dẫn Thể thức Chuẩn</DialogTitle>
                <DialogDescription>Kiểm tra thông tin hành chính và phân cấp trước khi nạp văn bản.</DialogDescription>
              </DialogHeader>
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700 dark:text-slate-300">
                <li>Cơ quan ban hành: ghi rõ CHÍNH PHỦ, QUỐC HỘI hoặc cơ quan tương ứng.</li>
                <li>Số hiệu: dùng dạng “Số: 13/2023/NĐ-CP”.</li>
                <li>Quốc hiệu và tiêu ngữ: ghi đủ hai dòng theo thể thức chính thức.</li>
                <li>Địa danh và ngày ban hành: ghi ngày, tháng, năm đầy đủ.</li>
                <li>Tên loại và trích yếu: ví dụ NGHỊ ĐỊNH, Về bảo vệ dữ liệu cá nhân.</li>
                <li>Nội dung: phân cấp Chương I, Điều 1., khoản 1., khoản 2. rõ ràng.</li>
              </ol>
            </DialogContent>
          </Dialog>

          {mode === "url" && (
            <section className="rounded-2xl border border-[#d3dbe4] bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <label htmlFor="legal-url" className="text-sm font-semibold text-[#142747] dark:text-slate-100">
                URL văn bản pháp luật
              </label>
              <input
                id="legal-url"
                ref={urlInputRef}
                type="url"
                value={url}
                disabled={busy}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError("");
                  if (!lastCompleted) setResults([]);
                }}
                placeholder="https://congbao.chinhphu.vn/..."
                className="mt-2 h-12 w-full rounded-xl border border-[#cbd5df] px-3 text-sm outline-none focus:border-[#1d4f88] disabled:bg-[#f1f4f7] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <p className="mt-3 text-xs leading-5 text-[#718294] dark:text-slate-400">
                Hệ thống tải trang công khai, trích xuất nội dung chính và nhận diện metadata từ văn bản.
              </p>
            </section>
          )}

          {/* Khung hiển thị trực quan các tiến trình AI OCR đang chạy ngầm */}
          {runningJobs.length > 0 && (
            <section className="min-w-0 space-y-3 rounded-2xl border border-[#b8cce0] bg-[#f4f8fc] p-4 sm:p-5 shadow-2xs dark:border-blue-800/60 dark:bg-blue-950/20">
              <div className="flex flex-col gap-1 border-b border-[#d4e2f0] pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Loader2 size={17} className="motion-safe:animate-spin text-[#1d4f88] dark:text-blue-400" />
                  <h2 className="font-editorial text-lg font-semibold text-[#142747] dark:text-slate-100">
                    Tiến trình AI OCR &amp; LlamaParse đang chạy ngầm ({runningJobs.length})
                  </h2>
                </div>
                <p className="text-xs font-medium text-[#1d4f88] dark:text-blue-300">
                  Có thể chuyển trang tự do • Tự động thông báo khi hoàn tất
                </p>
              </div>

              <div className="space-y-2.5">
                {runningJobs.map((job) => (
                  <div
                    key={job.jobId}
                    className="rounded-xl border border-[#ccdded] bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={16} className="shrink-0 text-[#1d4f88] dark:text-blue-400" />
                        <p className="truncate text-sm font-bold text-[#142747] dark:text-slate-100">
                          {job.filename}
                        </p>
                        <span className="rounded-md bg-[#eef4fa] px-2 py-0.5 text-[11px] font-bold text-[#1d4f88] dark:bg-blue-950 dark:text-blue-300">
                          {job.autoIngest ? "Tự động lập chỉ mục" : "Quét xem trước"}
                        </span>
                      </div>
                      <span className="text-xs font-extrabold text-[#1d4f88] dark:text-blue-300">{job.percent}%</span>
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-[#56677c] dark:text-slate-400">
                      {formatOcrStageLabel(job)}
                    </p>
                    <Progress value={job.percent} className="mt-2 h-2 bg-[#dce8f4] dark:bg-slate-800" />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Danh sách tài liệu cần rà soát thủ công */}
          {reviewPendingItems.length > 0 && (
            <section className="min-w-0 space-y-3 rounded-2xl border border-amber-200 bg-white p-4 sm:p-6 shadow-2xs dark:border-amber-800/60 dark:bg-slate-900">
              <div className="flex flex-col gap-1 border-b border-amber-100 pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">
                    {reviewPendingItems.length}
                  </span>
                  <h2 className="font-editorial text-lg font-semibold text-[#142747] dark:text-slate-100">
                    Tài liệu cần rà soát &amp; hoàn thiện
                  </h2>
                </div>
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  Hỗ trợ chạy ngầm AI OCR hoặc kiểm tra thủ công trước khi lập chỉ mục
                </p>
              </div>

              <ul className="space-y-2.5 pt-1">
                {reviewPendingItems.map((item) => {
                  const linkedJob = runningJobs.find((job) => job.reviewFileId === item.id);
                  const hasReadyOcrText = Boolean(item.result?.raw_text_preview?.trim());
                  const isPdf = /\.pdf$/i.test(item.file.name);

                  return (
                    <li
                      key={item.id}
                      className="flex min-w-0 items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5 transition-colors hover:bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20"
                    >
                      <FileText size={18} className="mt-0.5 shrink-0 text-amber-800 dark:text-amber-300" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="break-words text-sm font-bold text-[#142747] dark:text-slate-100">
                            {item.file.name}
                          </p>
                          {linkedJob ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-[#b8cce0] bg-[#eef4fa] px-2 py-0.5 text-[11px] font-bold text-[#1d4f88] dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                              <Loader2 size={11} className="motion-safe:animate-spin" />
                              Đang chạy ngầm ({linkedJob.percent}%)
                            </span>
                          ) : hasReadyOcrText ? (
                            <span className="inline-flex items-center rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              Đã có bản OCR • Sẵn sàng duyệt
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                              Cần rà soát
                            </span>
                          )}
                        </div>

                        {!hasReadyOcrText && item.result?.warnings && item.result.warnings.length > 0 && (
                          <p className="mt-1 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                            {item.result.warnings.join(" ")}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-[#627385] dark:text-slate-400">
                          Kích thước: {(item.file.size / 1024).toFixed(1)} KB
                          {hasReadyOcrText && item.result?.raw_text_preview
                            ? ` • Đã nhận diện ${item.result.raw_text_preview.trim().split(/\s+/).length.toLocaleString("vi-VN")} từ`
                            : ""}
                        </p>

                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          {isPdf && !linkedJob && (
                            <button
                              type="button"
                              disabled={busy || reviewBusy}
                              onClick={() => void dispatchAutoIngestInBackground(item)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1d4f88] px-3 py-1.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-[#153b66] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d4f88] disabled:opacity-50"
                            >
                              <Sparkles size={13} />
                              <span>Chạy ngầm bóc tách &amp; Tự động nạp</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy || reviewBusy}
                            onClick={() => openReview(item, false)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 shadow-2xs transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:opacity-50 dark:border-amber-700 dark:bg-slate-800 dark:text-amber-200"
                          >
                            <FileSearch size={13} />
                            <span>Rà soát &amp; Hoàn thiện</span>
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Bỏ tệp ${item.file.name}`}
                        disabled={busy || reviewBusy || Boolean(linkedJob)}
                        onClick={() => removeFile(item.id)}
                        title="Bỏ qua tệp này"
                        className="shrink-0 rounded-lg p-2 text-[#718294] transition-colors hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-[#1d4f88] disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <aside
          className="min-w-0 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6 xl:self-start dark:border-slate-800 dark:bg-slate-900"
          aria-live="polite"
        >
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a785d]">TIẾN TRÌNH XỬ LÝ</p>
          <h2 className="font-editorial mt-1 text-xl font-semibold text-[#142747] dark:text-slate-100">
            Tự động bóc tách
          </h2>
          <ol className="mt-5 space-y-4 text-sm text-[#56677c] dark:text-slate-400">
            <li>1. Tiếp nhận và kiểm tra lớp văn bản</li>
            <li>2. Bóc tách AI OCR / LlamaParse ngầm &amp; tách Điều/Khoản</li>
            <li>3. Lập chỉ mục ChromaDB và thông báo hoàn tất</li>
          </ol>
          {busy && (
            <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#1d4f88] dark:text-blue-300">
              <Loader2 size={17} className="motion-safe:animate-spin" />
              {progress ? `Đang tiếp nhận ${progress.current}/${progress.total} tệp...` : "Đang xử lý nguồn tri thức..."}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="mt-5 flex items-start gap-2 break-words rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
            >
              <AlertCircle size={17} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || currentUrlCompleted}
            className={`mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-center text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d4f88] ${
              currentUrlCompleted
                ? "cursor-not-allowed bg-[#e5f0f3] text-[#24556b]"
                : "bg-[#1d4f88] text-white hover:bg-[#153b66] disabled:opacity-50"
            }`}
          >
            {busy ? (
              <>
                <Loader2 size={17} className="motion-safe:animate-spin" />
                Đang xử lý...
              </>
            ) : currentUrlCompleted ? (
              <>
                <CheckCircle2 size={17} />
                {lastCompleted.status === "duplicate" ? "Dữ liệu đã có sẵn" : "Đã nạp vào kho tri thức"}
              </>
            ) : (
              <>
                {mode === "file"
                  ? "Bắt đầu nạp & Lập chỉ mục"
                  : mode === "text"
                    ? "Nạp vào nguồn tri thức"
                    : "Cào dữ liệu & Lập chỉ mục"}
                <ArrowRight size={17} className="shrink-0" />
              </>
            )}
          </button>
          {mode === "url" && currentUrlCompleted && (
            <button
              type="button"
              onClick={resetUrl}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#b8cad8] bg-white px-3 text-sm font-semibold text-[#1d4f88] hover:bg-[#eef4f9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d4f88]"
            >
              <RotateCcw size={16} />
              Nạp liên kết mới
            </button>
          )}
        </aside>
      </form>

      {/* Chỉ hiển thị những tài liệu đã thực sự xử lý xong (loại bỏ hoàn toàn bản nháp needs_review gây nhầm lẫn) */}
      {displayedResults.length > 0 && (mode !== "url" || !lastCompleted || currentUrlCompleted) && (
        <section aria-live="polite" className="space-y-4">
          <h2 className="font-editorial text-xl font-semibold text-[#142747] dark:text-slate-100">
            Tri thức đã nhận diện
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {displayedResults.map((result, index) => (
              <article
                key={`${result.doc_id}-${index}`}
                className="min-w-0 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {result.status === "duplicate" ? (
                    <Info size={18} className="text-sky-700 dark:text-sky-400" />
                  ) : (
                    <CheckCircle2
                      size={18}
                      className={result.status === "indexed" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700"}
                    />
                  )}
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      result.status === "indexed"
                        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                        : result.status === "duplicate"
                          ? "bg-sky-50 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300"
                          : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {result.status === "indexed"
                      ? "AI đã tự động bóc tách thành công"
                      : result.status === "duplicate"
                        ? "Dữ liệu đã có sẵn trong kho tri thức"
                        : "Vector đã ghi, metadata chưa đồng bộ"}
                  </span>
                </div>

                {result.status === "partial" && (
                  <div role="alert" className="mt-3 space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    <p>
                      Chưa hoàn tất đồng bộ hai kho. Mã công việc:{" "}
                      <span className="break-all font-mono">{result.job_id}</span>
                    </p>
                    <button
                      type="button"
                      disabled={Boolean(recoveryBusy)}
                      onClick={() => void recoverSync(result)}
                      className="rounded-lg border border-amber-400 px-3 py-2 font-semibold disabled:opacity-50"
                    >
                      {recoveryBusy === result.job_id ? "Đang phục hồi..." : "Phục hồi metadata"}
                    </button>
                  </div>
                )}

                <h3 className="mt-4 break-words font-editorial text-lg font-semibold text-[#142747] dark:text-slate-100">
                  {result.doc_title || "Chưa nhận diện tên văn bản"}
                </h3>

                {result.status === "duplicate" && (
                  <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm leading-6 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                    Tài liệu này đã được lập chỉ mục trước đó. Bạn có thể tra cứu ngay mà không cần nạp lại.
                  </p>
                )}

                <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[#718294] dark:text-slate-400">Số ký hiệu</dt>
                    <dd className="break-words font-semibold text-[#142747] dark:text-slate-100">
                      {result.doc_number?.startsWith("CHUA-XAC-DINH-")
                        ? "Chưa xác định"
                        : result.doc_number || "Chưa xác định"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#718294] dark:text-slate-400">Cơ quan ban hành</dt>
                    <dd className="break-words font-semibold text-[#142747] dark:text-slate-100">
                      {result.issuing_authority || "Chưa xác định"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#718294] dark:text-slate-400">Tình trạng hiệu lực</dt>
                    <dd className="font-semibold text-[#142747] dark:text-slate-100">
                      {statusLabels[result.effective_status] || "Chưa xác minh"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#718294] dark:text-slate-400">Ngày ban hành</dt>
                    <dd className="font-semibold text-[#142747] dark:text-slate-100">
                      {result.issued_date || "Chưa xác định"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#718294] dark:text-slate-400">
                      {result.article_count ? "Số Điều" : "Cấu trúc"}
                    </dt>
                    <dd className="font-semibold text-[#142747] dark:text-slate-100">
                      {result.article_count ? result.article_count : "Phân đoạn theo Phần/Mục"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#718294] dark:text-slate-400">Vector chunks</dt>
                    <dd className="font-semibold text-[#142747] dark:text-slate-100">
                      {result.status === "duplicate" && !result.chunk_count ? "Chưa thống kê" : result.chunk_count ?? 0}
                    </dd>
                  </div>
                </dl>

                {result.warnings &&
                  result.warnings.length > 0 &&
                  !(result.structure_status === "mixed_reference_document" && (result.coverage ?? 0) >= 0.95) && (
                    <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      {result.warnings.join(" ")}
                    </p>
                  )}

                {result.structure_status === "mixed_reference_document" && (result.coverage ?? 0) >= 0.95 && (
                  <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    Chuyên đề đã lập chỉ mục đầy đủ theo đoạn văn ({Math.round((result.coverage ?? 0) * 100)}% nội dung). Các số Điều trích dẫn không được xem là cấu trúc luật gốc.
                  </p>
                )}

                {(result.status === "indexed" || result.status === "duplicate") && (
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3">
                    <Link
                      to="/admin/chat"
                      className="inline-flex items-center gap-2 text-sm font-bold text-[#1d4f88] hover:underline focus-visible:outline-2 focus-visible:outline-[#1d4f88] dark:text-blue-300"
                    >
                      Thử hỏi Chatbot <ArrowRight size={16} />
                    </Link>
                    <Link
                      to="/admin/documents"
                      className="inline-flex items-center gap-2 text-sm font-bold text-[#1d4f88] hover:underline focus-visible:outline-2 focus-visible:outline-[#1d4f88] dark:text-blue-300"
                    >
                      Xem danh mục tài liệu <ArrowRight size={16} />
                    </Link>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Hộp thoại Rà soát & Hoàn thiện thiết kế 3 vùng Flex độc lập (Header cố định / Thân cuộn riêng / Footer đặc cố định) */}
      <Dialog
        open={Boolean(reviewItem && reviewMetadata)}
        onOpenChange={(open) => {
          if (!open && !reviewBusy) {
            setReviewId(null);
            setReviewMetadata(null);
          }
        }}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            reviewHeadingRef.current?.focus();
          }}
          className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl sm:max-w-3xl dark:border-slate-800 dark:bg-slate-900 motion-reduce:animate-none"
        >
          {reviewItem?.result && reviewMetadata && (
            <>
              {/* Vùng 1: Header cố định */}
              <DialogHeader className="shrink-0 border-b border-slate-200 bg-slate-50/90 px-5 py-4 text-left sm:px-6 dark:border-slate-800 dark:bg-slate-950/75">
                <div className="flex flex-wrap items-center gap-2 pr-7">
                  <DialogTitle
                    ref={reviewHeadingRef}
                    tabIndex={-1}
                    className="text-lg font-bold text-[#142747] outline-none dark:text-slate-100"
                  >
                    Rà soát &amp; Hoàn thiện văn bản
                  </DialogTitle>
                  <span className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-[#516278] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {reviewItem.file.name} • {(reviewItem.file.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <DialogDescription className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                  Quét AI OCR để xem trước nội dung hoặc chuyển sang chạy ngầm tự động lập chỉ mục để không phải chờ đợi trên màn hình này.
                </DialogDescription>
              </DialogHeader>

              {/* Vùng 2: Thân nội dung cuộn độc lập — không bao giờ tràn xuống dưới thanh nút Footer */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-5">
                {/* Thanh công cụ & Tiến trình AI OCR trực tiếp */}
                {/\.pdf$/i.test(reviewItem.file.name) && (
                  <div className="rounded-xl border border-[#c8daec] bg-[#f4f8fc] p-3.5 dark:border-blue-900/60 dark:bg-blue-950/25">
                    {activeModalJob ? (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-[#1d4f88] dark:text-blue-300">
                            <Loader2 size={15} className="motion-safe:animate-spin shrink-0" />
                            <span>{formatOcrStageLabel(activeModalJob)}</span>
                          </div>
                          <span className="rounded-md bg-white px-2 py-0.5 text-xs font-extrabold text-[#142747] shadow-2xs dark:bg-slate-900 dark:text-blue-200">
                            {activeModalJob.percent}%
                          </span>
                        </div>
                        <Progress value={activeModalJob.percent} className="h-2 bg-[#d7e5f3] dark:bg-slate-800" />
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                          <p className="text-xs text-[#56677c] dark:text-slate-400">
                            Bạn có thể đóng cửa sổ này ngay lúc này — tiến trình vẫn tiếp tục chạy ngầm và báo khi xong.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setReviewId(null);
                              setReviewMetadata(null);
                            }}
                            className="rounded-lg border border-[#1d4f88] bg-white px-3 py-1 text-xs font-bold text-[#1d4f88] transition-colors hover:bg-[#e7f0f9] dark:border-blue-400 dark:bg-slate-900 dark:text-blue-300"
                          >
                            Thu gọn &amp; Chạy ngầm
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs sm:text-sm font-bold text-[#142747] dark:text-slate-100">
                            Công cụ số hóa PDF Scan bằng AI OCR
                          </p>
                          <p className="mt-0.5 text-xs text-[#56677c] dark:text-slate-400">
                            {reviewMetadata.raw_text.trim()
                              ? "Đã có văn bản trích xuất. Bạn có thể quét lại hoặc chỉnh sửa trực tiếp bên dưới."
                              : "Tệp chưa có lớp văn bản. Chọn chạy ngầm tự động nạp hoặc quét để rà soát tại chỗ."}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={reviewBusy}
                            onClick={() => void runPreviewAiOcrInModal()}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1d4f88] bg-white px-3 py-1.5 text-xs font-bold text-[#1d4f88] transition-colors hover:bg-[#eaf2fa] disabled:opacity-50 dark:border-blue-400 dark:bg-slate-900 dark:text-blue-300"
                          >
                            <FileText size={14} />
                            <span>{reviewMetadata.raw_text.trim() ? "Quét lại AI OCR" : "Quét AI OCR tại đây"}</span>
                          </button>
                          <button
                            type="button"
                            disabled={reviewBusy}
                            onClick={() => void dispatchAutoIngestInBackground(reviewItem, reviewMetadata)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1d4f88] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#153b66] disabled:opacity-50"
                          >
                            <Sparkles size={14} />
                            <span>Chạy ngầm &amp; Tự động nạp</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!reviewMetadata.raw_text.trim() && reviewItem.result.warnings?.length ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs sm:text-sm leading-relaxed text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
                    {reviewItem.result.warnings.join(" ")}
                  </p>
                ) : null}

                <form id="review-ingest-form" onSubmit={forceIngest} className="space-y-4">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="review-raw-text" className="text-sm font-bold text-[#142747] dark:text-slate-100">
                        Nội dung văn bản để lập chỉ mục
                      </label>
                      <span
                        className={`text-xs font-semibold ${
                          reviewMetadata.raw_text.trim()
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {reviewMetadata.raw_text.trim()
                          ? `Sẵn sàng lập chỉ mục: ${reviewMetadata.raw_text.trim().split(/\s+/).length.toLocaleString("vi-VN")} từ`
                          : "Chưa có nội dung đọc được"}
                      </span>
                    </div>
                    <textarea
                      id="review-raw-text"
                      rows={8}
                      value={reviewMetadata.raw_text}
                      onChange={(event) => setReviewMetadata({ ...reviewMetadata, raw_text: event.target.value })}
                      placeholder="Bấm 'Quét AI OCR tại đây', 'Chạy ngầm & Tự động nạp' đối với tệp PDF scan, hoặc dán toàn văn nội dung văn bản vào đây..."
                      className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-slate-50/80 p-3.5 font-sans text-xs leading-5 text-slate-800 outline-none transition-colors focus:border-[#1d4f88] focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800"
                    />
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <label className="space-y-1.5 text-sm font-semibold text-[#142747] sm:col-span-2 dark:text-slate-200">
                      <span>Tên văn bản</span>
                      <input
                        required
                        maxLength={300}
                        value={reviewMetadata.doc_title}
                        onChange={(event) => setReviewMetadata({ ...reviewMetadata, doc_title: event.target.value })}
                        placeholder="Ví dụ: Nghị định quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông..."
                        className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-[#142747] outline-none focus:border-[#1d4f88] focus:ring-2 focus:ring-[#1d4f88]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </label>

                    <label className="space-y-1.5 text-sm font-semibold text-[#142747] dark:text-slate-200">
                      <span>Số hiệu</span>
                      <input
                        required
                        maxLength={100}
                        value={reviewMetadata.doc_number}
                        onChange={(event) => setReviewMetadata({ ...reviewMetadata, doc_number: event.target.value })}
                        placeholder="Ví dụ: QC-2024/01 hoặc VB-01/QĐ"
                        className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-[#142747] outline-none focus:border-[#1d4f88] focus:ring-2 focus:ring-[#1d4f88]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </label>

                    <label className="space-y-1.5 text-sm font-semibold text-[#142747] dark:text-slate-200">
                      <span>Loại văn bản</span>
                      <select
                        value={reviewMetadata.document_type}
                        onChange={(event) =>
                          setReviewMetadata({
                            ...reviewMetadata,
                            document_type: normalizeDocumentType(event.target.value),
                          })
                        }
                        className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-[#142747] outline-none focus:border-[#1d4f88] focus:ring-2 focus:ring-[#1d4f88]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="law">Luật</option>
                        <option value="decree">Nghị định</option>
                        <option value="circular">Thông tư</option>
                        <option value="resolution">Nghị quyết</option>
                      </select>
                    </label>

                    <label className="space-y-1.5 text-sm font-semibold text-[#142747] dark:text-slate-200">
                      <span>Cơ quan ban hành</span>
                      <input
                        required
                        maxLength={200}
                        value={reviewMetadata.issuing_authority}
                        onChange={(event) =>
                          setReviewMetadata({ ...reviewMetadata, issuing_authority: event.target.value })
                        }
                        placeholder="Ví dụ: Chính phủ, Quốc hội..."
                        className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-[#142747] outline-none focus:border-[#1d4f88] focus:ring-2 focus:ring-[#1d4f88]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </label>

                    <label className="space-y-1.5 text-sm font-semibold text-[#142747] dark:text-slate-200">
                      <span>Ngày ban hành</span>
                      <input
                        required
                        type="date"
                        value={reviewMetadata.issued_date}
                        onChange={(event) => setReviewMetadata({ ...reviewMetadata, issued_date: event.target.value })}
                        className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-[#142747] outline-none focus:border-[#1d4f88] focus:ring-2 focus:ring-[#1d4f88]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </label>

                    <label className="space-y-1.5 text-sm font-semibold text-[#142747] dark:text-slate-200">
                      <span>Tình trạng hiệu lực</span>
                      <select
                        value={reviewMetadata.effective_status}
                        onChange={(event) =>
                          setReviewMetadata({ ...reviewMetadata, effective_status: event.target.value })
                        }
                        className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-[#142747] outline-none focus:border-[#1d4f88] focus:ring-2 focus:ring-[#1d4f88]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="unknown">Chưa xác minh</option>
                        <option value="active">Còn hiệu lực</option>
                        <option value="partially_expired">Hết hiệu lực một phần</option>
                        <option value="expired">Hết hiệu lực</option>
                      </select>
                    </label>

                    <label className="space-y-1.5 text-sm font-semibold text-[#142747] dark:text-slate-200">
                      <span>Phạm vi truy cập</span>
                      <select
                        value={reviewMetadata.scope}
                        onChange={(event) =>
                          setReviewMetadata({
                            ...reviewMetadata,
                            scope: event.target.value as "public" | "internal",
                          })
                        }
                        className="block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-[#142747] outline-none focus:border-[#1d4f88] focus:ring-2 focus:ring-[#1d4f88]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="public">Công khai — Cho phép Chatbot tra cứu</option>
                        <option value="internal">Nội bộ — Chỉ lưu trữ quản trị</option>
                      </select>
                    </label>
                  </div>

                  {reviewError && (
                    <p
                      role="alert"
                      className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800/70 dark:bg-rose-950/50 dark:text-rose-200"
                    >
                      {reviewError}
                    </p>
                  )}
                </form>
              </div>

              {/* Vùng 3: Footer đặc cố định tách ngoài hoàn toàn vùng cuộn — triệt tiêu 100% lỗi xuyên thấu ô nhập */}
              <DialogFooter className="shrink-0 flex flex-col-reverse gap-2.5 border-t border-slate-200 bg-slate-50 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-800 dark:bg-slate-950">
                <button
                  type="button"
                  disabled={reviewBusy || Boolean(activeModalJob)}
                  onClick={discardReview}
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs sm:text-sm font-semibold text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <Trash2 size={14} />
                  <span>Bỏ qua tệp này</span>
                </button>

                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                  <button
                    type="button"
                    disabled={reviewBusy}
                    onClick={() => {
                      setReviewId(null);
                      setReviewMetadata(null);
                    }}
                    className="min-h-10 flex-1 rounded-lg border border-slate-300 bg-white px-4 text-xs sm:flex-none sm:text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {activeModalJob ? "Đóng cửa sổ" : "Để sau"}
                  </button>
                  <button
                    type="submit"
                    form="review-ingest-form"
                    disabled={reviewBusy || Boolean(activeModalJob) || !reviewMetadata.raw_text.trim()}
                    className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-[#1d4f88] px-4 text-xs sm:flex-none sm:text-sm font-bold text-white transition-colors hover:bg-[#153b66] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reviewBusy && <Loader2 size={15} className="motion-safe:animate-spin" />}
                    <span>Lập chỉ mục văn bản</span>
                  </button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
