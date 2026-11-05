"""Locate the installed test browser, with an optional explicit binary."""
from pathlib import Path
import os


def browser_binary():
    override = os.environ.get('SHIYI_TEST_CHROMIUM')
    if override:
        return override
    caches = (Path.home() / 'Library/Caches/ms-playwright', Path.home() / '.cache/ms-playwright')
    for cache in caches:
        for directory in sorted(cache.glob('chromium-*'), key=lambda p: p.name, reverse=True):
            for suffix in (
                'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                'chrome-linux64/chrome',
                'chrome-linux/chrome',
            ):
                candidate = directory / suffix
                if candidate.is_file():
                    return str(candidate)
    return None  # Use Playwright's registered executable.
