"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export default function DashboardLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [token, setToken] = useState(null);
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = sessionStorage.getItem("campaign_token");
    const storedUser = sessionStorage.getItem("campaign_user");

    if (!storedToken) {
      router.replace("/login");
    } else {
      setToken(storedToken);
      setUsername(storedUser || "operator");
      setLoading(false);
    }
  }, [router]);

  const handleLogout = () => {
    sessionStorage.removeItem("campaign_token");
    sessionStorage.removeItem("campaign_user");
    router.replace("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 bg-[#3B82F6] rounded-md animate-bounce" />
          <p className="font-bold text-lg text-gray-900 tracking-tight">Đang thiết lập kết nối an toàn...</p>
        </div>
      </div>
    );
  }

  const menuItems = [
    { id: "metrics", label: "Bảng điều khiển", href: "/dashboard", icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" },
    { id: "campaigns", label: "Quản lý chiến dịch", href: "/dashboard/campaigns", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
    { id: "accounts", label: "Tài khoản mạng xã hội", href: "/dashboard/accounts", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
    { id: "jobs", label: "Hàng chờ công việc", href: "/dashboard/jobs", icon: "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" },
  ];

  const getHeaderTitle = () => {
    switch (pathname) {
      case "/dashboard": return "BẢNG ĐIỀU KHIỂN HỆ THỐNG";
      case "/dashboard/campaigns": return "QUẢN LÝ CHIẾN DỊCH BÌNH LUẬN";
      case "/dashboard/accounts": return "QUẢN LÝ TÀI KHOẢN MẠNG XÃ HỘI";
      case "/dashboard/jobs": return "HÀNG CHỜ CÔNG VIỆC HỆ THỐNG";
      default: return pathname.split("/").pop().toUpperCase();
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#FAFBFD] text-slate-800 relative overflow-hidden">
      
      {/* Background Graphic Posters Decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
        <div className="absolute h-[100vh] w-[100vh] rounded-full bg-blue-50/40 -top-[30%] -left-[20%] blur-3xl" />
        <div className="absolute h-[80vh] w-[80vh] bg-indigo-50/30 rotate-45 -right-[10%] bottom-[10%] blur-3xl" />
      </div>

      {/* Flat Sidebar Shell */}
      <aside className="w-full md:w-72 bg-white/70 backdrop-blur-md border border-slate-200/60 p-6 flex flex-col justify-between shrink-0 md:h-[calc(100vh-32px)] m-4 rounded-2xl shadow-sm shadow-slate-100/50">
        <div className="space-y-8">
          
          {/* Logo */}
          <div className="flex items-center space-x-3 pl-1">
            <div className="w-10 h-10 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>
            <div>
              <h2 className="font-extrabold text-slate-900 text-base leading-none tracking-tight">DragonZux</h2>
              <span className="text-[9px] text-blue-600 font-extrabold uppercase tracking-wider mt-1.5 block">
                WORKSPACE RIÊNG
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            {menuItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold tracking-wide transition-all duration-200 cursor-pointer ${
                    isActive 
                      ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/10" 
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  <svg className={`w-5 h-5 shrink-0 ${isActive ? "text-white" : "text-slate-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                  </svg>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Footer profile & logout */}
        <div className="border-t border-slate-100 pt-5 flex flex-col space-y-4">
          <div className="flex items-center space-x-3 px-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center font-extrabold text-slate-700 uppercase text-xs border border-slate-200/50">
              {username ? username.substring(0, 2) : "OP"}
            </div>
            <div className="truncate">
              <p className="text-slate-900 text-xs font-bold truncate">@{username}</p>
              <p className="text-[10px] text-slate-400 font-extrabold truncate uppercase tracking-wider mt-0.5">
                Tài khoản hệ thống
              </p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center space-x-2 bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 py-3 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer border border-transparent hover:border-red-100"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Đăng xuất hệ thống</span>
          </button>
        </div>
      </aside>

      {/* Main Layout Area */}
      <main className="flex-1 p-4 md:p-6 overflow-y-auto flex flex-col h-screen">
        {/* Flat Header block */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/70 backdrop-blur-md border border-slate-200/60 p-6 rounded-2xl mb-6 shadow-sm shadow-slate-100/50">
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 tracking-tight uppercase">
              {getHeaderTitle()}
            </h1>
            <p className="text-slate-450 text-[11px] font-semibold mt-1">Điều phối chiến dịch bình luận tự động</p>
          </div>
          <div className="flex items-center space-x-2 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-4 py-1.5 font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-glow" />
            <span>HỆ THỐNG TRỰC TUYẾN</span>
          </div>
        </header>

        {/* Dynamic page contents wrapper */}
        <div className="flex-1 min-h-0">
          {children}
        </div>
      </main>

    </div>
  );
}
