import { ChatService } from './chat.service';

describe('ModelConfig', () => {
  let stored: any = null;
  const repository = {
    findOneBy: jest.fn(async () => stored),
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => { stored = value; return value; }),
  };
  const service = new ChatService({} as any,
    { get: (name: string, fallback?: unknown) => name === 'LLM_KEY_ENCRYPTION_SECRET' ? 'khoa-ma-hoa-gia-lap-du-32-ky-tu-123456789' : fallback } as any,
    {} as any, undefined, repository as any);

  beforeEach(() => { stored = null; jest.clearAllMocks(); });

  it('mã hóa trước khi lưu và chỉ trả khóa đã che', async () => {
    // Khóa thật chỉ xuất hiện trong yêu cầu và bộ nhớ tạm, không xuất hiện trong phản hồi.
    const key = 'gia-lap-api-key-123456789';
    const response = await service.updateModelConfig({ provider: 'gemini', api_key: key });
    expect(stored.encryptedKey).not.toContain(key);
    expect(response.has_api_key).toBe(true);
    expect(JSON.stringify(response)).not.toContain(key);
    expect(response.masked_api_key).toMatch(/\*+6789$/);
  });

  it('không tái sử dụng khóa cũ khi đổi nhà cung cấp', async () => {
    await service.updateModelConfig({ provider: 'gemini', api_key: 'gia-lap-api-key-123456789' });
    await expect(service.updateModelConfig({ provider: 'openai' })).rejects.toThrow('Cần nhập khóa API');
  });

  it('mã hóa và che khóa embedding API thành công', async () => {
    const embKey = 'embedding-key-gia-lap-987654321';
    const response = await service.updateModelConfig({ provider: 'gemini', api_key: 'gia-lap-api-key-123456789', embedding_api_key: embKey });
    expect(stored.encryptedEmbeddingKey).not.toContain(embKey);
    expect(response.has_embedding_key).toBe(true);
    expect(JSON.stringify(response)).not.toContain(embKey);
    expect(response.masked_embedding_key).toMatch(/\*+4321$/);
  });
});
