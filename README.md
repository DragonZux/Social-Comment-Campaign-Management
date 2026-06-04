# Hệ thống Quản lý Chiến dịch Social Comment (X & Threads)

Hệ thống quản lý chiến dịch comment tự động và bất đồng bộ, tối ưu hiệu suất với bộ điều phối chiến dịch (Campaign Orchestrator), hệ thống hàng đợi Redis Queue, bộ xử lý Worker chạy nền với cơ chế tự động giới hạn rate limit và tự động retry (exponential backoff).

---

## 1. Công nghệ sử dụng (Tech Stack)

- **Backend**: FastAPI (Python 3.11, Async/Await) + Motor (Async MongoDB Driver).
- **Frontend**: Next.js 16 (React 19) + Tailwind CSS v4.
- **Database**: MongoDB (chạy trong Docker, kết nối bằng **MongoCompass**).
- **Queue/Cache**: Redis 7 (chạy trong Docker).
- **Containerization**: Docker & Docker Compose.

---

## 2. Hướng dẫn thiết lập và khởi chạy từng bước

### Bước 1: Chuẩn bị môi trường
Hãy đảm bảo máy tính của bạn đã cài đặt:
1. **Docker Desktop** (đã bao gồm Docker Compose).
2. **MongoDB Compass** (phần mềm GUI để xem cơ sở dữ liệu trực quan).

### Bước 2: Khởi chạy các container bằng Docker Compose
Mở terminal tại thư mục gốc của dự án (`f:\Social Comment Campaign Management`) và chạy lệnh sau để build và khởi chạy tất cả các dịch vụ:

```bash
docker compose up --build
```

Lệnh này sẽ tự động tải các image cần thiết, thiết lập mạng nội bộ, cài đặt thư viện và khởi chạy:
- **MongoDB** tại cổng `27099` (để tránh đụng độ với MongoDB local của bạn)
- **Redis** tại cổng `6399` (để tránh đụng độ với Redis local của bạn)
- **FastAPI API Server** tại cổng `8099` (Swagger UI tại `http://localhost:8099/docs`)
- **Python Queue Worker** (chạy nền)
- **Next.js Frontend App** tại cổng `3099` (`http://localhost:3099`)

---

## 3. Tài khoản đăng nhập mặc định (Development Credentials)

Khi hệ thống khởi chạy lần đầu, dữ liệu chạy thử sẽ tự động được gieo (auto-seed) vào MongoDB:
- **Tài khoản Admin** (Quyền quản trị toàn hệ thống):
  - **Username**: `admin`
  - **Password**: `admin123`
- **Tài khoản Operator** (Quyền quản lý & chạy chiến dịch):
  - **Username**: `operator`
  - **Password**: `operator123`

---

## 4. Quy trình vận hành chiến dịch comment (Workflow)

Truy cập giao diện Next.js tại: [http://localhost:3099](http://localhost:3099).

### Bước 1: Kết nối tài khoản mạng xã hội (Social Accounts)
1. Đăng nhập bằng tài khoản `admin` hoặc `operator`.
2. Chọn menu **Social Accounts** -> click **Add Social Account**.
3. Nhập tên tài khoản (ví dụ: `crypto_news`), nền tảng (`X` hoặc `Threads`), giới hạn comment theo giờ (Hourly Limit) và theo ngày (Daily Limit).
4. *Hệ thống đã gieo sẵn 3 tài khoản mẫu (`tech_guru`, `crypto_news`, `lifestyle_vlog`) ở trạng thái `ACTIVE` để bạn test ngay.*

### Bước 2: Tạo chiến dịch (Campaign)
1. Chọn menu **Campaigns** -> click **Create Campaign**.
2. Nhập tên chiến dịch (ví dụ: `Chiến dịch Marketing Hè`), chọn Platform trùng với Platform của account bạn muốn dùng (ví dụ: `X`), thêm mô tả và bấm Save.
3. Khi mới tạo, Campaign ở trạng thái **DRAFT**.

### Bước 3: Import Target URLs & Comment Templates
1. Click vào chiến dịch vừa tạo trong danh sách để mở bảng chi tiết.
2. Tại cột **Target URLs**, nhập danh sách link bài viết cần comment (mỗi dòng một link URL). Click **Import URLs**.
3. Tại cột **Comment Templates**, nhập danh sách nội dung comment (mỗi dòng một câu comment). Click **Import Comment Templates**.
4. Trạng thái chiến dịch chuyển sang **READY**.

### Bước 4: Khởi chạy và theo dõi (Trigger & Monitor)
1. Click nút **▶️ Start** ở thanh điều khiển chiến dịch.
2. **Bộ điều phối chiến dịch** sẽ tự động thực hiện:
   - Quét tất cả URLs đang ở trạng thái `PENDING`.
   - Phân phối xoay vòng/ngẫu nhiên các account active và comment templates tương ứng.
   - Tạo ra các công việc cụ thể (**Jobs**) với trạng thái `QUEUED` và đẩy ID công việc vào hàng đợi **Redis**.
   - Cập nhật trạng thái chiến dịch sang **RUNNING**.
3. **Queue Worker** phát hiện có job mới trong Redis sẽ kéo job ra xử lý:
   - Chuyển trạng thái Job sang `RUNNING` và kiểm tra rate limit của tài khoản.
   - Gọi **Social Mock Driver** để gửi comment (giả lập delay ngẫu nhiên từ 1.5s - 3s và tỉ lệ lỗi kết nối ngẫu nhiên 10%).
   - Nếu thành công: Trạng thái Job & URL chuyển sang `SUCCESS`, cộng 1 vào usage limit của account.
   - Nếu lỗi: Kích hoạt cơ chế **Retry** tương ứng (xem chi tiết mục 5).

---

## 5. Cơ chế xử lý Hàng đợi & Retry (Retry Strategy)

Để đảm bảo độ tin cậy và chống bị block tài khoản:
1. **Giới hạn Rate Limit**:
   - Trước khi gửi comment, Worker kiểm tra hạn mức sử dụng theo giờ và ngày của account.
   - Nếu vượt hạn mức, account tự động chuyển sang trạng thái `LIMITED`, job bị trì hoãn và xếp lịch chạy lại sau.
2. **Cơ chế Retry (Exponential Backoff)**:
   - Mỗi Job được phép lỗi tối đa 3 lần.
   - Khoảng thời gian giãn cách giữa các lần chạy lại tăng dần:
     - Lần lỗi 1 -> chạy lại sau **1 phút**
     - Lần lỗi 2 -> chạy lại sau **5 phút**
     - Lần lỗi 3 -> chạy lại sau **15 phút**
   - Hết 3 lần lỗi, Job chuyển sang trạng thái `FAILED` và trừ 5 điểm Health Score của tài khoản đó.
3. **Tự động Hoàn thành**:
   - Khi tất cả Job của chiến dịch được xử lý xong (không còn job nào hàng đợi), chiến dịch tự động chuyển sang **COMPLETED**.

---

## 6. Kiểm tra dữ liệu trực quan bằng MongoCompass

1. Mở **MongoDB Compass** trên máy tính của bạn.
2. Kết nối tới URI mặc định: `mongodb://localhost:27099` (sử dụng port `27099` đã ánh xạ của container)
3. Bạn sẽ thấy cơ sở dữ liệu `social_campaign_db` chứa các collections sau:
   - `users`: Tài khoản đăng nhập hệ thống.
   - `accounts`: Danh sách nick X/Threads, health score và usage counts.
   - `campaigns`: Các chiến dịch.
   - `target_urls`: Danh sách link cần comment.
   - `comment_templates`: Mẫu nội dung comment.
   - `jobs`: Lịch sử, trạng thái chi tiết của từng lượt comment.
   - `audit_logs`: Nhật ký thao tác của người dùng (Login, Start, Delete...).