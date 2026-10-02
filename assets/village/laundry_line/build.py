"""Build the canal-town laundry_line, then export its runtime GLB and previews."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from edge_assets import build
build('laundry_line')
