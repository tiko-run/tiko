from fastapi import APIRouter

from app.api import (
    auth,
    boards,
    demo,
    invites,
    jql,
    live,
    me,
    people,
    planning,
    privacy,
    public,
    settings,
    tasks,
    version,
)

router = APIRouter(prefix="/api")
router.include_router(auth.router)
router.include_router(me.router)
router.include_router(people.router)
router.include_router(planning.router)
router.include_router(invites.router)
router.include_router(boards.router)
router.include_router(public.router)
router.include_router(live.router)
router.include_router(tasks.router)
router.include_router(jql.router)
router.include_router(settings.router)
router.include_router(privacy.router)
router.include_router(demo.router)
router.include_router(version.router)
