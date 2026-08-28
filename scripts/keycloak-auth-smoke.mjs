const issuer = process.env.KEYCLOAK_ISSUER;
const api = process.env.API_URL ?? 'http://127.0.0.1:3000/api/v1';
if (!issuer) throw new Error('KEYCLOAK_ISSUER is required');

const clientId = process.env.KEYCLOAK_SMOKE_CLIENT_ID ?? 'mcdr-e2e';
const clientSecret = process.env.KEYCLOAK_SMOKE_CLIENT_SECRET ?? 'mcdr-e2e-client-secret';

async function getToken(username, password) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'password',
    scope: 'openid',
    username,
    password,
  });
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Keycloak token request failed: ${response.status}`);
  return (await response.json()).access_token;
}

const owner = await getToken('owner-e2e@example.test', 'OwnerE2EPassword123!');
const ownerResponse = await fetch(`${api}/settlement-requests`, {
  headers: { authorization: `Bearer ${owner}` },
});
if (ownerResponse.status !== 200)
  throw new Error(`Owner token was rejected: ${ownerResponse.status}`);

const backoffice = await getToken('backoffice-e2e@example.test', 'BackofficeE2EPassword123!');
const roleResponse = await fetch(`${api}/settlement-requests`, {
  headers: { authorization: `Bearer ${backoffice}` },
});
if (roleResponse.status !== 403)
  throw new Error(`Role guard expected 403, got ${roleResponse.status}`);
console.log('Keycloak JWT and role-guard smoke test passed.');
