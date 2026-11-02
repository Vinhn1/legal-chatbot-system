import React, { useEffect, useRef, useState } from "react";

/**
 * Hook quan sát khi phần tử cuộn vào màn hình (Intersection Observer)
 * Kích hoạt hiển thị một lần duy nhất để tối ưu hiệu năng 60 FPS
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.12) {
  const ref = useRef<T>(null);
  const [isRevealed, setIsRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Tôn trọng cài đặt giảm chuyển động của hệ điều hành
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIsRevealed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsRevealed(true);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold, rootMargin: "0px 0px -40px 0px" }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [threshold]);

  return { ref, isRevealed };
}

/**
 * Component bao bọc phần tử với hiệu ứng xuất hiện khi cuộn tới
 */
export interface ScrollRevealProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  delay?: 0 | 1 | 2 | 3 | 4;
  className?: string;
}

export function ScrollReveal({ children, delay = 0, className = "", ...props }: ScrollRevealProps) {
  const { ref, isRevealed } = useScrollReveal();
  const delayClass = delay > 0 ? `stagger-${delay}` : "";

  return (
    <div
      ref={ref}
      className={`scroll-reveal ${delayClass} ${isRevealed ? "is-revealed" : ""} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Hook tạo hiệu ứng số nhảy tăng dần mượt mà khi phần tử xuất hiện trong màn hình
 */
export function useAnimatedCounter(targetValue: number, isVisible: boolean, durationMs = 1000) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isVisible || targetValue <= 0) {
      if (targetValue > 0 && !isVisible) {
        setCount(0);
      }
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCount(targetValue);
      return;
    }

    const start = 0;
    const startTime = performance.now();

    function step(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      // Easing hàm bậc ba êm dịu (ease-out cubic)
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const currentVal = Math.round(start + (targetValue - start) * easeProgress);

      setCount(currentVal);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        setCount(targetValue);
      }
    }

    const frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [targetValue, isVisible, durationMs]);

  return count;
}
