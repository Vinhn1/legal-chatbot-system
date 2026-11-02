import { RouterProvider } from "react-router";
import { router } from "./routes.tsx";
import { AuthProvider } from "./context/AuthContext";
import { Toaster } from "./components/ui/sonner";
import { ThemeProvider } from "./context/ThemeContext";

export default function App() {
  return (
    <ThemeProvider><AuthProvider>
      <RouterProvider router={router} />
      {/* Giữ thông báo nạp tài liệu hiển thị trên mọi tuyến giao diện. */}
      <Toaster position="top-right" richColors closeButton expand visibleToasts={4} gap={10} offset={{ top: 68, right: 20 }} mobileOffset={{ top: 64, left: 16, right: 16 }} />
    </AuthProvider></ThemeProvider>
  );
}
