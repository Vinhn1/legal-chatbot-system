import { Injectable, OnModuleInit, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { User } from './user.entity';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';

/** Kiểm tra các trường được nạp từ biểu mẫu hoặc CSV trước khi ghi dữ liệu. */
function validateAccount(dto: any): void {
  if (!dto || !/^[a-zA-Z][a-zA-Z0-9_.]{2,39}$/.test(String(dto.username || ''))) throw new BadRequestException('Tên đăng nhập không hợp lệ.');
  if (typeof dto.name !== 'string' || !dto.name.trim() || dto.name.length > 120 || /[<>\x00-\x1f]/.test(dto.name)) throw new BadRequestException('Họ tên không hợp lệ.');
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
  ) {}

  // Chỉ tạo tài khoản quản trị khi người vận hành cung cấp mật khẩu khởi tạo.
  async onModuleInit() {
    const password = process.env.ADMIN_SEED_PASSWORD;
    if (!password) return;
    const existing = await this.userRepository.findOneBy({ username: 'admin' });
    if (existing) return;
    const admin = this.userRepository.create({
      username: 'admin',
      password: await bcrypt.hash(password, 10),
      role: 'admin',
      name: 'Quản trị viên',
    });
    await this.userRepository.save(admin);
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
    if (profileData.name !== undefined && (typeof profileData.name !== 'string' || !profileData.name.trim() || profileData.name.length > 120 || /[<>\x00-\x1f]/.test(profileData.name))) {
      throw new BadRequestException('Họ tên không hợp lệ.');
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
    if (!currentPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
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

  // 6. Gửi mã OTP xác thực 2FA qua Email
  async request2FaOtp(id: number): Promise<{ success: boolean; message: string }> {
    const user = await this.getProfile(id);
    if (!user.email) {
      throw new BadRequestException('Tài khoản quản trị chưa được cấu hình Email.');
    }

    // Sinh mã OTP 6 số
    const otp = randomInt(100000, 1000000).toString();
    user.otpCode = otp;
    user.otpCreatedAt = new Date();
    await this.userRepository.save(user);

    // Gửi email OTP
    const sent = await this.emailService.sendOtpEmail(user.email, otp);
    if (!sent) {
      throw new BadRequestException('Không thể gửi email mã OTP. Vui lòng thử lại sau.');
    }

    return {
      success: true,
      message: 'Mã xác thực OTP đã được gửi về email quản trị thành công.',
    };
  }

  // 7. Bật / Tắt 2FA bằng mã OTP xác thực
  async toggle2Fa(id: number, otpCode: string): Promise<{ success: boolean; twoFaEnabled: boolean; message: string }> {
    const user = await this.getProfile(id);
    if (!user.otpCode || !user.otpCreatedAt) {
      throw new BadRequestException('Chưa yêu cầu gửi mã OTP xác thực.');
    }

    // Kiểm tra thời hạn OTP (3 phút)
    const elapsed = Date.now() - new Date(user.otpCreatedAt).getTime();
    if (elapsed > 3 * 60 * 1000) {
      throw new BadRequestException('Mã OTP đã hết hạn. Vui lòng gửi lại mã mới.');
    }

    if (user.otpCode !== otpCode) {
      throw new BadRequestException('Mã OTP không chính xác.');
    }

    // Thay đổi trạng thái 2FA
    user.twoFaEnabled = !user.twoFaEnabled;
    user.otpCode = null;
    user.otpCreatedAt = null;
    await this.userRepository.save(user);

    return {
      success: true,
      twoFaEnabled: user.twoFaEnabled,
      message: user.twoFaEnabled ? 'Đã kích hoạt xác thực hai lớp (2FA) thành công.' : 'Đã hủy kích hoạt xác thực hai lớp (2FA) thành công.',
    };
  }

  // 8. Gửi OTP yêu cầu đổi số điện thoại qua Email admin
  async requestPhoneChangeOtp(id: number, newPhone: string): Promise<{ success: boolean; message: string }> {
    if (!newPhone || !newPhone.match(/^0\d{9}$/)) {
      throw new BadRequestException('Số điện thoại không hợp lệ. Phải gồm 10 chữ số bắt đầu bằng số 0.');
    }

    const user = await this.getProfile(id);
    if (!user.email) {
      throw new BadRequestException('Tài khoản quản trị chưa được cấu hình Email.');
    }

    const otp = randomInt(100000, 1000000).toString();
    user.otpCode = otp;
    user.otpCreatedAt = new Date();
    await this.userRepository.save(user);

    const sent = await this.emailService.sendOtpEmail(user.email, otp);
    if (!sent) {
      throw new BadRequestException('Không thể gửi email mã OTP. Vui lòng thử lại sau.');
    }

    return {
      success: true,
      message: 'Mã xác thực đổi số điện thoại đã được gửi về email quản trị.',
    };
  }

  // 9. Xác nhận đổi số điện thoại bằng mã OTP
  async verifyPhoneChange(id: number, newPhone: string, otpCode: string): Promise<{ success: boolean; phone: string; message: string }> {
    if (!newPhone || !newPhone.match(/^0\d{9}$/)) {
      throw new BadRequestException('Số điện thoại không hợp lệ. Phải gồm 10 chữ số bắt đầu bằng số 0.');
    }

    const user = await this.getProfile(id);
    if (!user.otpCode || !user.otpCreatedAt) {
      throw new BadRequestException('Chưa yêu cầu gửi mã OTP xác thực.');
    }

    const elapsed = Date.now() - new Date(user.otpCreatedAt).getTime();
    if (elapsed > 3 * 60 * 1000) {
      throw new BadRequestException('Mã OTP đã hết hạn. Vui lòng gửi lại mã mới.');
    }

    if (user.otpCode !== otpCode) {
      throw new BadRequestException('Mã OTP không chính xác.');
    }

    user.phone = newPhone;
    user.otpCode = null;
    user.otpCreatedAt = null;
    await this.userRepository.save(user);

    return {
      success: true,
      phone: user.phone,
      message: 'Thay đổi số điện thoại liên kết thành công.',
    };
  }

  // 10. Xác thực OTP đăng nhập 2FA
  async verify2FaOtp(username: string, otpCode: string): Promise<User> {
    const user = await this.findByUsername(username);
    if (!user) {
      throw new NotFoundException('Tài khoản không tồn tại.');
    }

    if (!user.otpCode || !user.otpCreatedAt) {
      throw new BadRequestException('Chưa yêu cầu gửi mã OTP xác thực.');
    }

    const elapsed = Date.now() - new Date(user.otpCreatedAt).getTime();
    if (elapsed > 3 * 60 * 1000) {
      throw new BadRequestException('Mã OTP đã hết hạn. Vui lòng gửi lại mã mới.');
    }

    if (user.otpCode !== otpCode) {
      throw new BadRequestException('Mã OTP không chính xác.');
    }

    user.otpCode = null;
    user.otpCreatedAt = null;
    return await this.userRepository.save(user);
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

    if (dto.password) {
      user.password = await bcrypt.hash(dto.password, 10);
    }
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.dob !== undefined) user.dob = dto.dob;
    if (dto.address !== undefined) user.address = dto.address;
    if (dto.role !== undefined) user.role = dto.role === 'admin' ? 'admin' : 'staff';

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


