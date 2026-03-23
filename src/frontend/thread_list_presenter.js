// @ts-nocheck
function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function formatPrettyTimestamp(timestamp, momentLib = globalThis.moment) {
	if (!momentLib || typeof momentLib !== 'function') {
		return escapeHtml(timestamp);
	}
	var now = momentLib();
	var momentToFormat = momentLib(timestamp);
	if (momentToFormat.isSame(now, 'day')) {
		return momentToFormat.format('h:mm A');
	}
	if (momentToFormat.isSame(now, 'week')) {
		return momentToFormat.format('ddd h:mm A');
	}
	if (momentToFormat.isSame(now, 'year')) {
		return momentToFormat.format('MMM Do');
	}
	return momentToFormat.format('YYYY-MMM-DD');
}

export function formatReadTime(totalSeconds) {
	if (typeof totalSeconds !== 'number' || totalSeconds < 0) {
		return '';
	}
	if (totalSeconds === 0) {
		return '0 sec read';
	}
	if (totalSeconds < 60) {
		return totalSeconds + ' sec read';
	}
	var minutes = Math.round(totalSeconds / 60);
	if (minutes <= 1) {
		return '1 min read';
	}
	return minutes + ' min read';
}

export function getThreadMainDisplayedLabelIds(thread) {
	return (thread.labelIds || []).filter(function(labelId) {
		return labelId !== 'INBOX' &&
			labelId !== 'UNREAD' &&
			labelId !== 'SENT' &&
			labelId !== 'TRASH';
	});
}

export function getLabelName(labelId, labels) {
	var labelObj = (labels || []).find(function(label) {
		return label.id === labelId;
	});
	if (!labelObj) {
		return '';
	}
	var match = /^CATEGORY_([A-Z]+)$/.exec(labelObj.id);
	if (labelObj.type === 'system' && match !== null) {
		return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
	}
	return labelObj.name;
}

function renderParticipants(people) {
	return (people || []).map(function(person) {
		return person && person.name ? person.name : '';
	}).filter(Boolean).join(' ');
}

function renderPrimaryPerson(person) {
	if (!person) {
		return '';
	}
	var name = person.name || '';
	var email = person.email || '';
	if (!name && !email) {
		return '';
	}
	if (!name) {
		return email;
	}
	if (!email) {
		return name;
	}
	return name + ' (' + email + ')';
}

function renderCountSuffix(items, subtractAmount) {
	var count = Math.max((items || []).length - subtractAmount, 0);
	if (count <= 0) {
		return '';
	}
	return ' (and ' + count + ' more)';
}

export function renderThreadItem(thread, options = {}) {
	var labels = options.labels || [];
	var mainDisplayedLabelIds = getThreadMainDisplayedLabelIds(thread);
	var senders = Array.isArray(thread.senders) ? thread.senders : [];
	var receivers = Array.isArray(thread.receivers) ? thread.receivers : [];
	var subject = escapeHtml(thread.subject || '');
	var snippet = escapeHtml(thread.snippet || '');
	var threadId = escapeHtml(thread.threadId || '');
	var visibility = escapeHtml(thread.visibility || '');
	var sendersTitle = escapeHtml(renderParticipants(senders));
	var receiversTitle = escapeHtml(renderParticipants(receivers));
	var primarySender = escapeHtml(renderPrimaryPerson(senders[0]));
	var primaryReceiver = escapeHtml(receivers[0] && receivers[0].name ? receivers[0].name : '');
	var badgesHtml = mainDisplayedLabelIds.map(function(labelId) {
		return '<span class="badge">' + escapeHtml(getLabelName(labelId, labels)) + '</span>';
	}).join('');
	return (
		'<div class="thread visibility-' + visibility + '" data-thread-id="' + threadId + '">' +
			'<div class="row">' +
				'<div class="col-xs-10">' +
					'<strong>From&nbsp;</strong>' +
					'<span class="senders" title="' + sendersTitle + '">' +
						primarySender +
						(senders.length > 1 ? escapeHtml(renderCountSuffix(senders, 1)) : '') +
					'</span>' +
					(receivers[0] && receivers[0].name ? (
						'<strong>To&nbsp;</strong>' +
						'<span class="receivers" title="' + receiversTitle + '">' +
							primaryReceiver +
							(receivers.length > 1 ? escapeHtml(renderCountSuffix(receivers, 1)) : '') +
						'</span>'
					) : '') +
				'</div>' +
				'<div class="col-xs-2">' +
					escapeHtml((thread.messageIds || []).length) +
					'<span class="glyphicon glyphicon-envelope"></span>&nbsp;' +
					escapeHtml(formatPrettyTimestamp(thread.lastUpdated, options.momentLib)) +
				'</div>' +
			'</div>' +
			'<div class="row">' +
				'<div class="col-xs-10">' +
					'<strong class="subject">' + subject + '</strong>' +
					'<span>' + badgesHtml + '</span>' +
					'<p class="snippet">' + snippet + '</p>' +
				'</div>' +
				'<div class="col-xs-2">' +
					'<small>Total:</small>' +
					'<span class="glyphicon glyphicon-time"></span> ' + escapeHtml(formatReadTime(thread.totalTimeToReadSeconds)) +
					'<br>' +
					'<small>Recent:</small>' +
					'<span class="glyphicon glyphicon-time"></span> ' + escapeHtml(formatReadTime(thread.recentMessageReadTimeSeconds)) +
					'<br>' +
					'<button class="btn btn-xs btn-success archive-thread" title="Done">' +
						'<span class="glyphicon glyphicon-ok"></span>' +
					'</button>' +
					'<button class="btn btn-xs btn-danger delete" title="Delete">' +
						'<span class="glyphicon glyphicon-remove"></span>' +
					'</button>' +
					'<button class="btn btn-xs btn-warning later" title="Later">' +
						'<span class="glyphicon glyphicon-time"></span>' +
					'</button>' +
					'<button class="btn btn-xs btn-primary label-thread" title="Label">' +
						'<span class="glyphicon glyphicon-list"></span>' +
					'</button>' +
					'<a class="btn btn-xs btn-default view-on-gmail" title="View on Gmail" href="https://mail.google.com/mail/u/0/#inbox/' + threadId + '" target="_blank">' +
						'<span class="glyphicon glyphicon-option-horizontal"></span>' +
					'</a>' +
				'</div>' +
			'</div>' +
		'</div>'
	);
}

export function renderThreadGroup(group) {
	return '<div class="group">' + escapeHtml(group.label || '') + '</div>';
}
