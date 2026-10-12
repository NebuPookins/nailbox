/**
 * The items whose key hasn't appeared earlier in the array, in input order.
 */
export function uniqBy<T>(items: readonly T[], key: (item: T) => unknown): T[] {
	const seenKeys = new Set<unknown>();
	return items.filter((item) => {
		const itemKey = key(item);
		if (seenKeys.has(itemKey)) {
			return false;
		}
		seenKeys.add(itemKey);
		return true;
	});
}

/**
 * The item with the highest score (the earliest one on ties), or undefined if
 * the array is empty.
 */
export function maxBy<T>(items: readonly T[], score: (item: T) => number): T | undefined {
	return items.reduce<T | undefined>(
		(best, item) => best === undefined || score(item) > score(best) ? item : best,
		undefined,
	);
}
