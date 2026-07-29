from __future__ import annotations

import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REFERENCE_ROOT = SERVICE_ROOT.parent / "python-reference"

for path in (SERVICE_ROOT, REFERENCE_ROOT):
    value = str(path)
    if value not in sys.path:
        sys.path.insert(0, value)
