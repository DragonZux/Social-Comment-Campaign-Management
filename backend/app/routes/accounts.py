from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId
from datetime import datetime
from typing import List

from app.database import get_db
from app.models import AccountCreate, AccountUpdate, AccountOut, serialize_doc, serialize_docs
from app.routes.auth import get_current_user, require_roles, write_audit_log

router = APIRouter(prefix="/accounts", tags=["Social Accounts"])

@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
async def create_account(
    account_in: AccountCreate,
    current_user: dict = Depends(require_roles(["ADMIN", "OPERATOR"]))
):
    db = get_db()
    existing = await db.accounts.find_one({"platform": account_in.platform, "username": account_in.username})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account with username {account_in.username} already exists on {account_in.platform}"
        )
    
    account_doc = {
        "platform": account_in.platform,
        "username": account_in.username,
        "display_name": account_in.display_name or account_in.username,
        "status": "ACTIVE",
        "daily_limit": account_in.daily_limit,
        "hourly_limit": account_in.hourly_limit,
        "daily_usage_count": 0,
        "hourly_usage_count": 0,
        "last_activity": None,
        "health_score": 100,
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
    current_user: dict = Depends(require_roles(["ADMIN", "OPERATOR", "VIEWER"]))
):
    db = get_db()
    query = {}
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
    current_user: dict = Depends(require_roles(["ADMIN", "OPERATOR", "VIEWER"]))
):
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=400, detail="Invalid account ID")
    
    db = get_db()
    account = await db.accounts.find_one({"_id": ObjectId(account_id)})
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    return serialize_doc(account)

@router.patch("/{account_id}", response_model=AccountOut)
async def update_account(
    account_id: str,
    account_in: AccountUpdate,
    current_user: dict = Depends(require_roles(["ADMIN", "OPERATOR"]))
):
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=400, detail="Invalid account ID")
        
    db = get_db()
    old_account = await db.accounts.find_one({"_id": ObjectId(account_id)})
    if not old_account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    update_data = {}
    if account_in.display_name is not None:
        update_data["display_name"] = account_in.display_name
    if account_in.status is not None:
        update_data["status"] = account_in.status
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

@router.delete("/{account_id}")
async def delete_account(
    account_id: str,
    current_user: dict = Depends(require_roles(["ADMIN", "OPERATOR"]))
):
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=400, detail="Invalid account ID")
        
    db = get_db()
    account = await db.accounts.find_one({"_id": ObjectId(account_id)})
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
        
    await db.accounts.delete_one({"_id": ObjectId(account_id)})
    
    await write_audit_log(
        current_user["id"], current_user["username"],
        "DELETE", "ACCOUNT", account_id,
        old_val=f"{account['platform']}:{account['username']}"
    )
    
    return {"message": "Account deleted successfully"}
