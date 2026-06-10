from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId
from datetime import datetime, timedelta
from typing import List, Optional
import asyncio
import shlex

from app.db.database import get_db
from app.schemas import AccountCreate, AccountUpdate, AccountOut, serialize_doc, serialize_docs
from app.api.routes.auth import get_current_user, write_audit_log
from pydantic import BaseModel

router = APIRouter(prefix="/accounts", tags=["Social Accounts"])


async def check_and_reset_limits(account: dict) -> dict:
    """Reset hourly/daily usage counters if the time window has passed.
    Updates the database and returns the updated account dict."""
    now = datetime.utcnow()
    last_act = account.get("last_activity")
    if isinstance(last_act, str):
        try:
            if last_act.endswith("Z"):
                last_act = last_act[:-1] + "+00:00"
            from datetime import timezone
            dt = datetime.fromisoformat(last_act)
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
            last_act = dt
        except Exception:
            last_act = None

    if not isinstance(last_act, datetime):
        return account

    update_fields = {}

    if last_act.hour != now.hour or (now - last_act) > timedelta(hours=1):
        update_fields["hourly_usage_count"] = 0
        account["hourly_usage_count"] = 0

    if last_act.day != now.day or (now - last_act) > timedelta(days=1):
        update_fields["daily_usage_count"] = 0
        account["daily_usage_count"] = 0

    if update_fields:
        if account.get("status") == "LIMITED":
            update_fields["status"] = "ACTIVE"
            account["status"] = "ACTIVE"
        db = get_db()
        await db.accounts.update_one(
            {"_id": account["_id"]},
            {"$set": update_fields}
        )

    return account


def account_scope(current_user: dict) -> dict:
    return {"owner_id": ObjectId(current_user["id"])}


async def get_account_for_user(account_id: str, current_user: dict):
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=400, detail="Invalid account ID")

    db = get_db()
    query = {"_id": ObjectId(account_id), **account_scope(current_user)}
    account = await db.accounts.find_one(query)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account

@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
async def create_account(
    account_in: AccountCreate,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    owner_id = ObjectId(current_user["id"])
    existing = await db.accounts.find_one({
        "owner_id": owner_id,
        "platform": account_in.platform,
        "username": account_in.username
    })
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account with username {account_in.username} already exists on {account_in.platform}"
        )
    
    account_doc = {
        "platform": account_in.platform,
        "username": account_in.username,
        "display_name": account_in.display_name or account_in.username,
        "cookie": account_in.cookie,
        "access_token": account_in.access_token,
        "threads_user_id": account_in.threads_user_id,
        "proxy": account_in.proxy,
        "status": "ACTIVE",
        "daily_limit": account_in.daily_limit,
        "hourly_limit": account_in.hourly_limit,
        "daily_usage_count": 0,
        "hourly_usage_count": 0,
        "last_activity": None,
        "health_score": 100,
        "owner_id": owner_id,
        "created_at": datetime.utcnow()
    }
    
    result = await db.accounts.insert_one(account_doc)
    account_doc["_id"] = result.inserted_id
    
    await write_audit_log(
        current_user["id"], current_user["username"],
        "CREATE", "ACCOUNT", str(result.inserted_id),
        new_val=f"{account_in.platform}:{account_in.username}"
    )
    
    return serialize_doc(account_doc)

@router.get("")
async def list_accounts(
    platform: str = None,
    status: str = None,
    page: Optional[int] = None,
    limit: Optional[int] = None,
    current_user: dict = Depends(get_current_user)
):
    import math
    db = get_db()
    query = {}
    query.update(account_scope(current_user))
    if platform:
        query["platform"] = platform
    if status:
        query["status"] = status
        
    if page is not None and limit is not None:
        total = await db.accounts.count_documents(query)
        cursor = db.accounts.find(query).sort("created_at", -1).skip((page - 1) * limit).limit(limit)
        accounts = await cursor.to_list(length=limit)
        for i, acc in enumerate(accounts):
            accounts[i] = await check_and_reset_limits(acc)
        return {
            "items": serialize_docs(accounts),
            "total": total,
            "page": page,
            "limit": limit,
            "pages": math.ceil(total / limit) if limit > 0 else 1
        }
    else:
        cursor = db.accounts.find(query).sort("created_at", -1)
        accounts = await cursor.to_list(length=100)
        for i, acc in enumerate(accounts):
            accounts[i] = await check_and_reset_limits(acc)
        return serialize_docs(accounts)

@router.get("/{account_id}", response_model=AccountOut)
async def get_account(
    account_id: str,
    current_user: dict = Depends(get_current_user)
):
    account = await get_account_for_user(account_id, current_user)
    account = await check_and_reset_limits(account)
    return serialize_doc(account)


class CommentIn(BaseModel):
    target_url: str
    text: str


@router.post("/{account_id}/post-comment")
async def post_comment(
    account_id: str,
    comment_in: CommentIn,
    current_user: dict = Depends(get_current_user)
):
    """Post a comment using the stored cookie/access token for the account."""
    account = await get_account_for_user(account_id, current_user)

    platform = account.get("platform")
    username = account.get("username")
    cookie = account.get("cookie")
    proxy = account.get("proxy")
    access_token = account.get("access_token")
    threads_user_id = account.get("threads_user_id")

    from app.services.social_mock import mock_post_comment, SocialAuthError, SocialCheckpointError

    try:
        result = await mock_post_comment(
            platform=platform,
            username=username,
            target_url=comment_in.target_url,
            comment_content=comment_in.text,
            cookie=cookie,
            proxy=proxy,
            access_token=access_token,
            threads_user_id=threads_user_id,
        )
    except SocialAuthError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except SocialCheckpointError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    await write_audit_log(
        current_user["id"], current_user["username"],
        "POST_COMMENT", "ACCOUNT", account_id,
        new_val=f"Posted comment to {comment_in.target_url}"
    )

    return result

@router.post("/{account_id}/auto-login")
async def auto_login_account(
    account_id: str,
    headless: bool = True,
    current_user: dict = Depends(get_current_user)
):
    """Trigger the Playwright auto-login script in background using the account's stored cookie.

    NOTE: This runs Playwright on the server where the backend is running. It will not affect the
    user's local browser. Use only if you have Playwright and browsers installed on the server.
    """
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=400, detail="Invalid account ID")

    db = get_db()
    account = await get_account_for_user(account_id, current_user)

    cookie_str = account.get("cookie")
    if not cookie_str:
        raise HTTPException(status_code=400, detail="Tài khoản chưa cấu hình Cookie.")

    platform = account.get("platform")
    username = account.get("username")
    if platform == "X":
        url = f"https://x.com/{username}"
    else:
        url = f"https://www.threads.net/@{username}"

    # Build command to run the helper script
    script_path = "backend/scripts/auto_login.py"
    cmd = ["python", script_path, "--cookie", cookie_str, "--url", url]
    if headless:
        cmd.append("--headless")

    async def run_background(cmd_list):
        try:
            # Use asyncio subprocess to avoid blocking
            process = await asyncio.create_subprocess_exec(
                *cmd_list,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await process.communicate()
            # Optionally log stdout/stderr somewhere; for now we just ignore
        except Exception:
            pass

    # Start background task
    asyncio.create_task(run_background(cmd))

    await write_audit_log(
        current_user["id"], current_user["username"],
        "AUTO_LOGIN", "ACCOUNT", account_id,
        new_val=f"Auto-login triggered for {account.get('platform')}:{account.get('username')}"
    )

    return {"message": "Auto-login started (backend)."}

@router.post("/{account_id}/refresh-cookie")
async def refresh_cookie(
    account_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Refresh the account's cookies by using Playwright to visit the platform
    and extract fresh cookies. For Threads accounts with access_token, refreshes
    the token via Meta's Graph API instead."""
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=400, detail="Invalid account ID")

    db = get_db()
    account = await get_account_for_user(account_id, current_user)

    platform = account.get("platform")
    username = account.get("username", "")
    cookie_str = account.get("cookie")
    access_token = account.get("access_token")
    proxy = account.get("proxy")

    # For Threads with access_token: refresh via Meta API
    if platform == "Threads" and access_token and len(access_token) > 20 and not access_token.lower().startswith("mock"):
        from app.services.social_mock import refresh_threads_access_token
        try:
            result = await refresh_threads_access_token(access_token, proxy=proxy)
            new_token = result["access_token"]
            expires_in = result.get("expires_in", 0)

            await db.accounts.update_one(
                {"_id": ObjectId(account_id)},
                {"$set": {
                    "access_token": new_token,
                    "status": "ACTIVE",
                    "health_score": 100,
                    "error_message": None,
                }}
            )

            await write_audit_log(
                current_user["id"], current_user["username"],
                "REFRESH_TOKEN", "ACCOUNT", account_id,
                new_val=f"Threads access token refreshed. Expires in {expires_in}s"
            )

            expires_days = expires_in // 86400 if expires_in else 0
            return {
                "success": True,
                "type": "access_token",
                "message": f"✅ Đã refresh Access Token thành công cho @{username}. Token mới có hiệu lực {expires_days} ngày.",
                "expires_in": expires_in,
            }
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    # For cookie-based accounts: refresh via Playwright
    if not cookie_str or len(cookie_str) <= 20:
        raise HTTPException(
            status_code=400,
            detail="Tài khoản chưa cấu hình Cookie. Vui lòng thêm cookie trước khi refresh."
        )

    from app.services.social_mock import refresh_account_cookies, SocialAuthError
    try:
        result = await refresh_account_cookies(
            platform=platform,
            cookie_str=cookie_str,
            username=username,
            proxy=proxy,
        )

        # Save the refreshed cookie to database
        await db.accounts.update_one(
            {"_id": ObjectId(account_id)},
            {"$set": {
                "cookie": result["new_cookie"],
                "status": "ACTIVE",
                "health_score": 100,
                "error_message": None,
            }}
        )

        await write_audit_log(
            current_user["id"], current_user["username"],
            "REFRESH_COOKIE", "ACCOUNT", account_id,
            new_val=f"Cookie refreshed: {result['cookie_count']} cookies, {len(result['changed_keys'])} changed"
        )

        return {
            "success": True,
            "type": "cookie",
            "message": result["message"],
            "cookie_count": result["cookie_count"],
            "changed_keys": result["changed_keys"],
            "new_keys": result["new_keys"],
        }
    except SocialAuthError as e:
        # Cookie expired - update account status
        await db.accounts.update_one(
            {"_id": ObjectId(account_id)},
            {"$set": {
                "status": "ERROR",
                "health_score": max(0, account.get("health_score", 100) - 30),
                "error_message": str(e),
            }}
        )
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: str,
    account_in: AccountUpdate,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    old_account = await get_account_for_user(account_id, current_user)
        
    update_data = {}
    if account_in.display_name is not None:
        update_data["display_name"] = account_in.display_name
    if account_in.status is not None:
        update_data["status"] = account_in.status
    if account_in.cookie is not None:
        update_data["cookie"] = account_in.cookie
    if account_in.access_token is not None:
        update_data["access_token"] = account_in.access_token
    if account_in.threads_user_id is not None:
        update_data["threads_user_id"] = account_in.threads_user_id
    if account_in.proxy is not None:
        update_data["proxy"] = account_in.proxy
    if account_in.daily_limit is not None:
        update_data["daily_limit"] = account_in.daily_limit
    if account_in.hourly_limit is not None:
        update_data["hourly_limit"] = account_in.hourly_limit
    if account_in.health_score is not None:
        update_data["health_score"] = account_in.health_score
        
    if not update_data:
        return serialize_doc(old_account)
        
    await db.accounts.update_one(
        {"_id": ObjectId(account_id)},
        {"$set": update_data}
    )
    
    updated_account = await db.accounts.find_one({"_id": ObjectId(account_id)})
    
    await write_audit_log(
        current_user["id"], current_user["username"],
        "UPDATE", "ACCOUNT", account_id,
        old_val=f"Status:{old_account['status']}",
        new_val=f"Status:{updated_account['status']}"
    )
    
    return serialize_doc(updated_account)

@router.post("/{account_id}/check")
async def check_account(
    account_id: str,
    current_user: dict = Depends(get_current_user)
):
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=400, detail="Invalid account ID")
    
    db = get_db()
    account = await get_account_for_user(account_id, current_user)
        
    from app.services.social_mock import check_account_connection
    
    success, message = await check_account_connection(
        account["platform"],
        account.get("cookie"),
        access_token=account.get("access_token"),
        threads_user_id=account.get("threads_user_id"),
        proxy=account.get("proxy"),
    )
    
    update_data = {}
    if success:
        update_data["status"] = "ACTIVE"
        update_data["health_score"] = 100
        update_data["error_message"] = None
    else:
        update_data["status"] = "ERROR"
        update_data["health_score"] = max(20, account.get("health_score", 100) - 20)
        update_data["error_message"] = message
        
    await db.accounts.update_one(
        {"_id": ObjectId(account_id)},
        {"$set": update_data}
    )
    
    await write_audit_log(
        current_user["id"], current_user["username"],
        "CHECK_CONNECTION", "ACCOUNT", account_id,
        new_val=f"Success:{success}"
    )
    
    return {
        "success": success,
        "message": message,
        "status": update_data["status"],
        "health_score": update_data["health_score"]
    }

@router.get("/{account_id}/login-script")
async def get_login_script(
    account_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Returns a JavaScript snippet that injects cookies for auto-login on X or Threads."""
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=400, detail="Invalid account ID")
    
    db = get_db()
    account = await get_account_for_user(account_id, current_user)
    
    cookie_str = account.get("cookie")
    if not cookie_str:
        raise HTTPException(status_code=400, detail="Tài khoản chưa cấu hình Cookie.")
    
    from app.services.social_mock import parse_cookie_to_dict
    cookies_dict = parse_cookie_to_dict(cookie_str)
    
    platform = account["platform"]
    username = account.get("username", "")
    
    if platform == "X":
        domains = [".x.com", ".twitter.com"]
        profile_url = f"https://x.com/{username}"
        required_keys = ["ct0", "auth_token"]
        missing = [k for k in required_keys if k not in cookies_dict]
        if missing:
            raise HTTPException(status_code=400, detail=f"Cookie thiếu: {', '.join(missing)}")
    elif platform == "Threads":
        domains = [".threads.net", ".threads.com"]
        profile_url = f"https://www.threads.net/@{username}"
        required_keys = ["sessionid", "session_id"]
        missing = [] if any(k in cookies_dict for k in required_keys) else required_keys
        if missing:
            raise HTTPException(status_code=400, detail=f"Cookie thiếu: {', '.join(missing)}")
    else:
        raise HTTPException(status_code=400, detail=f"Nền tảng {platform} chưa hỗ trợ.")
    
    # Build JavaScript cookie injection lines
    js_lines = [
        "const deleteCookie = (name, domain, path) => {",
        "  const expires = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';",
        "  const secure = 'Secure';",
        "  const sameSite = 'SameSite=None';",
        "  document.cookie = `${name}=; path=${path}; domain=${domain}; ${expires}; ${secure}; ${sameSite}`;",
        "};",
        "const currentCookies = document.cookie.split('; ').filter(Boolean).map(cookie => cookie.split('=')[0]);",
        "const domains = [" + ", ".join([f'\"{d}\"' for d in domains]) + "];",
        "const hostname = window.location.hostname.replace(/^www\\./, '');",
        "const deleteDomains = [...new Set([...domains, hostname, window.location.hostname])];",
        "const paths = ['/', window.location.pathname.replace(/\\/[^/]*$/, '/'), '/'];",
        "currentCookies.forEach(name => {",
        "  deleteDomains.forEach(domain => {",
        "    paths.forEach(path => deleteCookie(name, domain, path));",
        "  });",
        "});",
        "console.log('✅ Đã xóa tất cả cookie hiện tại trên trang.');",
    ]
    for name, value in cookies_dict.items():
        # Set cookie with long expiry, secure flag, proper domains
        for dom in domains:
            js_lines.append(
                f'document.cookie = "{name}={value}; path=/; domain={dom}; secure; max-age=31536000; SameSite=None";'
            )
    js_lines.append(f'console.log("✅ Đã inject {len(cookies_dict)} cookies cho {platform}!");')
    js_lines.append('location.reload();')
    
    script = "\n".join(js_lines)
    
    return {
        "platform": platform,
        "username": username,
        "profile_url": profile_url,
        "script": script,
        "cookie_count": len(cookies_dict)
    }

@router.delete("/{account_id}")
async def delete_account(
    account_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    account = await get_account_for_user(account_id, current_user)
        
    await db.accounts.delete_one({"_id": ObjectId(account_id)})
    
    await write_audit_log(
        current_user["id"], current_user["username"],
        "DELETE", "ACCOUNT", account_id,
        old_val=f"{account['platform']}:{account['username']}"
    )
    
    return {"message": "Account deleted successfully"}


