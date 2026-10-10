/**
 * Maps items through an async mapper with at most `limit` calls in flight at
 * once, returning the results in input order.
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(items[index]);
		}
	};
	await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
	return results;
}
