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
      <Toaster position="top-right" richColors closeButton expand={false} />
    </AuthProvider></ThemeProvider>
  );
}
