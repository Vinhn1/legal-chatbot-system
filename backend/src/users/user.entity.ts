import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  // Tên đăng nhập (duy nhất, không trùng lặp)
  @Column({ unique: true })
  username: string;

  // Mật khẩu (sẽ được lưu dưới dạng băm/hash bằng bcrypt)
  @Column()
  password: string;

  // Tăng phiên bản để vô hiệu hóa mọi JWT cũ sau khi đổi mật khẩu hoặc đăng xuất.
  @Column({ name: 'token_version', type: 'integer', default: 0 })
  tokenVersion: number;

  // Vai trò của người dùng.
  @Column({ default: 'staff' })
  role: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  dob: string | null;

  @Column({ type: 'varchar', nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  avatar: string | null;

  // Trạng thái kích hoạt xác thực hai lớp (2FA)
  @Column({ name: 'two_fa_enabled', type: 'boolean', default: false })
  twoFaEnabled: boolean;

  // Mã OTP phục vụ xác thực 2FA / đổi số điện thoại nhận qua email
  @Column({ name: 'otp_code', type: 'varchar', nullable: true })
  otpCode: string | null;

  // Thời gian tạo mã OTP để tính hết hạn (mặc định hiệu lực trong 3 phút)
  @Column({ name: 'otp_created_at', type: 'timestamp with time zone', nullable: true })
  otpCreatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

