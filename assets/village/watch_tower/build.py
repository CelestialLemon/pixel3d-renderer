"""Build the canal-town watch_tower, then export its runtime GLB and previews."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from town_buildings import build
build('watch_tower')
