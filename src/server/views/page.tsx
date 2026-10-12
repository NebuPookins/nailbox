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
	stylesheetPath: string;
	googleOAuth: GoogleOAuthConfig;
	authStatus: GoogleAuthStatusDto;
	defaultRedirectUri: string;
	notice?: PageNotice;
}

export function renderPage(page: ReactElement): string {
	return `<!DOCTYPE html>${renderToStaticMarkup(page)}`;
}

export function Head({ title, stylesheetPath }: { title: string; stylesheetPath: string }) {
	return (
		<head>
			<meta charSet="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<title>{title}</title>
			<link rel="stylesheet" href={stylesheetPath} />
			<link rel="icon" type="image/png" href="/public/favicon.png" />
		</head>
	);
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
