import { ANTHROPIC_MODELS, type AnthropicConfig } from '../types/config.js';
import { Notice, renderPage, type GoogleOAuthViewModel } from './page.js';

export interface ProfileViewModel extends GoogleOAuthViewModel {
	anthropic: AnthropicConfig;
}

function ProfilePage({ googleOAuth, authStatus, defaultRedirectUri, anthropic, notice }: ProfileViewModel) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>Nailbox - Profile</title>
				<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css" />
			</head>
			<body>
				<div className="container">
					<h1>Profile settings</h1>
					<Notice notice={notice} />
					<form method="POST" action="/profile">
						<div className="panel panel-default">
							<div className="panel-heading">Google OAuth</div>
							<div className="panel-body">
								<p>Configure the Google application Nailbox uses to access your mail.</p>
								<div className="form-group">
									<label htmlFor="clientId">Client ID</label>
									<input className="form-control" id="clientId" name="clientId" defaultValue={googleOAuth.clientId ?? ''} required />
								</div>
								<div className="form-group">
									<label htmlFor="clientSecret">Client secret</label>
									<input className="form-control" id="clientSecret" name="clientSecret" defaultValue={googleOAuth.clientSecret ?? ''} required />
								</div>
								<div className="form-group">
									<label htmlFor="redirectUri">Redirect URI</label>
									<input className="form-control" id="redirectUri" name="redirectUri" defaultValue={googleOAuth.redirectUri || defaultRedirectUri} required />
								</div>
							</div>
						</div>
						<div className="panel panel-default">
							<div className="panel-heading">AI summaries (Anthropic)</div>
							<div className="panel-body">
								<p>Nailbox sends a message's subject, sender, and body to Anthropic only when you choose to summarize it. Your API key is stored locally in data/config.json.</p>
								<div className="form-group">
									<label htmlFor="anthropicApiKey">API key</label>
									<input className="form-control" id="anthropicApiKey" type="password" name="anthropicApiKey" placeholder={anthropic.apiKey ? 'Saved key (leave blank to keep it)' : 'sk-ant-...'} />
								</div>
								<div className="form-group">
									<label htmlFor="anthropicModel">Model</label>
									<select className="form-control" id="anthropicModel" name="anthropicModel" defaultValue={anthropic.model ?? ANTHROPIC_MODELS[0]}>
										{ANTHROPIC_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
									</select>
								</div>
							</div>
						</div>
						<button className="btn btn-primary" type="submit">Save settings</button>
					</form>
					{' '}
					<a className="btn btn-default" href="/">Back to inbox</a>
					{authStatus.connected ? (
						<form method="POST" action="/auth/google/disconnect" style={{ display: 'inline', marginLeft: 8 }}>
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
