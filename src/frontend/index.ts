import { createAppApi, createGroupingRulesApi } from './api.js';
import { mountAuthShellIsland } from './auth_shell_island.js';
import { mountGroupingRulesIsland } from './grouping_rules_island.js';
import { mountLabelPickerIsland } from './label_picker_island.js';
import { mountLaterPickerIsland } from './later_picker_island.js';
import { mountThreadListIsland } from './thread_list_island.js';
import { mountThreadViewerIsland } from './thread_viewer_island.js';

interface GroupingRulesNotify {
	error?: (msg: string) => void;
	success?: (msg: string) => void;
}

export function mountGroupingRulesSettings({ container, notify, onSaved }: {
	container: Element;
	notify?: GroupingRulesNotify;
	onSaved?: () => void;
}) {
	return mountGroupingRulesIsland({
		container,
		api: createGroupingRulesApi() as Parameters<typeof mountGroupingRulesIsland>[0]['api'],
		notify,
		onSaved,
	});
}

const frontendApi = {
	createAppApi,
	createGroupingRulesApi,
	mountAuthShellIsland,
	mountGroupingRulesIsland,
	mountGroupingRulesSettings,
	mountLabelPickerIsland,
	mountLaterPickerIsland,
	mountThreadListIsland,
	mountThreadViewerIsland,
};

declare global {
	interface Window {
		NailboxFrontend: typeof frontendApi;
		NailboxGroupingRules: { mount: typeof mountGroupingRulesIsland; mountGroupingRulesIsland: typeof mountGroupingRulesIsland };
		NailboxLaterPicker: { mount: typeof mountLaterPickerIsland; mountLaterPickerIsland: typeof mountLaterPickerIsland };
		NailboxLabelPicker: { mount: typeof mountLabelPickerIsland; mountLabelPickerIsland: typeof mountLabelPickerIsland };
	}
}

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
	window.NailboxLabelPicker = {
		mount: mountLabelPickerIsland,
		mountLabelPickerIsland,
	};
}

export default frontendApi;
