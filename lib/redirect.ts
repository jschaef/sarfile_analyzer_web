// Only same-origin paths are accepted as redirect target after login.
export function safeNext(value: string | null | undefined): string {
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return value;
  return "/overview";
}
