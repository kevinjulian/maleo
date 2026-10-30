const LIMIT = 64 * 1024 * 1024;
const held = new Map<symbol, number>();
let used = 0;

/** Main-thread ledger shared by every media worker in this tab. Borrowed Files cost zero. */
export function reserveSourceMemory(owner: symbol, bytes: number): boolean {
	if (!Number.isSafeInteger(bytes) || bytes < 0 || used + bytes > LIMIT) return false;
	used += bytes;
	held.set(owner, (held.get(owner) ?? 0) + bytes);
	return true;
}
export function releaseSourceMemory(owner: symbol, bytes?: number): void {
	const current = held.get(owner) ?? 0;
	const count = bytes === undefined ? current : Math.min(current, Math.max(0, bytes));
	used -= count;
	if (current === count) held.delete(owner);
	else held.set(owner, current - count);
}
