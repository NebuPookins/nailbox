import { ANTHROPIC_MODELS, type AnthropicConfig } from '../types/config.js';
import { Head, Notice, renderPage, type GoogleOAuthViewModel } from './page.js';

export interface ProfileViewModel extends GoogleOAuthViewModel {
	anthropic: AnthropicConfig;
}

function ProfilePage({ stylesheetPath, googleOAuth, authStatus, defaultRedirectUri, anthropic, notice }: ProfileViewModel) {
	return (
		<html lang="en">
			<Head title="Nailbox - Profile" stylesheetPath={stylesheetPath} />
			<body>
				<div className="container">
					<h1 className="my-3">Profile settings</h1>
					<Notice notice={notice} />
					<form method="POST" action="/profile">
						<div className="card mb-3">
							<div className="card-header">Google OAuth</div>
							<div className="card-body">
								<p>Configure the Google application Nailbox uses to access your mail.</p>
								<div className="mb-3">
									<label className="form-label" htmlFor="clientId">Client ID</label>
									<input className="form-control" id="clientId" name="clientId" defaultValue={googleOAuth.clientId ?? ''} required />
								</div>
								<div className="mb-3">
									<label className="form-label" htmlFor="clientSecret">Client secret</label>
									<input className="form-control" id="clientSecret" name="clientSecret" defaultValue={googleOAuth.clientSecret ?? ''} required />
								</div>
								<div className="mb-3">
									<label className="form-label" htmlFor="redirectUri">Redirect URI</label>
									<input className="form-control" id="redirectUri" name="redirectUri" defaultValue={googleOAuth.redirectUri || defaultRedirectUri} required />
								</div>
							</div>
						</div>
						<div className="card mb-3">
							<div className="card-header">AI summaries (Anthropic)</div>
							<div className="card-body">
								<p>Nailbox sends a message's subject, sender, and body to Anthropic only when you choose to summarize it. Your API key is stored locally in data/config.json.</p>
								<div className="mb-3">
									<label className="form-label" htmlFor="anthropicApiKey">API key</label>
									<input className="form-control" id="anthropicApiKey" type="password" name="anthropicApiKey" placeholder={anthropic.apiKey ? 'Saved key (leave blank to keep it)' : 'sk-ant-...'} />
								</div>
								<div className="mb-3">
									<label className="form-label" htmlFor="anthropicModel">Model</label>
									<select className="form-select" id="anthropicModel" name="anthropicModel" defaultValue={anthropic.model ?? ANTHROPIC_MODELS[0]}>
										{ANTHROPIC_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
									</select>
								</div>
							</div>
						</div>
						<button className="btn btn-primary" type="submit">Save settings</button>
					</form>
					<a className="btn btn-outline-secondary mt-2" href="/">Back to inbox</a>
					{authStatus.connected ? (
						<form method="POST" action="/auth/google/disconnect" className="d-inline ms-2">
							<button className="btn btn-warning" type="submit">Disconnect Gmail</button>
						</form>
					) : null}
				</div>
			</body>
		</html>
	);
}

export function renderProfilePage(viewModel: ProfileViewModel): string {
	return renderPage(<ProfilePage {...viewModel} />);
}
