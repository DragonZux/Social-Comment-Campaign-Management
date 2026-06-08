"use client";

import { useState, useEffect, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

const collectStrings = (value) => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
};

const uniqueList = (items: string[]): string[] => Array.from(new Set(items));

const formatVietnamDateTime = (value) => {
  if (!value) return "";
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
  });
};

const extractMonitorPageUrlsFromText = (value, platform) => {
  const raw = (value || "").trim();
  if (!raw) return [];

  let source = raw;
  try {
    source = collectStrings(JSON.parse(raw)).join("\n");
  } catch (err) {
    source = raw;
  }

  const urlMatches = source.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com|threads\.net|threads\.com)\/[^\s"'<>]+/gi) || [];
  const normalized = urlMatches
    .map((url) => url.replace(/[),.;\]]+$/, ""))
    .map((url) => (url.startsWith("http") ? url : `https://${url}`))
    .map((url) => {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
        const firstSegment = parsed.pathname.split("/").filter(Boolean)[0] || "";
        const username = firstSegment.replace(/^@/, "");
        if (!username) return "";
        if ((host === "x.com" || host === "twitter.com") && platform === "X") {
          return `https://x.com/${username}`;
        }
        if ((host === "threads.net" || host === "threads.com") && platform === "Threads") {
          return `https://www.threads.net/@${username}`;
        }
      } catch (err) {
        return "";
      }
      return "";
    })
    .filter(Boolean);

  return uniqueList(normalized);
};

const extractUrlsFromText = (value, platform) => {
  const raw = (value || "").trim();
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
    .map((url) => url.replace(/^https:\/\/threads\.com\//i, "https://www.threads.com/"))
    .map((url) => url.replace(/^https:\/\/threads\.net\//i, "https://www.threads.net/"))
    .filter((url) => {
      if (platform === "X") return /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(url);
      if (platform === "Threads") return /https?:\/\/(?:www\.)?threads\.(?:net|com)\//i.test(url);
      return true;
    });

  return uniqueList(normalized);
};

const parseCommentTemplates = (value) => {
  const raw = (value || "").trim();
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
  const [platformAccounts, setPlatformAccounts] = useState([]);
  
  // Form and Modal States
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignPlatform, setNewCampaignPlatform] = useState("X");
  const [newCampaignDesc, setNewCampaignDesc] = useState("");
  const [newCampaignType, setNewCampaignType] = useState("STATIC");
  const [newMonitorPageUrl, setNewMonitorPageUrl] = useState("");
  const [newMonitorInterval, setNewMonitorInterval] = useState(15);
  const [newRepeatEnabled, setNewRepeatEnabled] = useState(false);
  const [newRepeatInterval, setNewRepeatInterval] = useState(60);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [bulkUrls, setBulkUrls] = useState("");
  const [bulkTemplates, setBulkTemplates] = useState("");

  const [toasts, setToasts] = useState([]);
  const selectedCampaignIdRef = useRef(null);
  const parsedBulkUrls = extractUrlsFromText(bulkUrls, selectedCampaign?.platform);
  const parsedBulkTemplates = parseCommentTemplates(bulkTemplates);
  const parsedNewMonitorPageUrls = extractMonitorPageUrlsFromText(newMonitorPageUrl, newCampaignPlatform);
  const selectedMonitorPageUrls = selectedCampaign
    ? extractMonitorPageUrlsFromText(
        (selectedCampaign.monitor_page_urls && selectedCampaign.monitor_page_urls.length > 0)
          ? selectedCampaign.monitor_page_urls.join("\n")
          : selectedCampaign.monitor_page_url || "",
        selectedCampaign.platform
      )
    : [];

  const showToast = (message, type = "success") => {
    const id = `${Date.now()}-${Math.random()}`;
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
    selectedCampaignIdRef.current = campaign.id;
    try {
      const updated = await apiFetch(`/api/campaigns/${campaign.id}`);
      if (selectedCampaignIdRef.current !== campaign.id) return;
      setSelectedCampaign(updated);
      
      const urls = await apiFetch(`/api/campaigns/${campaign.id}/urls`);
      if (selectedCampaignIdRef.current !== campaign.id) return;
      setCampaignUrls(urls);
      
      const tpls = await apiFetch(`/api/campaigns/${campaign.id}/templates`);
      if (selectedCampaignIdRef.current !== campaign.id) return;
      setCampaignTemplates(tpls);
      
      const jobs = await apiFetch(`/api/jobs?campaign_id=${campaign.id}`);
      if (selectedCampaignIdRef.current !== campaign.id) return;
      setCampaignJobs(jobs);
      
      // Load accounts for the campaign's platform
      const accs = await apiFetch(`/api/accounts?platform=${updated.platform}`);
      if (selectedCampaignIdRef.current !== campaign.id) return;
      setPlatformAccounts(accs);
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
    const campaignId = selectedCampaign.id;
    let active = true;
    
    const refreshData = async () => {
      try {
        const updated = await apiFetch(`/api/campaigns/${campaignId}`);
        if (!active) return;
        setSelectedCampaign(updated);
        
        const urls = await apiFetch(`/api/campaigns/${campaignId}/urls`);
        if (!active) return;
        setCampaignUrls(urls);
        
        const tpls = await apiFetch(`/api/campaigns/${campaignId}/templates`);
        if (!active) return;
        setCampaignTemplates(tpls);
        
        const jobs = await apiFetch(`/api/jobs?campaign_id=${campaignId}`);
        if (!active) return;
        setCampaignJobs(jobs);
      } catch (err) {
        console.warn("Poll details error:", err);
      }
    };

    const timer = setInterval(refreshData, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selectedCampaign?.id]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      if (newCampaignType === "MONITOR" && parsedNewMonitorPageUrls.length === 0) {
        showToast("Vui lòng nhập ít nhất một link profile/page hợp lệ để giám sát.", "error");
        return;
      }
      const res = await apiFetch("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: newCampaignName,
          platform: newCampaignPlatform,
          description: newCampaignDesc,
          campaign_type: newCampaignType,
          monitor_page_url: newCampaignType === "MONITOR" ? parsedNewMonitorPageUrls[0] : null,
          monitor_page_urls: newCampaignType === "MONITOR" ? parsedNewMonitorPageUrls : [],
          monitor_interval: newCampaignType === "MONITOR" ? newMonitorInterval : null,
          repeat_enabled: newCampaignType === "STATIC" ? newRepeatEnabled : false,
          repeat_interval_minutes: newCampaignType === "STATIC" && newRepeatEnabled ? newRepeatInterval : null,
        })
      });
      showToast("Tạo chiến dịch thành công!");
      setNewCampaignName("");
      setNewCampaignDesc("");
      setNewCampaignType("STATIC");
      setNewMonitorPageUrl("");
      setNewMonitorInterval(15);
      setNewRepeatEnabled(false);
      setNewRepeatInterval(60);
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
    if (selectedCampaign?.campaign_type !== "MONITOR" && campaignUrls.length === 0) {
      showToast("Vui lòng nhập ít nhất một link bài viết trước khi chạy chiến dịch.", "error");
      return;
    }
    if (selectedCampaign?.campaign_type === "MONITOR" && selectedMonitorPageUrls.length === 0) {
      showToast("Vui lòng nhập ít nhất một link profile/page cần giám sát trước khi chạy chiến dịch.", "error");
      return;
    }
    if (campaignTemplates.length === 0) {
      showToast("Vui lòng nhập ít nhất một nội dung comment trước khi chạy chiến dịch.", "error");
      return;
    }
    try {
      await apiFetch(`/api/campaigns/${cid}/start`, { method: "POST" });
      showToast("Đã kích hoạt chạy chiến dịch thành công!");
      loadDetails(selectedCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const pauseCampaign = async (cid) => {
    try {
      await apiFetch(`/api/campaigns/${cid}/pause`, { method: "POST" });
      showToast("Đã tạm dừng chiến dịch.", "warning");
      loadDetails(selectedCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const stopCampaign = async (cid) => {
    try {
      await apiFetch(`/api/campaigns/${cid}/stop`, { method: "POST" });
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
      await apiFetch(`/api/jobs/retry-failed-campaign/${cid}`, { method: "POST" });
      showToast("Đã gửi yêu cầu chạy lại toàn bộ tác vụ thất bại!");
      loadDetails(selectedCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const assignAccountToUrl = async (urlId, accountId) => {
    try {
      await apiFetch(`/api/campaigns/${selectedCampaign.id}/urls/${urlId}/assign-account`, {
        method: "PUT",
        body: JSON.stringify({ account_id: accountId || null })
      });
      showToast(accountId ? "Đã gán tài khoản cho bài viết!" : "Đã bỏ gán tài khoản.");
      // Refresh URLs to get updated assignment
      const urls = await apiFetch(`/api/campaigns/${selectedCampaign.id}/urls`);
      setCampaignUrls(urls);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const assignAccountToAll = async (accountId) => {
    try {
      await apiFetch(`/api/campaigns/${selectedCampaign.id}/urls/assign-account-all`, {
        method: "PUT",
        body: JSON.stringify({ account_id: accountId || null })
      });
      showToast(accountId ? "Đã gán tài khoản cho tất cả bài viết!" : "Đã bỏ gán tất cả.");
      const urls = await apiFetch(`/api/campaigns/${selectedCampaign.id}/urls`);
      setCampaignUrls(urls);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const getStatusText = (s) => {
    if (s === "RUNNING") return "Đang chạy";
    if (s === "COMPLETED") return "Hoàn thành";
    if (s === "STOPPED") return "Đã dừng";
    if (s === "FAILED") return "Thất bại";
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

  const getJobsForUrl = (url) => {
    return campaignJobs
      .filter((job) => job.url_id === url.id || job.target_url === url.url)
      .sort((a, b) => new Date(a.scheduled_time || a.completed_at || 0).getTime() - new Date(b.scheduled_time || b.completed_at || 0).getTime());
  };

  const getStatusForUrlJobs = (jobs, urlStatus) => {
    if (jobs.length === 0) return urlStatus;
    if (jobs.some((job) => job.status === "RUNNING")) return "RUNNING";
    if (jobs.some((job) => job.status === "QUEUED")) return "QUEUED";
    if (jobs.some((job) => job.status === "RETRYING")) return "RETRYING";
    if (jobs.some((job) => job.status === "FAILED")) return "FAILED";
    if (jobs.every((job) => job.status === "SUCCESS")) return "SUCCESS";
    return jobs[jobs.length - 1]?.status || urlStatus;
  };

  const updateRepeatSchedule = async (payload) => {
    try {
      await apiFetch(`/api/campaigns/${selectedCampaign.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      showToast("Cập nhật lịch chạy lặp lại thành công!");
      const updated = await apiFetch(`/api/campaigns/${selectedCampaign.id}`);
      setSelectedCampaign(updated);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="h-full grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start pb-8 animate-slide-in">
      
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
      <div className="space-y-3 min-w-0">
        <div className="flex justify-between items-center gap-2 pr-1 pl-1">
          <h3 className="text-xs font-extrabold text-gray-900 uppercase tracking-wider leading-tight">Danh mục chiến dịch</h3>
          <button
            onClick={() => setShowCreateModal(true)}
            className="h-9 bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold px-3 rounded-md text-[10px] transition-all duration-200 hover:scale-105 cursor-pointer shadow-none shrink-0"
          >
            + Tạo mới
          </button>
        </div>

        {campaigns.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500 font-bold text-xs shadow-none">
            Chưa có chiến dịch nào được tạo. Chọn nút bên trên để khởi tạo một chiến dịch.
          </div>
        ) : (
          <div className="space-y-2 max-h-[calc(100vh-205px)] overflow-y-auto pr-1">
            {campaigns.map((camp) => (
              <button
                key={camp.id}
                onClick={() => loadDetails(camp)}
                className={`w-full text-left p-3 rounded-md border transition-all duration-200 cursor-pointer shadow-none ${
                  selectedCampaign?.id === camp.id
                    ? "bg-white border-[#3B82F6]/50 hover:bg-gray-50/50"
                    : "bg-gray-50 border-gray-200 hover:bg-gray-100/80"
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <span className="min-w-0 truncate font-extrabold text-gray-900 text-xs leading-5">{camp.name}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                    camp.status === "RUNNING"
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : camp.status === "COMPLETED"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : camp.status === "FAILED"
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : camp.status === "STOPPED"
                      ? "bg-slate-100 text-slate-700 border border-slate-200"
                      : camp.status === "PAUSED"
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "bg-gray-100 text-gray-600 border border-gray-200"
                  }`}>
                    {getStatusText(camp.status)}
                  </span>
                </div>
                <p className="text-gray-500 text-[11px] font-semibold mt-1.5 truncate">{camp.description || "Không có mô tả chiến dịch."}</p>
                <div className="flex justify-between items-center gap-2 text-[8px] text-gray-400 font-extrabold mt-2.5 pt-2 border-t border-gray-200 uppercase tracking-widest">
                  <span className="truncate">{camp.platform}</span>
                  <span className="truncate">@{camp.created_by}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right Col: Details View */}
      <div className="min-w-0">
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

            {/* Campaign Configuration Panel (Editable when DRAFT, READY, PAUSED) */}
            {(selectedCampaign.status === "DRAFT" || selectedCampaign.status === "READY" || selectedCampaign.status === "PAUSED") ? (
              <div className="bg-white border border-gray-200 p-5 rounded-md text-xs font-bold text-gray-600 space-y-4 shadow-none">
                <h4 className="text-xs font-extrabold uppercase tracking-widest text-gray-500 border-b pb-2">Cấu hình giám sát & Thông tin</h4>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block mb-1.5 ml-0.5 text-gray-500">Loại chiến dịch</label>
                    <select
                      value={selectedCampaign.campaign_type || "STATIC"}
                      onChange={async (e) => {
                        const newType = e.target.value;
                        try {
                          await apiFetch(`/api/campaigns/${selectedCampaign.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ campaign_type: newType })
                          });
                          showToast("Cập nhật loại chiến dịch thành công!");
                          const updated = await apiFetch(`/api/campaigns/${selectedCampaign.id}`);
                          setSelectedCampaign(updated);
                        } catch (err: any) {
                          showToast(err.message, "error");
                        }
                      }}
                      className="w-full h-10 bg-gray-55 border border-gray-200 rounded px-3 text-xs font-bold text-gray-900 focus:bg-white focus:outline-none cursor-pointer"
                    >
                      <option value="STATIC">Thủ công (Nhập bài đăng trực tiếp)</option>
                      <option value="MONITOR">Tự động (Giám sát trang bài viết mới nhất)</option>
                    </select>
                  </div>

                  {selectedCampaign.campaign_type === "MONITOR" && (
                    <div>
                      <label className="block mb-1.5 ml-0.5 text-gray-500">Tần suất kiểm tra</label>
                      <select
                        value={selectedCampaign.monitor_interval || 15}
                        onChange={async (e) => {
                          const newInt = Number(e.target.value);
                          try {
                            await apiFetch(`/api/campaigns/${selectedCampaign.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ monitor_interval: newInt })
                            });
                            showToast("Cập nhật tần suất kiểm tra thành công!");
                            const updated = await apiFetch(`/api/campaigns/${selectedCampaign.id}`);
                            setSelectedCampaign(updated);
                          } catch (err: any) {
                            showToast(err.message, "error");
                          }
                        }}
                        className="w-full h-10 bg-gray-55 border border-gray-200 rounded px-3 text-xs font-bold text-gray-900 focus:bg-white focus:outline-none cursor-pointer"
                      >
                        <option value={1}>1 phút (Để test nhanh)</option>
                        <option value={5}>5 phút</option>
                        <option value={15}>15 phút</option>
                        <option value={30}>30 phút</option>
                        <option value={60}>1 giờ</option>
                      </select>
                    </div>
                  )}

                  {selectedCampaign.campaign_type !== "MONITOR" && (
                    <div>
                      <label className="block mb-1.5 ml-0.5 text-gray-500">Lịch chạy lặp lại</label>
                      <select
                        value={selectedCampaign.repeat_enabled ? String(selectedCampaign.repeat_interval_minutes || 60) : "off"}
                        onChange={(e) => {
                          if (e.target.value === "off") {
                            updateRepeatSchedule({ repeat_enabled: false });
                            return;
                          }
                          updateRepeatSchedule({
                            repeat_enabled: true,
                            repeat_interval_minutes: Number(e.target.value)
                          });
                        }}
                        className="w-full h-10 bg-gray-55 border border-gray-200 rounded px-3 text-xs font-bold text-gray-900 focus:bg-white focus:outline-none cursor-pointer"
                      >
                        <option value="off">Không tự chạy lại</option>
                        <option value={5}>Mỗi 5 phút</option>
                        <option value={15}>Mỗi 15 phút</option>
                        <option value={30}>Mỗi 30 phút</option>
                        <option value={60}>Mỗi 1 giờ</option>
                        <option value={360}>Mỗi 6 giờ</option>
                        <option value={1440}>Mỗi ngày</option>
                      </select>
                      {selectedCampaign.repeat_enabled && (
                        <p className="mt-1.5 text-[10px] font-bold text-gray-400">
                          Lần chạy kế tiếp: {selectedCampaign.next_run_at ? formatVietnamDateTime(selectedCampaign.next_run_at) : "sau khi vòng hiện tại hoàn tất"}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {selectedCampaign.campaign_type === "MONITOR" && (
                  <div>
                    <label className="block mb-1.5 ml-0.5 text-gray-500">Link trang cần giám sát</label>
                    <textarea
                      key={selectedCampaign.id}
                      placeholder={selectedCampaign.platform === "X" ? "Ví dụ: https://x.com/elonmusk" : "Ví dụ: https://www.threads.net/@zuck"}
                      defaultValue={selectedMonitorPageUrls.join("\n")}
                      rows={4}
                      onBlur={async (e) => {
                        const urls = extractMonitorPageUrlsFromText(e.target.value, selectedCampaign.platform);
                        if (urls.join("\n") === selectedMonitorPageUrls.join("\n")) return;
                        if (urls.length === 0) {
                          showToast("Vui lòng nhập ít nhất một link profile/page hợp lệ để giám sát.", "error");
                          return;
                        }
                        try {
                          await apiFetch(`/api/campaigns/${selectedCampaign.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              monitor_page_url: urls[0] || null,
                              monitor_page_urls: urls,
                            })
                          });
                          showToast("Cập nhật link trang giám sát thành công!");
                          const updated = await apiFetch(`/api/campaigns/${selectedCampaign.id}`);
                          setSelectedCampaign(updated);
                        } catch (err: any) {
                          showToast(err.message, "error");
                        }
                      }}
                      className="w-full bg-gray-55 border border-gray-200 rounded px-3 py-2 text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none resize-none"
                    />
                    <p className="mt-1.5 text-[10px] font-bold text-gray-400">Mỗi dòng một profile/page link. Đã nhận {selectedMonitorPageUrls.length} link giám sát.</p>
                  </div>
                )}
              </div>
            ) : (
              selectedCampaign.campaign_type === "MONITOR" && (
                <div className="bg-white border border-gray-200 p-5 rounded-md text-xs font-bold text-gray-600 space-y-2 shadow-none">
                  <h4 className="text-xs font-extrabold uppercase tracking-widest text-gray-500 border-b pb-2">Thông tin giám sát trang</h4>
                  <p className="text-gray-700">Loại chiến dịch: <span className="text-gray-900 font-extrabold">Tự động (Giám sát trang)</span></p>
                  <div className="text-gray-700">
                    <p>Trang giám sát: <span className="text-gray-900 font-extrabold">{selectedMonitorPageUrls.length} link</span></p>
                    <div className="mt-1 space-y-1">
                      {selectedMonitorPageUrls.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block truncate text-[#3B82F6] hover:underline font-mono">{url}</a>
                      ))}
                    </div>
                  </div>
                  <p className="text-gray-700">Tần suất kiểm tra: <span className="text-gray-900 font-extrabold">{selectedCampaign.monitor_interval} phút</span></p>
                  {selectedCampaign.last_monitored_at && (
                    <p className="text-gray-400 text-[10px]">Lần quét gần nhất: {formatVietnamDateTime(selectedCampaign.last_monitored_at)}</p>
                  )}
                </div>
              )
            )}

            {selectedCampaign.campaign_type !== "MONITOR" &&
              !["DRAFT", "READY", "PAUSED"].includes(selectedCampaign.status) && (
                <div className="bg-white border border-gray-200 p-5 rounded-md text-xs font-bold text-gray-600 space-y-3 shadow-none">
                  <h4 className="text-xs font-extrabold uppercase tracking-widest text-gray-500 border-b pb-2">Lịch chạy lặp lại</h4>
                  <select
                    value={selectedCampaign.repeat_enabled ? String(selectedCampaign.repeat_interval_minutes || 60) : "off"}
                    onChange={(e) => {
                      if (e.target.value === "off") {
                        updateRepeatSchedule({ repeat_enabled: false });
                        return;
                      }
                      updateRepeatSchedule({
                        repeat_enabled: true,
                        repeat_interval_minutes: Number(e.target.value)
                      });
                    }}
                    className="w-full h-10 bg-gray-55 border border-gray-200 rounded px-3 text-xs font-bold text-gray-900 focus:bg-white focus:outline-none cursor-pointer"
                  >
                    <option value="off">Không tự chạy lại</option>
                    <option value={5}>Mỗi 5 phút</option>
                    <option value={15}>Mỗi 15 phút</option>
                    <option value={30}>Mỗi 30 phút</option>
                    <option value={60}>Mỗi 1 giờ</option>
                    <option value={360}>Mỗi 6 giờ</option>
                    <option value={1440}>Mỗi ngày</option>
                  </select>
                  {selectedCampaign.repeat_enabled && (
                    <p className="text-[10px] font-bold text-gray-400">
                      Lần chạy kế tiếp: {selectedCampaign.next_run_at ? formatVietnamDateTime(selectedCampaign.next_run_at) : "sau khi vòng hiện tại hoàn tất"}
                    </p>
                  )}
                </div>
              )}

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

                {selectedCampaign.campaign_type === "MONITOR" ? (
                  <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-md text-xs font-bold shadow-none">
                    <p className="flex items-center gap-1.5">📢 Chiến dịch tự động giám sát trang</p>
                    <p className="text-gray-500 font-semibold mt-1">Các bài đăng mới phát hiện sẽ tự động được quét và đưa vào danh sách xử lý dưới đây.</p>
                  </div>
                ) : (
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
                )}

                <div className="bg-white border border-gray-200 rounded-md p-4 max-h-80 overflow-y-auto space-y-2 shadow-none">
                  {campaignUrls.length === 0 ? (
                    <p className="text-center text-gray-400 text-xs font-bold py-6">Chưa có bài đăng nào được nhập.</p>
                  ) : (
                    <>
                      {/* Assign All Accounts Dropdown */}
                      {platformAccounts.length > 0 && (selectedCampaign.status === "DRAFT" || selectedCampaign.status === "READY" || selectedCampaign.status === "PAUSED") && (
                        <div className="flex items-center gap-2 p-3 bg-blue-50 rounded border border-blue-200 mb-3">
                          <span className="text-[11px] font-extrabold text-blue-700 whitespace-nowrap">Gán tất cả:</span>
                          <select
                            onChange={(e) => assignAccountToAll(e.target.value)}
                            className="flex-1 h-8 bg-white border border-blue-200 rounded px-2 text-[11px] font-bold text-gray-900 focus:border-blue-400 focus:outline-none cursor-pointer"
                            defaultValue=""
                          >
                            <option value="">— Bỏ gán tất cả —</option>
                            {platformAccounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                @{acc.username} {acc.status !== "ACTIVE" ? `(${acc.status})` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {campaignUrls.map((url) => {
                        const jobsForUrl = getJobsForUrl(url);
                        const job = jobsForUrl[jobsForUrl.length - 1];
                        const successJobs = jobsForUrl.filter((item) => item.status === "SUCCESS");
                        const status = getStatusForUrlJobs(jobsForUrl, url.status);
                        const isEditable = selectedCampaign.status === "DRAFT" || selectedCampaign.status === "READY" || selectedCampaign.status === "PAUSED";
                        const accountLabel = job?.account_username 
                          ? `@${job.account_username}` 
                          : url.assigned_account_username
                          ? `@${url.assigned_account_username}`
                          : (selectedCampaign.status === "DRAFT" || selectedCampaign.status === "READY")
                          ? "Tự động gán (round-robin)"
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
                              {url.monitor_source_url && (
                                <span className="w-full truncate font-bold text-gray-500">
                                  Nguồn giám sát: <a href={url.monitor_source_url} target="_blank" rel="noopener noreferrer" className="text-[#3B82F6] hover:underline font-mono">{url.monitor_source_url}</a>
                                </span>
                              )}
                              {isEditable && platformAccounts.length > 0 ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="font-extrabold text-gray-700 whitespace-nowrap">Người xử lý:</span>
                                  <select
                                    value={url.assigned_account_id || ""}
                                    onChange={(e) => assignAccountToUrl(url.id, e.target.value)}
                                    className={`h-7 border rounded px-1.5 text-[10px] font-bold cursor-pointer focus:outline-none focus:border-blue-400 transition-all ${
                                      url.assigned_account_id
                                        ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                                        : "bg-white border-gray-200 text-gray-600"
                                    }`}
                                  >
                                    <option value="">🔄 Tự động (round-robin)</option>
                                    {platformAccounts.map((acc) => (
                                      <option key={acc.id} value={acc.id}>
                                        @{acc.username} {acc.status !== "ACTIVE" ? `(${acc.status})` : ""}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <span className="font-extrabold text-gray-700">
                                  Người xử lý: <span className="text-gray-900">{accountLabel}</span>
                                </span>
                              )}
                              {job?.real_api && (
                                <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-extrabold uppercase text-emerald-700">
                                  Cookie thật
                                </span>
                              )}
                              {job ? (
                                <span className="font-bold text-gray-500">
                                  Tác vụ {successJobs.length}/{jobsForUrl.length} - Thử {job.attempt_count}/3
                                </span>
                              ) : (
                                <span className="font-bold text-gray-400">Job sẽ tạo khi chạy campaign</span>
                              )}
                            </div>

                            {successJobs.length > 0 && (
                              <div className="mt-1.5 bg-white border border-gray-100 rounded p-2 text-gray-700 font-semibold shadow-none text-[10px] space-y-1">
                                <span className="font-extrabold text-gray-400 block text-[9px] uppercase tracking-wider mb-0.5">Nội dung đã comment:</span>
                                {successJobs.map((item, index) => (
                                  <div key={item.id || `${url.id}-${index}`} className="truncate" title={item.commented_text || item.template_content || ""}>
                                    {index + 1}. "{item.commented_text || item.template_content}"
                                  </div>
                                ))}
                              </div>
                            )}

                            {jobsForUrl.filter((item) => item.error_message).map((item, index) => (
                              <p key={`${item.id || url.id}-err-${index}`} className="text-[10px] font-mono text-red-600 truncate mt-1" title={item.error_message}>
                                Lỗi: {item.error_message}
                              </p>
                            ))}
                          </div>
                        );
                      })}
                    </>
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
                <label className="block mb-1.5 ml-0.5">Loại chiến dịch</label>
                <select
                  value={newCampaignType}
                  onChange={(e) => setNewCampaignType(e.target.value)}
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-3 text-xs font-bold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                >
                  <option value="STATIC">Thủ công (Nhập danh sách bài viết trực tiếp)</option>
                  <option value="MONITOR">Tự động (Giám sát trang và lấy bài viết mới nhất)</option>
                </select>
              </div>

              {newCampaignType === "MONITOR" && (
                <>
                  <div>
                    <label className="block mb-1.5 ml-0.5">Link trang cần giám sát (Profile/Page Links)</label>
                    <textarea
                      value={newMonitorPageUrl}
                      onChange={(e) => setNewMonitorPageUrl(e.target.value)}
                      placeholder={newCampaignPlatform === "X" ? "Mỗi dòng một link, ví dụ:\nhttps://x.com/elonmusk\nhttps://x.com/openai" : "Mỗi dòng một link, ví dụ:\nhttps://www.threads.net/@zuck\nhttps://www.threads.net/@bbc"}
                      rows={4}
                      className="w-full bg-gray-100 border border-gray-200 rounded-md p-3.5 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                      required
                    />
                    {newMonitorPageUrl.trim() && (
                      <p className={`mt-1.5 text-[10px] font-bold ${parsedNewMonitorPageUrls.length > 0 ? "text-emerald-600" : "text-amber-600"}`}>
                        Đã nhận {parsedNewMonitorPageUrls.length} link giám sát hợp lệ cho {newCampaignPlatform}.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block mb-1.5 ml-0.5">Tần suất kiểm tra</label>
                    <select
                      value={newMonitorInterval}
                      onChange={(e) => setNewMonitorInterval(Number(e.target.value))}
                      className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-3 text-xs font-bold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                    >
                      <option value={1}>1 phút (Để test nhanh)</option>
                      <option value={5}>5 phút</option>
                      <option value={15}>15 phút</option>
                      <option value={30}>30 phút</option>
                      <option value={60}>1 giờ</option>
                    </select>
                  </div>
                </>
              )}

              {newCampaignType === "STATIC" && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3">
                  <label className="flex items-center gap-2 text-xs font-extrabold text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newRepeatEnabled}
                      onChange={(e) => setNewRepeatEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-[#3B82F6] cursor-pointer"
                    />
                    <span>Tự chạy lại chiến dịch theo chu kỳ</span>
                  </label>
                  {newRepeatEnabled && (
                    <select
                      value={newRepeatInterval}
                      onChange={(e) => setNewRepeatInterval(Number(e.target.value))}
                      className="w-full h-10 bg-white border border-gray-200 rounded-md px-3 text-xs font-bold text-gray-900 focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                    >
                      <option value={5}>Mỗi 5 phút</option>
                      <option value={15}>Mỗi 15 phút</option>
                      <option value={30}>Mỗi 30 phút</option>
                      <option value={60}>Mỗi 1 giờ</option>
                      <option value={360}>Mỗi 6 giờ</option>
                      <option value={1440}>Mỗi ngày</option>
                    </select>
                  )}
                </div>
              )}

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
