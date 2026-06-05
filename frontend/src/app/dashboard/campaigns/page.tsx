"use client";

import { useState, useEffect, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

const collectStrings = (value) => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
};

const uniqueList = (items) => Array.from(new Set(items));

const extractUrlsFromText = (value, platform) => {
  const raw = value.trim();
  if (!raw) return [];

  let source = raw;
  try {
    source = collectStrings(JSON.parse(raw)).join("\n");
  } catch (err) {
    source = raw;
  }

  // Support matching both threads.net and threads.com domains
  const urlMatches = source.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com|threads\.net|threads\.com)\/[^\s"'<>]+/gi) || [];
  const normalized = urlMatches
    .map((url) => url.replace(/[),.;\]]+$/, ""))
    .map((url) => (url.startsWith("http") ? url : `https://${url}`))
    // Automatically normalize threads.com to threads.net domain
    .map((url) => url.replace(/threads\.com/i, "threads.net"))
    .filter((url) => {
      if (platform === "X") return /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url);
      if (platform === "Threads") return /https?:\/\/(?:www\.)?threads\.net\//i.test(url);
      return true;
    });

  return uniqueList(normalized);
};

const parseCommentTemplates = (value) => {
  const raw = value.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    const strings = Array.isArray(parsed)
      ? parsed.map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") return item.content || item.comment || item.text || item.message || "";
          return "";
        })
      : collectStrings(parsed);

    return uniqueList(strings.map((item) => item.trim()).filter(Boolean));
  } catch (err) {
    const blocks = raw.includes("\n\n")
      ? raw.split(/\r?\n\s*\r?\n/)
      : raw.split(/\r?\n/);

    return uniqueList(blocks.map((item) => item.trim()).filter(Boolean));
  }
};

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignUrls, setCampaignUrls] = useState([]);
  const [campaignTemplates, setCampaignTemplates] = useState([]);
  const [campaignJobs, setCampaignJobs] = useState([]);
  
  // Form and Modal States
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignPlatform, setNewCampaignPlatform] = useState("X");
  const [newCampaignDesc, setNewCampaignDesc] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [bulkUrls, setBulkUrls] = useState("");
  const [bulkTemplates, setBulkTemplates] = useState("");

  const [toasts, setToasts] = useState([]);
  const timerRef = useRef(null);
  const parsedBulkUrls = extractUrlsFromText(bulkUrls, selectedCampaign?.platform);
  const parsedBulkTemplates = parseCommentTemplates(bulkTemplates);

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

  const loadCampaigns = async () => {
    try {
      const list = await apiFetch("/api/campaigns");
      setCampaigns(list);
    } catch (err) {
      console.warn(err);
    }
  };

  const loadDetails = async (campaign) => {
    try {
      const updated = await apiFetch(`/api/campaigns/${campaign.id}`);
      setSelectedCampaign(updated);
      const urls = await apiFetch(`/api/campaigns/${campaign.id}/urls`);
      setCampaignUrls(urls);
      const tpls = await apiFetch(`/api/campaigns/${campaign.id}/templates`);
      setCampaignTemplates(tpls);
      const jobs = await apiFetch(`/api/jobs?campaign_id=${campaign.id}`);
      setCampaignJobs(jobs);
    } catch (err) {
      console.warn(err);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  // Poll selected campaign details to show real-time URL and Job updates
  useEffect(() => {
    if (!selectedCampaign) return;
    
    const refreshData = async () => {
      try {
        const updated = await apiFetch(`/api/campaigns/${selectedCampaign.id}`);
        setSelectedCampaign(updated);
        const urls = await apiFetch(`/api/campaigns/${selectedCampaign.id}/urls`);
        setCampaignUrls(urls);
        const tpls = await apiFetch(`/api/campaigns/${selectedCampaign.id}/templates`);
        setCampaignTemplates(tpls);
        const jobs = await apiFetch(`/api/jobs?campaign_id=${selectedCampaign.id}`);
        setCampaignJobs(jobs);
      } catch (err) {
        console.warn("Poll details error:", err);
      }
    };

    timerRef.current = setInterval(refreshData, 3000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [selectedCampaign]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: newCampaignName,
          platform: newCampaignPlatform,
          description: newCampaignDesc
        })
      });
      showToast("Tạo chiến dịch thành công!");
      setNewCampaignName("");
      setNewCampaignDesc("");
      setShowCreateModal(false);
      loadCampaigns();
      setSelectedCampaign(res);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleImportUrls = async () => {
    if (!bulkUrls.trim()) return;
    try {
      const urlsArray = extractUrlsFromText(bulkUrls, selectedCampaign?.platform);
      if (urlsArray.length === 0) {
        showToast("Không tìm thấy URL hợp lệ cho nền tảng chiến dịch này.", "error");
        return;
      }
      await apiFetch(`/api/campaigns/${selectedCampaign.id}/urls/import`, {
        method: "POST",
        body: JSON.stringify({ urls: urlsArray })
      });
      setBulkUrls("");
      showToast("Nhập danh sách đường dẫn bài viết thành công!");
      loadDetails(selectedCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleImportTemplates = async () => {
    if (!bulkTemplates.trim()) return;
    try {
      const templatesArray = parseCommentTemplates(bulkTemplates);
      if (templatesArray.length === 0) {
        showToast("Không tìm thấy nội dung bình luận hợp lệ.", "error");
        return;
      }
      await apiFetch(`/api/campaigns/${selectedCampaign.id}/templates`, {
        method: "POST",
        body: JSON.stringify({ templates: templatesArray })
      });
      setBulkTemplates("");
      showToast("Nhập danh sách mẫu bình luận thành công!");
      loadDetails(selectedCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const startCampaign = async (cid) => {
    try {
      const res = await apiFetch(`/api/campaigns/${cid}/start`, { method: "POST" });
      showToast("Đã kích hoạt chạy chiến dịch thành công!");
      loadDetails(selectedCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const pauseCampaign = async (cid) => {
    try {
      const res = await apiFetch(`/api/campaigns/${cid}/pause`, { method: "POST" });
      showToast("Đã tạm dừng chiến dịch.", "warning");
      loadDetails(selectedCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const stopCampaign = async (cid) => {
    try {
      const res = await apiFetch(`/api/campaigns/${cid}/stop`, { method: "POST" });
      showToast("Đã dừng và hoàn tất chiến dịch.", "error");
      loadDetails(selectedCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const duplicateCampaign = async (cid) => {
    try {
      const res = await apiFetch(`/api/campaigns/${cid}/duplicate`, { method: "POST" });
      showToast("Nhân bản chiến dịch thành công!");
      loadCampaigns();
      // Select duplicate
      const dup = { id: res.new_campaign_id };
      loadDetails(dup);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const deleteCampaign = async (cid) => {
    if (!confirm("Bạn có chắc chắn muốn xóa chiến dịch này? Tất cả các đường dẫn bài viết, nội dung bình luận và lịch sử tác vụ liên quan sẽ bị xóa vĩnh viễn.")) return;
    try {
      await apiFetch(`/api/campaigns/${cid}`, { method: "DELETE" });
      showToast("Đã xóa chiến dịch thành công.", "error");
      setSelectedCampaign(null);
      loadCampaigns();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const retryAllFailed = async (cid) => {
    try {
      const res = await apiFetch(`/api/jobs/retry-failed-campaign/${cid}`, { method: "POST" });
      showToast("Đã gửi yêu cầu chạy lại toàn bộ tác vụ thất bại!");
      loadDetails(selectedCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const getStatusText = (s) => {
    if (s === "RUNNING") return "Đang chạy";
    if (s === "COMPLETED") return "Hoàn thành";
    if (s === "PAUSED") return "Tạm dừng";
    if (s === "DRAFT") return "Bản nháp";
    if (s === "READY") return "Sẵn sàng";
    return s;
  };

  const getJobStatusText = (s) => {
    if (s === "SUCCESS") return "Thành công";
    if (s === "FAILED") return "Thất bại";
    if (s === "RUNNING") return "Đang chạy";
    if (s === "QUEUED") return "Đang xếp hàng";
    if (s === "RETRYING") return "Đang thử lại";
    if (s === "CANCELLED") return "Đã hủy";
    return s || "Chưa tạo job";
  };

  const getJobForUrl = (url) => {
    return campaignJobs.find((job) => job.url_id === url.id || job.target_url === url.url);
  };

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-6 items-start pb-8 animate-slide-in">
      
      {/* Toast notifications handler */}
      <div className="fixed top-6 right-6 z-50 space-y-3">
        {toasts.map((t) => (
          <div 
            key={t.id} 
            className={`flex items-center px-5 py-3.5 rounded-md border text-sm font-bold tracking-wide transition-all shadow-none ${
              t.type === "error" 
                ? "bg-red-50 border-red-200 text-red-600"
                : t.type === "warning"
                ? "bg-amber-50 border-amber-200 text-amber-600"
                : "bg-emerald-50 border-emerald-200 text-emerald-600"
            }`}
          >
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Left Col: Folders list */}
      <div className="lg:col-span-1 space-y-4">
        <div className="flex justify-between items-center pr-1 pl-1">
          <h3 className="text-sm font-extrabold text-gray-900 uppercase tracking-wider">Danh mục chiến dịch</h3>
          <button
            onClick={() => setShowCreateModal(true)}
            className="h-11 bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold px-4 rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
          >
            + Tạo chiến dịch mới
          </button>
        </div>

        {campaigns.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500 font-bold text-xs shadow-none">
            Chưa có chiến dịch nào được tạo. Chọn nút bên trên để khởi tạo một chiến dịch.
          </div>
        ) : (
          <div className="space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {campaigns.map((camp) => (
              <button
                key={camp.id}
                onClick={() => loadDetails(camp)}
                className={`w-full text-left p-5 rounded-lg border transition-all duration-200 cursor-pointer shadow-none ${
                  selectedCampaign?.id === camp.id
                    ? "bg-white border-[#3B82F6]/50 hover:bg-gray-50/50"
                    : "bg-gray-50 border-gray-200 hover:bg-gray-100/80"
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-extrabold text-gray-900 text-sm leading-none">{camp.name}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                    camp.status === "RUNNING"
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : camp.status === "COMPLETED"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : camp.status === "PAUSED"
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "bg-gray-100 text-gray-600 border border-gray-200"
                  }`}>
                    {getStatusText(camp.status)}
                  </span>
                </div>
                <p className="text-gray-500 text-xs font-semibold mt-2.5 truncate">{camp.description || "Không có mô tả chiến dịch."}</p>
                <div className="flex justify-between items-center text-[9px] text-gray-400 font-extrabold mt-4 pt-3 border-t border-gray-200 uppercase tracking-widest">
                  <span>Mạng xã hội: {camp.platform}</span>
                  <span>Tạo bởi: @{camp.created_by}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right Col: Details View */}
      <div className="lg:col-span-2">
        {selectedCampaign ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 space-y-6 shadow-none">
            
            {/* Title & Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-gray-200 pb-5 gap-4">
              <div>
                <div className="flex items-center space-x-2.5">
                  <h2 className="text-base font-extrabold text-gray-900 tracking-tight leading-none uppercase">{selectedCampaign.name}</h2>
                  <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${
                    selectedCampaign.platform === "X" 
                      ? "bg-blue-50 text-blue-700 border border-blue-200" 
                      : "bg-purple-50 text-purple-700 border border-purple-200"
                  }`}>
                    {selectedCampaign.platform}
                  </span>
                </div>
                <p className="text-gray-500 text-xs font-semibold mt-2">{selectedCampaign.description || "Không có mô tả chiến dịch."}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                  {selectedCampaign.status !== "RUNNING" ? (
                    <button
                      onClick={() => startCampaign(selectedCampaign.id)}
                      className="h-10 bg-[#10B981] hover:bg-emerald-600 text-white font-extrabold px-4 rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
                    >
                      ▶️ Chạy
                    </button>
                  ) : (
                    <button
                      onClick={() => pauseCampaign(selectedCampaign.id)}
                      className="h-10 bg-[#F59E0B] hover:bg-amber-600 text-white font-extrabold px-4 rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
                    >
                      ⏸️ Tạm dừng
                    </button>
                  )}
                  
                  {selectedCampaign.status === "RUNNING" && (
                    <button
                      onClick={() => stopCampaign(selectedCampaign.id)}
                      className="h-10 bg-red-500 hover:bg-red-600 text-white font-extrabold px-4 rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
                    >
                      Dừng chạy
                    </button>
                  )}

                  <button
                    onClick={() => duplicateCampaign(selectedCampaign.id)}
                    className="h-10 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 font-extrabold px-4 rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
                  >
                    Nhân bản
                  </button>
                  
                  <button
                    onClick={() => deleteCampaign(selectedCampaign.id)}
                    className="h-10 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 font-extrabold px-4 rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
                  >
                    Xóa
                  </button>
              </div>
            </div>

            {/* Campaign Metrics */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white border border-gray-200 p-4 rounded-md text-center shadow-none">
                <p className="text-[10px] font-extrabold uppercase text-gray-400 tracking-widest">Đường dẫn bài viết</p>
                <p className="text-xl font-extrabold text-gray-900 mt-1">{campaignUrls.length}</p>
              </div>
              <div className="bg-white border border-gray-200 p-4 rounded-md text-center shadow-none">
                <p className="text-[10px] font-extrabold uppercase text-gray-400 tracking-widest">Mẫu bình luận loaded</p>
                <p className="text-xl font-extrabold text-gray-900 mt-1">{campaignTemplates.length}</p>
              </div>
              <div className="bg-white border border-gray-200 p-4 rounded-md text-center shadow-none">
                <p className="text-[10px] font-extrabold uppercase text-gray-400 tracking-widest">Trạng thái chạy</p>
                <p className="text-sm font-extrabold text-[#3B82F6] mt-2.5 uppercase tracking-wider">
                  {getStatusText(selectedCampaign.status)}
                </p>
              </div>
            </div>

            {/* Split Section: Imports */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Col 1: URLs */}
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h4 className="text-xs font-extrabold uppercase tracking-widest text-gray-500">Đường dẫn bài viết (URLs)</h4>
                  <span className="text-[10px] text-gray-500 font-bold">
                    Hoàn thành {campaignUrls.filter(u => u.status === "SUCCESS").length} / {campaignUrls.length}
                  </span>
                </div>

                <div className="space-y-2">
                    <textarea
                      value={bulkUrls}
                      onChange={(e) => setBulkUrls(e.target.value)}
                      placeholder="Nhập danh sách bài viết (mỗi dòng một đường dẫn bài đăng, ví dụ: https://x.com/user/status/123)"
                      rows={3}
                      className="w-full bg-white border border-gray-200 rounded-md p-3.5 text-xs font-medium text-gray-900 focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                    />
                    {bulkUrls.trim() && (
                      <div className={`rounded-md border px-3 py-2 text-[11px] font-bold ${
                        parsedBulkUrls.length > 0
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-amber-50 border-amber-200 text-amber-700"
                      }`}>
                        Đã nhận {parsedBulkUrls.length} URL hợp lệ cho {selectedCampaign.platform}.
                      </div>
                    )}
                    <button
                      onClick={handleImportUrls}
                      disabled={Boolean(bulkUrls.trim()) && parsedBulkUrls.length === 0}
                      className="w-full h-11 bg-white hover:bg-gray-50 border border-gray-200 text-[#3B82F6] font-extrabold rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      📥 Nhập danh sách bài đăng
                    </button>
                </div>

                <div className="bg-white border border-gray-200 rounded-md p-4 max-h-56 overflow-y-auto space-y-2 shadow-none">
                  {campaignUrls.length === 0 ? (
                    <p className="text-center text-gray-400 text-xs font-bold py-6">Chưa có bài đăng nào được nhập.</p>
                  ) : (
                    campaignUrls.map((url) => {
                      const job = getJobForUrl(url);
                      const status = job?.status || url.status;
                      const accountLabel = job?.account_username 
                        ? `@${job.account_username}` 
                        : (selectedCampaign.status === "DRAFT" || selectedCampaign.status === "READY")
                        ? "Sẽ tự động gán khi chạy"
                        : "Chưa gán tài khoản";

                      return (
                        <div key={url.id} className="p-3 bg-gray-50 rounded border border-gray-200 text-[11px] shadow-none space-y-2">
                          <div className="flex justify-between items-start gap-3">
                            <a
                              href={url.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-w-0 flex-1 truncate text-[#3B82F6] hover:text-blue-700 hover:underline font-mono font-extrabold"
                              title={url.url}
                            >
                              {url.url}
                            </a>
                            <span className={`shrink-0 px-2 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                              status === "SUCCESS"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : status === "FAILED"
                                ? "bg-red-50 text-red-700 border border-red-200"
                                : status === "RUNNING" || status === "PROCESSING"
                                ? "bg-blue-50 text-blue-700 border border-blue-200 animate-pulse"
                                : status === "QUEUED" || status === "RETRYING"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-gray-100 text-gray-600 border border-gray-200"
                            }`}>
                              {getJobStatusText(status)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-2 text-[10px]">
                            <span className="font-extrabold text-gray-700">
                              Người xử lý: <span className="text-gray-900">{accountLabel}</span>
                            </span>
                            {job?.real_api && (
                              <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-extrabold uppercase text-emerald-700">
                                Cookie that
                              </span>
                            )}
                            {job ? (
                              <span className="font-bold text-gray-500">
                                Thử {job.attempt_count}/3
                              </span>
                            ) : (
                              <span className="font-bold text-gray-400">Job sẽ tạo khi chạy campaign</span>
                            )}
                          </div>

                          {job?.error_message && (
                            <p className="text-[10px] font-mono text-red-600 truncate" title={job.error_message}>
                              Lỗi: {job.error_message}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Col 2: Comment Templates */}
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h4 className="text-xs font-extrabold uppercase tracking-widest text-gray-500">Mẫu nội dung bình luận</h4>
                  <span className="text-[10px] text-gray-500 font-bold">Đã tải {campaignTemplates.length}</span>
                </div>

                <div className="space-y-2">
                    <textarea
                      value={bulkTemplates}
                      onChange={(e) => setBulkTemplates(e.target.value)}
                      placeholder="Nhập nội dung bình luận (mỗi dòng một nội dung bình luận khác nhau)"
                      rows={3}
                      className="w-full bg-white border border-gray-200 rounded-md p-3.5 text-xs font-medium text-gray-900 focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                    />
                    {bulkTemplates.trim() && (
                      <div className={`rounded-md border px-3 py-2 text-[11px] font-bold ${
                        parsedBulkTemplates.length > 0
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-amber-50 border-amber-200 text-amber-700"
                      }`}>
                        Đã nhận {parsedBulkTemplates.length} mẫu bình luận.
                      </div>
                    )}
                    <button
                      onClick={handleImportTemplates}
                      disabled={Boolean(bulkTemplates.trim()) && parsedBulkTemplates.length === 0}
                      className="w-full h-11 bg-white hover:bg-gray-50 border border-gray-200 text-[#3B82F6] font-extrabold rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      📥 Nhập danh sách nội dung
                    </button>
                </div>

                <div className="bg-white border border-gray-200 rounded-md p-4 max-h-56 overflow-y-auto space-y-2 shadow-none">
                  {campaignTemplates.length === 0 ? (
                    <p className="text-center text-gray-400 text-xs font-bold py-6">Chưa có mẫu bình luận nào được nhập.</p>
                  ) : (
                    campaignTemplates.map((tpl) => (
                      <div key={tpl.id} className="p-3 bg-gray-50 rounded border border-gray-200 text-[11px] text-gray-600 font-bold truncate shadow-none">
                        "{tpl.content}"
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

            {/* Campaign warnings / error retries */}
            {campaignUrls.some(u => u.status === "FAILED") && (
              <div className="bg-red-50 border border-red-200 text-red-600 p-5 rounded-md text-xs font-bold flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-none">
                <div>
                  <p>⚠️ Chú ý: Một số tác vụ bình luận trong chiến dịch này đã gặp lỗi</p>
                  <p className="text-gray-500 text-[11px] font-semibold mt-1">Lỗi có thể xuất phát từ việc mất kết nối API mạng xã hội hoặc tài khoản bị giới hạn tần suất. Bạn có thể kích hoạt thử lại toàn bộ.</p>
                </div>
                <button
                  onClick={() => retryAllFailed(selectedCampaign.id)}
                  className="h-10 bg-red-600 hover:bg-red-700 text-white font-extrabold px-4 rounded-md text-[11px] transition-all duration-200 hover:scale-105 cursor-pointer shrink-0 shadow-none"
                >
                  Thử lại các tác vụ lỗi
                </button>
              </div>
            )}

          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center text-gray-500 font-bold text-xs h-64 flex flex-col justify-center items-center shadow-none">
            <svg className="w-12 h-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5M5 19v-2a2 2 0 002-2h2a2 2 0 002-2V5" />
            </svg>
            <span>Chọn một chiến dịch ở danh mục thư mục bên trái để cấu hình danh sách đường dẫn bài viết, nội dung bình luận và kích hoạt tiến trình chạy.</span>
          </div>
        )}
      </div>

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-gray-200 rounded-lg max-w-md w-full p-8 space-y-5 shadow-none animate-slide-up">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="text-base font-extrabold text-gray-900 uppercase tracking-tight">Tạo chiến dịch mới</h3>
              <button 
                onClick={() => setShowCreateModal(false)} 
                className="text-gray-400 hover:text-gray-900 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleCreate} className="space-y-4 text-xs font-bold text-gray-600">
              <div>
                <label className="block mb-1.5 ml-0.5">Tên chiến dịch</label>
                <input
                  type="text"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  placeholder="Ví dụ: Chiến dịch quảng cáo Threads 2026"
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                  required
                />
              </div>
              
              <div>
                <label className="block mb-1.5 ml-0.5">Nền tảng mạng xã hội</label>
                <select
                  value={newCampaignPlatform}
                  onChange={(e) => setNewCampaignPlatform(e.target.value)}
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-3 text-xs font-bold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                >
                  <option value="X">X (Twitter)</option>
                  <option value="Threads">Threads</option>
                </select>
              </div>

              <div>
                <label className="block mb-1.5 ml-0.5">Mô tả chiến dịch</label>
                <textarea
                  value={newCampaignDesc}
                  onChange={(e) => setNewCampaignDesc(e.target.value)}
                  placeholder="Mô tả mục tiêu chiến dịch..."
                  rows={3}
                  className="w-full bg-gray-100 border border-gray-200 rounded-md p-3.5 text-xs font-medium text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                />
              </div>

              <button
                type="submit"
                className="w-full h-12 bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
              >
                Tạo chiến dịch
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
