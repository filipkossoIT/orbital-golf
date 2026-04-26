// Helpers for the mock wallet.

export function randomPubkey(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 44; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function formatAddr(a: string): string {
  if (a.length <= 8) return a;
  return a.slice(0, 4) + '…' + a.slice(-4);
}
