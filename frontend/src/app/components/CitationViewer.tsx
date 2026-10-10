import { useState } from "react";
import { BookOpenText } from "lucide-react";
import { CitationInspector, effectiveStatusLabel } from "./CitationInspector";
import type { LegalCitation } from "./CitationInspector";

/** Rút gọn nhãn hiển thị nhưng giữ đủ định danh nguồn trong mô tả nút. */
function citationLabel(citation: LegalCitation): string {
  const location = [
    citation.articleNumber ? `Điều ${citation.articleNumber}` : "",
    citation.clauseNumber ? `Khoản ${citation.clauseNumber}` : "",
    citation.pointId ? `Điểm ${citation.pointId}` : "",
  ].filter(Boolean).join(", ");
  return [location, citation.docNumber || citation.title || "Văn bản pháp luật"].filter(Boolean).join(" · ");
}

/** Chỉ mở nguyên văn trích dẫn đã được Backend xác thực từ kho pháp luật. */
export function CitationViewer({ citations }: { citations: LegalCitation[] }) {
  const [selected, setSelected] = useState<LegalCitation | null>(null);
  const verified = citations.filter(citation => citation.verified === true);
  if (verified.length === 0) {
    return <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-600">Chưa có căn cứ pháp lý đã xác thực để đối chiếu.</p>;
  }
  return (
    <section className="mt-4 border-t border-slate-200 pt-3" aria-label="Căn cứ pháp lý đối chiếu">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-slate-600">Nguồn:</span>
        {verified.map(citation => {
          const label = citationLabel(citation);
          const status = effectiveStatusLabel(citation.effectiveStatus);
          const uncertain = citation.effectiveStatus !== "active";
          const statusStyle = citation.effectiveStatus === "active"
            ? "border-blue-200 bg-blue-50/70 text-blue-900 hover:bg-blue-100"
            : citation.effectiveStatus === "unknown"
              ? "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
              : "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100";
          return (
            <button
              key={citation.chunkId}
              type="button"
              onClick={() => setSelected(citation)}
              aria-label={`Đối chiếu ${citation.title}, ${label}. ${status}`}
              title={`${citation.title} · ${label} · ${status}`}
              className={`inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-left text-xs font-medium leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 motion-reduce:transition-none ${statusStyle}`}
            >
              <BookOpenText size={13} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{label}</span>
              {uncertain && <span className="shrink-0 border-l border-current/20 pl-1.5 text-[11px] font-normal">{status}</span>}
            </button>
          );
        })}
      </div>
      <CitationInspector citation={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
