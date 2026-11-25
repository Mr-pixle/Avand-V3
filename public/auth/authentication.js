// The HTML reference owns the presentation. This adapter handles its real form submissions.
window.avandAuthenticate = async (mode, fields) => {
  const registering = mode === 'register'
  const credentials = { username: fields.username.trim().toLowerCase(), password: fields.password }
  let response
  try {
    response = await fetch(registering ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registering ? { ...credentials, name: fields.name.trim() } : credentials),
    })
  } catch {
    throw new Error('Could not connect to Avand. Please try again.')
  }

  if (!response.ok) {
    const messages = {
      400: 'Please check your name, username, and password.',
      401: 'The username or password is incorrect.',
      403: 'This account is inactive or awaiting approval.',
      409: 'This username is already in use.',
      429: 'Too many attempts. Please try again later.',
    }
    throw new Error(messages[response.status] ?? 'Could not continue. Please try again.')
  }

  if (!registering) {
    parent.postMessage({ type: 'AVAND_SIGNED_IN' }, location.origin)
  }
}
