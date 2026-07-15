# Единый источник истины по правам — в shared/core/permissions.py, чтобы warehouse,
# products и auth считали права ОДИНАКОВО (иначе фронт показывает кнопку, а сервис 403).
# Здесь только ре-экспорт для обратной совместимости импортов auth (user_service, auth.py).
from shared.core.permissions import (  # noqa: F401
    PERMISSION_PRESET_ALL,
    DEPARTMENT_TO_VIEW_PERMISSION,
    ALLOWED_ROLES,
    PRODUCTION_ROLES,
    OTK_ROLES,
    ROLE_TO_STAGE_TYPE,
    ROLE_DEFAULT_PERMISSIONS,
    build_default_permissions,
    restrict_permissions,
    resolve_permissions,
    _dep_from_key,
)
