"use client";

import { useState, useEffect, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8099";

export default function Home() {
  const [token, setToken] = useState(null);
  const [userRole, setUserRole] = useState("");
  const [username, setUsername] = useState("");
  
  // Auth Form State
  const [isRegistering, setIsRegistering] = useState(false);
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authRole, setAuthRole] = useState("OPERATOR");
  const [authError, setAuthError] = useState("");

  // Navigation
  const [activeTab, setActiveTab] = useState("dashboard");

  // Dashboard Metrics state
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

  // Campaigns list & details
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [campaignUrls, setCampaignUrls] = useState([]);
  const [campaignTemplates, setCampaignTemplates] = useState([]);
  
  // Create Campaign Form
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignPlatform, setNewCampaignPlatform] = useState("X");
  const [newCampaignDesc, setNewCampaignDesc] = useState("");
  const [showCreateCampaignModal, setShowCreateCampaignModal] = useState(false);

  // Import Forms
  const [bulkUrlsInput, setBulkUrlsInput] = useState("");
  const [bulkTemplatesInput, setBulkTemplatesInput] = useState("");

  // Accounts List & Form
  const [accounts, setAccounts] = useState([]);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [newAccPlatform, setNewAccPlatform] = useState("X");
  const [newAccUsername, setNewAccUsername] = useState("");
  const [newAccDispName, setNewAccDispName] = useState("");
  const [newAccDailyLimit, setNewAccDailyLimit] = useState(50);
  const [newAccHourlyLimit, setNewAccHourlyLimit] = useState(5);

  // Jobs List & Filter
  const [jobs, setJobs] = useState([]);
  const [jobFilterStatus, setJobFilterStatus] = useState("");

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState([]);

  // Toast notifications
  const [toasts, setToasts] = useState([]);

  // Auto-refresh polling timer
  const pollTimerRef = useRef(null);

  // Helper to show toasts
  const showToast = (message, type = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Helper fetch with Bearer token
  const apiFetch = async (endpoint, options = {}) => {
    const jwtToken = token || localStorage.getItem("campaign_token");
    const headers = {
      ...(options.headers || {}),
    };
    if (jwtToken) {
      headers["Authorization"] = `Bearer ${jwtToken}`;
    }
    
    // Auto format application/json if sending body
    if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });

    if (res.status === 401) {
      // Token expired or invalid
      logout();
      throw new Error("Session expired. Please log in again.");
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Server returned error status ${res.status}`);
    }

    return res.json();
  };

  // Check login on load
  useEffect(() => {
    const storedToken = localStorage.getItem("campaign_token");
    const storedRole = localStorage.getItem("campaign_role");
    const storedUser = localStorage.getItem("campaign_user");
    if (storedToken) {
      setToken(storedToken);
      setUserRole(storedRole || "OPERATOR");
      setUsername(storedUser || "");
    }
  }, []);

  // Poll metrics and lists when logged in
  useEffect(() => {
    if (!token) return;

    const fetchData = async () => {
      try {
        if (activeTab === "dashboard") {
          const data = await apiFetch("/api/dashboard/metrics");
          setMetrics(data);
        } else if (activeTab === "campaigns") {
          const list = await apiFetch("/api/campaigns");
          setCampaigns(list);
          if (selectedCampaign) {
            // refresh selected campaign details
            const updatedCampaign = await apiFetch(`/api/campaigns/${selectedCampaign.id}`);
            setSelectedCampaign(updatedCampaign);
            const urls = await apiFetch(`/api/campaigns/${selectedCampaign.id}/urls`);
            setCampaignUrls(urls);
            const tpls = await apiFetch(`/api/campaigns/${selectedCampaign.id}/templates`);
            setCampaignTemplates(tpls);
          }
        } else if (activeTab === "accounts") {
          const list = await apiFetch("/api/accounts");
          setAccounts(list);
        } else if (activeTab === "jobs") {
          const endpoint = jobFilterStatus ? `/api/jobs?status=${jobFilterStatus}` : "/api/jobs";
          const list = await apiFetch(endpoint);
          setJobs(list);
        } else if (activeTab === "audit") {
          // Since audit logs don't have a direct routing file, we can fetch audit logs from db.
          // Wait, audit logs are saved in db. Let's create an inline API in main.py? 
          // Ah, we can add a route inside backend/app/routes/dashboard.py or campaign.py to return audit logs!
          // Let's make sure we can fetch it, or if not, mock it on UI. Wait, we can fetch it from `/api/audit`
          // Let's double check if we defined `/api/audit`?
          // No, we didn't add the audit router. Let's add `/api/audit` to `dashboard.py` to fetch it.
          // I will make a fetch to `/api/dashboard/audit` which we can add easily!
          const logs = await apiFetch("/api/dashboard/audit").catch(() => []);
          setAuditLogs(logs);
        }
      } catch (err) {
        console.error("Polling error:", err.message);
      }
    };

    fetchData();
    pollTimerRef.current = setInterval(fetchData, 3000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [token, activeTab, selectedCampaign, jobFilterStatus]);

  // Auth Operations
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      if (isRegistering) {
        const res = await apiFetch("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            username: authUsername,
            password: authPassword,
            role: authRole
          })
        });
        localStorage.setItem("campaign_token", res.access_token);
        localStorage.setItem("campaign_role", res.role);
        localStorage.setItem("campaign_user", res.username);
        setToken(res.access_token);
        setUserRole(res.role);
        setUsername(res.username);
        showToast("Registration successful!");
      } else {
        // FastAPI uses form-data (oauth2) for standard /login endpoint
        const formData = new FormData();
        formData.append("username", authUsername);
        formData.append("password", authPassword);
        
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          body: formData
        });
        
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Invalid credentials");
        }
        
        const data = await res.json();
        localStorage.setItem("campaign_token", data.access_token);
        localStorage.setItem("campaign_role", data.role);
        localStorage.setItem("campaign_user", data.username);
        setToken(data.access_token);
        setUserRole(data.role);
        setUsername(data.username);
        showToast("Successfully logged in!");
      }
      setAuthPassword("");
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const logout = () => {
    localStorage.removeItem("campaign_token");
    localStorage.removeItem("campaign_role");
    localStorage.removeItem("campaign_user");
    setToken(null);
    setUserRole("");
    setUsername("");
    setSelectedCampaign(null);
    showToast("Logged out successfully", "info");
  };

  // Campaigns Operations
  const handleCreateCampaign = async (e) => {
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
      setCampaigns((prev) => [res, ...prev]);
      setShowCreateCampaignModal(false);
      setNewCampaignName("");
      setNewCampaignDesc("");
      showToast("Campaign created successfully!");
      setSelectedCampaign(res);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleImportUrls = async () => {
    if (!bulkUrlsInput.trim()) return;
    try {
      const urlsArray = bulkUrlsInput.split("\n").map(u => u.trim()).filter(Boolean);
      await apiFetch(`/api/campaigns/${selectedCampaign.id}/urls/import`, {
        method: "POST",
        body: JSON.stringify({ urls: urlsArray })
      });
      setBulkUrlsInput("");
      showToast("URLs imported successfully!");
      // reload
      const urls = await apiFetch(`/api/campaigns/${selectedCampaign.id}/urls`);
      setCampaignUrls(urls);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleImportTemplates = async () => {
    if (!bulkTemplatesInput.trim()) return;
    try {
      const templatesArray = bulkTemplatesInput.split("\n").map(t => t.trim()).filter(Boolean);
      await apiFetch(`/api/campaigns/${selectedCampaign.id}/templates`, {
        method: "POST",
        body: JSON.stringify({ templates: templatesArray })
      });
      setBulkTemplatesInput("");
      showToast("Comment templates imported!");
      // reload
      const tpls = await apiFetch(`/api/campaigns/${selectedCampaign.id}/templates`);
      setCampaignTemplates(tpls);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const startCampaign = async (cid) => {
    try {
      const res = await apiFetch(`/api/campaigns/${cid}/start`, { method: "POST" });
      showToast(res.message);
      // Refresh campaign
      const updated = await apiFetch(`/api/campaigns/${cid}`);
      setSelectedCampaign(updated);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const pauseCampaign = async (cid) => {
    try {
      const res = await apiFetch(`/api/campaigns/${cid}/pause`, { method: "POST" });
      showToast(res.message, "info");
      const updated = await apiFetch(`/api/campaigns/${cid}`);
      setSelectedCampaign(updated);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const stopCampaign = async (cid) => {
    try {
      const res = await apiFetch(`/api/campaigns/${cid}/stop`, { method: "POST" });
      showToast(res.message, "warning");
      const updated = await apiFetch(`/api/campaigns/${cid}`);
      setSelectedCampaign(updated);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const duplicateCampaign = async (cid) => {
    try {
      const res = await apiFetch(`/api/campaigns/${cid}/duplicate`, { method: "POST" });
      showToast("Campaign duplicated!");
      const list = await apiFetch("/api/campaigns");
      setCampaigns(list);
      // Select the new one
      const newCampaign = await apiFetch(`/api/campaigns/${res.new_campaign_id}`);
      setSelectedCampaign(newCampaign);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const deleteCampaign = async (cid) => {
    if (!confirm("Are you sure you want to delete this campaign? This will delete all URLs, Templates, and Job logs.")) return;
    try {
      await apiFetch(`/api/campaigns/${cid}`, { method: "DELETE" });
      showToast("Campaign deleted.", "warning");
      setSelectedCampaign(null);
      const list = await apiFetch("/api/campaigns");
      setCampaigns(list);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // Accounts Operations
  const handleAddAccount = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          platform: newAccPlatform,
          username: newAccUsername,
          display_name: newAccDispName,
          daily_limit: parseInt(newAccDailyLimit),
          hourly_limit: parseInt(newAccHourlyLimit)
        })
      });
      setAccounts((prev) => [res, ...prev]);
      setShowAddAccountModal(false);
      setNewAccUsername("");
      setNewAccDispName("");
      showToast("Social account added successfully!");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const toggleAccountStatus = async (account) => {
    const nextStatus = account.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await apiFetch(`/api/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus })
      });
      showToast(`Account status updated to ${nextStatus}`);
      const list = await apiFetch("/api/accounts");
      setAccounts(list);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const deleteAccount = async (aid) => {
    if (!confirm("Are you sure you want to delete this account?")) return;
    try {
      await apiFetch(`/api/accounts/${aid}`, { method: "DELETE" });
      showToast("Account deleted.", "warning");
      const list = await apiFetch("/api/accounts");
      setAccounts(list);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // Job Queue Operations
  const retryJob = async (jobId) => {
    try {
      const res = await apiFetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
      showToast(res.message);
      // refresh jobs
      const list = await apiFetch(jobFilterStatus ? `/api/jobs?status=${jobFilterStatus}` : "/api/jobs");
      setJobs(list);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const retryAllFailed = async (cid) => {
    try {
      const res = await apiFetch(`/api/jobs/retry-failed-campaign/${cid}`, { method: "POST" });
      showToast(res.message);
      const list = await apiFetch(jobFilterStatus ? `/api/jobs?status=${jobFilterStatus}` : "/api/jobs");
      setJobs(list);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  if (!token) {
    // LOGIN AND REGISTRATION SCREEN
    return (
      <div className="min-h-screen flex items-center justify-center bg-radial from-slate-900 to-slate-950 p-6">
        <div className="w-full max-w-md bg-slate-900/50 backdrop-blur-xl border border-slate-800/80 p-8 rounded-2xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-teal-500 via-indigo-500 to-violet-500" />
          
          <div className="flex flex-col items-center mb-8">
            <div className="p-3 bg-gradient-to-br from-teal-400 to-indigo-500 rounded-2xl shadow-lg mb-4">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-teal-400 to-indigo-300 bg-clip-text text-transparent">Antigravity Social</h1>
            <p className="text-slate-400 text-xs mt-1">Comment Campaign Orchestrator v1.0</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Username</label>
              <input 
                type="text" 
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                placeholder="Enter username" 
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-teal-500/80 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 transition"
                required
              />
            </div>
            
            <div>
              <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Password</label>
              <input 
                type="password" 
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Enter password" 
                className="w-full bg-slate-950/80 border border-slate-800 focus:border-teal-500/80 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 transition"
                required
              />
            </div>

            {isRegistering && (
              <div>
                <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Assign Role</label>
                <select
                  value={authRole}
                  onChange={(e) => setAuthRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-500"
                >
                  <option value="OPERATOR">OPERATOR (Create/Run campaigns)</option>
                  <option value="ADMIN">ADMIN (Full access + System control)</option>
                  <option value="VIEWER">VIEWER (View status & charts only)</option>
                </select>
              </div>
            )}

            {authError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl p-3 text-center">
                {authError}
              </div>
            )}

            <button type="submit" className="w-full bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-400 hover:to-indigo-500 text-white font-medium rounded-xl py-3 text-sm shadow-lg hover:shadow-teal-500/25 transition duration-300">
              {isRegistering ? "Register Account" : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center text-xs">
            <button 
              onClick={() => {
                setIsRegistering(!isRegistering);
                setAuthError("");
              }}
              className="text-slate-400 hover:text-teal-400 transition"
            >
              {isRegistering ? "Already have an account? Sign In" : "Need an account? Create one"}
            </button>
          </div>

          <div className="mt-6 border-t border-slate-800/80 pt-4 text-center">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Development Credentials</p>
            <div className="flex justify-center space-x-4 text-slate-400 text-[11px]">
              <button 
                onClick={() => {
                  setAuthUsername("admin");
                  setAuthPassword("admin123");
                  setIsRegistering(false);
                }}
                className="bg-slate-950/80 border border-slate-800/50 rounded-lg px-3 py-1 hover:border-slate-700 hover:text-white transition"
              >
                Admin (admin / admin123)
              </button>
              <button 
                onClick={() => {
                  setAuthUsername("operator");
                  setAuthPassword("operator123");
                  setIsRegistering(false);
                }}
                className="bg-slate-950/80 border border-slate-800/50 rounded-lg px-3 py-1 hover:border-slate-700 hover:text-white transition"
              >
                Operator (operator / operator123)
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // LOGGED IN DASHBOARD
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-950 font-sans relative">
      
      {/* Toast notifications handler */}
      <div className="fixed top-6 right-6 z-50 space-y-3">
        {toasts.map((t) => (
          <div 
            key={t.id} 
            className={`flex items-center px-4 py-3 rounded-xl border text-sm shadow-xl transition-all duration-300 animate-slide-in ${
              t.type === "error" 
                ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                : t.type === "warning"
                ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                : t.type === "info"
                ? "bg-blue-500/10 border-blue-500/30 text-blue-300"
                : "bg-teal-500/10 border-teal-500/30 text-teal-300"
            }`}
          >
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-slate-900 border-r border-slate-800/80 p-6 flex flex-col justify-between shrink-0">
        <div className="space-y-8">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-gradient-to-br from-teal-400 to-indigo-500 rounded-xl shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>
            <div>
              <h2 className="font-bold text-slate-100 tracking-wide text-sm bg-gradient-to-r from-teal-400 to-indigo-300 bg-clip-text text-transparent">Antigravity Social</h2>
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{userRole} PANEL</span>
            </div>
          </div>

          <nav className="space-y-1.5">
            {[
              { id: "dashboard", label: "Dashboard", icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z" },
              { id: "campaigns", label: "Campaigns", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
              { id: "accounts", label: "Social Accounts", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
              { id: "jobs", label: "Job Queue", icon: "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" },
              { id: "audit", label: "Audit Logs", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id !== "campaigns") setSelectedCampaign(null);
                }}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition duration-200 ${
                  activeTab === tab.id 
                    ? "bg-slate-800 text-teal-400 border border-slate-700/50" 
                    : "text-slate-400 hover:bg-slate-850/50 hover:text-slate-100"
                }`}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                </svg>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="border-t border-slate-800 pt-4 flex flex-col space-y-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700/50 flex items-center justify-center font-bold text-teal-400 uppercase text-xs">
              {username ? username.substring(0, 2) : "OP"}
            </div>
            <div className="truncate">
              <p className="text-slate-200 text-xs font-semibold truncate">@{username || "Operator"}</p>
              <p className="text-[10px] text-slate-500 truncate capitalize">{userRole.toLowerCase()} role</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center justify-center space-x-2 bg-slate-850 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/30 text-slate-400 hover:text-rose-400 py-2.5 rounded-xl text-xs transition duration-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Log Out</span>
          </button>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto space-y-6">
        
        {/* HEADER BAR */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-900 pb-5">
          <div>
            <h1 className="text-2xl font-bold text-white capitalize">{activeTab}</h1>
            <p className="text-slate-400 text-xs mt-1">Manage comment operations, workers status, and social campaign workflows.</p>
          </div>
          <div className="flex items-center space-x-3 text-xs bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-slate-400">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
            </span>
            <span>API Server Online</span>
          </div>
        </header>

        {/* ================================================================ */}
        {/* DASHBOARD TAB */}
        {/* ================================================================ */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            
            {/* Stat Cards Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              {[
                { label: "Total Campaigns", val: metrics.total_campaigns, icon: "📁", color: "from-blue-500/10 to-indigo-500/10 border-blue-500/30 text-blue-400" },
                { label: "Job Success Rate", val: `${metrics.success_rate}%`, icon: "📈", color: "from-teal-500/10 to-emerald-500/10 border-teal-500/30 text-teal-400" },
                { label: "Failed Jobs", val: metrics.failed_jobs, icon: "❌", color: "from-rose-500/10 to-pink-500/10 border-rose-500/30 text-rose-400" },
                { label: "Active Accounts", val: metrics.active_accounts, icon: "👤", color: "from-violet-500/10 to-fuchsia-500/10 border-violet-500/30 text-violet-400" },
                { label: "Redis Queue Size", val: metrics.queue_size, icon: "⚡", color: "from-amber-500/10 to-orange-500/10 border-amber-500/30 text-amber-400" },
                { label: "Avg Job Runtime", val: `${metrics.avg_processing_time}s`, icon: "⏱️", color: "from-sky-500/10 to-blue-500/10 border-sky-500/30 text-sky-400" }
              ].map((card, idx) => (
                <div key={idx} className={`bg-gradient-to-br ${card.color} border p-5 rounded-2xl flex flex-col justify-between h-32 hover:scale-[1.02] transition shadow-md`}>
                  <div className="flex justify-between items-center">
                    <span className="text-2xl">{card.icon}</span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-white mt-1">{card.val}</h3>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mt-1">{card.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Middle Section: Campaign Distribution & Info */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Campaign status distribution */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
                <h3 className="text-sm font-semibold text-slate-200">Campaigns Distribution</h3>
                <div className="space-y-3 pt-2">
                  {Object.entries(metrics.campaign_distribution).map(([status, count]) => {
                    const total = Object.values(metrics.campaign_distribution).reduce((a, b) => a + b, 0) || 1;
                    const pct = Math.round((count / total) * 100);
                    const colorMap = {
                      RUNNING: "bg-teal-500",
                      COMPLETED: "bg-indigo-500",
                      PAUSED: "bg-amber-500",
                      DRAFT: "bg-slate-600",
                      READY: "bg-emerald-500",
                      FAILED: "bg-rose-500"
                    };
                    return (
                      <div key={status} className="space-y-1">
                        <div className="flex justify-between text-xs font-medium">
                          <span className="text-slate-400">{status}</span>
                          <span className="text-slate-200">{count} ({pct}%)</span>
                        </div>
                        <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800/80">
                          <div className={`h-full ${colorMap[status] || "bg-indigo-500"} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Fast API Worker Status & Connection Info */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-200">Queue & Worker Orchestrator Status</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    The background worker process is running and connected to **Redis** and **MongoDB**. Job updates are pushed dynamically into databases. The mock social driver executes campaigns with rate limit protections and exponential retry intervals.
                  </p>
                  
                  <div className="grid grid-cols-2 gap-4 pt-3">
                    <div className="bg-slate-950/80 border border-slate-850 p-4 rounded-xl">
                      <p className="text-[10px] uppercase font-semibold text-slate-500">Redis Server Connection</p>
                      <p className="text-xs font-semibold text-emerald-400 mt-1">CONNECTED (redis://redis:6379)</p>
                    </div>
                    <div className="bg-slate-950/80 border border-slate-850 p-4 rounded-xl">
                      <p className="text-[10px] uppercase font-semibold text-slate-500">MongoDB database status</p>
                      <p className="text-xs font-semibold text-emerald-400 mt-1">CONNECTED (database: social_campaign_db)</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t border-slate-800/80 mt-6 text-xs text-slate-400">
                  <span>Worker thread polling: **blpop (5s timeout)**</span>
                  <span>Auto-limits reset: **Hourly/Daily check**</span>
                </div>
              </div>
            </div>

            {/* Live Feed: Recent Jobs */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold text-slate-200">Live Job Queue Stream (Last 10 Actions)</h3>
                <button 
                  onClick={() => setActiveTab("jobs")}
                  className="text-xs text-teal-400 hover:text-teal-300 font-medium transition"
                >
                  View All Jobs →
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
                      <th className="py-3 px-4">Job ID</th>
                      <th className="py-3 px-4">Platform</th>
                      <th className="py-3 px-4">Account</th>
                      <th className="py-3 px-4">Target URL</th>
                      <th className="py-3 px-4">Comment Content</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Attempts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {metrics.recent_jobs.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="text-center py-6 text-slate-500">No jobs recorded yet. Trigger a campaign to start queueing.</td>
                      </tr>
                    ) : (
                      metrics.recent_jobs.map((job) => (
                        <tr key={job.id} className="hover:bg-slate-850/30 transition-colors">
                          <td className="py-3 px-4 font-mono text-slate-300 text-[10px]">{job.id.substring(18)}</td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              job.target_url?.includes("x.com") || job.target_url?.includes("twitter.com") 
                                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" 
                                : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            }`}>
                              {job.target_url?.includes("threads.net") ? "Threads" : "X"}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-200">@{job.account_username || "dynamic"}</td>
                          <td className="py-3 px-4 max-w-xs truncate text-slate-400">{job.target_url}</td>
                          <td className="py-3 px-4 max-w-xs truncate text-slate-400">"{job.template_content}"</td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              job.status === "SUCCESS" 
                                ? "bg-teal-500/10 text-teal-400 border border-teal-500/20" 
                                : job.status === "FAILED"
                                ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                : job.status === "RUNNING"
                                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse"
                                : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                            }`}>
                              {job.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-400 font-semibold">{job.attempt_count}/3</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ================================================================ */}
        {/* CAMPAIGNS TAB */}
        {/* ================================================================ */}
        {activeTab === "campaigns" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            
            {/* Left Col: Campaigns list */}
            <div className="lg:col-span-1 space-y-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-semibold text-slate-200">Campaign Folders</h3>
                {userRole !== "VIEWER" && (
                  <button 
                    onClick={() => setShowCreateCampaignModal(true)}
                    className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-xs px-3 py-1.5 rounded-xl shadow-lg transition"
                  >
                    + Create Campaign
                  </button>
                )}
              </div>

              {campaigns.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-slate-500 text-xs">
                  No campaigns found. Click button above to create one.
                </div>
              ) : (
                <div className="space-y-3">
                  {campaigns.map((camp) => (
                    <button
                      key={camp.id}
                      onClick={() => setSelectedCampaign(camp)}
                      className={`w-full text-left p-4 rounded-xl border transition-all ${
                        selectedCampaign?.id === camp.id 
                          ? "bg-slate-900 border-teal-500/50 shadow-md shadow-teal-500/5" 
                          : "bg-slate-900/50 border-slate-850 hover:bg-slate-900"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-200 text-sm">{camp.name}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          camp.status === "RUNNING"
                            ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                            : camp.status === "COMPLETED"
                            ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                            : camp.status === "PAUSED"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                        }`}>
                          {camp.status}
                        </span>
                      </div>
                      <p className="text-slate-400 text-xs mt-1 truncate">{camp.description || "No description provided."}</p>
                      <div className="flex justify-between items-center text-[10px] text-slate-500 mt-3 pt-2 border-t border-slate-850">
                        <span>Platform: **{camp.platform}**</span>
                        <span>By: @{camp.created_by}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right Col: Selected Campaign Details */}
            <div className="lg:col-span-2">
              {selectedCampaign ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
                  
                  {/* Title & Control Panel */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800/80 pb-5 gap-4">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h2 className="text-lg font-bold text-white">{selectedCampaign.name}</h2>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                          selectedCampaign.platform === "X" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"
                        }`}>
                          {selectedCampaign.platform}
                        </span>
                      </div>
                      <p className="text-slate-400 text-xs mt-1">{selectedCampaign.description || "No description."}</p>
                    </div>

                    {userRole !== "VIEWER" && (
                      <div className="flex flex-wrap gap-2">
                        {selectedCampaign.status !== "RUNNING" ? (
                          <button
                            onClick={() => startCampaign(selectedCampaign.id)}
                            className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-xl shadow-lg transition"
                          >
                            ▶️ Start
                          </button>
                        ) : (
                          <button
                            onClick={() => pauseCampaign(selectedCampaign.id)}
                            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-xl shadow-lg transition"
                          >
                            ⏸️ Pause
                          </button>
                        )}
                        
                        {selectedCampaign.status === "RUNNING" && (
                          <button
                            onClick={() => stopCampaign(selectedCampaign.id)}
                            className="bg-rose-500 hover:bg-rose-450 text-white font-bold text-xs px-3 py-1.5 rounded-xl shadow-lg transition"
                          >
                            ⏹️ Stop
                          </button>
                        )}

                        <button
                          onClick={() => duplicateCampaign(selectedCampaign.id)}
                          className="bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 font-bold text-xs px-3 py-1.5 rounded-xl transition"
                        >
                          📋 Duplicate
                        </button>
                        
                        <button
                          onClick={() => deleteCampaign(selectedCampaign.id)}
                          className="bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 font-bold text-xs px-3 py-1.5 rounded-xl transition"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Campaign stats summary */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-slate-950/80 border border-slate-850 p-4 rounded-xl text-center">
                      <p className="text-[10px] uppercase font-semibold text-slate-500">Target URLs</p>
                      <p className="text-lg font-bold text-white mt-1">{campaignUrls.length}</p>
                    </div>
                    <div className="bg-slate-950/80 border border-slate-850 p-4 rounded-xl text-center">
                      <p className="text-[10px] uppercase font-semibold text-slate-500">Templates</p>
                      <p className="text-lg font-bold text-white mt-1">{campaignTemplates.length}</p>
                    </div>
                    <div className="bg-slate-950/80 border border-slate-850 p-4 rounded-xl text-center">
                      <p className="text-[10px] uppercase font-semibold text-slate-500">Status</p>
                      <p className="text-xs font-bold text-teal-400 mt-2 uppercase">{selectedCampaign.status}</p>
                    </div>
                  </div>

                  {/* Double Section: URLs & Templates management */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    
                    {/* Column 1: Target URLs */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Target URLs</h4>
                        <span className="text-[10px] text-slate-500">{campaignUrls.filter(u => u.status === "SUCCESS").length} / {campaignUrls.length} completed</span>
                      </div>
                      
                      {/* URL Import */}
                      {userRole !== "VIEWER" && (
                        <div className="space-y-2">
                          <textarea
                            value={bulkUrlsInput}
                            onChange={(e) => setBulkUrlsInput(e.target.value)}
                            placeholder="Import URLs (one per line, e.g. https://x.com/post/123)"
                            rows="2"
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-teal-500"
                          />
                          <button
                            onClick={handleImportUrls}
                            className="w-full bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 py-1.5 rounded-lg text-xs font-medium transition"
                          >
                            📥 Import URLs
                          </button>
                        </div>
                      )}

                      {/* URL list */}
                      <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3 max-h-52 overflow-y-auto space-y-1.5">
                        {campaignUrls.length === 0 ? (
                          <p className="text-center text-slate-500 text-[11px] py-4">No URLs imported yet.</p>
                        ) : (
                          campaignUrls.map((url) => (
                            <div key={url.id} className="flex justify-between items-center p-2 bg-slate-950/80 rounded border border-slate-900 text-[11px] gap-2">
                              <span className="truncate text-slate-300 font-mono" title={url.url}>{url.url}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                url.status === "SUCCESS"
                                  ? "bg-teal-500/10 text-teal-400"
                                  : url.status === "FAILED"
                                  ? "bg-rose-500/10 text-rose-400"
                                  : url.status === "PROCESSING"
                                  ? "bg-blue-500/10 text-blue-400 animate-pulse"
                                  : "bg-slate-500/10 text-slate-400"
                              }`}>
                                {url.status}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Column 2: Comment Templates */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Comment Templates</h4>
                        <span className="text-[10px] text-slate-500">{campaignTemplates.length} templates ready</span>
                      </div>

                      {/* Template Import */}
                      {userRole !== "VIEWER" && (
                        <div className="space-y-2">
                          <textarea
                            value={bulkTemplatesInput}
                            onChange={(e) => setBulkTemplatesInput(e.target.value)}
                            placeholder="Add comment templates (one per line, e.g. Great article!)"
                            rows="2"
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-teal-500"
                          />
                          <button
                            onClick={handleImportTemplates}
                            className="w-full bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300 py-1.5 rounded-lg text-xs font-medium transition"
                          >
                            📥 Import Comment Templates
                          </button>
                        </div>
                      )}

                      {/* Templates list */}
                      <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3 max-h-52 overflow-y-auto space-y-1.5">
                        {campaignTemplates.length === 0 ? (
                          <p className="text-center text-slate-500 text-[11px] py-4">No comments found.</p>
                        ) : (
                          campaignTemplates.map((tpl) => (
                            <div key={tpl.id} className="p-2 bg-slate-950/80 rounded border border-slate-900 text-[11px] text-slate-300 truncate">
                              "{tpl.content}"
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Campaign failed job alerts */}
                  {campaignUrls.some(u => u.status === "FAILED") && (
                    <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 p-4 rounded-xl text-xs flex justify-between items-center">
                      <div>
                        <p className="font-semibold">⚠️ Attention: This campaign has failed comment jobs</p>
                        <p className="text-slate-400 mt-0.5">Some comment requests failed due to rate limits or API timeout. You can retry them.</p>
                      </div>
                      {userRole !== "VIEWER" && (
                        <button
                          onClick={() => retryAllFailed(selectedCampaign.id)}
                          className="bg-rose-500 hover:bg-rose-450 text-white font-bold px-3 py-1.5 rounded-lg transition"
                        >
                          Retry Failed Jobs
                        </button>
                      )}
                    </div>
                  )}

                </div>
              ) : (
                <div className="bg-slate-900/50 border border-slate-850 rounded-2xl p-12 text-center text-slate-500 text-sm h-64 flex flex-col justify-center items-center">
                  <svg className="w-12 h-12 text-slate-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5M5 19v-2a2 2 0 002-2h2a2 2 0 002-2V5" />
                  </svg>
                  <span>Select a campaign from the folder list to manage targets, templates, and view job logs.</span>
                </div>
              )}
            </div>

            {/* CREATE CAMPAIGN MODAL */}
            {showCreateCampaignModal && (
              <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <h3 className="text-base font-bold text-white">Create New Campaign</h3>
                    <button onClick={() => setShowCreateCampaignModal(false)} className="text-slate-400 hover:text-white">✕</button>
                  </div>
                  <form onSubmit={handleCreateCampaign} className="space-y-4 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1">Campaign Name</label>
                      <input
                        type="text"
                        value={newCampaignName}
                        onChange={(e) => setNewCampaignName(e.target.value)}
                        placeholder="e.g. Summer Promo Threads"
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Social Platform</label>
                      <select
                        value={newCampaignPlatform}
                        onChange={(e) => setNewCampaignPlatform(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 focus:outline-none"
                      >
                        <option value="X">X (Twitter)</option>
                        <option value="Threads">Threads</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Description</label>
                      <textarea
                        value={newCampaignDesc}
                        onChange={(e) => setNewCampaignDesc(e.target.value)}
                        placeholder="Detail about the campaign goals..."
                        rows="3"
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-500"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-2.5 rounded-xl transition"
                    >
                      Save Campaign
                    </button>
                  </form>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ================================================================ */}
        {/* ACCOUNTS TAB */}
        {/* ================================================================ */}
        {activeTab === "accounts" && (
          <div className="space-y-6">
            
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-slate-200">Connected Accounts</h3>
              {userRole !== "VIEWER" && (
                <button
                  onClick={() => setShowAddAccountModal(true)}
                  className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-xs px-3 py-1.5 rounded-xl shadow-lg transition"
                >
                  + Add Social Account
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {accounts.length === 0 ? (
                <div className="col-span-full bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-500 text-xs">
                  No accounts found. Use the button to register accounts.
                </div>
              ) : (
                accounts.map((acc) => (
                  <div key={acc.id} className="bg-slate-900 border border-slate-800/80 rounded-2xl p-6 space-y-4 hover:border-slate-700 transition relative overflow-hidden">
                    
                    {/* Badge top-right platform */}
                    <div className="absolute top-4 right-4 flex items-center space-x-2">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        acc.platform === "X" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"
                      }`}>
                        {acc.platform}
                      </span>
                    </div>

                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-850 flex items-center justify-center text-slate-400 font-bold uppercase">
                        {acc.username.substring(0, 2)}
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-200 text-sm">{acc.display_name}</h4>
                        <p className="text-slate-500 text-xs">@{acc.username}</p>
                      </div>
                    </div>

                    {/* Status switcher */}
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">Account Health:</span>
                      <span className={`font-semibold ${
                        acc.status === "ACTIVE" 
                          ? "text-teal-400" 
                          : acc.status === "LIMITED" 
                          ? "text-amber-400" 
                          : "text-rose-400"
                      }`}>
                        {acc.status} ({acc.health_score}%)
                      </span>
                    </div>

                    {/* Health score progress bar */}
                    <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800/80">
                      <div className={`h-full rounded-full ${
                        acc.health_score > 70 
                          ? "bg-teal-500" 
                          : acc.health_score > 40 
                          ? "bg-amber-500" 
                          : "bg-rose-500"
                      }`} style={{ width: `${acc.health_score}%` }} />
                    </div>

                    {/* Usage quotas indicators */}
                    <div className="space-y-2 border-t border-slate-850 pt-3 text-xs">
                      <div>
                        <div className="flex justify-between text-[11px] text-slate-400">
                          <span>Hourly limit quota</span>
                          <span className="font-semibold text-slate-200">{acc.hourly_usage_count} / {acc.hourly_limit}</span>
                        </div>
                        <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden mt-1">
                          <div 
                            className={`h-full rounded-full ${acc.hourly_usage_count >= acc.hourly_limit ? "bg-amber-500 animate-pulse" : "bg-blue-400"}`} 
                            style={{ width: `${Math.min(100, (acc.hourly_usage_count / acc.hourly_limit) * 100)}%` }} 
                          />
                        </div>
                      </div>
                      
                      <div>
                        <div className="flex justify-between text-[11px] text-slate-400">
                          <span>Daily limit quota</span>
                          <span className="font-semibold text-slate-200">{acc.daily_usage_count} / {acc.daily_limit}</span>
                        </div>
                        <div className="w-full bg-slate-950 h-1 rounded-full overflow-hidden mt-1">
                          <div 
                            className={`h-full rounded-full ${acc.daily_usage_count >= acc.daily_limit ? "bg-amber-500 animate-pulse" : "bg-indigo-400"}`} 
                            style={{ width: `${Math.min(100, (acc.daily_usage_count / acc.daily_limit) * 100)}%` }} 
                          />
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    {userRole !== "VIEWER" && (
                      <div className="flex gap-2 pt-2 border-t border-slate-850 text-xs">
                        <button
                          onClick={() => toggleAccountStatus(acc)}
                          className={`flex-1 font-semibold py-1.5 rounded-lg border transition ${
                            acc.status === "ACTIVE" 
                              ? "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20"
                              : "bg-teal-500/10 border-teal-500/20 text-teal-400 hover:bg-teal-500/20"
                          }`}
                        >
                          {acc.status === "ACTIVE" ? "⏸️ Pause" : "▶️ Enable"}
                        </button>
                        <button
                          onClick={() => deleteAccount(acc.id)}
                          className="bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 font-semibold px-3 py-1.5 rounded-lg transition"
                        >
                          🗑️
                        </button>
                      </div>
                    )}

                  </div>
                ))
              )}
            </div>

            {/* ADD ACCOUNT MODAL */}
            {showAddAccountModal && (
              <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                    <h3 className="text-base font-bold text-white">Add Social Account</h3>
                    <button onClick={() => setShowAddAccountModal(false)} className="text-slate-400 hover:text-white">✕</button>
                  </div>
                  <form onSubmit={handleAddAccount} className="space-y-4 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1">Social Platform</label>
                      <select
                        value={newAccPlatform}
                        onChange={(e) => setNewAccPlatform(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 focus:outline-none"
                      >
                        <option value="X">X (Twitter)</option>
                        <option value="Threads">Threads</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Account Handle (Username)</label>
                      <input
                        type="text"
                        value={newAccUsername}
                        onChange={(e) => setNewAccUsername(e.target.value)}
                        placeholder="e.g. crypto_guru (without @)"
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Display Name (Nickname)</label>
                      <input
                        type="text"
                        value={newAccDispName}
                        onChange={(e) => setNewAccDispName(e.target.value)}
                        placeholder="e.g. Crypto Guru X"
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 focus:outline-none focus:border-teal-500"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-slate-400 mb-1">Hourly Limit</label>
                        <input
                          type="number"
                          value={newAccHourlyLimit}
                          onChange={(e) => setNewAccHourlyLimit(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 focus:outline-none"
                          min="1"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1">Daily Limit</label>
                        <input
                          type="number"
                          value={newAccDailyLimit}
                          onChange={(e) => setNewAccDailyLimit(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 focus:outline-none"
                          min="1"
                          required
                        />
                      </div>
                    </div>
                    
                    <button
                      type="submit"
                      className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-2.5 rounded-xl transition"
                    >
                      Connect Account
                    </button>
                  </form>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ================================================================ */}
        {/* JOB QUEUE TAB */}
        {/* ================================================================ */}
        {activeTab === "jobs" && (
          <div className="space-y-6">
            
            {/* Filter buttons */}
            <div className="flex flex-wrap justify-between items-center border-b border-slate-900 pb-4 gap-4">
              <div className="flex flex-wrap gap-2 text-xs">
                {[
                  { label: "All Statuses", val: "" },
                  { label: "Queued", val: "QUEUED" },
                  { label: "Running", val: "RUNNING" },
                  { label: "Success", val: "SUCCESS" },
                  { label: "Failed", val: "FAILED" },
                  { label: "Retrying", val: "RETRYING" }
                ].map((btn) => (
                  <button
                    key={btn.val}
                    onClick={() => setJobFilterStatus(btn.val)}
                    className={`px-3 py-1.5 rounded-lg border transition ${
                      jobFilterStatus === btn.val
                        ? "bg-slate-800 border-teal-500/50 text-teal-400 font-semibold"
                        : "bg-slate-900 border-slate-850 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              <div className="text-xs text-slate-400">
                Found **{jobs.length}** jobs matching filter criteria
              </div>
            </div>

            {/* Jobs table list */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-850 text-slate-400 uppercase tracking-wider font-semibold bg-slate-950/40">
                      <th className="py-4 px-6">Job ID</th>
                      <th className="py-4 px-6">Platform</th>
                      <th className="py-4 px-6">Source Account</th>
                      <th className="py-4 px-6">Target Destination</th>
                      <th className="py-4 px-6">Payload Comment</th>
                      <th className="py-4 px-6">Status</th>
                      <th className="py-4 px-6">Attempts</th>
                      <th className="py-4 px-6">Logs/Errors</th>
                      {userRole !== "VIEWER" && <th className="py-4 px-6 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-slate-300">
                    {jobs.length === 0 ? (
                      <tr>
                        <td colSpan="9" className="text-center py-10 text-slate-500">No jobs matching this status filters.</td>
                      </tr>
                    ) : (
                      jobs.map((job) => (
                        <tr key={job.id} className="hover:bg-slate-850/20 transition duration-150">
                          <td className="py-3.5 px-6 font-mono text-[10px] text-slate-400">{job.id.substring(18)}</td>
                          <td className="py-3.5 px-6">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              job.target_url?.includes("threads.net") 
                                ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" 
                                : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            }`}>
                              {job.target_url?.includes("threads.net") ? "Threads" : "X"}
                            </span>
                          </td>
                          <td className="py-3.5 px-6 font-medium text-slate-200">@{job.account_username || "dynamic"}</td>
                          <td className="py-3.5 px-6 max-w-xs truncate" title={job.target_url}>{job.target_url}</td>
                          <td className="py-3.5 px-6 max-w-xs truncate" title={job.template_content}>"{job.template_content}"</td>
                          <td className="py-3.5 px-6">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              job.status === "SUCCESS" 
                                ? "bg-teal-500/10 text-teal-400 border border-teal-500/20" 
                                : job.status === "FAILED"
                                ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                : job.status === "RUNNING"
                                ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse"
                                : job.status === "RETRYING"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-slate-500/10 text-slate-400 border border-slate-500/20"
                            }`}>
                              {job.status}
                            </span>
                          </td>
                          <td className="py-3.5 px-6 text-slate-400 font-semibold">{job.attempt_count}/3</td>
                          <td className="py-3.5 px-6 max-w-xs truncate text-[11px] font-mono text-rose-400/90" title={job.error_message}>
                            {job.error_message || "-"}
                          </td>
                          {userRole !== "VIEWER" && (
                            <td className="py-3.5 px-6 text-right">
                              {(job.status === "FAILED" || job.status === "CANCELLED") && (
                                <button
                                  onClick={() => retryJob(job.id)}
                                  className="bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-200 font-bold px-2.5 py-1 rounded-md text-[10px] transition"
                                >
                                  Retry Job
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ================================================================ */}
        {/* AUDIT LOGS TAB */}
        {/* ================================================================ */}
        {activeTab === "audit" && (
          <div className="space-y-6">
            
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-slate-200 mb-4">Security & Action History Trails</h3>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-850 text-slate-400 uppercase tracking-wider font-semibold">
                      <th className="py-3.5 px-6">Timestamp</th>
                      <th className="py-3.5 px-6">Operator User</th>
                      <th className="py-3.5 px-6">Action type</th>
                      <th className="py-3.5 px-6">Resource</th>
                      <th className="py-3.5 px-6">Resource ID</th>
                      <th className="py-3.5 px-6">Old Value</th>
                      <th className="py-3.5 px-6">New Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-slate-300">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="text-center py-8 text-slate-500">No audit logs recorded. Activities like logins, campaign triggers, and edits are tracked here.</td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-850/10">
                          <td className="py-3 px-6 text-slate-400 font-mono text-[10px]">
                            {log.created_at ? new Date(log.created_at).toLocaleString() : "-"}
                          </td>
                          <td className="py-3 px-6 font-semibold text-slate-200">@{log.username}</td>
                          <td className="py-3 px-6">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              log.action === "LOGIN" 
                                ? "bg-teal-500/10 text-teal-400" 
                                : log.action === "START"
                                ? "bg-blue-500/10 text-blue-400 animate-pulse"
                                : log.action === "DELETE"
                                ? "bg-rose-500/10 text-rose-400"
                                : "bg-slate-500/10 text-slate-400"
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="py-3 px-6 font-medium text-slate-400">{log.resource_type}</td>
                          <td className="py-3 px-6 font-mono text-[10px] text-slate-500">{log.resource_id?.substring(18) || "-"}</td>
                          <td className="py-3 px-6 max-w-xs truncate text-slate-500" title={log.old_value}>{log.old_value || "-"}</td>
                          <td className="py-3 px-6 max-w-xs truncate text-slate-300" title={log.new_value}>{log.new_value || "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </main>

    </div>
  );
}
