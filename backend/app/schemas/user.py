from uuid import UUID

from pydantic import BaseModel


class UserResponse(BaseModel):
    id: UUID
    email: str
    username: str
    display_name: str
    avatar_url: str
    role: str

    model_config = {"from_attributes": True}
