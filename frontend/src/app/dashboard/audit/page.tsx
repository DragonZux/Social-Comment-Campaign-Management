"use client";

import { useState, useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

export default function Audit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    try {
      const token = localStorage.getItem("campaign_token");
      if (!token) return;

      const res = await fetch(`${API_BASE}/api/dashboard/audit`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <p className="font-bold text-base text-gray-500">Đang tải nhật ký bảo mật...</p>
      </div>
    );
  }

  const getActionText = (a) => {
    if (a === "LOGIN") return "ĐĂNG NHẬP";
    if (a === "START") return "BẮT ĐẦU";
    if (a === "DELETE") return "XÓA BỎ";
    if (a === "CREATE") return "TẠO MỚI";
    if (a === "UPDATE") return "CẬP NHẬT";
    if (a === "PAUSE") return "TẠM DỪNG";
    if (a === "STOP") return "DỪNG CHẠY";
    return a;
  };

  const getResourceText = (r) => {
    if (r === "CAMPAIGN") return "Chiến dịch";
    if (r === "ACCOUNT") return "Tài khoản";
    if (r === "USER") return "Người dùng";
    return r;
  };

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 pb-8 shadow-none animate-slide-in">
      <div className="flex justify-between items-center mb-5 pl-1">
        <h3 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider">Nhật ký hoạt động bảo mật hệ thống</h3>
        <span className="text-[10px] border-2 border-[#10B981] text-[#10B981] rounded-md px-3 py-1 font-bold uppercase tracking-wider">
          Nhật ký bất biến
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-gray-400 uppercase tracking-widest font-extrabold">
              <th className="py-4 px-6">Thời gian</th>
              <th className="py-4 px-6">Người thực hiện</th>
              <th className="py-4 px-6">Hành động</th>
              <th className="py-4 px-6">Loại tài nguyên</th>
              <th className="py-4 px-6">Mã tài nguyên</th>
              <th className="py-4 px-6">Trạng thái cũ</th>
              <th className="py-4 px-6">Trạng thái mới</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 text-gray-900 font-semibold">
            {logs.length === 0 ? (
              <tr>
                <td colSpan="7" className="text-center py-10 text-gray-500 font-bold">Chưa có hoạt động hệ thống nào được ghi nhận.</td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-100/50 transition-colors duration-150">
                  <td className="py-4 px-6 font-mono text-[10px] text-gray-450">
                    {log.created_at ? new Date(log.created_at).toLocaleString() : "-"}
                  </td>
                  <td className="py-4 px-6 font-bold">@{log.username}</td>
                  <td className="py-4 px-6">
                    <span className={`px-2.5 py-1 rounded text-[9px] font-extrabold uppercase ${
                      log.action === "LOGIN" 
                        ? "bg-teal-50 text-teal-700 border border-teal-200" 
                        : log.action === "START"
                        ? "bg-blue-50 text-blue-700 border border-blue-200"
                        : log.action === "DELETE"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : "bg-gray-100 text-gray-600 border border-gray-250"
                    }`}>
                      {getActionText(log.action)}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-gray-550">{getResourceText(log.resource_type)}</td>
                  <td className="py-4 px-6 font-mono text-[10px] text-gray-400">{log.resource_id?.substring(18) || "-"}</td>
                  <td className="py-4 px-6 max-w-xs truncate text-gray-500" title={log.old_value}>{log.old_value || "-"}</td>
                  <td className="py-4 px-6 max-w-xs truncate text-gray-900" title={log.new_value}>{log.new_value || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
