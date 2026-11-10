import { createHash, createHmac } from 'node:crypto';
import WebSocket from 'ws';

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
const payload = { version: 1, authority, issuedAt, expiresAt };
const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
const sig = createHmac('sha256', secret).update(body).digest();
const cValue = `v1.${body}.${encodeBase64Url(sig)}`;
const cookieHeader = `${cName}=${cValue}`;

const ws = new WebSocket(`ws://${host}/api/remote.mux`, {
  headers: {
    'cookie': cookieHeader,
    'host': host,
  },
});

const sessionId = 'session-774b795b-0b80-4287-9ffc-b515553be3db';
const streamId = 'stream-' + Date.now();

ws.on('open', () => {
  console.log('WS connected!');
  ws.send(JSON.stringify({
    type: 'open',
    streamId,
    endpoint: 'session/follow',
    payload: {
      args: {
        request: {
          address: { kind: 'session', sessionId },
          assistantStream: true,
          maxMessages: 50,
        },
      },
    },
  }));
});

ws.on('message', (data) => {
  const str = data.toString();
  console.log('WS msg length:', str.length);
  const json = JSON.parse(str);
  console.log('WS msg type:', json.type, 'endpoint/streamId:', json.streamId);
  if (json.value?.header) {
    console.log('Header received:', json.value.header);
    console.log('Records count:', json.value.records?.length);
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (err) => {
  console.error('WS error:', err);
});

