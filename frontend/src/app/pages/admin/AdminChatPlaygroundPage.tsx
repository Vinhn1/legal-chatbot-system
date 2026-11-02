import { LegalChat } from "../../components/LegalChat";

/**
 * Dành trọn 100% không gian vùng làm việc của trang quản trị cho khung hội thoại và đối chiếu nguồn.
 */
export function AdminChatPlaygroundPage() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* Khung chat tràn viền toàn bộ vùng làm việc của trang thử chatbot, ẩn header phụ để tối ưu chiều cao */}
      <div className="min-h-0 w-full flex-1 overflow-hidden">
        <LegalChat fullScreen hideHeader />
      </div>
    </div>
  );
}
