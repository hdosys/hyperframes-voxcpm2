"""Admit the exact official model once to an explicitly selected directory."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--versions", type=Path, default=Path(__file__).resolve().parents[1] / "versions.json")
    args = parser.parse_args()
    model = json.loads(args.versions.read_text(encoding="utf-8"))["supertonic"]
    identity = {key: model[key] for key in ("repository", "revision", "files")}
    directory = args.model_dir.resolve()
    marker = directory / "admitted.json"
    if marker.exists():
        if json.loads(marker.read_text(encoding="utf-8")) != identity:
            raise RuntimeError("Model directory contains a different admission manifest")
        if not all((directory / item["name"]).is_file() for item in model["files"]):
            raise RuntimeError("Admitted model is incomplete; select a new empty directory")
        print(directory)
        return
    if directory.exists() and any(directory.iterdir()):
        raise RuntimeError("Select an empty model directory; existing files will not be replaced")
    directory.mkdir(parents=True, exist_ok=True)

    def download(item):
        path = directory / item["name"]
        path.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256() if "sha256" in item else hashlib.sha1()
        if "gitBlob" in item:
            digest.update(f"blob {item['size']}\0".encode())
        url = f"https://huggingface.co/{model['repository']}/resolve/{model['revision']}/{item['name']}"
        size = 0
        with urllib.request.urlopen(url, timeout=60) as response, path.open("xb") as output:
            while data := response.read(1024 * 1024):
                size += len(data)
                digest.update(data)
                output.write(data)
        if size != item["size"] or digest.hexdigest() != item.get("sha256", item.get("gitBlob")):
            raise RuntimeError(f"Model integrity mismatch: {item['name']}")
        print(f"Verified {item['name']}", flush=True)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(download, model["files"]))
    with marker.open("x", encoding="utf-8") as output:
        json.dump(identity, output, indent=2)
    print(directory)


if __name__ == "__main__":
    main()
