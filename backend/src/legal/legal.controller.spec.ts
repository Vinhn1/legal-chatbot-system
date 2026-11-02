import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { LegalController } from './legal.controller';
import { ROLES_KEY } from '../auth/guards/roles.decorator';

describe('LegalController ingestion', () => {
  const post = jest.fn();
  const httpGet = jest.fn();
  const get = jest.fn((key: string, fallback?: unknown) => {
    if (key === 'AI_CORE_INTERNAL_TOKEN') return 'test-internal-token';
    return fallback;
  });
  const findByContentHash = jest.fn().mockResolvedValue(null);
  const createDocument = jest.fn().mockResolvedValue({});
  const listUnits = jest.fn().mockResolvedValue([]);
  const createUnit = jest.fn();
  const emitNotification = jest.fn();
  // Controller chỉ điều phối; tính nguyên tử và chống trùng được kiểm tra với PostgreSQL tạm.
  const complete = jest.fn(async (_id: string, result: unknown) => result);
  const jobs = { begin: jest.fn(async () => 'fixture-job'), complete, fail: jest.fn(async () => undefined) };
  const controller = new LegalController({ post, get: httpGet } as any, { get } as any,
    { findByContentHash, createDocument, listUnits, createUnit } as any, jobs as any, { emitNotification } as any);
  const file = { buffer: Buffer.from('Điều 1. Quy định\nNội dung.'), originalname: 'law.txt' };
  const metadata = JSON.stringify({ doc_number: '01/2026/QH' });

  beforeEach(() => {
    jest.clearAllMocks();
    get.mockImplementation((key: string, fallback?: unknown) =>
      key === 'AI_CORE_INTERNAL_TOKEN' ? 'test-internal-token' : fallback,
    );
    findByContentHash.mockResolvedValue(null);
    createDocument.mockResolvedValue({});
    listUnits.mockResolvedValue([]);
  });

  it('requires the admin or staff role and forwards multipart with the internal token', async () => {
    expect(Reflect.getMetadata(ROLES_KEY, controller.ingest)).toEqual(['admin', 'staff']);
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
    expect(complete).toHaveBeenCalledWith('fixture-job', result);
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

  it('đồng bộ cây đơn vị và không tạo trùng khi nạp lại', async () => {
    const units = [
      { key: '0', parent_key: null, unit_type: 'part', number: 'I', title: 'Tổng quan', original_text: 'Phần I. Tổng quan', sort_order: 0 },
      { key: '1', parent_key: '0', unit_type: 'article', number: '1', title: 'Nội dung', original_text: 'Điều 1. Nội dung', sort_order: 1 },
    ];
    const result = { status: 'indexed', content_hash: 'c'.repeat(64), doc_number: 'CD-01',
      doc_title: 'Chuyên đề', document_type: 'law', issuing_authority: 'Đơn vị đào tạo',
      issued_date: '2026-01-01', effective_status: 'unknown', scope: 'internal', units };
    createDocument.mockResolvedValue({ id: 'doc-1' });
    createUnit.mockResolvedValueOnce({ id: 'part-1' }).mockResolvedValueOnce({ id: 'article-1' });
    post.mockReturnValue(of({ data: result }));
    await controller.ingest(file, metadata);
    expect(complete).toHaveBeenCalledWith('fixture-job', result);
    findByContentHash.mockResolvedValue({ id: 'doc-1' });
    listUnits.mockResolvedValue([
      { id: 'part-1', parentId: null, unitType: 'part', number: 'I', sortOrder: 0 },
      { id: 'article-1', parentId: 'part-1', unitType: 'article', number: '1', sortOrder: 1 },
    ]);
    await controller.ingest(file, metadata);
    expect(complete).toHaveBeenCalledTimes(2);
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

  it('khởi tạo tác vụ AI OCR chạy ngầm và đồng bộ PostgreSQL đúng một lần kèm phát thông báo khi hoàn tất', async () => {
    const jobId = '11111111-2222-3333-4444-555555555555';
    post.mockReturnValue(of({
      data: { job_id: jobId, filename: '168-nd-cp.signed.pdf', status: 'queued', total_pages: 62, auto_ingest: true },
    }));
    const created = await controller.startOcrJob(
      { buffer: Buffer.from('%PDF-1.4 scan'), originalname: '168-nd-cp.signed.pdf' },
      'true',
      undefined,
      undefined,
      'public',
    );
    expect(created.job_id).toBe(jobId);
    const [url, form] = post.mock.calls[0];
    expect(url).toBe('http://localhost:8001/legal/ocr-jobs');
    expect(form.get('auto_ingest')).toBe('true');

    const ingestResult = {
      status: 'indexed',
      content_hash: 'd'.repeat(64),
      doc_id: 'doc-168',
      doc_number: '168/2024/NĐ-CP',
      doc_title: 'Nghị định 168',
      document_type: 'decree',
      issuing_authority: 'Chính phủ',
      issued_date: '2024-12-26',
      effective_status: 'active',
      scope: 'public',
      article_count: 54,
      chunk_count: 190,
    };
    httpGet.mockReturnValue(of({
      data: {
        job_id: jobId,
        filename: '168-nd-cp.signed.pdf',
        status: 'completed',
        stage: 'done',
        percent: 100,
        ingest_result: ingestResult,
      },
    }));

    const pollFirst = await controller.getOcrJobStatus(jobId, 'false');
    const pollSecond = await controller.getOcrJobStatus(jobId, 'false');
    expect(pollFirst.ingest_result.doc_number).toBe('168/2024/NĐ-CP');
    expect(pollSecond.ingest_result.doc_number).toBe('168/2024/NĐ-CP');
    // Hai lần truy vấn trạng thái hoàn tất vẫn chỉ ghi PostgreSQL và bắn thông báo đúng 1 lần
    expect(complete).toHaveBeenCalledTimes(1);
    expect(emitNotification).toHaveBeenCalledTimes(1);
    expect(emitNotification).toHaveBeenCalledWith(
      'ocr_ingest_completed',
      expect.objectContaining({ ocr_job_id: jobId, doc_number: '168/2024/NĐ-CP' }),
    );
  });

  it('ưu tiên khởi chạy tiến trình LlamaParse khi có LLAMA_CLOUD_API_KEY và tệp là PDF', async () => {
    const mockDocumentParser = {
      parsePdfBufferDetailed: jest.fn().mockResolvedValue({
        jobId: 'llama-1',
        fileName: '168-nd-cp.signed.pdf',
        rawMarkdown: '### Điều 1',
        cleanedMarkdown: '### Điều 1',
        characterCount: 11,
      }),
    };

    const llamaGet = jest.fn((key: string, fallback?: unknown) => {
      if (key === 'AI_CORE_INTERNAL_TOKEN') return 'test-internal-token';
      if (key === 'LLAMA_CLOUD_API_KEY') return 'llx-mock-key';
      return fallback;
    });

    const llamaController = new LegalController(
      { post, get: httpGet } as any,
      { get: llamaGet } as any,
      { findByContentHash, createDocument, listUnits, createUnit } as any,
      jobs as any,
      { emitNotification } as any,
      mockDocumentParser as any,
    );

    const pdfFile = { buffer: Buffer.from('%PDF-1.4 test'), originalname: '168-nd-cp.signed.pdf' };
    const jobRes = await llamaController.startOcrJob(pdfFile, 'true');

    expect(jobRes.job_id).toBeDefined();
    expect(jobRes.filename).toBe('168-nd-cp.signed.pdf');
    expect(jobRes.status).toBe('running');
    expect(jobRes.percent).toBe(15);

    // Không gọi sang AI Core /legal/ocr-jobs mà tự quản lý qua LlamaParse
    expect(post).not.toHaveBeenCalledWith('http://localhost:8001/legal/ocr-jobs', expect.anything(), expect.anything());

    // Kiểm tra trạng thái qua getOcrJobStatus
    const statusRes = await llamaController.getOcrJobStatus(jobRes.job_id);
    expect(statusRes.job_id).toBe(jobRes.job_id);
    expect(statusRes.status).toBe('running');
  });
});
