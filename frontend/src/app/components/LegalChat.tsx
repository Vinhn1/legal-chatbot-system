import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import axios from "axios";
import { ArrowUpRight, CheckCircle2, Info, RotateCcw, Send, X } from "lucide-react";
import { API_BASE } from "../../config";
import type { LegalCitation } from "./CitationInspector";
import { CitationViewer } from "./CitationViewer";
import { RobotAvatar } from "./RobotAvatar";
import type { RobotState } from "./RobotAvatar";

const AVATAR_STATE_OPTIONS: { value: Exclude<RobotState, "thinking">; label: string }[] = [
  { value: "idle", label: "Chờ" },
  { value: "searching", label: "Đang tra cứu" },
  { value: "talking", label: "Đang trả lời" },
  { value: "happy", label: "Đã tìm thấy" },
];

/** Một lượt hội thoại cùng danh sách nguồn gốc trả về từ backend */
type ChatMessage = {
  id: string;
  role: "user" | "bot";
  text: string;
  citations?: LegalCitation[];
  createdAt?: string;
};

const SUGGESTIONS = [
  "Điều kiện cấp giấy chứng nhận quyền sử dụng đất là gì?",
  "Quy định về thời gian thử việc theo Bộ luật Lao động?",
  "Khoản 2 Điều 1 của văn bản được tra cứu quy định gì?",
];

/** Lấy thời gian hiển thị hiện tại định dạng HH:mm */
function formatCurrentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

const INLINE_CITATION_PATTERN = /^\[([^[\]\n]{2,80})\]$/i;

const INLINE_SPLIT_REGEX = /(\*\*[^*]+\*\*|`[^`]+`|\[[^[\]\n]{2,80}\])/gi;

/** Đối chiếu nhãn trích dẫn nội dòng như [Điều 39] hoặc [CD-01] với danh sách nguồn đã xác thực. */
function findMatchingCitation(label: string, citations: LegalCitation[]): LegalCitation | null {
  const verified = citations.filter((item) => item.verified);
  const pool = verified.length > 0 ? verified : citations;
  if (pool.length === 0) return null;
  const articleMatch = /Điều\s+(\d+[a-zA-Z0-9]*)/i.exec(label);
  const clauseMatch = /Khoản\s+(\d+)/i.exec(label);
  if (articleMatch) {
    const articleNum = articleMatch[1].toLowerCase();
    const clauseNum = clauseMatch ? clauseMatch[1] : null;
    const exactClause = clauseNum
      ? pool.find(
          (item) =>
            item.articleNumber?.toLowerCase() === articleNum &&
            item.clauseNumber === clauseNum
        )
      : null;
    if (exactClause) return exactClause;
    const exactArticle = pool.find(
      (item) => item.articleNumber?.toLowerCase() === articleNum
    );
    if (exactArticle) return exactArticle;
    const contentMention = pool.find((item) =>
      new RegExp(`Điều\\s+${articleMatch[1]}\\b`, "i").test(item.content || "")
    );
    if (contentMention) return contentMention;
  }
  const normalizedLabel = label.trim().toLowerCase();
  const byDocNumber = pool.find(
    (item) =>
      item.docNumber &&
      (item.docNumber.toLowerCase() === normalizedLabel ||
        normalizedLabel.includes(item.docNumber.toLowerCase()))
  );
  if (byDocNumber) return byDocNumber;
  return pool[0];
}

/** Diễn giải phần nhấn mạnh, mã nội dòng và thẻ trích dẫn [Điều X] / [CD-01] mà không thực thi HTML. */
function renderInline(
  line: string,
  citations: LegalCitation[] = [],
  onSelectCitation?: (citation: LegalCitation) => void
): ReactNode[] {
  return line.split(INLINE_SPLIT_REGEX).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-bold text-slate-950 dark:text-white">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-slate-100 px-1 text-[.9em] dark:bg-slate-700">{part.slice(1, -1)}</code>;
    }
    const citationMatch = INLINE_CITATION_PATTERN.exec(part);
    if (citationMatch) {
      const rawContent = citationMatch[1].trim();
      const subLabels = rawContent
        .split(/\s*[,;]\s*/)
        .map((item) => item.trim())
        .filter(Boolean);
      return (
        <span key={index} className="mx-0.5 inline-flex flex-wrap items-center gap-1 align-baseline">
          {subLabels.map((label, subIdx) => {
            const target = findMatchingCitation(label, citations);
            if (target && onSelectCitation) {
              return (
                <button
                  key={`${index}-${subIdx}`}
                  type="button"
                  onClick={() => onSelectCitation(target)}
                  title={`Đối chiếu nguồn: ${target.title || target.docNumber} (${label})`}
                  className="inline-flex cursor-pointer items-center rounded-md bg-[#d8f3f1] px-2 py-0.5 text-xs font-medium leading-4 text-[#0d6e66] transition-colors hover:bg-[#bce8e4] focus-visible:outline-2 focus-visible:outline-[#0f766e] dark:bg-teal-950/80 dark:text-teal-200"
                >
                  {label}
                </button>
              );
            }
            return (
              <span
                key={`${index}-${subIdx}`}
                className="inline-flex items-center rounded-md bg-[#d8f3f1] px-2 py-0.5 text-xs font-medium leading-4 text-[#0d6e66] dark:bg-teal-950/80 dark:text-teal-200"
              >
                {label}
              </span>
            );
          })}
        </span>
      );
    }
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
function renderList(
  list: AnswerList,
  key: number,
  citations: LegalCitation[] = [],
  onSelectCitation?: (citation: LegalCitation) => void
): ReactNode {
  const className = "space-y-2 pl-5 marker:text-slate-600 " + (list.ordered ? "list-decimal" : "list-disc");
  const items = list.items.map((item, index) => <li key={index} className="pl-1 leading-[1.75]">
    {renderInline(item.text, citations, onSelectCitation)}
    {item.children.map((child, childIndex) => <div key={childIndex} className="mt-1.5">{renderList(child, childIndex, citations, onSelectCitation)}</div>)}
  </li>);
  return list.ordered ? <ol key={key} className={className}>{items}</ol> : <ul key={key} className={className}>{items}</ul>;
}

/** Tạo nhãn trích dẫn ngắn để gắn tự động nếu văn bản trả lời chưa có thẻ [Điều X] nội dòng. */
function defaultBadgeLabel(citation: LegalCitation): string {
  if (citation.articleNumber) return `Điều ${citation.articleNumber}`;
  const firstArticle = /Điều\s+\d+[a-zA-Z0-9]*/i.exec(citation.content || "");
  if (firstArticle) return firstArticle[0];
  return citation.docNumber || "Nguồn 1";
}

/** Giữ đoạn văn, tiêu đề và danh sách phân cấp rõ ràng trong câu trả lời dài. */
export function AnswerText({
  text,
  citations = [],
  onSelectCitation,
}: {
  text: string;
  citations?: LegalCitation[];
  onSelectCitation?: (citation: LegalCitation) => void;
}) {
  const verified = citations.filter((item) => item.verified);
  const hasInlineTag = /\[[^[\]\n]{2,80}\]/.test(text);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let firstParagraphRendered = false;
  while (index < lines.length) {
    if (!lines[index].trim()) { index += 1; continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(lines[index]);
    if (heading) {
      blocks.push(<h3 key={index} className="pt-1 text-[15px] font-bold leading-6 text-slate-950 dark:text-white">{renderInline(heading[2], verified, onSelectCitation)}</h3>);
      index += 1;
      continue;
    }
    const bullet = LIST_LINE.exec(lines[index]);
    if (bullet) {
      const list = readList(lines, index, bullet[1].replace(/\t/g, "  ").length, /^\d/.test(bullet[2]));
      blocks.push(renderList(list.list, index, verified, onSelectCitation));
      index = list.next;
      continue;
    }
    const paragraph: string[] = [];
    const start = index;
    while (index < lines.length && lines[index].trim() && !LIST_LINE.test(lines[index]) && !/^#{1,3}\s+/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    const joined = paragraph.join("\n");
    const isStandaloneBoldHeading = paragraph.length === 1 && /^\*\*[^*]+\*\*:?$/.test(joined);
    const shouldAppendFallbackBadge = !firstParagraphRendered && !hasInlineTag && verified.length > 0 && !isStandaloneBoldHeading;
    firstParagraphRendered = true;
    blocks.push(
      <p key={start} className={`whitespace-pre-line ${isStandaloneBoldHeading ? "pt-1 text-[15px] font-bold text-slate-950 dark:text-white" : ""}`}>
        {renderInline(joined, verified, onSelectCitation)}
        {shouldAppendFallbackBadge && (
          <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-baseline">
            {Array.from(new Map(verified.map((c) => [defaultBadgeLabel(c), c])).entries())
              .slice(0, 2)
              .map(([label, target]) => (
                <button
                  key={target.chunkId}
                  type="button"
                  onClick={() => onSelectCitation?.(target)}
                  title={`Đối chiếu nguồn: ${target.title || target.docNumber}`}
                  className="inline-flex cursor-pointer items-center rounded-md bg-[#d8f3f1] px-2 py-0.5 text-xs font-medium leading-4 text-[#0d6e66] transition-colors hover:bg-[#bce8e4] focus-visible:outline-2 focus-visible:outline-[#0f766e] dark:bg-teal-950/80 dark:text-teal-200"
                >
                  {label}
                </button>
              ))}
          </span>
        )}
      </p>
    );
  }
  return <div className="min-w-0 space-y-3.5 break-words text-sm leading-[1.8] text-slate-800 dark:text-slate-100 [overflow-wrap:anywhere]">{blocks}</div>;
}

/** Khung hỏi đáp dùng chung cho trang tra cứu toàn màn hình và widget nổi. */
export function LegalChat({
  initialQuestion,
  onClose,
  fullScreen = false,
  headerAction,
  hideHeader = false,
}: {
  initialQuestion?: string;
  onClose?: () => void;
  fullScreen?: boolean;
  headerAction?: ReactNode;
  hideHeader?: boolean;
}) {
  // Capability phiên chỉ lưu trong bộ nhớ tab, không đặt vào URL hoặc log.
  const session = useRef<{ sessionId?: string; sessionToken?: string }>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeCitation, setActiveCitation] = useState<{ messageId: string; citation: LegalCitation } | null>(null);
  const [avatarState, setAvatarState] = useState<Exclude<RobotState, "thinking">>("idle");
  const [latestBotMessageId, setLatestBotMessageId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const startedQuestion = useRef("");
  const busy = useRef(false);
  const stateTimers = useRef<number[]>([]);

  /** Xóa các bộ hẹn giờ chuyển trạng thái avatar đang chờ */
  const clearAvatarTimers = useCallback(() => {
    stateTimers.current.forEach((timerId) => window.clearTimeout(timerId));
    stateTimers.current = [];
  }, []);

  useEffect(() => {
    return () => clearAvatarTimers();
  }, [clearAvatarTimers]);

  /** Đổi trạng thái avatar thủ công hoặc tự động kèm tự trả về Chờ sau khi hiển thị Đã tìm thấy */
  const triggerAvatarState = useCallback(
    (nextState: Exclude<RobotState, "thinking">) => {
      clearAvatarTimers();
      setAvatarState(nextState);
      if (nextState === "happy") {
        const timerId = window.setTimeout(() => setAvatarState("idle"), 2800);
        stateTimers.current.push(timerId);
      }
    },
    [clearAvatarTimers]
  );

  /** Làm mới toàn bộ phiên trò chuyện */
  const handleReset = () => {
    clearAvatarTimers();
    session.current = {};
    setMessages([]);
    setError("");
    setQuestion("");
    setActiveCitation(null);
    setAvatarState("idle");
    setLatestBotMessageId(null);
    startedQuestion.current = "";
  };

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
    clearAvatarTimers();
    setAvatarState("searching");
    const pendingId = crypto.randomUUID();
    const currentTime = formatCurrentTime();
    setMessages(previous => [...previous, { id: pendingId, role: "user", text, createdAt: currentTime }]);
    try {
      const response = await axios.post(`${API_BASE}/chat`, { message: text, ...session.current });
      session.current = { sessionId: response.data.sessionId, sessionToken: response.data.sessionToken };
      const answer = (typeof response.data?.answer === "string" ? response.data.answer.trim() : "") || "Chưa tìm thấy thông tin trong bộ dữ liệu hiện có.";
      const citations = Array.isArray(response.data?.citations) ? response.data.citations as LegalCitation[] : [];
      const botId = crypto.randomUUID();
      setLatestBotMessageId(botId);
      setMessages(previous => [...previous, { id: botId, role: "bot", text: answer, citations, createdAt: formatCurrentTime() }]);

      // Chuyển tuần tự sang trạng thái Đang trả lời -> Đã tìm thấy -> Chờ
      clearAvatarTimers();
      setAvatarState("talking");
      const toHappyTimer = window.setTimeout(() => {
        setAvatarState("happy");
        const toIdleTimer = window.setTimeout(() => {
          setAvatarState("idle");
        }, 2800);
        stateTimers.current.push(toIdleTimer);
      }, 1600);
      stateTimers.current.push(toHappyTimer);
    } catch (failure) {
      const detail = axios.isAxiosError(failure) ? failure.response?.data?.message ?? failure.response?.data?.detail : undefined;
      // Bỏ lượt hỏi chưa được xử lý để khi thử lại không xuất hiện hai bong bóng giống nhau.
      setMessages(previous => previous.filter(message => message.id !== pendingId));
      setError(typeof detail === "string" ? detail : "Không thể kết nối dịch vụ tra cứu. Vui lòng thử lại.");
      setQuestion(text);
      clearAvatarTimers();
      setAvatarState("idle");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [clearAvatarTimers]);

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
    <div
      className={`flex h-full min-h-0 w-full flex-col overflow-hidden bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100 ${
        fullScreen
          ? "rounded-none border-0 shadow-none"
          : "rounded-[1.75rem] border border-slate-200/90 shadow-[0_25px_70px_-20px_rgba(15,23,42,0.35),0_0_1px_1px_rgba(0,0,0,0.04)] dark:border-slate-800"
      }`}
    >
      {/* 1. Header màu Xanh Navy Hoàng gia theo hình ảnh mẫu (tùy chọn ẩn nếu trang cha đã có header) */}
      {!hideHeader && (
        <div className="flex shrink-0 items-center justify-between gap-3 bg-gradient-to-r from-[#142e54] via-[#1a3c6d] to-[#1d4f88] px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {headerAction}
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white tracking-tight leading-snug">
                Trợ lý pháp luật AI
              </h2>
              <p className="truncate text-xs text-blue-100/80 leading-tight mt-0.5">
                Tra cứu nguồn công khai · Đối chiếu Điều, Khoản
              </p>
            </div>
          </div>

          {/* Nút thao tác trên Header: Làm mới và Đóng */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              aria-label="Làm mới cuộc trò chuyện"
              title="Làm mới cuộc trò chuyện"
              className="legal-chat-header-btn flex h-8 w-8 items-center justify-center rounded-full text-white cursor-pointer shadow-xs"
            >
              <RotateCcw className="h-4 w-4 text-white" />
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng khung chat"
                title="Đóng khung chat"
                className="legal-chat-header-btn flex h-8 w-8 items-center justify-center rounded-full text-white cursor-pointer shadow-xs"
              >
                <X className="h-4 w-4 text-white" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 2. Thanh trạng thái phụ (Sub-header) hiển thị nguồn dữ liệu */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4 py-2 text-xs sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
            Dữ liệu công khai
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-400">
            <CheckCircle2 size={13} className="text-amber-600" />
            Có trích dẫn nguồn
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hideHeader && (
            <button
              type="button"
              onClick={handleReset}
              aria-label="Làm mới cuộc hội thoại"
              title="Làm mới cuộc trò chuyện"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              <RotateCcw size={13} />
              <span>Làm mới hội thoại</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. Danh sách tin nhắn hội thoại với thanh cuộn mỏng tinh tế */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-[#fbfbfa] px-4 py-5 sm:px-6 dark:bg-[#0c1322] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/80 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700"
        aria-live="polite"
        aria-label="Nội dung hội thoại"
      >
        {messages.length === 0 && (
          <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center py-5 text-center sm:py-7">
            <div className="mx-auto flex items-center justify-center">
              <RobotAvatar size={116} state={loading ? "searching" : avatarState} />
            </div>
            {/* Bộ nút chuyển đổi xem thử 4 trạng thái hoạt ảnh của Avatar */}
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label="Trạng thái avatar">
              {AVATAR_STATE_OPTIONS.map((option) => {
                const active = (loading ? "searching" : avatarState) === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => triggerAvatarState(option.value)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      active
                        ? "border-[#2f4fd8] bg-[#2f4fd8] font-semibold text-white shadow-xs"
                        : "border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <h3 className="mt-4 text-lg font-bold tracking-tight text-slate-900 dark:text-white">Bạn cần tra cứu điều gì?</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              Đặt câu hỏi bằng tiếng Việt. Câu trả lời sẽ dẫn đến đoạn văn bản được truy xuất để bạn tự đối chiếu.
            </p>
            <div className="mt-5 flex w-full flex-col gap-2 text-left">
              {SUGGESTIONS.map(suggestion => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void sendQuestion(suggestion)}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 text-left text-xs leading-5 text-slate-700 shadow-xs transition-all hover:border-[#1d4f88]/50 hover:bg-blue-50/50 hover:text-[#1d4f88] hover:shadow-xs focus-visible:outline-2 focus-visible:outline-[#1d4f88] dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-200 dark:hover:border-blue-700 dark:hover:bg-slate-800"
                >
                  <span className="font-medium">{suggestion}</span>
                  <ArrowUpRight size={13} className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#1d4f88]" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => (
          <div key={message.id} className={message.role === "user" ? "flex flex-col items-end" : "flex items-start gap-3 sm:gap-3.5"}>
            {message.role === "bot" && (
              <div className="shrink-0 pt-0.5">
                <RobotAvatar
                  size={50}
                  state={message.id === latestBotMessageId ? avatarState : "idle"}
                />
              </div>
            )}
            <div
              className={`min-w-0 break-words rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 ${
                message.role === "user"
                  ? "max-w-[88%] rounded-tr-xs bg-[#1d4f88] text-sm leading-6 text-white shadow-xs sm:max-w-[75%]"
                  : `rounded-tl-xs border border-slate-200/80 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-800/95 ${fullScreen ? "flex-1" : "max-w-[88%] sm:max-w-[84%]"}`
              }`}
            >
              {message.role === "user" ? (
                <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>
              ) : (
                <>
                  {/* Thanh tiêu đề nhỏ trên bong bóng AI hiển thị nhãn trạng thái to, rõ ràng */}
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#142747] dark:text-white">
                        Trợ lý pháp luật AI
                      </span>
                      {message.id === latestBotMessageId && avatarState !== "idle" ? (
                        avatarState === "searching" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
                            Đang tra cứu
                          </span>
                        ) : avatarState === "talking" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                            Đang trả lời
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                            <CheckCircle2 size={12} className="text-emerald-700" />
                            Đã tìm thấy căn cứ
                          </span>
                        )
                      ) : (message.citations && message.citations.length > 0) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                          <CheckCircle2 size={11} className="text-emerald-600" />
                          Đã đối chiếu nguồn
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <AnswerText
                    text={message.text}
                    citations={message.citations ?? []}
                    onSelectCitation={(citation) => {
                      setActiveCitation({ messageId: message.id, citation });
                      setLatestBotMessageId(message.id);
                      triggerAvatarState("happy");
                    }}
                  />
                  <CitationViewer
                    citations={message.citations ?? []}
                    answerText={message.text}
                    selectedCitation={activeCitation?.messageId === message.id ? activeCitation.citation : null}
                    onSelectCitation={(citation) => {
                      setActiveCitation(citation ? { messageId: message.id, citation } : null);
                      if (citation) {
                        setLatestBotMessageId(message.id);
                        triggerAvatarState("happy");
                      }
                    }}
                  />
                </>
              )}
            </div>
            {message.role === "user" && message.createdAt && (
              <span className="mt-1 mr-1 text-[10px] text-slate-400 font-mono">{message.createdAt}</span>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-3 sm:gap-3.5" role="status" aria-label="Đang tra cứu câu trả lời">
            <div className="shrink-0 pt-0.5">
              <RobotAvatar size={50} state="searching" />
            </div>
            <div className="flex items-center gap-3 rounded-2xl rounded-tl-xs border border-blue-200/80 bg-white px-4 py-3 shadow-xs dark:border-slate-800 dark:bg-slate-800/95">
              <div className="flex items-center gap-1.5 py-1" aria-hidden="true">
                <span className="typing-dot-1 h-2.5 w-2.5 rounded-full bg-[#1d4f88] dark:bg-blue-400"></span>
                <span className="typing-dot-2 h-2.5 w-2.5 rounded-full bg-[#1d4f88] dark:bg-blue-400"></span>
                <span className="typing-dot-3 h-2.5 w-2.5 rounded-full bg-[#1d4f88] dark:bg-blue-400"></span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-[#1d4f88] dark:text-blue-300">
                  Đang quét và tra cứu văn bản pháp luật...
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Đang đối chiếu số hiệu Điều, Khoản và ngữ nghĩa văn bản
                </span>
              </div>
            </div>
          </div>
        )}
        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</div>}
      </div>

      {/* 4. Khung nhập câu hỏi và dòng cảnh báo pháp lý */}
      <form onSubmit={submit} className="shrink-0 border-t border-slate-100 bg-white p-3 sm:p-3.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2 transition-all focus-within:border-[#1d4f88] focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 dark:border-slate-700 dark:bg-slate-800/60 dark:focus-within:bg-slate-900">
          <textarea
            ref={textareaRef}
            aria-label="Câu hỏi pháp luật"
            value={question}
            onChange={event => { setQuestion(event.target.value); if (error) setError(""); }}
            onKeyDown={handleKeyDown}
            placeholder="Nhập câu hỏi pháp luật, ví dụ: điều kiện cấp sổ đỏ, thời gian thử việc..."
            rows={1}
            className="min-h-[2.5rem] max-h-24 w-full resize-none overflow-y-auto bg-transparent px-2.5 py-1 text-sm leading-5 text-slate-950 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500"
          />
          <div className="flex items-center justify-between gap-2 border-t border-slate-200/50 px-1 pt-1.5 dark:border-slate-700/50">
            <span className={`text-[11px] ${question.trim().length > 2000 ? "font-semibold text-rose-700" : "text-slate-400"}`}>{question.trim().length}/2000</span>
            <button
              type="submit"
              disabled={loading || !question.trim() || question.trim().length > 2000}
              className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full bg-[#1d4f88] px-3.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-[#163f6f] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={12} /> Gửi
            </button>
          </div>
        </div>
        {question.trim().length > 2000 && <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">Câu hỏi không được vượt quá 2000 ký tự.</p>}
        <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-slate-400">
          <Info size={11} className="shrink-0" />
          <span>Thông tin tham khảo, không thay thế tư vấn pháp lý chuyên môn.</span>
        </div>
      </form>
    </div>
  );
}
