function escapeHtml(value) {
	if (typeof value !== 'string') {
		return '';
	}
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function renderSetupNeededContent(message) {
	return {
		statusHtml:
			'<h1>Google OAuth setup required</h1>' +
			'<p>' + escapeHtml(message || 'Configure Google OAuth before Nailbox can talk to Gmail.') + '</p>' +
			'<p><a class="btn btn-primary" href="/setup">Open setup</a></p>',
		authControlsHtml: '',
	};
}

export function renderDisconnectedContent(message) {
	return {
		statusHtml:
			'<h1>Connect Gmail</h1>' +
			'<p>' + escapeHtml(message || 'Gmail is not connected.') + '</p>' +
			'<p><a class="btn btn-primary" href="/auth/google/start">Connect Gmail</a> ' +
			'<a class="btn btn-default" href="/setup">Review setup</a></p>',
		authControlsHtml: '<a class="btn btn-primary btn-sm" href="/auth/google/start">Connect Gmail</a>',
	};
}

export function renderConnectedContent(authStatus = {}) {
	return {
		statusHtml:
			'<h1>Loading Nailbox</h1>' +
			'<p>Reading cached mail and refreshing Gmail in the background...</p>',
		authControlsHtml:
			'<span class="text-muted" style="margin-right:10px;">' +
			escapeHtml(authStatus.emailAddress || 'Connected') +
			'</span>' +
			'<button class="btn btn-default btn-sm" id="refresh-now-btn">Sync Gmail</button> ' +
			'<button class="btn btn-warning btn-sm" id="disconnect-gmail-btn">Disconnect</button>',
	};
}

