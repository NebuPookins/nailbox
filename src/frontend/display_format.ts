// Formatting helpers that replace the moment and filesize CDN libraries. The
// output matches what those libraries printed with their default English
// settings.

const SHORT_WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const SHORT_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' });

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Weeks start on Sunday, as in moment's default locale.
function startOfWeek(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
}

function formatTime(date: Date): string {
	const hours = date.getHours();
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

function ordinal(n: number): string {
	const lastTwoDigits = n % 100;
	if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
		return `${n}th`;
	}
	const suffixes: Readonly<Record<number, string>> = { 1: 'st', 2: 'nd', 3: 'rd' };
	return `${n}${suffixes[n % 10] ?? 'th'}`;
}

/**
 * Shows only as much of a timestamp as is needed to place it relative to now:
 * "9:15 AM" today, "Mon 9:15 AM" this week, "Oct 12th" this year, otherwise
 * "2025-Oct-12".
 */
export function formatPrettyTimestamp(timestamp: number, now: Date = new Date()): string {
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) {
		return '';
	}
	if (startOfDay(date).getTime() === startOfDay(now).getTime()) {
		return formatTime(date);
	}
	if (startOfWeek(date).getTime() === startOfWeek(now).getTime()) {
		return `${SHORT_WEEKDAY.format(date)} ${formatTime(date)}`;
	}
	if (date.getFullYear() === now.getFullYear()) {
		return `${SHORT_MONTH.format(date)} ${ordinal(date.getDate())}`;
	}
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${SHORT_MONTH.format(date)}-${day}`;
}

/**
 * An approximate, human-friendly length of time, e.g. "a few seconds",
 * "a minute", "12 minutes", "an hour", "3 hours", "a day", "4 days".
 */
export function humanizeDuration(totalSeconds: number): string {
	const minutes = Math.round(totalSeconds / 60);
	const hours = Math.round(totalSeconds / 3600);
	if (totalSeconds < 45) return 'a few seconds';
	if (totalSeconds < 90) return 'a minute';
	if (minutes < 45) return `${minutes} minutes`;
	if (minutes < 90) return 'an hour';
	if (hours < 22) return `${hours} hours`;
	if (hours < 36) return 'a day';
	return `${Math.round(totalSeconds / 86400)} days`;
}

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] as const;

/**
 * A byte count in binary units rounded to two decimals, e.g. "254.62 KB".
 */
export function formatFileSize(bytes: number): string {
	const maxExponent = FILE_SIZE_UNITS.length - 1;
	const exponent = bytes > 0 ? Math.min(Math.floor(Math.log2(bytes) / 10), maxExponent) : 0;
	const value = Number((bytes / 1024 ** exponent).toFixed(2));
	// Rounding can carry into the next unit, e.g. 1023.999 KB -> 1 MB.
	return value === 1024 && exponent < maxExponent ?
		`1 ${FILE_SIZE_UNITS[exponent + 1]}` :
		`${value} ${FILE_SIZE_UNITS[exponent]}`;
}
