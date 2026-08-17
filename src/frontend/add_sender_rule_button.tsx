import React from 'react';
import type { PersonDto } from '../server/types/thread.js';

interface AddSenderRuleButtonProps {
	person: PersonDto | undefined;
	onAddSenderRule: (senderEmail: string) => void;
}

/**
 * Opens the grouping-rule picker for a sender's email address. Renders nothing
 * when the person has no email, since there would be nothing to match on.
 */
export function AddSenderRuleButton({ person, onAddSenderRule }: AddSenderRuleButtonProps) {
	const email = person && person.email ? person.email : '';
	if (!email) {
		return null;
	}
	return (
		<button
			className="btn btn-xs btn-default add-sender-rule"
			onClick={function(e) { e.stopPropagation(); onAddSenderRule(email); }}
			style={{marginLeft: '4px'}}
			title={'Add a grouping rule for ' + email}
		>
			<span className="glyphicon glyphicon-filter"></span>
		</button>
	);
}
