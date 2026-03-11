import { createAppApi, createGroupingRulesApi } from './api.js';
import { mountGroupingRulesIsland } from './grouping_rules_island.jsx';
import { mountLaterPickerIsland } from './later_picker_island.jsx';

export function mountGroupingRulesSettings({ container, notify, onSaved }) {
	return mountGroupingRulesIsland({
		container,
		api: createGroupingRulesApi(),
		notify,
		onSaved,
	});
}

const frontendApi = {
	createAppApi,
	createGroupingRulesApi,
	mountGroupingRulesIsland,
	mountGroupingRulesSettings,
	mountLaterPickerIsland,
};

if (typeof window !== 'undefined') {
	window.NailboxFrontend = frontendApi;
	window.NailboxGroupingRules = {
		mount: mountGroupingRulesIsland,
		mountGroupingRulesIsland,
	};
	window.NailboxLaterPicker = {
		mount: mountLaterPickerIsland,
		mountLaterPickerIsland,
	};
}

export default frontendApi;
