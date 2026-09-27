from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import LogoutView, MeView, ThrottledTokenObtainPairView

urlpatterns = [
    path("token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    # Logout: the refresh token can never be used again.
    path("token/blacklist/", LogoutView.as_view(), name="token_blacklist"),
    path("me/", MeView.as_view(), name="me"),
]
