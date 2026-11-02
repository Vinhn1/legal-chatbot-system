import { of } from 'rxjs';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  const post = jest.fn();
  const get = jest.fn();
  const getHistory = jest.fn();
  const saveMessage = jest.fn();
  const saveExchange = jest.fn().mockResolvedValue(undefined);
  const service = new ChatService(
    { post, get } as any,
    { get: (key: string, fallback: unknown) => key === 'AI_CORE_INTERNAL_TOKEN' ? 'gia-lap-noi-bo' : fallback } as any,
    { getHistory, saveMessage, saveExchange } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('gửi câu hỏi và lưu hội thoại mà không xử lý lead hay thuê bao', async () => {
    getHistory.mockResolvedValue([{ role: 'user', message: 'Câu hỏi trước' }]);
    saveMessage.mockResolvedValue(undefined);
    post.mockReturnValue(of({ data: { answer: 'Câu trả lời', sources: [] } }));

    const result = await service.sendMessageToAi('Quy định gì?', 'session-1');

    expect(post).toHaveBeenCalledWith(
      'http://localhost:8001/chat',
      { message: 'Quy định gì?', history: [{ role: 'user', message: 'Câu hỏi trước' }] },
      { timeout: 90000, headers: { 'X-Internal-Token': 'gia-lap-noi-bo' } },
    );
    expect(saveExchange).toHaveBeenCalledTimes(1);
    expect(saveExchange).toHaveBeenCalledWith('session-1', 'Quy định gì?', expect.any(String), expect.objectContaining({ answer_status: 'refused', citation_count: 0 }));
    // Phản hồi thiếu căn cứ từ mô hình phải chuyển thành lời từ chối an toàn.
    expect(result.answer).toContain('Chưa tìm thấy căn cứ pháp lý');
    expect(result.citations).toEqual([]);
  });

  it('chỉ công bố trích dẫn khớp metadata và nguyên văn trong ChromaDB', async () => {
    const citation = { chunk_id: 'doc-1:0', doc_number: '01/QH', article: 'Điều 1',
      clause: 'Khoản 2', snippet: 'Nội dung gốc', source_url: 'https://example.org/law' };
    post.mockImplementation((url: string) => of({ data: url.endsWith('/chat')
      ? { answer: 'Theo Điều 1', citations: [citation] }
      : { sources: [{ chunk_id: 'doc-1:0', content: 'Điều 1. Nội dung gốc', title: 'Luật mẫu',
          doc_number: '01/QH', article_number: '1', clause_number: '2',
          url: 'https://example.org/law', effective_status: 'active' }] } }));

    const result = await service.sendMessageToAi('Điều 1?');
    expect(result.citations[0]).toMatchObject({
      chunkId: 'doc-1:0', content: 'Điều 1. Nội dung gốc',
      articleNumber: '1', effectiveStatus: 'active', verified: true,
    });
    expect(post).toHaveBeenCalledWith('http://localhost:8001/legal/citations/verify',
      { chunk_ids: ['doc-1:0'] }, { timeout: 90000, headers: { 'X-Internal-Token': 'gia-lap-noi-bo' } });
  });

  it('từ chối khi mô hình bịa Điều hoặc Khoản', async () => {
    const citation = { chunk_id: 'doc-1:0', doc_number: '01/QH', article: 'Điều 99',
      clause: 'Khoản 2', snippet: 'Nội dung gốc', source_url: '' };
    post.mockImplementation((url: string) => of({ data: url.endsWith('/chat')
      ? { answer: 'Khẳng định thiếu căn cứ', citations: [citation] }
      : { sources: [{ chunk_id: 'doc-1:0', content: 'Nội dung gốc', doc_number: '01/QH',
          article_number: '1', clause_number: '2', url: '' }] } }));
    const result = await service.sendMessageToAi('Điều 99?');
    expect(result.citations).toEqual([]);
    expect(result.answer).toContain('Chưa tìm thấy căn cứ pháp lý');
  });

  it('chấp nhận trích dẫn Điều khi chunk không có metadata Khoản', async () => {
    // Bộ luật Lao động lưu Điều 3 trong một chunk, chưa tách Khoản thành metadata riêng.
    const snippet = 'Độ tuổi lao động tối thiểu của người lao động là đủ 15 tuổi.';
    const citation = { chunk_id: 'labor:3', doc_number: '45/2019/QH14', article: 'Điều 3',
      clause: '', snippet, source_url: 'https://example.org/law' };
    post.mockImplementation((url: string) => of({ data: url.endsWith('/chat')
      ? { answer: 'Người lao động phải đủ 15 tuổi.', citations: [citation] }
      : { sources: [{ chunk_id: 'labor:3', content: snippet, doc_number: '45/2019/QH14',
          article_number: '3', url: 'https://example.org/law' }] } }));

    const result = await service.sendMessageToAi('Độ tuổi lao động tối thiểu là bao nhiêu?');
    expect(result.answer).toContain('15 tuổi');
    expect(result.citations[0]).toMatchObject({ articleNumber: '3', clauseNumber: '', verified: true });
  });

  it('chỉ lấy thống kê qua endpoint công khai của AI Core', async () => {
    get.mockReturnValue(of({ data: { document_count: 1, article_count: 2 } }));
    await expect(service.getPublicSummary()).resolves.toMatchObject({ document_count: 1 });
    expect(get).toHaveBeenCalledWith('http://localhost:8001/legal/public-summary', { params: undefined, headers: undefined, timeout: 90000 });
  });

  it('chỉ chuyển URL nạp kèm token nội bộ do máy chủ cấu hình', async () => {
    const protectedService = new ChatService(
      { post, get } as any,
      { get: (key: string, fallback: unknown) => key === 'AI_CORE_INTERNAL_TOKEN' ? 'gia-lap-noi-bo' : fallback } as any,
      { getHistory, saveMessage, saveExchange } as any,
    );
    post.mockReturnValue(of({ data: { status: 'accepted' } }));
    await expect(protectedService.ingestFromUrl('https://example.org/law')).resolves.toEqual({ status: 'accepted' });
    expect(post).toHaveBeenCalledWith('http://localhost:8001/ingest-url',
      { url: 'https://example.org/law' },
      { timeout: 90000, headers: { 'X-Internal-Token': 'gia-lap-noi-bo' } });
  });

  it('lấy danh sách phân đoạn của tài liệu kèm token nội bộ AI Core', async () => {
    get.mockReturnValue(of({ data: { docId: 'doc-168', total: 1, chunks: [{ chunkId: 'doc-168:0', index: 1, content: 'Điều 1' }] } }));
    await expect(service.getDocumentChunks('doc-168')).resolves.toMatchObject({ docId: 'doc-168', total: 1 });
    expect(get).toHaveBeenCalledWith(
      'http://localhost:8001/documents/doc-168/chunks',
      { params: undefined, headers: { 'X-Internal-Token': 'gia-lap-noi-bo' }, timeout: 90000 },
    );
  });
});
