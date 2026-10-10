import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  FileCheck,
  FileSearch,
  Layers,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { API_BASE } from "../../config";
import { RobotAvatar } from "../components/RobotAvatar";

/** Số liệu kho luật chỉ gồm văn bản được phép công khai từ backend */
interface PublicSummary {
  document_count: number;
  article_count: number;
  last_updated: string | null;
  documents: { title: string; doc_number: string }[];
}

/** Danh sách các trường hợp mẫu trong khối tương tác minh họa đối chiếu */
const INTERACTIVE_CASES = [
  {
    id: "dat-dai",
    tag: "Luật Đất đai 2024",
    question: "Điều kiện cấp Giấy chứng nhận quyền sử dụng đất cho hộ gia đình đang sử dụng đất ổn định?",
    answer:
      "Theo Điều 138 Luật Đất đai số 31/2024/QH15, hộ gia đình, cá nhân đang sử dụng đất ổn định trước ngày 01 tháng 7 năm 2014 mà không có giấy tờ quy định tại Điều 137, nay được Ủy ban nhân dân cấp xã nơi có đất xác nhận là không có tranh chấp thì được cấp Giấy chứng nhận.",
    citationTag: "Luật số 31/2024/QH15 · Điều 138",
    sourceSegment:
      "Điều 138. Cấp Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất cho hộ gia đình, cá nhân đang sử dụng đất không có giấy tờ về quyền sử dụng đất mà không vi phạm pháp luật về đất đai...",
    chapter: "Chương IX · Đăng ký đất đai",
    clause: "Khoản 1 Điều 138",
    status: "Còn hiệu lực",
    statusType: "active" as const,
  },
  {
    id: "lao-dong",
    tag: "Bộ luật Lao động 2019",
    question: "Thời gian thử việc tối đa đối với công việc có chức danh nghề nghiệp cần trình độ đại học?",
    answer:
      "Căn cứ Điều 25 Bộ luật Lao động số 45/2019/QH14, thời gian thử việc không quá 60 ngày đối với công việc có chức danh nghề nghiệp cần trình độ chuyên môn, kỹ thuật từ cao đẳng trở lên.",
    citationTag: "Luật số 45/2019/QH14 · Điều 25",
    sourceSegment:
      "Điều 25. Thời gian thử việc: Thời gian thử việc do hai bên thỏa thuận căn cứ vào tính chất và mức độ phức tạp của công việc nhưng chỉ được thử việc một lần đối với một công việc và bảo đảm điều kiện... Không quá 60 ngày đối với công việc có chức danh nghề nghiệp cần trình độ chuyên môn, kỹ thuật từ cao đẳng trở lên.",
    chapter: "Chương III · Hợp đồng lao động",
    clause: "Khoản 2 Điều 25",
    status: "Còn hiệu lực",
    statusType: "active" as const,
  },
  {
    id: "doanh-nghiep",
    tag: "Luật Doanh nghiệp 2020",
    question: "Thời hạn góp vốn thành lập công ty trách nhiệm hữu hạn hai thành viên trở lên?",
    answer:
      "Theo Khoản 2 Điều 47 Luật Doanh nghiệp số 59/2020/QH14, thành viên phải góp vốn cho công ty đủ và đúng loại tài sản đã cam kết khi đăng ký thành lập doanh nghiệp trong thời hạn 90 ngày kể từ ngày được cấp Giấy chứng nhận đăng ký doanh nghiệp.",
    citationTag: "Luật số 59/2020/QH14 · Điều 47",
    sourceSegment:
      "Điều 47. Góp vốn thành lập công ty và cấp giấy chứng nhận phần vốn góp: 2. Thành viên phải góp vốn cho công ty đủ và đúng loại tài sản đã cam kết khi đăng ký thành lập doanh nghiệp trong thời hạn 90 ngày kể từ ngày được cấp Giấy chứng nhận đăng ký doanh nghiệp...",
    chapter: "Chương III · Công ty TNHH 2 TV",
    clause: "Khoản 2 Điều 47",
    status: "Còn hiệu lực",
    statusType: "active" as const,
  },
];

/** 3 Trụ cột cốt lõi từ Veritas Design Canvas */
const PILLARS = [
  {
    number: "01 · Chuẩn hóa",
    title: "Nạp & tách cấu trúc",
    description: "Tiếp nhận PDF, DOCX, URL hoặc văn bản thuần; tự động nhận diện cấu trúc Điều, Khoản để người vận hành kiểm duyệt trước khi lập chỉ mục.",
    icon: Layers,
  },
  {
    number: "02 · Truy xuất",
    title: "Tìm theo ý nghĩa",
    description: "Kết hợp đối chiếu chính xác số hiệu Điều/Khoản và tìm kiếm ngữ nghĩa vector (Hybrid RAG) trong phạm vi dữ liệu được phép công khai.",
    icon: FileSearch,
  },
  {
    number: "03 · Kiểm chứng",
    title: "Mở đúng đoạn nguồn",
    description: "Mọi nhận định đều gắn với số hiệu văn bản, mở trực tiếp đoạn gốc, kiểm tra hiệu lực pháp lý và phiên bản trước khi áp dụng.",
    icon: FileCheck,
  },
];

/** 4 Chặng vòng đời một nguồn */
const LIFECYCLE_STEPS = [
  {
    step: "01",
    title: "Tiếp nhận",
    desc: "Tệp, URL hoặc văn bản; xác nhận phạm vi truy cập.",
  },
  {
    step: "02",
    title: "Lập chỉ mục",
    desc: "Trích xuất, tách cấu trúc Điều/Khoản và kiểm duyệt.",
  },
  {
    step: "03",
    title: "Đặt câu hỏi",
    desc: "Truy vấn ngôn ngữ tự nhiên trong kho đã được cấp phép.",
  },
  {
    step: "04",
    title: "Đối chiếu",
    desc: "Mở đoạn gốc, kiểm tra hiệu lực và đánh dấu rà soát.",
  },
];

/** Câu hỏi thường gặp theo cấu trúc FAQ Canvas */
const FAQ_ITEMS = [
  {
    question: "Nếu kho dữ liệu chưa tìm thấy nguồn phù hợp thì hệ thống xử lý ra sao?",
    answer:
      "Hệ thống sẽ thông báo rõ ràng về giới hạn kho văn bản hiện tại thay vì tự bịa ra điều khoản hoặc trích dẫn không có căn cứ. Nguyên tắc cốt lõi là không ảo giác pháp lý.",
  },
  {
    question: "Trạng thái hiệu lực của văn bản có luôn cập nhật tức thời không?",
    answer:
      "Trạng thái dựa trên metadata đã được nạp và phân loại trong kho. Đối với những văn bản chưa xác minh hoặc hết hiệu lực một phần, hệ thống luôn gắn nhãn cảnh báo để người tra cứu đối chiếu văn bản sửa đổi bổ sung.",
  },
  {
    question: "Tôi kiểm tra đoạn trích dẫn văn bản bằng cách nào?",
    answer:
      "Bên dưới mỗi câu trả lời là các thẻ nguồn (Source Badges). Khi nhấp vào thẻ, một panel trượt ra hiển thị toàn văn đoạn trích xuất, số Điều, Khoản, ngày ban hành và đường dẫn gốc.",
  },
  {
    question: "Câu trả lời có thay thế ý kiến tư vấn của luật sư không?",
    answer:
      "Không. Hệ thống là công cụ hỗ trợ đọc và tra cứu văn bản quy phạm pháp luật nhanh chóng, không thay thế ý kiến tư vấn pháp lý chính thức cho vụ việc cụ thể.",
  },
];

/**
 * Trang chủ Veritas Legal — Triển khai chuẩn mẫu Veritas Canvas Variant 03
 * Đảm bảo font chữ to, rõ, hiển thị đẹp trên Desktop (1440px) và Mobile (390px)
 * Tích hợp hiệu ứng chuyển động mượt mà và tương tác đối chiếu nguồn trực tiếp
 */
export function HomePage() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [validation, setValidation] = useState("");
  const [summary, setSummary] = useState<PublicSummary | null>(null);
  const [summaryState, setSummaryState] = useState<"loading" | "success" | "error">("loading");
  const [summaryAttempt, setSummaryAttempt] = useState(0);

  // Trạng thái của khối tương tác đối chiếu nguồn mẫu
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const activeCase = INTERACTIVE_CASES[activeCaseIndex];

  // Trạng thái mở/đóng của FAQ
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  useEffect(() => {
    let isCurrent = true;
    setSummaryState("loading");
    axios
      .get<PublicSummary>(`${API_BASE}/chat/public-summary`)
      .then((response) => {
        if (isCurrent) {
          setSummary(response.data);
          setSummaryState("success");
        }
      })
      .catch(() => {
        if (isCurrent) {
          setSummary(null);
          setSummaryState("error");
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [summaryAttempt]);

  /** Chuyển câu hỏi sang trang tra cứu /embed */
  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text) {
      setValidation("Vui lòng nhập câu hỏi pháp luật trước khi tra cứu.");
      return;
    }
    if (text.length > 2000) {
      setValidation("Câu hỏi không được vượt quá 2000 ký tự.");
      return;
    }
    navigate(`/embed?question=${encodeURIComponent(text)}`);
  }

  return (
    <div className="min-w-0 overflow-x-hidden bg-[#faf9f6] text-[#142747] antialiased">
      {/* 1. Header Metadata Bar từ Canvas */}
      <header className="border-b border-[#ccd4dd] bg-[#eef1f4] px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[#59708b]">
            <span className="h-0.5 w-6 bg-[#a17842]" />
            Veritas Legal System · 03 — Sợi chỉ vòng đời nguồn
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-[#d9c9ad] bg-[#faf7f0] px-3 py-1 text-[#785c32]">
              Cổng tra cứu có đối chiếu
            </span>
            <span className="rounded-full border border-[#cbd5df] bg-white px-3 py-1 text-[#516278]">
              Tối ưu Desktop · Tablet · Mobile
            </span>
          </div>
        </div>
      </header>

      {/* 2. Hero Section: Editorial Headline & Interactive Evidence Preview */}
      <section id="kham-pha" className="mx-auto max-w-7xl px-5 pt-10 pb-16 sm:px-8 md:pt-14 md:pb-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
          {/* Cột trái: Thông điệp lớn & CTA */}
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#dfd4c0] bg-[#f6f0e5] px-4 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-[#795e37]">
              <span className="h-2 w-2 rounded-full bg-[#b48b50] animate-pulse" />
              Cổng tra cứu văn bản pháp luật Việt Nam
            </div>

            <h1 className="font-editorial mt-6 text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-[#112444] sm:text-5xl lg:text-6xl">
              Tìm quy định.
              <br />
              <span className="text-[#1d4f88]">Lần theo nguồn.</span>
            </h1>

            <p className="mt-5 text-base leading-relaxed text-[#516278] sm:text-lg">
              Đặt câu hỏi tự nhiên bằng tiếng Việt, nhận định được trích xuất gắn liền với nguồn quy phạm pháp luật và tự đối chiếu nguyên văn trước khi áp dụng.
            </p>

            {/* Nút hành động */}
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/embed"
                className="inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-[#1d4f88] px-7 text-sm font-bold text-white shadow-md shadow-[#1d4f88]/20 transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-[#153b66] active:scale-[0.98] motion-reduce:transition-none sm:text-base"
              >
                Khám phá tra cứu <ArrowRight size={18} />
              </Link>
              <Link
                to="/login"
                className="inline-flex h-13 items-center justify-center gap-2 rounded-xl border border-[#cbd4dd] bg-white px-6 text-sm font-bold text-[#142747] shadow-xs transition-colors hover:bg-[#f8f8f6] active:scale-[0.98] sm:text-base"
              >
                Cổng quản trị <ArrowUpRight size={17} />
              </Link>
            </div>

            {/* Các cam kết minh bạch */}
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold text-[#5c6d82] sm:text-sm">
              <span className="inline-flex items-center gap-2">
                <Check size={16} className="text-[#2f7560]" />
                Trích dẫn có thể mở xem trực tiếp
              </span>
              <span className="inline-flex items-center gap-2">
                <Check size={16} className="text-[#2f7560]" />
                Trạng thái hiệu lực rõ ràng
              </span>
            </div>

            {/* Lưu ý pháp lý */}
            <p className="mt-8 border-l-2 border-[#c29a5b] pl-4 text-xs leading-relaxed text-[#738196] sm:text-sm">
              Công cụ hỗ trợ tra cứu và đối chiếu, không thay thế ý kiến tư vấn pháp lý chính thức. Luôn kiểm tra văn bản gốc và phạm vi áp dụng thực tế.
            </p>
          </div>

          {/* Cột phải: Mẫu đối chiếu nguồn tương tác (Interactive Evidence Workbench) */}
          <div className="rounded-2xl border border-[#cbd4dd] bg-white p-5 shadow-[0_22px_55px_-30px_rgba(21,42,70,.28)] sm:p-7">
            {/* Header của thẻ mẫu */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#e7e9eb] pb-4">
              <div className="flex items-center gap-3">
                <RobotAvatar size={38} state="idle" />
                <div>
                  <div className="text-sm font-bold text-[#142747]">Mẫu đối chiếu nguồn</div>
                  <div className="text-xs text-[#7a8897]">Chọn câu hỏi mẫu bên dưới để xem luồng trích dẫn</div>
                </div>
              </div>
              <span className="rounded-full border border-[#e7d6b7] bg-[#fbf5e9] px-3 py-1 text-xs font-bold text-[#806137]">
                THỬ NGHIỆM TƯƠNG TÁC
              </span>
            </div>

            {/* Bộ chọn câu hỏi mẫu */}
            <div className="mb-4 flex flex-wrap gap-2">
              {INTERACTIVE_CASES.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveCaseIndex(idx)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                    activeCaseIndex === idx
                      ? "bg-[#1d4f88] text-white shadow-xs"
                      : "bg-[#eef2f6] text-[#516278] hover:bg-[#e4e9f0]"
                  }`}
                >
                  {item.tag}
                </button>
              ))}
            </div>

            {/* Nội dung đối chiếu 2 cột (hoặc stacked trên mobile) */}
            <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
              {/* Bên hỏi & Nhận định */}
              <div className="flex flex-col gap-3">
                <div className="rounded-xl bg-[#f2f4f6] p-4">
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#6b7b8e]">
                    Câu hỏi của người dùng
                  </div>
                  <div className="mt-2 text-sm font-semibold text-[#142747]">
                    {activeCase.question}
                  </div>
                </div>

                <div className="rounded-xl border border-[#e0e6ec] bg-[#fdfdfd] p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#1d4f88]">
                    <Sparkles size={15} />
                    Trả lời có đối chiếu
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#415369] sm:text-sm">
                    {activeCase.answer}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#c9d8e9] bg-[#f2f7fc] px-3 py-1.5 text-xs font-bold text-[#1d4f88]">
                      {activeCase.citationTag}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bên đoạn nguồn gốc */}
              <aside className="rounded-xl border border-[#e5ddce] bg-[#faf8f2] p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-[0.14em] text-[#876a3f]">
                    Đoạn nguồn văn bản
                  </div>
                  <span className="rounded-full bg-[#f8f0df] border border-[#e4d3b3] px-2.5 py-0.5 text-[11px] font-bold text-[#7f633c]">
                    {activeCase.status}
                  </span>
                </div>

                <div className="mt-3 border-l-3 border-[#c29a5b] bg-[#fff5df] p-3 text-xs leading-relaxed text-[#3b4756] sm:text-sm">
                  {activeCase.sourceSegment}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-[#68798d]">
                  <span className="rounded-md border border-[#e0e4e9] bg-white px-2 py-1">
                    {activeCase.chapter}
                  </span>
                  <span className="rounded-md border border-[#e0e4e9] bg-white px-2 py-1">
                    {activeCase.clause}
                  </span>
                </div>
              </aside>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-[#ecebe7] pt-3 text-xs text-[#738196]">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-[#2f7560]" />
                Đoạn văn bản được trích xuất trực tiếp từ kho chỉ mục
              </span>
              <span className="font-semibold text-[#a17842]">Mẫu thử nghiệm</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Khối Tìm kiếm / Tra cứu nhanh ("Hỏi thử ngay") */}
      <section className="mx-auto -mt-4 max-w-5xl px-5 sm:px-8">
        <div className="rounded-2xl border border-[#cbd4dd] bg-white p-6 shadow-[0_20px_60px_-25px_rgba(15,23,42,.15)] sm:p-8">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#1d4f88]">
            <Search size={16} /> Bắt đầu tra cứu pháp luật
          </div>
          <h2 className="font-editorial mt-2 text-2xl font-semibold text-[#142747] sm:text-3xl">
            Bạn đang muốn tìm quy định nào?
          </h2>
          <p className="mt-1 text-sm text-[#5a6c82]">
            Nhập câu hỏi bằng ngôn ngữ tự nhiên. Hệ thống sẽ truy xuất các đoạn luật liên quan.
          </p>

          <form onSubmit={handleSearch} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-[#ccd4dd] bg-[#f8f9fa] px-4 focus-within:border-[#1d4f88] focus-within:bg-white focus-within:ring-3 focus-within:ring-[#1d4f88]/15 transition-all">
              <Search size={20} className="shrink-0 text-[#7a8898]" />
              <input
                aria-label="Câu hỏi pháp luật cần tra cứu"
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  setValidation("");
                }}
                placeholder="Ví dụ: Điều kiện hưởng bảo hiểm xã hội một lần mới nhất?"
                className="h-13 w-full min-w-0 bg-transparent py-2 text-sm sm:text-base text-[#142747] outline-none placeholder:text-[#8896a6]"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-[#1d4f88] px-7 text-sm sm:text-base font-bold text-white shadow-sm transition-[background-color,transform] hover:bg-[#153b66] active:scale-[0.98] motion-reduce:transition-none"
            >
              Tra cứu <ArrowRight size={17} />
            </button>
          </form>

          {validation && (
            <p role="alert" className="mt-3 text-xs font-bold text-rose-700">
              {validation}
            </p>
          )}

          {/* Gợi ý câu hỏi phổ biến */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[#6a7b8e]">Câu hỏi gợi ý:</span>
            {[
              "Thời gian thử việc tối đa theo Bộ luật Lao động?",
              "Thủ tục đăng ký thành lập công ty TNHH?",
              "Quy định bồi thường khi thu hồi đất ở?",
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => navigate(`/embed?question=${encodeURIComponent(sample)}`)}
                className="rounded-full border border-[#cbd5df] bg-[#fafaf8] px-3.5 py-1.5 text-xs font-semibold text-[#40546d] hover:border-[#1d4f88] hover:bg-white hover:text-[#1d4f88] transition-colors"
              >
                {sample}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Ba Trụ cột Giá trị (3 Pillars) */}
      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 md:py-24">
        <div className="text-center max-w-3xl mx-auto">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#8a785d]">
            NGUYÊN TẮC HỆ THỐNG
          </div>
          <h2 className="font-editorial mt-2 text-3xl font-semibold text-[#142747] sm:text-4xl">
            Đọc luật với nguồn và ngữ cảnh rõ ràng
          </h2>
          <p className="mt-3 text-sm sm:text-base text-[#56677c]">
            Được thiết kế nhằm loại bỏ việc đoán mò văn bản, giữ nguyên sợi chỉ liên kết từ văn bản gốc đến từng câu trả lời.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <article
              key={pillar.number}
              className="rounded-2xl border border-[#d3dbe4] bg-white p-6 sm:p-7 shadow-xs transition-all hover:-translate-y-1 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#eef4f9] text-[#1d4f88]">
                  <pillar.icon size={22} />
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a785d]">
                  {pillar.number}
                </span>
              </div>
              <h3 className="font-editorial mt-5 text-2xl font-semibold text-[#142747]">
                {pillar.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#56677c]">
                {pillar.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* 5. Quy trình 4 chặng: Đường đi của một nguồn */}
      <section id="cach-hoat-dong" className="border-y border-[#ccd4dd] bg-[#f4f6f8] py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a785d]">
                HOW IT WORKS · 4 CHẶNG
              </div>
              <h2 className="font-editorial mt-2 text-3xl font-semibold text-[#142747] sm:text-4xl">
                Đường đi của một câu trả lời
              </h2>
            </div>
            <span className="text-xs font-semibold text-[#6d7e92]">
              Tiếp nhận ➔ Lập chỉ mục ➔ Đặt câu hỏi ➔ Đối chiếu
            </span>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LIFECYCLE_STEPS.map((step) => (
              <div
                key={step.step}
                className="rounded-2xl border border-[#d3dbe4] bg-white p-5 shadow-xs transition-transform hover:-translate-y-0.5"
              >
                <div className="text-xs font-bold text-[#a17842]">{step.step}</div>
                <div className="mt-2 text-base font-bold text-[#142747]">{step.title}</div>
                <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-[#5e6f82]">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Banner Nhánh kiểm soát ngoại lệ từ Canvas */}
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-[#dfd4c0] bg-[#faf6ed] p-4 text-xs sm:text-sm text-[#715c3e]">
            <CircleAlert size={18} className="shrink-0 text-[#a17842] mt-0.5" />
            <div>
              <strong>Nhánh kiểm soát chất lượng:</strong> Nếu chất lượng OCR hoặc metadata văn bản chưa đạt chuẩn, hệ thống tự động đưa vào hàng đợi Chờ duyệt; tài liệu chưa xác minh sẽ không bao giờ được trình bày như nguồn đã kiểm chứng.
            </div>
          </div>
        </div>
      </section>

      {/* 6. Minh bạch Dữ liệu (Data Transparency Table) */}
      <section id="minh-bach" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 md:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-14 items-center">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#8a785d]">
              MINH BẠCH DỮ LIỆU
            </div>
            <h2 className="font-editorial mt-2 text-3xl font-semibold text-[#142747] sm:text-4xl">
              Biết rõ phạm vi trước khi tra cứu
            </h2>
            <p className="mt-4 text-sm sm:text-base leading-relaxed text-[#56677c]">
              Hệ thống chỉ hiển thị số liệu từ kho văn bản công khai thực tế đã được đồng bộ. Bất kỳ tài liệu nào thuộc phạm vi nội bộ đều không thể bị rò rỉ ở cổng tra cứu công khai.
            </p>

            <div className="mt-6 rounded-xl border border-[#d3dbe4] bg-[#f8f9fa] p-4 text-xs text-[#627387]">
              <Database size={16} className="inline mr-1 text-[#1d4f88]" /> Số liệu được tổng hợp trực tiếp từ endpoint công khai: <code className="font-mono text-[#1d4f88]">/chat/public-summary</code>
            </div>
          </div>

          <div className="rounded-2xl border border-[#cbd4dd] bg-white p-6 shadow-sm">
            <div className="divide-y divide-[#e7e8e7]">
              <div className="flex items-center justify-between py-3.5">
                <span className="text-sm font-medium text-[#56677c]">Phạm vi tra cứu</span>
                <span className="text-sm font-bold text-[#142747]">Văn bản được phép công khai</span>
              </div>
              <div className="flex items-center justify-between py-3.5">
                <span className="text-sm font-medium text-[#56677c]">Số văn bản & Điều</span>
                <span className="text-sm font-bold text-[#1d4f88]">
                  {summaryState === "loading"
                    ? "Đang kết nối..."
                    : summaryState === "error"
                    ? "Chưa có dữ liệu"
                    : `${summary?.document_count ?? 0} văn bản · ${summary?.article_count ?? 0} Điều`}
                </span>
              </div>
              <div className="flex items-center justify-between py-3.5">
                <span className="text-sm font-medium text-[#56677c]">Cập nhật gần nhất</span>
                <span className="text-sm font-bold text-[#142747]">
                  {summaryState === "loading"
                    ? "Đang kiểm tra..."
                    : summaryState === "error"
                    ? "Chưa thể xác định"
                    : summary?.last_updated ?? "Chưa có ngày"}
                </span>
              </div>
              <div className="flex items-center justify-between py-3.5">
                <span className="text-sm font-medium text-[#56677c]">Trạng thái xác minh</span>
                <span className="rounded-full border border-[#ead8b7] bg-[#fbf4e8] px-3 py-1 text-xs font-bold text-[#80643d]">
                  {summaryState === "success" && (summary?.document_count ?? 0) > 0
                    ? "Đã lập chỉ mục"
                    : "Đang chờ dữ liệu"}
                </span>
              </div>
            </div>

            {summaryState === "error" && (
              <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 flex justify-between items-center">
                <span>Không thể tải số liệu thống kê kho luật.</span>
                <button
                  type="button"
                  onClick={() => setSummaryAttempt((p) => p + 1)}
                  className="font-bold underline"
                >
                  Thử lại
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 7. Khối Câu hỏi thường gặp (FAQ) — Theme Navy Hoàng gia từ Canvas */}
      <section id="faq" className="border-t border-[#1d3558] bg-[#142747] py-16 text-white sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-[#d5b576]">
                CÂU HỎI THƯỜNG GẶP
              </div>
              <h2 className="font-editorial mt-3 text-3xl font-semibold leading-tight sm:text-4xl text-white">
                Minh bạch cả điều hệ thống chưa biết.
              </h2>
              <p className="mt-4 text-sm sm:text-base leading-relaxed text-[#becbd9]">
                Chúng tôi công khai mọi giới hạn kỹ thuật và pháp lý để người sử dụng luôn có căn cứ chính xác nhất.
              </p>
              <div className="mt-8">
                <Link
                  to="/embed"
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#f4efe4] px-6 text-sm font-bold text-[#142747] shadow-sm hover:bg-white"
                >
                  Bắt đầu tra cứu ngay <ArrowRight size={17} />
                </Link>
              </div>
            </div>

            <div className="divide-y divide-white/15 border-y border-white/15">
              {FAQ_ITEMS.map((item, index) => {
                const isOpen = openFaqIndex === index;
                return (
                  <div key={item.question} className="py-4">
                    <button
                      type="button"
                      onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between gap-4 text-left text-sm sm:text-base font-semibold text-white focus-visible:outline-2 focus-visible:outline-[#d5b576]"
                    >
                      <span>{item.question}</span>
                      <span className="shrink-0 text-[#d5b576] transition-transform duration-200">
                        <ChevronDown size={18} className={isOpen ? "rotate-180" : ""} />
                      </span>
                    </button>
                    {isOpen && (
                      <p className="mt-3 text-xs sm:text-sm leading-relaxed text-[#becbd9] animate-fade-in-up">
                        {item.answer}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* 8. Footer Chuẩn Mực */}
      <footer className="border-t border-[#cfd7df] bg-white py-8 px-5 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left text-xs text-[#738196]">
          <div className="flex items-center gap-2 font-bold text-[#142747]">
            <Scale size={16} className="text-[#a17842]" />
            Veritas Legal · Cổng tra cứu văn bản quy phạm pháp luật
          </div>
          <div>Hỗ trợ tìm nguồn · Không thay thế tư vấn pháp lý · © 2026 Veritas</div>
        </div>
      </footer>
    </div>
  );
}
