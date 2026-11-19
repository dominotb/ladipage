# DOMINO — Landing Page Tủ Bếp INOX Cánh Kính + Admin CMS (Chuẩn Vercel + Supabase)

Hệ thống full-stack chuyển đổi từ giao diện tĩnh `Landing_Page_Tu_Bep_INOX_v2 (1).html` sang kiến trúc chuẩn Production **Vercel Serverless + Supabase PostgreSQL & Storage**:

- **Vercel Serverless Ready**: Cấu hình chuẩn `api/index.js` + `vercel.json` + Node `24.x`, tự động bật `trust proxy`, không cần `APP_URL` (tự nhận diện domain theo request).
- **Supabase PostgreSQL + Storage**:
  - Lưu trữ vĩnh viễn Leads, Cấu hình Facebook Pixel/CAPI, Nội dung Live Preview CMS, Lịch sử phiên bản, Audit Logs trên **Supabase PostgreSQL**.
  - Lưu trữ ảnh tải lên từ CMS Live Preview trên **Supabase Storage** (`domino-media` bucket, CDN nhanh).
  - **Row Level Security (RLS)** bật trên toàn bộ bảng — chặn hoàn toàn truy cập trực tiếp từ bên ngoài, chỉ cho phép Backend sử dụng `SUPABASE_SERVICE_ROLE_KEY`.
  - Tự động fallback sang SQLite khi chạy offline không có `SUPABASE_URL`.
- **Form tư vấn chuẩn quốc tế & Chống trùng lặp SĐT**:
  - Chọn mã vùng 33 quốc gia (`+84`, `+1`, `+81`, `+82`, `+61`, `+44`, `+33`, `+49`, `+65`, `+886`...).
  - Kiểm tra chặt chẽ bằng `libphonenumber-js/max`: báo rõ **thiếu số**, **thừa số**, hoặc **sai đầu số**; chống trùng theo chuẩn `E.164` (`UNIQUE` trong PostgreSQL).
- **Admin CMS (`/admin`)**: Quản lý Dataform/Leads, Xuất CSV UTF-8 BOM, Tracking Facebook Pixel + Conversions API (CAPI) chống trùng `event_id`, **Live Preview CMS** sửa trực tiếp Text / Ảnh / Link / Google Maps.

---

## 1. Thiết lập Supabase (Database + Storage)

1. Tạo project mới tại [supabase.com](https://supabase.com).
2. Chạy file migration SQL trong `supabase/migrations/20261119000001_init_domino_schema.sql` bằng một trong hai cách:
   - **Cách 1 (Supabase Dashboard)**: Mở **SQL Editor** → dán toàn bộ nội dung file `supabase/migrations/20261119000001_init_domino_schema.sql` → bấm **Run**.
   - **Cách 2 (Supabase CLI)**:
     ```bash
     supabase link --project-ref <project-ref>
     supabase db push
     ```
3. Vào **Supabase Dashboard → Project Settings → API**, lấy:
   - `Project URL` → dùng cho `SUPABASE_URL`
   - `service_role` secret key → dùng cho `SUPABASE_SERVICE_ROLE_KEY` *(chỉ đặt ở server/Vercel, tuyệt đối không lộ ra client)*.

---

## 2. Triển khai lên Vercel

1. Push code lên GitHub và import repo vào **Vercel**.
2. Vào **Vercel Project → Settings → Environment Variables**, thêm các biến sau:

| Biến môi trường | Bắt buộc | Mô tả |
|---|---|---|
| `SUPABASE_URL` | Có | Project URL từ Supabase (`https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Có | Service Role Key từ Supabase |
| `SUPABASE_STORAGE_BUCKET` | Tùy chọn | Mặc định `domino-media` |
| `JWT_SECRET` | Có | Chuỗi bí mật ngẫu nhiên ≥ 32 ký tự |
| `COOKIE_SECRET` | Có | Chuỗi bí mật ngẫu nhiên ≥ 32 ký tự |
| `ADMIN_USERNAME` | Có | Tên đăng nhập Admin mặc định (vd: `admin`) |
| `ADMIN_PASSWORD` | Có | Mật khẩu Admin mặc định (đổi lại trong mục Bảo mật sau khi đăng nhập) |

3. Bấm **Redeploy**. Kiểm tra nhanh trạng thái driver tại `https://<domain-cua-ban>/api/health`:
   - Nếu trả về `{ "ok": true, "driver": "supabase", "vercel": true }` là đã kết nối Supabase thành công!

---

## 3. Chạy Local

```bash
npm install
copy .env.example .env
npm start
```
- **Landing Page**: `http://localhost:3000/`
- **Admin CMS**: `http://localhost:3000/admin`
- **Kiểm tra tự động**: `npm test`
