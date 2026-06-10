"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

interface TargetURL {
  id: string;
  campaign_id: string;
  url: string;
  platform: string;
  status: string;
  assigned_account_username?: string;
  error_message?: string;
}

export default function URLsPage() {
  const params = useParams();
  const campaignId = params.campaignId as string;

  const [urls, setUrls] = useState<TargetURL[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: "success" | "error" }>>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    url: "",
    status: "PENDING"
  });

  const [bulkDeleteStatus, setBulkDeleteStatus] = useState<string | null>(null);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  const showToast = (message: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  useEffect(() => {
    fetchUrls();
  }, [campaignId]);

  const fetchUrls = async () => {
    try {
      const token = sessionStorage.getItem("campaign_token");
      const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/urls`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Lỗi tải URLs");
      const data = await res.json();
      setUrls(data);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.url.trim()) {
      showToast("Vui lòng nhập URL", "error");
      return;
    }

    try {
      const token = sessionStorage.getItem("campaign_token");

      if (editingId) {
        // Update
        const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/urls/${editingId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ url: formData.url, status: formData.status })
        });
        if (!res.ok) throw new Error("Lỗi cập nhật URL");
        showToast("✅ Cập nhật URL thành công!");
      } else {
        // Create
        const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/urls/import`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ urls: [formData.url] })
        });
        if (!res.ok) throw new Error("Lỗi tạo URL");
        showToast("✅ Tạo URL thành công!");
      }

      resetForm();
      fetchUrls();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleDelete = async (urlId: string) => {
    if (!confirm("Xóa URL này?")) return;

    try {
      const token = sessionStorage.getItem("campaign_token");
      const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/urls/${urlId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Lỗi xóa URL");
      showToast("✅ Xóa URL thành công!");
      fetchUrls();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleBulkDelete = async (status: string) => {
    if (!confirm(`Xóa tất cả URLs với trạng thái ${status}?`)) return;

    try {
      const token = sessionStorage.getItem("campaign_token");
      const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/urls/bulk-delete?status=${status}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Lỗi xóa hàng loạt");
      const data = await res.json();
      showToast(`✅ Đã xóa ${data.deleted_count} URLs!`);
      fetchUrls();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleEdit = (url: TargetURL) => {
    setEditingId(url.id);
    setFormData({
      url: url.url,
      status: url.status
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({ url: "", status: "PENDING" });
    setShowForm(false);
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      PENDING: "bg-yellow-100 text-yellow-700",
      PROCESSING: "bg-blue-100 text-blue-700",
      SUCCESS: "bg-emerald-100 text-emerald-700",
      FAILED: "bg-red-100 text-red-700",
      SKIPPED: "bg-gray-100 text-gray-700"
    };
    return colors[status] || "bg-gray-100 text-gray-700";
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

      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900">🔗 Quản Lý Target URLs</h1>
          <button
            onClick={() => (showForm ? resetForm() : setShowForm(true))}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700"
          >
            {showForm ? "❌ Hủy" : "➕ URL Mới"}
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              {editingId ? "✏️ Sửa URL" : "➕ URL Mới"}
            </h2>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">URL Bài Viết *</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://x.com/username/status/1234567890"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">💡 Chỉ nhập URL hợp lệ (X: /status/*, Threads: /post/* hoặc /t/*)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Trạng Thái</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="PENDING">Chờ Xử Lý</option>
                  <option value="PROCESSING">Đang Xử Lý</option>
                  <option value="SUCCESS">Thành Công</option>
                  <option value="FAILED">Lỗi</option>
                  <option value="SKIPPED">Bỏ Qua</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full bg-emerald-600 text-white py-2 px-4 rounded-lg font-bold hover:bg-emerald-700"
              >
                💾 {editingId ? "Cập Nhật" : "Tạo Mới"}
              </button>
            </form>
          </div>
        )}

        {/* Bulk Actions */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 mb-8">
          <h3 className="text-lg font-bold text-gray-900 mb-4">🗑️ Xóa Hàng Loạt</h3>
          <div className="flex flex-wrap gap-2">
            {["FAILED", "SKIPPED", "PROCESSING"].map((status) => (
              <button
                key={status}
                onClick={() => handleBulkDelete(status)}
                className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-700 text-sm"
              >
                Xóa tất cả {status}
              </button>
            ))}
          </div>
        </div>

        {/* URLs List */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-blue-500 to-indigo-600">
            <h2 className="text-xl font-bold text-white">
              📊 Danh Sách URLs ({urls.length})
            </h2>
          </div>

          {urls.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p className="text-lg">Chưa có URLs nào</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">URL</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">Trạng Thái</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">Tài Khoản</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">Lỗi</th>
                    <th className="px-6 py-3 text-center text-sm font-bold text-gray-900">Hành Động</th>
                  </tr>
                </thead>
                <tbody>
                  {urls.map((url) => (
                    <tr key={url.id} className="border-b hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm text-blue-600 truncate max-w-xs hover:text-blue-800">
                        <a href={url.url} target="_blank" rel="noopener noreferrer">
                          {url.url.substring(0, 50)}...
                        </a>
                      </td>
                      <td className="px-6 py-3 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(url.status)}`}>
                          {url.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-700">
                        {url.assigned_account_username || "—"}
                      </td>
                      <td className="px-6 py-3 text-sm text-red-600 max-w-xs truncate">
                        {url.error_message || "—"}
                      </td>
                      <td className="px-6 py-3 text-center space-x-2">
                        <button
                          onClick={() => handleEdit(url)}
                          className="text-blue-600 hover:text-blue-800 font-bold text-sm"
                        >
                          ✏️ Sửa
                        </button>
                        <button
                          onClick={() => handleDelete(url.id)}
                          className="text-red-600 hover:text-red-800 font-bold text-sm"
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
        </div>
      </div>
    </div>
  );
}
