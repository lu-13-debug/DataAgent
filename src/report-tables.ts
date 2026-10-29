import type { Report } from './types';
export function channelTablePage(channels: Report['channels'], query: string, page: number, size = 25) {
  const keyword = query.trim().toLocaleLowerCase(); const matches = keyword ? channels.filter(channel => channel.name.toLocaleLowerCase().includes(keyword)) : channels;
  const pageSize = Number.isSafeInteger(size) ? Math.max(1, Math.min(100, size)) : 25; const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const current = Number.isSafeInteger(page) ? Math.max(0, Math.min(pages - 1, page)) : 0;
  return { rows: matches.slice(current * pageSize, (current + 1) * pageSize), matches, matched: matches.length, page: current, pages, pageSize };
}
