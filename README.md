# DOMINO — Landing Page Tủ Bếp INOX Cánh Kính + Admin CMS + Facebook CAPI

Hệ thống full-stack chuyển đổi từ giao diện tĩnh `Landing_Page_Tu_Bep_INOX_v2 (1).html` thành mã nguồn chuẩn Production gồm:
- **Landing Page tối ưu hiệu năng**: Tự động tách 25 ảnh base64 (~1MB) thành file tĩnh cacheable (`/assets/images/`).
- **Backend Node.js (Express) + SQLite (`node:sqlite`, WAL mode)**: Không cần cài đặt DB phức tạp, bảo mật truy vấn tham số hóa 100%, hỗ trợ sao lưu 1-click.
- **Form tư vấn chuẩn quốc tế & Chống trùng lặp SĐT**:
  - Hỗ trợ chọn mã vùng Việt Nam (`+84`) và 33 quốc gia/vùng lãnh thổ (`+1`, `+81`, `+82`, `+61`, `+44`, `+33`, `+49`, `+65`, `+886`...).
  - Kiểm tra chặt chẽ bằng `libphonenumber-js/max`: báo rõ lỗi **thiếu số**, **thừa số** hoặc **sai đầu số** theo đúng quy chuẩn từng quốc gia.
  - Chuẩn hóa về định dạng `E.164` (`+84967862545`) và kiểm tra **trùng số điện thoại** theo thời gian thực + ràng buộc `UNIQUE` ở tầng database.
- **Admin CMS (`/admin`)**:
  - **Quản lý Dataform & Leads**: Tìm kiếm, lọc theo trạng thái/nguồn Facebook, ghi chú tư vấn, xuất file Excel (CSV UTF-8 BOM chống CSV Injection), gửi sự kiện chốt đơn (`Lead` / `Schedule` / `Purchase`) ngược về Meta CAPI.
  - **Tracking chuyển đổi Facebook (Pixel + Conversions API)**: Tích hợp song song Browser Pixel & Server-Side CAPI (Graph API v21.0) với cơ chế chống trùng lặp `event_id`, băm SHA-256 dữ liệu khách hàng, bắt tự động `fbclid`, `_fbp`, `_fbc`, `UTM`, có công cụ test gửi sự kiện trực tiếp tới Meta Events Manager.
  - **Live Preview CMS**: Xem trước trực tiếp trên Desktop / Tablet / Mobile; bấm trực tiếp vào **Text**, **Hình ảnh**, **Link / Nút bấm**, **Bản đồ Google Maps** để chỉnh sửa, tải ảnh mới, chèn link, xuất bản tức thì và khôi phục lịch sử phiên bản.
- **Bảo mật Website & Database**:
  - `Helmet` + Content Security Policy (CSP), chống Clickjacking & MIME sniffing.
  - `express-rate-limit` chống spam form & brute-force đăng nhập + tự động khóa tài khoản 15 phút sau 5 lần sai mật khẩu.
  - Phiên quản trị dùng JWT lưu trong cookie `HttpOnly + SameSite=Strict` kết hợp bảo vệ `CSRF` (`X-CSRF-Token` + `X-Requested-With`).
  - Lọc XSS cho nội dung CMS bằng `sanitize-html` và xác thực Magic Bytes nhị phân khi tải ảnh lên (chặn giả mạo file SVG/JS).
  - Bảng `audit_logs` ghi lại toàn bộ lịch sử đăng nhập và thao tác quản trị.

## Cài đặt & Chạy dự án

```bash
# 1. Cài đặt thư viện
npm install

# 2. Tạo file cấu hình môi trường từ mẫu (sửa JWT_SECRET & ADMIN_PASSWORD khi lên production)
copy .env.example .env

# 3. Khởi chạy server
npm start
```

Sau khi chạy:
- **Landing Page**: `http://localhost:3000/`
- **Admin CMS**: `http://localhost:3000/admin`
- **Tài khoản mặc định** (khi tạo DB lần đầu, lấy từ `.env` hoặc mặc định):
  - Username: `admin`
  - Password: `Domino@2026!Secure`
  - *(Khuyến nghị đổi mật khẩu ngay trong mục **Bảo mật & Log** sau khi đăng nhập lần đầu).*

## Cấu trúc thư mục

```text
├── src/
│   ├── server.js               # Entry point Express
│   ├── config/env.js           # Cấu hình môi trường & quản lý secret an toàn
│   ├── db/database.js          # SQLite schema (WAL, foreign keys, indexes, seed)
│   ├── middleware/
│   │   ├── security.js         # Helmet CSP, rate-limiters, CSRF, XSS sanitizer
│   │   └── auth.js             # JWT HttpOnly cookie authentication
│   ├── services/
│   │   ├── phone.js            # Validate SĐT quốc tế & chuẩn hóa E.164
│   │   ├── facebookCapi.js     # Meta Conversions API v21.0 + SHA-256 hashing
│   │   ├── cmsRenderer.js      # Render Landing Page + inject CMS overrides & FB Pixel
│   │   └── upload.js           # Upload ảnh + kiểm tra Magic Bytes
│   └── routes/
│       ├── public.js           # Landing Page, Lead API, Check Phone API, Track API
│       ├── auth.js             # Login, Logout, Session, Change Password
│       └── admin.js            # Leads, FB CAPI, CMS Live Preview, Media, Audit Logs
├── views/landing.html          # Template Landing Page gắn data-cms-key
├── public/
│   ├── assets/images/          # 25 ảnh gốc đã tách từ HTML tĩnh
│   ├── uploads/                # Ảnh tải lên từ Admin CMS
│   ├── js/landing.js           # Script Landing Page, Phone check, FB Pixel dedup
│   ├── js/cms-bridge.js        # Cầu nối Live Preview (chỉ tải khi admin đăng nhập)
│   └── admin/                  # Giao diện Admin CMS
└── scripts/
    ├── extract-assets.js       # Tách ảnh base64 từ HTML tĩnh
    └── build-template.js       # Sinh views/landing.html gắn thẻ CMS
```

