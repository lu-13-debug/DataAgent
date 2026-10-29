export async function copyShareLink(link: string, clipboard: Pick<Clipboard, 'writeText'> | undefined): Promise<boolean> {
  try { if (!clipboard) return false; await clipboard.writeText(link); return true; } catch { return false; }
}
