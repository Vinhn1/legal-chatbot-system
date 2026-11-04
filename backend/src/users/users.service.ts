import { Injectable, OnModuleInit, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { User } from './user.entity';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';
import { OtpService } from '../auth/otp.service';
import { User as Account } from './user.entity';
import { hasControlCharacters } from '../common/validation/text';

/** Kiểm tra các trường được nạp từ biểu mẫu hoặc CSV trước khi ghi dữ liệu. */
function validateAccount(dto: any): void {
  if (!dto || !/^[a-zA-Z][a-zA-Z0-9_.]{2,39}$/.test(String(dto.username || ''))) throw new BadRequestException('Tên đăng nhập không hợp lệ.');
  if (typeof dto.name !== 'string' || !dto.name.trim() || dto.name.length > 120 || (/[<>]/.test(dto.name) || hasControlCharacters(dto.name))) throw new BadRequestException('Họ tên không hợp lệ.');
  if (typeof dto.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email) || dto.email.length > 254) throw new BadRequestException('Email không hợp lệ.');
  if (dto.phone && !/^0\d{9}$/.test(String(dto.phone))) throw new BadRequestException('Số điện thoại không hợp lệ.');
  if (!['admin', 'staff'].includes(dto.role)) throw new BadRequestException('Vai trò không hợp lệ.');
  if (typeof dto.password !== 'string' || dto.password.length < 8 || dto.password.length > 128) throw new BadRequestException('Mật khẩu phải có từ 8 đến 128 ký tự.');
  if ([dto.username, dto.name, dto.email, dto.phone].some(value => /^[\s]*[=+\-@]/.test(String(value || '')))) throw new BadRequestException('Dữ liệu chứa công thức CSV không an toàn.');
}

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly emailService: EmailService,
    private readonly otp?: OtpService,
  ) {}

  // Tạo tài khoản quản trị khởi tạo và các tài khoản thử nghiệm phục vụ trải nghiệm
  async onModuleInit() {
    const password = process.env.ADMIN_SEED_PASSWORD;
    if (password) {
      const existing = await this.userRepository.findOneBy({ username: 'admin' });
      if (!existing) {
        const admin = this.userRepository.create({
          username: 'admin',
          password: await bcrypt.hash(password, 10),
          role: 'admin',
          name: 'Quản trị viên',
        });
        await this.userRepository.save(admin);
      }
    }

    // Khởi tạo các tài khoản demo thử nghiệm (không bật 2FA để khách dễ dàng trải nghiệm 1-click)
    const demoConfigs = [
      { username: 'demo_admin', role: 'admin', name: 'Quản trị viên Demo' },
      { username: 'demo_staff', role: 'staff', name: 'Biên tập viên Demo' },
      { username: 'demo_viewer', role: 'staff', name: 'Khách trải nghiệm Demo' },
    ];
    for (const demo of demoConfigs) {
      const found = await this.userRepository.findOneBy({ username: demo.username });
      if (!found) {
        await this.createDemoUser(demo.username, demo.role, demo.name);
      }
    }
  }

  /** Tạo nhanh tài khoản demo khi người dùng yêu cầu trải nghiệm trên giao diện */
  async createDemoUser(username: string, role: string, name: string): Promise<User> {
    const defaultPassword = 'Demo@Password2026!';
    const user = this.userRepository.create({
      username,
      password: await bcrypt.hash(defaultPassword, 10),
      role,
      name,
      twoFaEnabled: false,
    });
    return await this.userRepository.save(user);
  }

  // 2. Hàm tìm người dùng theo username (dành cho module Auth kiểm tra)
  async findByUsername(username: string): Promise<User | null> {
    if (!username) return null;
    const cleanId = username.trim();
    return await this.userRepository.findOne({
      where: [
        { username: ILike(cleanId) },
        { email: ILike(cleanId) },
        { phone: cleanId },
      ],
    });
  }

  // 3. Lấy profile admin theo id
  async getProfile(id: number): Promise<User> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản quản trị.');
    }
    return user;
  }

  // 4. Cập nhật profile admin
  async updateProfile(id: number, profileData: Partial<User>): Promise<User> {
    const user = await this.getProfile(id);
    if (profileData.name !== undefined && (typeof profileData.name !== 'string' || !profileData.name.trim() || profileData.name.length > 120 || (/[<>]/.test(profileData.name) || hasControlCharacters(profileData.name)))) {
      throw new BadRequestException('Họ tên không hợp lệ.');
    }
    if (profileData.email !== undefined && profileData.email !== null && (typeof profileData.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileData.email) || profileData.email.length > 254)) {
      throw new BadRequestException('Email không hợp lệ.');
    }
    const allowedFields: (keyof User)[] = ['name', 'email', 'dob', 'address', 'avatar'];
    for (const key of allowedFields) {
      if (profileData[key] !== undefined) {
        (user as any)[key] = profileData[key];
      }
    }
    return await this.userRepository.save(user);
  }

  // 5. Đổi mật khẩu Admin có kiểm tra mật khẩu hiện tại
  async changePassword(id: number, dto: any): Promise<{ success: boolean; message: string }> {
    const { currentPassword, newPassword } = dto;
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 128 || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      throw new BadRequestException('Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới.');
    }

    const user = await this.getProfile(id);
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Mật khẩu hiện tại không chính xác.');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await this.userRepository.save(user);

    return {
      success: true,
      message: 'Đổi mật khẩu thành công.',
    };
  }

  /** Chỉ gọi sau khi AuthService đã kiểm tra mật khẩu hợp lệ. */
  async requestLoginOtp(id: number) {
    const user = await this.getProfile(id);
    if (!user.twoFaEnabled) throw new BadRequestException('Tài khoản chưa bật xác thực hai lớp.');
    return this.otp!.issue(id, user.email!, 'login');
  }

  /** Challenge bật/tắt gắn với trạng thái đích để không đảo trạng thái ngoài ý muốn. */
  async request2FaOtp(id: number) {
    const user = await this.getProfile(id);
    return this.otp!.issue(id, user.email!, 'toggle_2fa', String(!user.twoFaEnabled));
  }

  async toggle2Fa(id: number, otpCode: string, challengeId: string) {
    return this.otp!.verify(challengeId, otpCode, 'toggle_2fa', id, undefined, true, async (manager) => {
      const user = await manager.findOneByOrFail(Account, { id });
      user.twoFaEnabled = !user.twoFaEnabled;
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await manager.save(user);
      return { success: true, twoFaEnabled: user.twoFaEnabled, message: 'Đã cập nhật xác thực hai lớp. Vui lòng đăng nhập lại.' };
    });
  }

  /** Ràng buộc số điện thoại đích ngay khi phát hành challenge. */
  async requestPhoneChangeOtp(id: number, newPhone: string) {
    if (typeof newPhone !== 'string' || !/^0\d{9}$/.test(newPhone)) throw new BadRequestException('Số điện thoại không hợp lệ.');
    const user = await this.getProfile(id);
    return this.otp!.issue(id, user.email!, 'phone_change', newPhone);
  }

  async verifyPhoneChange(id: number, newPhone: string, otpCode: string, challengeId: string) {
    if (typeof newPhone !== 'string' || !/^0\d{9}$/.test(newPhone)) throw new BadRequestException('Số điện thoại không hợp lệ.');
    return this.otp!.verify(challengeId, otpCode, 'phone_change', id, newPhone, true, async manager => {
      await manager.update(Account, id, { phone: newPhone });
      return { success: true, phone: newPhone, message: 'Đã cập nhật số điện thoại.' };
    });
  }

  /** Thiếu challenge đăng nhập sau bước mật khẩu sẽ luôn bị từ chối. */
  async verify2FaOtp(username: string, otpCode: string, challengeId: string): Promise<User> {
    const user = await this.findByUsername(username);
    if (!user || !user.twoFaEnabled) throw new BadRequestException('Thông tin xác thực không hợp lệ.');
    return this.otp!.verify(challengeId, otpCode, 'login', user.id, '', true,
      manager => manager.findOneByOrFail(Account, { id: user.id }));
  }

  // 11. Lấy danh sách tài khoản quản trị và nhân viên.
  async findAll(): Promise<User[]> {
    return await this.userRepository.find({
      order: { id: 'ASC' }
    });
  }

  // 12. Tạo tài khoản nhân sự mới (chỉ Admin)
  async createUser(dto: any): Promise<User> {
    validateAccount(dto);
    const { username, password, role, name, phone, email, dob, address } = dto;
    if (!username || !password) {
      throw new BadRequestException('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
    }

    const existingUser = await this.userRepository.findOne({ where: { username: ILike(username) } });
    if (existingUser) {
      throw new BadRequestException('Tên đăng nhập đã tồn tại trong hệ thống.');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = this.userRepository.create({
      username,
      password: hashedPassword,
      role: role === 'admin' ? 'admin' : 'staff',
      name: name || 'Nhân viên',
      phone: phone || null,
      email: email || null,
      dob: dob || null,
      address: address || null,
    });

    return await this.userRepository.save(newUser);
  }

  // 13. Cập nhật tài khoản nhân sự bởi Admin (bao gồm đổi mật khẩu và đổi role)
  async updateUserByAdmin(id: number, dto: any): Promise<User> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản nhân viên.');
    }

    if (user.username === 'admin') {
      if (dto.role && dto.role !== 'admin') {
        throw new BadRequestException('Không thể thay đổi vai trò của tài khoản Admin hệ thống mặc định.');
      }
    }

    let tokenInvalidated = false;

    if (dto.password) {
      if (typeof dto.password !== 'string' || dto.password.length < 8 || dto.password.length > 128) {
        throw new BadRequestException('Mật khẩu phải có từ 8 đến 128 ký tự.');
      }
      user.password = await bcrypt.hash(dto.password, 10);
      tokenInvalidated = true;
    }
    if (dto.name !== undefined) {
      if (typeof dto.name !== 'string' || !dto.name.trim() || dto.name.length > 120 || (/[<>]/.test(dto.name) || hasControlCharacters(dto.name))) {
        throw new BadRequestException('Họ tên không hợp lệ.');
      }
      user.name = dto.name.trim();
    }
    if (dto.phone !== undefined && dto.phone !== null && dto.phone !== '') {
      if (!/^0\d{9}$/.test(String(dto.phone))) throw new BadRequestException('Số điện thoại không hợp lệ.');
      user.phone = String(dto.phone);
    }
    if (dto.email !== undefined && dto.email !== null && dto.email !== '') {
      if (typeof dto.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.email) || dto.email.length > 254) {
        throw new BadRequestException('Email không hợp lệ.');
      }
      user.email = dto.email.toLowerCase().trim();
    }
    if (dto.dob !== undefined) user.dob = dto.dob;
    if (dto.address !== undefined) user.address = dto.address;
    if (dto.role !== undefined) {
      const nextRole = dto.role === 'admin' ? 'admin' : 'staff';
      if (user.role !== nextRole) {
        user.role = nextRole;
        tokenInvalidated = true;
      }
    }

    if (tokenInvalidated) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }

    return await this.userRepository.save(user);
  }

  // 14. Xóa tài khoản nhân sự (chỉ Admin)
  async deleteUser(id: number, currentUserId?: number): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản nhân viên.');
    }

    if (user.username === 'admin') {
      throw new BadRequestException('Không thể xóa tài khoản Admin hệ thống mặc định.');
    }
    if (id === currentUserId) throw new BadRequestException('Không thể xóa tài khoản đang đăng nhập.');

    await this.userRepository.remove(user);
    return {
      success: true,
      message: 'Xóa tài khoản nhân sự thành công.',
    };
  }

  // 15. Tìm tài khoản nhân sự theo email
  async findByEmail(email: string): Promise<User | null> {
    if (!email) return null;
    return await this.userRepository.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  // 16. Lưu thông tin người dùng
  async saveUser(user: User): Promise<User> {
    return await this.userRepository.save(user);
  }

  /** Thu hồi các JWT đã cấp cho tài khoản khi người dùng đăng xuất. */
  async revokeSessions(id: number): Promise<void> {
    const user = await this.getProfile(id);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await this.userRepository.save(user);
  }

  // 17. Tạo tài khoản nhân sự hàng loạt (Bulk Import từ CSV)
  async bulkImportUsers(usersData: any[]): Promise<{
    total: number;
    successCount: number;
    failedCount: number;
    results: Array<{ row: number; username: string; status: 'success' | 'failed'; message: string }>;
  }> {
    if (!Array.isArray(usersData) || usersData.length === 0) {
      throw new BadRequestException('Danh sách dữ liệu import trống hoặc không hợp lệ.');
    }
    if (usersData.length > 500) throw new BadRequestException('Mỗi lần chỉ được nạp tối đa 500 tài khoản.');

    const results: Array<{ row: number; username: string; status: 'success' | 'failed'; message: string }> = [];
    let successCount = 0;
    let failedCount = 0;

    // Lấy trước tất cả username trong DB để tránh query trùng lặp
    const existingUsers = await this.userRepository.find({ select: { username: true } });
    const existingUsernamesSet = new Set(existingUsers.map(u => u.username.toLowerCase()));

    for (let index = 0; index < usersData.length; index++) {
      const rowNum = index + 1;
      const item = usersData[index];
      const username = item.username ? String(item.username).trim() : '';
      const password = item.password ? String(item.password).trim() : '';

      if (!username || !password) {
        failedCount++;
        results.push({
          row: rowNum,
          username: username || `Dòng ${rowNum}`,
          status: 'failed',
          message: 'Thiếu tên đăng nhập hoặc mật khẩu.',
        });
        continue;
      }

      if (existingUsernamesSet.has(username.toLowerCase())) {
        failedCount++;
        results.push({
          row: rowNum,
          username,
          status: 'failed',
          message: 'Tên đăng nhập đã tồn tại trong hệ thống.',
        });
        continue;
      }

      try {
        validateAccount(item);
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = this.userRepository.create({
          username,
          password: hashedPassword,
          role: item.role === 'admin' ? 'admin' : 'staff',
          name: item.name ? String(item.name).trim() : 'Nhân viên CSKH',
          phone: item.phone ? String(item.phone).trim() : null,
          email: item.email ? String(item.email).trim() : null,
          dob: item.dob ? String(item.dob).trim() : null,
          address: item.address ? String(item.address).trim() : null,
          avatar: item.avatar ? String(item.avatar).trim() : null,
        });

        await this.userRepository.save(newUser);
        existingUsernamesSet.add(username.toLowerCase());
        successCount++;
        results.push({
          row: rowNum,
          username,
          status: 'success',
          message: 'Tạo tài khoản thành công.',
        });
      } catch (err: any) {
        failedCount++;
        results.push({
          row: rowNum,
          username,
          status: 'failed',
          message: err instanceof BadRequestException ? err.message : 'Không thể tạo tài khoản ở dòng này.',
        });
      }
    }

    return {
      total: usersData.length,
      successCount,
      failedCount,
      results,
    };
  }
}


