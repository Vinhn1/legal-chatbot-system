/** Phát hiện ký tự điều khiển mà không dùng biểu thức chứa mã điều khiển bị cấm bởi lint. */
export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => character.charCodeAt(0) < 32);
}
