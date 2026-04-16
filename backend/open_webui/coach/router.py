"""FastAPI router for /api/v1/coach/*."""

from fastapi import APIRouter, Depends, HTTPException, status

from open_webui.coach.schemas import (
    CoachConfigForm,
    CoachConfigResponse,
    CoachPolicyCreateForm,
    CoachPolicyResponse,
    CoachPolicyUpdateForm,
)
from open_webui.coach.storage import CoachConfigs, CoachPolicies
from open_webui.utils.auth import get_admin_user, get_verified_user

router = APIRouter()


# ─── Config ────────────────────────────────────────────────────────────


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


# ─── Policies ──────────────────────────────────────────────────────────


@router.get('/policies', response_model=list[CoachPolicyResponse])
async def list_policies(user=Depends(get_verified_user)) -> list[CoachPolicyResponse]:
    """Union of the caller's personal policies + all shared policies."""
    return CoachPolicies.list_visible(user.id)


@router.post('/policies', response_model=CoachPolicyResponse)
async def create_policy(
    form: CoachPolicyCreateForm, user=Depends(get_verified_user)
) -> CoachPolicyResponse:
    """Create a personal policy owned by the calling user."""
    return CoachPolicies.create_personal(user.id, form)


def _assert_mutate_allowed(policy: CoachPolicyResponse, user) -> None:
    """User can modify their own personal policy; admin can modify any shared one."""
    if policy.is_shared or policy.user_id is None:
        if user.role != 'admin':
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='Only admins can modify shared policies.',
            )
    else:
        if policy.user_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='You can only modify your own policies.',
            )


@router.patch('/policies/{policy_id}', response_model=CoachPolicyResponse)
async def update_policy(
    policy_id: str,
    form: CoachPolicyUpdateForm,
    user=Depends(get_verified_user),
) -> CoachPolicyResponse:
    existing = CoachPolicies.get_by_id(policy_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    _assert_mutate_allowed(existing, user)
    updated = CoachPolicies.update(policy_id, form)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    return updated


@router.delete('/policies/{policy_id}')
async def delete_policy(
    policy_id: str, user=Depends(get_verified_user)
) -> dict:
    existing = CoachPolicies.get_by_id(policy_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    _assert_mutate_allowed(existing, user)
    deleted = CoachPolicies.delete(policy_id)
    return {'deleted': deleted}


@router.post('/policies/{policy_id}/share', response_model=CoachPolicyResponse)
async def share_policy(
    policy_id: str, _admin=Depends(get_admin_user)
) -> CoachPolicyResponse:
    """Admin-only: promote a personal policy to the shared library.

    The policy loses its owner (user_id set to NULL). Everyone can then see
    it in their policies list.
    """
    updated = CoachPolicies.set_shared(policy_id, True)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    return updated


@router.post('/policies/{policy_id}/unshare', response_model=CoachPolicyResponse)
async def unshare_policy(
    policy_id: str, _admin=Depends(get_admin_user)
) -> CoachPolicyResponse:
    """Admin-only: demote a shared policy. The policy becomes orphaned
    (no user_id); a future admin action may reassign ownership."""
    updated = CoachPolicies.set_shared(policy_id, False)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Policy not found.')
    return updated
