import type { ThreadMessageDto } from '../server/types/thread.js';

type MomentLib = (ts?: unknown) => { isSame(other: unknown, unit: string): boolean; format(fmt: string): string };
type FilesizeLib = (size: number) => string;

type ThreadMessage = Partial<ThreadMessageDto> & { duration?: string };
interface RenderOptions { momentLib?: MomentLib; filesizeLib?: FilesizeLib; }

function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function pluralize(number: number, singular: string, plural: string): string {
	return number === 1 ? singular : plural;
}

function formatPrettyTimestamp(timestamp: unknown, momentLib: MomentLib | undefined = (globalThis as Record<string, unknown>).moment as MomentLib | undefined): string {
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

function formatFilesize(size: number | undefined, filesizeLib: FilesizeLib | undefined = (globalThis as Record<string, unknown>).filesize as FilesizeLib | undefined): string {
	if (typeof filesizeLib === 'function') {
		return filesizeLib(size ?? 0);
	}
	return String(size) + ' bytes';
}

function renderPeople(people: Array<Person | null> | undefined): string {
	return (people || []).map(function(person) {
		return person && person.name ? escapeHtml(person.name) : '';
	}).filter(Boolean).join(' ');
}

export function renderDeletedMessagesNotice(payload: { num?: unknown; threadId?: string }): string {
	var num = Number(payload.num) || 0;
	var messageLabel = pluralize(num, 'message', 'messages');
	var pronoun = pluralize(num, 'it', 'them');
	var threadId = escapeHtml(payload.threadId || '');
	var trashUrl = 'https://mail.google.com/mail/u/0/#trash/' + threadId;
	return (
		'<div class="panel panel-danger">' +
			'<div class="panel-heading">' +
				'<div class="panel-title">' + escapeHtml(num) + ' deleted ' + messageLabel + '</div>' +
			'</div>' +
			'<div class="panel-body">' +
				'This thread contains ' + escapeHtml(num) + ' deleted ' + messageLabel + '. ' +
				'You can view ' + pronoun + ' at ' +
				'<a href="' + trashUrl + '" target="_blank">' + escapeHtml(trashUrl) + '</a>.' +
			'</div>' +
		'</div>'
	);
}

export function renderThreadMessage(message: ThreadMessage, options: RenderOptions = {}): string {
	var attachmentButtons = (message.attachments || []).map(function(attachment) {
		return (
			'<button class="btn btn-default dl-attachment" data-attachment-id="' + escapeHtml(attachment.attachmentId || '') + '" data-attachment-name="' + escapeHtml(attachment.filename || '') + '">' +
				'<span class="glyphicon glyphicon-file" aria-hidden="true"></span>' +
				escapeHtml(attachment.filename || '') +
				escapeHtml(formatFilesize(attachment.size, options.filesizeLib)) +
			'</button>'
		);
	}).join(' ');

	return (
		'<div class="message panel panel-default" data-message-id="' + escapeHtml(message.messageId || '') + '">' +
			'<div class="panel-heading">' +
				'<div class="panel-title">' +
					'<div class="row">' +
						'<div class="col-xs-6">' +
							'<strong>From</strong>' +
							renderPeople(message.from) +
							(message.to && message.to[0] && message.to[0]!.name ? '<strong>To</strong>' + renderPeople(message.to) : '') +
						'</div>' +
						'<div class="col-xs-2">' + escapeHtml(formatPrettyTimestamp(message.date, options.momentLib)) + '</div>' +
						'<div class="col-xs-4">' + escapeHtml(message.wordcount) + ' words: ' + escapeHtml(message.duration || '') + '</div>' +
					'</div>' +
				'</div>' +
			'</div>' +
			'<div class="panel-body">' +
				'<div class="row">' +
					'<div class="col-xs-12 message-body">' + (message.body && message.body.sanitized ? message.body.sanitized : '') + '</div>' +
				'</div>' +
			'</div>' +
			'<div class="panel-footer">' +
				'<div class="row">' +
					'<div class="col-xs-12 message-body">' + attachmentButtons + '</div>' +
				'</div>' +
			'</div>' +
		'</div>'
	);
}
