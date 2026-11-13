from django.urls import path

from .views import DocumentedTokenRefreshView, LogoutView, MeView, ThrottledTokenObtainPairView

urlpatterns = [
    path("token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", DocumentedTokenRefreshView.as_view(), name="token_refresh"),
    # Logout: the refresh token can never be used again.
    path("token/blacklist/", LogoutView.as_view(), name="token_blacklist"),
    path("me/", MeView.as_view(), name="me"),
]
