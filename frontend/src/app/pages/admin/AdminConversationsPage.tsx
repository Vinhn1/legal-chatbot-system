import { useEffect, useState } from "react";
import axios from "axios";
import {
  CheckCircle2,
  Eye,
  Flag,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { API_BASE } from "../../../config";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";

interface ConversationItem {
  id: string;
  sessionId: string;
  query: string;
  answer: string;
  status: "need_review" | "reviewed" | "pending";
  flagReason?: string;
  timestamp: string;
  citationDoc: string;
  userType: "Khách công khai" | "Chuyên viên nội bộ";
}

/**
 * Màn hình Hội thoại & Rà soát (Canvas Section 11)
 * Kết nối dữ liệu hội thoại thực tế từ bảng chat_history trong PostgreSQL.
 */
export function AdminConversationsPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedConv, setSelectedConv] = useState<ConversationItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Lưu trạng thái đã duyệt vào bộ nhớ cục bộ
  const [reviewedSet, setReviewedSet] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("legal_reviewed_conv_ids");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const fetchConversations = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await axios.get(`${API_BASE}/chat/history`);
      const logs = response.data;
      if (Array.isArray(logs)) {
        // Gom nhóm theo cặp user - bot
        const items: ConversationItem[] = [];
        for (let i = 0; i < logs.length; i++) {
          const entry = logs[i];
          if (entry.role === "user") {
            // Tìm bot reply tương ứng trong cùng session
            const botReply = logs.find(
              (other: any, idx: number) =>
                idx < i && other.sessionId === entry.sessionId && other.role === "bot"
            ) || logs.find(
              (other: any) => other.sessionId === entry.sessionId && other.role === "bot"
            );

            const answerText = botReply?.message || "Đang xử lý câu trả lời...";
            const isRefusal = answerText.includes("Chưa tìm thấy căn cứ pháp lý");

            // Format timestamp
            let timeStr = "Gần đây";
            try {
              const d = new Date(entry.createdAt);
              const hh = String(d.getHours()).padStart(2, "0");
              const mm = String(d.getMinutes()).padStart(2, "0");
              const dd = String(d.getDate()).padStart(2, "0");
              const mo = String(d.getMonth() + 1).padStart(2, "0");
              const yy = d.getFullYear();
              timeStr = `${hh}:${mm} · ${dd}/${mo}/${yy}`;
            } catch {
              timeStr = "Vừa xong";
            }

            const idStr = String(entry.id);
            const isManuallyReviewed = reviewedSet.has(idStr);

            let status: "need_review" | "reviewed" | "pending" = "pending";
            if (isManuallyReviewed) {
              status = "reviewed";
            } else if (isRefusal) {
              status = "need_review";
            } else {
              status = "reviewed";
            }

            items.push({
              id: idStr,
              sessionId: entry.sessionId,
              query: entry.message,
              answer: answerText,
              status,
              flagReason: isRefusal
                ? "Không tìm thấy căn cứ pháp lý trong kho dữ liệu hiện có"
                : undefined,
              timestamp: timeStr,
              citationDoc: isRefusal ? "Chưa có trích dẫn" : "Kho quy phạm pháp luật",
              userType: "Khách công khai",
            });
          }
        }

        setConversations(items);
        if (items.length > 0) {
          setSelectedConv(items[0]);
        } else {
          setSelectedConv(null);
        }
      } else {
        setConversations([]);
        setSelectedConv(null);
      }
    } catch {
      setErrorMessage("Không thể tải lịch sử hội thoại từ máy chủ.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  const handleToggleReviewed = (id: string) => {
    setReviewedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem("legal_reviewed_conv_ids", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          const nextStatus = c.status === "reviewed" ? "need_review" : "reviewed";
          return { ...c, status: nextStatus };
        }
        return c;
      })
    );

    setSelectedConv((prev) => {
      if (!prev || prev.id !== id) return prev;
      return { ...prev, status: prev.status === "reviewed" ? "need_review" : "reviewed" };
    });
  };

  const selectedDocConv = conversations.find((c) => c.id === selectedConv?.id) || selectedConv;

  const filtered = conversations.filter(
    (c) =>
      c.query.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.answer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.citationDoc.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#d8dee5] pb-5">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a785d]">
            GIÁM SÁT HỎI ĐÁP
          </div>
          <h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747]">
            Lịch sử hội thoại & Rà soát
          </h1>
          <p className="mt-1 text-sm text-[#56677c]">
            Kiểm tra các câu trả lời do AI tạo ra từ PostgreSQL, phát hiện câu hỏi cần chuyên viên hiệu chỉnh nguồn.
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

      {/* Tìm kiếm */}
      <div className="flex items-center gap-2 rounded-xl border border-[#cbd5df] bg-white px-3.5 py-2.5 max-w-md shadow-2xs">
        <Search size={18} className="text-[#7c8b9d]" />
        <input
          type="text"
          placeholder="Tìm nội dung câu hỏi, câu trả lời..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-transparent text-sm font-semibold text-[#142747] outline-none"
        />
      </div>

      {/* Lỗi tải nếu có */}
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

      {/* Phần chính: Bảng danh sách hội thoại hiển thị toàn màn hình (Full-Width) */}
      <div className="w-full rounded-2xl border border-[#d3dbe4] bg-white shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-[#66778c]">
            <Loader2 size={32} className="mx-auto animate-spin text-[#1d4f88] mb-3" />
            <p className="text-sm font-semibold">Đang tải lịch sử hội thoại...</p>
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[#eef4f9] text-[#1d4f88] mb-4">
              <MessageSquare size={30} />
            </div>
            <h3 className="text-base font-bold text-[#142747]">Chưa có cuộc hội thoại nào</h3>
            <p className="mt-1 text-xs text-[#66778c] max-w-sm mx-auto">
              Hệ thống chưa ghi nhận lượt hỏi đáp nào. Khi người dùng đặt câu hỏi tra cứu, toàn bộ câu hỏi và phản hồi sẽ hiển thị tại đây.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-[#66778c]">
            <p className="text-xs font-semibold">Không tìm thấy cuộc hội thoại nào phù hợp từ khóa.</p>
          </div>
        ) : (
          <div className="overflow-x-auto board-scroll">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-[#e2e7ec] bg-[#f8f9fa] text-xs font-bold uppercase tracking-wider text-[#6a7b8e]">
                <tr>
                  <th className="py-3.5 px-5">Thời gian & Người hỏi</th>
                  <th className="py-3.5 px-5">Câu hỏi của người dùng</th>
                  <th className="py-3.5 px-4">Nguồn trích dẫn</th>
                  <th className="py-3.5 px-4">Trạng thái rà soát</th>
                  <th className="py-3.5 px-5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf1f4]">
                {filtered.map((conv) => {
                  const isSelected = selectedDocConv?.id === conv.id;
                  return (
                    <tr
                      key={conv.id}
                      onClick={() => {
                        setSelectedConv(conv);
                        setIsDetailOpen(true);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected && isDetailOpen ? "bg-[#f0f5fa]" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="py-4 px-5 whitespace-nowrap">
                        <div className="font-semibold text-[#142747]">{conv.timestamp}</div>
                        <div className="mt-0.5 text-xs text-[#718294] font-medium">{conv.userType}</div>
                      </td>

                      <td className="py-4 px-5">
                        <p className="font-bold text-[#142747] line-clamp-2 max-w-xl text-sm leading-snug">
                          {conv.query}
                        </p>
                      </td>

                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="text-xs font-medium text-[#516278]">{conv.citationDoc}</span>
                      </td>

                      <td className="py-4 px-4 whitespace-nowrap">
                        {conv.status === "need_review" && (
                          <span className="inline-flex rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-bold text-amber-800">
                            Cần rà soát
                          </span>
                        )}
                        {conv.status === "reviewed" && (
                          <span className="inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-800">
                            Đã kiểm duyệt
                          </span>
                        )}
                        {conv.status === "pending" && (
                          <span className="inline-flex rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                            Chờ xử lý
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-5 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedConv(conv);
                            setIsDetailOpen(true);
                          }}
                          title="Xem chi tiết hội thoại"
                          className="rounded-lg p-2 text-[#1d4f88] hover:bg-[#eef4f9] transition-colors"
                        >
                          <Eye size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleReviewed(conv.id);
                          }}
                          title={conv.status === "reviewed" ? "Hủy đánh dấu kiểm duyệt" : "Xác nhận kiểm duyệt"}
                          className={`rounded-lg p-2 transition-colors ml-1 ${
                            conv.status === "reviewed"
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

      {/* Slide-Over Drawer: Chi tiết hội thoại */}
      <Sheet open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl md:max-w-2xl p-0 flex flex-col gap-0 border-l border-[#d3dbe4] bg-white shadow-2xl"
        >
          {selectedDocConv ? (
            <div className="flex flex-col h-full">
              <SheetHeader className="p-5 sm:p-6 border-b border-[#eef1f4] bg-slate-50/70">
                <div className="flex items-center justify-between pr-7">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-[#8a785d]">
                    Chi tiết hội thoại
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#718294] font-semibold">
                      {selectedDocConv.timestamp}
                    </span>
                    <span className="rounded-md bg-[#eef4f9] px-2 py-0.5 text-xs font-bold text-[#1d4f88]">
                      {selectedDocConv.userType}
                    </span>
                  </div>
                </div>

                <SheetTitle className="font-editorial mt-2 text-2xl font-semibold text-[#142747] leading-snug">
                  Phiên hỏi đáp #{selectedDocConv.id}
                </SheetTitle>
                <SheetDescription className="mt-1 text-xs font-semibold text-[#66778c]">
                  Mã định danh phiên: {selectedDocConv.sessionId}
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto board-scroll p-5 sm:p-6 space-y-5">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#718294]">
                    Câu hỏi của người dùng
                  </span>
                  <p className="mt-1.5 text-base font-bold text-[#142747] p-4 rounded-xl bg-[#fafaf9] border border-[#e8ecef] leading-relaxed">
                    {selectedDocConv.query}
                  </p>
                </div>

                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#718294]">
                    Câu trả lời tạo bởi AI Core
                  </span>
                  <div className="mt-1.5 text-xs sm:text-sm text-[#334155] p-4 rounded-xl bg-white border border-[#cbd5df] whitespace-pre-wrap leading-relaxed shadow-2xs">
                    {selectedDocConv.answer}
                  </div>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs text-amber-900 space-y-1.5">
                  <div className="font-bold flex items-center gap-1.5 text-amber-950">
                    <Flag size={14} className="text-amber-700" />
                    Nguồn trích dẫn: {selectedDocConv.citationDoc}
                  </div>
                  {selectedDocConv.flagReason && (
                    <p className="text-amber-800 font-semibold">{selectedDocConv.flagReason}</p>
                  )}
                </div>
              </div>

              <div className="p-4 sm:p-5 border-t border-[#edf1f4] bg-white flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => handleToggleReviewed(selectedDocConv.id)}
                  className={`flex-1 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold transition-colors ${
                    selectedDocConv.status === "reviewed"
                      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300"
                      : "bg-[#1d4f88] text-white hover:bg-[#153b66]"
                  }`}
                >
                  <CheckCircle2 size={16} />
                  {selectedDocConv.status === "reviewed" ? "Đã kiểm duyệt (Bấm để hủy)" : "Xác nhận Đã kiểm duyệt"}
                </button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
