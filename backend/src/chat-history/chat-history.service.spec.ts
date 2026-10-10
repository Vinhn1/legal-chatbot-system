import { ChatHistoryService } from './chat-history.service';

describe('ChatHistoryService', () => {
  const create = jest.fn().mockImplementation(value => value);
  const save = jest.fn().mockImplementation(async value => value);
  const service = new ChatHistoryService({ create, save } as any);

  it('lưu tin nhắn theo session và vai trò', async () => {
    await expect(service.saveMessage('session-1', 'user', 'Điều 1?')).resolves.toEqual({
      sessionId: 'session-1', role: 'user', message: 'Điều 1?',
    });
  });
});
