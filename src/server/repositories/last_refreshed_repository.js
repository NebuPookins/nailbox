import lastRefreshedModel from '../../../models/last_refreshed.js';

/**
 * @param {{
 *   lastRefreshedModelModule?: typeof lastRefreshedModel,
 * }} [dependencies]
 */
export function createLastRefreshedRepository(dependencies = {}) {
	const {
		lastRefreshedModelModule = lastRefreshedModel,
	} = dependencies;

	async function load() {
		return lastRefreshedModelModule.load();
	}

	return { load };
}

const lastRefreshedRepository = createLastRefreshedRepository();

export default lastRefreshedRepository;
