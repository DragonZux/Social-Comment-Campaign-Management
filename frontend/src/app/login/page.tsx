"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

export default function Login() {
  const router = useRouter();
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("OPERATOR");
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem("campaign_token");
    if (token) {
      router.replace("/dashboard");
    }
  }, [router]);

  const showToast = (message, type = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setError("");
    try {
      if (isRegistering) {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, role })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Đăng ký tài khoản thất bại");
        }

        const data = await res.json();
        localStorage.setItem("campaign_token", data.access_token);
        localStorage.setItem("campaign_role", data.role);
        localStorage.setItem("campaign_user", data.username);
        showToast("Đăng ký tài khoản thành công!");
        router.push("/dashboard");
      } else {
        const formData = new FormData();
        formData.append("username", username);
        formData.append("password", password);

        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          body: formData
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Tên đăng nhập hoặc mật khẩu không chính xác");
        }

        const data = await res.json();
        localStorage.setItem("campaign_token", data.access_token);
        localStorage.setItem("campaign_role", data.role);
        localStorage.setItem("campaign_user", data.username);
        showToast("Đăng nhập thành công!");
        router.push("/dashboard");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6 relative overflow-hidden">

      {/* Background Graphic Posters Decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
        <div className="absolute h-[80vh] w-[80vh] rounded-full bg-gray-100/50 -top-[20%] -left-[20%]" />
        <div className="absolute h-[60vh] w-[60vh] bg-gray-100/30 rotate-45 -right-[10%] bottom-[10%]" />
      </div>

      {/* Toast notifications */}
      <div className="fixed top-6 right-6 z-50 space-y-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center px-4 py-3 rounded-lg border-2 text-sm font-bold tracking-wide ${t.type === "error"
                ? "bg-red-50 border-red-500 text-red-700"
                : "bg-emerald-50 border-emerald-500 text-emerald-700"
              }`}
          >
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Flat Content Card */}
      <div className="w-full max-w-md bg-gray-50 border border-gray-200 p-8 rounded-xl relative z-10 transition-all duration-200 hover:scale-[1.01]">

        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-[#3B82F6] rounded-lg flex items-center justify-center mb-4 transition-transform duration-200 hover:scale-110">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 leading-none">DragonZux Social</h1>
          <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mt-2">Hệ thống điều phối bình luận</p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-gray-600 text-xs font-bold uppercase tracking-wider mb-2">Tên đăng nhập</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Nhập tên đăng nhập..."
              className="w-full h-12 bg-gray-100 px-4 text-sm font-medium text-gray-900 border-2 border-transparent rounded-md focus:bg-white focus:border-[#3B82F6] focus:outline-none transition-all duration-200"
              required
            />
          </div>

          <div>
            <label className="block text-gray-600 text-xs font-bold uppercase tracking-wider mb-2">Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-12 bg-gray-100 px-4 text-sm font-medium text-gray-900 border-2 border-transparent rounded-md focus:bg-white focus:border-[#3B82F6] focus:outline-none transition-all duration-200"
              required
            />
          </div>

          {isRegistering && (
            <div>
              <label className="block text-gray-600 text-xs font-bold uppercase tracking-wider mb-2">Vai trò tài khoản</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full h-12 bg-gray-100 px-4 text-sm font-bold text-gray-600 border-2 border-transparent rounded-md focus:bg-white focus:border-[#3B82F6] focus:outline-none transition-all duration-200"
              >
                <option value="OPERATOR">ĐIỀU HÀNH (Tạo & chạy chiến dịch)</option>
                <option value="ADMIN">QUẢN TRỊ (Quản lý toàn bộ hệ thống)</option>
                <option value="VIEWER">NGƯỜI XEM (Chỉ xem báo cáo)</option>
              </select>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-xs font-bold rounded-md p-3 text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full h-12 bg-[#3B82F6] hover:bg-blue-600 text-white font-bold rounded-md text-sm transition-all duration-200 hover:scale-105 cursor-pointer"
          >
            {isRegistering ? "Đăng ký tài khoản" : "Đăng nhập hệ thống"}
          </button>
        </form>

        <div className="mt-6 text-center text-xs">
          <button
            onClick={() => {
              setIsRegistering(!isRegistering);
              setError("");
            }}
            className="text-gray-500 hover:text-[#3B82F6] font-bold transition duration-200"
          >
            {isRegistering ? "Đã có tài khoản? Đăng nhập ngay" : "Chưa có tài khoản? Tạo tài khoản mới"}
          </button>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-5 text-center">
          <p className="text-[10px] text-gray-400 font-extrabold uppercase tracking-widest mb-3">Đăng nhập nhanh phát triển</p>
          <div className="flex justify-center space-x-3">
            <button
              onClick={() => {
                setUsername("admin");
                setPassword("admin123");
                setIsRegistering(false);
              }}
              className="h-10 bg-white hover:bg-gray-50 border-2 border-gray-200 rounded-md px-4 text-xs font-bold text-gray-700 transition-all duration-150 cursor-pointer"
            >
              Quản trị (Admin)
            </button>
            <button
              onClick={() => {
                setUsername("operator");
                setPassword("operator123");
                setIsRegistering(false);
              }}
              className="h-10 bg-white hover:bg-gray-50 border-2 border-gray-200 rounded-md px-4 text-xs font-bold text-gray-700 transition-all duration-150 cursor-pointer"
            >
              Điều hành (Operator)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
