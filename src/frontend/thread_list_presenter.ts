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
