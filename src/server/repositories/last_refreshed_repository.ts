import lastRefreshedModel from '../../../models/last_refreshed.js';

export function createLastRefreshedRepository(dependencies: {
	lastRefreshedModelModule?: typeof lastRefreshedModel;
} = {}) {
	const {
		lastRefreshedModelModule = lastRefreshedModel,
	} = dependencies;

	async function load() {
		return lastRefreshedModelModule.load();
	}

	return {load};
}

const lastRefreshedRepository = createLastRefreshedRepository();

export default lastRefreshedRepository;
