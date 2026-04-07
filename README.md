# QueryWeaver - MSSQL Extension Edition 🚀

Đây là phiên bản mở rộng và tùy biến của dự án mã nguồn mở **QueryWeaver** (một hệ thống Graph-based Text-to-SQL). 
🔗 **Nguồn dự án gốc:** https://github.com/FalkorDB/QueryWeaver

## 🌟 Những cải tiến trong phiên bản này (My Contributions)
Dự án gốc chỉ hỗ trợ MySQL và PostgreSQL. Trong bản Fork này, mình đã nghiên cứu và tích hợp thành công **Microsoft SQL Server (MSSQL)** vào hệ thống, giải quyết triệt để các rào cản về cú pháp T-SQL và hạ tầng mạng:

* **Tích hợp Driver MSSQL:** Khởi tạo `MSSQLLoader` sử dụng `pymssql`, trích xuất toàn bộ Schema (Tables, Columns, Foreign Keys) từ SQL Server chuẩn xác.
* **Xử lý xung đột T-SQL:** Tái cấu trúc logic truy vấn mẫu (Sample Query) bằng Subquery và `ORDER BY NEWID()`, vượt qua giới hạn cú pháp `DISTINCT` khắt khe của SQL Server.
* **Xử lý Async Logic:** Fix triệt để lỗi bất đồng bộ trong quá trình Generator của Python khi duyệt và nhúng (Embed) sơ đồ dữ liệu vào GraphDB.
* **Thiết lập Mạng lưới Docker-to-Host:** Cấu hình mở cổng TCP/IP 1433 và định tuyến `host.docker.internal` để Container có thể chui ra ngoài giao tiếp với SQL Server nội bộ (On-Premise).

## ⚖️ Giấy phép (License)
Dự án này tuân thủ nghiêm ngặt giấy phép **GNU AGPLv3** từ tác giả gốc. Mã nguồn được mở hoàn toàn, đảm bảo tính minh bạch và chia sẻ cho cộng đồng. Vui lòng xem chi tiết trong file `LICENSE`.