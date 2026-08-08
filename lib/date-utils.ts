/** 本地自然日 YYYY-MM-DD 键：统一本地日期 key 的唯一实现 */
export function localDateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 本地自然日零点 */
export function localDayStart(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** 本地日历日加减（跨月/跨年由 Date 处理） */
export function addLocalDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

/** 本地周一作为周起点 */
export function localWeekStart(value: Date): Date {
  const start = localDayStart(value);
  const mondayOffset = (start.getDay() + 6) % 7;
  return addLocalDays(start, -mondayOffset);
}
