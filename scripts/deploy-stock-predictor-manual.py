#!/usr/bin/env python3
"""Manual deploy stock-predictor to CloudBase SCF via COS upload.

Use when `tcb fn deploy` COS upload times out for large packages.
Reads temporary credentials from `tcb secrets get --json`.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from qcloud_cos import CosConfig, CosS3Client

PROJECT_DIR = Path(__file__).resolve().parent.parent
FUNCTION_DIR = PROJECT_DIR / "cloudfunctions" / "stock-predictor"
BUCKET = "7374-stockconsult-d9g7b6ae5b8170e00"
BUCKET_APPID = "7374-stockconsult-d9g7b6ae5b8170e00-1328081868"
REGION = "ap-shanghai"
NAMESPACE = "stockconsult-d9g7b6ae5b8170e00"
FUNCTION_NAME = "stock-predictor"
COS_KEY = f"/{FUNCTION_NAME}/code-{os.urandom(4).hex()}.zip"


def get_tcb_secrets():
    result = subprocess.run(
        ["tcb", "secrets", "get", "--json"],
        capture_output=True,
        text=True,
        check=True,
    )
    # tcb prints a loading line before JSON; find the JSON object.
    text = result.stdout
    start = text.find("{")
    if start == -1:
        raise RuntimeError("Unable to parse tcb secrets output")
    data = json.loads(text[start:])
    return data["data"]


def pack_function():
    tmp_dir = tempfile.mkdtemp(prefix="scf-stock-predictor-")
    zip_path = Path(tmp_dir) / "stock-predictor.zip"
    ignored = {".git", "__pycache__", ".DS_Store", "*.pyc", "*.pyo"}
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(FUNCTION_DIR):
            # skip ignored dirs
            dirs[:] = [d for d in dirs if d not in ignored]
            for f in files:
                if f.endswith((".pyc", ".pyo")) or f in ignored:
                    continue
                full = Path(root) / f
                rel = full.relative_to(FUNCTION_DIR)
                zf.write(full, rel.as_posix())
    size = zip_path.stat().st_size
    print(f"Packed {zip_path} ({size / 1024 / 1024:.1f} MB)")
    return zip_path


def upload_to_cos(zip_path, secrets):
    config = CosConfig(
        Region=REGION,
        SecretId=secrets["secretId"],
        SecretKey=secrets["secretKey"],
        Token=secrets.get("token"),
        Scheme="https",
    )
    client = CosS3Client(config)
    print(f"Uploading to cos://{BUCKET_APPID}/{COS_KEY} ...")
    response = client.upload_file(
        Bucket=BUCKET_APPID,
        Key=COS_KEY,
        LocalFilePath=str(zip_path),
        EnableMD5=False,
        progress_callback=None,
    )
    print("Upload complete:", response.get("ETag"))
    return response


def update_function_code(secrets):
    env = os.environ.copy()
    env["TENCENTCLOUD_SECRETID"] = secrets["secretId"]
    env["TENCENTCLOUD_SECRETKEY"] = secrets["secretKey"]
    env["TENCENTCLOUD_TOKEN"] = secrets.get("token", "")
    cmd = [
        "tccli",
        "scf",
        "UpdateFunctionCode",
        "--region",
        REGION,
        "--FunctionName",
        FUNCTION_NAME,
        "--Namespace",
        NAMESPACE,
        "--CosBucketName",
        BUCKET,
        "--CosObjectName",
        COS_KEY,
        "--CosBucketRegion",
        REGION,
        "--Handler",
        "scf_index.main_handler",
    ]
    print("Updating function code...")
    subprocess.run(cmd, env=env, check=True)
    print("Function code updated.")


def main():
    secrets = get_tcb_secrets()
    zip_path = pack_function()
    try:
        upload_to_cos(zip_path, secrets)
        update_function_code(secrets)
    finally:
        shutil.rmtree(zip_path.parent, ignore_errors=True)


if __name__ == "__main__":
    main()
