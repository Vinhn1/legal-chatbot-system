import { Outlet } from "react-router";
import { Navbar } from "../components/Navbar";
import { ChatWidget } from "../components/ChatWidget";

/** Khung trang công khai cuộn theo chiều dọc và giữ widget trong vùng nhìn. */
export function RootLayout() {
  return <div className="h-full min-h-0 w-full overflow-x-hidden overflow-y-auto">
    <Navbar />
    <main><Outlet /></main>
    <ChatWidget />
  </div>;
}
