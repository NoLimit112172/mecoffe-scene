"""Rebuild the versioned prototype catalogue and code-native SVG thumbnails."""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'frontend/public/mecoffe/assets3d'
PROCEDURAL = {'type': 'procedural', 'title': 'MeCoffe 程序生成', 'author': 'MeCoffe contributors', 'path': 'frontend/src/mecoffe/'}
YULAN = {'type': 'yulan', 'title': 'YuLan-OneSim 图集', 'author': 'RUC-GSAI/YuLan-OneSim', 'revision': '9829d72', 'path': 'frontend/public/assets/bgrd-*.json/png', 'url': 'https://github.com/RUC-GSAI/YuLan-OneSim'}
OSM = {'type': 'osm', 'title': 'OpenStreetMap geometry', 'author': 'OpenStreetMap contributors', 'path': 'data/osm/', 'url': 'https://www.openstreetmap.org/copyright'}
ROCKETBOX = {'type':'rocketbox','title':'Microsoft Rocketbox Avatar Library','author':'Microsoft / Rocketbox Studios',
            'revision':'0943055db6ec570bcef9f2c8b41c9e5467c808f9','path':'frontend/public/mecoffe/assets3d/rocketbox/manifest.json',
            'url':'https://github.com/microsoft/Microsoft-Rocketbox'}
KENNEY={'type':'kenney','title':'Kenney Nature Kit 2.1','author':'Kenney','path':'frontend/public/mecoffe/assets3d/kenney/manifest.json','url':'https://kenney.nl/assets/nature-kit'}
VALID={'type':'valid','title':'VALID 亚洲预设人物','author':'Tiffany Do / University of Central Florida / Google','path':'frontend/public/mecoffe/assets3d/valid/manifest.json','url':'https://github.com/google/valid-avatar-library'}
LICENSES = {'procedural': {'spdx': 'LicenseRef-MeCoffe-Project', 'path': 'NOTICE.md', 'note': '项目程序生成，随仓库源码提供；未另行授予外部模型许可'},
            'yulan': {'spdx': 'Apache-2.0', 'path': 'YULAN_LICENSE'},
            'osm': {'spdx': 'ODbL-1.0', 'url': 'https://www.openstreetmap.org/copyright', 'path': 'NOTICE.md'},
            'rocketbox':{'spdx':'MIT','path':'frontend/public/mecoffe/assets3d/rocketbox/LICENSE.md',
                        'note':'Microsoft (c) 2020；原模型与贴图按固定提交保存，TGA无损转换PNG；动作由项目程序驱动骨骼'},
            'kenney':{'spdx':'CC0-1.0','path':'frontend/public/mecoffe/assets3d/kenney/License.txt','note':'Kenney Nature Kit 2.1；原包 CC0；署名 Kenney / www.kenney.nl 属于自愿致谢，不是许可义务；保留原始 License.txt'},
            'valid':{'spdx':'MIT','path':'frontend/public/mecoffe/assets3d/valid/LICENSE','note':'Copyright (c) 2022 Tiffany Do；MIT：分发副本或实质部分时须保留版权声明和完整许可文本；上游合成人物标签随原模型保留'}}


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
    for roof_type, title in [('flat', '实体平屋顶：女儿墙与设备'), ('pitched', '实体坡屋顶：屋脊与檐口')]:
        rows.append(prototype(f'building.component.roof-{roof_type}', 'building', f'roof-{roof_type}',
          {'generator':f'roof-{roof_type}', 'roof_texture':False, 'seed':2026, 'modeling':'程序生成实体屋顶；高度与设备为展示设计'},
          variants=([{'id':f'seed-{seed}','params':{'seed':seed},'title':f'固定种子 {seed}'} for seed in [2026,2027,2028]] if roof_type == 'flat' else
                    [{'id':f'pitched-{model}','params':{'model':model,'width_m':width,'tile_color':color},'title':f'坡顶配色 {model}'}
                     for model,width,color in [(1,18,'#846342'),(2,22,'#b26648'),(3,26,'#68777f')]]),title=title))
    rows.append(prototype('building.component.foundation','building','foundation',
      {'generator':'foundation','top_m':.94,'outline_offset_m':.75,'modeling':'程序生成建筑基座与接触阴影，非实测高程'}, title='建筑基座与接缝'))
    rows.append(prototype('landcover.layered-base','landcover','layered-base',
      {'generator':'layered-base','base_bottom_m':-19,'stone_top_m':-13,'earth_top_m':-5.1,'outside_top_m':-3.8,
       'campus_road_m':.14,'campus_grass_m':.62,'campus_curb_m':.72,'external_road_m':-3,
       'external_sidewalk_m':-2.48,'external_curb_m':-2.34,'modeling':'展示层分层底座与路槽，非测量高程'},title='分层沙盘底座与道路高差'))
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
        if key=='water': params.update({'generator':'water-basin','surface_height_m':-.55,'shallow_depth_m':.22,'max_depth_m':2.8,'depth_source':'illustrative-not-surveyed','bank_width_m':1.8})
        rows.append(prototype(f'landcover.{key}','landcover',key,params,match,title=f'地表 · {key}',
          variants=[{'id':f'depth-{depth}','title':f'设定最大水深 {depth}m','params':{'max_depth_m':depth}} for depth in [2.8,1.6,.8]] if key=='water' else None))
    rows.append(prototype('vegetation.tree','vegetation','tree',{'generator':'tree','trunk':'#77594a','crown':['#458765','#568d5e','#6d9c62'],'top':['#71a36b','#80aa74','#95b77b'],'height_m':11}, {'natural':'tree'},kind='mesh',title='低多边形装饰树'))
    rows.append(prototype('street_furniture.lamp','street_furniture','lamp',{'generator':'lamp','color':'#39494d','height_m':8.3,'light':'#ffe0a0'}, {'highway':'street_lamp'},kind='mesh',title='装饰路灯'))
    rows.append(prototype('street_furniture.bench','street_furniture','bench',{'generator':'bench','wood':'#b78a5e','metal':'#45504c','width_m':4.6}, {'amenity':'bench'},kind='mesh',title='装饰长椅'))
    rows.append(prototype('landcover.sports.track400','landcover','track',
      {'generator':'sports-track400','inner_radius_m':36.5,'straight_m':84.39,'lane_width_m':1.22,'lanes':8,'measurement_offset_m':.3,
       'reference_url':'https://worldathletics.org/about-iaaf/documents/technical-information','placement':'user-annotated wrapper around mapped USTC soccer pitch; not a surveyed track outline'},
      {'leisure':'track','sport':['athletics','running']},kind='mesh',title='400m标准型跑道与足球场',
      variants=[{'id':f'lanes-{lanes}','title':f'{lanes}道原型','params':{'lanes':lanes}} for lanes in [8,6,4]]))
    for sport,width,length,title in [('basketball',15,28,'篮球场与立体篮架'),('tennis',10.97,23.77,'网球场与球网'),('badminton',6.1,13.4,'羽毛球场与球网')]:
        rows.append(prototype(f'landcover.sports.{sport}','landcover','pitch',{'generator':f'sports-{sport}','width_m':width,'length_m':length,'layout':'scaled/tiled presentation layout, not a surveyed court count'},
          {'leisure':'pitch','sport':sport},kind='mesh',title=title,variants=[{'id':key,'title':label,'params':{'surface_color':color}} for key,label,color in [('standard','标准配色',{'basketball':'#b76b50','tennis':'#477b7c','badminton':'#527d66'}[sport]),('blue','蓝色面层','#4c84a4'),('green','绿色面层','#60875b')]]))
    rows.append(prototype('road.bridge','road','bridge',{'generator':'bridge','width_m':10,'length_m':44,'approach_m':10,'deck_height_m':1.05,'placement':'inferred at existing OSM road/water intersections; style and dimensions illustrative'},
      {'bridge':'yes'},kind='mesh',title='跨水桥梁、护栏与坡道',variants=[{'id':f'width-{w}','title':f'展示桥宽 {w}m','params':{'width_m':w}} for w in [10,8,6]]))
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
           'module_source':'native-base-floor' if number<27 else 'documented-derived-villa-wall-bands',
           'roof_generator':'procedural-3d','roof_texture':False,
           'facade_shape_constraints':{'circular_models':{22:[2],24:[2],25:[1,2,3]}.get(number,[]),'noncircular_fallback':'same-family-straight-or-house26'},
           'modeling':'YuLan 原立面 + 程序实体屋顶；屋顶设备为展示设计'},
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
    return rows


def rocketbox_prototypes():
    manifest=json.loads((OUTPUT/'rocketbox/manifest.json').read_text(encoding='utf8'))
    variants=[{'id':model['id'],'title':model['label'],'params':{'model_id':model['id']}} for model in manifest['models']]
    rows=[prototype('character.rocketbox','character','realistic',
      {'generator':'rocketbox-character','height_m':8.5,'radius_m':3,'default':True,
       'manifest':'/mecoffe/assets3d/rocketbox/manifest.json','animation':'procedural-skeleton-idle-walk-coffee',
       'modeling':'Rocketbox 原始带骨骼人体与服装；外观按ID稳定选型，仅为展示原型，不推断真实人物外貌'},
      source=ROCKETBOX,kind='mesh',style='realistic',variants=variants,title='Rocketbox 写实人物全集')]
    for model in manifest['models']:
        group=model.get('category','adults')
        params={'generator':'rocketbox-character','model_id':model['id'],'group':group,'height_m':8.5,'radius_m':3,
                'preview_pose':'idle','modeling':'原始带骨骼人形；分类仅描述素材外观，不推断模拟人物身份'}
        row=prototype(f"character.rocketbox.{model['id']}",'character','realistic',params,source=ROCKETBOX,kind='mesh',style='realistic',
                      variants=[{'id':key,'title':title,'params':{'preview_pose':key}} for key,title in [('idle','站立'),('walk','行走'),('coffee','持杯')]],
                      title=model['label'])
        row['source']['path']=f"frontend/public/mecoffe/assets3d/rocketbox/{model['fbx']}"
        rows.append(row)
    return rows


def campus_prototypes():
    rows=[]
    poses=[{'id':k,'title':t,'params':{'preview_pose':k}} for k,t in [('idle','站立'),('walk','行走'),('coffee','持杯')]]
    models=json.loads((OUTPUT/'valid/manifest.json').read_text(encoding='utf8'))['models']
    for model in models:
        row=prototype('character.valid.'+model['id'],'character','realistic',{'generator':'rocketbox-character','model_id':model['id'],'library':'valid','group':model['category'],'gender':model['gender'],'ethnicity':model['ethnicity'],'preview_pose':'idle'},source=VALID,kind='mesh',style='realistic',variants=poses,title=model['label'])
        row['scene_scope']='ustc';rows.append(row)
    nature=json.loads((OUTPUT/'kenney/manifest.json').read_text(encoding='utf8'))['models']
    for model in nature:
        row=prototype('vegetation.kenney.'+model['id'],'vegetation',model['kind'],{'generator':'kenney-vegetation','model_id':model['id']},source=KENNEY,kind='mesh',style='kenney',
            variants=[{'id':str(h),'title':f'展示高 {h}m','params':{'height_m':h}} for h in ([8,10,12] if model['kind']=='tree' else [1.5,2,2.5])],title=('三维乔木 · ' if model['kind']=='tree' else '三维灌木 · ')+model['id'])
        row['scene_scope']='ustc';rows.append(row)
    campus=json.loads((ROOT/'scene/campus3d.json').read_text(encoding='utf8'))
    features=json.loads((ROOT/'frontend/public/mecoffe/campus3d_landcover.json').read_text(encoding='utf8'))['features']
    people=json.loads((ROOT/'frontend/public/mecoffe/latest-network.json').read_text(encoding='utf8'))['people']
    def instance(identifier,category,params,title,source,origin):
        row=prototype(identifier,category,'campus-instance',params,source=source,kind='mesh',title=title,
            variants=poses if category=='character' else [{'id':'campus','title':'当前场景原型','params':{}}])
        row.update({'target':'component','scene_scope':'ustc','scene_instance':origin})
        return row
    for building in campus['buildings']:
        row=instance('building.campus.'+building['osm_id'].replace('/','-'),'building',{'generator':'campus-building','building':building},building.get('name') or building['osm_id'],YULAN,{'kind':'building','id':building['osm_id']})
        row['geometry_source']={'type':'osm','license':'ODbL-1.0','path':'scene/campus3d.json'};rows.append(row)
    for person in people:
        gender={'m':'male','f':'female','male':'male','female':'female'}.get(str(person.get('gender','')).lower())
        outfit='business' if person['role']=='teacher_consumer' else 'casual'
        eligible=sorted((m for m in models if m['category']==outfit and (not gender or m['gender']==gender)),key=lambda m:m['id'])
        value=2166136261
        for letter in person['id']:value=((value^ord(letter))*16777619)&0xffffffff
        selected=eligible[value%len(eligible)]
        row=instance('character.campus.'+person['id'],'character',{'generator':'rocketbox-character','library':'valid','model_id':selected['id'],'preview_pose':'idle','person_id':person['id'],'gender':person.get('gender'),'role':person['role']},f"{person['name']} · {person['role_label']} · {'男' if gender=='male' else '女' if gender=='female' else '性别未提供'}",VALID,{'kind':'person','id':person['id'],'profile_source':'frontend/public/mecoffe/latest-network.json'})
        rows.append(row)
    for feature in features:
        kind=feature['kind']
        if kind not in ['pitch','water']:continue
        row=instance('landcover.campus.'+feature['osm_id'].replace('/','-'),'landcover',{'generator':'campus-sports' if kind=='pitch' else 'campus-water','feature':feature},('校内运动场 · '+str(feature.get('sport','')) if kind=='pitch' else '永怀湖 · 有深度水域')+' · '+feature['osm_id'],PROCEDURAL,{'kind':kind,'id':feature['osm_id']})
        row['geometry_source']={'type':'osm','license':'ODbL-1.0','path':'frontend/public/mecoffe/campus3d_landcover.json'};rows.append(row)
    water=next(f for f in features if f['kind']=='water')
    for road in campus['roads']:
        if road['osm_id'] not in ['way/1242495999','way/1242496025']:continue
        rows.append(instance('road.campus.'+road['osm_id'].replace('/','-'),'road',{'generator':'campus-bridge','road':road,'water':water},'校内跨水通行面 · '+road['osm_id'],PROCEDURAL,{'kind':'bridge','id':road['osm_id'],'illustrative':True}))
    return rows


def thumbnail(item):
    colors={'building':'#76a0a7','road':'#596875','landcover':'#6b9b75','vegetation':'#448b60','street_furniture':'#a2825c','character':'#6d83b1','effect':'#b18ac8'}
    color=item['params'].get('wall',item['params'].get('color',colors[item['category']]))
    label=html.escape(item['title'])
    if item['source']['type'] in ['rocketbox','valid']:
        return f'''<svg xmlns="http://www.w3.org/2000/svg" width="240" height="170" viewBox="0 0 240 170"><rect width="240" height="170" rx="12" fill="#edf2ed"/><ellipse cx="120" cy="136" rx="48" ry="9" fill="#cedbd1"/><ellipse cx="120" cy="33" rx="12" ry="15" fill="#d0a185"/><path d="M110 22Q120 13 131 24L131 31Q117 22 109 31Z" fill="#49372d"/><path d="M116 46L116 51Q98 51 98 69L94 96L100 99L110 70L110 93L130 93L130 70L140 99L146 96L141 67Q139 51 124 51L124 46" fill="#467b8b"/><path d="M110 91L130 91L133 130L124 132L120 106L116 132L107 130Z" fill="#3b4a60"/><path d="M106 130L116 130L116 137L103 137ZM124 130L134 130L138 137L124 137Z" fill="#302f32"/><text x="120" y="160" text-anchor="middle" fill="#244b46" font-size="12" font-family="sans-serif">{label}</text></svg>'''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="240" height="170" viewBox="0 0 240 170"><rect width="240" height="170" rx="12" fill="#edf2ed"/><path d="M50 110L120 145L195 108L125 75Z" fill="#d6e1d8"/><path d="M80 108V55L130 30L175 55V108L130 132Z" fill="{color}"/><path d="M80 55L130 80L175 55L130 30Z" fill="#d7e4df"/><path d="M130 80V132M90 70V108M105 78V116M148 80V115M162 72V108" stroke="#fff" stroke-width="4" opacity=".6"/><text x="120" y="160" text-anchor="middle" fill="#244b46" font-size="12" font-family="sans-serif">{label}</text></svg>'''


def main():
    rows=existing_prototypes()+yulan_prototypes()+rocketbox_prototypes()+campus_prototypes()
    for row in rows:
        if row['source']['type']=='procedural' and (row['category'] in ['road','landcover','effect','street_furniture'] or '.component.' in row['id']):row['scene_scope']='ustc'
    catalog={'schema_version':'mecoffe.asset-catalog.v1','title':'MeCoffe 三维素材库','matching_version':'exact-tags-v1',
             'coordinate_convention':'x east, y up, z south; source maps use WGS84 to local metres',
             'note':'原型描述显示样式，不产生 OASIS 行为或新的地图事实；OSM 几何与素材许可分别保留。','prototypes':rows}
    OUTPUT.mkdir(parents=True,exist_ok=True)
    (OUTPUT/'previews').mkdir(exist_ok=True)
    (OUTPUT/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    for item in rows: (OUTPUT/'previews'/f"{item['id']}.svg").write_text(thumbnail(item)+'\n',encoding='utf8')
    print(f'catalog: {len(rows)} prototypes')


if __name__=='__main__': main()
