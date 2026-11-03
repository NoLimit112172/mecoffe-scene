# Rocketbox 写实人物试用交付记录

本轮在既有三维校园中加入接近真人比例的免费模型，供比较人物观感。分支继续为 `feat/asset-library`；只做本地提交，不 push，不改 `main`，不结束现有5180服务。本文与实现共同提交；提交号可用 `git log -1 --format=%h -- docs/rocketbox-trial.md` 查询。

## 素材与来源

模型来自 [Microsoft Rocketbox 官方仓库](https://github.com/microsoft/Microsoft-Rocketbox)，固定提交为 `0943055db6ec570bcef9f2c8b41c9e5467c808f9`。只选取以下四个现代便装模型，没有克隆整个仓库：

| 模型 ID | 外观 | 原始 FBX 三角面数 |
| --- | --- | --- |
| `Female_Adult_01` | 粉色上衣、牛仔长裤 | 8732 |
| `Female_Adult_03` | 紫色上衣、黑色长裤 | 9208 |
| `Male_Adult_01` | 条纹短袖、短裤 | 7440 |
| `Male_Adult_14` | 衬衫、浅色长裤 | 6842 |

许可依据为固定提交中的根目录 `LICENSE.md`（MIT）及上游 README 的 MIT 更新声明，不采用早期“仅研究用途”公告替代当前仓库许可。本地保留原文 `frontend/public/mecoffe/assets3d/rocketbox/LICENSE.md` 和 `UPSTREAM_README.md`。这里的素材是 **MIT，不是 CC0**。

运行素材总计 **4个FBX、11张PNG，15,260,735字节，约14.55 MiB**（含许可、上游说明和manifest，后续增加元数据可能有微小变化）。`manifest.json` 逐项记录官方仓库、提交、模型及源纹理URL、源Git blob SHA1、源文件SHA256、运行文件SHA256、尺寸、格式与转换过程。

## 格式与转换

- 本轮采用 **Three.js FBXLoader 直接加载 FBX**，没有转为GLB，也没有安装或下载Blender。四个原始非facial FBX保留原字节。
- 每个FBX实际包含一个SkinnedMesh、80个绑定骨和81个骨节点；没有在此标准导出中发现可切换的多档LOD。不能把上游完整制作流程支持的LOD误报成本次文件里已有的内容。
- 只下载身体、头部及需要的透明部件颜色纹理。原始TGA均为2048×2048，运行PNG最长边限制为1024，使用Pillow LANCZOS缩小，保留RGB/RGBA模式与alpha通道。这是有明确记录的分辨率降低，不称为与原TGA逐像素无损相同。
- 三张透明纹理仍有完整alpha范围。运行时依据PNG自身alpha处理头发等部件；不把同一彩色图再次当作绿通道透明遮罩。原始Max材质的黑色乘色也在导入时修正。
- 未打包原法线或高光贴图；原始TGA缓存约153MB，仅保存在被Git忽略的 `logs/asset-library/rocketbox-downloads/`，不进入public或提交。
- 原始网格为Y向上、Z向前，模型高度约174–182原单位。前端统一显示尺度并对齐地面；全景为可辨认而放大人物，仍是展示尺度。

## 运行方式与不变项

“写实人物”作为本轮试用入口；仍可切回“立体 YuLan / 像素贴图 / 体素”。四种外观按人物ID稳定复用，同一人物重复加载选型一致；这四种模型是展示原型，**不是团队人物的真实肖像，也不从人物画像推断外貌、性别或族裔**。素材库登记 `character.rocketbox`，四个模型作为其外观变体。

身体使用原始带权重的模型和骨架，待机、走路、持杯动作由项目代码驱动。没有下载Rocketbox的417动作包，也没有引入Mixamo或其他混合来源动作。原FBX自带的 `Take 001` 只有约0.033秒、6条轨道，是初始姿势，不把它描述为动作捕捉或行走动画。

每个人物实例有自己的骨架，复用模型原型及可共享资源。位置、朝向、回放暂停、去店/返回和持杯状态继续读取现有展示状态；不会修改订单、统计、人物关系或OASIS决策。

中科大回放页面继续使用YuLan建筑，建筑、OSM地图、地点映射、原始A*及三种回放数据不因本轮换人物而改变。`/mecoffe` 二维页面保留。顶部“人物所在楼栋与行走路线为展示层示意，OASIS 没有位置数据”提示继续保留。

## 主要改动

- 获取与诊断：`adapter/rocketbox_assets.py`、`adapter/rocketbox_diagnose.mjs`。前者限定四个模型并记录转换来源；后者使用安装的Three.js FBXLoader检查骨架、网格、UV、材质和原始尺度，诊断写入manifest及忽略日志。
- 运行素材：`frontend/public/mecoffe/assets3d/rocketbox/`，含上述四模型、11张PNG、MIT原文、上游README与manifest。
- 人物实现：`frontend/src/mecoffe/Campus3DRealCharacters.js` 中的 `RealCharacterBatch`；`rocketboxCharacterModel.js` 中的稳定选型、纹理映射、姿态等纯函数。
- 页面接入：`frontend/src/mecoffe/Campus3DScene.js`、`frontend/src/views/MeCoffe3D.vue`、`frontend/src/components/Campus3DVisualControls.vue`，包含加载、显隐、暂停、切换和释放。
- 素材库：`adapter/build_asset_catalog.py`、`frontend/public/mecoffe/assets3d/catalog.json`、`previews/character.rocketbox.svg`、`previews/character.yulan3d.svg`、`frontend/src/mecoffe/assetCatalog.js`、`assetPreviewYulan.js`、`frontend/src/views/AssetLibrary.vue`。
- 测试：新增 `adapter/test_rocketbox_assets.py`、`frontend/tests/rocketboxCharacters.test.js`；调整 `frontend/tests/campus3dScene.test.js`、`campus3dTraffic.test.js` 中的默认人物及接入验证。
- 来源与使用说明同步：`README.md`、`NOTICE.md`、`frontend/public/mecoffe/assets3d/README.md`，以及本交付记录。
- `.gitattributes` 仅给新模型目录中的许可/来源文件保留原字节，并明确FBX/PNG为二进制，避免Windows换行转换破坏来源哈希。原版 `UPSTREAM_README.md` 含上游行尾空白，保留源哈希并仅豁免该文件的空白检查。

完整逐文件清单可用 `git show --name-only` 查看；截图及验证日志保留在被Git忽略的本机目录。

## 验证

| 检查 | 最终结果 |
| --- | --- |
| `python -X utf8 -m unittest discover -s adapter -v` | 57/57，退出码0；`rocketbox-python-tests.txt` |
| 在frontend执行 `npm test` | 166/166，退出码0；`rocketbox-frontend-tests.txt` |
| 在frontend执行 `npm run build` | 退出码0，16.38秒；保留既有大包和CharacterFactory混合导入提示，见 `rocketbox-build.txt` |
| `node adapter/rocketbox_diagnose.mjs` | 4个真实模型全部成功，骨架/UV/权重有效；`rocketbox-diagnostics.json` |
| manifest中的FBX/PNG SHA256、源Git blob SHA1、尺寸和alpha | 全部匹配；11张1024PNG，3张RGBA透明图保留0..255 alpha，见 `rocketbox-asset-checks.json` |
| 4模型及11张PNG的本地HTTP访问 | 全部HTTP200；所有模型请求为本机地址，无TGA或外部模型网络请求 |
| 浏览器默认写实、走路、三种旧模式切换、无页面错误 | 100个模型实例、4种外观，默认26人可见；三种数据模式、四人物风格及高低画质切换通过，errors=[] |
| 固定相机下碰撞与速度约束、暂停、订单唯一性 | 暂停800ms位置/骨骼一致；100人/12笔并发订单996帧即39.84显示秒完成往返；历史第2天79人在途、85可见，现场碰撞0、不可达0 |
| 真实蒙皮人物包络与持杯 | 4模型×48相位全部变形顶点，最低脚底0.00506、最高8.42616、含杯最大半径2.48953（约定高8.5/半径3）；`rocketbox-envelopes.json` |
| 性能采样 | Node下100人/24可见骨骼更新中位1.69ms、P95 1.96ms（不含GPU）；Chrome 1600×1000高画质、暂停时85可见，45帧采样间隔中位25.1ms/P95 29.2ms。非所有机器或播放负载的帧率保证 |
| 原始数据、映射、YuLan建筑和二维页面无变更 | Git对照无差异；未修改地图、A*、数据、依赖或VS Code配置 |
| `git diff --check` | 通过；只在 `feat/asset-library` 本地提交，结果提交号与最终状态见交付消息 |

以上日志均在 `logs/asset-library/`；实际页面测试命令为 `node logs/asset-library/rocketbox-browser.cjs`，退出码0，结果为 `rocketbox-browser.json`。该脚本与截图留在本机忽略目录。持杯另外通过真实模型48相位顶点测试和实际渲染样本验证。

## 截图与交付

以下均为实际Three.js渲染，1600×1000，已逐张查看：

- `logs/asset-library/rocketbox-overview.png`：YuLan校园与写实人物全景。
- `logs/asset-library/rocketbox-closeup.png`：页面中的人物近景、衣服、脸部与头发。
- `logs/asset-library/rocketbox-samples.png`：四个外观变体对照。

浏览器和截图检查已完成，原5180监听进程PID71160保留。

## 本轮限制

- 四个模型反复用于100人展示，外观会重复；这轮验证免费写实素材能否改善观感，不意味着已经准备了100种独立人物。
- 模型贴图和服装来自既有Rocketbox素材，未做现代照片扫描；缺少法线/高光细节。画面质量取决于光照、相机距离、纹理与材质设置。
- 程序骨骼动作不等于高质量动作捕捉。关节姿势、手握咖啡杯和脚底贴地仍应以近景检查为准；新增外观也需继续符合已有碰撞包络。
- 浏览器首次读取约15MB素材并解析FBX需要时间；未提供GLB压缩、LOD或逐骨骼GPU实例化优化。大规模性能须以本机实际回放检查为准。
- 仅替换可视化人物，不会增加OASIS位置、真实出行时间或新的消费者行为。
