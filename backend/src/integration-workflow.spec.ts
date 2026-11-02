import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from './app.module';
import { EmailService } from './email/email.service';

/** Tích hợp Nest thật + PostgreSQL tạm + AI/SMTP giả lập, không sử dụng dữ liệu vận hành. */
const integration = process.env.DB_INTEGRATION === '1' ? describe : describe.skip;
integration('Luồng xác thực, nạp, hỏi đáp, lịch sử và analytics', () => {
  jest.setTimeout(180000);
  let app: INestApplication;
  let ai: Server;
  let db: DataSource;
  let otp: string;
  let adminToken: string;
  let indexed = false;
  let receivedHistory: unknown[] = [];
  const docId = randomUUID();
  const snippet = 'Nội dung giả lập có căn cứ trong nguồn.';
  const result = { status: 'indexed', doc_id: docId, content_hash: 'e'.repeat(64), doc_number: 'FIXTURE/2026',
    doc_title: 'Văn bản giả lập tích hợp', document_type: 'law', issuing_authority: 'Cơ quan giả lập',
    issued_date: '2026-01-01', effective_status: 'unknown', scope: 'public', chunk_count: 1,
    units: [{ key: 'article', parent_key: null, unit_type: 'article', number: '1', sort_order: 0, original_text: snippet }] };
  const citation = { chunk_id: docId + ':0', doc_number: result.doc_number, article: 'Điều 1', clause: '', snippet, source_url: '' };

  beforeAll(async () => {
    if (!process.env.DB_DATABASE?.startsWith('legal_test')) throw new Error('Chỉ dùng database test.');
    process.env.JWT_SECRET = 'fixture-secret-only-for-tests-32-characters';
    process.env.AI_CORE_INTERNAL_TOKEN = 'fixture-internal-token';
    process.env.ADMIN_SEED_PASSWORD = 'Fixture-password-123!';
    process.env.DB_SYNCHRONIZE = 'false';
    ai = createServer(async (req, res) => {
      const respond = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.url === '/health') return respond(200, { status: 'ok' });
      if (req.headers['x-internal-token'] !== 'fixture-internal-token') return respond(401, {});
      let body = '';
      for await (const part of req) body += part.toString();
      if (req.url === '/legal/ingest') { indexed = true; return respond(200, result); }
      if (req.url === '/documents' && req.method === 'GET') return respond(200, indexed ? [{ id: docId, contentHash: result.content_hash }] : []);
      if (req.url?.startsWith('/documents?') && req.method === 'DELETE') { indexed = false; return respond(200, { success: true, content_hash: result.content_hash }); }
      if (req.url === '/legal/citations/verify') return respond(200, { sources: indexed ? [{ chunk_id: citation.chunk_id, content: snippet, doc_number: result.doc_number, article_number: '1', url: '' }] : [] });
      if (req.url === '/chat') {
        const input = JSON.parse(body);
        receivedHistory = input.history || [];
        if (input.message === 'fixture-ai-error') return respond(503, {});
        return respond(200, { answer: 'Theo nguồn giả lập.', citations: [citation], config_version: 'fixture-config', model_version: 'fixture-model' });
      }
      respond(404, {});
    });
    await new Promise<void>(resolve => ai.listen(0, '127.0.0.1', resolve));
    process.env.AI_SERVICE_BASE_URL = `http://127.0.0.1:${(ai.address() as AddressInfo).port}`;
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EmailService)
      .useValue({ sendOtpEmail: async (_email: string, code: string) => { otp = code; return true; } }).compile();
    app = module.createNestApplication();
    await app.init();
    db = module.get(DataSource);
    const response = await request(app.getHttpServer()).post('/auth/login').send({ username: 'admin', password: 'Fixture-password-123!' }).expect(200);
    adminToken = response.body.access_token;
    expect(adminToken).toEqual(expect.any(String));
  });

  afterAll(async () => {
    await app?.close();
    ai?.closeAllConnections();
    if (ai) await new Promise<void>(resolve => ai.close(() => resolve()));
  });

  it('nạp qua HTTP tới hai kho, truy xuất có citation, lưu phiên và tổng hợp server', async () => {
    const server = app.getHttpServer();
    await request(server).post('/legal/ingest-text').send({ content: 'Điều 1. ' + snippet }).expect(401);
    const ingest = await request(server).post('/legal/ingest-text').auth(adminToken, { type: 'bearer' }).send({ content: 'Điều 1. ' + snippet }).expect(201);
    expect(ingest.body.sync_status).toBe('metadata_synced');
    expect((await db.query('SELECT COUNT(*)::int AS count FROM legal_articles WHERE document_id=$1', [docId]))[0].count).toBe(1);
    const first = await request(server).post('/chat').send({ message: 'Điều 1 quy định gì?' }).expect(201);
    expect(first.body.citations).toHaveLength(1);
    expect(first.body.sessionToken).toEqual(expect.any(String));
    await request(server).post('/chat').send({ message: 'Còn trường hợp đó?', sessionId: first.body.sessionId, sessionToken: first.body.sessionToken }).expect(201);
    expect(receivedHistory).toHaveLength(2);
    const unrelated = await request(server).post('/chat').send({ message: 'Câu hỏi mới', sessionId: first.body.sessionId }).expect(201);
    expect(unrelated.body.sessionId).not.toBe(first.body.sessionId);
    expect(receivedHistory).toEqual([]);
    await request(server).post('/chat').send({ message: 'Câu hỏi', sessionId: first.body.sessionId, sessionToken: 'wrong' }).expect(401);
    const page = await request(server).get('/chat/history?limit=1').auth(adminToken, { type: 'bearer' }).expect(200);
    expect(page.body).toHaveLength(1);
    const next = await request(server).get(`/chat/history?limit=1&before=${page.body[0].id}`).auth(adminToken, { type: 'bearer' }).expect(200);
    expect(next.body[0].id).toBeLessThan(page.body[0].id);
    await request(server).post(`/chat/history/${first.body.sessionId}/review`).auth(adminToken, { type: 'bearer' }).send({ status: 'reviewed' }).expect(201);
    const metrics = await request(server).get('/chat/analytics').auth(adminToken, { type: 'bearer' }).expect(200);
    expect(metrics.body.cited).toBeGreaterThanOrEqual(3);
    await request(server).post('/chat').send({ message: 'fixture-ai-error' }).expect(503);
    const failures = await request(server).get('/chat/analytics').auth(adminToken, { type: 'bearer' }).expect(200);
    expect(failures.body.errors).toBeGreaterThanOrEqual(1);
    await request(server).get('/health/ready').expect(200);
    const deletion = await request(server).delete(`/chat/documents?name=${docId}`).auth(adminToken, { type: 'bearer' }).expect(200);
    expect(deletion.body.success).toBe(true);
    expect((await db.query('SELECT COUNT(*)::int AS count FROM legal_documents WHERE id=$1', [docId]))[0].count).toBe(0);
  });

  it('đăng nhập 2FA cần challenge sau mật khẩu, reset đổi mật khẩu thu hồi JWT', async () => {
    const server = app.getHttpServer();
    await request(server).patch('/users/profile').auth(adminToken, { type: 'bearer' }).send({ email: 'fixture-admin@example.invalid' }).expect(200);
    await db.query("UPDATE users SET two_fa_enabled=true WHERE username='admin'");
    const login = await request(server).post('/auth/login').send({ username: 'admin', password: 'Fixture-password-123!' }).expect(200);
    expect(login.body.require2fa).toBe(true);
    const loginCode = otp;
    await request(server).post('/auth/verify-2fa').send({ username: 'admin', otpCode: loginCode }).expect(400);
    const verify = await request(server).post('/auth/verify-2fa').send({ username: 'admin', otpCode: loginCode, challengeId: login.body.challengeId }).expect(200);
    expect(verify.body.access_token).toEqual(expect.any(String));
    const reset = await request(server).post('/auth/forgot-password').send({ email: 'fixture-admin@example.invalid' }).expect(200);
    const resetCode = otp;
    await request(server).post('/auth/verify-2fa').send({ username: 'admin', otpCode: resetCode, challengeId: reset.body.challengeId }).expect(400);
    await request(server).post('/auth/verify-reset-otp').send({ email: 'fixture-admin@example.invalid', otpCode: resetCode, challengeId: reset.body.challengeId }).expect(200);
    await request(server).post('/auth/reset-password').send({ email: 'fixture-admin@example.invalid', otpCode: resetCode, challengeId: reset.body.challengeId, password: 'Fixture-new-password-123!' }).expect(200);
    await request(server).get('/users/me').auth(verify.body.access_token, { type: 'bearer' }).expect(401);
    const unknown = await request(server).post('/auth/forgot-password').send({ email: 'unknown@example.invalid' }).expect(200);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(reset.body).sort());
    expect(unknown.body.message).toBe(reset.body.message);
  });
});
