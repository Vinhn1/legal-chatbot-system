import { UsersService } from './users.service';

describe('UsersService', () => {
  const findOne = jest.fn();
  const findOneBy = jest.fn().mockResolvedValue(null);
  const create = jest.fn().mockImplementation(value => value);
  const save = jest.fn().mockImplementation(async value => value);
  const service = new UsersService({ findOne, findOneBy, create, save } as any, {} as any);

  it('không truy vấn khi định danh rỗng', async () => {
    expect(await service.findByUsername('')).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('từ chối vai trò cũ và chỉ tạo tài khoản hợp lệ', async () => {
    // Vai trò ngoài danh sách cho phép phải bị từ chối tại máy chủ.
    const input = { username: 'new', name: 'Nhân viên', email: 'new@example.invalid', password: 'test-password', role: 'sales' };
    await expect(service.createUser(input)).rejects.toThrow('Vai trò không hợp lệ');
    const user = await service.createUser({ ...input, role: 'staff' });
    expect(user.role).toBe('staff');
    expect(user.name).toBe('Nhân viên');
  });
});
