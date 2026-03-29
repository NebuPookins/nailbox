interface Label {
	id?: string;
	name?: string;
	type?: string;
	hue?: number;
}

export function getLabelDisplayName(label: Label | null | undefined): string {
	if (!label) {
		return '';
	}
	const match = /^CATEGORY_([A-Z]+)$/.exec(label.id ?? '');
	if (label.type === 'system' && match !== null) {
		return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
	}
	return label.name || '';
}

export function getLabelButtonStyle(label: Label | null | undefined): Record<string, string> | undefined {
	if (!label || label.type === 'system') {
		return undefined;
	}
	const hue = typeof label.hue === 'number' ? label.hue : 0;
	return {
		backgroundImage: `linear-gradient(to bottom,hsl(${hue},84%,40%),hsl(${hue},84%,38%) 100%)`,
		borderColor: `hsl(${hue},85%,26%)`,
		color: '#fff',
		textShadow: '0 -1px 0 rgba(0,0,0,.2)',
	};
}
