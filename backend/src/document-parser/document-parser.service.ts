import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  RequestTimeoutException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** Cấu hình LlamaParse API v2 chuẩn (thay thế v1 đã bị LlamaCloud vô hiệu hóa) */
const LLAMA_PARSE_V2_UPLOAD_URL = 'https://api.cloud.llamaindex.ai/api/v2/parse/upload';
const LLAMA_PARSE_V2_JOB_URL = 'https://api.cloud.llamaindex.ai/api/v2/parse';
const LLAMA_PARSE_V1_JOB_URL = 'https://api.cloud.llamaindex.ai/api/v1/parsing/job';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_TIMEOUT_MS = 300000; // 5 phút cho văn bản pháp luật lớn trên 100 trang

/** Chỉ dẫn trích xuất chuyên dụng cho văn bản quy phạm pháp luật Việt Nam */
const LEGAL_PARSING_INSTRUCTION =
  'Đây là văn bản pháp luật hành chính Việt Nam. Hãy trích xuất chính xác toàn bộ nội dung sang định dạng Markdown. ' +
  'Giữ nguyên phân cấp Chương (#), Mục (##), Điều (###), Khoản (1., 2., 3.) và Điểm (a, b, c). ' +
  'Bỏ qua số trang đơn lẻ ở đầu/cuối trang, chữ ký số và con dấu đỏ đè lên văn bản.';

/** Kết quả chi tiết sau khi phân tích tệp PDF bằng LlamaParse */
export interface DetailedParseResult {
  jobId: string;
  fileName: string;
  rawMarkdown: string;
  cleanedMarkdown: string;
  characterCount: number;
}

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Lấy API Key từ biến môi trường LLAMA_CLOUD_API_KEY.
   * Ném ngoại lệ có thông báo rõ ràng nếu quản trị viên chưa cấu hình.
   */
  getApiKey(): string {
    const apiKey = this.configService.get<string>('LLAMA_CLOUD_API_KEY');
    if (!apiKey || apiKey.trim() === '') {
      throw new InternalServerErrorException(
        'Chưa cấu hình biến môi trường LLAMA_CLOUD_API_KEY. Vui lòng thiết lập khóa API LlamaCloud trong file .env trước khi thực hiện parse văn bản.',
      );
    }
    return apiKey.trim();
  }

  /**
   * Nhận buffer tệp PDF, tải lên LlamaParse, thăm dò trạng thái và trả về chuỗi Markdown đã làm sạch.
   */
  async parsePdfBuffer(fileBuffer: Buffer, fileName: string): Promise<string> {
    const result = await this.parsePdfBufferDetailed(fileBuffer, fileName);
    return result.cleanedMarkdown;
  }

  /**
   * Phân tích tệp PDF và trả về kết quả chi tiết gồm mã công việc, Markdown gốc và Markdown đã chuẩn hóa.
   */
  async parsePdfBufferDetailed(
    fileBuffer: Buffer,
    fileName: string,
    options?: {
      pollIntervalMs?: number;
      maxTimeoutMs?: number;
      onProgress?: (percent: number) => void;
    },
  ): Promise<DetailedParseResult> {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Buffer tệp PDF rỗng hoặc không hợp lệ.');
    }

    const apiKey = this.getApiKey();
    const safeFilename = (fileName || 'document.pdf').replace(/\\/g, '/').split('/').pop() || 'document.pdf';
    const pollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxTimeout = options?.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;

    // Bước 1: Gửi fileBuffer lên LlamaCloud upload endpoint
    options?.onProgress?.(20);
    const jobId = await this.uploadToLlamaParse(fileBuffer, safeFilename, apiKey);
    this.logger.log(`Tải tệp "${safeFilename}" lên LlamaParse thành công. JobId: ${jobId}`);

    // Bước 2: Polling định kỳ kiểm tra trạng thái công việc
    await this.pollJobStatus(jobId, apiKey, pollInterval, maxTimeout, options?.onProgress);
    this.logger.log(`Tiến trình xử lý ${jobId} hoàn tất thành công.`);
    options?.onProgress?.(78);

    // Bước 3: Lấy kết quả Markdown từ LlamaParse
    const rawMarkdown = await this.fetchMarkdownResult(jobId, apiKey);

    // Bước 4: Hậu xử lý Regex làm sạch nhiễu và chuẩn hóa phân cấp pháp luật
    const cleanedMarkdown = this.cleanLegalMarkdown(rawMarkdown);

    return {
      jobId,
      fileName: safeFilename,
      rawMarkdown,
      cleanedMarkdown,
      characterCount: cleanedMarkdown.length,
    };
  }

  /**
   * Tải tệp PDF lên LlamaParse API v2 (/api/v2/parse/upload) với multipart/form-data.
   * LlamaParse v2 yêu cầu tham số cấu hình phải nằm trong trường JSON "configuration".
   */
  private async uploadToLlamaParse(
    fileBuffer: Buffer,
    safeFilename: string,
    apiKey: string,
  ): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([Uint8Array.from(fileBuffer)]), safeFilename);

    const tier = this.configService.get<string>('LLAMA_PARSE_TIER', 'cost_effective');
    const configuration = {
      tier,
      version: 'latest',
      agentic_options: {
        custom_prompt: LEGAL_PARSING_INSTRUCTION,
      },
      processing_options: {
        ocr_parameters: {
          languages: ['vi'],
        },
      },
    };
    formData.append('configuration', JSON.stringify(configuration));

    try {
      const response = await firstValueFrom(
        this.httpService.post<{ id?: string; job_id?: string; job?: { id?: string } }>(
          LLAMA_PARSE_V2_UPLOAD_URL,
          formData,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            timeout: 60000,
          },
        ),
      );

      const jobId = response.data?.id || response.data?.job_id || response.data?.job?.id;
      if (!jobId) {
        throw new InternalServerErrorException(
          'Không nhận được mã tiến trình (job_id) từ phản hồi của LlamaParse API v2.',
        );
      }
      return jobId;
    } catch (error: any) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      const message =
        error.response?.data?.detail ||
        error.response?.data?.message ||
        error.message ||
        'Không thể kết nối đến LlamaParse upload endpoint v2.';
      this.logger.error(`Lỗi khi tải tệp lên LlamaParse: ${message}`);
      throw new BadRequestException(`Lỗi khi gửi tệp lên LlamaParse: ${message}`);
    }
  }

  /**
   * Thăm dò trạng thái tiến trình xử lý tại /api/v2/parse/:jobId mỗi 2 giây.
   */
  private async pollJobStatus(
    jobId: string,
    apiKey: string,
    pollIntervalMs: number,
    maxTimeoutMs: number,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const startTime = Date.now();
    const endpoint = `${LLAMA_PARSE_V2_JOB_URL}/${jobId}`;

    while (Date.now() - startTime < maxTimeoutMs) {
      const elapsed = Date.now() - startTime;
      if (onProgress) {
        const estimated = Math.min(75, 25 + Math.round((elapsed / Math.min(maxTimeoutMs, 60000)) * 50));
        onProgress(estimated);
      }
      try {
        const response = await firstValueFrom(
          this.httpService.get<{ status?: string; job?: { status?: string; error_message?: string }; error_message?: string; error?: string }>(
            endpoint,
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
              timeout: 10000,
            },
          ),
        );

        const status = String(
          response.data?.job?.status || response.data?.status || '',
        ).toUpperCase();

        if (status === 'SUCCESS' || status === 'COMPLETED') {
          return;
        }

        if (status === 'ERROR' || status === 'FAILED') {
          const detail =
            response.data?.job?.error_message ||
            response.data?.error_message ||
            response.data?.error ||
            'Tiến trình LlamaParse báo trạng thái lỗi.';
          throw new BadRequestException(`LlamaParse xử lý thất bại: ${detail}`);
        }

        // Đang chờ xử lý: PENDING, PROCESSING, WAITING, RUNNING
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      } catch (error: any) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        this.logger.warn(`Lỗi khi kiểm tra trạng thái job ${jobId}: ${error.message}. Thử lại...`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }

    throw new RequestTimeoutException(
      `Quá thời gian chờ xử lý văn bản từ LlamaParse (vượt quá ${Math.round(maxTimeoutMs / 1000)} giây).`,
    );
  }

  /**
   * Tải nội dung Markdown sau khi tiến trình hoàn tất qua endpoint v2 (?expand=markdown) hoặc v1 fallback.
   */
  private async fetchMarkdownResult(jobId: string, apiKey: string): Promise<string> {
    const v2Endpoint = `${LLAMA_PARSE_V2_JOB_URL}/${jobId}?expand=markdown`;

    try {
      const response = await firstValueFrom(
        this.httpService.get<any>(v2Endpoint, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json, text/markdown, text/plain',
          },
          timeout: 45000,
        }),
      );

      // 1. Kiểm tra cấu trúc v2 text tổng hợp
      if (response.data?.markdown?.text && typeof response.data.markdown.text === 'string') {
        return response.data.markdown.text;
      }

      // 2. Kiểm tra cấu trúc v2 danh sách trang markdown.pages
      if (Array.isArray(response.data?.markdown?.pages) && response.data.markdown.pages.length > 0) {
        return response.data.markdown.pages
          .map((p: any) => (typeof p?.markdown === 'string' ? p.markdown : ''))
          .filter(Boolean)
          .join('\n\n');
      }

      // 3. Chuỗi trực tiếp
      if (typeof response.data === 'string') {
        return response.data;
      }

      // 4. Các định dạng markdown lồng khác
      if (response.data && typeof response.data.markdown === 'string') {
        return response.data.markdown;
      }
      if (response.data && typeof response.data.job?.result?.markdown === 'string') {
        return response.data.job.result.markdown;
      }
      if (response.data && typeof response.data.result?.markdown === 'string') {
        return response.data.result.markdown;
      }

      // Fallback sang endpoint v1 cũ nếu v2 không trả về trường markdown
      try {
        const v1Endpoint = `${LLAMA_PARSE_V1_JOB_URL}/${jobId}/result/markdown`;
        const v1Res = await firstValueFrom(
          this.httpService.get<any>(v1Endpoint, {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 20000,
          }),
        );
        if (typeof v1Res.data === 'string') return v1Res.data;
        if (v1Res.data?.markdown) return v1Res.data.markdown;
      } catch {
        // Bỏ qua lỗi v1 fallback
      }

      return JSON.stringify(response.data);
    } catch (error: any) {
      const message =
        error.response?.data?.detail ||
        error.response?.data?.message ||
        error.message ||
        'Không thể lấy kết quả Markdown từ LlamaParse.';
      this.logger.error(`Lỗi khi tải kết quả Markdown từ job ${jobId}: ${message}`);
      throw new InternalServerErrorException(`Lỗi khi lấy kết quả Markdown từ LlamaParse: ${message}`);
    }
  }

  /**
   * Làm sạch và chuẩn hóa nội dung Markdown trích xuất từ văn bản pháp luật:
   * - Chuẩn hóa ngắt dòng \r\n thành \n.
   * - Loại bỏ phân trang, ghi chú comment HTML của LlamaParse.
   * - Loại bỏ các ghi chú về con dấu, chữ ký số, chữ ký quét tay.
   * - Loại bỏ các dòng số trang đơn lẻ (ví dụ: Trang 1, - 2 -, 1/15, hoặc số nguyên đứng riêng).
   * - Chuẩn hóa phân cấp tiêu đề pháp lý (Chương, Mục, Điều) sang định dạng Markdown (#, ##, ###).
   * - Chuẩn hóa khoảng trắng dư thừa và dòng trống liên tiếp.
   */
  cleanLegalMarkdown(rawMarkdown: string): string {
    if (!rawMarkdown || typeof rawMarkdown !== 'string') {
      return '';
    }

    let text = rawMarkdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 1. Loại bỏ chú thích HTML (ví dụ: <!--- Page 1 --->) và ký tự form-feed \f
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    text = text.replace(/\f/g, '\n');

    // 2. Loại bỏ các ghi chú con dấu, chữ ký số, chữ ký điện tử
    text = text.replace(
      /\((?:Ký tên|Ký|Đã ký|Ký tên,\s*đóng dấu|Chữ ký số|Chữ ký điện tử|Ký bởi)[^)]*\)/gi,
      '',
    );

    const lines = text.split('\n');
    const cleanedLines: string[] = [];

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      // 3. Loại bỏ các dòng chỉ chứa số trang đơn lẻ
      if (
        /^(?:trang|page)\s*\d+(\s*[/\\-]\s*\d+)?$/i.test(trimmed) ||
        /^[-–—]\s*\d+\s*[-–—]$/.test(trimmed) ||
        /^\d+\s*[/\\-]\s*\d+$/.test(trimmed) ||
        /^\[\s*\d+\s*\]$/.test(trimmed) ||
        /^\d+$/.test(trimmed)
      ) {
        continue;
      }

      // 4. Loại bỏ các dòng chỉ gồm dấu chấm/gạch ngang dài ký tên
      if (/^[\.\_\-—]{4,}$/.test(trimmed)) {
        continue;
      }

      let processedLine = rawLine;

      // 5. Chuẩn hóa phân cấp tiêu đề pháp lý nếu chưa có ký tự markdown heading
      if (/^Chương\s+[IVXLCDM\d]+/i.test(trimmed) && !trimmed.startsWith('#')) {
        processedLine = `# ${trimmed}`;
      } else if (/^Mục\s+\d+/i.test(trimmed) && !trimmed.startsWith('#')) {
        processedLine = `## ${trimmed}`;
      } else if (/^Điều\s+\d+[\.:\s]/i.test(trimmed) && !trimmed.startsWith('#')) {
        processedLine = `### ${trimmed}`;
      }

      cleanedLines.push(processedLine.trimEnd());
    }

    return cleanedLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
