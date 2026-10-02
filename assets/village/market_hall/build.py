"""Build the canal-town market_hall, then export its runtime GLB and previews."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from town_buildings import build
build('market_hall')
