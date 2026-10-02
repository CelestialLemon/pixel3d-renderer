"""Build the Lantern Row crate asset."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from clutter import build_clutter
build_clutter('crate')
