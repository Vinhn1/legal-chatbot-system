import { useEffect, useRef } from "react";
import { ArrowUpRight, FileText, X } from "lucide-react";

/** Cấu trúc trích dẫn đã được chuẩn hóa từ nguồn truy xuất của AI Core. */
export interface LegalCitation {
  chunkId: string;
  content: string;
  title: string;
  url: string;
  docNumber: string;
  chapter: string;
  articleNumber: string;
  clauseNumber: string;
  pointId: string;
  issuedDate: string;
  effectiveStatus: string;
  warning: string;
  verified: boolean;
}

/** Diễn giải nhãn hiệu lực bằng ngôn ngữ dễ hiểu cho người tra cứu. */
export function effectiveStatusLabel(status: string): string {
  return ({
    active: "Còn hiệu lực",
    expired: "Hết hiệu lực",
    partially_expired: "Hết hiệu lực một phần",
    not_yet_effective: "Chưa có hiệu lực",
    unknown: "Chưa xác minh hiệu lực",
  } as Record<string, string>)[status] ?? "Chưa xác minh hiệu lực";
}

/** Panel hiển thị đúng đoạn nguồn được truy xuất, có thể đóng bằng Escape. */
export function CitationInspector({ citation, onClose }: { citation: LegalCitation | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!citation) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]');
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      previousFocus?.focus();
    };
  }, [citation, onClose]);

  if (!citation) return null;

  const unsafeStatus = citation.effectiveStatus !== "active";
  const sourceUrl = /^https?:\/\//i.test(citation.url) ? citation.url : null;

  return (
    <div className="fixed inset-0 z-[80]" role="presentation">
      <button
        type="button"
        className="absolute inset-0 w-full bg-slate-950/55 motion-safe:animate-in motion-safe:fade-in"
        onClick={onClose}
        aria-label="Đóng chi tiết trích dẫn"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="citation-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-[34rem] flex-col overflow-hidden bg-white shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-right motion-reduce:transition-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Đối chiếu nguồn luật</p>
            <h2 id="citation-title" className="mt-1 text-xl font-bold leading-snug text-slate-950">{citation.title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Đóng panel trích dẫn" className="shrink-0 rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            {citation.docNumber && <span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-900">{citation.docNumber}</span>}
            {citation.chapter && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">{citation.chapter}</span>}
            {citation.articleNumber && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">Điều {citation.articleNumber}</span>}
            {citation.clauseNumber && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">Khoản {citation.clauseNumber}</span>}
            {citation.pointId && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">Điểm {citation.pointId}</span>}
          </div>
          {citation.issuedDate && <p className="mt-5 text-sm text-slate-600">Ngày ban hành: <time dateTime={citation.issuedDate}>{citation.issuedDate}</time></p>}
          <div className={`mt-5 rounded-xl border px-4 py-3 text-sm ${unsafeStatus ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
            <strong>{effectiveStatusLabel(citation.effectiveStatus)}</strong>
            {citation.warning && <p className="mt-1">{citation.warning}</p>}
          </div>
          <div className="mt-7 border-t border-slate-200 pt-6">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><FileText size={17} /> Đoạn văn bản được truy xuất</div>
            {citation.content ? (
              <p className="mt-4 whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-800">{citation.content}</p>
            ) : (
              <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">Dịch vụ chưa cung cấp nội dung đoạn trích. Hãy mở nguồn gốc để đối chiếu.</p>
            )}
          </div>
          {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-800 underline underline-offset-4 hover:text-blue-600">Mở văn bản nguồn <ArrowUpRight size={16} /></a>}
        </div>
      </aside>
    </div>
  );
}
