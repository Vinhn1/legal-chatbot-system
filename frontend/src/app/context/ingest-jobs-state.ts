import { createContext, useContext } from "react";
import type { Result } from "../pages/admin/AdminIngestPage";

export type OcrJobStage = "uploading" | "queued" | "ocr" | "metadata" | "indexing" | "done" | "error";
export type OcrJobStatus = "queued" | "running" | "completed" | "needs_review" | "failed";

export interface OcrExtractedMetadata {
  doc_title?: string;
  doc_number?: string;
  document_type?: string;
  issuing_authority?: string;
  issued_date?: string;
  issued_date_fallback?: boolean;
  effective_date?: string | null;
  effective_status?: string;
  extracted_by?: string;
}

export interface BackgroundOcrJob {
  jobId: string;
  reviewFileId?: string;
  filename: string;
  autoIngest: boolean;
  status: OcrJobStatus;
  stage: OcrJobStage;
  processedPages: number;
  totalPages: number;
  percent: number;
  extractedText?: string;
  extractedMetadata?: OcrExtractedMetadata;
  ingestResult?: Result;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdminNotificationItem {
  id: string;
  kind: "success" | "duplicate" | "review" | "warning" | "error";
  title: string;
  description: string;
  docTitle?: string;
  docNumber?: string;
  metaSummary?: string;
  reviewFileId?: string;
  read: boolean;
  createdAt: number;
}

export interface StartBackgroundOcrOptions {
  autoIngest?: boolean;
  reviewFileId?: string;
  metadata?: Record<string, unknown>;
  sourceUrl?: string;
  scope?: "public" | "internal";
  silentStartToast?: boolean;
}

export interface IngestJobsContextValue {
  jobs: BackgroundOcrJob[];
  runningJobs: BackgroundOcrJob[];
  completedResults: Result[];
  notifications: AdminNotificationItem[];
  unreadCount: number;
  storageRevision: number;
  startBackgroundOcrJob: (file: File, options?: StartBackgroundOcrOptions) => Promise<string>;
  notifySyncIngestResult: (result: Result) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  dismissFinishedJob: (jobId: string) => void;
}

export const IngestJobsContext = createContext<IngestJobsContextValue | null>(null);

/** Truy xuất trạng thái tiến trình AI OCR chạy ngầm và trung tâm thông báo quản trị. */
export function useIngestJobs(): IngestJobsContextValue {
  const ctx = useContext(IngestJobsContext);
  if (!ctx) {
    throw new Error("useIngestJobs phải được gọi bên trong IngestJobsProvider.");
  }
  return ctx;
}

/** Chuyển giai đoạn xử lý kỹ thuật sang thông điệp tiếng Việt dễ hiểu trên giao diện. */
export function formatOcrStageLabel(job: Pick<BackgroundOcrJob, "stage" | "processedPages" | "totalPages" | "autoIngest">): string {
  switch (job.stage) {
    case "uploading":
      return "Đang tải tệp lên máy chủ AI...";
    case "queued":
      return "Đang khởi tạo luồng AI OCR & LlamaParse...";
    case "ocr":
      return job.totalPages > 1
        ? `Đang quét AI OCR • Trang ${Math.min(job.processedPages, job.totalPages)}/${job.totalPages}`
        : "Đang phân tích cấu trúc & bóc tách dấu đỏ qua LlamaParse Cloud...";
    case "metadata":
      return "Đang trích xuất Số hiệu, Cơ quan & Điều/Khoản...";
    case "indexing":
      return "Đang lập chỉ mục vector ChromaDB & đồng bộ danh mục...";
    case "done":
      return job.autoIngest ? "Đã hoàn tất nạp và lập chỉ mục tài liệu" : "Đã nhận diện xong văn bản";
    case "error":
      return "Xử lý gặp sự cố";
  }
}
