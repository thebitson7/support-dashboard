from rest_framework.routers import SimpleRouter

from .views import (
    CountryViewSet,
    CustomerViewSet,
    HolidayViewSet,
    SiteViewSet,
    WorkDoneCodeViewSet,
)

router = SimpleRouter()
router.register("countries", CountryViewSet, basename="lookup-country")
router.register("sites", SiteViewSet, basename="lookup-site")
router.register("customers", CustomerViewSet, basename="lookup-customer")
router.register("work-done-codes", WorkDoneCodeViewSet, basename="lookup-work-done-code")
router.register("holidays", HolidayViewSet, basename="lookup-holiday")

urlpatterns = router.urls
