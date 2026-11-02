import { useEffect, useRef, useState } from "react";
import type { ElementType } from "react";
import { Check, ChevronDown } from "lucide-react";

/** Định nghĩa tùy chọn trong danh sách bộ lọc */
export interface FilterOption {
  value: string;
  label: string;
  icon?: ElementType;
  iconColor?: string;
  dotColor?: string;
  badge?: string;
}

export interface FilterDropdownProps {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  icon?: ElementType;
  ariaLabel?: string;
  className?: string;
}

/**
 * Thành phần Dropdown bộ lọc chuyên nghiệp thay thế thẻ select HTML nguyên bản.
 * Hỗ trợ biểu tượng đại diện, huy hiệu trạng thái, chỉ báo lựa chọn và hiệu ứng mở mượt mà.
 */
export function FilterDropdown({
  label,
  value,
  options,
  onChange,
  icon: Icon,
  ariaLabel,
  className = "",
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];
  const isFiltered = value !== "all";

  // Đóng dropdown khi nhấn ra ngoài
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const SelectedOptionIcon = selectedOption?.icon;

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      {/* Nút kích hoạt dropdown (Trigger Button) */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || label}
        className={`group inline-flex h-11 items-center justify-between gap-2.5 rounded-xl border px-3.5 text-xs sm:text-sm font-semibold transition-all duration-150 outline-none select-none ${
          isFiltered
            ? "border-[#1d4f88]/40 dark:border-sky-500/50 bg-[#1d4f88]/5 dark:bg-sky-500/15 text-[#1d4f88] dark:text-sky-300 shadow-xs hover:bg-[#1d4f88]/10 hover:border-[#1d4f88] dark:hover:border-sky-400"
            : "border-[#cbd5df] dark:border-zinc-800 bg-white dark:bg-zinc-900 text-[#142747] dark:text-zinc-200 shadow-2xs hover:border-[#94a3b8] hover:bg-slate-50/80 dark:hover:bg-zinc-800"
        } ${isOpen ? "ring-2 ring-[#1d4f88]/15 dark:ring-sky-500/20 border-[#1d4f88] dark:border-sky-500" : ""}`}
      >
        <span className="flex items-center gap-2 truncate">
          {Icon && (
            <Icon
              size={16}
              className={`shrink-0 transition-colors ${
                isFiltered ? "text-[#1d4f88] dark:text-sky-300" : "text-[#7c8b9d] dark:text-zinc-400 group-hover:text-[#142747] dark:group-hover:text-zinc-100"
              }`}
            />
          )}

          {selectedOption?.dotColor && (
            <span className={`size-2 shrink-0 rounded-full ${selectedOption.dotColor}`} />
          )}

          {!selectedOption?.dotColor && SelectedOptionIcon && isFiltered && (
            <SelectedOptionIcon
              size={15}
              className={`shrink-0 ${selectedOption.iconColor || "text-[#1d4f88] dark:text-sky-300"}`}
            />
          )}

          <span className="truncate">
            {isFiltered ? (
              <span>
                <span className="text-[11px] font-normal text-[#56677c] dark:text-zinc-400 mr-1 hidden md:inline">
                  {label}:
                </span>
                <span className="font-semibold">{selectedOption?.label || value}</span>
              </span>
            ) : (
              selectedOption?.label || label
            )}
          </span>
        </span>

        <ChevronDown
          size={15}
          className={`shrink-0 transition-transform duration-200 ease-in-out ${
            isFiltered ? "text-[#1d4f88] dark:text-sky-300" : "text-[#7c8b9d] dark:text-zinc-400"
          } ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Menu danh sách các lựa chọn (Floating Popover) */}
      {isOpen && (
        <div
          role="listbox"
          tabIndex={-1}
          className="absolute right-0 sm:left-0 sm:right-auto z-50 mt-1.5 min-w-[210px] w-max max-w-[280px] origin-top rounded-2xl border border-slate-200/90 dark:border-zinc-800 bg-white/98 dark:bg-zinc-900/98 p-1.5 shadow-xl shadow-slate-900/10 dark:shadow-black/60 backdrop-blur-md transition-all duration-150 animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold tracking-wider text-slate-400 dark:text-zinc-500 uppercase">
            {label}
          </div>

          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-0.5 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-zinc-700">
            {options.map((option) => {
              const isSelected = option.value === value;
              const OptionIcon = option.icon;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs sm:text-sm transition-colors duration-100 outline-none select-none ${
                    isSelected
                      ? "bg-[#1d4f88]/8 dark:bg-sky-500/15 text-[#1d4f88] dark:text-sky-300 font-semibold"
                      : "text-slate-700 dark:text-zinc-300 font-medium hover:bg-slate-100/80 dark:hover:bg-zinc-800 hover:text-[#142747] dark:hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    {option.dotColor && (
                      <span className={`size-2 shrink-0 rounded-full ${option.dotColor}`} />
                    )}

                    {OptionIcon && (
                      <OptionIcon
                        size={15}
                        className={`shrink-0 ${option.iconColor || "text-slate-500 dark:text-zinc-400"}`}
                      />
                    )}

                    <span className="truncate">{option.label}</span>
                  </span>

                  {isSelected && (
                    <Check size={15} className="shrink-0 text-[#1d4f88] dark:text-sky-300 stroke-[2.5]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
