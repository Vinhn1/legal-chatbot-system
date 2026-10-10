import { Scale } from "lucide-react";

interface LegalLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
}

/** 
 * Biểu trưng Veritas Legal dùng thống nhất tại cổng tra cứu
 * Khi showText=false: Chỉ hiển thị icon Scale bên trong khung nhận diện
 * Khi showText=true: Hiển thị cả cụm icon và chữ thương hiệu
 */
export function LegalLogo({ size = 20, className, showText = false }: LegalLogoProps) {
  if (!showText) {
    return <Scale size={size} className={className || "text-current"} />;
  }

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className || ""}`}>
      <div
        className="flex items-center justify-center rounded-xl bg-[#142747] text-[#f6efe2] shadow-sm"
        style={{ width: size + 14, height: size + 14 }}
      >
        <Scale size={size} />
      </div>
      <div className="flex flex-col">
        <span className="font-bold tracking-tight text-[#142747]" style={{ fontSize: Math.max(14, Math.round(size * 0.75)) }}>
          Veritas<span className="text-[#56677c] font-medium"> Legal</span>
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8b795f]">
          Tra cứu có đối chiếu
        </span>
      </div>
    </div>
  );
}

