"""WebSocket live chat handler.

Each live stream has a chat room. Users connect via:
    WS /ws/chat/{stream_id}

Protocol (JSON messages):
    Client → Server:
        {"type": "message", "content": "Hello!"}
        {"type": "ping"}

    Server → Client:
        {"type": "message", "username": "alice", "content": "Hello!", "timestamp": "..."}
        {"type": "system", "content": "alice joined", "timestamp": "..."}
        {"type": "viewer_count", "viewer_count": 42}
        {"type": "pong"}

Authentication is optional: anonymous users can watch but not send messages.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.auth import decode_token
from app.database import async_session
from app.models.live import LiveStream
from app.models.user import User

router = APIRouter()


class ChatRoom:
    """Manages WebSocket connections for a single live stream."""

    def __init__(self) -> None:
        # connection_id → (websocket, username_or_none)
        self.connections: dict[str, tuple[WebSocket, str | None]] = {}

    @property
    def viewer_count(self) -> int:
        return len(self.connections)

    async def connect(self, conn_id: str, ws: WebSocket, username: str | None) -> None:
        await ws.accept()
        self.connections[conn_id] = (ws, username)
        # Announce join
        if username:
            await self._broadcast_system(f"{username} joined")
        await self._broadcast_viewer_count()

    async def disconnect(self, conn_id: str) -> None:
        entry = self.connections.pop(conn_id, None)
        if entry:
            _, username = entry
            if username:
                await self._broadcast_system(f"{username} left")
            await self._broadcast_viewer_count()

    async def broadcast_message(self, username: str, content: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "type": "message",
            "username": username,
            "content": content,
            "timestamp": now,
        }
        await self._broadcast(payload)

    async def _broadcast_system(self, content: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self._broadcast({
            "type": "system",
            "content": content,
            "timestamp": now,
        })

    async def _broadcast_viewer_count(self) -> None:
        await self._broadcast({
            "type": "viewer_count",
            "viewer_count": self.viewer_count,
        })

    async def _broadcast(self, data: dict) -> None:
        dead: list[str] = []
        for conn_id, (ws, _) in self.connections.items():
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(conn_id)
        for conn_id in dead:
            self.connections.pop(conn_id, None)


class ChatManager:
    """Global chat room registry."""

    def __init__(self) -> None:
        self.rooms: dict[str, ChatRoom] = {}

    def get_room(self, stream_id: str) -> ChatRoom:
        if stream_id not in self.rooms:
            self.rooms[stream_id] = ChatRoom()
        return self.rooms[stream_id]

    def remove_room(self, stream_id: str) -> None:
        self.rooms.pop(stream_id, None)

    def viewer_count(self, stream_id: str) -> int:
        room = self.rooms.get(stream_id)
        return room.viewer_count if room else 0


chat_manager = ChatManager()


async def _resolve_user(token: str | None) -> User | None:
    """Resolve a JWT token to a User, or None if invalid/missing."""
    if not token:
        return None
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    async with async_session() as db:
        result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = result.scalar_one_or_none()
        if user and user.is_active:
            return user
    return None


@router.websocket("/ws/chat/{stream_id}")
async def live_chat(
    websocket: WebSocket,
    stream_id: str,
    token: str | None = Query(None),
):
    """WebSocket endpoint for live stream chat.

    Query params:
        token: JWT access token (optional, for authenticated messaging)
    """
    # Resolve user from token
    user = await _resolve_user(token)
    username = user.username if user else None

    conn_id = str(uuid.uuid4())
    room = chat_manager.get_room(stream_id)

    await room.connect(conn_id, websocket, username)

    # Update viewer count on the LiveStream record (best-effort)
    try:
        async with async_session() as db:
            result = await db.execute(
                select(LiveStream).where(LiveStream.id == uuid.UUID(stream_id))
            )
            stream = result.scalar_one_or_none()
            if stream:
                stream.viewer_count = room.viewer_count
                if room.viewer_count > stream.peak_viewers:
                    stream.peak_viewers = room.viewer_count
                await db.commit()
    except Exception:
        pass

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            elif msg_type == "message":
                content = (data.get("content") or "").strip()
                if not username:
                    await websocket.send_json({
                        "type": "error",
                        "content": "Login required to send messages",
                    })
                elif content:
                    # Limit message length
                    await room.broadcast_message(username, content[:500])
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await room.disconnect(conn_id)
        # Update viewer count down
        try:
            async with async_session() as db:
                result = await db.execute(
                    select(LiveStream).where(LiveStream.id == uuid.UUID(stream_id))
                )
                stream = result.scalar_one_or_none()
                if stream:
                    stream.viewer_count = room.viewer_count
                    await db.commit()
        except Exception:
            pass

        # Clean up empty rooms
        if room.viewer_count == 0:
            chat_manager.remove_room(stream_id)
