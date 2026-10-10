import type { FileItem, Result } from "../pages/admin/AdminIngestPage";

const DB_NAME = "veritas_legal_db";
const STORE_NAME = "pending_reviews";
const DB_VERSION = 1;

/** Bộ nhớ RAM lưu trữ danh sách tệp xuyên suốt các lượt chuyển tab và chuyển trang điều hướng */
let inMemoryFiles: FileItem[] = [];

/** Mở kết nối IndexedDB phục vụ lưu trữ bền vững các tệp cần rà soát */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB không được hỗ trợ trong môi trường này"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Lấy danh sách tệp hiện tại trong bộ nhớ RAM */
export function getInMemoryFiles(): FileItem[] {
  return inMemoryFiles;
}

/** Cập nhật danh sách tệp trong bộ nhớ RAM */
export function setInMemoryFiles(files: FileItem[]): void {
  inMemoryFiles = files;
}

/** Lưu một tệp cần rà soát vào IndexedDB */
export async function savePendingReviewToDb(item: FileItem): Promise<void> {
  if (!item.result || item.result.status !== "needs_review") return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({
      id: item.id,
      file: item.file,
      result: item.result,
      createdAt: Date.now(),
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Tránh gián đoạn giao diện nếu trình duyệt hạn chế IndexedDB ở chế độ ẩn danh
  }
}

/** Xóa tệp cần rà soát khỏi IndexedDB khi đã lập chỉ mục vào ChromaDB hoặc người dùng hủy */
export async function removePendingReviewFromDb(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Bỏ qua nếu IndexedDB không khả dụng
  }
}

/** Tải danh sách tệp cần rà soát từ IndexedDB */
export async function loadPendingReviewsFromDb(): Promise<FileItem[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    const records = await new Promise<Array<{ id: string; file: File; result: Result }>>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as Array<{ id: string; file: File; result: Result }>) || []);
      request.onerror = () => reject(request.error);
    });
    return records.map((record) => ({
      id: record.id,
      file: record.file,
      state: "done" as const,
      result: record.result,
    }));
  } catch {
    return [];
  }
}

/** Đồng bộ danh sách tệp vào cả RAM và IndexedDB cho các mục cần rà soát */
export function syncFilesStorage(files: FileItem[]): void {
  inMemoryFiles = files;
  const reviewItems = files.filter((item) => item.result?.status === "needs_review");
  for (const item of reviewItems) {
    void savePendingReviewToDb(item);
  }
}
