import type { ThreadRowItem } from './thread_grouping.js';

interface Label { id: string; name?: string; type?: string; }
interface ThreadData { labelIds?: string[]; }

export function formatReadTime(totalSeconds: number): string {
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

/** Item count and summed read times shown beside a group's name: "3 items · Total: 5 min read · Recent: 1 min read" */
export function formatGroupReadTimeStats(items: readonly ThreadRowItem[]): string {
	const totalSeconds = items.reduce((sum, item) => sum + item.totalTimeToReadSeconds, 0);
	const recentSeconds = items.reduce((sum, item) => sum + item.recentMessageReadTimeSeconds, 0);
	return items.length + ' item' + (items.length !== 1 ? 's' : '') +
		' · Total: ' + formatReadTime(totalSeconds) +
		' · Recent: ' + formatReadTime(recentSeconds);
}

export function getThreadMainDisplayedLabelIds(thread: ThreadData): string[] {
	return (thread.labelIds || []).filter(function(labelId) {
		return labelId !== 'INBOX' &&
			labelId !== 'UNREAD' &&
			labelId !== 'SENT' &&
			labelId !== 'TRASH';
	});
}

export function getLabelName(labelId: string, labels: Label[]): string | undefined {
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
