"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

interface Template {
  id: string;
  campaign_id: string;
  content: string;
  category: string;
  language: string;
  priority: string;
  status: string;
}

export default function TemplatesPage() {
  const params = useParams();
  const campaignId = params.campaignId as string;
  const router = useRouter();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: "success" | "error" }>>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    content: "",
    category: "General",
    language: "vi",
    priority: "MEDIUM",
    status: "ACTIVE"
  });

  const showToast = (message: string, type: "success" | "error" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  useEffect(() => {
    fetchTemplates();
  }, [campaignId]);

  const fetchTemplates = async () => {
    try {
      const token = sessionStorage.getItem("campaign_token");
      const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/templates`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Lỗi tải templates");
      const data = await res.json();
      setTemplates(data);
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.content.trim()) {
      showToast("Vui lòng nhập nội dung template", "error");
      return;
    }

    try {
      const token = sessionStorage.getItem("campaign_token");

      if (editingId) {
        // Update
        const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/templates/${editingId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(formData)
        });
        if (!res.ok) throw new Error("Lỗi cập nhật template");
        showToast("✅ Cập nhật template thành công!");
      } else {
        // Create (import)
        const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/templates`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ templates: [formData.content] })
        });
        if (!res.ok) throw new Error("Lỗi tạo template");
        showToast("✅ Tạo template thành công!");
      }

      resetForm();
      fetchTemplates();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleDelete = async (templateId: string) => {
    if (!confirm("Xóa template này?")) return;

    try {
      const token = sessionStorage.getItem("campaign_token");
      const res = await fetch(`${API_BASE}/api/campaigns/${campaignId}/templates/${templateId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Lỗi xóa template");
      showToast("✅ Xóa template thành công!");
      fetchTemplates();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleEdit = (template: Template) => {
    setEditingId(template.id);
    setFormData({
      content: template.content,
      category: template.category,
      language: template.language,
      priority: template.priority,
      status: template.status
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      content: "",
      category: "General",
      language: "vi",
      priority: "MEDIUM",
      status: "ACTIVE"
    });
    setShowForm(false);
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
          <h1 className="text-4xl font-bold text-gray-900">📝 Quản Lý Templates</h1>
          <button
            onClick={() => (showForm ? resetForm() : setShowForm(true))}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700"
          >
            {showForm ? "❌ Hủy" : "➕ Template Mới"}
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-8 mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              {editingId ? "✏️ Sửa Template" : "➕ Template Mới"}
            </h2>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nội Dung *</label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Nhập nội dung comment..."
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">💡 Hỗ trợ spintax: {"{"}option1|option2{"}}"}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Danh Mục</label>
                  <input
                    type="text"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ngôn Ngữ</label>
                  <select
                    value={formData.language}
                    onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="vi">Tiếng Việt</option>
                    <option value="en">English</option>
                    <option value="other">Khác</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Độ Ưu Tiên</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="LOW">Thấp</option>
                    <option value="MEDIUM">Bình Thường</option>
                    <option value="HIGH">Cao</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Trạng Thái</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ACTIVE">Hoạt Động</option>
                    <option value="INACTIVE">Không Hoạt Động</option>
                  </select>
                </div>
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

        {/* Templates List */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-blue-500 to-indigo-600">
            <h2 className="text-xl font-bold text-white">
              📚 Danh Sách Templates ({templates.length})
            </h2>
          </div>

          {templates.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p className="text-lg">Chưa có templates nào</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">Nội Dung</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">Danh Mục</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">Ngôn Ngữ</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">Độ Ưu Tiên</th>
                    <th className="px-6 py-3 text-left text-sm font-bold text-gray-900">Trạng Thái</th>
                    <th className="px-6 py-3 text-center text-sm font-bold text-gray-900">Hành Động</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((template) => (
                    <tr key={template.id} className="border-b hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm text-gray-700 max-w-xs truncate">
                        {template.content.substring(0, 50)}...
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-700">{template.category}</td>
                      <td className="px-6 py-3 text-sm text-gray-700">{template.language}</td>
                      <td className="px-6 py-3 text-sm">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-bold ${
                            template.priority === "HIGH"
                              ? "bg-red-100 text-red-700"
                              : template.priority === "MEDIUM"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {template.priority}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-bold ${
                            template.status === "ACTIVE"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {template.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-center space-x-2">
                        <button
                          onClick={() => handleEdit(template)}
                          className="text-blue-600 hover:text-blue-800 font-bold text-sm"
                        >
                          ✏️ Sửa
                        </button>
                        <button
                          onClick={() => handleDelete(template.id)}
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
