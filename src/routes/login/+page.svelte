<script lang="ts">
	let { data, form } = $props();
	let mode = $state<'login' | 'signup'>('login');
	$effect.pre(() => {
		if (data.firstUser || form?.signup) mode = 'signup';
	});
	const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
</script>

<div class="wrap">
	<h1>Trackerr</h1>
	<p class="lede">
		{#if data.firstUser}
			Create the first account. It becomes the admin for this server.
		{:else}
			Your listening, counted.
		{/if}
	</p>

	{#if data.error}<p class="error">{data.error}</p>{/if}
	{#if form?.error}<p class="error">{form.error}</p>{/if}

	{#if data.spotify}
		<a class="button spotify" href="/auth/spotify?mode=login">{data.firstUser ? 'Create admin account with Spotify' : 'Log in with Spotify'}</a>
		<p class="or">or use a username and password</p>
	{/if}

	<form method="POST" action="?/{mode}">
		<label>Username <input name="username" autocomplete="username" required value={form?.username ?? ''} /></label>
		<label>
			Password
			<input name="password" type="password" autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} required minlength={mode === 'signup' ? 8 : undefined} />
		</label>
		<input type="hidden" name="timezone" value={tz} />
		<button>{mode === 'signup' ? 'Create account' : 'Log in'}</button>
	</form>

	{#if data.signupOpen && !data.firstUser}
		<p class="switch">
			{#if mode === 'login'}
				New here? <button class="link" onclick={() => (mode = 'signup')}>Create an account</button>
			{:else}
				Have an account? <button class="link" onclick={() => (mode = 'login')}>Log in</button>
			{/if}
		</p>
	{/if}
</div>

<style>
	.wrap {
		max-width: 360px;
		margin: 10vh auto 0;
		display: grid;
		gap: 16px;
	}
	h1 {
		font-size: 3.5rem;
		font-stretch: 65%;
		font-weight: 800;
		letter-spacing: -0.02em;
	}
	.lede {
		margin: -8px 0 8px;
		color: var(--ink-2);
	}
	form {
		display: grid;
		gap: 12px;
	}
	.spotify {
		text-align: center;
		padding: 11px;
	}
	.or {
		text-align: center;
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0;
	}
	.switch {
		color: var(--ink-2);
		font-size: 0.9rem;
	}
	.link {
		background: none;
		padding: 0;
		color: var(--ink);
		text-decoration: underline;
	}
</style>
