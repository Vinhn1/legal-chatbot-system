import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Flag,
  Loader2,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
} from "lucide-react";
import { API_BASE } from "../../../config";
import { AnswerText } from "../../components/LegalChat";
import { RobotAvatar } from "../../components/RobotAvatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";

/** Bản ghi tin nhắn đơn lẻ từ bảng chat_history trong PostgreSQL */
interface ChatMessageLog {
  id: number;
  sessionId: string;
  role: "user" | "bot";
  message: string;
  createdAt: string;
  reviewStatus?: "reviewed" | "need_review" | "pending";
  resultMeta?: {
    answer_status?: string;
    citation_count?: number;
    latency_ms?: number;
  };
}

/** Cấu trúc một phiên hội thoại hoàn chỉnh gồm chuỗi tin nhắn hỏi - đáp */
interface ConversationSession {
  sessionId: string;
  sessionCode: string;
  startedAt: string;
  lastActiveAt: string;
  messages: ChatMessageLog[];
  queryCount: number;
  firstQuery: string;
  lastQuery: string;
  status: "need_review" | "reviewed" | "pending";
  flagReasons: string[];
  citationDoc: string;
  userType: "Khách công khai" | "Chuyên viên nội bộ";
}

/** Định dạng chuỗi ngày giờ hiển thị thân thiện tiếng Việt */
function formatDateTime(dateStr?: string): string {
  if (!dateStr) return "Gần đây";
  try {
    const d = new Date(dateStr);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const yy = d.getFullYear();
    return `${hh}:${mm} · ${dd}/${mo}/${yy}`;
  } catch {
    return "Vừa xong";
  }
}

/**
 * Chuyển đổi danh sách tin nhắn phẳng từ cơ sở dữ liệu thành danh sách các phiên trò chuyện đa lượt.
 * Mỗi phiên chứa đầy đủ lịch sử các tin nhắn hỏi - đáp theo thứ tự thời gian.
 */
function groupLogsIntoSessions(
  logs: ChatMessageLog[]
): ConversationSession[] {
  const sessionMap = new Map<string, ChatMessageLog[]>();

  // Gom toàn bộ tin nhắn theo sessionId
  for (const entry of logs) {
    if (!entry.sessionId) continue;
    const existing = sessionMap.get(entry.sessionId) || [];
    existing.push(entry);
    sessionMap.set(entry.sessionId, existing);
  }

  const sessions: ConversationSession[] = [];

  sessionMap.forEach((msgs, sessionId) => {
    // Sắp xếp tin nhắn theo thời gian tăng dần; nếu cùng mili-giây giao dịch thì xếp theo ID tăng dần (user trước, bot sau)
    const sorted = [...msgs].sort((a, b) => {
      const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      if (a.id !== b.id) return a.id - b.id;
      if (a.role !== b.role) return a.role === "user" ? -1 : 1;
      return 0;
    });

    const userMsgs = sorted.filter((m) => m.role === "user");
    const botMsgs = sorted.filter((m) => m.role === "bot");

    const firstMsg = sorted[0];
    const lastMsg = sorted[sorted.length - 1];

    const firstQuery = userMsgs[0]?.message || "Lượt trao đổi không có tiêu đề";
    const lastQuery = userMsgs[userMsgs.length - 1]?.message || firstQuery;

    // Kiểm tra xem trong phiên có câu trả lời nào từ chối hoặc thiếu căn cứ pháp lý không
    const flagReasons: string[] = [];
    let hasRefusal = false;
    for (const b of botMsgs) {
      if (b.resultMeta?.answer_status === "refused" || b.resultMeta?.answer_status === "error") {
        hasRefusal = true;
        if (!flagReasons.includes("Chưa tìm thấy căn cứ pháp lý tương ứng trong kho dữ liệu")) {
          flagReasons.push("Chưa tìm thấy căn cứ pháp lý tương ứng trong kho dữ liệu");
        }
      }
    }

    // Đánh giá trạng thái rà soát: Nếu quản trị viên đã duyệt sessionId thì ưu tiên "reviewed"
    const isManuallyReviewed =
      sorted.some((m) => m.reviewStatus === "reviewed");

    let status: "need_review" | "reviewed" | "pending";
    if (isManuallyReviewed) {
      status = "reviewed";
    } else if (hasRefusal) {
      status = "need_review";
    } else {
      status = "pending";
    }

    // Tạo mã hiển thị ngắn gọn từ UUID phiên (lấy 8 ký tự đầu)
    const sessionCode = sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;

    sessions.push({
      sessionId,
      sessionCode,
      startedAt: formatDateTime(firstMsg?.createdAt),
      lastActiveAt: formatDateTime(lastMsg?.createdAt),
      messages: sorted,
      queryCount: userMsgs.length,
      firstQuery,
      lastQuery,
      status,
      flagReasons,
      citationDoc: hasRefusal ? "Chưa có trích dẫn" : "Kho quy phạm pháp luật",
      userType: "Khách công khai",
    });
  });

  // Sắp xếp các phiên theo thời gian tương tác gần nhất giảm dần (phiên mới nhất lên trước)
  sessions.sort((a, b) => {
    const timeA = a.messages[a.messages.length - 1]?.createdAt;
    const timeB = b.messages[b.messages.length - 1]?.createdAt;
    return new Date(timeB || 0).getTime() - new Date(timeA || 0).getTime();
  });

  return sessions;
}

/**
 * Màn hình Quản trị Lịch sử Hội thoại & Rà soát (Admin Conversations)
 * Hiển thị toàn bộ các phiên hội thoại đa lượt và chi tiết chuỗi tin nhắn đầy đủ.
 */
export function AdminConversationsPage() {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSession, setSelectedSession] = useState<ConversationSession | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Cursor theo ID tránh trùng/mất bản ghi khi có tin nhắn mới trong lúc chuyển trang.
  const [before, setBefore] = useState<number | undefined>();
  const [previous, setPrevious] = useState<Array<number | undefined>>([]);
  const [nextCursor, setNextCursor] = useState<number | undefined>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await axios.get(`${API_BASE}/chat/history`, { params: { before, limit: 100, from: from || undefined, to: to || undefined } });
      const logs = response.data;
      if (Array.isArray(logs)) {
        setNextCursor(logs.length === 100 ? Math.min(...logs.map((row: ChatMessageLog) => row.id)) : undefined);
        const grouped = groupLogsIntoSessions(logs);
        setSessions(grouped);
        if (grouped.length > 0) {
          // Giữ phiên đã chọn hoặc chọn phiên đầu tiên
          setSelectedSession((prev) => {
            if (!prev) return grouped[0];
            const updated = grouped.find((s) => s.sessionId === prev.sessionId);
            return updated || grouped[0];
          });
        } else {
          setSelectedSession(null);
        }
      } else {
        setSessions([]);
        setSelectedSession(null);
      }
    } catch {
      setErrorMessage("Không thể tải lịch sử hội thoại từ máy chủ.");
    } finally {
      setIsLoading(false);
    }
  }, [before, from, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchConversations(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchConversations]);

  /** Chỉ cập nhật giao diện sau khi server xác nhận lưu trạng thái. */
  const handleToggleReviewed = async (sessionId: string) => {
    if (reviewBusy) return;
    setReviewBusy(true);
    const status = sessions.find(row => row.sessionId === sessionId)?.status === "reviewed" ? "need_review" : "reviewed";
    try {
      await axios.post(`${API_BASE}/chat/history/${sessionId}/review`, { status });
      await fetchConversations();
    } catch { setErrorMessage("Không thể lưu trạng thái rà soát. Vui lòng thử lại."); }
    finally { setReviewBusy(false); }
  };

  // Lọc theo từ khóa tìm kiếm trên cả mã phiên, câu hỏi mở đầu và toàn bộ nội dung tin nhắn
  const filteredSessions = sessions.filter((s) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    if (s.sessionId.toLowerCase().includes(q)) return true;
    if (s.sessionCode.toLowerCase().includes(q)) return true;
    if (s.firstQuery.toLowerCase().includes(q)) return true;
    if (s.lastQuery.toLowerCase().includes(q)) return true;
    if (s.citationDoc.toLowerCase().includes(q)) return true;
    return s.messages.some((m) => m.message.toLowerCase().includes(q));
  });

  const activeSelected =
    sessions.find((s) => s.sessionId === selectedSession?.sessionId) || selectedSession;

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Khối tiêu đề đầu trang */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#d8dee5] pb-5">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a785d]">
            GIÁM SÁT HỎI ĐÁP
          </div>
          <h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747]">
            Lịch sử hội thoại & Rà soát
          </h1>
          <p className="mt-1 text-sm text-[#56677c]">
            Kiểm tra toàn bộ tiến trình các cuộc hội thoại đa lượt do AI tạo ra từ PostgreSQL, phát hiện câu hỏi cần chuyên viên hiệu chỉnh nguồn.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchConversations}
          disabled={isLoading}
          className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-4 text-sm font-bold text-[#142747] hover:bg-slate-50 transition-colors self-start sm:self-auto"
        >
          <RefreshCw size={16} className={isLoading ? "animate-spin text-[#1d4f88]" : ""} />
          Làm mới
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>Từ ngày<input type="date" aria-label="Từ ngày" value={from} onChange={event => { setFrom(event.target.value); setBefore(undefined); setPrevious([]); }} className="ml-2 rounded-lg border p-2" /></label>
        <label>Đến ngày<input type="date" aria-label="Đến ngày" value={to} onChange={event => { setTo(event.target.value); setBefore(undefined); setPrevious([]); }} className="ml-2 rounded-lg border p-2" /></label>
        <button disabled={isLoading || previous.length === 0} onClick={() => { setBefore(previous[previous.length - 1]); setPrevious(previous.slice(0, -1)); }} className="rounded-lg border px-3 py-2 disabled:opacity-50">Trang trước</button>
        <button disabled={isLoading || !nextCursor} onClick={() => { setPrevious([...previous, before]); setBefore(nextCursor); }} className="rounded-lg border px-3 py-2 disabled:opacity-50">Trang tiếp</button>
      </div>
      <p className="text-xs text-[#66778c]">Mỗi trang tối đa 100 tin nhắn; nội dung phiên và tìm kiếm dưới đây giới hạn trong trang đang xem. Trạng thái rà soát được lưu trên máy chủ.</p>
      {/* Thanh tìm kiếm trong trang hiện tại. */}
      <div className="flex items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-3.5 py-2.5 max-w-md shadow-2xs">
        <Search size={18} className="text-[#7c8b9d]" />
        <input
          type="text"
          placeholder="Tìm nội dung câu hỏi, câu trả lời, mã phiên..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-transparent text-sm font-semibold text-[#142747] outline-none"
        />
      </div>

      {/* Thông báo lỗi nếu có */}
      {errorMessage && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-xs font-semibold text-rose-800 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={fetchConversations}
            className="underline font-bold text-rose-900 ml-4 hover:opacity-80"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Bảng danh sách các phiên hội thoại hoàn chỉnh */}
      <div className="w-full rounded-2xl border border-[#d3dbe4] bg-white shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-[#66778c]">
            <Loader2 size={32} className="mx-auto animate-spin text-[#1d4f88] mb-3" />
            <p className="text-sm font-semibold">Đang tải lịch sử hội thoại...</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#eef4f9] text-[#1d4f88] mb-4">
              <MessageSquare size={30} />
            </div>
            <h3 className="text-base font-bold text-[#142747]">Chưa có cuộc hội thoại nào</h3>
            <p className="mt-1 text-xs text-[#66778c] max-w-sm mx-auto">
              Hệ thống chưa ghi nhận lượt hỏi đáp nào. Khi người dùng đặt câu hỏi tra cứu, toàn bộ câu hỏi và phản hồi sẽ hiển thị tại đây.
            </p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-12 text-center text-[#66778c]">
            <p className="text-xs font-semibold">Không tìm thấy cuộc hội thoại nào phù hợp từ khóa.</p>
          </div>
        ) : (
          <div className="overflow-x-auto board-scroll">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-[#e2e7ec] bg-[#f8f9fa] text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">
                <tr>
                  <th className="py-3.5 px-5">Thời gian & Phiên</th>
                  <th className="py-3.5 px-5">Nội dung cuộc hội thoại</th>
                  <th className="py-3.5 px-4">Quy mô trao đổi</th>
                  <th className="py-3.5 px-4">Nguồn trích dẫn</th>
                  <th className="py-3.5 px-4">Trạng thái rà soát</th>
                  <th className="py-3.5 px-5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf1f4]">
                {filteredSessions.map((session) => {
                  const isSelected = activeSelected?.sessionId === session.sessionId;
                  return (
                    <tr
                      key={session.sessionId}
                      onClick={() => {
                        setSelectedSession(session);
                        setIsDetailOpen(true);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected && isDetailOpen
                          ? "bg-[#1c222b] text-white dark:bg-zinc-800"
                          : "hover:bg-slate-100/70 dark:hover:bg-zinc-900/80"
                      }`}
                    >
                      {/* Cột 1: Thời gian & Định danh phiên */}
                      <td className="py-4 px-5 whitespace-nowrap">
                        <div className="font-semibold text-[#142747]">{session.lastActiveAt}</div>
                        <div className="mt-0.5 text-xs text-[#718294] font-medium flex items-center gap-1.5">
                          <span>{session.userType}</span>
                          <span>•</span>
                          <span className="font-mono text-[#8a785d]">#{session.sessionCode}</span>
                        </div>
                      </td>

                      {/* Cột 2: Nội dung mở đầu và tóm tắt */}
                      <td className="py-4 px-5">
                        <p className="font-bold text-[#142747] line-clamp-2 max-w-xl text-sm leading-snug">
                          {session.firstQuery}
                        </p>
                        {session.queryCount > 1 && (
                          <p className="mt-1 text-xs text-[#64748b] line-clamp-1 italic">
                            Gần nhất: {session.lastQuery}
                          </p>
                        )}
                      </td>

                      {/* Cột 3: Quy mô trao đổi trong phiên */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-[#f1f5f9] px-2.5 py-1 text-xs font-semibold text-[#334155]">
                          <MessagesSquare size={13} className="text-[#1d4f88]" />
                          {session.queryCount} câu hỏi ({session.messages.length} tin)
                        </span>
                      </td>

                      {/* Cột 4: Nguồn trích dẫn */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="text-xs font-medium text-[#516278]">{session.citationDoc}</span>
                      </td>

                      {/* Cột 5: Trạng thái rà soát */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {session.status === "need_review" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold text-amber-800">
                            <AlertTriangle size={12} className="text-amber-700" />
                            Cần rà soát
                          </span>
                        )}
                        {session.status === "reviewed" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-800">
                            <CheckCircle2 size={12} className="text-emerald-700" />
                            Đã kiểm duyệt
                          </span>
                        )}
                        {session.status === "pending" && (
                          <span className="inline-flex rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                            Chờ xử lý
                          </span>
                        )}
                      </td>

                      {/* Cột 6: Thao tác */}
                      <td className="py-4 px-5 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSession(session);
                            setIsDetailOpen(true);
                          }}
                          title="Xem toàn bộ lịch sử đoạn chat"
                          className="rounded-lg p-2 text-[#1d4f88] hover:bg-[#eef4f9] transition-colors"
                        >
                          <Eye size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleReviewed(session.sessionId);
                          }}
                          title={session.status === "reviewed" ? "Hủy đánh dấu kiểm duyệt phiên" : "Xác nhận kiểm duyệt toàn phiên"}
                          className={`rounded-lg p-2 transition-colors ml-1 ${
                            session.status === "reviewed"
                              ? "text-emerald-700 hover:bg-emerald-50"
                              : "text-[#718294] hover:bg-slate-100"
                          }`}
                        >
                          <CheckCircle2 size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ngăn kéo Slide-Over: Xem Toàn bộ Lịch sử Cuộc hội thoại trong Khung Chat tràn viền */}
      <Sheet open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl lg:max-w-3xl p-0 flex flex-col gap-0 border-l border-[#d3dbe4] bg-white shadow-2xl"
        >
          {activeSelected ? (
            <div className="flex flex-col h-full min-h-0 w-full">
              {/* 1. Header gộp gọn gàng tràn viền trên cùng */}
              <SheetHeader className="px-4 py-3 sm:px-5 border-b border-[#e2e8f0] bg-white shrink-0 space-y-0 gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2 pr-7">
                  <div className="flex items-center gap-2">
                    <SheetTitle className="font-editorial text-lg sm:text-xl font-semibold text-[#142747] leading-snug">
                      Phiên hội thoại #{activeSelected.sessionCode}
                    </SheetTitle>
                    <span className="rounded-md bg-[#eef4f9] px-2 py-0.5 text-[11px] font-bold text-[#1d4f88]">
                      {activeSelected.userType}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeSelected.status === "need_review" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                        <AlertTriangle size={11} className="text-amber-700" />
                        Cần rà soát
                      </span>
                    )}
                    {activeSelected.status === "reviewed" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                        <CheckCircle2 size={11} className="text-emerald-700" />
                        Đã kiểm duyệt
                      </span>
                    )}
                    {activeSelected.status === "pending" && (
                      <span className="inline-flex rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                        Chờ xử lý
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#66778c]">
                  <SheetDescription className="text-[11px] font-mono text-[#66778c] break-all m-0">
                    ID: {activeSelected.sessionId}
                  </SheetDescription>
                  <span>
                    Bắt đầu: <strong className="text-[#142747]">{activeSelected.startedAt}</strong>
                  </span>
                </div>
              </SheetHeader>

              {/* 2. Khung Chat tràn hết 100% không gian còn lại (Full-bleed Chat Frame) */}
              <div className="flex min-h-0 flex-1 w-full flex-col overflow-hidden bg-white">
                {/* Thanh tiêu đề Khung Chat màu Xanh Navy Hoàng gia tràn viền */}
                <div className="flex shrink-0 items-center justify-between gap-3 bg-gradient-to-r from-[#142e54] via-[#1a3c6d] to-[#1d4f88] px-4 py-2.5 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10 p-0.5 border border-white/20 shadow-xs">
                      <RobotAvatar size={38} state="idle" />
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-[#142e54] bg-emerald-400"></span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-bold text-white tracking-tight leading-snug">
                        Trợ lý pháp luật AI
                      </div>
                      <div className="truncate text-[11px] text-blue-100/80 leading-tight">
                        Lưu trữ PostgreSQL · {activeSelected.citationDoc}
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white border border-white/15">
                    <MessagesSquare size={12} />
                    {activeSelected.queryCount} lượt hỏi ({activeSelected.messages.length} tin)
                  </span>
                </div>

                {/* Vùng cuộn tin nhắn hội thoại chiếm trọn 100% chiều rộng & chiều cao còn trống */}
                <div
                  className="min-h-0 flex-1 w-full overflow-y-auto board-scroll bg-[#f1f5f9] px-3.5 py-4 sm:px-5 sm:py-5 space-y-4"
                  aria-label="Nội dung khung chat lịch sử"
                >
                  {activeSelected.messages.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[#718294]">
                      Phiên hội thoại này chưa có tin nhắn nào được ghi nhận.
                    </div>
                  ) : (
                    activeSelected.messages.map((msg, index) => {
                      const isUser = msg.role === "user";
                      const isRefusal = !isUser && msg.resultMeta?.answer_status === "refused";
                      const turnNumber =
                        activeSelected.messages
                          .slice(0, index + 1)
                          .filter((m) => m.role === "user").length || 1;

                      return (
                        <div key={msg.id || index} className="space-y-3">
                          {/* Nhãn phân tách lượt hỏi khi bắt đầu câu hỏi mới của người dùng */}
                          {isUser && (
                            <div className="flex items-center justify-center pt-1">
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/95 px-3 py-0.5 text-[11px] font-semibold text-slate-500 shadow-2xs">
                                <span>Lượt hỏi #{turnNumber}</span>
                                <span>•</span>
                                <Clock size={10} />
                                <span>{formatDateTime(msg.createdAt)}</span>
                              </span>
                            </div>
                          )}

                          {isUser ? (
                            /* Bong bóng câu hỏi của Người dùng (Căn phải - Màu Xanh Navy) */
                            <div className="flex flex-col items-end">
                              <div className="mb-1 mr-10 flex items-center gap-1.5 text-[11px] font-bold text-[#1d4f88]">
                                <span>Người dùng tra cứu</span>
                              </div>
                              <div className="flex w-full items-end justify-end gap-2">
                                <div className="min-w-0 max-w-[88%] sm:max-w-[82%] rounded-2xl rounded-tr-xs bg-[#1d4f88] px-4 py-3 text-sm font-medium leading-relaxed text-white shadow-sm break-words">
                                  <p className="whitespace-pre-wrap">{msg.message}</p>
                                </div>
                                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#b9d0ea] bg-[#e6effa] text-[#1d4f88] shadow-2xs">
                                  <User size={15} />
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* Bong bóng câu trả lời của Trợ lý AI (Căn trái - Mở rộng hết chiều ngang khung chat) */
                            <div className="flex w-full items-start gap-3 sm:gap-3.5">
                              <div className="shrink-0 pt-0.5">
                                <RobotAvatar size={48} state={isRefusal ? "idle" : "happy"} />
                              </div>
                              <div className="min-w-0 flex-1 rounded-2xl rounded-tl-xs border border-slate-200/95 bg-white px-4 py-3.5 sm:px-5 sm:py-4 shadow-sm">
                                {/* Dòng tiêu đề phụ trên đầu bong bóng AI */}
                                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-[#142747]">
                                      Trợ lý pháp luật AI
                                    </span>
                                    {isRefusal ? (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                        Thiếu căn cứ
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                        <ShieldCheck size={11} className="text-emerald-700" />
                                        Đã trích dẫn nguồn
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] font-normal text-slate-400 flex items-center gap-1">
                                    <Clock size={11} />
                                    {formatDateTime(msg.createdAt)}
                                  </span>
                                </div>

                                {/* Nội dung Markdown đã format tiêu đề, danh sách và thẻ trích dẫn [Điều X] / [CD-01] */}
                                <AnswerText text={msg.message} />

                                {/* Chân bong bóng AI: Cảnh báo hoặc thông tin trích dẫn */}
                                {isRefusal ? (
                                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-xs text-amber-900">
                                    <AlertTriangle size={15} className="text-amber-700 shrink-0 mt-0.5" />
                                    <div>
                                      <div className="font-bold text-amber-950">
                                        Chưa tìm thấy căn cứ pháp lý trong kho dữ liệu
                                      </div>
                                      <div className="text-amber-800 mt-0.5 font-medium">
                                        Câu trả lời này cần chuyên viên pháp chế hiệu chỉnh nguồn hoặc bổ sung văn bản quy phạm liên quan.
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px] font-medium text-slate-500">
                                    <span className="inline-flex items-center gap-1.5">
                                      <Flag size={11} className="text-[#8a785d]" />
                                      Nguồn đối chiếu: Kho quy phạm pháp luật
                                    </span>
                                    <div className="flex items-center gap-2 text-slate-400">
                                      {typeof msg.resultMeta?.citation_count === "number" &&
                                        msg.resultMeta.citation_count > 0 && (
                                          <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                                            {msg.resultMeta.citation_count} căn cứ xác thực
                                          </span>
                                        )}
                                      {typeof msg.resultMeta?.latency_ms === "number" && (
                                        <span>{(msg.resultMeta.latency_ms / 1000).toFixed(1)}s</span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* 3. Chân Drawer gọn gàng sát đáy */}
              <div className="px-4 py-3 sm:px-5 border-t border-[#e2e8f0] bg-white flex items-center justify-between gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => handleToggleReviewed(activeSelected.sessionId)}
                  className={`flex-1 inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs sm:text-sm font-bold transition-colors ${
                    activeSelected.status === "reviewed"
                      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300"
                      : "bg-[#1d4f88] text-white hover:bg-[#153b66]"
                  }`}
                >
                  <CheckCircle2 size={16} />
                  {activeSelected.status === "reviewed"
                    ? "Đã duyệt toàn phiên — Nhấp để hoàn tác"
                    : "Xác nhận duyệt toàn phiên"}
                </button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
