import { createBrowserRouter, Navigate } from "react-router";
import { RootLayout } from "./layouts/RootLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { HomePage } from "./pages/HomePage";
import { EmbedChatPage } from "./pages/EmbedChatPage";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ProtectedRoute } from "./components/ProtectedRoute";

import { AdminOverviewPage } from "./pages/admin/AdminOverviewPage";
import { AdminDocumentsPage } from "./pages/admin/AdminDocumentsPage";
import { AdminIngestPage } from "./pages/admin/AdminIngestPage";
import { AdminChatPlaygroundPage } from "./pages/admin/AdminChatPlaygroundPage";
import { AdminConversationsPage } from "./pages/admin/AdminConversationsPage";
import { AdminAnalyticsPage } from "./pages/admin/AdminAnalyticsPage";
import { AdminSettingsPage } from "./pages/admin/AdminSettingsPage";
import { AdminProfilePage } from "./pages/admin/AdminProfilePage";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";
import { AdminBackupsPage } from "./pages/admin/AdminBackupsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    children: [{ index: true, Component: HomePage }],
  },
  { path: "/embed", Component: EmbedChatPage },
  { path: "/widget", Component: EmbedChatPage },
  { path: "/login", Component: LoginPage },
  { path: "/forgot-password", Component: ForgotPasswordPage },
  {
    path: "/admin",
    element: (
      <ProtectedRoute allowedRoles={["admin", "staff"]}>
        <AdminLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, Component: AdminOverviewPage },
      { path: "documents", Component: AdminDocumentsPage },
      { path: "ingest", Component: AdminIngestPage },
      { path: "chat", Component: AdminChatPlaygroundPage },
      { path: "conversations", Component: AdminConversationsPage },
      { path: "analytics", Component: AdminAnalyticsPage },
      { path: "settings", Component: AdminSettingsPage },
      { path: "profile", Component: AdminProfilePage },
      { path: "users", element: <ProtectedRoute allowedRoles={["admin"]}><AdminUsersPage /></ProtectedRoute> },
      { path: "backups", element: <ProtectedRoute allowedRoles={["admin"]}><AdminBackupsPage /></ProtectedRoute> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
