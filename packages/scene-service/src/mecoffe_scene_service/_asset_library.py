"""Pinned published catalog shared by Python, map manifests and the viewer."""
import hashlib
import json
from pathlib import Path

ASSET_DIRECTORY = Path(__file__).resolve().parent/'resources/mecoffe-embed-v1'


def published_asset_library(directory=ASSET_DIRECTORY):
    directory=Path(directory)
    descriptor=json.loads((directory/'asset-library.json').read_text(encoding='utf-8'))
    if descriptor.get('schema_version')!='scene.asset-library.v1' or descriptor.get('catalog_file')!='catalog.json':
        raise ValueError('发布素材库描述无效')
    raw=(directory/'catalog.json').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=descriptor.get('catalog_sha256'):
        raise ValueError('发布 catalog 字节与登记摘要不一致')
    catalog=json.loads(raw.decode('utf-8'))
    if catalog.get('schema_version')!='mecoffe.asset-catalog.v1':
        raise ValueError('发布 catalog 格式无效')
    return descriptor,catalog
