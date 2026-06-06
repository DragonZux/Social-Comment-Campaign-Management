"use client";

import { useState, useEffect, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const apiFetch = async (endpoint, options: any = {}) => {
    const token = sessionStorage.getItem("campaign_token");
    const headers = {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    };
    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP error ${res.status}`);
      }
      return await res.json();
    } catch (err: any) {
      if (err.message === "Failed to fetch" || err.name === "TypeError") {
        throw new Error("Không thể kết nối đến máy chủ API.");
      }
      throw err;
    }
  };

  const fetchJobs = async () => {
    try {
      const endpoint = filterStatus ? `/api/jobs?status=${filterStatus}` : "/api/jobs";
      const list = await apiFetch(endpoint);
      setJobs(list);
    } catch (err) {
      console.warn(err);
    } finally {
      setLoading(false);
    }
  };

  // Poll job data
  useEffect(() => {
    let active = true;
    const pollJobs = async () => {
      try {
        const endpoint = filterStatus ? `/api/jobs?status=${filterStatus}` : "/api/jobs";
        const list = await apiFetch(endpoint);
        if (!active) return;
        setJobs(list);
      } catch (err) {
        console.warn(err);
      } finally {
        if (active) setLoading(false);
      }
    };

    pollJobs();
    const timer = setInterval(pollJobs, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [filterStatus]);

  const retryJob = async (jobId) => {
    try {
      const res = await apiFetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      showToast("Đã kích hoạt chạy lại tác vụ bình luận!");
      fetchJobs();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <p className="font-bold text-base text-gray-500">Đang tải danh sách hàng chờ...</p>
      </div>
    );
  }

  const filters = [
    { label: "Tất cả trạng thái", val: "" },
    { label: "Đang xếp hàng", val: "QUEUED" },
    { label: "Đang chạy", val: "RUNNING" },
    { label: "Thành công", val: "SUCCESS" },
    { label: "Thất bại", val: "FAILED" },
    { label: "Đang thử lại", val: "RETRYING" }
  ];

  const getStatusText = (s) => {
    if (s === "SUCCESS") return "Thành công";
    if (s === "FAILED") return "Thất bại";
    if (s === "RUNNING") return "Đang chạy";
    if (s === "RETRYING") return "Đang thử lại";
    if (s === "QUEUED") return "Đang xếp hàng";
    if (s === "CANCELLED") return "Đã hủy";
    return s;
  };

  const getJobPlatform = (job) => {
    if (job.platform) return job.platform;
    const targetUrl = job.target_url || "";
    if (targetUrl.includes("threads.net") || targetUrl.includes("threads.com")) return "Threads";
    return "X";
  };

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

      {/* Filter toolbar block */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 border border-gray-200 p-5 rounded-lg gap-4 shadow-none">
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          {filters.map((btn) => (
            <button
              key={btn.val}
              onClick={() => setFilterStatus(btn.val)}
              className={`px-4 h-10 rounded-md border transition-all duration-200 cursor-pointer shadow-none ${
                filterStatus === btn.val
                  ? "bg-[#3B82F6] border-0 text-white hover:bg-blue-600"
                  : "bg-white border-gray-200 text-gray-700 hover:bg-gray-100 hover:scale-105"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
        <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500 pl-1 sm:pr-1">
          Tìm thấy **{jobs.length}** tác vụ
        </div>
      </div>

      {/* Table block */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 overflow-hidden shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-gray-400 uppercase tracking-widest font-extrabold">
                <th className="py-4 px-6">ID Tác Vụ</th>
                <th className="py-4 px-6">Nền Tảng</th>
                <th className="py-4 px-6">Tài Khoản</th>
                <th className="py-4 px-6">Đường Dẫn Đích</th>
                <th className="py-4 px-6">Nội Dung</th>
                <th className="py-4 px-6">Trạng Thái</th>
                <th className="py-4 px-6">Số Lần Thử</th>
                <th className="py-4 px-6">Thông Tin Lỗi</th>
                <th className="py-4 px-6 text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-gray-900 font-semibold">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-500 font-bold">Không tìm thấy tác vụ nào khớp với tiêu chí lọc.</td>
                </tr>
              ) : (
                jobs.map((job) => {
                  const platform = getJobPlatform(job);

                  return (
                  <tr key={job.id} className="hover:bg-gray-100/50 transition-colors duration-150">
                    <td className="py-4 px-6 font-mono text-[10px] text-gray-400">{job.id.substring(18)}</td>
                    <td className="py-4 px-6">
                      <span className={`px-2.5 py-1 rounded text-[9px] font-bold uppercase ${
                        platform === "Threads"
                          ? "bg-purple-50 text-purple-700 border border-purple-200"
                          : "bg-blue-50 text-blue-700 border border-blue-200"
                      }`}>
                        {platform}
                      </span>
                    </td>
                    <td className="py-4 px-6 font-bold">@{job.account_username || "dynamic"}</td>
                    <td className="py-4 px-6 max-w-xs truncate text-gray-600" title={job.target_url}>{job.target_url}</td>
                    <td className="py-4 px-6 max-w-xs truncate text-gray-600" title={job.commented_text || job.template_content}>
                      "{job.commented_text || job.template_content}"
                    </td>
                    <td className="py-4 px-6">
                      <span className={`px-2.5 py-1 rounded text-[9px] font-extrabold uppercase ${
                        job.status === "SUCCESS" 
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-250" 
                          : job.status === "FAILED"
                          ? "bg-red-50 text-red-700 border border-red-250"
                          : job.status === "RUNNING"
                          ? "bg-blue-50 text-blue-700 border border-blue-250 animate-pulse"
                          : job.status === "RETRYING"
                          ? "bg-amber-50 text-amber-700 border border-amber-250"
                          : "bg-gray-105 text-gray-600"
                      }`}>
                        {getStatusText(job.status)}
                      </span>
                    </td>
                    <td className="py-4 px-6 font-bold text-gray-500">{job.attempt_count}/3</td>
                    <td className="py-4 px-6 max-w-xs truncate font-mono text-red-600 text-[10px]" title={job.error_message}>
                      {job.error_message || "-"}
                    </td>
                    <td className="py-4 px-6 text-right">
                        {(job.status === "FAILED" || job.status === "CANCELLED") && (
                          <button
                            onClick={() => retryJob(job.id)}
                            className="bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold px-3 py-1.5 rounded-md text-[10px] transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
                          >
                            Chạy lại
                          </button>
                        )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
