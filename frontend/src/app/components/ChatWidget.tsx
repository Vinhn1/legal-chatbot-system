import { useState } from "react";
import { LegalChat } from "./LegalChat";
import { RobotAvatar } from "./RobotAvatar";

/**
 * Widget nổi hỗ trợ tra cứu pháp luật nhanh trên toàn trang web,
 * tích hợp mascot RobotAvatar với trạng thái tương tác sống động.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-3 right-3 z-50 flex flex-col items-end sm:bottom-5 sm:right-5">
      {/* Khung chat popover khi được mở */}
      {open && (
        <div className="mb-3 h-[min(34rem,calc(100dvh-6rem))] w-[min(26rem,calc(100vw-1.5rem))] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
          <LegalChat />
        </div>
      )}

      {/* Nút bấm tròn tích hợp RobotAvatar */}
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="group flex items-center gap-2.5 rounded-full bg-blue-700 py-1.5 pl-2 pr-4 text-sm font-medium text-white shadow-xl transition-all duration-200 hover:bg-blue-800 hover:shadow-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        aria-label={open ? "Đóng Trợ lý Pháp luật" : "Mở Trợ lý Pháp luật"}
      >
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-blue-900/40 p-0.5">
          <RobotAvatar size={38} state={open ? "happy" : "idle"} />
        </div>
        <span>{open ? "Thu nhỏ" : "Hỏi đáp pháp luật"}</span>
      </button>
    </div>
  );
}
