import { motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Files,
  FileSearch,
  Info,
  Loader2,
  MessageSquare,
  X,
} from "lucide-react";

export type VeritasToastVariant = "success" | "duplicate" | "background" | "review" | "warning" | "error";

export interface VeritasToastAction {
  label: string;
  icon?: "documents" | "chat" | "review";
  primary?: boolean;
  onClick: () => void;
}

export interface VeritasToastCardProps {
  variant: VeritasToastVariant;
  title: string;
  description?: string;
  docTitle?: string;
  docNumber?: string;
  metaSummary?: string;
  durationMs?: number;
  actions?: VeritasToastAction[];
  onClose: () => void;
}

/**
 * Thẻ thông báo nổi chuẩn thiết kế Veritas Legal hỗ trợ chế độ Sáng/Tối,
 * thanh đếm ngược thời gian hiển thị và các nút điều hướng nghiệp vụ trực tiếp.
 */
export function VeritasToastCard({
  variant,
  title,
  description,
  docTitle,
  docNumber,
  metaSummary,
  durationMs = 8000,
  actions,
  onClose,
}: VeritasToastCardProps) {
  const prefersReducedMotion = useReducedMotion();

  const palette = {
    success: {
      border: "border-emerald-200/90 dark:border-emerald-800/70",
      badgeBg: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300",
      bar: "bg-emerald-600 dark:bg-emerald-400",
      pill: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    },
    duplicate: {
      border: "border-sky-200/90 dark:border-sky-800/70",
      badgeBg: "bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300",
      bar: "bg-sky-600 dark:bg-sky-400",
      pill: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800",
    },
    background: {
      border: "border-[#b8cce0] dark:border-blue-800/70",
      badgeBg: "bg-[#eef4fa] text-[#1d4f88] dark:bg-blue-950/70 dark:text-blue-300",
      bar: "bg-[#1d4f88] dark:bg-blue-400",
      pill: "bg-[#eef4fa] text-[#1d4f88] border-[#c5d7e8] dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800",
    },
    review: {
      border: "border-amber-200/90 dark:border-amber-800/70",
      badgeBg: "bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300",
      bar: "bg-amber-500 dark:bg-amber-400",
      pill: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    },
    warning: {
      border: "border-amber-200/90 dark:border-amber-800/70",
      badgeBg: "bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300",
      bar: "bg-amber-500 dark:bg-amber-400",
      pill: "bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    },
    error: {
      border: "border-rose-200/90 dark:border-rose-800/70",
      badgeBg: "bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300",
      bar: "bg-rose-600 dark:bg-rose-400",
      pill: "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800",
    },
  }[variant];

  const renderLeadingIcon = () => {
    switch (variant) {
      case "success":
        return <CheckCircle2 size={18} />;
      case "duplicate":
        return <Info size={18} />;
      case "background":
        return <Loader2 size={18} className="motion-safe:animate-spin" />;
      case "review":
      case "warning":
        return <AlertTriangle size={18} />;
      case "error":
        return <AlertCircle size={18} />;
    }
  };

  const renderActionIcon = (icon?: VeritasToastAction["icon"]) => {
    if (icon === "documents") return <Files size={13} />;
    if (icon === "chat") return <MessageSquare size={13} />;
    if (icon === "review") return <FileSearch size={13} />;
    return null;
  };

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      role="status"
      className={`pointer-events-auto relative w-[min(92vw,390px)] overflow-hidden rounded-2xl border ${palette.border} bg-white/98 p-4 text-[#142747] shadow-xl backdrop-blur-md dark:bg-slate-900/98 dark:text-slate-100`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${palette.badgeBg}`}>
          {renderLeadingIcon()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold leading-snug text-[#142747] dark:text-slate-100">{title}</p>
              <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#718294] dark:text-slate-400">
                <Clock size={11} />
                Vừa xong
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng thông báo"
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X size={15} />
            </button>
          </div>

          {description && (
            <p className="mt-1.5 text-xs leading-relaxed text-[#516278] dark:text-slate-300">{description}</p>
          )}

          {(docTitle || docNumber || metaSummary) && (
            <div className="mt-2.5 rounded-xl border border-slate-200/80 bg-[#f8fafc] p-2.5 dark:border-slate-800 dark:bg-slate-800/70">
              {docTitle && (
                <p
                  title={docTitle}
                  className="line-clamp-2 text-xs font-bold leading-snug text-[#142747] dark:text-slate-100"
                >
                  {docTitle}
                </p>
              )}
              {(docNumber || metaSummary) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {docNumber && (
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold ${palette.pill}`}>
                      {docNumber}
                    </span>
                  )}
                  {metaSummary && (
                    <span className="text-[11px] font-semibold text-[#627385] dark:text-slate-400">
                      {metaSummary}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {actions && actions.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    action.onClick();
                    onClose();
                  }}
                  className={
                    action.primary
                      ? "inline-flex items-center gap-1.5 rounded-lg bg-[#1d4f88] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#153b66] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d4f88]"
                      : "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-[#142747] transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  }
                >
                  {renderActionIcon(action.icon)}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!prefersReducedMotion && durationMs > 0 && Number.isFinite(durationMs) && (
        <motion.div
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: durationMs / 1000, ease: "linear" }}
          style={{ transformOrigin: "left" }}
          className={`absolute bottom-0 left-0 right-0 h-1 ${palette.bar} opacity-75`}
        />
      )}
    </motion.div>
  );
}
