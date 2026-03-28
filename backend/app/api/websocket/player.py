"""WebSocket player session handler.

Tracks real-time playback analytics and broadcasts viewer counts for VOD.

Each video has a session manager. Viewers connect via:
    WS /ws/player/{video_id}

Protocol (JSON messages):
    Client → Server:
        {"type": "heartbeat", "current_time": 123.4, "quality": "720p"}
        {"type": "ping"}

    Server → Client:
        {"type": "viewer_count", "viewer_count": 42}
        {"type": "pong"}

Authentication is optional: anonymous viewers are counted but
heartbeat data is only persisted for authenticated users.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.auth.auth import decode_token
from app.database import async_session
from app.models.analytics import ViewEvent, WatchHistory
from app.models.user import User
from app.models.video import Video

router = APIRouter()


class PlayerSession:
    """Manages viewer connections for a single video."""

    def __init__(self) -> None:
        # conn_id → (websocket, user_id_or_none)
        self.connections: dict[str, tuple[WebSocket, uuid.UUID | None]] = {}

    @property
    def viewer_count(self) -> int:
        return len(self.connections)

    async def connect(self, conn_id: str, ws: WebSocket, user_id: uuid.UUID | None) -> None:
        await ws.accept()
        self.connections[conn_id] = (ws, user_id)
        await self._broadcast_viewer_count()

    async def disconnect(self, conn_id: str) -> None:
        self.connections.pop(conn_id, None)
        await self._broadcast_viewer_count()

    async def _broadcast_viewer_count(self) -> None:
        payload = {"type": "viewer_count", "viewer_count": self.viewer_count}
        dead: list[str] = []
        for cid, (ws, _) in self.connections.items():
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(cid)
        for cid in dead:
            self.connections.pop(cid, None)


class PlayerManager:
    """Global player session registry."""

    def __init__(self) -> None:
        self.sessions: dict[str, PlayerSession] = {}

    def get_session(self, video_id: str) -> PlayerSession:
        if video_id not in self.sessions:
            self.sessions[video_id] = PlayerSession()
        return self.sessions[video_id]

    def remove_session(self, video_id: str) -> None:
        self.sessions.pop(video_id, None)


player_manager = PlayerManager()


async def _resolve_user_id(token: str | None) -> uuid.UUID | None:
    """Resolve a JWT token to a user ID, or None if invalid/missing."""
    if not token:
        return None
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    try:
        return uuid.UUID(user_id)
    except ValueError:
        return None


@router.websocket("/ws/player/{video_id}")
async def player_session(
    websocket: WebSocket,
    video_id: str,
    token: str | None = Query(None),
):
    """WebSocket endpoint for VOD player sessions.

    Tracks viewer count in real-time and records playback analytics
    via heartbeat messages.

    Query params:
        token: JWT access token (optional, for watch history tracking)
    """
    user_id = await _resolve_user_id(token)
    conn_id = str(uuid.uuid4())
    session = player_manager.get_session(video_id)
    session_id = conn_id  # unique per connection for ViewEvent

    await session.connect(conn_id, websocket, user_id)

    # Track cumulative watch duration for ViewEvent
    total_duration_watched = 0.0
    last_time = 0.0
    last_quality = ""

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "heartbeat":
                current_time = float(data.get("current_time", 0))
                quality = data.get("quality", "")
                if quality:
                    last_quality = quality

                # Calculate duration since last heartbeat
                if current_time > last_time:
                    delta = current_time - last_time
                    # Cap at 60s to handle pauses/seeks
                    if delta <= 60:
                        total_duration_watched += delta
                last_time = current_time

                # Update watch history for authenticated users
                if user_id:
                    try:
                        async with async_session() as db:
                            vid = uuid.UUID(video_id)
                            result = await db.execute(
                                select(WatchHistory).where(
                                    WatchHistory.user_id == user_id,
                                    WatchHistory.video_id == vid,
                                )
                            )
                            wh = result.scalar_one_or_none()

                            # Get video duration for completion check
                            v_result = await db.execute(
                                select(Video.duration).where(Video.id == vid)
                            )
                            video_duration = v_result.scalar() or 0

                            if wh:
                                wh.progress = current_time
                                wh.last_watched_at = datetime.utcnow()
                                if video_duration > 0 and current_time >= video_duration * 0.9:
                                    if not wh.completed:
                                        wh.completed = True
                                        wh.watch_count += 1
                            else:
                                wh = WatchHistory(
                                    user_id=user_id,
                                    video_id=vid,
                                    progress=current_time,
                                )
                                db.add(wh)

                            await db.commit()
                    except Exception:
                        pass

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await session.disconnect(conn_id)

        # Record a ViewEvent on disconnect
        if total_duration_watched > 5:  # Only if watched more than 5 seconds
            try:
                async with async_session() as db:
                    event = ViewEvent(
                        video_id=uuid.UUID(video_id),
                        user_id=user_id,
                        session_id=session_id,
                        duration_watched=total_duration_watched,
                        quality=last_quality or None,
                    )
                    db.add(event)

                    # Increment view count on the video
                    result = await db.execute(
                        select(Video).where(Video.id == uuid.UUID(video_id))
                    )
                    video = result.scalar_one_or_none()
                    if video:
                        video.view_count += 1

                    await db.commit()
            except Exception:
                pass

        # Clean up empty sessions
        if session.viewer_count == 0:
            player_manager.remove_session(video_id)
