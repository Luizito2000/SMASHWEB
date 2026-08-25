#!/usr/bin/env python3
"""Extract only BattleShip's audio resources for synchronous web startup."""

from __future__ import annotations

import argparse
from pathlib import Path
import zipfile


AUDIO_RESOURCES = (
    "audio/B1_sounds1_ctl",
    "audio/B1_sounds1_tbl",
    "audio/B1_sounds2_ctl",
    "audio/B1_sounds2_tbl",
    "audio/S1_music_sbk",
    "audio/fgm_unk",
    "audio/fgm_tbl",
    "audio/fgm_ucd",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.archive, "r") as archive:
        names = set(archive.namelist())
        missing = [name for name in AUDIO_RESOURCES if name not in names]
        if missing:
            raise RuntimeError(f"Missing web audio resources: {', '.join(missing)}")

        for name in AUDIO_RESOURCES:
            target = args.output / name
            target.parent.mkdir(parents=True, exist_ok=True)
            resource = archive.read(name)
            # O2R Blob resources carry a 0x44-byte LUS resource header.  The
            # normal ResourceManager removes it before exposing Blob::Data;
            # reproduce that behavior for the synchronous web preload.
            if len(resource) < 0x44 or resource[4:8] != b"BLBO":
                raise RuntimeError(f"Unexpected Blob header for {name}")
            payload_size = int.from_bytes(resource[0x40:0x44], "little")
            payload = resource[0x44:]
            if payload_size != len(payload):
                raise RuntimeError(
                    f"Blob size mismatch for {name}: header={payload_size}, actual={len(payload)}"
                )
            target.write_bytes(payload)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
