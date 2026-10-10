import { AuthService } from './auth.service';

describe('AuthService', () => {
  const sign = jest.fn().mockReturnValue('test-token');
  const service = new AuthService({} as any, { sign } as any, {} as any);

  it('chỉ đưa dữ liệu công khai vào phản hồi đăng nhập', () => {
    const result = service.login({
      id: 1, username: 'admin', role: 'admin', password: 'hash',
      otpCode: '123456', otpCreatedAt: new Date(),
    });
    expect(result.access_token).toBe('test-token');
    expect(result.user).toEqual({ id: 1, username: 'admin', role: 'admin' });
    // Phiên bản tài khoản là một phần của JWT để hỗ trợ thu hồi phiên.
    expect(sign).toHaveBeenCalledWith({ username: 'admin', sub: 1, role: 'admin', version: 0 });
  });
});
