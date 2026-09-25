"""Role-based DRF permissions, shared by every role-gated endpoint."""

from rest_framework.permissions import BasePermission


class IsAdminRole(BasePermission):
    """Only users whose application role is `admin`."""

    message = "This endpoint is restricted to admin users."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_admin_role)


class IsAdminRoleOrSelf(BasePermission):
    """
    Admins may target any user; everyone else may only target themselves.

    The target is read from the query parameter named by the view's
    `target_user_param` (default `user_id`). A non-admin who names another
    user is refused with 403 rather than silently shown their own data, so the
    restriction is explicit. Omitting the parameter means "myself" here;
    whether an admin must supply it is the view's decision.
    """

    message = "You can only access your own data."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_admin_role:
            return True
        param = getattr(view, "target_user_param", "user_id")
        requested = request.query_params.get(param)
        return requested is None or requested == str(user.pk)
