import { createGroupingRulesApi } from './api.js';
import { mountGroupingRulesIsland } from './grouping_rules_island.jsx';

export function mountGroupingRulesSettings({ container, notify, onSaved }) {
	return mountGroupingRulesIsland({
		container,
		api: createGroupingRulesApi(),
		notify,
		onSaved,
	});
}

const frontendApi = {
	mountGroupingRulesIsland,
	mountGroupingRulesSettings,
};

if (typeof window !== 'undefined') {
	window.NailboxFrontend = frontendApi;
	window.NailboxGroupingRules = {
		mount: mountGroupingRulesIsland,
		mountGroupingRulesIsland,
	};
}

export default frontendApi;
