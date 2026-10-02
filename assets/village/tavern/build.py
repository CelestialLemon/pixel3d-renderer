"""Build the Lantern Row tavern architecture."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from architecture import build_building
build_building('tavern')
