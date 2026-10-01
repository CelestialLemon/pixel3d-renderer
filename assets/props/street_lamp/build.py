"""Warm cast-iron street lamp; emissive panes stay visible (no glass_ prefix)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lamp_model import build_lamp

build_lamp('street_lamp', cool=False)
