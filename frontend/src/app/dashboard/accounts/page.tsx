"use client";

import { useState, useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

const detectAccountPlatform = (value) => {
  const text = value.toLowerCase();
  if (text.includes("threads.net") || text.includes("sessionid=")) return "Threads";
  if (text.includes("x.com") || text.includes("twitter.com") || text.includes("auth_token=") || text.includes("ct0=")) return "X";
  return null;
};

const extractAccountUsername = (value) => {
  const raw = value.trim();
  const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com|threads\.net)\/@?([A-Za-z0-9_\\.]+)/i);
  if (urlMatch?.[1]) {
    return urlMatch[1].replace(/[/?#].*$/, "").replace(/\.$/, "");
  }

  const atMatch = raw.match(/@([A-Za-z0-9_\\.]+)/);
  if (atMatch?.[1]) return atMatch[1].replace(/\.$/, "");

  const firstToken = raw.split(/[\s,;|]+/).find((part) => /^[A-Za-z0-9_\\.]{2,}$/.test(part));
  return firstToken ? firstToken.replace(/^@/, "").replace(/\.$/, "") : "";
};

const extractAccountCookie = (value) => {
  const cookieStart = value.search(/(?:auth_token|ct0|sessionid|csrftoken|ds_user_id)=/i);
  return cookieStart >= 0 ? value.slice(cookieStart).trim() : "";
};

const parseBulkAccounts = (value) => {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const platform = detectAccountPlatform(line);
      const username = extractAccountUsername(line);
      const cookie = extractAccountCookie(line);
      const errors = [];

      if (!platform) errors.push("Không nhận diện được nền tảng");
      if (!username) errors.push("Không tìm thấy username");

      return {
        line,
        index,
        platform,
        username,
        display_name: username,
        cookie,
        valid: errors.length === 0,
        errors
      };
    });
};

export default function Accounts() {
  const [userRole, setUserRole] = useState("OPERATOR");
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Add Form Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPlatform, setNewPlatform] = useState("X");
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newCookie, setNewCookie] = useState("");
  const [newDailyLimit, setNewDailyLimit] = useState(50);
  const [newHourlyLimit, setNewHourlyLimit] = useState(5);
  const [addMode, setAddMode] = useState("single");
  const [bulkAccountsText, setBulkAccountsText] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);

  // Edit Form Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editCookie, setEditCookie] = useState("");
  const [editDailyLimit, setEditDailyLimit] = useState(50);
  const [editHourlyLimit, setEditHourlyLimit] = useState(5);
  const [checkingId, setCheckingId] = useState(null);
  const [loginLoadingId, setLoginLoadingId] = useState(null);

  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  };

  const apiFetch = async (endpoint, options = {}) => {
    const token = localStorage.getItem("campaign_token");
    const headers = {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    };
    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP error ${res.status}`);
    }
    return res.json();
  };

  const loadAccounts = async () => {
    try {
      const list = await apiFetch("/api/accounts");
      setAccounts(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const role = localStorage.getItem("campaign_role");
    setUserRole(role || "OPERATOR");
    loadAccounts();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await apiFetch("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          platform: newPlatform,
          username: newUsername,
          display_name: newDisplayName,
          cookie: newCookie.trim() || null,
          daily_limit: parseInt(newDailyLimit),
          hourly_limit: parseInt(newHourlyLimit)
        })
      });
      showToast("Thêm tài khoản thành công!");
      setNewUsername("");
      setNewDisplayName("");
      setNewCookie("");
      setShowAddModal(false);
      loadAccounts();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const bulkPreview = parseBulkAccounts(bulkAccountsText);
  const validBulkAccounts = bulkPreview.filter((item) => item.valid);

  const handleBulkCreate = async (e) => {
    e.preventDefault();
    if (validBulkAccounts.length === 0) {
      showToast("Chưa có dòng hợp lệ để thêm tài khoản.", "error");
      return;
    }

    setBulkImporting(true);
    const failed = [];
    let created = 0;

    for (const item of validBulkAccounts) {
      try {
        await apiFetch("/api/accounts", {
          method: "POST",
          body: JSON.stringify({
            platform: item.platform,
            username: item.username,
            display_name: item.display_name,
            cookie: item.cookie || null,
            daily_limit: parseInt(newDailyLimit),
            hourly_limit: parseInt(newHourlyLimit)
          })
        });
        created += 1;
      } catch (err) {
        failed.push(`@${item.username}: ${err.message}`);
      }
    }

    setBulkImporting(false);
    if (created > 0) {
      showToast(`Đã thêm ${created} tài khoản. ${failed.length ? `Lỗi ${failed.length} tài khoản.` : ""}`);
      setBulkAccountsText("");
      setShowAddModal(false);
      loadAccounts();
    }
    if (failed.length > 0) {
      showToast(failed.slice(0, 3).join(" | "), "error");
    }
  };

  const openEditModal = (acc) => {
    setEditingAccount(acc);
    setEditDisplayName(acc.display_name || "");
    setEditCookie(acc.cookie || "");
    setEditDailyLimit(acc.daily_limit || 50);
    setEditHourlyLimit(acc.hourly_limit || 5);
    setShowEditModal(true);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      await apiFetch(`/api/accounts/${editingAccount.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          display_name: editDisplayName,
          cookie: editCookie.trim() || null,
          daily_limit: parseInt(editDailyLimit),
          hourly_limit: parseInt(editHourlyLimit)
        })
      });
      showToast("Cập nhật thông tin tài khoản thành công!");
      setShowEditModal(false);
      loadAccounts();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const toggleStatus = async (account) => {
    const nextStatus = account.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await apiFetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      showToast(`Đã chuyển trạng thái tài khoản sang ${nextStatus === "ACTIVE" ? "Hoạt động" : "Tạm dừng"}`);
      loadAccounts();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const deleteAccount = async (aid) => {
    if (!confirm("Bạn có chắc chắn muốn xóa tài khoản mạng xã hội này? Tất cả dữ liệu liên quan sẽ bị xóa.")) return;
    try {
      await apiFetch(`/api/accounts/${aid}`, { method: "DELETE" });
      showToast("Đã xóa tài khoản khỏi hệ thống.", "error");
      loadAccounts();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const checkConnection = async (accountId, platform, username) => {
    setCheckingId(accountId);
    try {
      const result = await apiFetch(`/api/accounts/${accountId}/check`, {
        method: "POST"
      });
      if (result.success) {
        showToast(result.message, "success");
      } else {
        showToast(result.message, "error");
      }
      loadAccounts();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setCheckingId(null);
    }
  };

  const handleAutoLogin = async (accountId, platform, username) => {
    // IMPORTANT: Open window SYNCHRONOUSLY in click handler to avoid popup blocker
    const profileUrl = platform === "X" 
      ? `https://x.com/${username}` 
      : `https://www.threads.net/@${username}`;
    const newTab = window.open(profileUrl, "_blank");
    
    setLoginLoadingId(accountId);
    try {
      const data = await apiFetch(`/api/accounts/${accountId}/login-script`);
      
      // Copy script to clipboard
      await navigator.clipboard.writeText(data.script);
      
      // Show instructions toast
      showToast(
        `✅ Đã sao chép script đăng nhập (${data.cookie_count} cookies) vào clipboard! Trên tab vừa mở → nhấn F12 → Console → Ctrl+V → Enter để đăng nhập.`,
        "success"
      );
    } catch (err) {
      showToast(err.message, "error");
      // If API fails, the tab is already open but user won't have the script
    } finally {
      setLoginLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <p className="font-bold text-base text-gray-500">Đang tải danh sách tài khoản...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8 animate-slide-in">
      
      {/* Toast notifications handler */}
      <div className="fixed top-6 right-6 z-50 space-y-3">
        {toasts.map((t) => (
          <div 
            key={t.id} 
            className={`flex items-center px-5 py-3.5 rounded-md border text-sm font-bold tracking-wide transition-all shadow-none ${
              t.type === "error" 
                ? "bg-red-50 border-red-200 text-red-600"
                : "bg-emerald-50 border-emerald-200 text-emerald-600"
            }`}
          >
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Header bar */}
      <div className="flex justify-between items-center pr-1 pl-1">
        <h3 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider">Tài khoản kết nối</h3>
        {userRole !== "VIEWER" && (
          <button
            onClick={() => setShowAddModal(true)}
            className="h-12 bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold px-5 rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
          >
            + Kết nối tài khoản mạng xã hội
          </button>
        )}
      </div>

      {/* Account Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {accounts.length === 0 ? (
          <div className="col-span-full bg-gray-50 border border-gray-200 rounded-lg p-12 text-center text-gray-500 font-bold text-xs shadow-none">
            Chưa có tài khoản nào được kết nối. Sử dụng nút bên trên để đăng ký tài khoản.
          </div>
        ) : (
          accounts.map((acc) => (
            <div 
              key={acc.id} 
              className="bg-gray-50 border border-gray-200 rounded-lg p-6 shadow-none transition-all duration-200 hover:scale-[1.02] relative overflow-hidden flex flex-col justify-between h-[390px]"
            >
              
              {/* Badge Top-right */}
              <div className="absolute top-6 right-6 flex items-center space-x-2">
                <span className={`px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                  acc.cookie 
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}>
                  {acc.cookie ? "🔑 Đã cài Cookie" : "⚠️ Chưa có Cookie"}
                </span>
                <span className={`px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                  acc.platform === "X" 
                    ? "bg-blue-50 text-blue-700 border border-blue-200" 
                    : "bg-purple-50 text-purple-700 border border-purple-200"
                }`}>
                  {acc.platform}
                </span>
              </div>

              {/* Avatar and name */}
              <div className="flex items-center space-x-3.5 pl-1 pt-2">
                <div className="w-12 h-12 rounded-md bg-white border border-gray-200 flex items-center justify-center text-[#3B82F6] font-extrabold uppercase text-base">
                  {acc.username.substring(0, 2)}
                </div>
                <div>
                  <h4 className="font-extrabold text-gray-900 text-sm leading-snug">{acc.display_name}</h4>
                  <a
                    href={acc.platform === "X" ? `https://x.com/${acc.username}` : `https://www.threads.net/@${acc.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-blue-500 text-xs font-semibold flex items-center space-x-0.5 hover:underline cursor-pointer"
                  >
                    <span>@{acc.username}</span>
                    <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>

              {/* Health Score */}
              <div className="space-y-1.5 pl-1 pr-1">
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-gray-500">Sức khỏe tài khoản:</span>
                  <span className={`font-extrabold uppercase ${
                    acc.status === "ACTIVE" 
                      ? "text-[#10B981]" 
                      : acc.status === "LIMITED" 
                      ? "text-[#F59E0B]" 
                      : acc.status === "ERROR"
                      ? "text-red-500"
                      : "text-red-650"
                  }`}>
                    {acc.status === "ACTIVE" ? "Hoạt động" : acc.status === "LIMITED" ? "Bị giới hạn" : acc.status === "ERROR" ? "Lỗi kết nối" : acc.status} ({acc.health_score}%)
                  </span>
                </div>
                {/* Health Bar */}
                <div className="w-full bg-gray-200 h-2.5 rounded-md overflow-hidden">
                  <div className={`h-full rounded-md ${
                    acc.health_score > 70 
                      ? "bg-[#10B981]" 
                      : acc.health_score > 40 
                      ? "bg-[#F59E0B]" 
                      : "bg-red-500"
                  }`} style={{ width: `${acc.health_score}%` }} />
                </div>
              </div>

              {/* Usage Quotas */}
              <div className="space-y-3 border-t border-gray-200 pt-4 pl-1 pr-1 text-xs">
                <div>
                  <div className="flex justify-between text-[10px] text-gray-500 font-extrabold uppercase tracking-wide">
                    <span>Hạn mức theo giờ</span>
                    <span className="font-bold text-gray-900">{acc.hourly_usage_count} / {acc.hourly_limit}</span>
                  </div>
                  <div className="w-full bg-gray-200 h-2 rounded-md overflow-hidden mt-1">
                    <div 
                      className={`h-full rounded-md ${acc.hourly_usage_count >= acc.hourly_limit ? "bg-[#F59E0B]" : "bg-[#3B82F6]"}`} 
                      style={{ width: `${Math.min(100, (acc.hourly_usage_count / acc.hourly_limit) * 100)}%` }} 
                    />
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-[10px] text-gray-500 font-extrabold uppercase tracking-wide">
                    <span>Hạn mức theo ngày</span>
                    <span className="font-bold text-gray-900">{acc.daily_usage_count} / {acc.daily_limit}</span>
                  </div>
                  <div className="w-full bg-gray-200 h-2 rounded-md overflow-hidden mt-1">
                    <div 
                      className={`h-full rounded-md ${acc.daily_usage_count >= acc.daily_limit ? "bg-[#F59E0B]" : "bg-[#10B981]"}`} 
                      style={{ width: `${Math.min(100, (acc.daily_usage_count / acc.daily_limit) * 100)}%` }} 
                    />
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              {userRole !== "VIEWER" && (
                <div className="flex flex-col gap-2 pt-3 border-t border-gray-200">
                  <div className="flex gap-2">
                    <button
                      onClick={() => checkConnection(acc.id, acc.platform, acc.username)}
                      disabled={checkingId === acc.id}
                      className="flex-1 h-10 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#3B82F6] font-extrabold rounded-md transition-all duration-200 hover:scale-[1.02] flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed text-xs"
                    >
                      {checkingId === acc.id ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-1 h-3.5 w-3.5 text-[#3B82F6]" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>Đang kiểm tra...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                          <span>Kiểm tra Cookie</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleAutoLogin(acc.id, acc.platform, acc.username)}
                      disabled={loginLoadingId === acc.id || !acc.cookie}
                      className="flex-1 h-10 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-600 font-extrabold rounded-md transition-all duration-200 hover:scale-[1.02] flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed text-xs"
                    >
                      {loginLoadingId === acc.id ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-1 h-3.5 w-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>Đang xử lý...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                          </svg>
                          <span>🔑 Đăng nhập</span>
                        </>
                      )}
                    </button>
                  </div>
                  
                  <div className="flex gap-2 text-xs">
                    <button
                      onClick={() => toggleStatus(acc)}
                      className={`flex-1 h-10 font-extrabold rounded-md border transition-all duration-200 hover:scale-105 cursor-pointer ${
                        acc.status === "ACTIVE" 
                          ? "bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100"
                          : "bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100"
                      }`}
                    >
                      {acc.status === "ACTIVE" ? "⏸️ Tạm dừng" : "▶️ Hoạt động"}
                    </button>
                    <button
                      onClick={() => openEditModal(acc)}
                      className="bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-700 font-extrabold px-3 h-10 rounded-md transition-all duration-200 hover:scale-105 cursor-pointer"
                    >
                      ⚙️ Sửa
                    </button>
                    <button
                      onClick={() => deleteAccount(acc.id)}
                      className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-extrabold px-3 h-10 rounded-md transition-all duration-200 hover:scale-105 cursor-pointer"
                    >
                      🗑️ Xóa
                    </button>
                  </div>
                </div>
              )}

            </div>
          ))
        )}
      </div>

      {/* ADD MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-gray-200 rounded-lg max-w-md w-full p-8 space-y-5 shadow-none animate-slide-up">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="text-base font-extrabold text-gray-900 uppercase tracking-tight">Thêm tài khoản mạng xã hội</h3>
              <button 
                onClick={() => setShowAddModal(false)} 
                className="text-gray-400 hover:text-gray-900 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 bg-gray-100 border border-gray-200 rounded-md p-1">
              <button
                type="button"
                onClick={() => setAddMode("single")}
                className={`h-10 rounded text-xs font-extrabold transition-all ${
                  addMode === "single" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Một tài khoản
              </button>
              <button
                type="button"
                onClick={() => setAddMode("bulk")}
                className={`h-10 rounded text-xs font-extrabold transition-all ${
                  addMode === "bulk" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Nhiều tài khoản
              </button>
            </div>
            
            {addMode === "single" ? (
            <form onSubmit={handleCreate} className="space-y-4 text-xs font-bold text-gray-600">
              <div>
                <label className="block mb-1.5 ml-0.5">Nền tảng mạng xã hội</label>
                <select
                  value={newPlatform}
                  onChange={(e) => setNewPlatform(e.target.value)}
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-3 text-xs font-bold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                >
                  <option value="X">X (Twitter)</option>
                  <option value="Threads">Threads</option>
                </select>
              </div>

              <div>
                <label className="block mb-1.5 ml-0.5">Tên tài khoản (Username, không bao gồm @)</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Ví dụ: tin_nong_24h"
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                  required
                />
              </div>

              <div>
                <label className="block mb-1.5 ml-0.5">Tên hiển thị (Display Name)</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="Ví dụ: Tin tức 24h X"
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block mb-1.5 ml-0.5">Chuỗi Session Cookie (Tùy chọn)</label>
                <textarea
                  value={newCookie}
                  onChange={(e) => setNewCookie(e.target.value)}
                  placeholder="Nhập chuỗi cookie (Ví dụ: auth_token=...; ct0=...)"
                  rows="3"
                  className="w-full bg-gray-100 border border-gray-200 rounded-md p-3 text-xs font-mono font-medium text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                />
                <span className="text-[10px] text-gray-400 font-medium mt-1 block">X yêu cầu các khoá 'ct0' và 'auth_token'. Threads yêu cầu 'sessionid'.</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 ml-0.5">Giới hạn theo giờ</label>
                  <input
                    type="number"
                    value={newHourlyLimit}
                    onChange={(e) => setNewHourlyLimit(e.target.value)}
                    className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block mb-1.5 ml-0.5">Giới hạn theo ngày</label>
                  <input
                    type="number"
                    value={newDailyLimit}
                    onChange={(e) => setNewDailyLimit(e.target.value)}
                    className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                    min="1"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full h-12 bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
              >
                Kết nối tài khoản
              </button>
            </form>
            ) : (
            <form onSubmit={handleBulkCreate} className="space-y-4 text-xs font-bold text-gray-600">
              <div>
                <label className="block mb-1.5 ml-0.5">Danh sách tài khoản</label>
                <textarea
                  value={bulkAccountsText}
                  onChange={(e) => setBulkAccountsText(e.target.value)}
                  placeholder={`Mỗi dòng một tài khoản. Ví dụ:
https://x.com/tin_nong_24h auth_token=...; ct0=...
https://www.threads.net/@lifestyle_vlog sessionid=...
@crypto_news auth_token=...; ct0=...`}
                  rows="8"
                  className="w-full bg-gray-100 border border-gray-200 rounded-md p-3 text-xs font-mono font-medium text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                />
                <span className="text-[10px] text-gray-400 font-medium mt-1 block">
                  Hệ thống tự nhận diện X bằng x.com/twitter.com/auth_token/ct0 và Threads bằng threads.net/sessionid.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 ml-0.5">Giới hạn theo giờ</label>
                  <input
                    type="number"
                    value={newHourlyLimit}
                    onChange={(e) => setNewHourlyLimit(e.target.value)}
                    className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block mb-1.5 ml-0.5">Giới hạn theo ngày</label>
                  <input
                    type="number"
                    value={newDailyLimit}
                    onChange={(e) => setNewDailyLimit(e.target.value)}
                    className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                    min="1"
                    required
                  />
                </div>
              </div>

              <div className="border border-gray-200 rounded-md overflow-hidden">
                <div className="flex items-center justify-between bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500">Preview nhận diện</span>
                  <span className="text-[10px] font-extrabold text-gray-900">
                    {validBulkAccounts.length}/{bulkPreview.length} hợp lệ
                  </span>
                </div>
                <div className="max-h-44 overflow-y-auto divide-y divide-gray-100">
                  {bulkPreview.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[11px] text-gray-400 font-semibold">
                      Chưa có dữ liệu để xem trước.
                    </div>
                  ) : (
                    bulkPreview.map((item) => (
                      <div key={`${item.index}-${item.username || item.line}`} className="px-3 py-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-extrabold text-gray-900 truncate">
                              {item.username ? `@${item.username}` : "Thiếu username"}
                            </span>
                            {item.platform && (
                              <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase border ${
                                item.platform === "X"
                                  ? "bg-blue-50 text-blue-700 border-blue-200"
                                  : "bg-purple-50 text-purple-700 border-purple-200"
                              }`}>
                                {item.platform}
                              </span>
                            )}
                            {item.cookie && (
                              <span className="px-2 py-0.5 rounded text-[9px] font-extrabold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Cookie
                              </span>
                            )}
                          </div>
                          {!item.valid && (
                            <p className="text-[10px] text-red-500 font-semibold mt-1">
                              {item.errors.join(", ")}
                            </p>
                          )}
                        </div>
                        <span className={`shrink-0 text-[10px] font-extrabold ${item.valid ? "text-emerald-600" : "text-red-500"}`}>
                          {item.valid ? "OK" : "Lỗi"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={bulkImporting || validBulkAccounts.length === 0}
                className="w-full h-12 bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {bulkImporting ? "Đang thêm tài khoản..." : `Thêm ${validBulkAccounts.length} tài khoản hợp lệ`}
              </button>
            </form>
            )}
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {showEditModal && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-gray-200 rounded-lg max-w-md w-full p-8 space-y-5 shadow-none animate-slide-up">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="text-base font-extrabold text-gray-900 uppercase tracking-tight">Chỉnh sửa tài khoản</h3>
              <button 
                onClick={() => setShowEditModal(false)} 
                className="text-gray-400 hover:text-gray-900 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleUpdate} className="space-y-4 text-xs font-bold text-gray-600">
              <div>
                <label className="block mb-1.5 ml-0.5">Tên đăng nhập (Chỉ đọc)</label>
                <input
                  type="text"
                  value={`@${editingAccount?.username}`}
                  disabled
                  className="w-full h-11 bg-gray-200 border border-gray-200 rounded-md px-4 text-xs font-bold text-gray-500 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block mb-1.5 ml-0.5">Tên hiển thị (Display Name)</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder="Ví dụ: My Custom Label"
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                />
              </div>

              <div>
                <label className="block mb-1.5 ml-0.5">Chuỗi Session Cookie mới (Tùy chọn)</label>
                <textarea
                  value={editCookie}
                  onChange={(e) => setEditCookie(e.target.value)}
                  placeholder="Nhập chuỗi cookie mới"
                  rows="3"
                  className="w-full bg-gray-100 border border-gray-200 rounded-md p-3 text-xs font-mono font-medium text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                />
                <span className="text-[10px] text-gray-400 font-medium mt-1 block">Thay thế chuỗi session cookie lưu trữ cho tài khoản X hoặc Threads này.</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 ml-0.5">Giới hạn theo giờ</label>
                  <input
                    type="number"
                    value={editHourlyLimit}
                    onChange={(e) => setEditHourlyLimit(e.target.value)}
                    className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                    min="1"
                    required
                  />
                </div>
                <div>
                  <label className="block mb-1.5 ml-0.5">Giới hạn theo ngày</label>
                  <input
                    type="number"
                    value={editDailyLimit}
                    onChange={(e) => setEditDailyLimit(e.target.value)}
                    className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                    min="1"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full h-12 bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
              >
                Lưu thay đổi
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
