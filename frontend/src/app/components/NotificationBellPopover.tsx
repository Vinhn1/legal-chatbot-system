import { useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCheck,
  CheckCircle2,
  FileSearch,
  Info,
  Loader2,
  Trash2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Progress } from "./ui/progress";
import { formatOcrStageLabel, useIngestJobs, type AdminNotificationItem } from "../context/ingest-jobs-state";

/** Định dạng mốc thời gian tương đối ngắn gọn bằng tiếng Việt. */
function formatRelativeViTime(timestampMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 45) return "Vừa xong";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} ngày trước`;
}

/**
 * Trung tâm thông báo và theo dõi tiến trình AI OCR chạy ngầm trên thanh Header quản trị.
 */
export function NotificationBellPopover() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const {
    runningJobs,
    notifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications,
  } = useIngestJobs();

  const leadJob = runningJobs[0];

  const renderItemIcon = (kind: AdminNotificationItem["kind"]) => {
    switch (kind) {
      case "success":
        return <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />;
      case "duplicate":
        return <Info size={16} className="text-sky-600 dark:text-sky-400" />;
      case "review":
      case "warning":
        return <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />;
      case "error":
        return <AlertCircle size={16} className="text-rose-600 dark:text-rose-400" />;
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
      }}
    >
      <div className="flex items-center gap-2">
        {leadJob && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            title={`Đang xử lý ngầm: ${leadJob.filename}`}
            className="hidden lg:inline-flex items-center gap-2 rounded-xl border border-[#b8cce0] bg-[#eef4fa] px-3 py-1.5 text-xs font-bold text-[#1d4f88] transition-colors hover:bg-[#dfeaf6] dark:border-blue-800/70 dark:bg-blue-950/60 dark:text-blue-300"
          >
            <Loader2 size={13} className="motion-safe:animate-spin shrink-0" />
            <span className="max-w-[165px] truncate">{leadJob.filename}</span>
            <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-extrabold text-[#142747] dark:bg-slate-900 dark:text-blue-200">
              {leadJob.percent}%
            </span>
            {runningJobs.length > 1 && (
              <span className="text-[11px] font-semibold">+{runningJobs.length - 1}</span>
            )}
          </button>
        )}

        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              unreadCount > 0
                ? `Trung tâm thông báo (${unreadCount} thông báo chưa đọc)`
                : "Trung tâm thông báo và tiến trình chạy ngầm"
            }
            title="Thông báo & Tiến trình chạy ngầm"
            className="relative rounded-xl border border-[#cbd5df] p-2 text-[#142747] transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <Bell size={17} />
            {runningJobs.length > 0 ? (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#1d4f88] px-1 text-[10px] font-extrabold text-white shadow-xs">
                {runningJobs.length}
              </span>
            ) : unreadCount > 0 ? (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-emerald-600 px-1 text-[10px] font-extrabold text-white shadow-xs">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(92vw,390px)] overflow-hidden rounded-2xl border border-[#cbd5df] bg-white p-0 text-[#142747] shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/70">
          <div>
            <h3 className="text-sm font-bold text-[#142747] dark:text-slate-100">Thông báo &amp; Tác vụ ngầm</h3>
            <p className="text-[11px] text-[#66778c] dark:text-slate-400">
              {runningJobs.length > 0
                ? `Đang xử lý ${runningJobs.length} tệp trong nền`
                : unreadCount > 0
                  ? `${unreadCount} thông báo mới chưa đọc`
                  : "Theo dõi kết quả nạp tài liệu thời gian thực"}
            </p>
          </div>

          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllNotificationsRead}
                title="Đánh dấu tất cả đã đọc"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-[#1d4f88] hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-slate-800"
              >
                <CheckCheck size={13} />
                <span>Đã đọc</span>
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={clearNotifications}
                title="Xóa lịch sử thông báo"
                aria-label="Xóa lịch sử thông báo"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-slate-800 dark:hover:text-rose-400"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        {runningJobs.length > 0 && (
          <div className="border-b border-slate-200 bg-[#f4f8fc] px-4 py-3 space-y-2.5 dark:border-slate-800 dark:bg-blue-950/25">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#1d4f88] dark:text-blue-300">
                Tiến trình đang chạy ngầm
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate("/admin/ingest");
                }}
                className="text-[11px] font-bold text-[#1d4f88] hover:underline dark:text-blue-300"
              >
                Mở trang nạp
              </button>
            </div>

            {runningJobs.map((job) => (
              <div
                key={job.jobId}
                className="rounded-xl border border-[#c9daea] bg-white p-2.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-bold text-[#142747] dark:text-slate-100">
                    {job.filename}
                  </span>
                  <span className="shrink-0 text-xs font-extrabold text-[#1d4f88] dark:text-blue-300">
                    {job.percent}%
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-[#56677c] dark:text-slate-400">
                  <Loader2 size={11} className="motion-safe:animate-spin shrink-0 text-[#1d4f88] dark:text-blue-400" />
                  <span className="truncate">{formatOcrStageLabel(job)}</span>
                </p>
                <Progress value={job.percent} className="mt-2 h-1.5 bg-[#dce8f4] dark:bg-slate-800" />
              </div>
            ))}
          </div>
        )}

        <div className="max-h-[330px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {notifications.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800">
                <Bell size={18} />
              </div>
              <p className="mt-2.5 text-xs font-bold text-[#142747] dark:text-slate-200">
                Chưa có thông báo nào
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[#718294] dark:text-slate-400">
                Khi tài liệu quét AI OCR hoặc lập chỉ mục chạy ngầm hoàn tất, kết quả sẽ được lưu tại đây.
              </p>
            </div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                onClick={() => markNotificationRead(item.id)}
                className={`px-4 py-3 transition-colors ${
                  item.read
                    ? "bg-white hover:bg-slate-50/80 dark:bg-slate-900 dark:hover:bg-slate-800/50"
                    : "bg-[#f5f9fe] hover:bg-[#edf4fc] dark:bg-blue-950/20 dark:hover:bg-blue-950/35"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0">{renderItemIcon(item.kind)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold leading-snug text-[#142747] dark:text-slate-100">
                        {item.title}
                      </p>
                      <span className="shrink-0 text-[10px] font-medium text-[#718294] dark:text-slate-400">
                        {formatRelativeViTime(item.createdAt)}
                      </span>
                    </div>

                    {item.docTitle && (
                      <p className="mt-1 line-clamp-2 text-xs font-semibold text-[#1d4f88] dark:text-blue-300">
                        {item.docTitle}
                      </p>
                    )}

                    {(item.docNumber || item.metaSummary) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#627385] dark:text-slate-400">
                        {item.docNumber && (
                          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-bold text-[#142747] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {item.docNumber}
                          </span>
                        )}
                        {item.metaSummary && <span>{item.metaSummary}</span>}
                      </div>
                    )}

                    <p className="mt-1 text-[11px] leading-relaxed text-[#56677c] dark:text-slate-300">
                      {item.description}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {(item.kind === "success" || item.kind === "duplicate") && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              markNotificationRead(item.id);
                              setOpen(false);
                              navigate("/admin/documents");
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1d4f88] hover:underline dark:text-blue-300"
                          >
                            <span>Xem tài liệu</span>
                            <ArrowRight size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              markNotificationRead(item.id);
                              setOpen(false);
                              navigate("/admin/chat");
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1d4f88] hover:underline dark:text-blue-300"
                          >
                            <span>Thử hỏi Chatbot</span>
                            <ArrowRight size={11} />
                          </button>
                        </>
                      )}
                      {item.kind === "review" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            markNotificationRead(item.id);
                            setOpen(false);
                            navigate(
                              item.reviewFileId
                                ? `/admin/ingest?review=${encodeURIComponent(item.reviewFileId)}`
                                : "/admin/ingest",
                            );
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 hover:underline dark:text-amber-300"
                        >
                          <FileSearch size={12} />
                          <span>Mở rà soát &amp; lập chỉ mục</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
