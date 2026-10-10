import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const validateUser = jest.fn();
  const login = jest.fn();
  const controller = new AuthController({ validateUser, login } as any);

  beforeEach(() => jest.clearAllMocks());

  it('từ chối thông tin đăng nhập sai', async () => {
    validateUser.mockResolvedValue(null);
    await expect(controller.login({ username: 'unknown', password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(login).not.toHaveBeenCalled();
  });

  it('trả token cho người dùng hợp lệ', async () => {
    const user = { id: 1, username: 'admin', role: 'admin' };
    validateUser.mockResolvedValue(user);
    login.mockReturnValue({ access_token: 'test-token', user });
    expect(await controller.login({ username: 'admin', password: 'test' })).toEqual({ access_token: 'test-token', user });
  });
});
