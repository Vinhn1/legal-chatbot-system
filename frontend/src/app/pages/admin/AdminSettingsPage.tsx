import { useEffect, useState } from "react";
import axios from "axios";
import { Eye, EyeOff, Loader2, Save } from "lucide-react";
import { API_BASE } from "../../../config";
import { useAuth } from "../../context/AuthContext";

type Provider = "gemini" | "openai" | "anthropic" | "local";
type Ping = { ok: boolean; latency_ms: number };

/** Cấu hình mô hình chỉ dành cho quản trị viên, không giữ khóa đã lưu ở trình duyệt. */
export function AdminSettingsPage() {
  const { user } = useAuth();
  const [rag, setRag] = useState({ system_prompt: "", temperature: 0, top_p: 0.9, max_tokens: 1024 });
  const [provider, setProvider] = useState<Provider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [masked, setMasked] = useState("");
  const [visible, setVisible] = useState(false);
  const [embeddingKey, setEmbeddingKey] = useState("");
  const [maskedEmbedding, setMaskedEmbedding] = useState("");
  const [visibleEmbedding, setVisibleEmbedding] = useState(false);
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
    Promise.all([axios.get(`${API_BASE}/chat/config`), axios.get(`${API_BASE}/chat/model-config`)])
      .then(([ragResult, modelResult]) => {
        if (!active) return;
        setRag(ragResult.data);
        setProvider(modelResult.data.provider || "gemini");
        setMasked(modelResult.data.masked_api_key || "");
        setMaskedEmbedding(modelResult.data.masked_embedding_key || "");
      })
      .catch(() => { if (active) setError("Không thể tải cấu hình. Vui lòng thử lại."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.role]);

  const save = async () => {
    setError(""); setMessage(""); setBusy(true);
    try {
      if (!Number.isFinite(rag.temperature) || rag.temperature < 0 || rag.temperature > 1 ||
          !Number.isFinite(rag.top_p) || rag.top_p < 0 || rag.top_p > 1 ||
          !Number.isInteger(rag.max_tokens) || rag.max_tokens < 256 || rag.max_tokens > 4096) {
        setError("Tham số mô hình nằm ngoài khoảng cho phép."); return;
      }
      await axios.post(`${API_BASE}/chat/config`, rag);
      const payload: Record<string, string> = { provider };
      if (apiKey) payload.api_key = apiKey;
      if (embeddingKey) payload.embedding_api_key = embeddingKey;
      const response = await axios.post(`${API_BASE}/chat/model-config`, payload);
      setMasked(response.data.masked_api_key || "");
      setMaskedEmbedding(response.data.masked_embedding_key || "");
      setApiKey(""); setVisible(false);
      setEmbeddingKey(""); setVisibleEmbedding(false);
      setMessage("Đã lưu và đồng bộ cấu hình thành công sang hệ thống.");
    } catch { setError("Không thể lưu cấu hình. Kiểm tra quyền truy cập và khóa mã hóa máy chủ."); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setError(""); setPing(null); setTesting(true);
    try {
      const response = await axios.post(`${API_BASE}/chat/model-test`, { provider, ...(apiKey ? { api_key: apiKey } : {}) });
      setPing(response.data);
    } catch { setError("Không thể kiểm tra kết nối. Vui lòng thử lại."); }
    finally { setTesting(false); }
  };

  const testEmbedding = async () => {
    setError(""); setPingEmbedding(null); setTestingEmbedding(true);
    try {
      const response = await axios.post(`${API_BASE}/chat/embedding-test`, { ...(embeddingKey ? { api_key: embeddingKey } : {}) });
      setPingEmbedding(response.data);
    } catch { setError("Không thể kiểm tra kết nối embedding. Vui lòng thử lại."); }
    finally { setTestingEmbedding(false); }
  };

  if (user?.role !== "admin") return <p className="rounded-xl border p-6">Chỉ quản trị viên toàn quyền được xem cấu hình mô hình.</p>;
  if (loading) return <p role="status" className="p-6"><Loader2 size={18} className="inline animate-spin" /> Đang tải cấu hình...</p>;

  return <div className="max-w-4xl space-y-6">
    <header><p className="text-xs font-bold uppercase tracking-widest text-[#8a785d]">Cấu hình hệ thống</p><h1 className="font-editorial mt-1 text-3xl font-semibold text-[#142747]">Cài đặt AI</h1><p className="mt-1 text-sm text-[#56677c]">Quản lý tham số trả lời và khóa truy cập mô hình.</p></header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <section className="space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6">
      <h2 className="text-lg font-bold text-[#142747]">Cấu hình câu trả lời</h2>
      <label className="block text-sm font-semibold">Chỉ dẫn hệ thống<textarea value={rag.system_prompt} onChange={(event) => setRag({ ...rag, system_prompt: event.target.value })} rows={5} maxLength={10000} className="mt-2 w-full rounded-xl border border-[#cbd5df] p-3 text-sm" /></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-semibold">Temperature<input type="number" min="0" max="1" step="0.05" value={rag.temperature} onChange={(event) => setRag({ ...rag, temperature: Number(event.target.value) })} className="mt-2 w-full rounded-xl border p-2" /></label>
        <label className="text-sm font-semibold">Top P<input type="number" min="0" max="1" step="0.05" value={rag.top_p} onChange={(event) => setRag({ ...rag, top_p: Number(event.target.value) })} className="mt-2 w-full rounded-xl border p-2" /></label>
        <label className="text-sm font-semibold">Max Tokens<input type="number" min="256" max="4096" step="128" value={rag.max_tokens} onChange={(event) => setRag({ ...rag, max_tokens: Number(event.target.value) })} className="mt-2 w-full rounded-xl border p-2" /></label>
      </div>
    </section>
    <section className="space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6">
      <div><h2 className="text-lg font-bold text-[#142747]">Cấu hình Khóa API Mô hình AI</h2><p className="mt-1 text-sm text-[#718294]">Khóa được mã hóa ở máy chủ; giao diện chỉ nhận trạng thái đã che.</p></div>
      <label className="block text-sm font-semibold">Nhà cung cấp<select value={provider} onChange={(event) => { setProvider(event.target.value as Provider); setPing(null); }} className="mt-2 block w-full rounded-xl border p-2"><option value="gemini">Google Gemini</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic Claude</option><option value="local">Mô hình AI nội bộ</option></select></label>
      <div><label htmlFor="model-api-key" className="text-sm font-semibold">Khóa API mới</label><div className="mt-2 flex gap-2"><input id="model-api-key" type={visible ? "text" : "password"} autoComplete="new-password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setPing(null); }} placeholder={masked || "Nhập khóa mới"} className="min-w-0 flex-1 rounded-xl border p-2" /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Ẩn khóa" : "Hiện khóa"} className="rounded-xl border px-3">{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{masked && <p className="mt-1 text-xs text-[#718294]">Đã lưu: {masked}</p>}</div>
      <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={test} disabled={testing || busy} className="rounded-xl border border-[#1d4f88] px-4 py-2 text-sm font-bold text-[#1d4f88] disabled:opacity-50">{testing ? "Đang kiểm tra..." : "Kiểm tra kết nối"}</button>{ping && <span role="status" className={`text-sm font-semibold ${ping.ok ? "text-emerald-700" : "text-rose-700"}`}>{ping.ok ? `Kết nối thành công · ${ping.latency_ms} ms` : "Khóa không hợp lệ hoặc dịch vụ chưa sẵn sàng"}</span>}</div>
    </section>
    <section className="space-y-4 rounded-2xl border border-[#d3dbe4] bg-white p-5 sm:p-6">
      <div>
        <h2 className="text-lg font-bold text-[#142747]">Cấu hình Khóa API Nạp tài liệu (Vector Embedding)</h2>
        <p className="mt-1 text-sm text-[#718294]">
          Khóa API phục vụ tạo vector embedding khi nạp tài liệu mới vào cơ sở tri thức pháp luật.
          Khi lưu, hệ thống tự động đồng bộ sang bộ nhớ vận hành mà không cần sửa file cấu hình máy chủ.
        </p>
      </div>
      <div>
        <label htmlFor="embedding-api-key" className="text-sm font-semibold">Khóa API Embedding mới</label>
        <div className="mt-2 flex gap-2">
          <input
            id="embedding-api-key"
            type={visibleEmbedding ? "text" : "password"}
            autoComplete="new-password"
            value={embeddingKey}
            onChange={(event) => { setEmbeddingKey(event.target.value); setPingEmbedding(null); }}
            placeholder={maskedEmbedding || "Nhập khóa API embedding mới"}
            className="min-w-0 flex-1 rounded-xl border p-2"
          />
          <button
            type="button"
            onClick={() => setVisibleEmbedding(!visibleEmbedding)}
            aria-label={visibleEmbedding ? "Ẩn khóa" : "Hiện khóa"}
            className="rounded-xl border px-3"
          >
            {visibleEmbedding ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {maskedEmbedding && <p className="mt-1 text-xs text-[#718294]">Đã lưu: {maskedEmbedding}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={testEmbedding}
          disabled={testingEmbedding || busy}
          className="rounded-xl border border-[#1d4f88] px-4 py-2 text-sm font-bold text-[#1d4f88] disabled:opacity-50"
        >
          {testingEmbedding ? "Đang kiểm tra..." : "Kiểm tra kết nối Embedding"}
        </button>
        {pingEmbedding && (
          <span
            role="status"
            className={`text-sm font-semibold ${pingEmbedding.ok ? "text-emerald-700" : "text-rose-700"}`}
          >
            {pingEmbedding.ok
              ? `Tạo vector thử nghiệm thành công · ${pingEmbedding.latency_ms} ms`
              : "Khóa embedding không hợp lệ hoặc đã chạm hạn mức"}
          </span>
        )}
      </div>
    </section>
    <button type="button" onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-[#1d4f88] px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Lưu thay đổi</button>
  </div>;
}
