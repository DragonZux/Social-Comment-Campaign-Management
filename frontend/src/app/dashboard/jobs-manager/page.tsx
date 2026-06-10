"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Pagination from "../../../components/Pagination";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

interface Job {
  id: string;
  campaign_id: string;
  account_id: string;
  url_id: string;
  template_id: string;
  platform?: string;
  status: string;
  attempt_count: number;
  scheduled_time?: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  account_username?: string;
  target_url?: string;
  template_content?: string;
}

export default function JobsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignIdParam = searchParams.get("campaign_id");

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: "success" | "error" }>>([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [campaignId, setCampaignId] = useState(campaignIdParam || "");
  const [status, setStatus] = useState<string>("");
  const [attemptMin, setAttemptMin] = useState<number | "">("");
  const [attemptMax, setAttemptMax] = useState<number | "">("");
  const [hasError, setHasError] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  useEffect(() => {
    searchJobs();
  }, [currentPage, limit]);

  const searchJobs = async () => {
    try {
      setLoading(true);
      const token = sessionStorage.getItem("campaign_token");

      const params = new URLSearchParams();
      if (campaignId) params.append("campaign_id", campaignId);
      if (status) params.append("status", status);
      if (attemptMin !== "") params.append("attempt_count_min", String(attemptMin));
      if (attemptMax !== "") params.append("attempt_count_max", String(attemptMax));
      if (hasError !== "") params.append("has_error", hasError === "true" ? "true" : "false");
      params.append("page", String(currentPage));
      params.append("limit", String(limit));

      const url = new URL(`${API_BASE}/api/jobs/search/advanced`);
      url.search = params.toString();

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Lỗi tìm kiếm jobs");
      const data = await res.json();
      if (data && data.items) {
        setJobs(data.items);
        setTotalItems(data.total);
        setTotalPages(data.pages);
      } else {
        setJobs(Array.isArray(data) ? data : []);
        setTotalItems(Array.isArray(data) ? data.length : 0);
        setTotalPages(1);
      }
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSearchClick = () => {
    if (currentPage === 1) {
      searchJobs();
    } else {
      setCurrentPage(1);
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!confirm("Xóa job này?")) return;

    try {
      const token = sessionStorage.getItem("campaign_token");
      const res = await fetch(`${API_BASE}/api/jobs/${jobId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Lỗi xóa job");
      showToast("✅ Xóa job thành công!");
      searchJobs();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleBulkDelete = async (deleteStatus: string) => {
    if (!confirm(`Xóa tất cả jobs với trạng thái ${deleteStatus}?`)) return;

    try {
      const token = sessionStorage.getItem("campaign_token");

      const params = new URLSearchParams();
      if (campaignId) params.append("campaign_id", campaignId);
      params.append("status", deleteStatus);

      const res = await fetch(`${API_BASE}/api/jobs/bulk-delete?${params.toString()}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Lỗi xóa hàng loạt");
      const data = await res.json();
      showToast(`✅ Đã xóa ${data.deleted_count} jobs!`);
      searchJobs();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      QUEUED: "bg-yellow-100 text-yellow-700",
      RUNNING: "bg-blue-100 text-blue-700",
      SUCCESS: "bg-emerald-100 text-emerald-700",
      FAILED: "bg-red-100 text-red-700",
      RETRYING: "bg-orange-100 text-orange-700",
      CANCELLED: "bg-gray-100 text-gray-700",
      PENDING: "bg-indigo-100 text-indigo-700",
      SKIPPED: "bg-slate-100 text-slate-700"
    };
    return colors[status] || "bg-gray-100 text-gray-700";
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleString("vi-VN");
    } catch {
      return dateStr;
    }
  };

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

      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">⚙️ Quản Lý Jobs</h1>

        {/* Advanced Search */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-8">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-lg font-bold text-gray-900 mb-4"
          >
            <span className="text-2xl">{showAdvanced ? "▼" : "▶"}</span>
            🔍 Tìm Kiếm Nâng Cao
          </button>

          {showAdvanced && (
            <div className="space-y-4 pt-4 border-t">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Campaign ID</label>
                  <input
                    type="text"
                    value={campaignId}
                    onChange={(e) => setCampaignId(e.target.value)}
                    placeholder="Nhập Campaign ID"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Trạng Thái</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Tất Cả</option>
                    <option value="QUEUED">Chờ Xử Lý</option>
                    <option value="RUNNING">Đang Chạy</option>
                    <option value="SUCCESS">Thành Công</option>
                    <option value="FAILED">Lỗi</option>
                    <option value="RETRYING">Chạy Lại</option>
                    <option value="CANCELLED">Hủy</option>
                    <option value="PENDING">Chờ</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Số Lần Thử Min</label>
                  <input
                    type="number"
                    min="0"
                    value={attemptMin}
                    onChange={(e) => setAttemptMin(e.target.value === "" ? "" : parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Số Lần Thử Max</label>
                  <input
                    type="number"
                    min="0"
                    value={attemptMax}
                    onChange={(e) => setAttemptMax(e.target.value === "" ? "" : parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Có Lỗi?</label>
                  <select
                    value={hasError}
                    onChange={(e) => setHasError(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Bất Kỳ</option>
                    <option value="true">Có Lỗi</option>
                    <option value="false">Không Có Lỗi</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleSearchClick}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-bold hover:bg-blue-700"
              >
                🔍 Tìm Kiếm
              </button>
            </div>
          )}
        </div>

        {/* Bulk Actions */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4">🗑️ Xóa Hàng Loạt</h3>
          <div className="flex flex-wrap gap-2">
            {["FAILED", "CANCELLED", "SKIPPED"].map((s) => (
              <button
                key={s}
                onClick={() => handleBulkDelete(s)}
                className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-700 text-sm"
              >
                Xóa tất cả {s}
              </button>
            ))}
          </div>
        </div>

        {/* Jobs List */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-blue-500 to-indigo-600">
            <h2 className="text-xl font-bold text-white">
              📊 Danh Sách Jobs ({totalItems})
              {loading && " - Đang tải..."}
            </h2>
          </div>

          {jobs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p className="text-lg">Không tìm thấy jobs nào</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-bold text-gray-900">ID</th>
                    <th className="px-4 py-3 text-left font-bold text-gray-900">Tài Khoản</th>
                    <th className="px-4 py-3 text-left font-bold text-gray-900">URL</th>
                    <th className="px-4 py-3 text-left font-bold text-gray-900">Trạng Thái</th>
                    <th className="px-4 py-3 text-center font-bold text-gray-900">Lần Thử</th>
                    <th className="px-4 py-3 text-left font-bold text-gray-900">Bắt Đầu</th>
                    <th className="px-4 py-3 text-left font-bold text-gray-900">Kết Thúc</th>
                    <th className="px-4 py-3 text-center font-bold text-gray-900">Hành Động</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs truncate max-w-xs">
                        {job.id}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {job.account_username || "—"}
                      </td>
                      <td className="px-4 py-3 text-blue-600 truncate max-w-xs hover:text-blue-800">
                        <a href={job.target_url} target="_blank" rel="noopener noreferrer">
                          {job.target_url ? job.target_url.substring(0, 30) + "..." : "—"}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(job.status)}`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-700">
                        {job.attempt_count}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {formatDate(job.started_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {formatDate(job.completed_at)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDelete(job.id)}
                          className="text-red-600 hover:text-red-800 font-bold text-sm"
                          disabled={["RUNNING", "QUEUED"].includes(job.status)}
                        >
                          🗑️ Xóa
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={currentPage}
            limit={limit}
            total={totalItems}
            pages={totalPages}
            onPageChange={setCurrentPage}
            onLimitChange={(newLimit) => {
              setLimit(newLimit);
              setCurrentPage(1);
            }}
          />
        </div>
      </div>
    </div>
  );
}
