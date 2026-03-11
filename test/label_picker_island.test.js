import test from 'node:test';
import assert from 'node:assert/strict';

import {
	getLabelButtonStyle,
	getLabelDisplayName,
} from '../src/frontend/label_picker_presenter.js';

test('getLabelDisplayName humanizes Gmail category labels', () => {
	assert.equal(getLabelDisplayName({
		id: 'CATEGORY_PERSONAL',
		name: 'CATEGORY_PERSONAL',
		type: 'system',
	}), 'Personal');
});

test('getLabelDisplayName keeps custom label names unchanged', () => {
	assert.equal(getLabelDisplayName({
		id: 'Label_123',
		name: 'Finance',
		type: 'user',
	}), 'Finance');
});

test('getLabelButtonStyle omits inline styles for system labels', () => {
	assert.equal(getLabelButtonStyle({
		id: 'INBOX',
		name: 'Inbox',
		type: 'system',
	}), undefined);
});

test('getLabelButtonStyle returns gradient styling for custom labels', () => {
	assert.deepEqual(getLabelButtonStyle({
		hue: 120,
		id: 'Label_123',
		name: 'Finance',
		type: 'user',
	}), {
		backgroundImage: 'linear-gradient(to bottom,hsl(120,84%,40%),hsl(120,84%,38%) 100%)',
		borderColor: 'hsl(120,85%,26%)',
		color: '#fff',
		textShadow: '0 -1px 0 rgba(0,0,0,.2)',
	});
});
