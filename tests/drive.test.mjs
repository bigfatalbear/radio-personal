import test from 'node:test';
import assert from 'node:assert/strict';
import { montarUrlListagem, mensagemErroDrive } from '../js/drive.js';
import { extrairDriveId } from '../js/settings.js';

test('URL codifica a chave e inclui paginação/shared drives', () => {
  const u = new URL(montarUrlListagem('abc', 'k&ey=1', 'tok'));
  assert.equal(u.searchParams.get('key'), 'k&ey=1');
  assert.equal(u.searchParams.get('pageToken'), 'tok');
  assert.equal(u.searchParams.get('supportsAllDrives'), 'true');
  assert.equal(u.searchParams.get('q'), "'abc' in parents and trashed = false");
});

test('400 com chave inválida é acionável e sem vazar a chave', () => {
  const corpo = { error: { message: 'API key not valid. SECRET123', errors: [{ reason: 'badRequest' }], details: [{ reason: 'API_KEY_INVALID' }] } };
  const m = mensagemErroDrive(400, corpo, 'SECRET123');
  assert.match(m, /inválida/);
  assert.ok(!m.includes('SECRET123'));
});

test('400 genérico inclui detalhe do Google mascarando a chave', () => {
  const m = mensagemErroDrive(400, { error: { message: 'Algo SECRET123' } }, 'SECRET123');
  assert.match(m, /Detalhe do Google: Algo \*\*\*/);
});

test('400 de query inválida aponta para o ID da pasta', () => {
  const m = mensagemErroDrive(400, { error: { message: 'Invalid Value', errors: [{ reason: 'invalid' }] } });
  assert.match(m, /ID da pasta/);
});

test('403 Drive API desativada, 404, 429 e corpo ausente', () => {
  assert.match(mensagemErroDrive(403, { error: { message: 'Google Drive API has not been used in project', errors: [{ reason: 'accessNotConfigured' }] } }), /ativ/i);
  assert.match(mensagemErroDrive(404, null), /não encontrada/);
  assert.match(mensagemErroDrive(429, null), /429/);
  assert.match(mensagemErroDrive(500, null), /500/);
});

test('extrairDriveId aceita links e rejeita lixo', () => {
  assert.equal(extrairDriveId('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp?usp=sharing'), '1AbCdEfGhIjKlMnOp');
  assert.equal(extrairDriveId('curto'), '');
});
