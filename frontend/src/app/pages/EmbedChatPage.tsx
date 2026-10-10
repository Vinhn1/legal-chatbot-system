import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { LegalChat } from "../components/LegalChat";

/** Không gian tra cứu độc lập, nhận câu hỏi mẫu từ trang chủ qua URL. */
export function EmbedChatPage() {
  const [params] = useSearchParams();
  const initialQuestion = params.get("question") ?? undefined;
  return <main className="flex h-[100dvh] min-h-[28rem] flex-col overflow-hidden bg-slate-100 px-3 pb-3 pt-3 text-slate-900 sm:px-6 sm:pb-6 sm:pt-5">
    <div className="mx-auto flex w-full max-w-5xl shrink-0 items-center justify-between gap-3 pb-3 sm:pb-4">
      <Link to="/" className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-blue-950 hover:bg-white focus-visible:outline-2 focus-visible:outline-blue-700"><ArrowLeft size={16} /> Về trang chủ</Link>
      <span className="hidden text-xs font-semibold tracking-wide text-[#a17842] sm:inline">Giải thích AI · Đối chiếu nguyên văn</span>
    </div>
    <div className="mx-auto min-h-0 w-full max-w-5xl flex-1"><LegalChat initialQuestion={initialQuestion} /></div>
  </main>;
}
