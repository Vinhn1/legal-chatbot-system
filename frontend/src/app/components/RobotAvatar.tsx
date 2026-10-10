import { useEffect, useState } from "react";

/**
 * Các trạng thái biểu cảm của Trợ lý Robot Pháp luật:
 * - idle: Trạng thái chờ, chớp mắt và nhìn quanh tự nhiên.
 * - talking: Trạng thái trả lời, miệng mấp máy phát âm.
 * - thinking: Trạng thái đang tra cứu văn bản pháp luật.
 * - happy: Trạng thái vui vẻ, thân thiện.
 */
export type RobotState = "idle" | "talking" | "thinking" | "happy";

export interface RobotAvatarProps {
  size?: number;
  state?: RobotState;
  className?: string;
}

/**
 * Mascot Trợ lý AI Pháp luật — Kế thừa thiết kế Robot tương tác sống động,
 * chuẩn hóa hệ màu Xanh Navy Hoàng gia và biểu tượng Cán Cân Công Lý trên trán.
 */
export function RobotAvatar({ size = 80, state = "idle", className }: RobotAvatarProps) {
  const [blink, setBlink] = useState(false);
  const [lookDir, setLookDir] = useState({ x: 0, y: 0 });
  const [mouthOpen, setMouthOpen] = useState(false);

  // Hiệu ứng chớp mắt tự nhiên ngẫu nhiên
  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 180);
    }, 3000 + Math.random() * 2000);
    return () => clearInterval(blinkInterval);
  }, []);

  // Hiệu ứng mấp máy khẩu hình khi đang trả lời (talking)
  useEffect(() => {
    if (state !== "talking") {
      setMouthOpen(false);
      return;
    }
    const id = setInterval(() => setMouthOpen(p => !p), 280);
    return () => clearInterval(id);
  }, [state]);

  // Hiệu ứng đảo mắt quan sát tự nhiên hoặc tập trung suy ngẫm khi tra cứu
  useEffect(() => {
    if (state === "thinking") {
      setLookDir({ x: 1.0, y: -1.2 });
      return;
    }
    const roam = () => {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.5;
      setLookDir({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    };
    const id = setInterval(roam, 2500);
    return () => clearInterval(id);
  }, [state]);

  const isHappy = state === "happy";
  const eyeScaleY = blink ? 0.08 : 1;
  const px = lookDir.x;
  const py = lookDir.y;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      style={{ overflow: "visible", display: "block" }}
      aria-label="Trợ lý Robot Pháp luật"
    >
      <defs>
        {/* Nền tròn chuyển sắc Xanh Navy Pháp luật */}
        <linearGradient id="circleBgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="35%" stopColor="#93C5FD" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>

        {/* Khung tai nghe và vòm mũ bảo vệ màu Navy đậm sang trọng */}
        <linearGradient id="headphoneGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1E3A8A" />
          <stop offset="100%" stopColor="#0F172A" />
        </linearGradient>

        {/* Gradient Vàng Gold pháp lý cho biểu tượng Cán Cân Công Lý */}
        <linearGradient id="legalGoldGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="50%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>

        {/* Mắt phát sáng công nghệ xanh Cyan hiện đại */}
        <radialGradient id="eyeIris" cx="45%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#E0F2FE" />
          <stop offset="45%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0284C7" />
        </radialGradient>

        {/* Hiệu ứng phát quang nhẹ cho ánh mắt */}
        <filter id="glowEffect">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Hiệu ứng đổ bóng có chiều sâu */}
        <filter id="shadowEffect">
          <feDropShadow dx="0" dy="2.5" stdDeviation="3" floodColor="#0A1E3D" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Quả cầu thân chính của Robot */}
      <circle cx="60" cy="60" r="41" fill="url(#circleBgGrad)" filter="url(#shadowEffect)" />
      <ellipse cx="60" cy="25" rx="28" ry="5" fill="rgba(255,255,255,0.4)" />

      {/* Biểu tượng Cán Cân Công Lý & Nhãn LEGAL AI trên trán Robot */}
      <g style={{ userSelect: "none" }}>
        {/* Cán cân công lý thu nhỏ tinh tế */}
        <g transform="translate(60, 36) scale(0.65)">
          {/* Trụ đứng */}
          <line x1="0" y1="-14" x2="0" y2="6" stroke="url(#legalGoldGrad)" strokeWidth="1.8" strokeLinecap="round" />
          {/* Đỉnh chóp trụ */}
          <circle cx="0" cy="-14" r="1.5" fill="#FDE68A" />
          {/* Đế trụ */}
          <line x1="-5" y1="6" x2="5" y2="6" stroke="url(#legalGoldGrad)" strokeWidth="1.6" strokeLinecap="round" />
          {/* Thanh đòn ngang cân bằng */}
          <line x1="-15" y1="-8" x2="15" y2="-8" stroke="url(#legalGoldGrad)" strokeWidth="1.8" strokeLinecap="round" />
          {/* Móc treo đĩa cân trái */}
          <line x1="-15" y1="-8" x2="-18" y2="-2" stroke="#F59E0B" strokeWidth="0.9" />
          <line x1="-15" y1="-8" x2="-12" y2="-2" stroke="#F59E0B" strokeWidth="0.9" />
          <path d="M -20,-2 Q -15,2 -10,-2 Z" fill="url(#legalGoldGrad)" />
          {/* Móc treo đĩa cân phải */}
          <line x1="15" y1="-8" x2="12" y2="-2" stroke="#F59E0B" strokeWidth="0.9" />
          <line x1="15" y1="-8" x2="18" y2="-2" stroke="#F59E0B" strokeWidth="0.9" />
          <path d="M 10,-2 Q 15,2 20,-2 Z" fill="url(#legalGoldGrad)" />
        </g>
        {/* Chữ định danh LEGAL AI trang nhã */}
        <text
          x="60"
          y="50"
          textAnchor="middle"
          fill="#1E3A8A"
          fontSize="7"
          fontWeight="900"
          fontFamily="'Plus Jakarta Sans','Inter',sans-serif"
          letterSpacing="0.8"
        >
          LEGAL AI
        </text>
      </g>

      {/* Vòm đai tai nghe phía trên đầu */}
      <path d="M 23,60 A 37,37 0 0,1 97,60" fill="none" stroke="url(#headphoneGrad)" strokeWidth="6" strokeLinecap="round" />
      <rect x="52" y="18" width="16" height="5" rx="2.5" fill="#BFDBFE" />

      {/* Kính bảo vệ mặt đen tuyền (Màn hình hiển thị ánh mắt) */}
      <path
        d="M 37,64 C 44,60 76,60 83,64 C 91,71 87,86 60,86 C 33,86 29,71 37,64 Z"
        fill="url(#headphoneGrad)"
        filter="url(#shadowEffect)"
      />

      {/* Mắt trái - Hốc mắt & Tròng mắt xanh công nghệ chuyển động */}
      <ellipse cx="45" cy="71" rx="10.5" ry={10.5 * eyeScaleY} fill="#09152C" style={{ transition: "ry 0.1s" }} />
      <ellipse
        cx={45 + px}
        cy={71 + py}
        rx="7"
        ry={7 * eyeScaleY}
        fill="url(#eyeIris)"
        filter="url(#glowEffect)"
        style={{ transition: "ry 0.1s, cx 0.25s, cy 0.25s" }}
      />
      <ellipse cx={45 + px} cy={71 + py} rx="3" ry={3 * eyeScaleY} fill="#050E1F" style={{ transition: "ry 0.1s" }} />
      <circle cx={47 + px} cy={68.5 + py} r="1.8" fill="white" opacity={blink ? 0 : 0.9} />
      <circle cx={43.5 + px} cy={72.5 + py} r="0.8" fill="white" opacity={blink ? 0 : 0.4} />

      {/* Mắt phải - Hốc mắt & Tròng mắt xanh công nghệ chuyển động */}
      <ellipse cx="75" cy="71" rx="10.5" ry={10.5 * eyeScaleY} fill="#09152C" style={{ transition: "ry 0.1s" }} />
      <ellipse
        cx={75 + px}
        cy={71 + py}
        rx="7"
        ry={7 * eyeScaleY}
        fill="url(#eyeIris)"
        filter="url(#glowEffect)"
        style={{ transition: "ry 0.1s, cx 0.25s, cy 0.25s" }}
      />
      <ellipse cx={75 + px} cy={71 + py} rx="3" ry={3 * eyeScaleY} fill="#050E1F" style={{ transition: "ry 0.1s" }} />
      <circle cx={77 + px} cy={68.5 + py} r="1.8" fill="white" opacity={blink ? 0 : 0.9} />
      <circle cx={73.5 + px} cy={72.5 + py} r="0.8" fill="white" opacity={blink ? 0 : 0.4} />

      {/* Khẩu hình miệng tương tác theo trạng thái */}
      {isHappy ? (
        <path d="M 52,78 Q 60,85 68,78" stroke="#38BDF8" strokeWidth="2" fill="none" strokeLinecap="round" />
      ) : mouthOpen ? (
        <ellipse cx="60" cy="78.5" rx="5" ry="3.5" fill="#09152C" stroke="#38BDF8" strokeWidth="1.2">
          <animate attributeName="ry" values="3.5;1.5;3.5" dur="0.28s" repeatCount="indefinite" />
        </ellipse>
      ) : (
        <path d="M 54,78.5 Q 60,82.5 66,78.5" stroke="#38BDF8" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      )}

      {/* Hai bên ốp tai nghe */}
      <rect x="13" y="49" width="10" height="22" rx="4.5" fill="url(#headphoneGrad)" filter="url(#shadowEffect)" />
      <rect x="97" y="49" width="10" height="22" rx="4.5" fill="url(#headphoneGrad)" filter="url(#shadowEffect)" />

      {/* Cần microphone đàm thoại tích hợp */}
      <path d="M 18,68 Q 18,97 50,96" fill="none" stroke="url(#headphoneGrad)" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="50" cy="96" r="3.5" fill="url(#headphoneGrad)" />
      <circle cx="50" cy="96" r="1.5" fill="#F59E0B" />
    </svg>
  );
}
