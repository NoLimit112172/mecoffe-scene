"""Synthetic hospital, homes and services; no OSM/network or team inputs."""
import json
from pathlib import Path

from .synthetic import sample_request


def layered_request():
    request=sample_request()
    package=request['map']
    package['evidence_rules']=json.loads(Path(__file__).parents[1].joinpath('evidence_rules_v2.json').read_text(encoding='utf-8'))
    rows=[('合成医院',{'building':'hospital'}),('合成住宅楼',{'building':'residential'}),
          ('合成教学楼',{'building':'university'}),('',{'building':'yes'}),
          ('合成配电房',{'building':'yes'}),('合成门卫室',{'building':'yes'}),
          ('合成购物广场',{'building':'yes'}),('合成实验楼',{'building':'university'})]
    for building,(name,tags) in zip(package['campus']['buildings'],rows):
        building.update(name=name,tags=tags,building_type=tags['building'])
    package['campus']['pois']=[
        {'osm_id':'synthetic/hospital-restaurant','name':'合成院内餐厅','point':[5,15],'tags':{'amenity':'restaurant'}},
        {'osm_id':'synthetic/home-shop','name':'合成一层商店','point':[25,15],'tags':{'shop':'supermarket'}},
    ]
    request['role_prefs']['synthetic_student']['functions']=['medical']
    request['role_prefs']['synthetic_operator']['functions']=['residential']
    request['brand_prefs']['合成品牌乙']['functions']=['retail']
    return request
