import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { CitationInspector } from "./CitationInspector";
import type { LegalCitation } from "./CitationInspector";

/** Tạo danh sách nhãn nút pill màu xanh ngọc (ví dụ: Điều 328, Điều 122 hoặc CD-01) cho một trích dẫn. */
function buildCitationBadges(citation: LegalCitation): { label: string; citation: LegalCitation }[] {
  if (citation.articleNumber) {
    return [{ label: `Điều ${citation.articleNumber}`, citation }];
  }
  const matchedArticles = Array.from(
    new Set(Array.from(citation.content?.matchAll(/Điều\s+\d+[a-zA-Z0-9]*/g) ?? [], (m) => m[0]))
  );
  if (matchedArticles.length > 0) {
    return matchedArticles.map((label) => ({ label, citation }));
  }
  if (citation.chapter) {
    const shortChapter = citation.chapter.split("/").pop()?.trim() || citation.chapter;
    const compact = shortChapter.length > 24 ? `${shortChapter.slice(0, 22)}…` : shortChapter;
    return [
      { label: citation.docNumber || "Nguồn", citation },
      ...(compact && compact !== citation.docNumber ? [{ label: compact, citation }] : []),
    ];
  }
  return [{ label: citation.docNumber || "Chi tiết nguồn", citation }];
}

/**
 * Hiển thị khối "Nguồn trích dẫn:" theo đúng mẫu aitracuuluat.vn:
 * đường kẻ nét đứt, tên văn bản in nghiêng gạch chân kèm các thẻ pill màu xanh ngọc tương tác.
 */
export function CitationViewer({
  citations,
  answerText,
  selectedCitation,
  onSelectCitation,
}: {
  citations: LegalCitation[];
  answerText?: string;
  selectedCitation?: LegalCitation | null;
  onSelectCitation?: (citation: LegalCitation | null) => void;
}) {
  const [internalSelected, setInternalSelected] = useState<LegalCitation | null>(null);
  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);
  const selected = selectedCitation !== undefined ? selectedCitation : internalSelected;
  const setSelected = onSelectCitation ?? setInternalSelected;
  const verified = citations.filter((citation) => citation.verified === true);

  if (verified.length === 0) {
    return null;
  }

  // Gom nhóm các trích dẫn theo cùng một văn bản pháp luật để hiển thị gọn trên từng dòng
  const groupedByDoc = new Map<
    string,
    {
      docKey: string;
      title: string;
      primaryCitation: LegalCitation;
      badges: { label: string; citation: LegalCitation }[];
    }
  >();

  for (const citation of verified) {
    const title = citation.title || citation.docNumber || "Văn bản pháp luật";
    const docKey = citation.docNumber || title;
    const existing = groupedByDoc.get(docKey) ?? {
      docKey,
      title,
      primaryCitation: citation,
      badges: [],
    };
    for (const badge of buildCitationBadges(citation)) {
      if (!existing.badges.some((item) => item.label.toLowerCase() === badge.label.toLowerCase())) {
        existing.badges.push(badge);
      }
    }
    groupedByDoc.set(docKey, existing);
  }

  const handleCopy = async () => {
    if (!answerText) return;
    try {
      const cleanText = answerText.replace(/\*\*([^*]+)\*\*/g, "$1");
      await navigator.clipboard.writeText(cleanText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Bỏ qua nếu trình duyệt chặn quyền clipboard
    }
  };

  return (
    <section
      className="mt-4 border-t border-dashed border-slate-300/90 pt-3.5 dark:border-slate-700"
      aria-label="Nguồn trích dẫn"
    >
      <div className="mb-2.5 text-[13.5px] font-bold text-slate-800 dark:text-slate-100">
        Nguồn trích dẫn:
      </div>
      <div className="space-y-2">
        {Array.from(groupedByDoc.values()).map((group) => {
          const isExpanded = Boolean(expandedDocs[group.docKey]);
          const maxVisible = 3;
          const visibleBadges = isExpanded ? group.badges : group.badges.slice(0, maxVisible);
          const hiddenCount = group.badges.length - visibleBadges.length;

          return (
            <div key={group.docKey} className="flex flex-wrap items-center gap-1.5 leading-6">
              <button
                type="button"
                onClick={() => setSelected(group.primaryCitation)}
                title={`Xem nội dung nguồn: ${group.title}`}
                className="cursor-pointer text-left text-[13.5px] font-medium italic text-slate-800 underline decoration-slate-500 underline-offset-4 transition-colors hover:text-[#0f766e] hover:decoration-[#0f766e] focus-visible:outline-2 focus-visible:outline-[#0f766e] dark:text-slate-200"
              >
                {group.title}
              </button>
              {visibleBadges.map((badge, idx) => (
                <button
                  key={`${group.docKey}-${badge.label}-${idx}`}
                  type="button"
                  onClick={() => setSelected(badge.citation)}
                  title={`Đối chiếu ${badge.label} - ${group.title}`}
                  className="inline-flex cursor-pointer items-center rounded-md bg-[#d8f3f1] px-2 py-0.5 text-xs font-medium leading-4 text-[#0d6e66] transition-colors hover:bg-[#bce8e4] focus-visible:outline-2 focus-visible:outline-[#0f766e] dark:bg-teal-950/80 dark:text-teal-200"
                >
                  {badge.label}
                </button>
              ))}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedDocs((prev) => ({ ...prev, [group.docKey]: true }))
                  }
                  title={`Xem thêm ${hiddenCount} điều khoản trích dẫn`}
                  className="inline-flex cursor-pointer items-center rounded-md bg-[#d8f3f1] px-2 py-0.5 text-xs font-semibold leading-4 text-[#0d6e66] transition-colors hover:bg-[#bce8e4] focus-visible:outline-2 focus-visible:outline-[#0f766e] dark:bg-teal-950/80 dark:text-teal-200"
                >
                  +{hiddenCount}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {answerText && (
        <div className="mt-2.5 flex items-center">
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Sao chép câu trả lời"
            title={copied ? "Đã sao chép" : "Sao chép câu trả lời"}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-[#0f766e] dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          </button>
        </div>
      )}

      <CitationInspector citation={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
