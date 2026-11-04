import { useEffect, useState } from "react";
import axios from "axios";
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  Cpu,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Loader2,
  Save,
  Server,
  ShieldCheck,
  Sliders,
  Sparkles,
} from "lucide-react";
import { API_BASE } from "../../../config";
import { useAuth } from "../../context/AuthContext";

type Provider = "gemini" | "openai" | "anthropic" | "local";
type SettingsTab = "chat_model" | "embedding" | "rag_params";
type Ping = { ok: boolean; latency_ms: number };

interface ProviderOption {
  id: Provider;
  name: string;
  badge: string;
  description: string;
  icon: typeof Sparkles;
  recommended?: boolean;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    badge: "Mặc định hệ thống",
    description: "Gemini 2.5 Flash / Pro. Tốc độ cao, tối ưu đối chiếu tiếng Việt và trích dẫn điều khoản.",
    icon: Sparkles,
    recommended: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    badge: "GPT-4o / mini",
    description: "Khả năng suy luận cấu trúc văn bản pháp lý chặt chẽ và nhất quán.",
    icon: Cpu,
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    badge: "Claude 3.5 Sonnet",
    description: "Ưu tiên độ an toàn cao, từ chối võ đoán khi thiếu căn cứ pháp lý minh bạch.",
    icon: ShieldCheck,
  },
  {
    id: "local",
    name: "Mô hình AI nội bộ",
    badge: "On-Premise / vLLM",
    description: "Tự triển khai máy chủ riêng biệt, dữ liệu lưu hành an toàn trong mạng nội bộ.",
    icon: Server,
  },
];

/**
 * Màn hình Cài đặt AI & Quản lý Khóa API.
 * Hỗ trợ chuyển đổi nhà cung cấp trực quan, bảo mật mã hóa và tối ưu giao diện Dark Mode.
 */
export function AdminSettingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>("chat_model");

  // RAG Configuration state
  const [rag, setRag] = useState({
    system_prompt: "",
    temperature: 0,
    top_p: 0.9,
    max_tokens: 1024,
  });

  // Model & Key state
  const [provider, setProvider] = useState<Provider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [masked, setMasked] = useState("");
  const [visible, setVisible] = useState(false);

  // Embedding Key state
  const [embeddingKey, setEmbeddingKey] = useState("");
  const [maskedEmbedding, setMaskedEmbedding] = useState("");
  const [visibleEmbedding, setVisibleEmbedding] = useState(false);

  // Status state
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ping, setPing] = useState<Ping | null>(null);
  const [testingEmbedding, setTestingEmbedding] = useState(false);
  const [pingEmbedding, setPingEmbedding] = useState<Ping | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.role !== "admin") return;
    let active = true;
    Promise.all([
      axios.get(`${API_BASE}/chat/config`),
      axios.get(`${API_BASE}/chat/model-config`),
    ])
      .then(([ragResult, modelResult]) => {
        if (!active) return;
        setRag(ragResult.data);
        setProvider(modelResult.data.provider || "gemini");
        setMasked(modelResult.data.masked_api_key || "");
        setMaskedEmbedding(modelResult.data.masked_embedding_key || "");
      })
      .catch(() => {
        if (active) setError("Không thể tải cấu hình. Vui lòng kiểm tra kết nối máy chủ.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.role]);

  const save = async () => {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (
        !Number.isFinite(rag.temperature) ||
        rag.temperature < 0 ||
        rag.temperature > 1 ||
        !Number.isFinite(rag.top_p) ||
        rag.top_p < 0 ||
        rag.top_p > 1 ||
        !Number.isInteger(rag.max_tokens) ||
        rag.max_tokens < 256 ||
        rag.max_tokens > 4096
      ) {
        setError("Tham số mô hình nằm ngoài khoảng cho phép.");
        return;
      }

      await axios.post(`${API_BASE}/chat/config`, rag);
      const payload: Record<string, string> = { provider };
      if (apiKey) payload.api_key = apiKey;
      if (embeddingKey) payload.embedding_api_key = embeddingKey;

      const response = await axios.post(`${API_BASE}/chat/model-config`, payload);
      setMasked(response.data.masked_api_key || "");
      setMaskedEmbedding(response.data.masked_embedding_key || "");
      setApiKey("");
      setVisible(false);
      setEmbeddingKey("");
      setVisibleEmbedding(false);
      setMessage("Đã lưu và đồng bộ cấu hình thành công sang hệ thống.");
    } catch {
      setError("Không thể lưu cấu hình. Kiểm tra quyền truy cập và dịch vụ máy chủ.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setError("");
    setPing(null);
    setTesting(true);
    try {
      const response = await axios.post(`${API_BASE}/chat/model-test`, {
        provider,
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      setPing(response.data);
    } catch {
      setError("Không thể kiểm tra kết nối mô hình. Vui lòng thử lại.");
    } finally {
      setTesting(false);
    }
  };

  const testEmbedding = async () => {
    setError("");
    setPingEmbedding(null);
    setTestingEmbedding(true);
    try {
      const response = await axios.post(`${API_BASE}/chat/embedding-test`, {
        ...(embeddingKey ? { api_key: embeddingKey } : {}),
      });
      setPingEmbedding(response.data);
    } catch {
      setError("Không thể kiểm tra kết nối embedding. Vui lòng thử lại.");
    } finally {
      setTestingEmbedding(false);
    }
  };

  if (user?.role !== "admin") {
    return (
      <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-6 text-rose-800 dark:text-rose-200">
        Chỉ quản trị viên toàn quyền mới có quyền truy cập và thay đổi cấu hình AI hệ thống.
      </div>
    );
  }

  if (loading) {
    return (
      <div role="status" className="flex items-center gap-3 p-10 text-sm font-semibold text-[#56677c] dark:text-zinc-400">
        <Loader2 size={20} className="animate-spin text-[#1d4f88] dark:text-sky-400" />
        Đang tải thông tin cấu hình mô hình...
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-8 animate-fade-in-up">
      {/* Tiêu đề trang */}
      <header className="border-b border-[#d8dee5] dark:border-zinc-800 pb-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#8a785d] dark:text-amber-400">
          HỆ THỐNG QUẢN TRỊ VERITAS DOCAI
        </p>
        <h1 className="font-editorial mt-1 text-3xl sm:text-4xl font-semibold text-[#142747] dark:text-zinc-100">
          Cài đặt Trí tuệ Nhân tạo & Mô hình
        </h1>
        <p className="mt-1 text-sm sm:text-base text-[#56677c] dark:text-zinc-400">
          Chủ động điều phối nhà cung cấp LLM, khóa API mã hóa và các tham số sinh văn bản trích dẫn.
        </p>
      </header>

      {/* Thông báo kết quả */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-rose-200 dark:border-rose-900/70 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm font-semibold text-rose-800 dark:text-rose-200"
        >
          <AlertCircle size={18} className="shrink-0 text-rose-600 dark:text-rose-400" />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-2xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm font-semibold text-emerald-800 dark:text-emerald-200"
        >
          <CheckCircle2 size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{message}</span>
        </div>
      )}

      {/* Segmented Control - Nút Toggle chuyển đổi nhóm cấu hình */}
      <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setActiveTab("chat_model")}
          className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
            activeTab === "chat_model"
              ? "bg-white dark:bg-zinc-800 text-[#142747] dark:text-zinc-100 shadow-sm border border-slate-200 dark:border-zinc-700"
              : "text-[#56677c] dark:text-zinc-400 hover:text-[#142747] dark:hover:text-zinc-200 hover:bg-white/50 dark:hover:bg-zinc-800/50"
          }`}
        >
          <Sparkles size={16} className={activeTab === "chat_model" ? "text-[#1d4f88] dark:text-sky-400" : ""} />
          Mô hình Trả lời (Chat LLM)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("embedding")}
          className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
            activeTab === "embedding"
              ? "bg-white dark:bg-zinc-800 text-[#142747] dark:text-zinc-100 shadow-sm border border-slate-200 dark:border-zinc-700"
              : "text-[#56677c] dark:text-zinc-400 hover:text-[#142747] dark:hover:text-zinc-200 hover:bg-white/50 dark:hover:bg-zinc-800/50"
          }`}
        >
          <Database size={16} className={activeTab === "embedding" ? "text-[#1d4f88] dark:text-sky-400" : ""} />
          Nạp tài liệu (Vector Embedding)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("rag_params")}
          className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
            activeTab === "rag_params"
              ? "bg-white dark:bg-zinc-800 text-[#142747] dark:text-zinc-100 shadow-sm border border-slate-200 dark:border-zinc-700"
              : "text-[#56677c] dark:text-zinc-400 hover:text-[#142747] dark:hover:text-zinc-200 hover:bg-white/50 dark:hover:bg-zinc-800/50"
          }`}
        >
          <Sliders size={16} className={activeTab === "rag_params" ? "text-[#1d4f88] dark:text-sky-400" : ""} />
          Tham số RAG (Prompt & Tuning)
        </button>
      </div>

      {/* TAB 1: MÔ HÌNH TRẢ LỜI (CHAT LLM) */}
      {activeTab === "chat_model" && (
        <section className="space-y-6 rounded-3xl border border-[#d3dbe4] dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-sm">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-[#1d4f88] dark:text-sky-400">
                <Sparkles size={18} />
              </span>
              <div>
                <h2 className="text-xl font-bold text-[#142747] dark:text-zinc-100">
                  Lựa chọn Nhà cung cấp Mô hình Trả lời
                </h2>
                <p className="mt-0.5 text-xs sm:text-sm text-[#718294] dark:text-zinc-400">
                  Chọn nhà cung cấp dịch vụ LLM chịu trách nhiệm tổng hợp câu trả lời từ tài liệu pháp lý đã truy xuất.
                </p>
              </div>
            </div>
          </div>

          {/* Form Toggle Lựa chọn Provider dạng Thẻ Trực quan (Segmented Radio Cards) */}
          <div className="grid gap-3.5 sm:grid-cols-2">
            {PROVIDERS.map((item) => {
              const isSelected = provider === item.id;
              const IconComp = item.icon;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setProvider(item.id);
                    setPing(null);
                  }}
                  className={`relative flex cursor-pointer flex-col justify-between rounded-2xl border p-4 sm:p-5 transition-all select-none ${
                    isSelected
                      ? "border-[#1d4f88] dark:border-sky-500 bg-blue-50/40 dark:bg-sky-950/30 shadow-sm ring-2 ring-[#1d4f88]/20 dark:ring-sky-500/20"
                      : "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-slate-50/50 dark:hover:bg-zinc-800/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                          isSelected
                            ? "bg-[#1d4f88] text-white dark:bg-sky-500"
                            : "bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300"
                        }`}
                      >
                        <IconComp size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-sm sm:text-base text-[#142747] dark:text-zinc-100">
                            {item.name}
                          </h3>
                        </div>
                        <span className="text-[11px] font-semibold text-[#8a785d] dark:text-amber-400">
                          {item.badge}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all ${
                        isSelected
                          ? "border-[#1d4f88] dark:border-sky-500 bg-[#1d4f88] dark:bg-sky-500 text-white"
                          : "border-slate-300 dark:border-zinc-700 bg-transparent"
                      }`}
                    >
                      {isSelected && <Check size={12} strokeWidth={3} />}
                    </div>
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-[#56677c] dark:text-zinc-400">
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Khối Cấu hình Khóa API của Mô hình */}
          <div className="space-y-4 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-800/40 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <label htmlFor="model-api-key" className="text-sm font-bold text-[#142747] dark:text-zinc-100">
                  Khóa API ({PROVIDERS.find((p) => p.id === provider)?.name})
                </label>
                <p className="text-xs text-[#718294] dark:text-zinc-400 mt-0.5">
                  Khóa được mã hóa an toàn ở tầng máy chủ, không hiển thị lại toàn văn trên giao diện.
                </p>
              </div>

              {masked ? (
                <div className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span>Đã kích hoạt: {masked}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <AlertCircle size={13} className="shrink-0" />
                  <span>Chưa cấu hình khóa</span>
                </div>
              )}
            </div>

            <div className="relative flex items-center">
              <span className="absolute left-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none">
                <KeyRound size={17} />
              </span>
              <input
                id="model-api-key"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setPing(null);
                }}
                placeholder={masked ? "Nhập khóa mới nếu muốn thay đổi..." : "Nhập mã khóa API..."}
                className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-10 pr-12 py-2.5 text-sm text-[#142747] dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-[#1d4f88] dark:focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-[#1d4f88]/20 dark:focus:ring-sky-500/20"
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                aria-label={visible ? "Ẩn khóa" : "Hiện khóa"}
                className="absolute right-2.5 p-1.5 text-slate-400 dark:text-zinc-500 hover:text-[#142747] dark:hover:text-zinc-200 transition-colors"
              >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={test}
                disabled={testing || busy}
                className="inline-flex items-center gap-2 rounded-xl border border-[#1d4f88] dark:border-sky-600 bg-white dark:bg-zinc-900 px-4 py-2 text-xs sm:text-sm font-bold text-[#1d4f88] dark:text-sky-400 hover:bg-blue-50/60 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                {testing ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Đang kiểm tra...
                  </>
                ) : (
                  <>
                    <Activity size={15} /> Kiểm tra kết nối mô hình
                  </>
                )}
              </button>

              {ping && (
                <div
                  role="status"
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs sm:text-sm font-semibold ${
                    ping.ok
                      ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
                      : "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300"
                  }`}
                >
                  {ping.ok ? (
                    <>
                      <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />
                      <span>Kết nối máy chủ LLM thành công · Độ trễ: {ping.latency_ms} ms</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={15} className="text-rose-600 dark:text-rose-400" />
                      <span>Khóa API không hợp lệ hoặc máy chủ LLM từ chối kết nối</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TAB 2: NẠP TÀI LIỆU (VECTOR EMBEDDING) */}
      {activeTab === "embedding" && (
        <section className="space-y-6 rounded-3xl border border-[#d3dbe4] dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-sm">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/60 text-[#8a785d] dark:text-amber-400">
                <Database size={18} />
              </span>
              <div>
                <h2 className="text-xl font-bold text-[#142747] dark:text-zinc-100">
                  Cấu hình Khóa API Nạp tài liệu (Vector Embedding)
                </h2>
                <p className="mt-0.5 text-xs sm:text-sm text-[#718294] dark:text-zinc-400">
                  Khóa chuyên dụng dùng để nhúng không gian vector khi tải lên tệp PDF, DOCX hoặc văn bản quy phạm.
                </p>
              </div>
            </div>
          </div>

          {/* Thẻ tóm tắt thông số kỹ thuật Vector Embedding */}
          <div className="grid gap-3.5 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-800/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#8a785d] dark:text-amber-400">
                Mô hình nhúng
              </p>
              <p className="mt-1 font-bold text-[#142747] dark:text-zinc-100">
                text-embedding-004
              </p>
              <p className="mt-1 text-xs text-[#56677c] dark:text-zinc-400">
                Google GenAI Embedding Engine
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-800/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#8a785d] dark:text-amber-400">
                Kích thước không gian
              </p>
              <p className="mt-1 font-bold text-[#142747] dark:text-zinc-100">
                768 chiều (Dimensions)
              </p>
              <p className="mt-1 text-xs text-[#56677c] dark:text-zinc-400">
                Khoảng cách Cosine Similarity
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-800/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#8a785d] dark:text-amber-400">
                Cơ sở dữ liệu Vector
              </p>
              <p className="mt-1 font-bold text-[#142747] dark:text-zinc-100">
                ChromaDB Persistence
              </p>
              <p className="mt-1 text-xs text-[#56677c] dark:text-zinc-400">
                Collection: legal_documents
              </p>
            </div>
          </div>

          {/* Form nhập khóa API Vector Embedding */}
          <div className="space-y-4 rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-800/40 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <label htmlFor="embedding-api-key" className="text-sm font-bold text-[#142747] dark:text-zinc-100">
                  Khóa API Embedding
                </label>
                <p className="text-xs text-[#718294] dark:text-zinc-400 mt-0.5">
                  Tự động đồng bộ sang bộ nhớ vận hành mà không cần chỉnh sửa tệp cấu hình máy chủ.
                </p>
              </div>

              {maskedEmbedding ? (
                <div className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span>Đã kích hoạt: {maskedEmbedding}</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-amber-200 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  <AlertCircle size={13} className="shrink-0" />
                  <span>Chưa cấu hình khóa</span>
                </div>
              )}
            </div>

            <div className="relative flex items-center">
              <span className="absolute left-3.5 text-slate-400 dark:text-zinc-500 pointer-events-none">
                <Layers size={17} />
              </span>
              <input
                id="embedding-api-key"
                type={visibleEmbedding ? "text" : "password"}
                autoComplete="new-password"
                value={embeddingKey}
                onChange={(event) => {
                  setEmbeddingKey(event.target.value);
                  setPingEmbedding(null);
                }}
                placeholder={maskedEmbedding ? "Nhập khóa mới nếu muốn thay đổi..." : "Nhập mã khóa API Embedding..."}
                className="w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-10 pr-12 py-2.5 text-sm text-[#142747] dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-[#1d4f88] dark:focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-[#1d4f88]/20 dark:focus:ring-sky-500/20"
              />
              <button
                type="button"
                onClick={() => setVisibleEmbedding(!visibleEmbedding)}
                aria-label={visibleEmbedding ? "Ẩn khóa" : "Hiện khóa"}
                className="absolute right-2.5 p-1.5 text-slate-400 dark:text-zinc-500 hover:text-[#142747] dark:hover:text-zinc-200 transition-colors"
              >
                {visibleEmbedding ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={testEmbedding}
                disabled={testingEmbedding || busy}
                className="inline-flex items-center gap-2 rounded-xl border border-[#1d4f88] dark:border-sky-600 bg-white dark:bg-zinc-900 px-4 py-2 text-xs sm:text-sm font-bold text-[#1d4f88] dark:text-sky-400 hover:bg-blue-50/60 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                {testingEmbedding ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Đang kiểm tra...
                  </>
                ) : (
                  <>
                    <Activity size={15} /> Kiểm tra kết nối Embedding
                  </>
                )}
              </button>

              {pingEmbedding && (
                <div
                  role="status"
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs sm:text-sm font-semibold ${
                    pingEmbedding.ok
                      ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300"
                      : "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300"
                  }`}
                >
                  {pingEmbedding.ok ? (
                    <>
                      <CheckCircle2 size={15} className="text-emerald-600 dark:text-emerald-400" />
                      <span>Tạo vector thử nghiệm thành công · Độ trễ: {pingEmbedding.latency_ms} ms</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={15} className="text-rose-600 dark:text-rose-400" />
                      <span>Khóa embedding không hợp lệ hoặc đã vượt ngưỡng hạn mức</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TAB 3: THAM SỐ RAG (PROMPT & TUNING) */}
      {activeTab === "rag_params" && (
        <section className="space-y-6 rounded-3xl border border-[#d3dbe4] dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-sm">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400">
                <Sliders size={18} />
              </span>
              <div>
                <h2 className="text-xl font-bold text-[#142747] dark:text-zinc-100">
                  Hiệu chỉnh Tham số RAG & Chỉ dẫn Hệ thống
                </h2>
                <p className="mt-0.5 text-xs sm:text-sm text-[#718294] dark:text-zinc-400">
                  Quy định hành vi ứng xử của trợ lý pháp lý khi đối sánh căn cứ trích dẫn từ văn bản quy phạm.
                </p>
              </div>
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="system-prompt" className="text-sm font-bold text-[#142747] dark:text-zinc-100">
                Chỉ dẫn hệ thống (System Prompt)
              </label>
              <span className="text-xs text-[#718294] dark:text-zinc-500 font-mono">
                {rag.system_prompt.length}/10000 ký tự
              </span>
            </div>
            <textarea
              id="system-prompt"
              value={rag.system_prompt}
              onChange={(event) => setRag({ ...rag, system_prompt: event.target.value })}
              rows={5}
              maxLength={10000}
              className="mt-2 w-full rounded-2xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 text-xs sm:text-sm font-mono text-[#142747] dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:border-[#1d4f88] dark:focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-[#1d4f88]/20 dark:focus:ring-sky-500/20"
            />
          </div>

          {/* Sliders / Inputs */}
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-800/30 p-4">
              <div className="flex items-center justify-between">
                <label htmlFor="rag-temperature" className="text-xs font-bold uppercase tracking-wider text-[#142747] dark:text-zinc-200">
                  Temperature
                </label>
                <span className="text-xs font-mono font-bold text-[#1d4f88] dark:text-sky-400">
                  {rag.temperature}
                </span>
              </div>
              <input
                id="rag-temperature"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={rag.temperature}
                onChange={(event) => setRag({ ...rag, temperature: Number(event.target.value) })}
                className="mt-2.5 w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5 text-sm font-semibold text-[#142747] dark:text-zinc-100 focus:border-[#1d4f88] dark:focus:border-sky-500 focus:outline-none"
              />
              <p className="mt-1.5 text-[11px] text-[#718294] dark:text-zinc-400">
                Khuyến nghị 0.0 - 0.2 để giảm thiểu võ đoán và trích dẫn chính xác.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-800/30 p-4">
              <div className="flex items-center justify-between">
                <label htmlFor="rag-top-p" className="text-xs font-bold uppercase tracking-wider text-[#142747] dark:text-zinc-200">
                  Top P
                </label>
                <span className="text-xs font-mono font-bold text-[#1d4f88] dark:text-sky-400">
                  {rag.top_p}
                </span>
              </div>
              <input
                id="rag-top-p"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={rag.top_p}
                onChange={(event) => setRag({ ...rag, top_p: Number(event.target.value) })}
                className="mt-2.5 w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5 text-sm font-semibold text-[#142747] dark:text-zinc-100 focus:border-[#1d4f88] dark:focus:border-sky-500 focus:outline-none"
              />
              <p className="mt-1.5 text-[11px] text-[#718294] dark:text-zinc-400">
                Xác suất tích lũy lấy mẫu token (mặc định khuyến nghị 0.9).
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-800/30 p-4">
              <div className="flex items-center justify-between">
                <label htmlFor="rag-max-tokens" className="text-xs font-bold uppercase tracking-wider text-[#142747] dark:text-zinc-200">
                  Max Tokens
                </label>
                <span className="text-xs font-mono font-bold text-[#1d4f88] dark:text-sky-400">
                  {rag.max_tokens}
                </span>
              </div>
              <input
                id="rag-max-tokens"
                type="number"
                min="256"
                max="4096"
                step="128"
                value={rag.max_tokens}
                onChange={(event) => setRag({ ...rag, max_tokens: Number(event.target.value) })}
                className="mt-2.5 w-full rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5 text-sm font-semibold text-[#142747] dark:text-zinc-100 focus:border-[#1d4f88] dark:focus:border-sky-500 focus:outline-none"
              />
              <p className="mt-1.5 text-[11px] text-[#718294] dark:text-zinc-400">
                Độ dài câu trả lời tối đa (256 - 4096 tokens).
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Nút Hành động Cố định (Save & Apply Action Bar) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-3xl border border-[#d3dbe4] dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6 shadow-sm">
        <div>
          <p className="font-bold text-sm text-[#142747] dark:text-zinc-100">
            Lưu và Đồng bộ Cấu hình
          </p>
          <p className="text-xs text-[#718294] dark:text-zinc-400 mt-0.5">
            Các thay đổi sẽ được áp dụng tức thời cho toàn bộ phiên truy vấn chatbot và nạp tài liệu mới.
          </p>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-[#1d4f88] dark:bg-blue-600 px-6 text-sm font-bold text-white shadow-sm transition-[background-color,transform] hover:bg-[#153b66] dark:hover:bg-blue-700 active:scale-[0.98] disabled:opacity-50 shrink-0"
        >
          {busy ? (
            <>
              <Loader2 size={18} className="animate-spin" /> Đang lưu và đồng bộ...
            </>
          ) : (
            <>
              <Save size={18} /> Lưu thay đổi cấu hình
            </>
          )}
        </button>
      </div>
    </div>
  );
}
