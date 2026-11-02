import { useState } from "react";
import { LegalChat } from "./LegalChat";
import { RobotAvatar } from "./RobotAvatar";

/**
 * Widget trợ lý pháp luật AI nổi trên toàn trang web.
 * - Khi mở: Tự động ẩn avatar nổi ở đáy để khung chat mở rộng tối đa, dễ quan sát và không bị che khuất.
 * - Khi đóng: Nút avatar mascot xuất hiện ở góc phải màn hình sẵn sàng phục vụ.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end sm:bottom-6 sm:right-6">
      {/* Khung chat popover khi được mở — thiết kế theo mẫu chuẩn cao cấp */}
      {open ? (
        <div className="h-[min(44rem,calc(100dvh-2.5rem))] w-[min(32rem,calc(100vw-1.5rem))] sm:w-[480px] md:w-[500px] max-w-[calc(100vw-1.5rem)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-3 duration-200">
          <LegalChat onClose={() => setOpen(false)} />
        </div>
      ) : (
        /* Nút avatar nổi — tự động ẩn khi khung chat đang mở để tối ưu không gian hiển thị */
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="group relative flex items-center justify-center border-0 bg-transparent p-0 transition-transform duration-300 hover:scale-110 active:scale-95 focus:outline-none drop-shadow-[0_10px_22px_rgba(20,39,71,0.35)] hover:drop-shadow-[0_16px_32px_rgba(29,79,136,0.5)] cursor-pointer"
          aria-label="Mở Trợ lý Pháp luật AI"
          title="Mở Trợ lý Pháp luật AI"
        >
          <RobotAvatar size={66} state="idle" />
          <span className="absolute bottom-1 right-1.5 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-4 w-4 rounded-full border-2 border-white bg-emerald-500 shadow-sm"></span>
          </span>
        </button>
      )}
    </div>
  );
}
