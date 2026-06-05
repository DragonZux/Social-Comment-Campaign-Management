"use client";

import { useState, useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

const detectAccountPlatform = (value) => {
  const text = value.toLowerCase();
  if (text.includes("threads.net") || text.includes("threads.com") || text.includes("sessionid=") || text.includes("session_id=") || text.includes('"sessionid"') || text.includes('"session_id"')) return "Threads";
  if (text.includes("x.com") || text.includes("twitter.com") || text.includes("auth_token=") || text.includes("ct0=") || text.includes('"auth_token"') || text.includes('"ct0"')) return "X";
  return null;
};

const extractAccountUsername = (value) => {
  const raw = value.trim();
  const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com|threads\.net|threads\.com)\/@?([A-Za-z0-9_\\.]+)/i);
  if (urlMatch?.[1]) {
    return urlMatch[1].replace(/[/?#].*$/, "").replace(/\.$/, "");
  }

  const atMatch = raw.match(/@([A-Za-z0-9_\\.]+)/);
  if (atMatch?.[1]) return atMatch[1].replace(/\.$/, "");

  const firstToken = raw.split(/[\s,;|]+/).find((part) => /^[A-Za-z0-9_\\.]{2,}$/.test(part));
  return firstToken ? firstToken.replace(/^@/, "").replace(/\.$/, "") : "";
};

const extractAccountCookie = (value) => {
  const lines = value.split(/\r?\n/);
  const cookieLines = lines.filter(line => line.includes("\t") || line.trim().startsWith("#"));
  if (cookieLines.length > 0) {
    return cookieLines.join("\n").trim();
  }

  const jsonStart = value.search(/\[\s*\{/);
  if (jsonStart >= 0) return value.slice(jsonStart).trim();
  const jsonObjectStart = value.search(/\{\s*"/);
  if (jsonObjectStart >= 0) return value.slice(jsonObjectStart).trim();

  const cookieStart = value.search(/(?:auth_token|ct0|sessionid|session_id|csrf_token|csrftoken|ds_user_id)=/i);
  return cookieStart >= 0 ? value.slice(cookieStart).trim() : "";
};


// Cải thiện parser cookie - xử lý 3 format chính
const parseCookieMap = (value) => {
  const raw = (value || "").trim();
  if (!raw) return {};

  // Format 1: JSON Array [{ name, value }, ...]
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.reduce((cookies, item) => {
          if (item && typeof item.name === "string" && typeof item.value === "string") {
            cookies[item.name.trim()] = item.value;
          }
          return cookies;
        }, {});
      }
    } catch (e) {
      console.warn("Failed to parse JSON array format:", e.message);
    }
  }

  // Format 2: JSON Object with optional .cookies array
  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw);
      const source = Array.isArray(parsed.cookies) ? parsed.cookies : parsed;

      if (Array.isArray(source)) {
        return source.reduce((cookies, item) => {
          if (item && typeof item.name === "string" && typeof item.value === "string") {
            cookies[item.name.trim()] = item.value;
          }
          return cookies;
        }, {});
      }

      return Object.entries(source).reduce((cookies, [name, value]) => {
        if (typeof value === "string" || typeof value === "number") {
          cookies[name.trim()] = String(value);
        }
        return cookies;
      }, {});
    } catch (e) {
      console.warn("Failed to parse JSON object format:", e.message);
    }
  }

  // Format 3: Netscape Cookie File Format (tab-separated)
  if (raw.includes("\t")) {
    const cookies = {};
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      
      // Xóa prefix #HttpOnly_ nếu có
      if (trimmed.startsWith("#HttpOnly_")) {
        trimmed = trimmed.substring(10).trim();
      }
      
      const parts = trimmed.split(/\t+/);
      if (parts.length >= 7) {
        const name = parts[5]?.trim();
        const value = parts[6]?.trim();
        if (name && value) cookies[name] = value;
      } else if (parts.length === 6) {
        const name = parts[4]?.trim();
        const value = parts[5]?.trim();
        if (name && value) cookies[name] = value;
      }
    }
    if (Object.keys(cookies).length > 0) {
      return cookies;
    }
  }

  // Format 4: Header Cookie String (key=value; key=value; ...)
  let cleanRaw = raw;
  if (raw.toLowerCase().startsWith("cookie:")) {
    cleanRaw = raw.substring(7).trim();
  }
  
  const cookies = {};
  const parts = cleanRaw.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const name = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      if (name) cookies[name] = value;
    }
  }
  
  return cookies;
};

// Converter: JSON Array -> Header String
const convertJsonToHeaderString = (jsonValue) => {
  try {
    if (!jsonValue || typeof jsonValue !== 'string') return '';
    const parsed = JSON.parse(jsonValue);
    const cookies = Array.isArray(parsed) ? 
      parsed.reduce((acc, item) => { if (item?.name && item?.value) acc[item.name] = item.value; return acc; }, {}) :
      parsed;
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  } catch (e) {
    return '';
  }
};

// Converter: Header String -> JSON Array
const convertHeaderToJson = (headerValue) => {
  const cookies = parseCookieMap(headerValue);
  return JSON.stringify(
    Object.entries(cookies).map(([name, value]) => ({ name, value })),
    null,
    2
  );
};

// Converter: Any Format -> Netscape Format
const convertToNetscape = (value) => {
  const cookies = parseCookieMap(value);
  const lines = [
    "# Netscape HTTP Cookie File",
    "# http://curl.haxx.se/rfc/cookie_spec.html",
    "# This file was generated by Cookie Editor"
  ];
  
  Object.entries(cookies).forEach(([name, val]) => {
    // Mặc định: domain=.threads.com hoặc .twitter.com, path=/, expiry=future date
    const domain = ".threads.com"; // Có thể detect từ cookie
    const path = "/";
    const expiry = Math.floor(Date.now() / 1000) + 86400 * 365; // 1 năm
    const httpOnly = ["sessionid", "ps_n", "ps_l", "ig_did"].includes(name) ? "#HttpOnly_" : "";
    const secure = "TRUE";
    const hostOnly = "FALSE";
    
    lines.push(`${httpOnly}${domain}\t${hostOnly}\t${path}\t${secure}\t${expiry}\t${name}\t${val}`);
  });
  
  return lines.join("\n");
};

// Converter: Any Format -> JSON Array
const convertToJsonArray = (value) => {
  const cookies = parseCookieMap(value);
  return JSON.stringify(
    Object.entries(cookies).map(([name, val]) => ({
      domain: ".threads.com",
      expirationDate: Math.floor(Date.now() / 1000) + 86400 * 365,
      hostOnly: false,
      httpOnly: ["sessionid", "ps_n", "ps_l", "ig_did"].includes(name),
      name,
      path: "/",
      sameSite: null,
      secure: true,
      session: false,
      storeId: null,
      value: val
    })),
    null,
    2
  );
};

const extractUsernameFromFileName = (fileName) => {
  let name = fileName.replace(/\.[^/.]+$/, ""); // remove extension
  name = name.replace(/_cookie(s)?/i, "").replace(/-cookie(s)?/i, "");
  name = name.replace(/^@/, "");
  // Keep only valid username characters (A-Za-z0-9_.)
  name = name.replace(/[^A-Za-z0-9_.]/g, "");
  return name;
};

const parseCookieFile = (fileName, fileContent) => {
  let metadataUsername = "";
  let metadataPlatform = null;
  const contentTrimmed = (fileContent || "").trim();
  if (contentTrimmed.startsWith("{") && contentTrimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(contentTrimmed);
      if (parsed.username) metadataUsername = parsed.username;
      if (parsed.platform) metadataPlatform = parsed.platform;
    } catch (e) {}
  }

  const parsedCookies = parseCookieMap(fileContent) as any;
  
  // Platform detection
  let platform = metadataPlatform;
  if (!platform) {
    if (parsedCookies.auth_token || parsedCookies.ct0) {
      platform = "X";
    } else if (parsedCookies.sessionid || parsedCookies.session_id || parsedCookies.ds_user_id) {
      platform = "Threads";
    }
  }

  // Keep all cookies to ensure session validity (Meta/X require mid, datr, ds_user_id, twid, etc. for security checks)
  const filteredCookies: any = { ...parsedCookies };

  // Format to standard header cookie string using filtered cookies
  const cookieString = Object.entries(filteredCookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  // Username detection
  let username = metadataUsername;
  if (!username) {
    const fnUsername = extractUsernameFromFileName(fileName);
    
    if (fnUsername && 
        fnUsername.length >= 2 && 
        !["cookie", "cookies", "session", "auth", "twitter", "x", "threads", "netscape", "txt", "json"].includes(fnUsername.toLowerCase()) &&
        !/^\d+$/.test(fnUsername)) {
      username = fnUsername;
    }
  }

  if (!username) {
    // Try to get it from original cookies before filtering
    if (platform === "X" && parsedCookies.twid) {
      const decoded = decodeURIComponent(parsedCookies.twid);
      const match = decoded.match(/u=(\d+)/);
      if (match?.[1]) username = `x_user_${match[1]}`;
    } else {
      const id = parsedCookies.ds_user_id || parsedCookies.user_id || parsedCookies.uid;
      if (id) {
        username = `${platform === "Threads" ? "threads" : "account"}_${String(id).replace(/[^A-Za-z0-9_]/g, "").slice(0, 24)}`;
      }
    }
  }

  if (!username) {
    username = extractUsernameFromFileName(fileName) || "";
  }

  return {
    cookies: filteredCookies,
    cookieString,
    platform,
    username,
    fileName
  };
};



const getCookieStatus = (platform, value) => {
  if (!value) {
    return {
      ok: false,
      label: "Chưa có cookie",
      details: "Chưa nhập cookie.",
      count: 0,
      missing: [],
      cookies: {}
    };
  }

  try {
    const cookies = parseCookieMap(value);
    const required = platform === "Threads" ? ["sessionid"] : ["auth_token", "ct0"];
    const missing = required.filter((key) => !cookies[key]);
    
    // Danh sách cookies khuyến khích
    const recommended = platform === "Threads" 
      ? ["sessionid", "ds_user_id", "csrftoken", "mid", "ig_did"]
      : ["auth_token", "ct0", "twid", "mid", "datr"];
    const hasRecommended = recommended.filter(key => cookies[key]);

    return {
      ok: missing.length === 0,
      label: missing.length === 0 ? "✅ Cookie OK" : "⚠️ Thiếu cookie",
      details: missing.length === 0
        ? `Đầy đủ ${required.length}/${required.length} cookies bắt buộc + ${hasRecommended.length} cookie bảo mật.`
        : `Thiếu: ${missing.join(", ")}`,
      count: Object.keys(cookies).length,
      missing,
      cookies,
      hasRecommended
    };
  } catch (err) {
    return {
      ok: false,
      label: "❌ JSON sai",
      details: err.message,
      count: 0,
      missing: [],
      cookies: {}
    };
  }
};

const splitBulkAccountBlocks = (value) => {
  const normalized = value.trim();
  if (!normalized) return [];

  const jsonBlocks = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "[" || char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    }

    if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = normalized.slice(start, i + 1).trim();
        try {
          JSON.parse(candidate);
          jsonBlocks.push(candidate);
        } catch (err) {
          jsonBlocks.length = 0;
          break;
        }
        start = -1;
      }
    }
  }

  if (jsonBlocks.length > 1) return jsonBlocks;

  const blankLineBlocks = normalized
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blankLineBlocks.length > 1) return blankLineBlocks;

  return normalized
    .split(/\r?\n(?=(?:https?:\/\/|@)[A-Za-z0-9_./:-]+)/)
    .map((block) => block.trim())
    .filter(Boolean);
};

const usernameFromCookies = (platform, cookies, index) => {
  if (platform === "X" && cookies.twid) {
    const decoded = decodeURIComponent(cookies.twid);
    const match = decoded.match(/u=(\d+)/);
    if (match?.[1]) return `x_user_${match[1]}`;
  }

  const id = cookies.ds_user_id || cookies.user_id || cookies.uid || cookies.session_id || cookies.sessionid;
  if (id) return `${platform === "Threads" ? "threads" : "account"}_${String(id).replace(/[^A-Za-z0-9_]/g, "").slice(0, 24)}`;

  return `account_${index + 1}`;
};

const parseBulkAccounts = (value) => {
  return splitBulkAccountBlocks(value)
    .map((block, index) => {
      const platform = detectAccountPlatform(block);
      const cookie = extractAccountCookie(block);
      const cookieStatus = getCookieStatus(platform || "X", cookie);
      let username = extractAccountUsername(block);
      
      let metadataUsername = "";
      if (cookie && cookie.trim().startsWith("{") && cookie.trim().endsWith("}")) {
        try {
          const parsed = JSON.parse(cookie.trim());
          if (parsed.username) metadataUsername = parsed.username;
        } catch (e) {}
      }

      try {
        if (!username && cookie) {
          username = metadataUsername || usernameFromCookies(platform || "X", parseCookieMap(cookie), index);
        }
      } catch (err) {
        // Keep username empty so the row shows the parse error below.
      }
      const errors = [];

      if (!platform) errors.push("Không nhận diện được nền tảng");
      if (!username) errors.push("Không tìm thấy username");
      if (cookie && !cookieStatus.ok) errors.push(cookieStatus.details);

      return {
        line: block,
        index,
        platform,
        username,
        display_name: username,
        cookie,
        cookieStatus,
        valid: errors.length === 0,
        errors
      };
    });
};

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Add Form Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPlatform, setNewPlatform] = useState("X");
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newCookie, setNewCookie] = useState("");
  const [newAccessToken, setNewAccessToken] = useState("");
  const [newThreadsUserId, setNewThreadsUserId] = useState("");
  const [newAuthMode, setNewAuthMode] = useState("cookie"); // cookie, api
  const [newDailyLimit, setNewDailyLimit] = useState(50);
  const [newHourlyLimit, setNewHourlyLimit] = useState(5);
  const [addMode, setAddMode] = useState("single");
  const [bulkAccountsText, setBulkAccountsText] = useState("");
  
  // Preview & Converter Modal State
  const [showCookiePreview, setShowCookiePreview] = useState(false);
  const [previewCookieData, setPreviewCookieData] = useState(null);
  const [previewFormat, setPreviewFormat] = useState("header"); // header, json, netscape
  const [bulkImporting, setBulkImporting] = useState(false);
  const [fileAccounts, setFileAccounts] = useState([]);

  // Add Proxy States
  const [newProxy, setNewProxy] = useState("");

  // Edit Form Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [showSecrets, setShowSecrets] = useState({});

  const toggleSecret = (accountId) => {
    setShowSecrets((prev) => ({
      ...prev,
      [accountId]: !prev[accountId]
    }));
  };
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editCookie, setEditCookie] = useState("");
  const [editDailyLimit, setEditDailyLimit] = useState(50);
  const [editHourlyLimit, setEditHourlyLimit] = useState(5);
  const [checkingId, setCheckingId] = useState(null);
  const [loginLoadingId, setLoginLoadingId] = useState(null);
  const [showLoginScriptModal, setShowLoginScriptModal] = useState(false);
  const [loginScriptContent, setLoginScriptContent] = useState("");
  const [loginScriptProfileUrl, setLoginScriptProfileUrl] = useState("");
  const [showPostModal, setShowPostModal] = useState(false);
  const [postAccountId, setPostAccountId] = useState(null);
  const [postTargetUrl, setPostTargetUrl] = useState("");
  const [postText, setPostText] = useState("");
  const [postingId, setPostingId] = useState(null);

  const [toasts, setToasts] = useState([]);

  const handleMultipleFilesChange = async (e: any) => {
    const files = Array.from((e.target as any).files || []) as any[];
    if (files.length === 0) return;

    const newAccounts = [...fileAccounts];

    for (const file of files) {
      try {
        const text = await file.text();
        const parsed = parseCookieFile(file.name, text);
        
        const platform = parsed.platform || "X";
        const cookieStatus = getCookieStatus(platform, parsed.cookieString);

        const errors = [];
        if (!parsed.platform) errors.push("Không nhận diện được nền tảng (Thiếu ct0/auth_token cho X hoặc sessionid cho Threads)");
        if (!parsed.username) errors.push("Không tìm thấy username");
        if (parsed.cookieString && !cookieStatus.ok) errors.push(cookieStatus.details);

        newAccounts.push({
          id: `${file.name}-${Date.now()}-${Math.random()}`,
          fileName: file.name,
          platform,
          username: parsed.username,
          display_name: parsed.username,
          cookie: parsed.cookieString,
          cookieStatus,
          valid: errors.length === 0 && parsed.cookieString !== "",
          errors
        });
      } catch (err) {
        showToast(`Lỗi đọc file ${file.name}: ${err.message}`, "error");
      }
    }

    setFileAccounts(newAccounts);
    e.target.value = "";
  };

  const updateFileAccount = (id, fields) => {
    setFileAccounts(prev => prev.map(item => {
      if (item.id !== id) return item;
      
      const updated = { ...item, ...fields };
      const cookieStatus = getCookieStatus(updated.platform, updated.cookie);
      const errors = [];
      if (!updated.platform) errors.push("Không nhận diện được nền tảng");
      if (!updated.username.trim()) errors.push("Không tìm thấy username");
      if (updated.cookie && !cookieStatus.ok) errors.push(cookieStatus.details);
      
      updated.cookieStatus = cookieStatus;
      updated.valid = errors.length === 0 && updated.cookie !== "";
      updated.errors = errors;
      return updated;
    }));
  };

  const removeFileAccount = (id) => {
    setFileAccounts(prev => prev.filter(item => item.id !== id));
  };

  const handleFileImportSubmit = async (e) => {
    e.preventDefault();
    const validAccounts = fileAccounts.filter(item => item.valid);
    if (validAccounts.length === 0) {
      showToast("Chưa có tài khoản hợp lệ để thêm.", "error");
      return;
    }

    setBulkImporting(true);
    const failed = [];
    let created = 0;

    for (const item of validAccounts) {
      try {
        await apiFetch("/api/accounts", {
          method: "POST",
          body: JSON.stringify({
            platform: item.platform,
            username: item.username,
            display_name: item.display_name,
            cookie: item.cookie || null,
            proxy: newProxy.trim() || null,
            daily_limit: Number(newDailyLimit),
            hourly_limit: Number(newHourlyLimit)
          })
        });
        created += 1;
      } catch (err) {
        failed.push(`@${item.username}: ${err.message}`);
      }
    }

    setBulkImporting(false);
    if (created > 0) {
      showToast(`Đã thêm ${created} tài khoản từ file. ${failed.length ? `Lỗi ${failed.length} tài khoản.` : ""}`);
      setFileAccounts([]);
      setNewProxy("");
      setShowAddModal(false);
      loadAccounts();
    }
    if (failed.length > 0) {
      failed.forEach((err) => showToast(err, "error"));
    }
  };

  const handleSingleFileChange = async (e: any, type = "add") => {
    const file = (e.target as any).files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseCookieFile(file.name, text);
      
      if (type === "add") {
        if (parsed.platform) setNewPlatform(parsed.platform);
        if (parsed.username) {
          setNewUsername(parsed.username);
          setNewDisplayName(parsed.username);
        }
        setNewCookie(parsed.cookieString);
        showToast(`Đã nạp thành công cookies cho @${parsed.username || "tài khoản"} từ file ${file.name}`);
      } else {
        setEditCookie(parsed.cookieString);
        showToast(`Đã nạp thành công cookies từ file ${file.name}`);
      }
    } catch (err) {
      showToast(`Lỗi đọc file cookie: ${err.message}`, "error");
    }
    e.target.value = "";
  };

  const handleCookieChange = (val: string) => {
    setNewCookie(val);
    if (!val.trim()) return;

    let metadataUsername = "";
    let metadataPlatform = "";
    const trimmedVal = val.trim();
    if (trimmedVal.startsWith("{") && trimmedVal.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmedVal);
        if (parsed.username) metadataUsername = parsed.username;
        if (parsed.platform) metadataPlatform = parsed.platform;
      } catch (e) {}
    }

    try {
      const cookies = parseCookieMap(val) as any;
      let platform = metadataPlatform;
      if (!platform) {
        if (cookies.auth_token || cookies.ct0) {
          platform = "X";
          setNewPlatform("X");
        } else if (cookies.sessionid || cookies.session_id || cookies.ds_user_id) {
          platform = "Threads";
          setNewPlatform("Threads");
        }
      } else {
        setNewPlatform(platform);
      }

      // Keep all cookies to ensure session validity (Meta/X require mid, datr, ds_user_id, twid, etc. for security checks)
      const filteredCookies: any = { ...cookies };

      // Reconstruct clean cookie string if filtered
      if (platform && Object.keys(filteredCookies).length > 0) {
        const cleanString = Object.entries(filteredCookies)
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
        if (cleanString !== val.trim()) {
          setNewCookie(cleanString);
        }
      }

      const plat = platform || newPlatform || "X";
      const detected = metadataUsername || usernameFromCookies(plat, cookies, Date.now() % 1000);
      if (detected && !detected.startsWith("account_")) {
        setNewUsername(detected);
        setNewDisplayName(detected);
      }
    } catch (e) {
      // Ignore temporary parsing errors while typing
    }
  };

  const showToast = (message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  };

  const openCookiePreview = (cookieValue, platform) => {
    if (!cookieValue.trim()) {
      showToast("Chưa có cookie để xem preview", "error");
      return;
    }
    const status = getCookieStatus(platform, cookieValue);
    setPreviewCookieData({
      rawInput: cookieValue,
      status,
      platform
    });
    setShowCookiePreview(true);
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

  const loadAccounts = async () => {
    try {
      const list = await apiFetch("/api/accounts");
      setAccounts(list);
    } catch (err) {
      console.warn(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();

    let platform = newPlatform;
    let username = newUsername.trim();
    let displayName = newDisplayName.trim();

    if (newPlatform === "Threads" && newAuthMode === "api") {
      if (!newAccessToken.trim() || !newThreadsUserId.trim()) {
        showToast("Vui lòng nhập đầy đủ Access Token và Threads User ID.", "error");
        return;
      }
      if (!username) {
        showToast("Vui lòng nhập tên tài khoản (Username) khi sử dụng Graph API.", "error");
        return;
      }
    } else if (newCookie.trim()) {
      const cookies = parseCookieMap(newCookie);
      if (cookies.auth_token || cookies.ct0) {
        platform = "X";
      } else if (cookies.sessionid || cookies.session_id) {
        platform = "Threads";
      }

      if (!username) {
        username = usernameFromCookies(platform, cookies, Date.now() % 1000);
      }
    }

    if (!username) {
      username = `account_${Date.now()}`;
    }
    if (!displayName) {
      displayName = username;
    }

    try {
      await apiFetch("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          platform,
          username,
          display_name: displayName,
          cookie: (newPlatform === "Threads" && newAuthMode === "api") ? null : (newCookie.trim() || null),
          access_token: (newPlatform === "Threads" && newAuthMode === "api") ? newAccessToken.trim() : null,
          threads_user_id: (newPlatform === "Threads" && newAuthMode === "api") ? newThreadsUserId.trim() : null,
          proxy: newProxy.trim() || null,
          daily_limit: Number(newDailyLimit),
          hourly_limit: Number(newHourlyLimit)
        })
      });
      showToast("Thêm tài khoản thành công!");
      setNewUsername("");
      setNewDisplayName("");
      setNewCookie("");
      setNewAccessToken("");
      setNewThreadsUserId("");
      setNewAuthMode("cookie");
      setNewProxy("");
      setShowAddModal(false);
      loadAccounts();
    } catch (err) {
      showToast(err.message, "error");
    }
  };


  const bulkPreview = parseBulkAccounts(bulkAccountsText);
  const validBulkAccounts = bulkPreview.filter((item) => item.valid);
  const newCookieStatus = getCookieStatus(newPlatform, newCookie);
  const editCookieStatus = getCookieStatus(editingAccount?.platform || "X", editCookie);

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
            proxy: newProxy.trim() || null,
            daily_limit: Number(newDailyLimit),
            hourly_limit: Number(newHourlyLimit)
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
      setNewProxy("");
      setShowAddModal(false);
      loadAccounts();
    }
    if (failed.length > 0) {
      failed.forEach((err) => showToast(err, "error"));
    }
  };

  const openEditModal = async (acc) => {
    try {
      const detail = await apiFetch(`/api/accounts/${acc.id}`);
      setEditingAccount(detail);
      setEditDisplayName(detail.display_name || "");
      setEditCookie(detail.cookie || "");
      setEditDailyLimit(detail.daily_limit || 50);
      setEditHourlyLimit(detail.hourly_limit || 5);
      setShowEditModal(true);
    } catch (err) {
      showToast(err.message || "Không tải được thông tin tài khoản.", "error");
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      const payload: any = {
        display_name: editDisplayName,
        daily_limit: Number(editDailyLimit),
        hourly_limit: Number(editHourlyLimit)
      };
      if (editCookie.trim()) payload.cookie = editCookie.trim();

      await apiFetch(`/api/accounts/${editingAccount.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
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
    // Try backend auto-login first (requires server Playwright). If it starts, we consider it handled.
    setLoginLoadingId(accountId);
    try {
      const res = await apiFetch(`/api/accounts/${accountId}/auto-login`, { method: "POST" });
      if (res && res.message) {
        showToast(res.message, "success");
        setLoginLoadingId(null);
        return;
      }
    } catch (err) {
      // ignore and fallback to client method
    }

    // Fallback: client-side script copy + open page for manual paste
    const profileUrl = platform === "X" 
      ? `https://x.com/${username}` 
      : `https://www.threads.net/@${username}`;
    const newTab = window.open("about:blank", "_blank");
    if (!newTab) {
      showToast("Trình duyệt chặn popup. Vui lòng cho phép mở tab mới rồi thử lại.", "error");
      setLoginLoadingId(null);
      return;
    }

    try {
      const data = await apiFetch(`/api/accounts/${accountId}/login-script`);
      let copied = false;

      try {
        window.focus();
        await navigator.clipboard.writeText(data.script);
        copied = true;
      } catch (clipboardErr) {
        const textArea = document.createElement("textarea");
        textArea.value = data.script;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      if (copied) {
        showToast(
          `✅ Đã sao chép script đăng nhập (${data.cookie_count} cookies) vào clipboard! Mở tab mới → F12 → Console → Ctrl+V → Enter để đăng nhập.`,
          "success"
        );
      } else {
        showToast(
          "⚠️ Không thể sao chép tự động. Script đăng nhập sẽ được hiển thị để bạn dán thủ công.",
          "warning"
        );
        setLoginScriptContent(data.script);
        setLoginScriptProfileUrl(profileUrl);
        setShowLoginScriptModal(true);
      }

      newTab.location.href = profileUrl;
    } catch (err) {
      showToast(err.message || "Lỗi khi tạo script đăng nhập.", "error");
      if (newTab && !newTab.closed) {
        newTab.close();
      }
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
        <button
          onClick={() => setShowAddModal(true)}
          className="h-12 bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold px-5 rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none"
        >
          + Kết nối tài khoản mạng xã hội
        </button>
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
              className="bg-gray-50 border border-gray-200 rounded-lg p-6 shadow-none transition-all duration-200 hover:scale-[1.02] relative overflow-hidden flex flex-col justify-between min-h-[450px] h-auto pb-6"
            >
              
              {/* Badge Top-right */}
              <div className="absolute top-6 right-6 flex items-center space-x-2">
                <span className={`px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                  acc.has_access_token
                    ? "bg-purple-50 text-purple-700 border border-purple-200"
                    : acc.has_cookie 
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}>
                  {acc.has_access_token ? "Đã cấu hình Token" : acc.has_cookie ? "Đã cấu hình Cookie" : "Chưa cấu hình"}
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

              {acc.has_access_token ? (
                acc.status === "ERROR" ? (
                  <div className="mx-1 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-[11px] font-bold text-red-700 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span>Graph API token (Lỗi/Hết hạn)</span>
                      <button 
                        type="button" 
                        onClick={() => toggleSecret(acc.id)}
                        className="text-[10px] font-extrabold uppercase bg-red-100 hover:bg-red-200 px-2 py-0.5 rounded cursor-pointer transition-all text-red-700 shrink-0"
                      >
                        {showSecrets[acc.id] ? "👁️ Ẩn" : "👁️ Hiện"}
                      </button>
                    </div>
                    {showSecrets[acc.id] && acc.access_token && (
                      <div className="bg-white/60 p-2 rounded font-mono text-[10px] break-all select-all font-semibold border border-red-100 text-red-700">
                        {acc.access_token}
                      </div>
                    )}
                    <div className="flex justify-between items-center gap-1.5 text-[9px] text-red-500 font-extrabold uppercase tracking-wide">
                      <span>{acc.has_threads_user_id ? "Đã cấu hình User ID" : "Thiếu User ID"}</span>
                    </div>
                    <p className="mt-1 font-semibold">Vui lòng cập nhật token mới để thay thế.</p>
                  </div>
                ) : (
                  <div className="mx-1 rounded-md border border-purple-200 bg-purple-50 px-3.5 py-3 text-[11px] font-bold text-purple-700 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span>Đã cấu hình Graph API Token</span>
                      <button 
                        type="button" 
                        onClick={() => toggleSecret(acc.id)}
                        className="text-[10px] font-extrabold uppercase bg-purple-100 hover:bg-purple-200 px-2 py-0.5 rounded cursor-pointer transition-all text-purple-700 shrink-0"
                      >
                        {showSecrets[acc.id] ? "👁️ Ẩn" : "👁️ Hiện"}
                      </button>
                    </div>
                    {showSecrets[acc.id] ? (
                      <div className="bg-white/60 p-2 rounded font-mono text-[10px] break-all select-all font-semibold border border-purple-100">
                        {acc.access_token}
                      </div>
                    ) : (
                      <p className="mt-1 font-semibold">Giá trị bí mật được ẩn để bảo mật.</p>
                    )}
                    <div className="flex justify-between items-center gap-1.5 text-[9px] text-purple-500 font-extrabold uppercase tracking-wide">
                      <span>{acc.has_threads_user_id ? "Đã cấu hình User ID" : "Thiếu User ID"}</span>
                    </div>
                  </div>
                )
              ) : acc.has_cookie ? (
                acc.status === "ERROR" ? (
                  <div className="mx-1 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-[11px] font-bold text-red-700 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span>Session cookie (Lỗi/Hết hạn)</span>
                      <button 
                        type="button" 
                        onClick={() => toggleSecret(acc.id)}
                        className="text-[10px] font-extrabold uppercase bg-red-100 hover:bg-red-200 px-2 py-0.5 rounded cursor-pointer transition-all text-red-700 shrink-0"
                      >
                        {showSecrets[acc.id] ? "👁️ Ẩn" : "👁️ Hiện"}
                      </button>
                    </div>
                    {showSecrets[acc.id] && acc.cookie && (
                      <div className="bg-white/60 p-2 rounded font-mono text-[10px] break-all select-all font-semibold border border-red-100 text-red-700 max-h-24 overflow-y-auto">
                        {acc.cookie}
                      </div>
                    )}
                    <p className="mt-1 font-semibold">Vui lòng cập nhật cookie mới để thay thế.</p>
                  </div>
                ) : (
                  <div className="mx-1 rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[11px] font-bold text-emerald-700 space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span>Đã cấu hình Session Cookie</span>
                      <button 
                        type="button" 
                        onClick={() => toggleSecret(acc.id)}
                        className="text-[10px] font-extrabold uppercase bg-emerald-100 hover:bg-emerald-200 px-2 py-0.5 rounded cursor-pointer transition-all text-emerald-700 shrink-0"
                      >
                        {showSecrets[acc.id] ? "👁️ Ẩn" : "👁️ Hiện"}
                      </button>
                    </div>
                    {showSecrets[acc.id] ? (
                      <div className="bg-white/60 p-2 rounded font-mono text-[10px] break-all select-all font-semibold border border-emerald-100 text-emerald-800 max-h-24 overflow-y-auto">
                        {acc.cookie || "Không có nội dung cookie"}
                      </div>
                    ) : (
                      <p className="mt-1 font-semibold">Chỉ cập nhật cookie khi bạn muốn thay thế.</p>
                    )}
                  </div>
                )
              ) : (
                <div className="mx-1 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 text-[11px] font-bold text-amber-700">
                  ⚠️ Chưa cấu hình Cookie hoặc Token.
                </div>
              )}

              {acc.has_proxy && (
                <div className="mx-1 rounded-md border border-blue-100 bg-blue-50/50 px-3 py-1.5 text-[11px] font-bold text-blue-700 flex items-center gap-1.5">
                  <span className="shrink-0">🌐 Proxy:</span>
                  <span className="font-mono truncate">Đã cấu hình</span>
                </div>
              )}

              {acc.status === "ERROR" && acc.error_message && (
                <div className="mx-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600 leading-snug">
                  ⚠️ Lỗi: {acc.error_message}
                </div>
              )}

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
                      disabled={loginLoadingId === acc.id || !acc.has_cookie}
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

                    <div className="flex items-center">
                      <button
                        onClick={() => { setShowPostModal(true); setPostAccountId(acc.id); setPostTargetUrl(''); setPostText(''); }}
                        className="ml-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 font-extrabold rounded-md px-3 h-10 transition-all duration-200 hover:scale-[1.02] text-xs"
                      >
                        💬 Post
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

            </div>
          ))
        )}
      </div>

      {/* ADD MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className={`bg-white border border-gray-200 rounded-lg w-full p-8 space-y-5 shadow-none animate-slide-up transition-all ${
            addMode === "file" ? "max-w-2xl" : "max-w-md"
          }`}>
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="text-base font-extrabold text-gray-900 uppercase tracking-tight">Thêm tài khoản mạng xã hội</h3>
              <button 
                onClick={() => setShowAddModal(false)} 
                className="text-gray-400 hover:text-gray-900 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 bg-gray-100 border border-gray-200 rounded-md p-1">
              <button
                type="button"
                onClick={() => setAddMode("single")}
                className={`h-10 rounded text-[11px] font-extrabold transition-all cursor-pointer ${
                  addMode === "single" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Một tài khoản
              </button>
              <button
                type="button"
                onClick={() => setAddMode("file")}
                className={`h-10 rounded text-[11px] font-extrabold transition-all cursor-pointer ${
                  addMode === "file" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Nhập từ file
              </button>
              <button
                type="button"
                onClick={() => setAddMode("bulk")}
                className={`h-10 rounded text-[11px] font-extrabold transition-all cursor-pointer ${
                  addMode === "bulk" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                }`}
              >
                Nhập hàng loạt
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


              {newPlatform === "Threads" && (
                <div className="grid grid-cols-2 gap-2 bg-gray-100 border border-gray-200 rounded-md p-1">
                  <button
                    type="button"
                    onClick={() => setNewAuthMode("cookie")}
                    className={`h-9 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
                      newAuthMode === "cookie" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    Sử dụng Cookie
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewAuthMode("api")}
                    className={`h-9 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
                      newAuthMode === "api" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    Graph API (Chính thức)
                  </button>
                </div>
              )}

              {newPlatform === "Threads" && newAuthMode === "api" ? (
                <>
                  <div>
                    <label className="block mb-1.5 ml-0.5">Tên tài khoản Threads (Username)</label>
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="Ví dụ: havyxing206"
                      className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                      required
                    />
                  </div>

                  <div>
                    <label className="block mb-1.5 ml-0.5">Threads Access Token (Mã truy cập dài hạn)</label>
                    <textarea
                      value={newAccessToken}
                      onChange={(e) => setNewAccessToken(e.target.value)}
                      placeholder="Nhập Access Token được sinh ra từ Meta for Developers..."
                      rows={3}
                      className="w-full bg-gray-100 border border-gray-200 rounded-md p-3 text-xs font-mono font-medium text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block mb-1.5 ml-0.5">Threads User ID (ID người dùng)</label>
                    <input
                      type="text"
                      value={newThreadsUserId}
                      onChange={(e) => setNewThreadsUserId(e.target.value)}
                      placeholder="Ví dụ: 17841400000000000"
                      className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                      required
                    />
                  </div>
                </>
              ) : (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block ml-0.5">Chuỗi Session Cookie (Tùy chọn)</label>
                    <label className="text-[#3B82F6] hover:text-blue-600 cursor-pointer flex items-center gap-1 text-[11px] font-bold">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Nhập từ file
                      <input
                        type="file"
                        accept=".json,.txt,.cookie,*"
                        className="hidden"
                        onChange={(e) => handleSingleFileChange(e, "add")}
                      />
                    </label>
                  </div>
                  <textarea
                    value={newCookie}
                    onChange={(e) => handleCookieChange(e.target.value)}
                    placeholder="Nhập chuỗi cookie hoặc kéo thả file vào đây (Ví dụ: auth_token=...; ct0=...)"
                    rows={3}
                    className="w-full bg-gray-100 border border-gray-200 rounded-md p-3 text-xs font-mono font-medium text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                  />
                  <span className="text-[10px] text-gray-400 font-medium mt-1 block">X yêu cầu các khoá &apos;ct0&apos; và &apos;auth_token&apos;. Threads yêu cầu &apos;sessionid&apos;.</span>
                </div>
              )}

              {newCookie.trim() && (
                <div className={`rounded-md border px-3 py-2 text-[11px] font-bold ${
                  newCookieStatus.ok
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : "bg-amber-50 border-amber-200 text-amber-700"
                }`}>
                  <div className="flex items-center justify-between gap-3">
                    <span>{newCookieStatus.label}</span>
                    <span>{newCookieStatus.count} cookies</span>
                  </div>
                  <p className="mt-1 font-semibold">{newCookieStatus.details}</p>
                  <button
                    type="button"
                    onClick={() => openCookiePreview(newCookie, newPlatform)}
                    className="mt-2 text-[10px] font-bold text-blue-600 hover:text-blue-700 underline cursor-pointer"
                  >
                    👁️ Xem chi tiết cookies ({newCookieStatus.count} items)
                  </button>
                </div>
              )}

              <div>
                <label className="block mb-1.5 ml-0.5">Proxy kết nối (Tùy chọn)</label>
                <input
                  type="text"
                  value={newProxy}
                  onChange={(e) => setNewProxy(e.target.value)}
                  placeholder="Ví dụ: http://user:pass@ip:port hoặc http://ip:port"
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                />
                <span className="text-[10px] text-gray-400 font-medium mt-1 block">Hỗ trợ các định dạng proxy HTTP/HTTPS. Định dạng: http://[user:pass@]ip:port</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 ml-0.5">Giới hạn theo giờ</label>
                  <input
                    type="number"
                    value={newHourlyLimit}
                    onChange={(e) => setNewHourlyLimit(Number(e.target.value))}
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
                    onChange={(e) => setNewDailyLimit(Number(e.target.value))}
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
            ) : addMode === "file" ? (
            <form onSubmit={handleFileImportSubmit} className="space-y-4 text-xs font-bold text-gray-600">
              <div>
                <label className="block mb-1.5 ml-0.5">Chọn một hoặc nhiều file Cookie (JSON, Netscape, TXT)</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-all cursor-pointer relative bg-gray-50">
                  <input
                    type="file"
                    multiple
                    accept=".json,.txt,.cookie,*"
                    onChange={handleMultipleFilesChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="space-y-1">
                    <svg className="mx-auto h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-xs text-gray-600 font-extrabold">Kéo thả hoặc click để chọn các file cookie</p>
                    <p className="text-[10px] text-gray-400">Hỗ trợ file JSON (EditThisCookie), Netscape (.txt), và Header cookie string</p>
                  </div>
                </div>
              </div>

              {fileAccounts.length > 0 && (
                <div className="border border-gray-200 rounded-md overflow-hidden bg-white">
                  <div className="flex items-center justify-between bg-gray-50 px-3 py-2 border-b border-gray-200">
                    <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500">Danh sách tài khoản trong file ({fileAccounts.filter(a => a.valid).length}/{fileAccounts.length} hợp lệ)</span>
                    <button
                      type="button"
                      onClick={() => setFileAccounts([])}
                      className="text-red-500 hover:text-red-650 text-[10px] font-extrabold cursor-pointer"
                    >
                      Xóa tất cả
                    </button>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-150">
                    {fileAccounts.map((item) => (
                      <div key={item.id} className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-extrabold text-gray-900 truncate max-w-[200px]" title={item.fileName}>
                            📂 {item.fileName}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFileAccount(item.id)}
                            className="text-red-500 hover:text-red-650 text-xs font-bold cursor-pointer"
                          >
                            ✕ Xóa
                          </button>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[9px] text-gray-400 uppercase tracking-wide font-extrabold mb-1">Nền tảng</label>
                            <select
                              value={item.platform}
                              onChange={(e) => updateFileAccount(item.id, { platform: e.target.value })}
                              className="w-full h-8 bg-gray-100 border border-gray-200 rounded px-1.5 text-[11px] font-bold text-gray-900 focus:bg-white focus:outline-none"
                            >
                              <option value="X">X (Twitter)</option>
                              <option value="Threads">Threads</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[9px] text-gray-400 uppercase tracking-wide font-extrabold mb-1">Username</label>
                            <input
                              type="text"
                              value={item.username}
                              onChange={(e) => updateFileAccount(item.id, { username: e.target.value, display_name: e.target.value })}
                              placeholder="Username"
                              className="w-full h-8 bg-gray-100 border border-gray-200 rounded px-2 text-[11px] font-semibold text-gray-900 focus:bg-white focus:outline-none"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] text-gray-400 uppercase tracking-wide font-extrabold mb-1">Trạng thái</label>
                            <div className="h-8 flex items-center">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase border truncate ${
                                item.cookieStatus.ok
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`} title={item.cookieStatus.details}>
                                {item.cookieStatus.label}
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        {item.errors.length > 0 && (
                          <div className="text-[10px] text-red-500 font-semibold leading-tight mt-1 space-y-0.5">
                            {item.errors.map((err, idx) => (
                              <div key={idx} className="flex items-center gap-1">
                                <span>⚠️</span>
                                <span>{err}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block mb-1.5 ml-0.5">Proxy kết nối (Áp dụng cho tất cả tài khoản trong file, tùy chọn)</label>
                <input
                  type="text"
                  value={newProxy}
                  onChange={(e) => setNewProxy(e.target.value)}
                  placeholder="Ví dụ: http://user:pass@ip:port hoặc http://ip:port"
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all mb-4"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 ml-0.5">Giới hạn theo giờ</label>
                  <input
                    type="number"
                    value={newHourlyLimit}
                    onChange={(e) => setNewHourlyLimit(Number(e.target.value))}
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
                    onChange={(e) => setNewDailyLimit(Number(e.target.value))}
                    className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all"
                    min="1"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={bulkImporting || fileAccounts.filter(a => a.valid).length === 0}
                className="w-full h-12 bg-[#3B82F6] hover:bg-blue-600 text-white font-extrabold rounded-md text-xs transition-all duration-200 hover:scale-105 cursor-pointer shadow-none disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {bulkImporting ? "Đang thêm tài khoản..." : `Thêm ${fileAccounts.filter(a => a.valid).length} tài khoản hợp lệ`}
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
                  rows={8}
                  className="w-full bg-gray-100 border border-gray-200 rounded-md p-3 text-xs font-mono font-medium text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all resize-none"
                />
                <span className="text-[10px] text-gray-400 font-medium mt-1 block">
                  Hệ thống tự nhận diện X bằng x.com/twitter.com/auth_token/ct0 và Threads bằng threads.net/sessionid.
                </span>
              </div>

              <div>
                <label className="block mb-1.5 ml-0.5">Proxy kết nối (Áp dụng cho toàn bộ tài khoản nhập, tùy chọn)</label>
                <input
                  type="text"
                  value={newProxy}
                  onChange={(e) => setNewProxy(e.target.value)}
                  placeholder="Ví dụ: http://user:pass@ip:port hoặc http://ip:port"
                  className="w-full h-11 bg-gray-100 border border-gray-200 rounded-md px-4 text-xs font-semibold text-gray-900 focus:bg-white focus:border-2 focus:border-[#3B82F6] focus:outline-none transition-all mb-4"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1.5 ml-0.5">Giới hạn theo giờ</label>
                  <input
                    type="number"
                    value={newHourlyLimit}
                    onChange={(e) => setNewHourlyLimit(Number(e.target.value))}
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
                    onChange={(e) => setNewDailyLimit(Number(e.target.value))}
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
                              <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold uppercase border ${
                                item.cookieStatus.ok
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}>
                                {item.cookieStatus.label}
                              </span>
                            )}
                          </div>
                          {!item.valid && (
                            <div className="text-[10px] text-red-500 font-semibold mt-1 space-y-0.5">
                              {item.errors.map((err, idx) => (
                                <div key={idx} className="flex items-center gap-1 text-[9px]">
                                  <span>⚠️</span>
                                  <span>{err}</span>
                                </div>
                              ))}
                            </div>
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
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block ml-0.5">{editingAccount?.platform === "Threads" ? "Chuỗi Session Cookie mới (Tùy chọn)" : "Chuỗi Session Cookie mới"}</label>
                  <label className="text-[#3B82F6] hover:text-blue-600 cursor-pointer flex items-center gap-1 text-[11px] font-bold">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Tải từ file
                    <input
                      type="file"
                      accept=".json,.txt,.cookie,*"
                      className="hidden"
                      onChange={(e) => handleSingleFileChange(e, "edit")}
                    />
                  </label>
                </div>
                <textarea
                  value={editCookie}
                  onChange={(e) => setEditCookie(e.target.value)}
                  placeholder="Nhập chuỗi cookie mới"
                  rows={3}
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
                    onChange={(e) => setEditHourlyLimit(Number(e.target.value))}
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
                    onChange={(e) => setEditDailyLimit(Number(e.target.value))}
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

      {/* COOKIE PREVIEW & CONVERTER MODAL */}
      {showCookiePreview && previewCookieData && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white border border-gray-200 rounded-lg max-w-3xl w-full p-8 space-y-5 shadow-none animate-slide-up max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="text-base font-extrabold text-gray-900 uppercase tracking-tight">Chi tiết Cookies ({previewCookieData.status.count} items)</h3>
              <button 
                onClick={() => setShowCookiePreview(false)} 
                className="text-gray-400 hover:text-gray-900 font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Status Summary */}
            <div className={`rounded-md border px-4 py-3 text-[11px] font-bold ${
              previewCookieData.status.ok
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : "bg-amber-50 border-amber-200 text-amber-700"
            }`}>
              <div className="flex items-center justify-between">
                <span>{previewCookieData.status.label}</span>
                <span>Platform: {previewCookieData.platform}</span>
              </div>
              <p className="mt-2 font-semibold">{previewCookieData.status.details}</p>
            </div>

            {/* Cookies Table */}
            <div className="border border-gray-200 rounded-md overflow-hidden">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-gray-500">Danh sách Cookies</span>
                <span className="text-[10px] font-bold text-gray-700">{Object.keys(previewCookieData.status.cookies).length} cookies</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
                {Object.entries(previewCookieData.status.cookies).map(([name, value]) => (
                  <div key={name} className="px-4 py-3 text-xs space-y-1.5 hover:bg-gray-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-gray-900 bg-gray-100 px-2.5 py-1 rounded">{name}</span>
                      <span className="text-[9px] text-gray-400 font-semibold">
                        {String(value).length} chars
                      </span>
                    </div>
                    <div className="bg-gray-50 p-2 rounded border border-gray-200 font-mono text-[9px] text-gray-700 break-all max-h-16 overflow-y-auto">
                      {String(value).substring(0, 200)}
                      {String(value).length > 200 && "..."}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Format Converter */}
            <div className="space-y-3 border-t border-gray-200 pt-4">
              <label className="block text-xs font-bold text-gray-600 mb-2">🔄 Chuyển đổi định dạng Cookie</label>
              <div className="grid grid-cols-3 gap-2 bg-gray-100 border border-gray-200 rounded-md p-1">
                <button
                  type="button"
                  onClick={() => setPreviewFormat("header")}
                  className={`h-10 rounded text-[11px] font-extrabold transition-all cursor-pointer ${
                    previewFormat === "header" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Header String
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFormat("json")}
                  className={`h-10 rounded text-[11px] font-extrabold transition-all cursor-pointer ${
                    previewFormat === "json" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  JSON Array
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFormat("netscape")}
                  className={`h-10 rounded text-[11px] font-extrabold transition-all cursor-pointer ${
                    previewFormat === "netscape" ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-900"
                  }`}
                >
                  Netscape File
                </button>
              </div>

              {/* Converted Output */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-600">Định dạng {previewFormat === "header" ? "Header String" : previewFormat === "json" ? "JSON Array" : "Netscape"}</label>
                  <button
                    type="button"
                    onClick={() => {
                      let output = "";
                      if (previewFormat === "header") {
                        output = Object.entries(previewCookieData.status.cookies).map(([k, v]) => `${k}=${v}`).join("; ");
                      } else if (previewFormat === "json") {
                        output = convertToJsonArray(previewCookieData.rawInput);
                      } else {
                        output = convertToNetscape(previewCookieData.rawInput);
                      }
                      navigator.clipboard.writeText(output);
                      showToast("✅ Đã sao chép vào clipboard!");
                    }}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                  >
                    📋 Sao chép
                  </button>
                </div>
                <textarea
                  readOnly
                  value={
                    previewFormat === "header"
                      ? Object.entries(previewCookieData.status.cookies).map(([k, v]) => `${k}=${v}`).join("; ")
                      : previewFormat === "json"
                      ? convertToJsonArray(previewCookieData.rawInput)
                      : convertToNetscape(previewCookieData.rawInput)
                  }
                  className="w-full h-40 bg-gray-50 border border-gray-200 rounded-md p-3 text-xs font-mono text-gray-700 resize-none"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowCookiePreview(false)}
              className="w-full h-10 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-700 font-bold rounded-md text-xs transition-all cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {showLoginScriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Script đăng nhập thủ công</h3>
                <p className="text-sm text-gray-500">Nếu clipboard không copy được, sao chép thủ công script bên dưới.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLoginScriptModal(false)}
                className="text-gray-400 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="mb-3 text-xs text-gray-600">
              <div>Trang sẽ mở: <span className="font-semibold text-gray-800">{loginScriptProfileUrl}</span></div>
              <div className="mt-1">Mở tab mới, nhấn F12 → Console → paste script → Enter.</div>
            </div>

            <textarea
              readOnly
              value={loginScriptContent}
              className="w-full min-h-[220px] rounded-md border border-gray-200 bg-gray-50 p-3 text-[11px] font-mono text-gray-800"
            />

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(loginScriptContent);
                    showToast("✅ Đã sao chép script vào clipboard!");
                  } catch (err) {
                    showToast("⚠️ Không copy được. Vui lòng sao chép thủ công từ textarea.", "error");
                  }
                }}
                className="rounded-md bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
              >
                Sao chép script
              </button>
              <button
                type="button"
                onClick={() => setShowLoginScriptModal(false)}
                className="rounded-md bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-200"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {showPostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Post comment using account</h3>
                <p className="text-sm text-gray-500">Nhập URL bài viết (Threads/X) và nội dung comment.</p>
              </div>
              <button type="button" onClick={() => setShowPostModal(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Target post URL</label>
                <input value={postTargetUrl} onChange={(e) => setPostTargetUrl(e.target.value)} placeholder="https://www.threads.net/post/..." className="w-full border border-gray-200 rounded-md p-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Comment text</label>
                <textarea value={postText} onChange={(e) => setPostText(e.target.value)} rows={4} className="w-full border border-gray-200 rounded-md p-2 text-sm" />
              </div>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={postingId === postAccountId}
                  onClick={async () => {
                    if (!postAccountId) return;
                    if (!postTargetUrl || !postText) { showToast('Vui lòng nhập URL và nội dung comment.', 'error'); return; }
                    setPostingId(postAccountId);
                    try {
                      const res = await apiFetch(`/api/accounts/${postAccountId}/post-comment`, {
                        method: 'POST',
                        body: JSON.stringify({ target_url: postTargetUrl, text: postText })
                      });
                      showToast('✅ Comment posted: ' + (res.success ? 'OK' : 'Response received'));
                      setShowPostModal(false);
                      loadAccounts();
                    } catch (err) {
                      showToast(err.message || 'Lỗi khi gửi comment', 'error');
                    } finally {
                      setPostingId(null);
                    }
                  }}
                  className={`rounded-md bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition-all ${
                    postingId === postAccountId ? 'opacity-60 cursor-not-allowed' : 'hover:bg-emerald-700'
                  }`}
                >
                  {postingId === postAccountId ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Đang xử lý (Chrome)...
                    </span>
                  ) : 'Gửi comment'}
                </button>
                <button 
                  type="button" 
                  disabled={postingId === postAccountId}
                  onClick={() => setShowPostModal(false)} 
                  className="rounded-md bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Hủy
                </button>
              </div>

              {postingId === postAccountId && (
                <span className="text-[11px] text-amber-600 font-bold animate-pulse">
                  ⚡ Đang chạy trình duyệt ảo để đăng bài, vui lòng đợi 10-15 giây...
                </span>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
