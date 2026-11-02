import { useId } from "react";

/**
 * Các trạng thái biểu cảm của Avatar Trợ lý Pháp luật AI:
 * - idle: Trạng thái chờ (đầu lơ lửng nhẹ, mắt viên thuốc chớp và liếc tự nhiên, miệng mỉm cười).
 * - searching: Trạng thái đang tra cứu (mắt đảo nhanh, tia quét laser cyan chạy ngang mặt kính hiển thị).
 * - talking: Trạng thái đang trả lời (khẩu hình miệng elip mấp máy phát âm rõ ràng).
 * - happy: Trạng thái đã tìm thấy (mắt cười cong vút, đầu nảy vui vẻ, bật huy hiệu dấu tích xanh công lý).
 * - thinking: Bí danh tương thích ngược của trạng thái searching.
 */
export type RobotState = "idle" | "searching" | "talking" | "happy" | "thinking";

export interface RobotAvatarProps {
  size?: number;
  state?: RobotState;
  className?: string;
}

/**
 * Avatar Trợ lý Pháp luật AI — Thiết kế đầu tròn quả cầu với kính hiển thị phát sáng công nghệ,
 * khung hình SVG được căn chỉnh tối đa tỷ lệ khuôn mặt (Tight ViewBox 1:1) giúp biểu cảm to, rõ và sắc nét.
 */
export function RobotAvatar({ size = 80, state = "idle", className }: RobotAvatarProps) {
  const rawId = useId().replace(/:/g, "");
  const normalizedState = state === "thinking" ? "searching" : state;

  const headGradId = `gHead-${rawId}`;
  const visorGradId = `gVisor-${rawId}`;
  const scanGradId = `gScan-${rawId}`;
  const glowGradId = `gGlow-${rawId}`;
  const visorClipId = `cVisor-${rawId}`;
  const neonGlowId = `neonGlow-${rawId}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="26 8 148 144"
      data-state={normalizedState}
      className={`veritas-robot-avatar ${className ?? ""}`.trim()}
      style={{ overflow: "visible", display: "block" }}
      role="img"
      aria-label="Avatar trợ lý pháp luật AI"
    >
      <defs>
        {/* Gradient màu quả cầu đầu tròn: Xanh lam sáng chuyển dần sang Xanh Hoàng gia và Tím chàm */}
        <linearGradient id={headGradId} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#a5d8ff" />
          <stop offset="0.4" stopColor="#4f6df5" />
          <stop offset="1" stopColor="#281a98" />
        </linearGradient>

        {/* Gradient mặt kính hiển thị Visor đen bóng chiều sâu */}
        <linearGradient id={visorGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f1b3d" />
          <stop offset="1" stopColor="#04091a" />
        </linearGradient>

        {/* Tia quét laser cyan đa tầng phát sáng mạnh khi đang tra cứu */}
        <linearGradient id={scanGradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#38bdf8" stopOpacity="0.2" />
          <stop offset="0.5" stopColor="#67e8f9" stopOpacity="1" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0.2" />
        </linearGradient>

        {/* Quầng sáng tỏa tròn phía sau quả cầu */}
        <radialGradient id={glowGradId}>
          <stop offset="0" stopColor="#60a5fa" stopOpacity="0.6" />
          <stop offset="1" stopColor="#60a5fa" stopOpacity="0" />
        </radialGradient>

        {/* Bộ lọc Neon Glow tăng độ sáng rực cho đôi mắt và tia laser trên màn hình kính */}
        <filter id={neonGlowId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Vùng giới hạn mặt kính hiển thị bo tròn */}
        <clipPath id={visorClipId}>
          <rect x="56" y="60" width="88" height="48" rx="24" />
        </clipPath>
      </defs>

      {/* Bóng đổ mặt đất sát dưới cằm robot */}
      <ellipse className="shadow" cx="100" cy="144" rx="36" ry="4.5" fill="rgba(15,23,42,0.28)" />
      <circle className="glow" cx="100" cy="82" r="88" fill={`url(#${glowGradId})`} />

      {/* Khối đầu robot chuyển động lơ lửng và nảy khi vui mừng */}
      <g className="float">
        {/* Hai ốp tai hai bên với đèn LED chỉ thị */}
        <rect x="35" y="66" width="14" height="34" rx="7" fill="#1e2a78" stroke="#2e3e9e" strokeWidth="1" />
        <rect x="151" y="66" width="14" height="34" rx="7" fill="#1e2a78" stroke="#2e3e9e" strokeWidth="1" />
        <rect x="39" y="74" width="4" height="18" rx="2" fill="#67e8f9" filter={`url(#${neonGlowId})`} />
        <rect x="157" y="74" width="4" height="18" rx="2" fill="#67e8f9" filter={`url(#${neonGlowId})`} />

        {/* Quả cầu đầu chính và vệt sáng phản quang 3D */}
        <circle cx="100" cy="82" r="56" fill={`url(#${headGradId})`} />
        <path
          d="M58 52 Q72 30 104 28"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.5"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="62" cy="64" r="3" fill="#ffffff" opacity="0.8" />

        {/* Mặt kính hiển thị Visor đen bóng */}
        <rect x="56" y="60" width="88" height="48" rx="24" fill={`url(#${visorGradId})`} />
        <rect
          x="56.8"
          y="60.8"
          width="86.4"
          height="46.4"
          rx="23.2"
          fill="none"
          stroke="#67e8f9"
          strokeOpacity="0.4"
          strokeWidth="1.4"
        />

        {/* Tia quét laser cyan chạy ngang màn hình kính khi đang tra cứu */}
        <rect
          className="scan"
          x="56"
          y="60"
          width="14"
          height="48"
          fill={`url(#${scanGradId})`}
          clipPath={`url(#${visorClipId})`}
          filter={`url(#${neonGlowId})`}
        />

        {/* Đôi mắt viên thuốc công nghệ (Mắt to, dày, sắc nét và phát sáng neon) */}
        <g className="eyes" filter={`url(#${neonGlowId})`}>
          <rect x="71" y="71" width="18" height="26" rx="9" fill="#38bdf8" opacity="0.25" />
          <rect x="111" y="71" width="18" height="26" rx="9" fill="#38bdf8" opacity="0.25" />
          <rect className="eye" x="74" y="74" width="12" height="20" rx="6" fill="#67e8f9" />
          <rect className="eye" x="114" y="74" width="12" height="20" rx="6" fill="#67e8f9" />
        </g>

        {/* Đôi mắt cười cong vút khi đã tìm thấy căn cứ pháp luật */}
        <g
          className="eyes-happy"
          fill="none"
          stroke="#67e8f9"
          strokeWidth="5.5"
          strokeLinecap="round"
          filter={`url(#${neonGlowId})`}
        >
          <path d="M72 90 Q80 74 88 90" />
          <path d="M112 90 Q120 74 128 90" />
        </g>

        {/* Miệng cười tự nhiên và khẩu hình miệng mấp máy khi trả lời */}
        <path
          className="mouth-smile"
          d="M90 99 Q100 107 110 99"
          stroke="#67e8f9"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          filter={`url(#${neonGlowId})`}
        />
        <ellipse
          className="mouth-talk"
          cx="100"
          cy="100"
          rx="8"
          ry="6.5"
          fill="#67e8f9"
          filter={`url(#${neonGlowId})`}
        />

        {/* Huy hiệu dấu tích xanh lá to, bật nảy rõ ràng khi tìm thấy căn cứ pháp lý */}
        <g className="check">
          <circle cx="148" cy="36" r="13" fill="#16a34a" stroke="#ffffff" strokeWidth="2.5" />
          <path
            d="M141.5 36.5 L146 41 L154.5 31.5"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}
