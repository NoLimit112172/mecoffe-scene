# 楼栋用途分类表：auto-evidence.2

这是一份项目自己的、可审查的有限规则表，不是 OSM 全量字典。没有列出的标签值不作硬推断。正式依据是地图随带的 `evidence-rules.json`；当前发布源为 `adapter/scene_service/evidence_rules_v2.json`。

规则版本：`auto-evidence.2`；规范化内容 SHA-256：`e209fba9757b6416a2a1aa5d316c48d88a214eebd6d03bdcc4d18d0f45063315`。摘要不含 sha256 字段自身；原文件字节的摘要另由地图 manifest.files 登记。

## 分类总表

| 键 | 中文名与定义 | 正例 | 反例 | 可安置 |
| --- | --- | --- | --- | --- |
| `construction` | 在建或废弃：仍在施工或已废弃、毁坏的建筑，本版禁止安置。 | 在建楼、废弃楼 | 正常运营楼、仅名称含旧址的楼 | 否 |
| `culture` | 文化娱乐：开展文化展示、演出或娱乐活动的建筑。 | 博物馆、电影院、活动中心、KTV | 图书馆、教学楼 | 是 |
| `dining` | 餐饮：提供餐食或饮品的食堂、餐厅和咖啡场所。 | 食堂、餐厅、咖啡馆 | 餐饮旁的医院、超市 | 是 |
| `dormitory` | 宿舍：供学生集体居住的宿舍和学生公寓。 | 学生宿舍、学生公寓 | 商品住宅、酒店 | 是 |
| `education` | 教学：开展课堂教学和基础教育的建筑。 | 教学楼、中小学、幼儿园 | 研究所、院系办公楼 | 是 |
| `government` | 政务公共：提供政务、基层治理、公安或消防公共服务的建筑。 | 街道办事处、派出所、消防站 | 普通公司办公楼、公交站 | 是 |
| `hotel` | 酒店住宿：向旅客提供临时住宿的经营场所。 | 酒店、招待所、青年旅舍 | 住宅楼、学生宿舍 | 是 |
| `industrial` | 工业仓储：以生产、仓储或物流作业为主要用途的建筑。 | 厂房、仓库、物流中心 | 快递驿站、零售商店 | 是 |
| `library` | 图书馆：提供图书收藏、借阅和阅读服务的建筑。 | 图书馆 | 书店、博物馆 | 是 |
| `life_service` | 生活服务：提供银行、邮政、快递、理发、洗衣或维修等日常服务。 | 银行、快递驿站、理发店 | 超市、药店 | 是 |
| `medical` | 医疗：提供诊疗、医疗照护或药品零售的场所。 | 医院、校医院、诊所、药店 | 宠物医院、保健品店 | 是 |
| `office` | 办公：处理行政或商业办公事务的建筑。 | 写字楼、行政楼、院系办公楼 | 教学楼、实验楼 | 是 |
| `religious` | 宗教：用于宗教活动的寺庙、教堂等建筑。 | 寺庙、教堂 | 宗教用品店、纪念馆 | 是 |
| `research` | 科研：以实验和科学研究为主要用途的建筑。 | 实验楼、研究院、研究所 | 普通教学楼、办公楼 | 是 |
| `residential` | 住宅：家庭日常居住的住宅楼、小区住宅和别墅。 | 住宅楼、别墅 | 学生宿舍、宾馆 | 是 |
| `retail` | 零售：以商品零售为主要用途的商场和商铺。 | 商场、超市、便利店 | 理发店、洗衣店 | 是 |
| `sports` | 体育：开展体育运动、健身或游泳活动的建筑。 | 体育馆、健身房、游泳馆 | 体育用品店、室外球场 | 是 |
| `transport` | 交通：车站、停车楼等交通运输建筑，本版禁止安置。 | 火车站、停车楼 | 公交站点名称、普通道路 | 否 |
| `unknown` | 未知：证据不足或无法明确归类；允许已确认的任意楼栋兜底。 | 无名称无有效标签的楼 | 已有明确主用途的楼 | 仅已确认的兜底 |
| `utility` | 后勤设施：供能、设备、门卫、垃圾处理或公厕等后勤建筑，本版禁止安置。 | 配电房、门卫室、公厕 | 行政办公楼、住宅 | 否 |

旧 8 类的键保留。新规则把理发、洗衣、银行、快递等明确归到 life_service，不归 retail；旧规则里没识别的值也不会因此被重新解释。unknown 不参加严格用途匹配，但可参加用户已确认的 any_building_in_scope 兜底。

## 每类的具体标签和名称规则

标签必须逐个值精确命中。`building=yes/commercial` 不映射；`amenity=university` 不映射，更不会从校园边界下放给每栋楼。`building=university/college/school` 保留 generic_education 降级逻辑：具体名称或达标 AI 指向其他用途时，不再让该楼参加教学匹配；没有更具体主用途时保留教学证据。

每条名称规则先受全局排除词约束，同楼命中多个不同用途的名称规则时全部退回弱证据并报警。不同用途的具体建筑标签冲突时保留同档证据并报警，不由名称或 AI 擅自覆盖。

### construction：在建或废弃

标签：`abandoned:building=yes`；`building=construction, ruins`

名称规则 `construction-suffix`：

```regex
(?:在建楼|施工楼|废弃楼|废弃建筑)$
```

### culture：文化娱乐

标签：`amenity=arts_centre, cinema, community_centre, nightclub, theatre`；`building=cinema, museum, theatre`；`tourism=gallery, museum`

名称规则 `culture-suffix`：

```regex
(?:博物馆|剧院|电影院|活动中心|KTV|ktv)$
```

### dining：餐饮

标签：`amenity=bar, cafe, canteen, fast_food, food_court, ice_cream, pub, restaurant`

名称规则 `dining-suffix`：

```regex
(?:食堂|餐厅|咖啡馆|咖啡厅|快餐店)(?:[A-Za-z0-9一二三四五六七八九十]+区)?$
```

### dormitory：宿舍

标签：`building=dormitory`

名称规则 `dormitory-suffix`：

```regex
(?:学生公寓|宿舍楼?)(?:[A-Za-z0-9一二三四五六七八九十]+(?:号楼|栋|区))?$
```

### education：教学

标签：`amenity=college, kindergarten, school`；`building=college, kindergarten, school, university`

名称规则 `education-suffix`：

```regex
(?:教学楼|小学|中学|幼儿园)$
```

### government：政务公共

标签：`amenity=courthouse, fire_station, police, townhall`；`building=civic, fire_station, government`；`office=diplomatic, government`

名称规则 `government-suffix`：

```regex
(?:人民政府|街道办事处|街道办|居委会|派出所|消防站)$
```

### hotel：酒店住宿

标签：`building=hotel`；`tourism=apartment, guest_house, hostel, hotel, motel`

名称规则 `hotel-suffix`：

```regex
(?:酒店|宾馆|旅馆|招待所|青年旅舍|青旅)$
```

### industrial：工业仓储

标签：`building=factory, industrial, warehouse`；`man_made=silo, storage_tank, warehouse, works`

名称规则 `industrial-suffix`：

```regex
(?:厂房|仓库|物流中心|仓储中心)$
```

### library：图书馆

标签：`amenity=library`；`building=library`

名称规则 `library-suffix`：

```regex
图书馆$
```

### life_service：生活服务

标签：`amenity=atm, bank, parcel_locker, post_office`；`office=financial`；`shop=beauty, bicycle_repair, car_repair, copyshop, dry_cleaning, hairdresser, laundry, locksmith, shoe_repair, tailor`

名称规则 `life_service-suffix`：

```regex
(?:银行|邮局|邮政所|快递驿站|理发店|理发室|洗衣店|维修店)$
```

### medical：医疗

标签：`amenity=clinic, dentist, doctors, hospital, nursing_home, pharmacy`；`building=clinic, hospital`；`healthcare=blood_donation, clinic, dentist, doctor, hospital, pharmacy, physiotherapist, rehabilitation`；`shop=medical_supply`

名称规则 `medical-suffix`：

```regex
(?:医院|卫生院|诊所|药店|医务室|门诊楼|住院楼|急诊楼|医技楼|住院部|门诊部|病房楼)$
```

### office：办公

标签：`building=office`；`office=accountant, administrative, architect, association, company, coworking, employment_agency, estate_agent, insurance, it, lawyer, telecommunication`

名称规则 `office-suffix`：

```regex
(?:办公楼|行政楼|写字楼)$
```

### religious：宗教

标签：`amenity=place_of_worship`；`building=cathedral, chapel, church, mosque, religious, shrine, synagogue, temple`

名称规则 `religious-suffix`：

```regex
(?:寺庙|寺|教堂|清真寺)$
```

### research：科研

标签：`building=laboratory, research`；`office=research`

名称规则 `research-suffix`：

```regex
(?:实验楼|实验大楼|研究院|研究所|科研楼)$
```

### residential：住宅

标签：`building=apartments, bungalow, detached, house, residential, semidetached_house, terrace, villa`

名称规则 `residential-suffix`：

```regex
(?:住宅楼|居民楼|别墅)$
```

### retail：零售

标签：`building=kiosk, retail, supermarket`；`shop=bakery, books, butcher, clothes, convenience, department_store, electronics, furniture, general, greengrocer, hardware, kiosk, mall, shoes, stationery, supermarket, variety_store`

名称规则 `retail-suffix`：

```regex
(?:购物广场|商业广场|购物中心|商场|百货大楼|超市|便利店)$
```

### sports：体育

标签：`building=sports_centre, sports_hall, stadium`；`leisure=fitness_centre, sports_centre, sports_hall, stadium, swimming_pool`

名称规则 `sports-suffix`：

```regex
(?:体育馆|健身房|游泳馆)$
```

### transport：交通

标签：`amenity=bus_station, ferry_terminal, parking`；`building=carport, garages, parking, train_station, transportation`；`public_transport=station`；`railway=station`

名称规则 `transport-suffix`：

```regex
(?:火车站|汽车站|客运站|地铁站|车站|停车楼)$
```

### unknown：未知

标签：不硬映射。

名称：不作确定性命中；证据不足时归 unknown。

### utility：后勤设施

标签：`amenity=recycling, toilets, waste_disposal`；`building=gatehouse, toilets, transformer_tower`；`man_made=pumping_station, wastewater_plant, water_tower, water_works`；`power=generator, plant, substation, transformer`

名称规则 `utility-suffix`：

```regex
(?:配电房|配电室|锅炉房|泵房|门卫室?|垃圾站|公厕|厕所)$
```

## 排除词和边界

```regex
旧址|遗址|拆除|筹建|拟建|原址|^原
道路|路口|公交站牌|公交站点|地铁出入口|(?:路|街|大道|大街|东门|西门|南门|北门|大门|停车场)$
宠物医院$
```

不再笼统排除“广场”“站”“门”。“购物广场/商业广场”可按名称判零售；只有“XX广场”仍不足以断定是商场，可凭 shop=mall 等具体标签判断，否则保留未知。具体的火车站、汽车站、消防站和门卫室分别分类。路口、道路名、公交站牌/站点、地铁出入口、校园大门名仍不作名称强证据。

证据不增加小类字段：建筑/POI 的原始 key/value 保留；新名称规则的 key 是规则 ID，value 保存实际命中的名称后缀。显示端可因此显示“医疗·医院”“餐饮·餐厅”；AI 未提供可核实小类时只显示大类，不猜小类。

主用途只采用 annotation > building_tag > name_rule > ai_inferred；通用教学标签在具体用途之后。annotation 的 add 仍保留具体建筑标签用途，replace 替换主用途但不删真实楼内 POI 服务。楼内 POI 只进 services；完全没有主用途时才临时据其推断主用途：先取场所级 POI，若没有再取普通 POI 的并集。场所级的理由为“仅据楼内设施推断”，普通的仍为“仅据楼内店铺推断”；两者都进入 AI 待判断清单。附近 POI 只作 AI 背景，不能当成楼内服务。

AI 的类别定义直接采用同一份 taxonomy，阈值仍为 80%，比较原始小数而非四舍五入后的百分比；结果只带整数 confidence_pct。无 AI 或人工补注也可在质量达标后发布。

## 医院补丁：楼内场所级 POI

医疗名称新增门诊楼、住院楼、急诊楼、医技楼、住院部、门诊部、病房楼；原有“宠物医院”排除保留。其他类别的名称规则没有改动。

新字段 `venue_poi_functions` 与整个规则 JSON 一起冻结。它只识别位于唯一楼栋内的点，不解释整片院区，也不把校园 amenity=university 下放到每栋楼。场所级表如下，共 12 个具体值：

| 标签 | 场所类别 |
| --- | --- |
| `amenity=college` | education（教学） |
| `amenity=courthouse` | government（政务公共） |
| `amenity=fire_station` | government（政务公共） |
| `amenity=hospital` | medical（医疗） |
| `amenity=kindergarten` | education（教学） |
| `amenity=place_of_worship` | religious（宗教） |
| `amenity=police` | government（政务公共） |
| `amenity=school` | education（教学） |
| `amenity=townhall` | government（政务公共） |
| `amenity=university` | education（教学） |
| `healthcare=hospital` | medical（医疗） |
| `tourism=hotel` | hotel（酒店住宿） |

诊所（含 healthcare=clinic）、药店、餐厅、商店、银行不算场所级。此表没有通配项，没有扩展到整类 amenity/healthcare/tourism。已有标签映射的用途必须与场所级表一致，否则规则校验失败。

只有主用途证据全缺、必须从楼内 POI 推断时，此表才影响主用途选择：有场所级 POI 时只复制它们到 primary，普通店面仍留在 services；没有则保持普通 POI 并集。若多个场所级类别并存，保留其类别并继续待 AI 判断，不擅自选一个。`primary_from_services=true`、`needs_ai_review=true` 均保留，不能因为有场所标记就冒充人工确认或跳过 AI 待判断清单。已有建筑标签、名称规则、达标 AI 或人工补注的主用途优先级不变。

例如无名 building=yes 楼内有 hospital+restaurant：主用途只有医疗，services 含医疗和餐饮；有别的餐饮主用途楼时品牌去那里，没有时才走医院楼内服务层。clinic+restaurant 则仍保留原来的餐饮/医疗并集。三维/GIS 的简短提示统一写“仅据楼内兴趣点推断”，详情理由区分设施和店铺。

## 后续记录，本补丁不实现

医院、学校若只标在整个院区多边形上，目前不会把院区用途继承给内部楼栋。先请建图维护者在绿化、水体、多段关系处理时保留院区多边形，再单独约定楼栋继承范围、孔洞/重叠处理、证据来源和冲突优先级后接入用途规则。当前仍不做跨楼、就近或整片校园的自动下放。医院点在楼外、轮廓边界或多栋重叠处时，仍不能关联为楼内证据。本补丁不等于真实院区里的所有楼都已获得医疗用途。

其他类别尚未补的名称例子：教学中心、实验中心/科研中心、行政中心、变电站等。它们需要下一轮按真实样本评审；本次不新增对应正则。特别是仅有“变电站”名称而无有效标签时，仍可能是 unknown，当前 unknown 允许已确认的任意楼栋兜底；不能把这张有限名称表当成后勤设施的完整识别保证。
