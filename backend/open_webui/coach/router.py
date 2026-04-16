"""FastAPI router for /api/v1/coach/*."""

from fastapi import APIRouter, Depends

from open_webui.coach.schemas import CoachConfigForm, CoachConfigResponse
from open_webui.coach.storage import CoachConfigs
from open_webui.utils.auth import get_verified_user

router = APIRouter()


@router.get('/config', response_model=CoachConfigResponse)
async def get_config(user=Depends(get_verified_user)) -> CoachConfigResponse:
    """Return the calling user's coach config; autocreate a default row if absent."""
    return CoachConfigs.get_or_default(user.id)


@router.post('/config', response_model=CoachConfigResponse)
async def upsert_config(
    form: CoachConfigForm, user=Depends(get_verified_user)
) -> CoachConfigResponse:
    """Upsert the calling user's coach config. None-valued fields are left untouched."""
    return CoachConfigs.upsert(user.id, form)
