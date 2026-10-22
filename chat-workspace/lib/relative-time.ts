/**
 * 侧栏悬停卡片里的时间:相对时间(刚刚 / 5 分钟前 / 3 小时前 / 昨天 / 3 天前 / 10月21日)
 * 和完整时间(10月21日 14:32,不是今年的带年份)。纯函数,方便测试。
 */
const pad = (value: number) => String(value).padStart(2, "0");
const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function relativeTime(date: Date, now = new Date()) {
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days === 0) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return date.getFullYear() === now.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function fullTime(date: Date, now = new Date()) {
  const day = `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}年${day}`;
}
