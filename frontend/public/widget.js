/**
 * Legal AI Chatbot - Embeddable Web Widget
 * Lightweight standalone loader script
 */
(function () {
  "use strict";

  // Tránh load lặp lại nhiều lần
  if (window.__LegalWidgetLoaded) return;
  window.__LegalWidgetLoaded = true;

  // Tìm script tag hiện tại để đọc cấu hình data-*
  var currentScript =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (scripts[i].src && scripts[i].src.indexOf("widget.js") !== -1) {
          return scripts[i];
        }
      }
      return null;
    })();

  var scriptSrc = currentScript ? currentScript.src : "";
  var defaultBaseUrl = "";
  if (scriptSrc) {
    var urlObj = new URL(scriptSrc);
    defaultBaseUrl = urlObj.origin;
  } else {
    defaultBaseUrl = window.location.origin;
  }

  // Đọc cấu hình tùy biến được lưu từ Admin Portal nếu có
  var savedThemeColor = null;
  var savedBotName = null;
  var savedGreeting = null;
  var savedPosition = null;
  try {
    savedThemeColor = localStorage.getItem("legal_widget_theme_color");
    savedBotName = localStorage.getItem("legal_widget_bot_name");
    savedGreeting = localStorage.getItem("legal_widget_greeting");
    savedPosition = localStorage.getItem("legal_widget_position");
  } catch (_) { }

  // Cấu hình widget
  var config = {
    baseUrl: (currentScript && currentScript.getAttribute("data-chat-url")) || defaultBaseUrl,
    position: (currentScript && currentScript.getAttribute("data-position")) || savedPosition || "bottom-right",
    themeColor: (currentScript && currentScript.getAttribute("data-theme-color")) || savedThemeColor || "#005BAA",
    botName: (currentScript && currentScript.getAttribute("data-bot-name")) || savedBotName || "Trợ lý Pháp luật",
    greeting: (currentScript && currentScript.getAttribute("data-greeting")) || savedGreeting || "",
    autoOpen: (currentScript && currentScript.getAttribute("data-auto-open")) === "true",
  };

  // Custom style injection
  var style = document.createElement("style");
  style.id = "legal-widget-styles";
  style.innerHTML = `
    .mbf-widget-container {
      position: fixed;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      box-sizing: border-box;
    }
    .mbf-widget-bottom-right {
      bottom: 20px;
      right: 20px;
    }
    .mbf-widget-bottom-left {
      bottom: 20px;
      left: 20px;
    }
    .mbf-widget-launcher {
      width: 78px;
      height: 78px;
      border-radius: 50%;
      background: transparent;
      box-shadow: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      position: relative;
      user-select: none;
      border: none;
      outline: none;
      padding: 0;
      overflow: visible;
    }
    .mbf-widget-launcher:hover {
      transform: scale(1.1) translateY(-3px);
    }
    .mbf-widget-launcher:active {
      transform: scale(0.95);
    }
    .mbf-widget-launcher.mbf-open-state {
      width: 60px;
      height: 60px;
      background: linear-gradient(135deg, ${config.themeColor} 0%, #0c1829 100%);
      border: 2px solid #ffffff;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
      margin: 18px;
    }
    .mbf-widget-launcher-icon {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mbf-widget-badge {
      position: absolute;
      top: 2px;
      right: 2px;
      background-color: #ef4444;
      color: white;
      border: 2px solid white;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: bold;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: mbf-pulse 2s infinite;
      z-index: 10;
    }
    @keyframes mbf-pulse {
      0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
      70% { transform: scale(1.1); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
      100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
    }
    .mbf-widget-tooltip {
      position: absolute;
      right: 90px;
      top: 50%;
      background: rgba(9, 21, 44, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(48, 176, 235, 0.3);
      border-radius: 14px;
      padding: 10px 16px;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s ease, transform 0.2s ease;
      transform: translateY(-50%) translateX(10px);
      z-index: 2147483645;
    }
    .mbf-widget-bottom-left .mbf-widget-tooltip {
      right: auto;
      left: 90px;
      transform: translateY(-50%) translateX(-10px);
    }
    .mbf-widget-container:hover .mbf-widget-tooltip {
      opacity: 1;
      visibility: visible;
      transform: translateY(-50%) translateX(0);
    }
    .mbf-widget-tooltip-title {
      color: #ffffff;
      font-size: 13px;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .mbf-widget-tooltip-sub {
      color: #87D5F8;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 2px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .mbf-widget-tooltip-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22C55E;
      box-shadow: 0 0 6px #22C55E;
      display: inline-block;
    }
    .mbf-widget-iframe-container {
      position: fixed;
      bottom: 92px;
      width: 380px;
      height: 600px;
      max-height: calc(100vh - 110px);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.08);
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.08);
      opacity: 0;
      visibility: hidden;
      transform: translateY(20px) scale(0.95);
      transform-origin: bottom right;
      transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.25s ease;
      z-index: 2147483646;
    }
    .mbf-widget-bottom-right .mbf-widget-iframe-container {
      right: 20px;
      transform-origin: bottom right;
    }
    .mbf-widget-bottom-left .mbf-widget-iframe-container {
      left: 20px;
      transform-origin: bottom left;
    }
    .mbf-widget-iframe-container.mbf-open {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
    }
    .mbf-widget-iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }
    /* Mobile responsive */
    @media (max-width: 640px) {
      .mbf-widget-iframe-container {
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-height: 100vh !important;
        border-radius: 0 !important;
        border: none !important;
        z-index: 2147483647 !important;
      }
      .mbf-widget-tooltip {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);

  // Tạo DOM Elements
  var container = document.createElement("div");
  container.className = "mbf-widget-container mbf-widget-" + config.position;

  // Iframe chat container
  var iframeContainer = document.createElement("div");
  iframeContainer.className = "mbf-widget-iframe-container";

  // Xây dựng URL params cho /embed
  var embedParams = new URLSearchParams();
  embedParams.set("theme", config.themeColor);
  embedParams.set("title", config.botName);
  if (config.greeting) {
    embedParams.set("greeting", config.greeting);
  }

  var iframeUrl = config.baseUrl.replace(/\/$/, "") + "/embed?" + embedParams.toString();

  var iframe = document.createElement("iframe");
  iframe.className = "mbf-widget-iframe";
  iframe.src = iframeUrl;
  iframe.title = config.botName;
  iframe.allow = "microphone; camera";
  iframeContainer.appendChild(iframe);

  // Tooltip
  var tooltip = document.createElement("div");
  tooltip.className = "mbf-widget-tooltip";
  tooltip.innerHTML = `
    <div class="mbf-widget-tooltip-title">
      ${config.botName || "Trợ lý Tra cứu Pháp luật Việt Nam"}
    </div>
    <div class="mbf-widget-tooltip-sub">
      <span class="mbf-widget-tooltip-dot"></span> Trực tuyến · Sẵn sàng hỗ trợ pháp lý
    </div>
  `;
  container.appendChild(tooltip);

  // Nút launcher tròn
  var launcher = document.createElement("button");
  launcher.className = "mbf-widget-launcher";
  launcher.setAttribute("aria-label", "Mở Trợ lý Pháp luật");

  // SVG Mascot Robot Pháp luật — Giữ nguyên tạo hình robot, chuẩn hóa màu Navy/Gold và Cán Cân Công Lý
  var legalRobotAvatarSvg = `
    <svg width="78" height="78" viewBox="0 0 120 120" style="overflow: visible; display: block; filter: drop-shadow(0 8px 20px rgba(15, 23, 42, 0.35));">
      <defs>
        <linearGradient id="legalCircleBgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="35%" stop-color="#93C5FD" />
          <stop offset="100%" stop-color="#2563EB" />
        </linearGradient>
        <linearGradient id="legalHeadphoneGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1E3A8A" />
          <stop offset="100%" stop-color="#0F172A" />
        </linearGradient>
        <linearGradient id="legalGoldGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FDE68A" />
          <stop offset="50%" stop-color="#F59E0B" />
          <stop offset="100%" stop-color="#D97706" />
        </linearGradient>
        <radialGradient id="legalEyeIris" cx="45%" cy="40%" r="55%">
          <stop offset="0%" stop-color="#E0F2FE" />
          <stop offset="45%" stop-color="#38BDF8" />
          <stop offset="100%" stop-color="#0284C7" />
        </radialGradient>
        <filter id="legalGlowEffect">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="legalShadowEffect">
          <feDropShadow dx="0" dy="2.5" stdDeviation="3" flood-color="#0A1E3D" flood-opacity="0.35" />
        </filter>
      </defs>

      <circle cx="60" cy="60" r="41" fill="url(#legalCircleBgGrad)" filter="url(#legalShadowEffect)" />
      <ellipse cx="60" cy="25" rx="28" ry="5" fill="rgba(255,255,255,0.4)" />

      <!-- Cán Cân Công Lý và định danh LEGAL AI trên trán -->
      <g style="user-select: none;">
        <g transform="translate(60, 36) scale(0.65)">
          <line x1="0" y1="-14" x2="0" y2="6" stroke="url(#legalGoldGrad)" stroke-width="1.8" stroke-linecap="round" />
          <circle cx="0" cy="-14" r="1.5" fill="#FDE68A" />
          <line x1="-5" y1="6" x2="5" y2="6" stroke="url(#legalGoldGrad)" stroke-width="1.6" stroke-linecap="round" />
          <line x1="-15" y1="-8" x2="15" y2="-8" stroke="url(#legalGoldGrad)" stroke-width="1.8" stroke-linecap="round" />
          <line x1="-15" y1="-8" x2="-18" y2="-2" stroke="#F59E0B" stroke-width="0.9" />
          <line x1="-15" y1="-8" x2="-12" y2="-2" stroke="#F59E0B" stroke-width="0.9" />
          <path d="M -20,-2 Q -15,2 -10,-2 Z" fill="url(#legalGoldGrad)" />
          <line x1="15" y1="-8" x2="12" y2="-2" stroke="#F59E0B" stroke-width="0.9" />
          <line x1="15" y1="-8" x2="18" y2="-2" stroke="#F59E0B" stroke-width="0.9" />
          <path d="M 10,-2 Q 15,2 20,-2 Z" fill="url(#legalGoldGrad)" />
        </g>
        <text
          x="60"
          y="50"
          text-anchor="middle"
          fill="#1E3A8A"
          font-size="7"
          font-weight="900"
          font-family="'Plus Jakarta Sans','Inter',sans-serif"
          letter-spacing="0.8"
        >
          LEGAL AI
        </text>
      </g>

      <path d="M 23,60 A 37,37 0 0,1 97,60" fill="none" stroke="url(#legalHeadphoneGrad)" stroke-width="6" stroke-linecap="round" />
      <rect x="52" y="18" width="16" height="5" rx="2.5" fill="#BFDBFE" />
      <path d="M 37,64 C 44,60 76,60 83,64 C 91,71 87,86 60,86 C 33,86 29,71 37,64 Z" fill="url(#legalHeadphoneGrad)" filter="url(#legalShadowEffect)" />

      <ellipse cx="45" cy="71" rx="10.5" ry="10.5" fill="#09152C" />
      <ellipse cx="75" cy="71" rx="10.5" ry="10.5" fill="#09152C" />
      <ellipse cx="45" cy="71" rx="7" ry="7" fill="url(#legalEyeIris)" filter="url(#legalGlowEffect)" />
      <ellipse cx="45" cy="71" rx="3" ry="3" fill="#050E1F" />
      <circle cx="47" cy="68.5" r="1.8" fill="white" opacity="0.9" />
      <circle cx="43.5" cy="72.5" r="0.8" fill="white" opacity="0.4" />

      <ellipse cx="75" cy="71" rx="7" ry="7" fill="url(#legalEyeIris)" filter="url(#legalGlowEffect)" />
      <ellipse cx="75" cy="71" rx="3" ry="3" fill="#050E1F" />
      <circle cx="77" cy="68.5" r="1.8" fill="white" opacity="0.9" />
      <circle cx="73.5" cy="72.5" r="0.8" fill="white" opacity="0.4" />

      <path d="M 54,78.5 Q 60,82.5 66,78.5" stroke="#38BDF8" stroke-width="1.6" fill="none" stroke-linecap="round" />

      <rect x="13" y="49" width="10" height="22" rx="4.5" fill="url(#legalHeadphoneGrad)" filter="url(#legalShadowEffect)" />
      <rect x="97" y="49" width="10" height="22" rx="4.5" fill="url(#legalHeadphoneGrad)" filter="url(#legalShadowEffect)" />

      <path d="M 18,68 Q 18,97 50,96" fill="none" stroke="url(#legalHeadphoneGrad)" stroke-width="3.2" stroke-linecap="round" />
      <circle cx="50" cy="96" r="3.5" fill="url(#legalHeadphoneGrad)" />
      <circle cx="50" cy="96" r="1.5" fill="#F59E0B" />
    </svg>
  `;

  var closeIconSvg = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  var iconWrapper = document.createElement("div");
  iconWrapper.className = "mbf-widget-launcher-icon";
  iconWrapper.innerHTML = legalRobotAvatarSvg;
  launcher.appendChild(iconWrapper);

  // Badge tin nhắn
  var badge = document.createElement("div");
  badge.className = "mbf-widget-badge";
  badge.innerText = "1";
  launcher.appendChild(badge);

  function mount() {
    if (!document.body) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", mount);
      } else {
        setTimeout(mount, 30);
      }
      return;
    }

    if (!document.getElementById("legal-widget-styles")) {
      document.head.appendChild(style);
    }
    container.appendChild(iframeContainer);
    container.appendChild(launcher);
    document.body.appendChild(container);
  }

  mount();

  var isOpen = false;

  function toggleWidget() {
    isOpen = !isOpen;
    if (isOpen) {
      iframeContainer.classList.add("mbf-open");
      launcher.classList.add("mbf-open-state");
      iconWrapper.innerHTML = closeIconSvg;
      badge.style.display = "none";
      tooltip.style.display = "none";
    } else {
      iframeContainer.classList.remove("mbf-open");
      launcher.classList.remove("mbf-open-state");
      iconWrapper.innerHTML = miaAvatarSvg;
      tooltip.style.display = "";
    }
  }

  function openWidget() {
    if (!isOpen) toggleWidget();
  }

  function closeWidget() {
    if (isOpen) toggleWidget();
  }

  launcher.addEventListener("click", toggleWidget);

  // Lắng nghe sự kiện postMessage từ trang iframe chat
  window.addEventListener("message", function (event) {
    if (!event.data || typeof event.data !== "object") return;

    if (event.data.type === "LEGAL_WIDGET_CLOSE") {
      closeWidget();
    } else if (event.data.type === "LEGAL_WIDGET_OPEN") {
      openWidget();
    } else if (event.data.type === "LEGAL_WIDGET_MESSAGE_RECEIVED") {
      if (!isOpen && badge) {
        badge.style.display = "flex";
      }
    }
  });

  if (config.autoOpen) {
    setTimeout(openWidget, 1000);
  }

  // Export Global API
  window.LegalWidget = {
    open: openWidget,
    close: closeWidget,
    toggle: toggleWidget,
    isOpen: function () {
      return isOpen;
    },
  };
})();
