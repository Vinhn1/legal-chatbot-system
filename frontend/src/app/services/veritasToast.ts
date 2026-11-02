import { createElement } from "react";
import { toast } from "sonner";
import {
  VeritasToastCard,
  type VeritasToastAction,
  type VeritasToastVariant,
} from "../components/VeritasToastCard";

export interface ShowVeritasToastOptions {
  id?: string;
  variant: VeritasToastVariant;
  title: string;
  description?: string;
  docTitle?: string;
  docNumber?: string;
  metaSummary?: string;
  durationMs?: number;
  actions?: VeritasToastAction[];
}

/** Hiển thị thẻ thông báo tùy biến chuẩn Veritas Legal thông qua khay Sonner toàn cục. */
export function showVeritasToast(options: ShowVeritasToastOptions): string | number {
  const duration = options.durationMs ?? 8000;
  return toast.custom(
    (toastId) =>
      createElement(VeritasToastCard, {
        variant: options.variant,
        title: options.title,
        description: options.description,
        docTitle: options.docTitle,
        docNumber: options.docNumber,
        metaSummary: options.metaSummary,
        durationMs: duration,
        actions: options.actions,
        onClose: () => toast.dismiss(toastId),
      }),
    {
      id: options.id,
      duration,
      unstyled: true,
    },
  );
}

/** Đóng một thẻ thông báo theo định danh cụ thể (ví dụ đóng thông báo bắt đầu khi tác vụ đã hoàn tất). */
export function dismissVeritasToast(id?: string | number): void {
  toast.dismiss(id);
}

/** Gửi thêm thông báo mức trình duyệt khi quản trị viên đang mở sang tab khác. */
export function triggerBrowserSystemNotification(title: string, body: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!document.hidden || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, { body });
    } catch {
      // Bỏ qua trên các trình duyệt di động hạn chế khởi tạo trực tiếp Notification
    }
  }
}

/** Xin quyền thông báo trình duyệt một cách nhẹ nhàng khi người dùng bật tác vụ chạy ngầm. */
export function requestBrowserNotificationPermissionIfNeeded(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission().catch(() => undefined);
  }
}
