"""Rebuild the versioned prototype catalogue and code-native SVG thumbnails."""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'frontend/public/mecoffe/assets3d'
PROCEDURAL = {'type': 'procedural', 'title': 'MeCoffe 程序生成', 'author': 'MeCoffe contributors', 'path': 'frontend/src/mecoffe/'}
YULAN = {'type': 'yulan', 'title': 'YuLan-OneSim 图集', 'author': 'RUC-GSAI/YuLan-OneSim', 'revision': '9829d72', 'path': 'frontend/public/assets/bgrd-*.json/png', 'url': 'https://github.com/RUC-GSAI/YuLan-OneSim'}
OSM = {'type': 'osm', 'title': 'OpenStreetMap geometry', 'author': 'OpenStreetMap contributors', 'path': 'data/osm/', 'url': 'https://www.openstreetmap.org/copyright'}
LICENSES = {'procedural': {'spdx': 'LicenseRef-MeCoffe-Project', 'path': 'NOTICE.md', 'note': '项目程序生成，随仓库源码提供；未另行授予外部模型许可'},
            'yulan': {'spdx': 'Apache-2.0', 'path': 'YULAN_LICENSE'},
            'osm': {'spdx': 'ODbL-1.0', 'url': 'https://www.openstreetmap.org/copyright', 'path': 'NOTICE.md'}}


def prototype(identifier, category, subtype, params, match=None, *, source=PROCEDURAL, kind='parametric', variants=None, style='procedural', title=None):
    return {'id': identifier, 'title': title or identifier, 'category': category, 'subtype': subtype, 'kind': kind,
            'style': style, 'target': 'component' if '.component.' in identifier or identifier in ['road.sidewalk','road.markings'] else 'feature', 'match': match or {}, 'params': params,
            'variants': variants or [{'id': 'default', 'params': {}}, {'id': 'compact', 'params': {'preview_scale': .85}}, {'id': 'extended', 'params': {'preview_scale': 1.15}}],
            'source': dict(source), 'license': LICENSES[source['type']],
            'preview': f'/mecoffe/assets3d/previews/{identifier}.svg'}


def existing_prototypes():
    rows = []
    palettes = {
        'dormitory': ['#bc7859', '#e4d3bb', '#934f40', '#487f94'],
        'education': ['#7c9cab', '#d8e4e2', '#376578', '#285a73'],
        'library': ['#efe3ca', '#d4c8ad', '#7673a6', '#467c87'],
        'office': ['#9aa8a1', '#e1ded0', '#617a75', '#385969'],
        'dining': ['#e3bd71', '#f2e3c1', '#a46a40', '#54818a'],
        'sports': ['#65a89b', '#c9e3d4', '#377f75', '#3c6677'],
        'other': ['#c4b88e', '#e5dfc5', '#8a8963', '#4d7885'],
    }
    names = {'dormitory':'宿舍', 'education':'教学科研', 'library':'图书馆', 'office':'办公', 'dining':'食堂', 'sports':'体育活动', 'other':'通用楼体'}
    tags = {'dormitory':{'building':['dormitory','apartments']}, 'education':{'building':['university','school','college']},
            'library':{'amenity':'library'}, 'office':{'building':'office'}, 'dining':{'amenity':['restaurant','canteen','cafe']},
            'sports':{'leisure':['sports_centre','sports_hall']}, 'other':{'building':'*'}}
    levels = {'dormitory':6,'education':5,'library':5,'office':4,'dining':3,'sports':2,'other':3}
    for key, colors in palettes.items():
        rows.append(prototype(f'building.procedural.{key}', 'building', key,
            {'generator':'procedural-building', 'levels':levels[key], 'storey_height_m':3.2, 'roof_style':'flat-parapet',
             **dict(zip(['wall','roof','accent','glass'],colors))}, tags[key], title=names[key]))
    for key, title, params in [
        ('windows','程序窗户',{'generator':'windows','columns':8,'rows':4,'tile_width_m':48,'storey_height_m':3.2,'lit_probability':.62}),
        ('roof','屋顶女儿墙',{'generator':'roof','height_m':.65,'width_m':.6,'color':'#e4d3bb'}),
        ('edges','楼体描边',{'generator':'edges','opacity':.72,'color':'#934f40'}),
        ('shop-sign','门店招牌',{'generator':'shop-sign','colors':['#168b7a','#db784c'],'marker_colors':['#168b7a','#e17943','#6976bb','#b08c3d'],'text':'MECOFFE','height_m':4.5}),
        ('awning','门店遮阳棚',{'generator':'awning','width_m':18,'depth_m':3.2,'colors':['#168b7a','#db784c'],'stripe_color':'#fff2d3'}),
    ]:
        rows.append(prototype(f'building.component.{key}','building',key,params, {'amenity':'cafe'} if 'shop' in key else {}, title=title))
    for key, lanes in [('motorway',4),('trunk',4),('primary',4),('secondary',4),('tertiary',2),('residential',2),('living_street',1),('unclassified',2),('service',1)]:
        rows.append(prototype(f'road.{key}','road',key,{'generator':'road','lanes':lanes,'lane_width_m':3.4 if key in ['motorway','trunk','primary','secondary'] else 3.1,
            'sidewalk_m':0 if key in ['motorway','trunk'] else 1.3 if key=='service' else 2.3,'asphalt':'#444c52'}, {'highway':[key,f'{key}_link']}, title=f'OSM {key} 道路'))
    rows.extend([
        prototype('road.other','road','other',{'generator':'road','lanes':1,'lane_width_m':3.1,'sidewalk_m':2.3,'asphalt':'#444c52'},{'highway':'*'},title='其他 OSM 道路'),
        prototype('road.campus','road','campus',{'generator':'road','width_m':6,'edge_width_m':.7,'color':'#6c7675'},{'highway':'service'},title='校内道路'),
        prototype('road.footway','road','footway',{'generator':'road','width_m':2.5,'color':'#d1c5a8'},{'highway':['footway','path','steps','pedestrian','cycleway']},title='步行道'),
        prototype('road.sidewalk','road','sidewalk',{'generator':'road','width_m':2.3,'color':'#b9c0b9'},title='人行道'),
        prototype('road.markings','road','markings',{'generator':'road','white':'#e5e8df','yellow':'#e9c45a','curb':'#e0e2d5','campus_edge':'#b3b8a6','dash_m':6,'period_m':12},title='车道标线'),
    ])
    for key, match, color in [('grass',{'landuse':['grass','meadow']},'#71915a'),('pitch',{'leisure':'pitch'},'#77a686'),('water',{'natural':'water'},'#5b9faf'),('parking',{'amenity':'parking'},'#78858b'),('outside',{},'#697867')]:
        params={'generator':'landcover','color':color}
        if key=='pitch': params['sport_colors']={'basketball':'#ba816c','tennis':'#6b9daa'}
        rows.append(prototype(f'landcover.{key}','landcover',key,params,match,title=f'地表 · {key}'))
    rows.append(prototype('vegetation.tree','vegetation','tree',{'generator':'tree','trunk':'#77594a','crown':['#458765','#568d5e','#6d9c62'],'top':['#71a36b','#80aa74','#95b77b'],'height_m':11}, {'natural':'tree'},kind='mesh',title='低多边形装饰树'))
    rows.append(prototype('street_furniture.lamp','street_furniture','lamp',{'generator':'lamp','color':'#39494d','height_m':8.3,'light':'#ffe0a0'}, {'highway':'street_lamp'},kind='mesh',title='装饰路灯'))
    rows.append(prototype('street_furniture.bench','street_furniture','bench',{'generator':'bench','wood':'#b78a5e','metal':'#45504c','width_m':4.6}, {'amenity':'bench'},kind='mesh',title='装饰长椅'))
    role_colors={'undergraduate_consumer':'#397fca','graduate_consumer':'#8864c5','teacher_consumer':'#39806b','merchant':'#e58b48'}
    variants=[{'id':role,'params':{'role':role}} for role in role_colors]
    rows.append(prototype('character.pixel','character','pixel',{'generator':'pixel-character','height_m':8.5,'fps':10.8,'role_colors':role_colors,'base_role_colors':{'undergraduate_consumer':'#4888bf','graduate_consumer':'#8b6ab0','teacher_consumer':'#4b9a83','merchant':'#dc8a3e'}},{},source=YULAN,kind='mesh',variants=variants,style='pixel',title='YuLan 像素人物'))
    rows.append(prototype('character.solid','character','solid',{'generator':'solid-character','height_m':8.5,'role_colors':role_colors,'skin':['#efc6a5','#dfb38f','#c9916f','#f2d4b7'],'hair':['#302a2b','#473329','#655049','#2c343a']},{},kind='mesh',variants=variants,style='solid',title='程序立体人物'))
    for key,color,text,duration in [('post','#54b5ed','••• 发帖',2.2),('comment','#bd85ec','••• 评论',2.4),('follow','#69d2c7','＋ 关注',2.3),('ad','#ffbe58','推广',2.8),('exposure','#ffbe58','收到广告',2.4),('interview','#f3d574','访谈',2.4),('purchase','#70e0b5','到店',2.8)]:
        rows.append(prototype(f'effect.{key}','effect',key,{'generator':'effect','color':color,'text':text,'duration':duration},{},title=f'事件 · {text}'))
    for key,color,title in [('selection','#ffbd49','人物选中光圈'),('walking','#fff7d6','行走光圈'),('route','#168b7a','A* 路线显示'),('relationship','#4c8ba6','关系连线'),('sky','#78b9e5','天空与日夜光照'),('coffee-cup','#fff6de','程序咖啡杯图标')]:
        rows.append(prototype(f'effect.{key}','effect',key,{'generator':'effect','color':color,'duration':2.4},{},title=title))
    rows.append(prototype('building.osm-footprint','building','footprint',{'generator':'footprint','use_source_geometry':True},{},source=OSM,title='OSM 原轮廓与默认高度'))
    return rows


def yulan_prototypes():
    rows=[]
    matches={21:{'building':['dormitory','apartments','hostel']},22:{'building':['university','school','college']},
             23:{'building':'office'},24:{'amenity':['cafe','restaurant','canteen']},25:{'building':'residential'},
             26:{'building':'*'},27:{'building':'detached'},28:{'building':['house','terrace']},
             29:{'building':['retail','commercial']},30:{'amenity':'library'}}
    for number in range(21,31):
        family='house' if number<27 else 'villa'
        variants=[{'id':f'model-{model}','params':{'model':model},'title':f'原图集变体 {model}'} for model in [1,2,3]]
        rows.append(prototype(f'building.yulan.{family}{number}','building',f'{family}{number}',
          {'generator':'yulan-building','atlasType':number,'model':1,'moduleWidth':8,'levels':4,'storey_height_m':3.2,
           'module_source':'native-base-floor-roof' if number<27 else 'documented-derived-villa-bands'},
          matches[number],source=YULAN,variants=variants,style='yulan',title=f'YuLan {family} {number} 模块套装'))
    sets={
      'bush':('vegetation',['decoration/40/40_1.png','decoration/40/40_2.png','decoration/40/40_16.png']),
      'tree_group':('vegetation',['decoration/41/41_1.png','decoration/43/43_1.png','decoration/45/45_1.png']),
      'planter':('street_furniture',['decoration/40/40_3.png','decoration/40/40_4.png','decoration/40/40_5.png']),
      'bench':('street_furniture',['decoration/40/40_6.png','decoration/40/40_14.png']),
      'lamp':('street_furniture',['decoration/40/40_7.png']),
      'garden':('street_furniture',['decoration/42/42_4.png','decoration/44/44_6.png','decoration/45/45_2.png']),
      'fountain':('street_furniture',['decoration/42/42_5.png','decoration/44/44_3.png','decoration/44/44_12.png']),
    }
    for name,(category,keys) in sets.items():
        variants=[{'id':f'variant-{i+1}','title':f'源帧 {i%len(keys)+1} / 厚度 {i+2}',
                   'params':{'atlasKey':keys[i%len(keys)],'depth':i+2}} for i in range(3)]
        rows.append(prototype(f'{category}.yulan.{name}',category,name,
          {'generator':'yulan-decoration','decorationSet':name,'atlasKey':keys[0],'atlasKeys':keys,'height':7,'depth':2,'resolution':36},
          source=YULAN,kind='mesh',variants=variants,style='yulan',title=f'YuLan {name} 体素'))
    roles=['undergraduate_consumer','graduate_consumer','teacher_consumer','merchant']
    rows.append(prototype('character.voxel','character','voxel',{'generator':'voxel-character','height_m':8.5,'resolution':40,'depth':2,'fps':10.8},
      source=YULAN,kind='mesh',style='voxel',variants=[{'id':role,'params':{'role':role}} for role in roles],title='YuLan 体素人物'))
    return rows


def thumbnail(item):
    colors={'building':'#76a0a7','road':'#596875','landcover':'#6b9b75','vegetation':'#448b60','street_furniture':'#a2825c','character':'#6d83b1','effect':'#b18ac8'}
    color=item['params'].get('wall',item['params'].get('color',colors[item['category']]))
    label=html.escape(item['title'])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="240" height="170" viewBox="0 0 240 170"><rect width="240" height="170" rx="12" fill="#edf2ed"/><path d="M50 110L120 145L195 108L125 75Z" fill="#d6e1d8"/><path d="M80 108V55L130 30L175 55V108L130 132Z" fill="{color}"/><path d="M80 55L130 80L175 55L130 30Z" fill="#d7e4df"/><path d="M130 80V132M90 70V108M105 78V116M148 80V115M162 72V108" stroke="#fff" stroke-width="4" opacity=".6"/><text x="120" y="160" text-anchor="middle" fill="#244b46" font-size="12" font-family="sans-serif">{label}</text></svg>'''


def main():
    rows=existing_prototypes()+yulan_prototypes()
    catalog={'schema_version':'mecoffe.asset-catalog.v1','title':'MeCoffe 三维素材库','matching_version':'exact-tags-v1',
             'coordinate_convention':'x east, y up, z south; source maps use WGS84 to local metres',
             'note':'原型描述显示样式，不产生 OASIS 行为或新的地图事实；OSM 几何与素材许可分别保留。','prototypes':rows}
    OUTPUT.mkdir(parents=True,exist_ok=True)
    (OUTPUT/'previews').mkdir(exist_ok=True)
    (OUTPUT/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    for item in rows: (OUTPUT/'previews'/f"{item['id']}.svg").write_text(thumbnail(item)+'\n',encoding='utf8')
    print(f'catalog: {len(rows)} prototypes')


if __name__=='__main__': main()
