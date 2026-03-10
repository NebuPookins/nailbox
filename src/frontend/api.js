async function readResponseError(response) {
	try {
		const body = await response.json();
		if (body && typeof body.humanErrorMessage === 'string') {
			return body.humanErrorMessage;
		}
	} catch (error) {
		// Ignore JSON parse errors and fall back to status text below.
	}
	return response.statusText || `Request failed with status ${response.status}`;
}

export async function fetchJson(url, options = {}) {
	const response = await fetch(url, {
		headers: {
			Accept: 'application/json',
			...(options.body ? {'Content-Type': 'application/json'} : {}),
			...options.headers,
		},
		...options,
	});
	if (!response.ok) {
		throw new Error(await readResponseError(response));
	}
	return response.json();
}

export function createGroupingRulesApi() {
	return {
		loadRules() {
			return fetchJson('/api/email-grouping-rules');
		},
		saveRules(payload) {
			return fetchJson('/api/email-grouping-rules', {
				method: 'POST',
				body: JSON.stringify(payload),
			});
		},
	};
}
