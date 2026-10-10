import { LegalChat } from "../../components/LegalChat";

/**
 * Dành toàn bộ vùng làm việc của trang quản trị cho hội thoại và đối chiếu nguồn.
 */
export function AdminChatPlaygroundPage() {
  return (
    <div className="-m-5 flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden p-3 sm:-m-8 sm:p-5 animate-fade-in-up">
      {/* Giữ vùng cuộn bên trong khung chat để tận dụng chiều cao màn hình. */}
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        <LegalChat />
      </div>
    </div>
  );
}
