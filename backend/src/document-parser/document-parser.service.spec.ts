import { BadRequestException, InternalServerErrorException, RequestTimeoutException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { DocumentParserService } from './document-parser.service';
import { DocumentParserController } from './document-parser.controller';

/**
 * Hàm trợ giúp tạo giả lập phản hồi AxiosResponse cho HttpService.
 */
function createMockAxiosResponse<T>(data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: { headers: {} as any },
  };
}

describe('DocumentParserModule', () => {
  let service: DocumentParserService;
  let controller: DocumentParserController;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    httpService = {
      post: jest.fn(),
      get: jest.fn(),
    } as any;

    configService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentParserController],
      providers: [
        DocumentParserService,
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<DocumentParserService>(DocumentParserService);
    controller = module.get<DocumentParserController>(DocumentParserController);
  });

  describe('cleanLegalMarkdown', () => {
    it('loại bỏ số trang đơn lẻ, phân trang và ký tự form-feed', () => {
      const raw = `
<!--- Page 1 --->
Trang 1 / 15
Chương I
QUY ĐỊNH CHUNG
- 2 -
Điều 1. Phạm vi
1. Quy định về an toàn giao thông.
3/10
[4]
5
2. Hướng dẫn thi hành.
`;
      const cleaned = service.cleanLegalMarkdown(raw);
      expect(cleaned).not.toContain('Trang 1 / 15');
      expect(cleaned).not.toContain('- 2 -');
      expect(cleaned).not.toContain('3/10');
      expect(cleaned).not.toContain('[4]');
      expect(cleaned).toContain('1. Quy định về an toàn giao thông.');
      expect(cleaned).toContain('2. Hướng dẫn thi hành.');
    });

    it('loại bỏ các ghi chú về con dấu, chữ ký số và đường kẻ ký tên', () => {
      const raw = `
Điều 10. Quy tắc an toàn
Nội dung quy định chi tiết.
(Ký tên, đóng dấu)
(Chữ ký số bởi Ban Cơ yếu Chính phủ)
(Đã ký)
____________________
Hết văn bản.
`;
      const cleaned = service.cleanLegalMarkdown(raw);
      expect(cleaned).not.toContain('(Ký tên, đóng dấu)');
      expect(cleaned).not.toContain('Chữ ký số');
      expect(cleaned).not.toContain('(Đã ký)');
      expect(cleaned).not.toContain('____________________');
      expect(cleaned).toContain('### Điều 10. Quy tắc an toàn');
      expect(cleaned).toContain('Hết văn bản.');
    });

    it('chuẩn hóa các tiêu đề Chương, Mục, Điều sang Markdown heading', () => {
      const raw = `
Chương II
QUY TẮC GIAO THÔNG ĐƯỜNG BỘ
Mục 1
QUY TẮC CHUNG
Điều 10. Quy tắc giao thông đường bộ
1. Người tham gia giao thông phải đi bên phải.
# Chương III
ĐÃ CÓ HEADING SẴN
`;
      const cleaned = service.cleanLegalMarkdown(raw);
      expect(cleaned).toContain('# Chương II');
      expect(cleaned).toContain('## Mục 1');
      expect(cleaned).toContain('### Điều 10. Quy tắc giao thông đường bộ');
      expect(cleaned).toContain('# Chương III');
    });

    it('trả về chuỗi rỗng khi đầu vào không hợp lệ', () => {
      expect(service.cleanLegalMarkdown('')).toBe('');
      expect(service.cleanLegalMarkdown(null as any)).toBe('');
      expect(service.cleanLegalMarkdown(undefined as any)).toBe('');
    });
  });

  describe('getApiKey', () => {
    it('ném lỗi InternalServerErrorException nếu LLAMA_CLOUD_API_KEY chưa cấu hình', () => {
      configService.get.mockReturnValue(undefined);
      expect(() => service.getApiKey()).toThrow(InternalServerErrorException);
    });

    it('trả về API key khi đã cấu hình hợp lệ', () => {
      configService.get.mockReturnValue('llx-test-token-12345');
      expect(service.getApiKey()).toBe('llx-test-token-12345');
    });
  });

  describe('parsePdfBufferDetailed & parsePdfBuffer', () => {
    const mockPdfBuffer = Buffer.from('%PDF-1.4 test document');
    const apiKey = 'llx-test-key-mock';

    it('ném BadRequestException nếu buffer rỗng', async () => {
      await expect(service.parsePdfBuffer(Buffer.alloc(0), 'test.pdf')).rejects.toThrow(BadRequestException);
    });

    it('thực hiện toàn bộ quy trình Upload -> Polling -> Fetch Markdown thành công', async () => {
      configService.get.mockReturnValue(apiKey);

      // Bước 1: Mock Upload
      httpService.post.mockReturnValue(
        of(createMockAxiosResponse({ id: 'job-mock-999' })),
      );

      // Bước 2: Mock Polling (lần 1 PENDING, lần 2 SUCCESS)
      httpService.get
        .mockReturnValueOnce(
          of(createMockAxiosResponse({ status: 'PENDING' })),
        )
        .mockReturnValueOnce(
          of(createMockAxiosResponse({ status: 'SUCCESS' })),
        )
        // Bước 3: Mock Get Markdown
        .mockReturnValueOnce(
          of(createMockAxiosResponse({ markdown: 'Điều 1. Phạm vi\n(Ký tên, đóng dấu)\nNội dung điều 1' })),
        );

      const result = await service.parsePdfBufferDetailed(mockPdfBuffer, 'test-doc.pdf', {
        pollIntervalMs: 10,
        maxTimeoutMs: 1000,
      });

      expect(result.jobId).toBe('job-mock-999');
      expect(result.fileName).toBe('test-doc.pdf');
      expect(result.rawMarkdown).toContain('(Ký tên, đóng dấu)');
      expect(result.cleanedMarkdown).not.toContain('(Ký tên, đóng dấu)');
      expect(result.cleanedMarkdown).toContain('### Điều 1. Phạm vi');
    });

    it('ném BadRequestException khi LlamaParse báo trạng thái ERROR', async () => {
      configService.get.mockReturnValue(apiKey);

      httpService.post.mockReturnValue(
        of(createMockAxiosResponse({ id: 'job-err-123' })),
      );

      httpService.get.mockReturnValue(
        of(createMockAxiosResponse({ status: 'ERROR', error_message: 'Corrupted PDF file format' })),
      );

      await expect(
        service.parsePdfBufferDetailed(mockPdfBuffer, 'error.pdf', {
          pollIntervalMs: 10,
          maxTimeoutMs: 500,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('ném RequestTimeoutException khi vượt quá thời gian chờ xử lý', async () => {
      configService.get.mockReturnValue(apiKey);

      httpService.post.mockReturnValue(
        of(createMockAxiosResponse({ id: 'job-timeout-456' })),
      );

      httpService.get.mockReturnValue(
        of(createMockAxiosResponse({ status: 'PENDING' })),
      );

      await expect(
        service.parsePdfBufferDetailed(mockPdfBuffer, 'timeout.pdf', {
          pollIntervalMs: 20,
          maxTimeoutMs: 50,
        }),
      ).rejects.toThrow(RequestTimeoutException);
    });

    it('hàm parsePdfBuffer trả về trực tiếp chuỗi cleaned markdown', async () => {
      configService.get.mockReturnValue(apiKey);

      httpService.post.mockReturnValue(
        of(createMockAxiosResponse({ id: 'job-direct-789' })),
      );

      httpService.get
        .mockReturnValueOnce(of(createMockAxiosResponse({ status: 'SUCCESS' })))
        .mockReturnValueOnce(of(createMockAxiosResponse({ markdown: 'Điều 5. Hiệu lực' })));

      const markdown = await service.parsePdfBuffer(mockPdfBuffer, 'simple.pdf');
      expect(markdown).toContain('### Điều 5. Hiệu lực');
    });
  });

  describe('DocumentParserController', () => {
    it('checkConfig báo trạng thái chưa cấu hình khi chưa có API key', () => {
      configService.get.mockReturnValue(undefined);
      const res = controller.checkConfig();
      expect(res.isConfigured).toBe(false);
      expect(res.success).toBe(true);
    });

    it('checkConfig báo trạng thái đã cấu hình khi có API key', () => {
      configService.get.mockReturnValue('llx-configured-key');
      const res = controller.checkConfig();
      expect(res.isConfigured).toBe(true);
      expect(res.success).toBe(true);
    });

    it('parsePdf từ chối nếu không có tệp đính kèm', async () => {
      await expect(controller.parsePdf(null)).rejects.toThrow(BadRequestException);
    });

    it('parsePdf từ chối tệp không phải định dạng PDF', async () => {
      await expect(
        controller.parsePdf({
          buffer: Buffer.from('plain text'),
          originalname: 'document.txt',
          mimetype: 'text/plain',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('parsePdf xử lý thành công tệp PDF và trả về đầy đủ định dạng', async () => {
      jest.spyOn(service, 'parsePdfBufferDetailed').mockResolvedValue({
        jobId: 'job-ctrl-1',
        fileName: 'luat-gt.pdf',
        rawMarkdown: '### Điều 1\nTrang 1',
        cleanedMarkdown: '### Điều 1',
        characterCount: 11,
      });

      const res = await controller.parsePdf({
        buffer: Buffer.from('%PDF-1.4'),
        originalname: 'luat-gt.pdf',
        mimetype: 'application/pdf',
      });

      expect(res.success).toBe(true);
      expect(res.jobId).toBe('job-ctrl-1');
      expect(res.markdown).toBe('### Điều 1');
      expect(res.rawMarkdown).toContain('Trang 1');
    });
  });
});
