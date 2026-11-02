import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SafeExceptionFilter } from '../common/filters/safe-exception.filter';
import { RateLimiterGuard } from '../common/guards/rate-limiter.guard';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** Giả lập xác thực danh tính; kiểm tra phân quyền bằng RolesGuard thật. */
class BenchmarkIdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const httpRequest = context.switchToHttp().getRequest();
    const role = httpRequest.headers['x-test-role'];
    if (!role) return false;
    httpRequest.user = { role };
    return true;
  }
}

describe('Legal RAG HTTP evaluation', () => {
  let app: INestApplication;
  const service = {
    // Chữ ký phiên được kiểm tra riêng bằng test capability; HTTP suite tập trung validation và quyền.
    authorizeSession: () => ({ sessionId: 'fixture-session', sessionToken: 'fixture-capability' }),
    sendMessageToAi: jest.fn().mockResolvedValue({ answer: 'Đã nhận', citations: [] }),
    ingestFromUrl: jest.fn().mockResolvedValue({ status: 'accepted' }),
    uploadDocument: jest.fn().mockResolvedValue({ status: 'accepted' }),
    getAllHistory: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    // Đăng ký controller và guard thật trên máy chủ thử nghiệm, không mở cổng mạng.
    const module = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: service },
        Reflector, RolesGuard, RateLimiterGuard, JwtAuthGuard,
      ],
    }).overrideGuard(JwtAuthGuard).useClass(BenchmarkIdentityGuard).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new SafeExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('từ chối ba route quản trị khi thiếu quyền và cho phép admin', async () => {
    const server = app.getHttpServer();
    for (const path of ['/chat/upload', '/chat/ingest-url', '/chat/history']) {
      const denied = path.endsWith('history')
        ? request(server).get(path) : request(server).post(path).send({ url: 'https://example.org/law' });
      await denied.set('x-test-role', 'user').expect(403);
      const anonymous = path.endsWith('history')
        ? request(server).get(path) : request(server).post(path).send({ url: 'https://example.org/law' });
      await anonymous.expect(403);
    }
    await request(server).get('/chat/history').set('x-test-role', 'admin').expect(200);
    await request(server).post('/chat/ingest-url').set('x-test-role', 'admin')
      .send({ url: 'https://example.org/law' }).expect(201);
    await request(server).post('/chat/upload').set('x-test-role', 'admin')
      .attach('file', Buffer.from('%PDF-1.7\n'), 'law.pdf').expect(201);
    expect(service.getAllHistory).toHaveBeenCalledTimes(1);
    expect(service.ingestFromUrl).toHaveBeenCalledTimes(1);
    expect(service.uploadDocument).toHaveBeenCalledTimes(1);
  });

  it('trả HTTP 400 cho câu rỗng, quá dài hoặc chứa XSS', async () => {
    const server = app.getHttpServer();
    for (const message of ['', 'x'.repeat(2001), '<script>alert(1)</script>']) {
      const response = await request(server).post('/chat').send({ message }).expect(400);
      expect(response.body).toEqual(expect.objectContaining({ statusCode: 400, requestId: expect.any(String) }));
    }
    expect(service.sendMessageToAi).not.toHaveBeenCalled();
  });

  it('ẩn stack trace và token nội bộ trong lỗi máy chủ', async () => {
    service.sendMessageToAi.mockRejectedValueOnce(new Error('secret=/srv/private/config token=fake-test-token'));
    const response = await request(app.getHttpServer()).post('/chat')
      .send({ message: 'Căn cứ pháp luật nào?' }).expect(500);
    expect(response.body).toEqual({
      statusCode: 500, message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
      timestamp: expect.any(String), requestId: expect.any(String),
    });
    expect(JSON.stringify(response.body)).not.toMatch(/secret|token|stack|\/srv\//i);
  });

  it('trả HTTP 429 sau 30 câu hỏi cùng địa chỉ kết nối', async () => {
    const server = app.getHttpServer();
    for (let index = 0; index < 26; index++) {
      await request(server).post('/chat').send({ message: 'Điều 20 quy định gì?' }).expect(201);
    }
    // Bốn yêu cầu trước đó cũng phải được tính vào cửa sổ giới hạn chung.
    const response = await request(server).post('/chat').send({ message: 'Điều 20 quy định gì?' }).expect(429);
    expect(response.body).toEqual(expect.objectContaining({ statusCode: 429, requestId: expect.any(String) }));
    expect(service.sendMessageToAi).toHaveBeenCalledTimes(26);
  });
});

describe('Legal RAG independent citation verification', () => {
  const post = jest.fn();
  const service = new ChatService(
    { post } as any,
    { get: (key: string, fallback: unknown) => key === 'AI_CORE_INTERNAL_TOKEN' ? 'gia-lap-noi-bo' : fallback } as any,
    { getHistory: jest.fn(), saveMessage: jest.fn() } as any,
  );
  const valid = {
    chunk_id: 'real-chunk', doc_number: '45/2019/QH14', article: 'Điều 20',
    clause: 'Khoản 1', snippet: 'Hợp đồng lao động', source_url: 'https://example.org/law',
  };
  const stored = {
    chunk_id: 'real-chunk', content: 'Hợp đồng lao động có thời hạn', doc_number: '45/2019/QH14',
    article_number: '20', clause_number: '1', url: 'https://example.org/law', scope: 'public',
  };

  beforeEach(() => {
    post.mockReset();
  });

  it('giữ citation có thật khi metadata và nguyên văn khớp', async () => {
    post.mockImplementation((url: string) => of({ data: url.endsWith('/chat')
      ? { answer: 'Có căn cứ', citations: [valid] } : { sources: [stored] } }));
    const response = await service.sendMessageToAi('Điều 20 quy định gì?');
    expect(response.answer).toBe('Có căn cứ');
    expect(response.citations).toEqual([expect.objectContaining({ chunkId: 'real-chunk', verified: true })]);
  });

  it.each([
    [{ ...valid, chunk_id: 'invented-chunk' }, 'ID giả'],
    [{ ...valid, doc_number: '00/2099/QH99' }, 'số hiệu giả'],
    [{ ...valid, article: 'Điều 999' }, 'Điều giả'],
    [{ ...valid, clause: 'Khoản 99' }, 'Khoản giả'],
    [{ ...valid, snippet: 'Đoạn không có trong nguồn' }, 'nguyên văn giả'],
  ])('loại citation %s (%s)', async (citation) => {
    post.mockImplementation((url: string) => of({ data: url.endsWith('/chat')
      ? { answer: 'Khẳng định thiếu căn cứ', citations: [citation] } : { sources: [stored] } }));
    const response = await service.sendMessageToAi('Điều 20 quy định gì?');
    expect(response.citations).toEqual([]);
    expect(response.answer).toContain('Chưa tìm thấy căn cứ pháp lý');
  });

  it('từ chối toàn bộ câu trả lời khi một trong nhiều căn cứ là giả', async () => {
    post.mockImplementation((url: string) => of({ data: url.endsWith('/chat')
      ? { answer: 'Một câu trả lời lẫn nguồn giả', citations: [valid, { ...valid, chunk_id: 'fake' }] }
      : { sources: [stored] } }));
    const response = await service.sendMessageToAi('Điều 20 quy định gì?');
    expect(response.citations).toEqual([]);
    expect(response.answer).toContain('Chưa tìm thấy căn cứ pháp lý');
  });
});
