"""Run the offline physical-map CLI from an extracted package, including -I."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from adapter.scene_builder.__main__ import main

if __name__ == '__main__':
    raise SystemExit(main(['physical-map', *sys.argv[1:]]))
