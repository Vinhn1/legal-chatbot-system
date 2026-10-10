import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import axios from "axios";
import { ArrowUpRight, BookOpenText, Send, Sparkles } from "lucide-react";
import { API_BASE } from "../../config";
import type { LegalCitation } from "./CitationInspector";
import { CitationViewer } from "./CitationViewer";
import { RobotAvatar } from "./RobotAvatar";

/** Một lượt hội thoại cùng danh sách nguồn gốc trả về từ backend. */
type ChatMessage = { id: string; role: "user" | "bot"; text: string; citations?: LegalCitation[] };

const SUGGESTIONS = [
  "Điều kiện cấp giấy chứng nhận quyền sử dụng đất là gì?",
  "Quy định về thời gian thử việc theo Bộ luật Lao động?",
  "Khoản 2 Điều 1 của văn bản được tra cứu quy định gì?",
];

/** Diễn giải phần nhấn mạnh và mã nội dòng mà không thực thi HTML trong phản hồi. */
function renderInline(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-bold text-slate-950">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-slate-100 px-1 text-[.9em]">{part.slice(1, -1)}</code>;
    return part;
  });
}

type AnswerList = { ordered: boolean; items: { text: string; children: AnswerList[] }[] };
const LIST_LINE = /^(\s*)([-*]|\d+[.)])\s+(.+)$/;

/** Gom danh sách lồng nhau thành phần tử HTML có ngữ nghĩa để đọc bằng bàn phím và trình đọc màn hình. */
function readList(lines: string[], start: number, indent: number, ordered: boolean): { list: AnswerList; next: number } {
  const list: AnswerList = { ordered, items: [] };
  let next = start;
  while (next < lines.length) {
    const match = LIST_LINE.exec(lines[next]);
    if (!match) break;
    const currentIndent = match[1].replace(/\t/g, "  ").length;
    const currentOrdered = /^\d/.test(match[2]);
    if (currentIndent < indent || (currentIndent === indent && currentOrdered !== ordered)) break;
    if (currentIndent > indent) {
      const parent = list.items[list.items.length - 1];
      if (!parent) break;
      const child = readList(lines, next, currentIndent, currentOrdered);
      parent.children.push(child.list);
      next = child.next;
      continue;
    }
    list.items.push({ text: match[3], children: [] });
    next += 1;
  }
  return { list, next };
}

/** Chỉ diễn giải Markdown văn bản đã hỗ trợ, không cho phép HTML từ mô hình chạy trong trang. */
function renderList(list: AnswerList, key: number): ReactNode {
  const className = "space-y-1.5 pl-5 marker:text-slate-500 " + (list.ordered ? "list-decimal" : "list-disc");
  const items = list.items.map((item, index) => <li key={index} className="pl-1">
    {renderInline(item.text)}
    {item.children.map((child, childIndex) => <div key={childIndex} className="mt-1.5">{renderList(child, childIndex)}</div>)}
  </li>);
  return list.ordered ? <ol key={key} className={className}>{items}</ol> : <ul key={key} className={className}>{items}</ul>;
}

/** Giữ đoạn văn, tiêu đề và danh sách phân cấp rõ ràng trong câu trả lời dài. */
function AnswerText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) { index += 1; continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(lines[index]);
    if (heading) {
      blocks.push(<h3 key={index} className="text-[15px] font-bold leading-6 text-slate-950">{renderInline(heading[2])}</h3>);
      index += 1;
      continue;
    }
    const bullet = LIST_LINE.exec(lines[index]);
    if (bullet) {
      const list = readList(lines, index, bullet[1].replace(/\t/g, "  ").length, /^\d/.test(bullet[2]));
      blocks.push(renderList(list.list, index));
      index = list.next;
      continue;
    }
    const paragraph: string[] = [];
    const start = index;
    while (index < lines.length && lines[index].trim() && !LIST_LINE.test(lines[index]) && !/^#{1,3}\s+/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={start} className="whitespace-pre-line">{renderInline(paragraph.join("\n"))}</p>);
  }
  return <div className="min-w-0 space-y-4 break-words text-sm leading-[1.8] text-slate-800 [overflow-wrap:anywhere]">{blocks}</div>;
}

/** Khung hỏi đáp dùng chung cho trang tra cứu và widget nổi. */
export function LegalChat({ initialQuestion }: { initialQuestion?: string }) {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const startedQuestion = useRef("");
  const busy = useRef(false);

  /** Gửi đúng một câu hỏi, giữ lại nội dung nhập nếu dịch vụ trả lỗi. */
  const sendQuestion = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busy.current) return;
    if (text.length > 2000) {
      setError("Câu hỏi không được vượt quá 2000 ký tự.");
      return;
    }
    busy.current = true;
    setLoading(true);
    setError("");
    setQuestion("");
    const pendingId = crypto.randomUUID();
    setMessages(previous => [...previous, { id: pendingId, role: "user", text }]);
    try {
      const response = await axios.post(`${API_BASE}/chat`, { message: text, sessionId });
      const answer = (typeof response.data?.answer === "string" ? response.data.answer.trim() : "") || "Chưa tìm thấy thông tin trong bộ dữ liệu hiện có.";
      const citations = Array.isArray(response.data?.citations) ? response.data.citations as LegalCitation[] : [];
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: "bot", text: answer, citations }]);
    } catch (failure) {
      const detail = axios.isAxiosError(failure) ? failure.response?.data?.message ?? failure.response?.data?.detail : undefined;
      // Bỏ lượt hỏi chưa được xử lý để khi thử lại không xuất hiện hai bong bóng giống nhau.
      setMessages(previous => previous.filter(message => message.id !== pendingId));
      setError(typeof detail === "string" ? detail : "Không thể kết nối dịch vụ tra cứu. Vui lòng thử lại.");
      setQuestion(text);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [sessionId]);

  // Câu hỏi từ trang chủ chỉ được gửi một lần cho mỗi giá trị URL.
  useEffect(() => {
    if (!initialQuestion || startedQuestion.current === initialQuestion) return;
    startedQuestion.current = initialQuestion;
    void sendQuestion(initialQuestion);
  }, [initialQuestion, sendQuestion]);

  // Chỉ cuộn danh sách hội thoại để widget không kéo trang chủ đi theo.
  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [messages, loading, error]);

  // Ô nhập giãn theo nội dung và thu lại sau khi gửi câu hỏi.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [question]);

  /** Enter gửi câu hỏi; Shift + Enter chèn dòng mới khi soạn văn bản dài. */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendQuestion(question);
    }
  }

  /** Đồng bộ nút Gửi với hành vi Enter của vùng soạn câu hỏi. */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion(question);
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white text-slate-900 shadow-[0_20px_70px_-30px_rgba(15,23,42,.4)]">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 [@media(max-height:700px)]:py-2">
        <RobotAvatar size={42} state={loading ? "thinking" : "idle"} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-950">Trợ lý pháp luật AI</div>
          <div className="mt-0.5 text-xs text-slate-600">Tra cứu nguồn công khai · Đối chiếu Điều, Khoản</div>
        </div>
        <span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 sm:inline-flex">Dữ liệu công khai</span>
      </div>

      {/* Chỉ danh sách tin nhắn được cuộn; không đẩy tiêu đề và ô nhập ra khỏi màn hình. */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,#f8fafc_0%,#fff_100%)] px-4 py-5 sm:px-6" aria-live="polite" aria-label="Nội dung hội thoại">
        {messages.length === 0 && <div className="mx-auto max-w-md py-5 text-center sm:py-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-800"><BookOpenText size={27} /></div>
          <h2 className="mt-4 text-lg font-bold text-slate-950">Bạn cần tra cứu điều gì?</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Đặt câu hỏi bằng tiếng Việt. Câu trả lời sẽ dẫn đến đoạn văn bản được truy xuất để bạn tự đối chiếu.</p>
          <div className="mt-5 flex flex-col gap-2 text-left">
            {SUGGESTIONS.map(suggestion => <button key={suggestion} type="button" onClick={() => void sendQuestion(suggestion)} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-xs leading-5 text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700">{suggestion}</button>)}
          </div>
        </div>}

        {messages.map(message => <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex items-start gap-2.5"}>
          {message.role === "bot" && <div className="shrink-0 pt-1"><RobotAvatar size={30} state="idle" /></div>}
          <div className={`min-w-0 max-w-[90%] break-words rounded-2xl px-4 py-3 sm:max-w-[82%] ${message.role === "user" ? "bg-blue-900 text-sm leading-6 text-white" : "border border-slate-200 bg-white shadow-sm"}`}>
            {message.role === "user" ? <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p> : <>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-[#142747]">Phần giải thích của AI</p>
              <AnswerText text={message.text} />
              <CitationViewer citations={message.citations ?? []} />
            </>}
          </div>
        </div>)}

        {loading && <div className="flex items-start gap-2.5" role="status"><RobotAvatar size={30} state="thinking" /><div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950"><Sparkles size={16} className="motion-safe:animate-pulse" /> Đang tra cứu văn bản pháp luật...</div></div>}
        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-slate-200 bg-white p-2.5 sm:p-3 [@media(max-height:700px)]:p-2">
        <div className="rounded-xl border border-slate-300 bg-white p-1.5 transition-colors focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100 sm:p-2">
          <textarea
            ref={textareaRef}
            aria-label="Câu hỏi pháp luật"
            value={question}
            onChange={event => { setQuestion(event.target.value); if (error) setError(""); }}
            onKeyDown={handleKeyDown}
            placeholder="Nhập câu hỏi pháp luật của bạn..."
            rows={1}
            className="min-h-[2.5rem] max-h-28 w-full resize-none overflow-y-auto bg-transparent px-2 py-1 text-sm leading-5 text-slate-950 outline-none placeholder:text-slate-500"
          />
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-1 pt-1">
            <span className={`text-[11px] ${question.trim().length > 2000 ? "font-semibold text-rose-700" : "text-slate-600"}`}>{question.trim().length}/2000 ký tự</span>
            <button type="submit" disabled={loading || !question.trim() || question.trim().length > 2000} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-blue-900 px-3.5 text-xs font-bold text-white transition-[background-color,transform] hover:bg-blue-800 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"><Send size={14} /> Gửi</button>
          </div>
        </div>
        {question.trim().length > 2000 && <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">Câu hỏi không được vượt quá 2000 ký tự.</p>}
        <p className="mt-1.5 flex items-center justify-between gap-2 text-[11px] leading-4 text-slate-600"><span>Enter để gửi · Shift + Enter để xuống dòng</span><span className="hidden items-center gap-1 sm:inline-flex">Luôn đối chiếu văn bản gốc <ArrowUpRight size={11} /></span></p>
      </form>
    </div>
  );
}
