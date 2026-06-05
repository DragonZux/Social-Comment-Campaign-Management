"use client";

import { useState, useEffect, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

export default function Dashboard() {
  const [metrics, setMetrics] = useState({
    total_campaigns: 0,
    success_rate: 0.0,
    failed_jobs: 0,
    active_accounts: 0,
    queue_size: 0,
    avg_processing_time: 0.0,
    recent_jobs: [],
    campaign_distribution: { DRAFT: 0, READY: 0, RUNNING: 0, COMPLETED: 0 }
  });
  const [loading, setLoading] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const timerRef = useRef(null);

  const fetchMetrics = async () => {
    try {
      const token = sessionStorage.getItem("campaign_token");
      if (!token) return;

      const res = await fetch(`${API_BASE}/api/dashboard/metrics`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (err) {
      console.error("Error fetching metrics:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    timerRef.current = setInterval(fetchMetrics, 3000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center bg-transparent">
        <div className="relative flex items-center justify-center mb-4">
          <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
          <div className="absolute w-8 h-8 bg-blue-500/10 rounded-full animate-pulse"></div>
        </div>
        <p className="font-bold text-slate-500 text-sm tracking-wide animate-pulse">
          Đang tải số liệu thống kê hệ thống...
        </p>
      </div>
    );
  }

  const statCards = [
    {
      label: "Tổng chiến dịch",
      val: metrics.total_campaigns,
      color: "from-blue-500 to-indigo-600",
      textColor: "text-blue-600",
      bgColor: "bg-blue-50/70 border-blue-100",
      glowColor: "bg-blue-500/10",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      )
    },
    {
      label: "Tỷ lệ thành công",
      val: `${metrics.success_rate}%`,
      color: "from-emerald-500 to-teal-600",
      textColor: "text-emerald-600",
      bgColor: "bg-emerald-50/70 border-emerald-100",
      glowColor: "bg-emerald-500/10",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      )
    },
    {
      label: "Tác vụ thất bại",
      val: metrics.failed_jobs,
      color: "from-rose-500 to-red-600",
      textColor: "text-rose-600",
      bgColor: "bg-rose-50/70 border-rose-100",
      glowColor: "bg-rose-500/10",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      )
    },
    {
      label: "Tài khoản chạy",
      val: metrics.active_accounts,
      color: "from-violet-500 to-purple-600",
      textColor: "text-violet-600",
      bgColor: "bg-violet-50/70 border-violet-100",
      glowColor: "bg-violet-500/10",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    },
    {
      label: "Hàng chờ Redis",
      val: metrics.queue_size,
      color: "from-amber-500 to-orange-600",
      textColor: "text-amber-600",
      bgColor: "bg-amber-50/70 border-amber-100",
      glowColor: "bg-amber-500/10",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
    },
    {
      label: "Thời gian chạy TB",
      val: `${metrics.avg_processing_time}s`,
      color: "from-sky-500 to-cyan-600",
      textColor: "text-sky-600",
      bgColor: "bg-sky-50/70 border-sky-100",
      glowColor: "bg-sky-500/10",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
  ];

  // Filter logic
  const filteredJobs = metrics.recent_jobs.filter((job) => {
    const isPlatformMatch =
      filterPlatform === "ALL" ||
      (filterPlatform === "THREADS" && job.target_url?.includes("threads.net")) ||
      (filterPlatform === "X" && !job.target_url?.includes("threads.net"));

    const isStatusMatch = filterStatus === "ALL" || job.status === filterStatus;

    const matchesSearch =
      job.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (job.account_username && job.account_username.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (job.template_content && job.template_content.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (job.target_url && job.target_url.toLowerCase().includes(searchTerm.toLowerCase()));

    return isPlatformMatch && isStatusMatch && matchesSearch;
  });

  return (
    <div className="space-y-6 pb-8 animate-slide-up">
      {/* Stat Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card, idx) => (
          <div
            key={idx}
            className="group relative bg-white border border-slate-200/80 p-5 rounded-2xl transition-all duration-300 hover:shadow-lg hover:shadow-slate-100/50 hover:border-slate-300 hover:-translate-y-1 flex flex-col justify-between h-36 overflow-hidden"
          >
            {/* Glow Blob decoration */}
            <div className={`absolute -right-6 -bottom-6 w-20 h-20 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none ${card.glowColor}`} />

            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all duration-300 group-hover:scale-110 ${card.bgColor} ${card.textColor}`}>
              {card.icon}
            </div>
            <div className="space-y-1 z-10">
              <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight leading-none">
                {card.val}
              </h3>
              <p className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest pt-1">
                {card.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Middle Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Campaign distribution list */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-5 shadow-sm shadow-slate-100/30">
          <div className="flex items-center space-x-2.5 pb-2 border-b border-slate-100">
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 3.055A9.003 9.003 0 1020.945 13H11V3.055z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
              </svg>
            </div>
            <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
              Phân bố chiến dịch
            </h3>
          </div>
          <div className="space-y-4">
            {Object.entries(metrics.campaign_distribution).map(([status, count]) => {
              const total = Object.values(metrics.campaign_distribution).reduce((a, b) => a + b, 0) || 1;
              const pct = Math.round((count / total) * 100);
              
              const colors = {
                RUNNING: "bg-gradient-to-r from-blue-500 to-indigo-500",
                COMPLETED: "bg-gradient-to-r from-emerald-500 to-teal-500",
                PAUSED: "bg-gradient-to-r from-amber-500 to-orange-500",
                DRAFT: "bg-gradient-to-r from-slate-400 to-slate-500",
                READY: "bg-gradient-to-r from-cyan-500 to-teal-500"
              };
              
              const statusVn = {
                RUNNING: "Đang chạy",
                COMPLETED: "Hoàn thành",
                PAUSED: "Tạm dừng",
                DRAFT: "Bản nháp",
                READY: "Sẵn sàng"
              };
              
              const dotColors = {
                RUNNING: "bg-blue-500",
                COMPLETED: "bg-emerald-500",
                PAUSED: "bg-amber-500",
                DRAFT: "bg-slate-400",
                READY: "bg-cyan-500"
              };

              return (
                <div key={status} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-500 flex items-center">
                      <span className={`h-1.5 w-1.5 rounded-full mr-2 ${dotColors[status] || "bg-blue-500"}`} />
                      {statusVn[status] || status}
                    </span>
                    <span className="text-slate-800 bg-slate-50 px-2 py-0.5 rounded-md text-[10px]">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${colors[status] || "bg-blue-500"} rounded-full transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Worker and environment status card */}
        <div className="lg:col-span-2 bg-white border border-slate-200/80 rounded-2xl p-6 flex flex-col justify-between shadow-sm shadow-slate-100/30">
          <div className="space-y-5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center space-x-2.5">
                <div className="w-7 h-7 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  Trạng thái Worker & Hàng chờ
                </h3>
              </div>
              <div className="flex items-center space-x-1.5 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-bold border border-emerald-100">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-glow" />
                <span>ỔN ĐỊNH</span>
              </div>
            </div>

            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              Tiến trình worker chạy ngầm đang hoạt động trực tuyến. Tiến trình tự động giải phóng hàng chờ Redis, điều phối lịch trình bình luận và tự động xử lý hàng đợi lỗi tăng dần thời gian trễ.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-50/60 border border-slate-150 p-4 rounded-xl flex items-start space-x-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <p className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider">Hàng chờ Redis</p>
                  <p className="text-[11px] font-bold text-slate-800 mt-1 truncate">localhost:6399</p>
                  <span className="text-[9px] text-emerald-600 font-extrabold uppercase mt-0.5 inline-block">Đã kết nối</span>
                </div>
              </div>

              <div className="bg-slate-50/60 border border-slate-150 p-4 rounded-xl flex items-start space-x-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h16" />
                  </svg>
                </div>
                <div>
                  <p className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider">MongoDB Database</p>
                  <p className="text-[11px] font-bold text-slate-800 mt-1 truncate">social_campaign_db</p>
                  <span className="text-[9px] text-emerald-600 font-extrabold uppercase mt-0.5 inline-block">Hoạt động</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center pt-4 border-t border-slate-100 mt-6 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            <span className="flex items-center">
              <span className="h-1 w-1 bg-slate-400 rounded-full mr-1.5" />
              Lệnh chờ: <b className="text-slate-600 ml-1">BLPOP (5s)</b>
            </span>
            <span className="flex items-center">
              <span className="h-1 w-1 bg-slate-400 rounded-full mr-1.5" />
              Chu kỳ Quota: <b className="text-slate-600 ml-1">Tự động làm mới</b>
            </span>
          </div>
        </div>
      </div>

      {/* Live Monitor Table Panel */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm shadow-slate-100/30">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 pb-4 border-b border-slate-100">
          <div className="space-y-1">
            <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
              Bảng giám sát tác vụ thời gian thực
            </h3>
            <p className="text-[11px] text-slate-400 font-medium">Báo cáo trực quan các yêu cầu thực thi bình luận gần nhất</p>
          </div>

          <div className="flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping" />
            <span className="text-[10px] bg-blue-50 text-blue-700 px-3 py-1 rounded-md font-bold uppercase tracking-wider">
              Cập nhật liên tục
            </span>
          </div>
        </div>

        {/* Dynamic Interactive Filters */}
        <div className="flex flex-col md:flex-row gap-3 mb-5">
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Tìm kiếm tác vụ (Mã, Username, Nội dung, Link)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-200 pl-9 pr-4 rounded-xl text-xs font-semibold placeholder-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none transition-all"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Platform filter buttons */}
            <div className="bg-slate-100 p-0.5 rounded-xl flex">
              {["ALL", "X", "THREADS"].map((plat) => (
                <button
                  key={plat}
                  onClick={() => setFilterPlatform(plat)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                    filterPlatform === plat
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {plat === "ALL" ? "Tất cả" : plat}
                </button>
              ))}
            </div>

            {/* Status filter dropdown */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="h-10 bg-slate-50 border border-slate-200 px-3 rounded-xl text-xs font-bold text-slate-600 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="RUNNING">Đang chạy</option>
              <option value="SUCCESS">Thành công</option>
              <option value="FAILED">Thất bại</option>
            </select>
          </div>
        </div>

        {/* Table Area */}
        <div className="overflow-x-auto rounded-xl border border-slate-150">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-150 text-slate-400 uppercase tracking-widest font-extrabold">
                <th className="py-3.5 px-4 font-bold">Mã Tác Vụ</th>
                <th className="py-3.5 px-4 font-bold">Nền Tảng</th>
                <th className="py-3.5 px-4 font-bold">Tài Khoản</th>
                <th className="py-3.5 px-4 font-bold">Đường Dẫn Bài Viết</th>
                <th className="py-3.5 px-4 font-bold">Nội Dung</th>
                <th className="py-3.5 px-4 font-bold">Trạng Thái</th>
                <th className="py-3.5 px-4 font-bold text-center">Lần Thử</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-semibold">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400 font-bold bg-slate-50/30">
                    Không tìm thấy tác vụ nào khớp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job) => {
                  const isThreads = job.target_url?.includes("threads.net");
                  return (
                    <tr key={job.id} className="hover:bg-slate-50/50 transition-colors duration-150">
                      <td className="py-3.5 px-4 font-mono text-[10px] text-slate-400">
                        {job.id.substring(job.id.length - 8)}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-extrabold uppercase border ${
                            isThreads
                              ? "bg-purple-50 text-purple-700 border-purple-100"
                              : "bg-slate-900 text-white border-slate-900"
                          }`}
                        >
                          {isThreads ? (
                            <>
                              <span className="w-1 h-1 bg-purple-500 rounded-full mr-1" />
                              Threads
                            </>
                          ) : (
                            <>
                              <span className="w-1 h-1 bg-white rounded-full mr-1" />
                              X (Twitter)
                            </>
                          )}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">
                        @{job.account_username || "hệ thống"}
                      </td>
                      <td className="py-3.5 px-4 max-w-[180px] truncate text-slate-500 font-medium" title={job.target_url}>
                        {job.target_url}
                      </td>
                      <td className="py-3.5 px-4 max-w-[220px] truncate text-slate-600 font-medium" title={job.template_content}>
                        "{job.template_content}"
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-[9px] font-extrabold uppercase tracking-wide border ${
                            job.status === "SUCCESS"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                              : job.status === "FAILED"
                              ? "bg-rose-50 text-rose-700 border-rose-100"
                              : job.status === "RUNNING"
                              ? "bg-blue-50 text-blue-700 border-blue-100 animate-pulse"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          <span
                            className={`w-1 h-1 rounded-full mr-1.5 ${
                              job.status === "SUCCESS"
                                ? "bg-emerald-500"
                                : job.status === "FAILED"
                                ? "bg-rose-500"
                                : job.status === "RUNNING"
                                ? "bg-blue-500 animate-pulse"
                                : "bg-slate-500"
                            }`}
                          />
                          {job.status === "SUCCESS"
                            ? "Thành công"
                            : job.status === "FAILED"
                            ? "Thất bại"
                            : job.status === "RUNNING"
                            ? "Đang chạy"
                            : job.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="inline-flex items-center space-x-1">
                          <span className="text-xs font-extrabold text-slate-800">{job.attempt_count}</span>
                          <span className="text-[10px] text-slate-400">/ 3</span>
                        </div>
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
