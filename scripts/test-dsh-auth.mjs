import { createHash, createHmac } from 'node:crypto';

function encodeBase64Url(buf) {
  return Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function decodeBase64Url(str) {
  let b64 = str.replaceAll('-', '+').replaceAll('_', '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return Buffer.from(b64, 'base64');
}

const secretRaw = '_93iRblkNIPRq8WMQR6zx8jDU37ouGPTEF-DKZdIFe0';
const secret = decodeBase64Url(secretRaw);
const host = '127.0.0.1:62708';
const authority = host;

const cName = 'dsh-auth-' + encodeBase64Url(createHash('sha256').update(authority).digest());

const issuedAt = Date.now();
const expiresAt = issuedAt + 1440 * 60 * 1000 * 30;
const payload = {
  version: 1,
  authority,
  issuedAt,
  expiresAt,
};

const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
const sig = createHmac('sha256', secret).update(body).digest();
const cValue = `v1.${body}.${encodeBase64Url(sig)}`;

const cookieHeader = `${cName}=${cValue}`;

console.log('Cookie header:', cookieHeader);

async function run() {
  const res = await fetch(`http://${host}/api/session/list`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'host': host,
      'cookie': cookieHeader,
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'test-1234',
      method: 'session/list',
      payload: { args: { _request: {} } },
    }),
  });

  console.log('Status:', res.status);
  const json = await res.json();
  console.log('Result ok:', json.result?.ok);
  if (json.result?.ok) {
    console.log('Found sessions count:', json.result.value.items?.length);
    for (const item of json.result.value.items.slice(0, 5)) {
      console.log(' - Session ID:', item.sessionId, 'Title:', item.projections?.values?.title);
    }
  } else {
    console.log('Error:', json);
  }
}

run();

