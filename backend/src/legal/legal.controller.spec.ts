import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LegalController } from './legal.controller';
import { ROLES_KEY } from '../auth/guards/roles.decorator';

describe('LegalController ingestion', () => {
  const post = jest.fn();
  const get = jest.fn((key: string, fallback?: unknown) => {
    if (key === 'AI_CORE_INTERNAL_TOKEN') return 'test-internal-token';
    return fallback;
  });
  const findByContentHash = jest.fn().mockResolvedValue(null);
  const createDocument = jest.fn().mockResolvedValue({});
  const controller = new LegalController({ post } as any, { get } as any, { findByContentHash, createDocument } as any);
  const file = { buffer: Buffer.from('Điều 1. Quy định\nNội dung.'), originalname: 'law.txt' };
  const metadata = JSON.stringify({ doc_number: '01/2026/QH' });

  beforeEach(() => {
    jest.clearAllMocks();
    get.mockImplementation((key: string, fallback?: unknown) =>
      key === 'AI_CORE_INTERNAL_TOKEN' ? 'test-internal-token' : fallback,
    );
    findByContentHash.mockResolvedValue(null);
    createDocument.mockResolvedValue({});
  });

  it('requires the admin role and forwards multipart with the internal token', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, controller.ingest)).toEqual(['admin']);
    post.mockReturnValue(of({ data: { status: 'indexed', chunk_count: 1 } }));
    await expect(controller.ingest(file, metadata)).resolves.toEqual({ status: 'indexed', chunk_count: 1 });
    const [url, form, options] = post.mock.calls[0];
    expect(url).toBe('http://localhost:8001/legal/ingest');
    expect(options.headers['X-Internal-Token']).toBe('test-internal-token');
    expect(form.get('metadata')).toBe(metadata);
  });

  it('chỉ chuyển cờ phân đoạn văn khi quản trị viên xác nhận', async () => {
    // Cờ gửi tới AI Core phải được chuẩn hóa thành chuỗi true trong multipart.
    post.mockReturnValue(of({ data: { status: 'needs_review' } }));
    await controller.ingest(file, metadata, undefined, 'true');
    const [, form] = post.mock.calls[0];
    expect(form.get('force_paragraph')).toBe('true');
    await expect(controller.ingest(file, metadata, undefined, 'invalid')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing upload, malformed metadata and missing internal configuration', async () => {
    await expect(controller.ingest(null, metadata)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.ingest(file, '{')).rejects.toBeInstanceOf(BadRequestException);
    get.mockReturnValueOnce(undefined);
    await expect(controller.ingest(file, metadata)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(post).not.toHaveBeenCalled();
  });

  it('nạp text không cần metadata và đồng bộ bản đã lập chỉ mục', async () => {
    // Kết quả giả lập có đủ trường mà bảng legal_documents yêu cầu.
    const result = {
      status: 'indexed', content_hash: 'a'.repeat(64), doc_number: '01/2026/QH',
      doc_title: 'Luật thử nghiệm', document_type: 'law', issuing_authority: 'Quốc hội',
      issued_date: '2026-01-01', effective_status: 'unknown', scope: 'public',
      source_url: 'https://example.org/law', article_count: 1, chunk_count: 1,
    };
    post.mockReturnValue(of({ data: result }));
    await expect(controller.ingestText({ content: 'Điều 1. Nội dung thử nghiệm.' })).resolves.toEqual(result);
    expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentNumber: '01/2026/QH', contentHash: 'a'.repeat(64),
    }));
    const [, form] = post.mock.calls[0];
    expect(form.get('metadata')).toBe('');
  });

  it('nạp URL qua AI Core và không tạo dòng trùng khi đã có content hash', async () => {
    // Hai lần nạp cùng nội dung vẫn chỉ cần một dòng trong PostgreSQL.
    findByContentHash.mockResolvedValue({ id: 'existing' });
    const result = { status: 'duplicate', content_hash: 'b'.repeat(64) };
    post.mockReturnValue(of({ data: result }));
    await expect(controller.ingestUrl({ url: 'https://example.org/law' })).resolves.toEqual(result);
    expect(post).toHaveBeenCalledWith('http://localhost:8001/ingest-url', { url: 'https://example.org/law' },
      expect.objectContaining({ headers: { 'X-Internal-Token': 'test-internal-token' } }));
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('giữ mã 400 và nguyên nhân công khai từ AI Core khi nạp URL thất bại', async () => {
    // Bộ lọc HTTP sẽ chỉ cho phép hiển thị thông điệp nằm trong danh sách an toàn.
    const reason = 'Không tìm thấy trang web nguồn (404 Not Found). Vui lòng kiểm tra lại đường dẫn URL.';
    post.mockReturnValue(throwError(() => ({ response: { status: 400, data: { detail: reason } } })));
    await expect(controller.ingestUrl({ url: 'https://example.org/law' })).rejects.toMatchObject({
      status: 400, response: reason,
    });
    expect(createDocument).not.toHaveBeenCalled();
  });
});
