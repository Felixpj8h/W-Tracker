"""Persistent, bounded diagnostics for AI coach failures."""

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


LOG_PATH = Path(__file__).resolve().parent.parent / "logs" / "coach.log"
LOGGER = logging.getLogger("wtracker.coach")

if not LOGGER.handlers:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(LOG_PATH, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    LOGGER.addHandler(handler)
    LOGGER.setLevel(logging.INFO)
    LOGGER.propagate = False
