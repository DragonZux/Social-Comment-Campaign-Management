"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

interface UserInfo {
  id: string;
  username: string;
  created_at: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: "success" | "error" }>>([]);
  
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  useEffect(() => {
    fetchUserInfo();
  }, []);

  const fetchUserInfo = async () => {
    try {
      const token = sessionStorage.getItem("campaign_token");
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Không thể lấy thông tin user");
      const data = await res.json();
      setUserInfo(data);
    } catch (err: any) {
      showToast(err.message || "Lỗi khi tải thông tin", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!oldPassword || !newPassword || !confirmPassword) {
      showToast("Vui lòng điền đầy đủ các trường", "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast("Mật khẩu mới không khớp", "error");
      return;
    }

    if (newPassword.length < 6) {
      showToast("Mật khẩu mới phải có ít nhất 6 ký tự", "error");
      return;
    }

    setChangingPassword(true);
    try {
      const token = sessionStorage.getItem("campaign_token");
      const res = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Không thể đổi mật khẩu");
      }

      showToast("✅ Đổi mật khẩu thành công!");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      showToast(err.message || "Lỗi đổi mật khẩu", "error");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("campaign_token");
    sessionStorage.removeItem("campaign_user");
    router.push("/login");
    showToast("✅ Đăng xuất thành công");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      {/* Toasts */}
      <div className="fixed top-6 right-6 z-50 space-y-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center px-4 py-3 rounded-lg border-2 text-sm font-bold tracking-wide ${
              t.type === "error"
                ? "bg-red-50 border-red-500 text-red-700"
                : "bg-emerald-50 border-emerald-500 text-emerald-700"
            }`}
          >
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">⚙️ Cài Đặt Tài Khoản</h1>

        {/* User Profile Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">👤 Thông Tin Tài Khoản</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
              <input
                type="text"
                value={userInfo?.username || ""}
                readOnly
                className="w-full px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-700 font-medium"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">User ID</label>
              <input
                type="text"
                value={userInfo?.id || ""}
                readOnly
                className="w-full px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-600 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Ngày Tạo</label>
              <input
                type="text"
                value={userInfo?.created_at ? new Date(userInfo.created_at).toLocaleDateString("vi-VN") : ""}
                readOnly
                className="w-full px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-700"
              />
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">🔐 Đổi Mật Khẩu</h2>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Mật Khẩu Cũ</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={changingPassword}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Mật Khẩu Mới</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={changingPassword}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Xác Nhận Mật Khẩu Mới</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Nhập lại mật khẩu mới"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={changingPassword}
              />
            </div>

            <button
              type="submit"
              disabled={changingPassword}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              {changingPassword ? "Đang xử lý..." : "🔄 Đổi Mật Khẩu"}
            </button>
          </form>
        </div>

        {/* Logout Card */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">🚪 Đăng Xuất</h2>
          <button
            onClick={handleLogout}
            className="w-full bg-red-600 text-white py-3 px-4 rounded-lg font-bold hover:bg-red-700 transition-all"
          >
            ✈️ Đăng Xuất Ngay
          </button>
        </div>
      </div>
    </div>
  );
}
