import { type ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ children, allowedRoles }: { children: ReactNode; allowedRoles?: string[] }) {
  const { user, token } = useAuth();
  // Nếu chưa đăng nhập hoặc token đã bị xóa khi hết hạn, chuyển hướng về trang đăng nhập
  if (!user || !token) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
