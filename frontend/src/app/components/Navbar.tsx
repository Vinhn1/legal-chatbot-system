import { useState } from "react";
import { Link } from "react-router";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { LegalLogo } from "./LegalLogo";

/**
 * Thanh điều hướng công khai Veritas Legal
 * Hiển thị nhận diện thương hiệu, liên kết tra cứu và lối vào cổng quản trị
 * Đảm bảo font chữ to rõ và responsive trên mobile 390px và desktop
 */
export function Navbar() {
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { label: "Khám phá", href: "/#kham-pha" },
    { label: "Cách hoạt động", href: "/#cach-hoat-dong" },
    { label: "Minh bạch dữ liệu", href: "/#minh-bach" },
    { label: "Câu hỏi thường gặp", href: "/#faq" },
  ];

  return (
    <nav aria-label="Điều hướng chính" className="sticky top-0 z-50 border-b border-[#ccd4dd] bg-[#faf9f6]/95 backdrop-blur-md transition-colors">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8">
        {/* Logo Veritas Legal */}
        <Link
          to="/"
          aria-label="Trang chủ Cổng tra cứu pháp luật Veritas"
          className="group flex shrink-0 items-center gap-3 rounded-xl py-1 focus-visible:outline-2 focus-visible:outline-[#1d4f88]"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#142747] text-[#f6efe2] shadow-sm transition-transform group-hover:scale-105">
            <LegalLogo size={20} className="text-[#f6efe2]" />
          </div>
          <div className="flex flex-col justify-center">
            <div className="text-base font-bold leading-tight tracking-tight text-[#142747] sm:text-lg">
              Veritas <span className="font-medium text-[#56677c]">Legal</span>
            </div>
            <div className="text-[11px] font-semibold uppercase leading-tight tracking-[0.16em] text-[#8b795f] mt-0.5">
              Tra cứu có đối chiếu
            </div>
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        <div className="hidden items-center gap-8 text-sm font-semibold text-[#516278] md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-[#1d4f88] focus-visible:outline-2 focus-visible:outline-[#1d4f88]"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* CTA Buttons */}
        <div className="hidden items-center gap-3 md:flex">
          <Link
            to="/embed"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-[#1d4f88] px-5 text-sm font-bold text-white shadow-sm transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-[#153b66] active:scale-[0.98] motion-reduce:transition-none"
          >
            Bắt đầu tra cứu
          </Link>
          <Link
            to={user ? "/admin" : "/login"}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[#cbd4dd] bg-white px-5 text-sm font-bold text-[#142747] shadow-xs transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#1d4f88]"
          >
            {user ? "Vào quản trị" : "Đăng nhập"}
          </Link>
        </div>

        {/* Mobile menu button */}
        <div className="flex items-center gap-2 md:hidden">
          <Link
            to="/embed"
            className="rounded-lg bg-[#1d4f88] px-3 py-2 text-xs font-bold text-white"
          >
            Tra cứu
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label="Mở danh mục điều hướng"
            className="rounded-lg border border-[#cbd4dd] bg-white p-2 text-[#142747] hover:bg-slate-100"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer / dropdown */}
      {mobileMenuOpen && (
        <div className="border-b border-[#ccd4dd] bg-white px-5 py-4 shadow-lg md:hidden animate-fade-in-up">
          <div className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-semibold text-[#142747] hover:bg-[#f8f8f6]"
              >
                {link.label}
              </a>
            ))}
            <Link
              to="/embed"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-between rounded-lg bg-[#eef4f9] px-3 py-2.5 text-sm font-bold text-[#1d4f88]"
            >
              Không gian tra cứu pháp luật <ArrowUpRight size={16} />
            </Link>
            <div className="mt-2 pt-2 border-t border-slate-100 flex flex-col gap-2">
              <Link
                to={user ? "/admin" : "/login"}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-center rounded-xl border border-[#cbd4dd] bg-white py-2.5 text-sm font-bold text-[#142747]"
              >
                {user ? "Vào không gian quản trị" : "Đăng nhập cổng quản trị"}
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
