import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ChatHistoryService } from '../chat-history/chat-history.service';
import { LegalService } from '../legal/legal.service';
import { AccessScope, EffectiveStatus, LegalDocumentType } from '../legal/entities/legal-document.entity';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModelConfig } from './model-config.entity';

/** Dữ liệu nguồn do AI Core truy xuất trực tiếp từ collection pháp luật. */
interface LegalSource {
  chunk_id?: string;
  content?: string;
  title?: string;
  url?: string;
  doc_number?: string;
  chapter?: string;
  article_number?: string;
  clause_number?: string;
  point_id?: string;
  issued_date?: string;
  effective_status?: string;
  warning?: string;
}

/** Trích dẫn do mô hình đề xuất, chưa được tin cậy trước khi đối chiếu kho vector. */
interface ProposedCitation {
  chunk_id: string;
  doc_number: string;
  article: string;
  clause: string;
  snippet: string;
  source_url: string;
}

const REFUSAL = 'Chưa tìm thấy căn cứ pháp lý trong cơ sở dữ liệu hiện có. Vui lòng nêu rõ văn bản, Điều hoặc Khoản cần tra cứu.';

/** So khớp nhãn Điều/Khoản với số trong metadata, không chấp nhận số tự thêm. */
function matchesUnit(label: string, prefix: string, number?: string): boolean {
  return label === (number ? `${prefix} ${number}` : '');
}

@Injectable()
export class ChatService {
  private readonly aiServiceBaseUrl: string;
  private readonly aiRequestTimeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly chatHistoryService: ChatHistoryService,
    @Optional() private readonly legalService?: LegalService,
    @Optional() @InjectRepository(ModelConfig) private readonly modelConfigRepository?: Repository<ModelConfig>,
  ) {
    this.aiServiceBaseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    this.aiRequestTimeoutMs = this.configService.get<number>('AI_SERVICE_TIMEOUT_MS', 60000);
  }

  private getAiServiceUrl(path: string): string {
    return `${this.aiServiceBaseUrl}${path}`;
  }

  /** Mã hóa khóa trước khi lưu; thiếu khóa máy chủ thì từ chối thao tác. */
  private encryptionKey(): Buffer {
    const secret = this.configService.get<string>('LLM_KEY_ENCRYPTION_SECRET');
    if (!secret || secret.length < 32) throw new HttpException('Chưa cấu hình khóa mã hóa máy chủ.', HttpStatus.SERVICE_UNAVAILABLE);
    return createHash('sha256').update(secret).digest();
  }

  private encryptKey(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decryptKey(value: string): string {
    const [iv, tag, data] = value.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
  }

  /** Chỉ trả trạng thái và phần đuôi đã che, không gửi khóa thật cho client. */
  async getModelConfig() {
    const config = await this.modelConfigRepository?.findOneBy({ id: 1 });
    const key = config?.encryptedKey ? this.decryptKey(config.encryptedKey) : '';
    return { provider: config?.provider || 'gemini', has_api_key: Boolean(key), masked_api_key: key ? `${'*'.repeat(Math.min(key.length, 16))}${key.slice(-4)}` : '' };
  }

  async updateModelConfig(input: { provider?: string; api_key?: string }) {
    const provider = input?.provider;
    if (!['gemini', 'openai', 'anthropic', 'local'].includes(provider || '')) throw new HttpException('Nhà cung cấp không hợp lệ.', HttpStatus.BAD_REQUEST);
    const key = input.api_key?.trim();
    if (key && (key.length > 512 || /[\r\n\x00-\x1f]/.test(key))) throw new HttpException('Khóa API không hợp lệ.', HttpStatus.BAD_REQUEST);
    if (!this.modelConfigRepository) throw new HttpException('Chưa sẵn sàng lưu cấu hình.', HttpStatus.SERVICE_UNAVAILABLE);
    const current = await this.modelConfigRepository.findOneBy({ id: 1 });
    if (current?.provider !== provider && provider !== 'local' && !key) {
      throw new HttpException('Cần nhập khóa API khi đổi nhà cung cấp.', HttpStatus.BAD_REQUEST);
    }
    const record = current || this.modelConfigRepository.create({ id: 1 });
    record.provider = provider!;
    if (key) record.encryptedKey = this.encryptKey(key);
    else if (provider === 'local') record.encryptedKey = null;
    await this.modelConfigRepository.save(record);
    return this.getModelConfig();
  }

  /** Kiểm tra khóa bằng yêu cầu nhỏ tới API chính thức, không ghi khóa vào URL hay nhật ký. */
  async testModelConnection(input: { provider?: string; api_key?: string }) {
    const provider = input?.provider;
    if (!['gemini', 'openai', 'anthropic', 'local'].includes(provider || '')) throw new HttpException('Nhà cung cấp không hợp lệ.', HttpStatus.BAD_REQUEST);
    const saved = await this.modelConfigRepository?.findOneBy({ id: 1 });
    const key = input.api_key?.trim() || (saved && saved.provider === provider && saved.encryptedKey ? this.decryptKey(saved.encryptedKey) : '');
    if (provider !== 'local' && !key) throw new HttpException('Chưa có khóa API để kiểm tra.', HttpStatus.BAD_REQUEST);
    const started = Date.now();
    try {
      if (provider === 'gemini') {
        const model = this.configService.get<string>('GEMINI_MODEL', 'gemini-2.5-flash-lite');
        await firstValueFrom(this.httpService.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          { contents: [{ parts: [{ text: 'Trả lời một từ: OK' }] }], generationConfig: { maxOutputTokens: 8 } },
          { headers: { 'x-goog-api-key': key }, timeout: 10000 }));
      } else if (provider === 'openai') {
        await firstValueFrom(this.httpService.post('https://api.openai.com/v1/chat/completions',
          { model: this.configService.get<string>('OPENAI_MODEL', 'gpt-4o-mini'), max_tokens: 8, messages: [{ role: 'user', content: 'Reply OK' }] },
          { headers: { Authorization: `Bearer ${key}` }, timeout: 10000 }));
      } else if (provider === 'anthropic') {
        await firstValueFrom(this.httpService.post('https://api.anthropic.com/v1/messages',
          { model: this.configService.get<string>('ANTHROPIC_MODEL', 'claude-3-5-haiku-latest'), max_tokens: 8, messages: [{ role: 'user', content: 'Reply OK' }] },
          { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout: 10000 }));
      } else {
        const baseUrl = this.configService.get<string>('LOCAL_LLM_BASE_URL');
        if (!baseUrl) throw new Error('Thiếu địa chỉ mô hình nội bộ.');
        await firstValueFrom(this.httpService.get(`${baseUrl.replace(/\/$/, '')}/models`, { timeout: 8000 }));
      }
      return { ok: true, latency_ms: Date.now() - started };
    } catch {
      return { ok: false, latency_ms: Date.now() - started };
    }
  }

  private handleAiError(error: any): never {
    const status = error.response?.status || HttpStatus.SERVICE_UNAVAILABLE;
    // Không chuyển thông điệp thô của dịch vụ bên trong ra client.
    throw new HttpException('Dịch vụ tra cứu hiện chưa sẵn sàng.', status);
  }

  private async getFromAi(path: string, params?: Record<string, unknown>): Promise<any> {
    try {
      const response = await firstValueFrom(this.httpService.get(this.getAiServiceUrl(path), {
        params,
        timeout: this.aiRequestTimeoutMs,
      }));
      return response.data;
    } catch (error) {
      this.handleAiError(error);
    }
  }

  private async postToAi(path: string, body: unknown): Promise<any> {
    try {
      const response = await firstValueFrom(this.httpService.post(this.getAiServiceUrl(path), body, {
        timeout: this.aiRequestTimeoutMs,
      }));
      return response.data;
    } catch (error) {
      this.handleAiError(error);
    }
  }

  /** Gọi endpoint nạp dữ liệu chỉ sau khi có token nội bộ cấu hình trên máy chủ. */
  private async postInternalToAi(path: string, body: unknown): Promise<any> {
    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) throw new HttpException('Dịch vụ nạp văn bản chưa sẵn sàng.', HttpStatus.SERVICE_UNAVAILABLE);
    try {
      const response = await firstValueFrom(this.httpService.post(this.getAiServiceUrl(path), body, {
        timeout: this.aiRequestTimeoutMs, headers: { 'X-Internal-Token': token },
      }));
      return response.data;
    } catch (error) {
      this.handleAiError(error);
    }
  }

  /** Gửi câu hỏi, lưu hội thoại và chuẩn hóa nguồn thành trích dẫn cho giao diện. */
  async sendMessageToAi(message: string, sessionId?: string) {
    const history = sessionId
      ? (await this.chatHistoryService.getHistory(sessionId, 10)).map(log => ({
          role: log.role,
          message: log.message,
        }))
      : [];

    const model = await this.modelConfigRepository?.findOneBy({ id: 1 });
    let result: any;
    if (model) {
      const internalToken = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
      if (!internalToken) throw new HttpException('Dịch vụ trả lời chưa sẵn sàng.', HttpStatus.SERVICE_UNAVAILABLE);
      const modelKey = model.encryptedKey ? this.decryptKey(model.encryptedKey) : undefined;
      try {
        const response = await firstValueFrom(this.httpService.post(this.getAiServiceUrl('/chat'),
          { message, history, model_provider: model.provider, model_api_key: modelKey },
          { timeout: this.aiRequestTimeoutMs, headers: { 'X-Internal-Token': internalToken } }));
        result = response.data;
      } catch (error) { this.handleAiError(error); }
    } else {
      result = await this.postToAi('/chat', { message, history });
    }
    const proposed: ProposedCitation[] = Array.isArray(result?.citations) ? result.citations : [];
    const ids = proposed.filter(item => item && typeof item.chunk_id === 'string' && item.chunk_id.trim())
      .map(item => item.chunk_id).slice(0, 20);
    let stored: LegalSource[] = [];
    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (ids.length && token) {
      try {
        // Đọc lại ChromaDB qua API nội bộ; dữ liệu nguồn trong phản hồi LLM không được dùng để xác thực.
        const response = await firstValueFrom(this.httpService.post(this.getAiServiceUrl('/legal/citations/verify'),
          { chunk_ids: ids }, { timeout: this.aiRequestTimeoutMs, headers: { 'X-Internal-Token': token } }));
        stored = Array.isArray(response.data?.sources) ? response.data.sources : [];
      } catch {
        // Lỗi kho nguồn phải đóng luồng xác thực và từ chối câu trả lời thiếu căn cứ.
        stored = [];
      }
    }
    const byId = new Map(stored.map(source => [source.chunk_id, source]));
    const citations = proposed.flatMap(item => {
      if (!item || typeof item.chunk_id !== 'string' || typeof item.doc_number !== 'string' ||
          typeof item.article !== 'string' || typeof item.clause !== 'string' ||
          typeof item.snippet !== 'string' || typeof item.source_url !== 'string') return [];
      const source = byId.get(item.chunk_id);
      if (!source || item.doc_number !== source.doc_number ||
          !matchesUnit(item.article, 'Điều', source.article_number) ||
          !matchesUnit(item.clause, 'Khoản', source.clause_number) ||
          item.source_url !== (source.url ?? '') || !source.content ||
          !item.snippet.trim() || !source.content.includes(item.snippet.trim())) return [];
      return [{
        chunkId: source.chunk_id, content: source.content, title: source.title || 'Văn bản pháp luật',
        url: source.url ?? '', docNumber: source.doc_number, chapter: source.chapter ?? '',
        articleNumber: source.article_number ?? '', clauseNumber: source.clause_number ?? '',
        pointId: source.point_id ?? '',
        issuedDate: source.issued_date ?? '', effectiveStatus: source.effective_status ?? 'unknown',
        warning: source.warning ?? '', verified: true,
      }];
    });
    // Nếu một căn cứ trong câu trả lời không hợp lệ, không phát hành lập luận có thể dựa vào căn cứ đó.
    const answer = proposed.length > 0 && citations.length === proposed.length && typeof result?.answer === 'string'
      ? result.answer : REFUSAL;
    if (sessionId) {
      await this.chatHistoryService.saveMessage(sessionId, 'user', message);
      await this.chatHistoryService.saveMessage(sessionId, 'bot', answer);
    }
    return { answer, citations: answer === REFUSAL ? [] : citations, suggested_questions: result?.suggested_questions ?? [] };
  }

  getAllHistory() {
    return this.chatHistoryService.getAllHistory();
  }

  /** Lấy thống kê chỉ từ những văn bản được phép công bố. */
  getPublicSummary() {
    return this.getFromAi('/legal/public-summary');
  }

  getSessionHistory(sessionId: string) {
    return this.chatHistoryService.getHistory(sessionId, 50);
  }

  getRagConfig() {
    return this.getFromAi('/config');
  }

  updateRagConfig(config: unknown) {
    return this.postToAi('/config', config);
  }

  getDocuments() {
    return this.getFromAi('/documents');
  }

  async deleteDocument(name: string) {
    try {
      const response = await firstValueFrom(this.httpService.delete(this.getAiServiceUrl('/documents'), {
        params: { name },
        timeout: this.aiRequestTimeoutMs,
      }));
      return response.data;
    } catch (error) {
      this.handleAiError(error);
    }
  }

  async ingestFromUrl(url: string) {
    // Giữ route cũ tương thích và đồng bộ danh mục sau khi AI Core lập chỉ mục.
    const result = await this.postInternalToAi('/ingest-url', { url: url.trim() });
    if (this.legalService && ['indexed', 'duplicate'].includes(result?.status)) {
      const existing = await this.legalService.findByContentHash(result.content_hash);
      if (!existing) await this.legalService.createDocument({
        documentNumber: result.doc_number,
        documentType: result.document_type as LegalDocumentType,
        title: result.doc_title,
        issuingAuthority: result.issuing_authority,
        issuedDate: result.issued_date,
        effectiveDate: result.effective_date,
        effectiveStatus: result.effective_status as EffectiveStatus,
        sourceUrl: result.source_url,
        contentHash: result.content_hash,
        scope: result.scope as AccessScope,
      });
    }
    return result;
  }

  ingestFromHtml(sourceTitle: string, htmlContent: string, sourceUrl?: string) {
    return this.postToAi('/ingest-html', {
      source_title: sourceTitle,
      html_content: htmlContent,
      source_url: sourceUrl,
    });
  }

  getWebDocumentChunks(name: string) {
    return this.getFromAi('/web-document-chunks', { name });
  }

  uploadDocument(_file: any) {
    throw new HttpException('Nạp văn bản pháp luật sẽ được triển khai ở T04.', HttpStatus.NOT_IMPLEMENTED);
  }

  getDynamicSuggestions() {
    return this.getFromAi('/suggestions');
  }
}
