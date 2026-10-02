"""Build the canal-town footbridge, then export its runtime GLB and previews."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from canal_assets import build
build('footbridge')
