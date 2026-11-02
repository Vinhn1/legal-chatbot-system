import { DataSource } from 'typeorm';
import { OtpService } from './otp.service';
import { AuthRateGuard } from './auth-rate.guard';
import { authInput } from './auth-input';
import { jwtSecret } from './security-config';
import { LegalDocument } from '../legal/entities/legal-document.entity';
import { LegalArticle } from '../legal/entities/legal-article.entity';
import { ChatHistory } from '../chat-history/chat-history.entity';
import { ChatHistoryService } from '../chat-history/chat-history.service';
import { IngestionJobsService } from '../legal/ingestion-jobs.service';
import { randomUUID, randomBytes } from 'crypto';
import { publicSession } from '../chat/public-session';
import { redactConversation } from '../chat-history/privacy';
import { of } from 'rxjs';

/** Dùng PostgreSQL tạm; không kết nối database vận hành khi chạy test mặc định. */
const integration = process.env.DB_INTEGRATION === '1' ? describe : describe.skip;
integration('Challenge OTP trên PostgreSQL tạm', () => {
  jest.setTimeout(120000);
  let db: DataSource;
  let service: OtpService;
  let accountId: number;
  let code: string;
  const config = { get: () => 'fixture-secret-only-for-tests-32-characters' };
  const email = { sendOtpEmail: jest.fn(async (_address: string, value: string) => { code = value; return true; }) };

  beforeAll(async () => {
    if (!process.env.DB_DATABASE?.startsWith('legal_test')) throw new Error('Chỉ cho phép database test.');
    db = new DataSource({ type: 'postgres', host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE,
      entities: [LegalDocument, LegalArticle, ChatHistory] });
    await db.initialize();
    service = new OtpService(db, email as any, config as any);
  });
  beforeEach(async () => {
    const rows = await db.query("INSERT INTO users(username,password,email) VALUES ('fixture-'||gen_random_uuid(),'fake-hash','fixture@example.invalid') RETURNING id");
    accountId = rows[0].id;
  });
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

  it('băm mã, ràng buộc mục đích/tài khoản/đích và chống dùng lại', async () => {
    const challenge = await service.issue(accountId, 'fixture@example.invalid', 'phone_change', '0900000000');
    const saved = (await db.query('SELECT * FROM auth_challenges WHERE id=$1', [challenge.challengeId]))[0];
    expect(saved.code_hash).not.toContain(code);
    expect(saved.code_hash).toHaveLength(64);
    const action = jest.fn(async () => 'ok');
    await expect(service.verify(challenge.challengeId, code, 'login', accountId, '', true, action)).rejects.toThrow();
    await expect(service.verify(challenge.challengeId, code, 'phone_change', accountId + 1, '0900000000', true, action)).rejects.toThrow();
    await expect(service.verify(challenge.challengeId, code, 'phone_change', accountId, '0900000001', true, action)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled();
    expect(await service.verify(challenge.challengeId, code, 'phone_change', accountId, '0900000000', true, action)).toBe('ok');
    await expect(service.verify(challenge.challengeId, code, 'phone_change', accountId, '0900000000', true, action)).rejects.toThrow();
  });

  it('hai request đồng thời chỉ tiêu thụ một lần', async () => {
    const { challengeId } = await service.issue(accountId, 'fixture@example.invalid', 'login');
    const action = jest.fn(async () => true);
    const results = await Promise.allSettled([1, 2].map(() => service.verify(challengeId, code, 'login', accountId, '', true, action)));
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('khóa sau năm lần sai, giữ số lần thử sau transaction', async () => {
    const { challengeId } = await service.issue(accountId, 'fixture@example.invalid', 'login');
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) await expect(service.verify(challengeId, wrong, 'login', accountId, '', true, async () => true)).rejects.toThrow();
    await expect(service.verify(challengeId, code, 'login', accountId, '', true, async () => true)).rejects.toThrow();
    expect((await db.query('SELECT attempts FROM auth_challenges WHERE id=$1', [challengeId]))[0].attempts).toBe(5);
  });

  it('từ chối hết hạn, phiên tài khoản đã thu hồi và rollback khi cập nhật thất bại', async () => {
    const { challengeId } = await service.issue(accountId, 'fixture@example.invalid', 'login');
    await expect(service.verify(challengeId, code, 'login', accountId, '', true, async () => { throw new Error('Lỗi ghi giả lập'); })).rejects.toThrow();
    expect((await db.query('SELECT consumed_at FROM auth_challenges WHERE id=$1', [challengeId]))[0].consumed_at).toBeNull();
    await db.query('UPDATE users SET token_version=token_version+1 WHERE id=$1', [accountId]);
    await expect(service.verify(challengeId, code, 'login', accountId, '', true, async () => true)).rejects.toThrow();
    await db.query("UPDATE auth_challenges SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [challengeId]);
    await expect(service.verify(challengeId, code, 'login', accountId, '', true, async () => true)).rejects.toThrow();
  });

  it('cooldown chặn hai lần phát hành liên tiếp', async () => {
    await service.issue(accountId, 'fixture@example.invalid', 'login');
    await expect(service.issue(accountId, 'fixture@example.invalid', 'login')).rejects.toMatchObject({ status: 429 });
  });

  it('giới hạn tài khoản hoạt động trên nhiều instance', async () => {
    const guard = new AuthRateGuard(db, config as any);
    const request = { ip: '192.0.2.1', route: { path: 'login' }, body: { username: `fixture-${accountId}` } };
    const setHeader = jest.fn();
    const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader }) }), getHandler: () => ({ name: 'login' }) };
    for (let i = 0; i < 15; i++) expect(await guard.canActivate(context as any)).toBe(true);
    await expect(new AuthRateGuard(db, config as any).canActivate(context as any)).rejects.toMatchObject({ status: 429 });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '600');
  });

  it('lỗi giữa đồng bộ cây rollback toàn bộ, retry và hai job cùng nội dung không tạo trùng', async () => {
    const jobs = new IngestionJobsService(db);
    const result = { status: 'indexed', doc_id: randomUUID(), content_hash: randomBytes(32).toString('hex'),
      doc_number: 'FIXTURE/2026', doc_title: 'Văn bản giả lập', document_type: 'law', issuing_authority: 'Cơ quan giả lập',
      issued_date: '2026-01-01', effective_status: 'unknown', scope: 'internal',
      units: [{ key: 'article', parent_key: 'missing', unit_type: 'article', number: '1', sort_order: 0, original_text: 'Nội dung giả lập' }] };
    const job = await jobs.begin();
    expect((await jobs.complete(job, result)).status).toBe('partial');
    expect(await db.getRepository(LegalDocument).countBy({ contentHash: result.content_hash })).toBe(0);
    result.units[0].parent_key = null as any;
    await db.query('UPDATE ingestion_jobs SET payload=$2 WHERE id=$1', [job, JSON.stringify(result)]);
    expect((await jobs.retry(job)).success).toBe(true);
    const second = await jobs.begin();
    await Promise.all([jobs.retry(job), jobs.complete(second, result)]);
    expect(await db.getRepository(LegalDocument).countBy({ contentHash: result.content_hash })).toBe(1);
    expect(await db.getRepository(LegalArticle).countBy({ documentId: result.doc_id })).toBe(1);
    const reconciliation = await jobs.reconcile([{ id: result.doc_id, contentHash: result.content_hash }]);
    expect(reconciliation.vector_only).toEqual([]);
    expect(reconciliation.postgres_only).toEqual([]);
  });

  it('analytics khớp trạng thái, phân trang không trùng và hai quản trị viên thấy cùng rà soát', async () => {
    const repository = db.getRepository(ChatHistory);
    const history = new ChatHistoryService(repository);
    const sessionId = randomUUID();
    const initial = await history.analytics();
    await history.saveMessage(sessionId, 'bot', 'Câu từ chối có thể đổi hoàn toàn', { answer_status: 'refused', citation_count: 0, latency_ms: 20 });
    await history.saveMessage(sessionId, 'bot', 'Trả lời giả lập', { answer_status: 'cited', citation_count: 1, latency_ms: 10 });
    const stats = await history.analytics();
    expect(stats.refused - initial.refused).toBe(1);
    expect(stats.cited - initial.cited).toBe(1);
    await db.query("INSERT INTO chat_history(session_id,role,message) SELECT $1,'user','Nội dung giả lập' FROM generate_series(1,110)", [sessionId]);
    const first = await history.getAllHistory(undefined, 100);
    const second = await history.getAllHistory(first[first.length - 1].id, 100);
    expect(new Set([...first, ...second].map(row => row.id)).size).toBe(first.length + second.length);
    expect(first).toHaveLength(100);
    await history.review(sessionId, 'reviewed', accountId);
    const other = new ChatHistoryService(repository);
    expect((await other.getAllHistory(undefined, 1))[0]).toMatchObject({ reviewStatus: 'reviewed' });
    await expect(history.getAllHistory(undefined, 100, '2026-99-99')).rejects.toThrow();
    await expect(history.getAllHistory(undefined, 101)).rejects.toThrow();
  });

  it('xóa vector thành công nhưng PostgreSQL lỗi không báo thành công; retry giữ hash để phục hồi', async () => {
    const docId = randomUUID();
    const result = { status: 'indexed', doc_id: docId, content_hash: randomBytes(32).toString('hex'),
      doc_number: 'DELETE-FIXTURE', doc_title: 'Nguồn xóa giả lập', document_type: 'law', issuing_authority: 'Cơ quan giả lập',
      issued_date: '2026-01-01', effective_status: 'unknown', scope: 'internal', units: [] };
    let vectorExists = true;
    const http = { get: jest.fn(() => of({ data: vectorExists ? [{ id: docId, contentHash: result.content_hash }] : [] })),
      delete: jest.fn(() => { const content_hash = vectorExists ? result.content_hash : null; vectorExists = false; return of({ data: { success: true, content_hash } }); }) };
    const config = { get: (key: string, fallback: unknown) => key === 'AI_CORE_INTERNAL_TOKEN' ? 'fixture-token' : fallback };
    const jobs = new IngestionJobsService(db, http as any, config as any);
    await jobs.complete(await jobs.begin(), result);
    // Trigger gây lỗi có chủ đích chỉ tồn tại trong database tạm của bộ test.
    await db.query("CREATE FUNCTION fixture_stop_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture delete failure'; END $$");
    await db.query('CREATE TRIGGER fixture_delete_failure BEFORE DELETE ON legal_documents FOR EACH ROW EXECUTE FUNCTION fixture_stop_delete()');
    let partial: any;
    try {
      partial = await jobs.deleteDocument(docId);
      expect(partial).toMatchObject({ success: false, status: 'partial' });
      expect(vectorExists).toBe(false);
      expect(await db.getRepository(LegalDocument).countBy({ id: docId })).toBe(1);
    } finally {
      await db.query('DROP TRIGGER fixture_delete_failure ON legal_documents');
      await db.query('DROP FUNCTION fixture_stop_delete()');
    }
    expect((await jobs.retry(partial.job_id)).success).toBe(true);
    expect(await db.getRepository(LegalDocument).countBy({ id: docId })).toBe(0);
    expect(http.delete).toHaveBeenCalledTimes(2);
  });
});

describe('Validation hợp đồng xác thực', () => {
  it('từ chối đối tượng thay chuỗi, mật khẩu ngắn và challenge thiếu', () => {
    expect(() => authInput({ email: {} }, { email: 'email' })).toThrow();
    expect(() => authInput({ password: 'short' }, { password: 'password' })).toThrow();
    expect(() => authInput({}, { challengeId: 'challenge' })).toThrow();
    expect(() => jwtSecret({ get: () => undefined } as any)).toThrow();
    expect(() => jwtSecret({ get: () => 'short' } as any)).toThrow();
  });

  it('UUID không đủ để lấy ngữ cảnh phiên, chữ ký sai và hết hạn bị từ chối', () => {
    const secret = 'fixture-secret-only-for-tests-32-characters';
    const session = publicSession(secret, 'id-do-client-chon');
    expect(session.sessionId).not.toBe('id-do-client-chon');
    expect(publicSession(secret, session.sessionId, session.sessionToken)).toEqual(session);
    expect(() => publicSession(secret, randomUUID(), session.sessionToken)).toThrow();
    expect(() => publicSession(secret, session.sessionId, session.sessionToken + '00')).toThrow();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 86400000);
    expect(() => publicSession(secret, session.sessionId, session.sessionToken)).toThrow();
    clock.mockRestore();
  });

  it('ẩn email, số điện thoại và định danh trước khi lưu, giữ số hiệu văn bản', () => {
    const text = redactConversation('fixture@example.invalid 0900000000 012345678901 Điều 20 số 45/2019/QH14');
    expect(text).not.toMatch(/fixture@|0900000000|012345678901/);
    expect(text).toContain('45/2019/QH14');
  });
});
