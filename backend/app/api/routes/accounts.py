from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId
from datetime import datetime
from typing import List
import asyncio
import shlex

from app.db.database import get_db
from app.schemas import AccountCreate, AccountUpdate, AccountOut, serialize_doc, serialize_docs
from app.api.routes.auth import get_current_user, write_audit_log
from pydantic import BaseModel

router = APIRouter(prefix="/accounts", tags=["Social Accounts"])


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

@router.get("", response_model=List[AccountOut])
async def list_accounts(
    platform: str = None,
    status: str = None,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    query = {}
    query.update(account_scope(current_user))
    if platform:
        query["platform"] = platform
    if status:
        query["status"] = status
        
    cursor = db.accounts.find(query).sort("created_at", -1)
    accounts = await cursor.to_list(length=100)
    return serialize_docs(accounts)

@router.get("/{account_id}", response_model=AccountOut)
async def get_account(
    account_id: str,
    current_user: dict = Depends(get_current_user)
):
    account = await get_account_for_user(account_id, current_user)
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
    )
    
    update_data = {}
    if success:
        update_data["status"] = "ACTIVE"
        update_data["health_score"] = 100
    else:
        update_data["status"] = "ERROR"
        update_data["health_score"] = max(20, account.get("health_score", 100) - 20)
        
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


