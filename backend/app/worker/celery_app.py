from celery import Celery

from app.config import settings

celery = Celery(
    "streaming",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.worker.tasks"],
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_acks_late=True,           # re-queue task if worker crashes mid-job
    worker_prefetch_multiplier=1,  # take one task at a time per process
    worker_concurrency=settings.worker_concurrency,
)
