/**
 * Runs tasks that share a key one at a time, in call order, while tasks with
 * different keys run concurrently. A task still runs if the one before it
 * failed.
 */
export type KeyedSerializer = <T>(key: string, task: () => Promise<T>) => Promise<T>;

export function createKeyedSerializer(): KeyedSerializer {
	const pendingTasksByKey = new Map<string, Promise<unknown>>();
	return function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
		const previousTask = pendingTasksByKey.get(key) ?? Promise.resolve();
		const result = previousTask.then(task, task);
		pendingTasksByKey.set(key, result);
		const forgetIfLatest = () => {
			if (pendingTasksByKey.get(key) === result) {
				pendingTasksByKey.delete(key);
			}
		};
		result.then(forgetIfLatest, forgetIfLatest);
		return result;
	};
}
