import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { LegalChat } from "../components/LegalChat";

/** Không gian tra cứu độc lập toàn màn hình, nhận câu hỏi mẫu từ trang chủ qua URL. */
export function EmbedChatPage() {
  const [params] = useSearchParams();
  const initialQuestion = params.get("question") ?? undefined;
  return (
    <main className="flex h-[100dvh] min-h-[28rem] w-full flex-col overflow-hidden bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        <LegalChat
          fullScreen
          initialQuestion={initialQuestion}
          headerAction={
            <Link
              to="/"
              className="legal-chat-header-btn mr-1 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-white"
              title="Quay về trang chủ"
            >
              <ArrowLeft size={14} className="text-white" />
              <span className="hidden sm:inline text-white">Về trang chủ</span>
            </Link>
          }
        />
      </div>
    </main>
  );
}
