from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from bson import ObjectId

from app.config import settings
from app.database import get_db
from app.models import UserRegister, UserLogin, Token, serialize_doc

router = APIRouter(prefix="/auth", tags=["Authentication"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None or role is None:
            raise credentials_exception
        token_data = TokenData(username=username, role=role)
    except JWTError:
        raise credentials_exception
    
    db = get_db()
    user = await db.users.find_one({"username": token_data.username})
    if user is None:
        raise credentials_exception
    return serialize_doc(user)

def require_roles(allowed_roles: list[str]):
    async def role_checker(current_user: dict = Depends(get_current_user)):
        if current_user.get("role") not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource"
            )
        return current_user
    return role_checker

# Helper to write audit log
async def write_audit_log(user_id: str, username: str, action: str, resource_type: str, resource_id: str = None, old_val: str = None, new_val: str = None):
    db = get_db()
    audit_doc = {
        "user_id": ObjectId(user_id) if user_id else None,
        "username": username,
        "action": action,
        "resource_type": resource_type,
        "resource_id": ObjectId(resource_id) if resource_id else None,
        "old_value": old_val,
        "new_value": new_val,
        "created_at": datetime.utcnow()
    }
    await db.audit_logs.insert_one(audit_doc)

@router.post("/register", response_model=Token)
async def register(user_in: UserRegister):
    db = get_db()
    existing_user = await db.users.find_one({"username": user_in.username})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Hash password
    hashed_pwd = get_password_hash(user_in.password)
    user_doc = {
        "username": user_in.username,
        "hashed_password": hashed_pwd,
        "role": user_in.role,
        "created_at": datetime.utcnow()
    }
    result = await db.users.insert_one(user_doc)
    
    # Write audit log
    await write_audit_log(str(result.inserted_id), user_in.username, "REGISTER", "USER", str(result.inserted_id))
    
    # Generate token
    access_token = create_access_token(data={"sub": user_in.username, "role": user_in.role})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user_in.role,
        "username": user_in.username
    }

# FastAPI OAuth2 form support
from fastapi.security import OAuth2PasswordRequestForm

@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    db = get_db()
    user = await db.users.find_one({"username": form_data.username})
    if not user or not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect username or password"
        )
    
    role = user.get("role", "OPERATOR")
    access_token = create_access_token(data={"sub": user["username"], "role": role})
    
    # Write audit log
    await write_audit_log(str(user["_id"]), user["username"], "LOGIN", "USER", str(user["_id"]))
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": role,
        "username": user["username"]
    }
