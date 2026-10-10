import { HttpException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** Kiểm tra hợp đồng POST /chat, đặc biệt giới hạn dữ liệu nhập và trích dẫn. */
describe('ChatController', () => {
  let controller: ChatController;
  const sendMessageToAi = jest.fn();
  const getPublicSummary = jest.fn();

  beforeEach(async () => {
    sendMessageToAi.mockReset();
    getPublicSummary.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: { sendMessageToAi, getPublicSummary } }],
    }).compile();
    controller = module.get<ChatController>(ChatController);
  });

  it('chuyển câu hỏi hợp lệ và trả lời kèm nguồn trích dẫn', async () => {
    const response = { answer: 'Nội dung trả lời', citations: [{ articleNumber: '1', content: 'Điều 1. Nội dung gốc' }] };
    sendMessageToAi.mockResolvedValue(response);

    await expect(controller.handleChat('  Điều 1 quy định gì?  ', 'session-1')).resolves.toEqual(response);
    expect(sendMessageToAi).toHaveBeenCalledWith('Điều 1 quy định gì?', 'session-1');
  });

  it.each([undefined, '', '   ', 42])('từ chối câu hỏi trống hoặc không phải chuỗi: %s', async message => {
    await expect(controller.handleChat(message as string)).rejects.toMatchObject({ status: 400 });
    expect(sendMessageToAi).not.toHaveBeenCalled();
  });

  it('chấp nhận đúng 2000 ký tự và từ chối câu hỏi dài hơn', async () => {
    sendMessageToAi.mockResolvedValue({ answer: 'Đã nhận', citations: [] });
    await controller.handleChat('a'.repeat(2000));
    expect(sendMessageToAi).toHaveBeenCalledWith('a'.repeat(2000), undefined);
    await expect(controller.handleChat('a'.repeat(2001))).rejects.toBeInstanceOf(HttpException);
    expect(sendMessageToAi).toHaveBeenCalledTimes(1);
  });

  it('trả thống kê công khai từ dịch vụ AI Core', async () => {
    getPublicSummary.mockResolvedValue({ document_count: 2, article_count: 8, last_updated: null });
    await expect(controller.getPublicSummary()).resolves.toMatchObject({ document_count: 2, article_count: 8 });
  });
});
