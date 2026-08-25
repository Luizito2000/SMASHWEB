#!/usr/bin/env python3
"""Serve a BattleShip web build with headers required by Wasm threads."""

from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class WebAssemblyHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        # Every local build reuses the same .js/.wasm names. Disable browser
        # caching so a refresh cannot silently execute yesterday's binary.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    parser = ArgumentParser()
    parser.add_argument("--directory", default="build-web")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--entry", default="BattleShip.html",
                        help="HTML entrypoint inside --directory")
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    entrypoint = args.entry
    if not (directory / entrypoint).is_file():
        parser.error(f"{entrypoint} not found in {directory}")
    handler = partial(WebAssemblyHandler, directory=str(directory))
    print(f"Serving {directory} at http://localhost:{args.port}/{entrypoint}")
    ThreadingHTTPServer(("localhost", args.port), handler).serve_forever()


if __name__ == "__main__":
    main()
