import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { GoogleAuthStatusDto, GoogleOAuthConfig } from '../types/auth.js';

/** A one-off banner shown above a settings form, e.g. after a save. */
export interface PageNotice {
	kind: 'error' | 'success';
	text: string;
}

/** What the setup and profile pages show about the Google OAuth connection. */
export interface GoogleOAuthViewModel {
	googleOAuth: GoogleOAuthConfig;
	authStatus: GoogleAuthStatusDto;
	defaultRedirectUri: string;
	notice?: PageNotice;
}

export function renderPage(page: ReactElement): string {
	return `<!DOCTYPE html>${renderToStaticMarkup(page)}`;
}

export function Notice({ notice }: { notice?: PageNotice }) {
	if (notice === undefined) {
		return null;
	}
	return (
		<div className={`alert alert-${notice.kind === 'error' ? 'danger' : 'success'}`} role="alert">
			{notice.text}
		</div>
	);
}
