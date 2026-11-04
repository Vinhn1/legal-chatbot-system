import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import axios from "axios";
import { API_BASE } from "../../config";
import type { FileItem, Result } from "../pages/admin/AdminIngestPage";
import {
  getInMemoryFiles,
  removePendingReviewFromDb,
  savePendingReviewToDb,
  setInMemoryFiles,
} from "../services/ingestStorage";
import {
  dismissVeritasToast,
  requestBrowserNotificationPermissionIfNeeded,
  showVeritasToast,
  triggerBrowserSystemNotification,
} from "../services/veritasToast";
import { generateUUID } from "../utils/uuid";
import {
  IngestJobsContext,
  type AdminNotificationItem,
  type BackgroundOcrJob,
  type OcrExtractedMetadata,
  type OcrJobStage,
  type OcrJobStatus,
  type StartBackgroundOcrOptions,
} from "./ingest-jobs-state";

const ACTIVE_JOBS_STORAGE_KEY = "veritas_bg_ocr_jobs_v1";
const NOTIFICATIONS_STORAGE_KEY = "veritas_admin_notifications_v1";
const MAX_NOTIFICATIONS = 30;

interface ApiOcrJobResponse {
  job_id: string;
  filename: string;
  status: OcrJobStatus;
  stage: OcrJobStage;
  auto_ingest: boolean;
  processed_pages: number;
  total_pages: number;
  percent: number;
  text?: string | null;
  metadata?: OcrExtractedMetadata | null;
  ingest_result?: Result | null;
  error?: string | null;
}

/** Đọc danh sách tác vụ chạy ngầm chưa kết thúc từ localStorage khi tải lại trình duyệt. */
function loadPersistedJobs(): BackgroundOcrJob[] {
  try {
    const raw = localStorage.getItem(ACTIVE_JOBS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is BackgroundOcrJob =>
        Boolean(row && typeof row.jobId === "string" && (row.status === "queued" || row.status === "running")),
    );
  } catch {
    return [];
  }
}

/** Đọc lịch sử thông báo quản trị gần đây từ localStorage. */
function loadPersistedNotifications(): AdminNotificationItem[] {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_NOTIFICATIONS) : [];
  } catch {
    return [];
  }
}

/** Rút trích thông báo lỗi an toàn từ phản hồi API. */
function safeApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.message ?? err.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Tạo chuỗi tóm tắt Số Điều và Vector chunks cho thẻ thông báo hoàn tất. */
function buildMetaSummary(result: Pick<Result, "article_count" | "chunk_count">): string {
  const parts: string[] = [];
  if (result.article_count && result.article_count > 0) {
    parts.push(`${result.article_count} Điều`);
  } else {
    parts.push("Phân đoạn theo Phần/Mục");
  }
  if (typeof result.chunk_count === "number" && result.chunk_count > 0) {
    parts.push(`${result.chunk_count} chunks`);
  }
  return parts.join(" • ");
}

/** Chuẩn hóa số hiệu hiển thị để không in mã tạm thời lên thông báo. */
function cleanReadableDocNumber(docNumber?: string): string | undefined {
  if (!docNumber) return undefined;
  if (docNumber.startsWith("CHUA-XAC-DINH-") || docNumber.startsWith("TL-")) return undefined;
  return docNumber;
}

/** Cập nhật nội dung OCR và metadata nhận diện được vào tệp đang chờ rà soát trong bộ nhớ & IndexedDB. */
function applyOcrOutputToStoredReviewFile(
  reviewFileId: string | undefined,
  extractedText: string,
  suggested: OcrExtractedMetadata | undefined,
  fallbackResult?: Result,
): void {
  if (!reviewFileId) return;
  const current = getInMemoryFiles();
  const target = current.find((item) => item.id === reviewFileId);
  if (!target) return;

  const baseResult: Result = target.result ||
    fallbackResult || {
      status: "needs_review",
      doc_id: generateUUID(),
      doc_title: target.file.name.replace(/\.[^.]+$/, ""),
      doc_number: "",
      issuing_authority: "",
      issued_date: "",
      effective_status: "unknown",
      article_count: 0,
      chunk_count: 0,
    };

  const cleanDocNumber = cleanReadableDocNumber(suggested?.doc_number);
  const cleanAuthority =
    suggested?.issuing_authority && suggested.issuing_authority !== "Chưa xác định"
      ? suggested.issuing_authority
      : "";
  const cleanDocType =
    suggested?.document_type === "law" ||
    suggested?.document_type === "decree" ||
    suggested?.document_type === "circular" ||
    suggested?.document_type === "resolution"
      ? suggested.document_type
      : undefined;
  const cleanIssuedDate =
    suggested?.issued_date && !suggested.issued_date_fallback && suggested.extracted_by !== "fallback"
      ? suggested.issued_date
      : "";

  const updatedResult: Result = {
    ...baseResult,
    status: "needs_review",
    raw_text_preview: extractedText || baseResult.raw_text_preview,
    doc_title: suggested?.doc_title || baseResult.doc_title,
    doc_number: cleanDocNumber || baseResult.doc_number,
    document_type: cleanDocType || baseResult.document_type,
    issuing_authority: cleanAuthority || baseResult.issuing_authority,
    issued_date: cleanIssuedDate || baseResult.issued_date || suggested?.issued_date || "",
    effective_date:
      typeof suggested?.effective_date === "string" && suggested.effective_date.trim()
        ? suggested.effective_date.trim()
        : baseResult.effective_date ?? null,
    effective_status:
      suggested?.effective_status && suggested.effective_status !== "unknown"
        ? suggested.effective_status
        : baseResult.effective_status,
  };

  const updatedItem: FileItem = {
    ...target,
    state: "done",
    result: updatedResult,
    error: undefined,
  };
  setInMemoryFiles(current.map((item) => (item.id === reviewFileId ? updatedItem : item)));
  void savePendingReviewToDb(updatedItem);
}

/** Xóa tệp chờ rà soát khỏi RAM và IndexedDB ngay khi tiến trình chạy ngầm lập chỉ mục thành công. */
function removeIndexedFileFromQueue(reviewFileId: string | undefined): void {
  if (!reviewFileId) return;
  const current = getInMemoryFiles();
  if (current.some((item) => item.id === reviewFileId)) {
    setInMemoryFiles(current.filter((item) => item.id !== reviewFileId));
  }
  void removePendingReviewFromDb(reviewFileId);
}

/**
 * Nhà cung cấp tiến trình AI OCR chạy ngầm và trung tâm thông báo toàn cục cho khung quản trị.
 * Duy trì theo dõi tiến độ xuyên suốt mọi màn hình quản trị mà không khóa giao diện người dùng.
 */
export function IngestJobsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<BackgroundOcrJob[]>(() => loadPersistedJobs());
  const [completedResults, setCompletedResults] = useState<Result[]>([]);
  const [notifications, setNotifications] = useState<AdminNotificationItem[]>(() => loadPersistedNotifications());
  const [storageRevision, setStorageRevision] = useState(0);
  const handledTerminalJobsRef = useRef<Set<string>>(new Set());

  // Lưu các tác vụ còn đang chạy để phục hồi theo dõi khi người dùng tải lại trang
  useEffect(() => {
    const activeOnly = jobs
      .filter((job) => job.status === "queued" || job.status === "running")
      .filter((job) => !job.jobId.startsWith("uploading-"));
    try {
      localStorage.setItem(ACTIVE_JOBS_STORAGE_KEY, JSON.stringify(activeOnly));
    } catch {
      // Bỏ qua nếu bộ nhớ trình duyệt đầy
    }
  }, [jobs]);

  // Đồng bộ lịch sử thông báo gần đây vào localStorage
  useEffect(() => {
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
    } catch {
      // Bỏ qua nếu chế độ riêng tư chặn ghi localStorage
    }
  }, [notifications]);

  const appendNotification = useCallback((entry: Omit<AdminNotificationItem, "id" | "read" | "createdAt">) => {
    const created: AdminNotificationItem = {
      ...entry,
      id: generateUUID(),
      read: false,
      createdAt: Date.now(),
    };
    setNotifications((prev) => [created, ...prev].slice(0, MAX_NOTIFICATIONS));
  }, []);

  const notifySyncIngestResult = useCallback(
    (result: Result) => {
      const readableNo = cleanReadableDocNumber(result.doc_number);
      const summary = buildMetaSummary(result);

      if (result.status === "indexed") {
        appendNotification({
          kind: "success",
          title: "Nạp tri thức pháp luật thành công",
          description: "Văn bản đã được bóc tách cấu trúc và lập chỉ mục sẵn sàng tra cứu.",
          docTitle: result.doc_title || "Văn bản pháp luật mới",
          docNumber: readableNo,
          metaSummary: summary,
        });
        showVeritasToast({
          variant: "success",
          title: "Nạp tri thức hoàn tất",
          description: "Tài liệu đã được đồng bộ vào kho vector ChromaDB và danh mục quản trị.",
          docTitle: result.doc_title || "Văn bản pháp luật mới",
          docNumber: readableNo,
          metaSummary: summary,
          durationMs: 9500,
          actions: [
            {
              label: "Xem tài liệu",
              icon: "documents",
              primary: true,
              onClick: () => navigate("/admin/documents"),
            },
            {
              label: "Thử hỏi Chatbot",
              icon: "chat",
              onClick: () => navigate("/admin/chat"),
            },
          ],
        });
      } else if (result.status === "duplicate") {
        appendNotification({
          kind: "duplicate",
          title: "Tài liệu đã tồn tại trong kho tri thức",
          description: "Hệ thống nhận diện trùng mã băm nội dung và giữ nguyên bản ghi hiện có.",
          docTitle: result.doc_title || "Văn bản pháp luật",
          docNumber: readableNo,
        });
        showVeritasToast({
          variant: "duplicate",
          title: "Tài liệu đã có sẵn trong kho",
          description: "Không cần lập chỉ mục lại. Bạn có thể tra cứu văn bản này ngay.",
          docTitle: result.doc_title || "Văn bản pháp luật",
          docNumber: readableNo,
          durationMs: 7000,
          actions: [
            {
              label: "Thử hỏi Chatbot",
              icon: "chat",
              primary: true,
              onClick: () => navigate("/admin/chat"),
            },
          ],
        });
      } else if (result.status === "partial") {
        appendNotification({
          kind: "warning",
          title: "Vector đã ghi, metadata chờ đồng bộ",
          description: "Hãy bấm nút Phục hồi metadata tại kết quả nạp để hoàn tất đồng bộ.",
          docTitle: result.doc_title,
          docNumber: readableNo,
        });
        showVeritasToast({
          variant: "warning",
          title: "Metadata chưa đồng bộ hoàn tất",
          description: "Dữ liệu vector đã lưu. Vui lòng dùng nút Phục hồi metadata trên trang Nạp tài liệu.",
          docTitle: result.doc_title,
          durationMs: 9000,
        });
      }
    },
    [appendNotification, navigate],
  );

  const handleTerminalJobTransition = useCallback(
    (prevJob: BackgroundOcrJob, snap: ApiOcrJobResponse) => {
      if (handledTerminalJobsRef.current.has(snap.job_id)) return;
      handledTerminalJobsRef.current.add(snap.job_id);
      dismissVeritasToast(`bg-start-${snap.job_id}`);

      const ingestRes = snap.ingest_result ?? undefined;
      const extractedText = snap.text?.trim() || "";
      const suggestedMeta = snap.metadata ?? undefined;

      if (snap.status === "completed" && ingestRes && (ingestRes.status === "indexed" || ingestRes.status === "duplicate" || ingestRes.status === "partial")) {
        removeIndexedFileFromQueue(prevJob.reviewFileId);
        setCompletedResults((prev) => [ingestRes, ...prev.filter((r) => r.doc_id !== ingestRes.doc_id)].slice(0, 12));
        setStorageRevision((rev) => rev + 1);
        notifySyncIngestResult(ingestRes);
        triggerBrowserSystemNotification(
          "Veritas Legal — Nạp tài liệu chạy ngầm hoàn tất",
          ingestRes.doc_title || snap.filename,
        );
        return;
      }

      if (snap.status === "completed" || snap.status === "needs_review") {
        applyOcrOutputToStoredReviewFile(prevJob.reviewFileId, extractedText, suggestedMeta, ingestRes);
        setStorageRevision((rev) => rev + 1);
        const docTitle = suggestedMeta?.doc_title || ingestRes?.doc_title || snap.filename;
        const readableNo = cleanReadableDocNumber(suggestedMeta?.doc_number || ingestRes?.doc_number);
        const wordCount = extractedText ? extractedText.split(/\s+/).length : 0;

        appendNotification({
          kind: "review",
          title: "AI OCR đã nhận diện xong văn bản",
          description: wordCount > 0
            ? `Đã trích xuất ${wordCount.toLocaleString("vi-VN")} từ từ ${snap.filename}. Bấm để kiểm tra và lập chỉ mục.`
            : `Đã hoàn tất quét ${snap.filename}. Vui lòng kiểm tra trước khi lập chỉ mục.`,
          docTitle,
          docNumber: readableNo,
          reviewFileId: prevJob.reviewFileId,
        });

        showVeritasToast({
          variant: "review",
          title: "Đã nhận diện xong bằng AI OCR",
          description: wordCount > 0
            ? `Trích xuất thành công ${wordCount.toLocaleString("vi-VN")} từ. Vui lòng xác nhận metadata để lập chỉ mục.`
            : "Vui lòng kiểm tra nội dung và xác nhận metadata để lập chỉ mục.",
          docTitle,
          docNumber: readableNo,
          durationMs: 10000,
          actions: [
            {
              label: "Mở form rà soát",
              icon: "review",
              primary: true,
              onClick: () =>
                navigate(
                  prevJob.reviewFileId
                    ? `/admin/ingest?review=${encodeURIComponent(prevJob.reviewFileId)}`
                    : "/admin/ingest",
                ),
            },
          ],
        });
        triggerBrowserSystemNotification(
          "Veritas Legal — AI OCR hoàn tất",
          `Đã nhận diện xong tệp ${snap.filename}. Sẵn sàng xác nhận lập chỉ mục.`,
        );
        return;
      }

      if (snap.status === "failed") {
        const errMsg = snap.error || "Không thể nhận diện văn bản từ tệp PDF scan này.";
        appendNotification({
          kind: "error",
          title: `Quét AI OCR thất bại: ${snap.filename}`,
          description: errMsg,
          reviewFileId: prevJob.reviewFileId,
        });
        showVeritasToast({
          variant: "error",
          title: "Tác vụ AI OCR chạy ngầm gặp lỗi",
          description: errMsg,
          docTitle: snap.filename,
          durationMs: 10000,
          actions: prevJob.reviewFileId
            ? [
                {
                  label: "Kiểm tra tệp",
                  icon: "review",
                  onClick: () =>
                    navigate(`/admin/ingest?review=${encodeURIComponent(prevJob.reviewFileId || "")}`),
                },
              ]
            : undefined,
        });
      }
    },
    [appendNotification, navigate, notifySyncIngestResult],
  );

  const startBackgroundOcrJob = useCallback(
    async (file: File, options?: StartBackgroundOcrOptions): Promise<string> => {
      const autoIngest = options?.autoIngest ?? true;
      const tempId = `uploading-${generateUUID()}`;
      const now = Date.now();

      requestBrowserNotificationPermissionIfNeeded();

      const placeholder: BackgroundOcrJob = {
        jobId: tempId,
        reviewFileId: options?.reviewFileId,
        filename: file.name,
        autoIngest,
        status: "running",
        stage: "uploading",
        processedPages: 0,
        totalPages: 0,
        percent: 2,
        createdAt: now,
        updatedAt: now,
      };
      setJobs((prev) => [placeholder, ...prev.filter((j) => j.reviewFileId !== options?.reviewFileId || !options?.reviewFileId)]);

      const form = new FormData();
      form.append("file", file);
      form.append("auto_ingest", autoIngest ? "true" : "false");
      if (options?.metadata) {
        form.append("metadata", JSON.stringify(options.metadata));
      }
      if (options?.sourceUrl) {
        form.append("sourceUrl", options.sourceUrl);
      }
      form.append("scope", options?.scope === "internal" ? "internal" : "public");

      try {
        const res = await axios.post<ApiOcrJobResponse>(`${API_BASE}/legal/ocr-jobs`, form, {
          timeout: 90000,
        });
        const data = res.data;
        const createdJob: BackgroundOcrJob = {
          jobId: data.job_id,
          reviewFileId: options?.reviewFileId,
          filename: data.filename || file.name,
          autoIngest: Boolean(data.auto_ingest),
          status: data.status || "running",
          stage: data.stage || "ocr",
          processedPages: data.processed_pages ?? 0,
          totalPages: data.total_pages ?? 1,
          percent: Math.max(4, data.percent ?? 4),
          createdAt: now,
          updatedAt: Date.now(),
        };

        setJobs((prev) => prev.map((row) => (row.jobId === tempId ? createdJob : row)));

        if (!options?.silentStartToast) {
          showVeritasToast({
            id: `bg-start-${data.job_id}`,
            variant: "background",
            title: autoIngest ? "Đã chuyển sang quét & nạp chạy ngầm" : "Đang quét AI OCR trong nền",
            description: autoIngest
              ? "Bạn có thể đóng hộp thoại hoặc chuyển sang trang khác. Hệ thống sẽ tự lập chỉ mục và thông báo ngay khi hoàn tất."
              : "Hệ thống đang nhận diện toàn bộ các trang scan và sẽ thông báo ngay khi sẵn sàng rà soát.",
            docTitle: data.filename || file.name,
            metaSummary: data.total_pages && data.total_pages > 1 ? `${data.total_pages} trang PDF` : "AI OCR / LlamaParse",
            durationMs: 5500,
          });
        }
        return data.job_id;
      } catch (err) {
        const msg = safeApiErrorMessage(err, "Không thể khởi tạo tiến trình AI OCR chạy ngầm.");
        setJobs((prev) =>
          prev.map((row) =>
            row.jobId === tempId
              ? { ...row, status: "failed", stage: "error", error: msg, updatedAt: Date.now() }
              : row,
          ),
        );
        showVeritasToast({
          variant: "error",
          title: "Không thể chạy ngầm AI OCR",
          description: msg,
          docTitle: file.name,
          durationMs: 8500,
        });
        throw err;
      }
    },
    [],
  );

  // Vòng lặp theo dõi tiến độ theo trang cho các tác vụ đang chạy ngầm
  const runningRealJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          (job.status === "queued" || job.status === "running") && !job.jobId.startsWith("uploading-"),
      ),
    [jobs],
  );

  useEffect(() => {
    if (runningRealJobs.length === 0) return;
    let cancelled = false;

    const pollOnce = async () => {
      for (const activeJob of runningRealJobs) {
        if (cancelled) return;
        try {
          const response = await axios.get<ApiOcrJobResponse>(
            `${API_BASE}/legal/ocr-jobs/${activeJob.jobId}`,
            { timeout: 45000 },
          );
          if (cancelled) return;
          const snap = response.data;
          const isTerminal = snap.status === "completed" || snap.status === "needs_review" || snap.status === "failed";

          setJobs((prev) =>
            prev.map((row) =>
              row.jobId === activeJob.jobId
                ? {
                    ...row,
                    status: snap.status,
                    stage: snap.stage,
                    processedPages: snap.processed_pages ?? row.processedPages,
                    totalPages: snap.total_pages ?? row.totalPages,
                    percent: snap.percent ?? row.percent,
                    extractedText: snap.text ?? row.extractedText,
                    extractedMetadata: snap.metadata ?? row.extractedMetadata,
                    ingestResult: snap.ingest_result ?? row.ingestResult,
                    error: snap.error ?? undefined,
                    updatedAt: Date.now(),
                  }
                : row,
            ),
          );

          if (isTerminal) {
            handleTerminalJobTransition(activeJob, snap);
          }
        } catch (pollErr) {
          if (axios.isAxiosError(pollErr) && pollErr.response?.status === 404) {
            setJobs((prev) => prev.filter((row) => row.jobId !== activeJob.jobId));
          }
        }
      }
    };

    const timer = window.setInterval(() => {
      void pollOnce();
    }, 1600);
    void pollOnce();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runningRealJobs, handleTerminalJobTransition]);

  const runningJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "running"),
    [jobs],
  );

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications],
  );

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, read: true } : item)));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((item) => (item.read ? item : { ...item, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const dismissFinishedJob = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((job) => job.jobId !== jobId));
  }, []);

  const contextValue = useMemo(
    () => ({
      jobs,
      runningJobs,
      completedResults,
      notifications,
      unreadCount,
      storageRevision,
      startBackgroundOcrJob,
      notifySyncIngestResult,
      markNotificationRead,
      markAllNotificationsRead,
      clearNotifications,
      dismissFinishedJob,
    }),
    [
      jobs,
      runningJobs,
      completedResults,
      notifications,
      unreadCount,
      storageRevision,
      startBackgroundOcrJob,
      notifySyncIngestResult,
      markNotificationRead,
      markAllNotificationsRead,
      clearNotifications,
      dismissFinishedJob,
    ],
  );

  return <IngestJobsContext.Provider value={contextValue}>{children}</IngestJobsContext.Provider>;
}
