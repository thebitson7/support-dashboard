"""Role-based DRF permissions, shared by every role-gated endpoint."""

from rest_framework.permissions import SAFE_METHODS, BasePermission


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


class IsAdminRoleOrOwner(BasePermission):
    """
    Object level: admins may act on any record, everyone else only on records
    whose `user` is themselves. Refused with 403 (as IsAdminRoleOrSelf does),
    not hidden as a 404.
    """

    message = "You can only change your own entries."

    def has_object_permission(self, request, view, obj):
        user = request.user
        return bool(user and user.is_authenticated and (user.is_admin_role or obj.user_id == user.pk))


class IsAdminRoleOrReadOnly(BasePermission):
    """Reads (GET/HEAD/OPTIONS) for any authenticated user; writes for admin role only."""

    message = "Only admin users can change this data."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return request.method in SAFE_METHODS or user.is_admin_role
